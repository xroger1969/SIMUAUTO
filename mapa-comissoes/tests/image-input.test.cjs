const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('./db-runtime/node_modules/jsdom');
const base=path.join(__dirname,'../comparador-auto-pro');
const load=name=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(base,name),'utf8')).toString('base64'));
const imageModule=load('image-input.js');
const jpeg='data:image/jpeg;base64,YWJj';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const file=(name='photo.jpg',type='image/jpeg')=>new File(['photograph'],name,{type});

function runtime(options={}){
  const seen={closed:0,bitmapTypes:[],urls:new Set(),revoked:[],images:[],canvases:[],encodes:[]};
  const bitmap={width:4032,height:3024,close(){seen.closed++;}};
  const api={
    createImageBitmap:options.noBitmap?undefined:async image=>{
      seen.bitmapTypes.push(image.type);
      return options.bitmap?options.bitmap(image,bitmap):bitmap;
    },
    Image:class {
      constructor(){this.naturalWidth=3024;this.naturalHeight=4032;seen.images.push(this);}
      set src(url){this.url=url;if(options.image!=='pending')queueMicrotask(()=>options.image==='error'?this.onerror?.():this.onload?.());}
      removeAttribute(name){if(name==='src')this.removed=true;}
    },
    URL:{createObjectURL(){const url='blob:photo-'+seen.urls.size;seen.urls.add(url);return url;},revokeObjectURL(url){seen.revoked.push(url);}},
    document:{createElement(tag){
      assert.equal(tag,'canvas');
      const canvas={width:0,height:0,getContext(){return {fillRect(){},drawImage(){}};},toDataURL(type,quality){
        seen.encodes.push({type,quality,width:canvas.width,height:canvas.height});
        return options.output?options.output(seen.encodes.length):jpeg;
      }};
      seen.canvases.push(canvas);return canvas;
    }}
  };
  return {api,seen,bitmap};
}

test('Files/iCloud photographs with unspecified MIME are decoded and re-encoded as an image',async()=>{
  const {prepareVehicleImage,isVehicleImageFile}=await imageModule;
  for(const mime of ['','application/octet-stream','binary/octet-stream']){
    const {api,seen}=runtime();
    const image=file('IMG_7688.JPG',mime);
    assert.equal(isVehicleImageFile(image),true);
    assert.equal(await prepareVehicleImage(image,{runtime:api}),jpeg);
    assert.deepEqual(seen.bitmapTypes,['image/jpeg']);
    assert.equal(seen.closed,1);
    assert.equal(seen.encodes[0].width,2200);
    assert.equal(seen.encodes[0].height,1650);
    assert.ok(seen.canvases.every(canvas=>canvas.width===1&&canvas.height===1));
  }
  for(const input of [null,file('report.pdf','application/pdf'),file('notes.txt',''),file('photo.jpg','application/pdf')])assert.equal(isVehicleImageFile(input),false);
});

test('HEIC falls back to the browser image decoder when ImageBitmap does not support it',async()=>{
  const {prepareVehicleImage}=await imageModule;
  const {api,seen}=runtime({bitmap:async()=>{throw Error('Bitmap format unsupported');}});
  assert.equal(await prepareVehicleImage(file('IMG_1234.HEIC','image/heic'),{runtime:api}),jpeg);
  assert.equal(seen.images.length,1);
  assert.deepEqual(seen.revoked,[...seen.urls]);
  assert.equal(seen.encodes[0].height,2200);
  assert.equal(seen.encodes[0].width,1650);
});

test('an unsupported HEIC gives an actionable error instead of a ready attachment',async()=>{
  const {prepareVehicleImage}=await imageModule;
  const {api,seen}=runtime({bitmap:async()=>{throw Error('unsupported');},image:'error'});
  await assert.rejects(prepareVehicleImage(file('IMG_1234.HEIC',''),{runtime:api}),error=>error.code==='image_decode_failed'&&/HEIC\/HEIF.*JPEG\/PNG/.test(error.message));
  assert.equal(seen.encodes.length,0);
  assert.deepEqual(seen.revoked,[...seen.urls]);
});

