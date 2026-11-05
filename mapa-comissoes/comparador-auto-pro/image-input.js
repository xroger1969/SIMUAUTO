const MAX_FILE_BYTES=100*1024*1024;
const FILE_MIME_TYPES={jpg:"image/jpeg",jpeg:"image/jpeg",jpe:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",bmp:"image/bmp",heic:"image/heic",heif:"image/heif",avif:"image/avif",tif:"image/tiff",tiff:"image/tiff"};
const LOADING_ERROR="A fotografia não terminou de carregar. Se estiver no iCloud, abre-a primeiro em Fotos e volta a anexá-la.";

function fileExtension(file){return String(file?.name||"").split(".").pop().toLowerCase();}
function fileMime(file){return String(file?.type||"").trim().toLowerCase().split(";")[0];}
function hasUnspecifiedMime(file){return ["","application/octet-stream","binary/octet-stream"].includes(fileMime(file));}

// Files/iCloud can supply a genuine photograph without a MIME type. The extension
// makes it eligible for decoding; only a successfully decoded raster is sent out.
export function isVehicleImageFile(file){
  return !!file&&(fileMime(file).startsWith("image/")||hasUnspecifiedMime(file)&&!!FILE_MIME_TYPES[fileExtension(file)]);
}

function imageError(message,code){const error=new Error(message);error.code=code;return error;}
function aborted(){const error=new Error("Preparação das fotografias cancelada.");error.name="AbortError";return error;}
function assertActive(signal){if(signal?.aborted)throw aborted();}
function unsupportedImage(file){
  return imageError(/hei[cf]/i.test(fileMime(file)+" "+fileExtension(file))
    ?"Este navegador não conseguiu abrir a fotografia HEIC/HEIF. Envia-a em JPEG/PNG ou anexa uma captura de ecrã."
    :"Não consegui abrir a fotografia. Volta a anexá-la ou envia uma imagem JPEG/PNG.","image_decode_failed");
}

function boundedBitmap(file,{runtime,signal,timeoutMs}){
  return new Promise((resolve,reject)=>{
    let settled=false,timer;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener("abort",onAbort);};
    const fail=error=>{if(settled)return;settled=true;cleanup();reject(error);};
    const onAbort=()=>fail(aborted());
    if(signal?.aborted){fail(aborted());return;}
    signal?.addEventListener("abort",onAbort,{once:true});
    timer=setTimeout(()=>fail(imageError(LOADING_ERROR,"image_timeout")),timeoutMs);
    Promise.resolve().then(()=>runtime.createImageBitmap(file,{imageOrientation:"from-image"})).then(bitmap=>{
      // A browser decode is not itself abortable. Dispose a late result after the
      // user resets the form or the bounded fallback has already started.
      if(settled){bitmap?.close?.();return;}
      settled=true;cleanup();
      resolve({source:bitmap,width:bitmap.width,height:bitmap.height,cleanup:()=>bitmap.close?.()});
    },fail);
  });
}

function imageElement(file,{runtime,signal,timeoutMs}){
  return new Promise((resolve,reject)=>{
    let settled=false,timer,url,img;
    const release=()=>{
      if(img){img.onload=null;img.onerror=null;img.removeAttribute?.("src");}
      if(url){runtime.URL.revokeObjectURL(url);url=null;}
    };
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener("abort",onAbort);};
    const fail=error=>{if(settled)return;settled=true;cleanup();release();reject(error);};
    const onAbort=()=>fail(aborted());
    if(signal?.aborted){fail(aborted());return;}
    signal?.addEventListener("abort",onAbort,{once:true});
    timer=setTimeout(()=>fail(imageError(LOADING_ERROR,"image_timeout")),timeoutMs);
    try{
      img=new runtime.Image();url=runtime.URL.createObjectURL(file);
      img.onload=()=>{
        if(settled)return;
        settled=true;cleanup();img.onload=null;img.onerror=null;
        resolve({source:img,width:img.naturalWidth||img.width,height:img.naturalHeight||img.height,cleanup:release});
      };
      img.onerror=()=>fail(unsupportedImage(file));
      img.src=url;
    }catch(error){fail(error);}
  });
}