test('a stalled cloud/browser decode is bounded and releases the object URL',async()=>{
  const {prepareVehicleImage}=await imageModule;
  let completeBitmap;
  const {api,seen,bitmap}=runtime({bitmap:()=>new Promise(resolve=>{completeBitmap=resolve;}),image:'pending'});
  await assert.rejects(prepareVehicleImage(file(),{runtime:api,timeoutMs:30}),error=>error.code==='image_timeout'&&/iCloud/.test(error.message));
  assert.equal(seen.encodes.length,0);
  assert.deepEqual(seen.revoked,[...seen.urls]);
  completeBitmap(bitmap);await tick();
  assert.equal(seen.closed,1,'a late bitmap must not leak after the fallback timed out');
});

test('reset aborts a pending bitmap and disposes its late completion without starting another decoder',async()=>{
  const {prepareVehicleImage}=await imageModule;
  const controller=new AbortController();
  let completeBitmap;
  const {api,seen,bitmap}=runtime({bitmap:()=>new Promise(resolve=>{completeBitmap=resolve;})});
  const promise=prepareVehicleImage(file(),{runtime:api,signal:controller.signal});
  await tick();controller.abort();
  await assert.rejects(promise,{name:'AbortError'});
  completeBitmap(bitmap);await tick();
  assert.equal(seen.closed,1);
  assert.equal(seen.images.length,0);
  assert.equal(seen.encodes.length,0);
});

test('reset aborts an image element decode and revokes its object URL',async()=>{
  const {prepareVehicleImage}=await imageModule;
  const {api,seen}=runtime({noBitmap:true,image:'pending'}),controller=new AbortController();
  const promise=prepareVehicleImage(file(),{runtime:api,signal:controller.signal});
  await tick();controller.abort();
  await assert.rejects(promise,{name:'AbortError'});
  assert.deepEqual(seen.revoked,[...seen.urls]);
  assert.equal(seen.images[0].removed,true);
  assert.equal(seen.images[0].onload,null);
});

test('empty cloud placeholders and oversized files fail before any decode starts',async()=>{
  const {prepareVehicleImage}=await imageModule;
  const {api,seen}=runtime();
  await assert.rejects(prepareVehicleImage(new File([],'photo.jpg'),{runtime:api}),error=>error.code==='empty_image_file'&&/iCloud/.test(error.message));
  await assert.rejects(prepareVehicleImage({name:'photo.jpg',type:'image/jpeg',size:101*1024*1024},{runtime:api}),{code:'image_file_too_large'});
  assert.equal(seen.bitmapTypes.length,0);
  assert.equal(seen.images.length,0);
});

test('iOS empty canvas output is retried and never accepted as an attachment',async()=>{
  const {prepareVehicleImage}=await imageModule;
  const recovered=runtime({output:attempt=>attempt===1?'data:,':jpeg});
  assert.equal(await prepareVehicleImage(file(),{runtime:recovered.api}),jpeg);
  assert.equal(recovered.seen.encodes.length,2);
  const failed=runtime({output:()=> 'data:,'});
  await assert.rejects(prepareVehicleImage(file(),{runtime:failed.api}),{code:'image_encode_failed'});
  assert.equal(failed.seen.closed,1);
  assert.ok(failed.seen.canvases.every(canvas=>canvas.width===1&&canvas.height===1));
});

test('photographs retain resolution where possible while respecting the request-size budget',async()=>{
  const {prepareVehicleImage}=await imageModule;
  const {api,seen}=runtime({output:attempt=>attempt<3?'data:image/jpeg;base64,'+'A'.repeat(600000):jpeg});
  assert.equal(await prepareVehicleImage(file(),{runtime:api}),jpeg);
  assert.equal(seen.encodes.length,3);
  assert.equal(seen.encodes[0].width,seen.encodes[1].width,'try a smaller encoding at the same resolution before shrinking text');
  assert.ok(seen.encodes[2].width<seen.encodes[1].width);
  assert.equal(seen.closed,1);
});

async function uploader(prepare){
  const module=await imageModule;
  const app=fs.readFileSync(path.join(base,'app-v2.js'),'utf8');
  const dom=new JSDOM(fs.readFileSync(path.join(base,'index.html'),'utf8'),{runScripts:'outside-only'});
  const w=dom.window,q=id=>w.document.getElementById(id),messages=[];
  Object.assign(w,{
    q,selectedImages:[],selectedImageData:null,preparingImages:false,imagePreparationController:null,imageGeneration:0,
    MAX_IMAGES:6,activeOperation:null,toast:message=>messages.push(message),setImageStatus(){},
    prepareVehicleImage:prepare,isVehicleImageFile:module.isVehicleImageFile
  });
  const from=app.indexOf('function setImagePreparationStatus'),to=app.indexOf('function appendDictation',from);
  assert.ok(from>=0&&to>from);
  w.eval(app.slice(from,to));
  return {dom,w,q,messages};
}

test('one failed photograph preserves the other successfully prepared files and identifies the failure',async t=>{
  const app=await uploader(async image=>{if(image.name==='unavailable.heic')throw Error('Abre esta fotografia nas Fotos.');return jpeg;});
  t.after(()=>app.dom.window.close());
  await app.w.attachImageFiles([file('front.jpg'),file('unavailable.heic'),file('dash.jpg')]);
  assert.deepEqual(Array.from(app.w.selectedImages,image=>image.name),['front.jpg','dash.jpg']);
  assert.equal(app.w.selectedImageData,jpeg);
  assert.equal(app.w.preparingImages,false);
  assert.match(app.q('imagePreparationStatus').textContent,/2 fotografias prontas.*unavailable\.heic: Abre esta fotografia/);
  assert.equal(app.q('imagePreparationStatus').hidden,false);
});

test('a cancelled old photo batch cannot overwrite a newer batch or unlock it prematurely',async t=>{
  const completions=new Map();
  const app=await uploader(image=>new Promise(resolve=>completions.set(image.name,resolve)));
  t.after(()=>app.dom.window.close());
  const old=app.w.attachImageFiles([file('old.jpg')]);
  app.w.cancelImagePreparation();app.w.imageGeneration++;
  const current=app.w.attachImageFiles([file('current.jpg')]);
  completions.get('old.jpg')(jpeg);await old;
  assert.equal(app.w.preparingImages,true);
  assert.equal(app.w.selectedImages.length,0);
  completions.get('current.jpg')(jpeg);await current;
  assert.deepEqual(Array.from(app.w.selectedImages,image=>image.name),['current.jpg']);
  assert.equal(app.w.preparingImages,false);
  assert.equal(app.q('imagePreparationStatus').hidden,true);
});

test('photo preparation is not started during an assessment and capacity errors stay visible',async t=>{
  let calls=0;
  const app=await uploader(async()=>{calls++;return jpeg;});
  t.after(()=>app.dom.window.close());
  app.w.activeOperation={kind:'analysis'};
  await app.w.attachImageFiles([file()]);
  assert.equal(calls,0);
  app.w.activeOperation=null;
  await app.w.attachImageFiles(Array.from({length:7},()=>file()));
  assert.equal(calls,0);
  assert.match(app.q('imagePreparationStatus').textContent,/até 6 fotografias/);
});

test('pasted files without MIME follow the same photograph validation as selected files',async t=>{
  const app=await uploader(async()=>jpeg);t.after(()=>app.dom.window.close());
  const photo=file('pasted.PNG','');
  assert.equal(app.w.imageFromClipboard({clipboardData:{items:[{kind:'file',type:'',getAsFile:()=>photo}]}}),photo);
  assert.equal(app.w.imageFromClipboard({clipboardData:{files:[file('notes.txt',''),photo]}}),photo);
});