async function decodeImage(file,{runtime,signal,timeoutMs}){
  assertActive(signal);
  const started=Date.now();
  let bitmapError;
  if(typeof runtime.createImageBitmap==="function"){
    try{
      return await boundedBitmap(file,{runtime,signal,timeoutMs:Math.min(10000,Math.max(1,timeoutMs/2))});
    }catch(error){
      if(error.name==="AbortError")throw error;
      bitmapError=error;
    }
  }
  assertActive(signal);
  try{
    return await imageElement(file,{runtime,signal,timeoutMs:Math.max(1,timeoutMs-(Date.now()-started))});
  }catch(error){
    if(error.name==="AbortError"||error.code==="image_timeout")throw error;
    if(bitmapError?.code==="image_timeout")throw bitmapError;
    throw unsupportedImage(file);
  }
}

function jpegData(decoded,maxSide,quality,runtime){
  const scale=Math.min(1,maxSide/Math.max(decoded.width,decoded.height));
  const canvas=runtime.document.createElement("canvas");
  try{
    canvas.width=Math.max(1,Math.round(decoded.width*scale));
    canvas.height=Math.max(1,Math.round(decoded.height*scale));
    const ctx=canvas.getContext("2d",{alpha:false});
    if(!ctx)throw imageError("O navegador não conseguiu preparar a fotografia. Tenta uma imagem mais pequena ou uma captura de ecrã.","image_canvas_failed");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(decoded.source,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL("image/jpeg",quality);
    // iOS can return an empty `data:,` when it cannot allocate the canvas. That
    // must never be labelled "ready" or included in an assessment request.
    return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)?data:null;
  }finally{
    // Release each canvas before trying the next size, important on mobile Safari.
    canvas.width=1;canvas.height=1;
  }
}

export async function prepareVehicleImage(file,{signal,timeoutMs=30000,maxDataLength=550000,runtime=globalThis}={}){
  assertActive(signal);
  if(!isVehicleImageFile(file))throw imageError("Escolhe uma fotografia JPEG, PNG, HEIC ou outro formato de imagem compatível.","invalid_image_file");
  if(!Number.isFinite(file.size)||file.size<=0)throw imageError("O ficheiro da fotografia está vazio. Se estiver no iCloud, abre-a primeiro em Fotos e volta a anexá-la.","empty_image_file");
  if(file.size>MAX_FILE_BYTES)throw imageError("A fotografia é excecionalmente grande. Usa uma imagem com menos de 100 MB.","image_file_too_large");
  const mime=FILE_MIME_TYPES[fileExtension(file)];
  const source=hasUnspecifiedMime(file)&&mime&&typeof file.slice==="function"?file.slice(0,file.size,mime):file;
  const decoded=await decodeImage(source,{runtime,signal,timeoutMs});
  try{
    assertActive(signal);
    if(!Number.isFinite(decoded.width)||!Number.isFinite(decoded.height)||decoded.width<=0||decoded.height<=0)throw imageError("Não consegui determinar o tamanho da fotografia.","invalid_image_dimensions");
    // Preserve lettering on number plates and screenshots before reducing size.
    const attempts=[[2200,.88],[2200,.78],[1800,.82],[1800,.70],[1500,.72],[1200,.68],[1000,.62],[800,.60]];
    for(const [maxSide,quality] of attempts){
      assertActive(signal);
      const data=jpegData(decoded,maxSide,quality,runtime);
      if(data&&data.length<=maxDataLength)return data;
    }
    throw imageError("Não consegui preparar uma imagem válida com o tamanho necessário. Tenta uma captura de ecrã ou uma fotografia mais pequena.","image_encode_failed");
  }finally{decoded.cleanup();}
}
