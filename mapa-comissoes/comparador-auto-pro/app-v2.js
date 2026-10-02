import { evaluatePurchase } from "./valuation.js";
import { relevantMemories } from "./memory.js";
import { parseVehicleInput,manualMissing } from "./input.js";

const SUPABASE_URL = "https://ciyycnjxteqpphgbkneg.supabase.co";
const SUPABASE_KEY = "sb_publishable_NLLNaEvhKHfoJNenqpObdA_sNA8UTNa";
const db = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const q=id=>document.getElementById(id);
const euro=new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const fmt=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?euro.format(Number(v)):"—";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const toast=message=>{
  const el=q("toast");el.textContent=message;el.classList.add("show");
  clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),2200);
};

let session=null;
let member=null;
let currentAnalysisId=null;
let currentVehicle=null;
let currentResult=null;
let lastAnalysisContext=null;
let conversation=[];
let selectedImageData=null;
let selectedImages=[];
let preparingImages=false;
let imageGeneration=0;
const MAX_IMAGES=6;
let selectedImageName="";
let speechRecognition=null;
let mediaRecorder=null;
let mediaStream=null;
let audioChunks=[];
let recordingTimer=null;

const DEAL={
  costs:{auction_fee:0,transport:150,registration:0,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100},
  target_margin:3500,
  minimum_margin:1200
};

function setAuthMessage(message){q("authMessage").textContent=message||""}
function showAuth(){
  q("authGate").classList.remove("hidden");q("app").classList.add("hidden");
}
function showApp(){
  q("authGate").classList.add("hidden");q("app").classList.remove("hidden");
  refreshMemoryCount();
}
async function validateMember(){
  const {data,error}=await db.schema("mapa_comercial").rpc("get_current_member");
  if(error) throw error;
  member=data||null;
  return !!member?.active && member?.role==="admin";
}
async function boot(){
  const {data}=await db.auth.getSession();
  session=data.session||null;
  if(!session){showAuth();return}
  try{
    if(!await validateMember()){
      setAuthMessage("Nesta V1 o Comparador Auto Pro está reservado a administradores.");
      await db.auth.signOut();session=null;showAuth();return;
    }
    showApp();
  }catch(err){
    setAuthMessage("Não foi possível validar o acesso.");
    showAuth();
  }
}
q("authForm").addEventListener("submit",async ev=>{
  ev.preventDefault();setAuthMessage("A entrar…");
  const email=q("authEmail").value.trim(),password=q("authPassword").value;
  const {data,error}=await db.auth.signInWithPassword({email,password});
  if(error){setAuthMessage(error.message);return}
  session=data.session;
  if(!await validateMember()){
    setAuthMessage("Conta autenticada, mas sem acesso de administrador.");await db.auth.signOut();session=null;return;
  }
  setAuthMessage("");showApp();
});
q("logoutBtn").addEventListener("click",async()=>{await db.auth.signOut();session=null;showAuth()});

function progress(title,text){
  q("progressPanel").classList.remove("hidden");
  q("progressTitle").textContent=title;q("progressText").textContent=text;
}
function stopProgress(){q("progressPanel").classList.add("hidden")}
function sourceName(host){
  if(/auto1\.com$/i.test(host))return "AUTO1";
  if(/standvirtual\.com$/i.test(host))return "Standvirtual";
  if(/olx\./i.test(host))return "OLX";
  if(/piscapisca\.pt$/i.test(host))return "PiscaPisca";
  if(host==="photo")return "Fotografia IA";
  if(host==="manual")return "Descrição manual";
  return host.replace(/^www\./,"");
}
function ruleType(text){
  const t=text.toLowerCase();
  if(/problema|avaria|bateria|motor|caixa|risco|defeito|falha/.test(t))return "technical_risk";
  if(/procura|vende|vender|roda|rápido|rapido|liquidez|muita saída|muita saida/.test(t))return "liquidity";
  if(/margem|ganhar|custo|comissão|comissao|preço mínimo|preco minimo/.test(t))return "margin_cost";
  return "commercial_preference";
}
function ruleEffect(text,type){
  const t=text.toLowerCase();
  const negative=/não quero|nao quero|evitar|problema|avaria|fraco|lento|difícil|dificil|má saída|ma saida|pouca procura/.test(t);
  const positive=/muito procurado|vende muito|muita procura|boa saída|boa saida|rápido|rapido|forte procura|quero dar ênfase|quero dar enfase/.test(t);
  if(type==="technical_risk"){
    return {mode:"advisory",reserve_eur:negative?250:150,polarity:"negative"};
  }
  if(type==="liquidity"){
    return {mode:"advisory",liquidity_bias:positive?1:negative?-1:0,polarity:positive?"positive":negative?"negative":"neutral"};
  }
  if(type==="margin_cost"){
    return {mode:"advisory",polarity:negative?"negative":"neutral"};
  }
  return {mode:"advisory",polarity:positive?"positive":negative?"negative":"neutral"};
}

function ruleReply(type){
  return {
    technical_risk:"Registei isto como aprendizagem técnica. Começa como regra prudente e ganha peso quando compras/vendas reais a confirmarem.",
    liquidity:"Registei a tua leitura de procura/liquidez. Não vai distorcer o preço sozinho: ganha peso com stock, tempo de venda e resultados reais.",
    margin_cost:"Registei esta regra de margem/custo. Fica auditável e separada do valor de mercado.",
    commercial_preference:"Registei esta preferência comercial. Fica ligada ao contexto da viatura e pode ser reforçada ou contrariada pelos resultados reais."
  }[type];
}
function addMsg(role,text){
  conversation.push({role,content:text});conversation=conversation.slice(-12);
  const div=document.createElement("div");div.className="msg "+role;div.textContent=text;q("chat").appendChild(div);q("chat").scrollTop=q("chat").scrollHeight;
}
async function storeMessage(role,content,rules=[]){
  if(!session)return;
  const {error}=await db.from("cap_messages").insert({analysis_id:currentAnalysisId,user_id:session.user.id,role,content,extracted_rules:rules});
  if(error)toast("Não foi possível guardar esta mensagem no histórico.");
}
async function refreshMemoryCount(){
  if(!session)return;
  const {count}=await db.from("cap_memory_rules").select("id",{count:"exact",head:true}).eq("active",true).eq("user_id",session.user.id);
  q("memoryCount").textContent=(count||0)+" "+((count||0)===1?"regra":"regras");
}

async function learnFromRefinement(text){
  if(!text||!session||!currentAnalysisId)return {learned:false,reply:""};
  try{
    const memories=relevantMemories(await loadMemories(),currentVehicle||{});
    const response=await fetch("/api/comparador-ai",{
      method:"POST",
      headers:{
        "content-type":"application/json",
        "authorization":"Bearer "+session.access_token
      },
      body:JSON.stringify({
        message:text,
        analysis_id:currentAnalysisId,
        context:{
          vehicle:currentVehicle||null,
          valuation:currentResult?{
            market:currentResult.market,
            purchase:currentResult.purchase,
            tax:currentResult.tax,
            warnings:currentResult.warnings
          }:null,
          dealer_memories:memories||[],
          conversation:conversation.slice(-8)
        }
      })
    });

    const data=await response.json().catch(()=>({}));
    if(!response.ok)return {learned:false,reply:""};

    const reply=String(data.reply||"").trim();
    const memory=data.memory_rule;
    if(!(data.should_save_memory&&memory&&memory.rule_type&&memory.rule_type!=="none")){
      return {learned:false,reply};
    }

    const scope=memory.scope||{};
    const {error}=await db.from("cap_memory_rules").insert({
      user_id:session.user.id,
      analysis_id:currentAnalysisId,
      rule_type:memory.rule_type,
      statement:memory.statement||text,
      scope,
      effect:memory.effect||{mode:"advisory"},
      evidence_level:"observation",
      confidence:Number.isFinite(Number(memory.confidence))?Number(memory.confidence):.6
    });
    if(error)throw error;
    await refreshMemoryCount();
    return {learned:true,reply};
  }catch(error){
    console.warn("Aprendizagem do refinamento:",error);
    return {learned:false,reply:""};
  }
}

const originLabel=v=>v==="national"?"Nacional":v==="imported"?"Importado":"Origem por confirmar";
const sellerLabel=v=>v==="professional"?"Profissional":v==="private"?"Particular":"Vendedor por confirmar";
function vehicleMeta(v){
  const bits=[];
  if(v.first_registration)bits.push(v.first_registration.slice(0,7).split("-").reverse().join("/"));
  else if(v.year)bits.push(v.year);
  if(v.mileage_km!=null)bits.push(Number(v.mileage_km).toLocaleString("pt-PT")+" km");
  if(v.power_cv)bits.push(v.power_cv+" cv");
  if(v.battery_kwh)bits.push(v.battery_kwh+" kWh");
  bits.push(originLabel(v.origin));
  return bits.join(" · ")||"Dados ainda incompletos";
}
function renderRisks(flags,warnings){
  const list=q("riskList");if(!list)return;list.innerHTML="";
  const all=[...(flags||[]).map(x=>({text:x.label,severity:x.severity||"medium"})),...(warnings||[]).map(x=>({text:x,severity:"medium"}))];
  if(!all.length)all.push({text:"Sem alertas relevantes registados nesta análise.",severity:"low"});
  all.forEach(x=>{
    const el=document.createElement("div");el.className="risk "+(x.severity==="high"?"high":x.severity==="low"?"low":"");el.textContent=x.text;list.appendChild(el);
  });
}
function renderComparables(rows){
  const box=q("comparableList");box.innerHTML="";
  (rows||[]).slice(0,6).forEach(c=>{
    const el=document.createElement("div");el.className="comp";
    el.innerHTML="<div><strong>"+esc(c.label||c.trim||"Comparável")+"</strong><small>"+esc((c.year||"")+" · "+(c.mileage_km?Number(c.mileage_km).toLocaleString("pt-PT")+" km":"")+" · "+originLabel(c.origin)+" · "+sellerLabel(c.seller_type))+"</small></div><div style='text-align:right'><b>"+esc(fmt(c.price))+"</b><br><em>"+esc(c.similarity+"% semelhante")+"</em></div>";
    if(c.url){try{const u=new URL(c.url);if(["https:","http:"].includes(u.protocol)){const a=document.createElement("a");a.href=u.toString();a.target="_blank";a.rel="noopener noreferrer";a.textContent="Consultar anúncio ↗";el.firstElementChild.appendChild(a)}}catch{}}
    box.appendChild(el);
  });
}
function renderResult(result,sourceHost,riskFlags=[]){
  currentResult=result||null;
  currentVehicle=result.subject||{};
  q("emptyState").classList.add("hidden");q("result").classList.remove("hidden");
  q("sourceLabel").textContent=sourceName(sourceHost);
  q("vehicleTitle").textContent=[currentVehicle.make,currentVehicle.model,currentVehicle.trim].filter(Boolean).join(" ")||"Viatura";
  q("vehicleMeta").textContent=vehicleMeta(currentVehicle);
  q("confidencePill").textContent="Confiança "+(result.market?.confidencePct??0)+"%";
  q("maxPurchase").textContent=fmt(result.purchase?.maxPurchase);
  q("currentPrice").textContent=fmt(result.purchase?.currentPrice);
  q("saleLikely").textContent=fmt(result.market?.saleLikely);
  q("saleFast").textContent=fmt(result.market?.saleFast);
  const rawExpectedMargin=result.purchase?.expectedMargin;
  const hasExpectedMargin=rawExpectedMargin!==null&&rawExpectedMargin!==undefined&&rawExpectedMargin!==""&&Number.isFinite(Number(rawExpectedMargin));
  const recommendedSpread=(result.market?.saleLikely!==null&&result.market?.saleLikely!==undefined&&result.purchase?.maxPurchase!==null&&result.purchase?.maxPurchase!==undefined)
    ? Number(result.market.saleLikely)-Number(result.purchase.maxPurchase)
    : NaN;
  q("expectedMargin").textContent=fmt(hasExpectedMargin?Number(rawExpectedMargin):recommendedSpread);
  q("comparableCount").textContent=String(result.market?.comparablesUsed??0);
  q("decisionText").textContent=result.purchase?.decision||"—";
  const gap=(result.purchase?.currentPrice??0)-(result.purchase?.maxPurchase??0);
  q("gapText").textContent=Number.isFinite(gap)?(gap>0?fmt(gap)+" acima do recomendado":fmt(Math.abs(gap))+" abaixo do recomendado"):"—";
  q("marketSummary").textContent="Valor de mercado estimado em "+fmt(result.market?.marketValue)+", com base nos comparáveis válidos apresentados abaixo.";
  renderComparables(result.comparables);
  renderRisks(riskFlags,result.warnings);
  const calcBox=q("calcBox");
  if(calcBox)calcBox.innerHTML=
    "Margem objetivo ideal: <strong>"+esc(fmt(result.purchase?.targetMargin))+"</strong><br>"+
    "Teto absoluto: <strong>"+esc(fmt(result.purchase?.absoluteMax))+"</strong>";
}
function renderReaderOnly(reader,url){
  currentResult=null;
  currentVehicle={make:"",model:"",trim:"",year:null,mileage_km:null};
  q("emptyState").classList.add("hidden");q("result").classList.remove("hidden");
  const host=url?new URL(url).hostname:"Descrição manual";
  q("sourceLabel").textContent=sourceName(host);
  q("vehicleTitle").textContent=reader.page?.title||"Anúncio lido";
  q("vehicleMeta").textContent=reader.page?.description||"Leitura concluída; falta normalizar a viatura.";
  ["maxPurchase","currentPrice","saleLikely","saleFast","expectedMargin"].forEach(id=>q(id).textContent="—");
  q("comparableCount").textContent="0";q("confidencePill").textContent="Confiança —";
  q("decisionText").textContent="Não foi possível confirmar todos os dados da viatura.";
  q("gapText").textContent="Sem decisão de compra ainda.";
  q("marketSummary").textContent="A leitura pública do link funcionou. Confirma os dados do anúncio antes de tomar uma decisão de compra.";
  q("comparableList").innerHTML="";
  renderRisks([{label:"Análise ainda sem comparáveis; não usar para licitar.",severity:"high"}],[]);
  const calcBox=q("calcBox");if(calcBox)calcBox.textContent="O motor de cálculo só é ativado quando existirem dados suficientes do carro e do mercado.";
}

async function createAnalysis(url,host){
  const {data,error}=await db.from("cap_analyses").insert({
    user_id:session.user.id,source_url:url,source_domain:host,status:"reading"
  }).select("id").single();
  if(error)throw error;
  currentAnalysisId=data.id;return data.id;
}
async function updateAnalysis(patch){
  if(!currentAnalysisId)return;
  const payload={...patch,updated_at:new Date().toISOString()};
  await db.from("cap_analyses").update(payload).eq("id",currentAnalysisId);
}

function auto1Request(action,url,timeout=80000){
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const timer=setTimeout(()=>{window.removeEventListener("message",listener);reject(new Error(action==="ping"?"Instala a extensão AUTO1 e recarrega esta página.":"A ligação AUTO1 não respondeu. Confirma a sessão e tenta novamente."))},timeout);
    function listener(event){
      if(event.source!==window||event.origin!==location.origin||event.data?.channel!=="CAP_AUTO1_RESPONSE"||event.data.id!==id)return;
      clearTimeout(timer);window.removeEventListener("message",listener);
      if(event.data.ok)resolve(event.data);else reject(new Error(event.data.message||"Falha na ligação AUTO1."));
    }
    window.addEventListener("message",listener);
    window.postMessage({channel:"CAP_AUTO1_REQUEST",id,action,url},location.origin);
  });
}
async function checkAuto1(){
  try{await auto1Request("ping",null,1800);return true}catch{return false}
}
function auto1VehicleCode(url){
  try{
    const m=new URL(url).pathname.match(/\/merchant\/car\/([^/?#]+)/i);
    return m?decodeURIComponent(m[1]).trim():"";
  }catch{return ""}
}
function auto1LinkReader(url){
  const code=auto1VehicleCode(url);
  return {
    ok:true,
    status:"ok",
    source_kind:"auto1_link_only",
    vehicle_code:code||null,
    page:{
      title:"AUTO1 "+(code||""),
      description:"Link privado AUTO1 reconhecido. O sistema vai tentar identificar a viatura pelo código da oferta e pela pesquisa de mercado.",
      text_sample:"AUTO1 offer code: "+(code||"unknown")+"\nSource URL: "+url,
      json_ld:[]
    }
  };
}
function auto1ScreenshotReader(url,description){
  const code=auto1VehicleCode(url);
  return {
    ok:true,
    status:"ok",
    source_kind:"auto1_screenshot",
    vehicle_code:code||null,
    page:{
      title:description&&description!=="Fotografia anexada para identificação da viatura."?description:("AUTO1 "+(code||"")),
      description:"Link AUTO1 reconhecido. A ficha será lida a partir da fotografia anexada e cruzada com a pesquisa de mercado.",
      text_sample:"AUTO1 offer code: "+(code||"unknown")+"\nSource URL: "+url,
      json_ld:[]
    }
  };
}
function parsePtNumber(raw){
  const normalized=String(raw||"").replace(/\s+/g,"").replace(/\.(?=\d{3}(?:\D|$))/g,"").replace(",",".").replace(/[^\d.]/g,"");
  const value=Number(normalized);
  return Number.isFinite(value)?value:null;
}
function auto1AuthenticatedFacts(reader){
  if(reader?.source_kind!=="authenticated_browser")return {};
  const full=String(reader.page?.text_sample||"");
  const main=full.split(/Carros semelhantes que podem interessar-lhe:/i)[0];
  const priceMatch=main.match(/Licita(?:ç|c)[aã]o\s+m[ií]nima\s*:\s*€?\s*([\d.\s]+(?:,\d{1,2})?)/i)
    ||main.match(/Preço\s+Auto1\s*:\s*€?\s*([\d.\s]+(?:,\d{1,2})?)/i);
  const mileageMatch=main.match(/Leitura\s+conta-quil[oó]metros\s*:\s*([\d.\s]+)\s*km/i);
  const yearMatch=main.match(/Ano\s+de\s+fabrica[cç][aã]o\s*:\s*(20\d{2}|19\d{2})/i);
  const registrationMatch=main.match(/1ª\s*Matricula[cç][aã]o\s*:\s*(\d{1,2})\/(20\d{2}|19\d{2})/i);
  const powerMatch=main.match(/Pot[eê]ncia\s+em\s+cavalos\s*:\s*[\d.,]+\s*kW\s*\/\s*([\d.,]+)\s*CV/i);
  const fuelMatch=main.match(/Combust[ií]vel\s*:\s*([^:]{2,30}?)(?=Pot[eê]ncia|Cilindrada|Caixa|Data|Carro[cç]aria|N[uú]mero|Chaves|Danos|Pa[ií]s|Classe|COC|Bancos|Cor|Estofos|$)/i);
  const transmissionMatch=main.match(/Caixa\s+de\s+velocidades\s*:\s*([^:]{2,30}?)(?=Data|Carro[cç]aria|N[uú]mero|Chaves|Danos|Pa[ií]s|Classe|COC|Bancos|Cor|Estofos|$)/i);
  const bodyMatch=main.match(/Carro[cç]aria\s*:\s*([^:]{2,30}?)(?=N[uú]mero|Chaves|Danos|Pa[ií]s|Classe|COC|Bancos|Cor|Estofos|$)/i);
  const originMatch=main.match(/Pa[ií]s\s+de\s+origem\s*:\s*([A-Z]{2})\b/i);
  const month=registrationMatch?String(registrationMatch[1]).padStart(2,"0"):null;
  const year=registrationMatch?Number(registrationMatch[2]):(yearMatch?Number(yearMatch[1]):null);
  return {
    price:priceMatch?parsePtNumber(priceMatch[1]):null,
    mileage_km:mileageMatch?Math.round(parsePtNumber(mileageMatch[1])):null,
    year:yearMatch?Number(yearMatch[1]):year,
    first_registration:registrationMatch?registrationMatch[2]+"-"+month:null,
    power_cv:powerMatch?Math.round(parsePtNumber(powerMatch[1])):null,
    fuel:fuelMatch?fuelMatch[1].trim():null,
    transmission:transmissionMatch?transmissionMatch[1].trim():null,
    body_type:bodyMatch?bodyMatch[1].trim():null,
    origin:originMatch?(originMatch[1].toUpperCase()==="PT"?"national":"imported"):null
  };
}
function mergeAuto1AuthenticatedFacts(subject,reader){
  const facts=auto1AuthenticatedFacts(reader);
  if(Number.isFinite(facts.price)&&facts.price>0)subject.price=facts.price;
  for(const key of ["mileage_km","year","first_registration","power_cv","fuel","transmission","body_type","origin"]){
    if((subject[key]===null||subject[key]===undefined||subject[key]===""||subject[key]==="unknown")&&facts[key]!==null&&facts[key]!==undefined&&facts[key]!=="")subject[key]=facts[key];
  }
  return subject;
}
function setImageStatus(name){
  selectedImageName=name||"";
  if(selectedImageData){
    q("attachmentName").textContent=selectedImages.length+"/"+MAX_IMAGES+" fotografias prontas para a IA · usa o clipe para acrescentar";
    const list=q("attachmentList");list.replaceChildren();
    selectedImages.forEach((image,index)=>{
      const row=document.createElement("div");
      const label=document.createElement("span");label.textContent=image.name+" ";
      const button=document.createElement("button");button.type="button";button.textContent="Remover";
      button.setAttribute("aria-label","Remover "+image.name);
      button.onclick=()=>{imageGeneration++;selectedImages.splice(index,1);selectedImageData=selectedImages[0]?.data||null;setImageStatus("")};
      row.append(label,button);list.append(row);
    });
    q("attachmentStatus").classList.remove("hidden");
  }else{
    q("attachmentStatus").classList.add("hidden");
  }
}
function resetSearchInput(){
  const input=q("vehicleUrl");
  input.value="";
  imageGeneration++;selectedImages=[];
  selectedImageData=null;
  selectedImageName="";
  q("vehiclePhoto").value="";
  setImageStatus("");

  if(speechRecognition){
    try{
      speechRecognition.onerror=null;
      speechRecognition.onend=null;
      speechRecognition.onresult=null;
      speechRecognition.abort();
    }catch{}
    speechRecognition=null;
  }
  if(mediaRecorder&&mediaRecorder.state!=="inactive"){
    try{
      mediaRecorder.ondataavailable=null;
      mediaRecorder.onstop=null;
      mediaRecorder.stop();
    }catch{}
  }
  clearTimeout(recordingTimer);
  recordingTimer=null;
  mediaStream?.getTracks().forEach(track=>track.stop());
  mediaStream=null;
  mediaRecorder=null;
  audioChunks=[];
  setMicActive(false);

  input.focus();
  toast("Pesquisa limpa.");
}
function loadImageElement(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Não consegui abrir este formato de imagem neste navegador."))};
    img.src=url;
  });
}
async function decodeImage(file){
  if(globalThis.createImageBitmap){
    try{
      const bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});
      return {source:bitmap,width:bitmap.width,height:bitmap.height,cleanup:()=>bitmap.close?.()};
    }catch{}
  }
  const img=await loadImageElement(file);
  return {
    source:img,
    width:img.naturalWidth||img.width,
    height:img.naturalHeight||img.height,
    cleanup:()=>{}
  };
}
function imageToJpegData(decoded,maxSide,quality){
  const scale=Math.min(1,maxSide/Math.max(decoded.width,decoded.height));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(decoded.width*scale));
  canvas.height=Math.max(1,Math.round(decoded.height*scale));
  const ctx=canvas.getContext("2d",{alpha:false});
  if(!ctx)throw new Error("Não consegui preparar a fotografia.");
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(decoded.source,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",quality);
}
async function prepareImage(file){
  if(!file||!String(file.type||"").startsWith("image/"))throw new Error("Escolhe uma fotografia.");
  if(file.size>100*1024*1024)throw new Error("A fotografia é excecionalmente grande. Usa uma imagem com menos de 100 MB.");
  const decoded=await decodeImage(file);
  try{
    if(!decoded.width||!decoded.height)throw new Error("Não consegui determinar o tamanho da fotografia.");
    const attempts=[
      [1800,.82],
      [1500,.78],
      [1200,.72],
      [1000,.68],
      [800,.62]
    ];
    for(const [maxSide,quality] of attempts){
      const data=imageToJpegData(decoded,maxSide,quality);
      if(data.length<=550000)return data;
    }
    throw new Error("Não consegui reduzir a fotografia o suficiente.");
  }finally{
    decoded.cleanup();
  }
}
async function attachImageFiles(files){
  if(preparingImages){toast("Aguarda a preparação das fotografias.");return}
  const batch=Array.from(files||[]);
  if(!batch.length)return;
  if(selectedImages.length+batch.length>MAX_IMAGES){toast("Podes anexar até 6 fotografias. Remove uma ou seleciona menos.");return}
  preparingImages=true;
  const generation=imageGeneration;
  const prepared=[];
  try{
    for(const file of batch){
      toast("A preparar fotografia "+(prepared.length+1)+" de "+batch.length+"…");
      const data=await prepareImage(file);
      if(generation!==imageGeneration)return;
      prepared.push({data,name:file.name||"Fotografia"});
    }
    selectedImages.push(...prepared);
    selectedImageData=selectedImages[0]?.data||null;
    setImageStatus("");
    toast(selectedImages.length+" fotografias prontas para a IA.");
  }catch(error){toast(error.message)}
  finally{preparingImages=false;q("vehiclePhoto").value=""}
}
function imageFromClipboard(event){
  const items=Array.from(event.clipboardData?.items||[]);
  for(const item of items){
    if(item.kind==="file"&&String(item.type||"").startsWith("image/")){
      const file=item.getAsFile();
      if(file)return file;
    }
  }
  const files=Array.from(event.clipboardData?.files||[]);
  return files.find(file=>String(file.type||"").startsWith("image/"))||null;
}
function appendDictation(text){
  const input=q("vehicleUrl");
  const current=input.value.trim();
  input.value=(current?current+" ":"")+String(text||"").trim();
  input.focus();
}
function setMicActive(active){
  q("micBtn").classList.toggle("recording",!!active);
  q("micBtn").setAttribute("aria-label",active?"Parar gravação":"Ditar por voz");
  q("micBtn").title=active?"Parar gravação":"Ditar por voz";
}
function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(new Error("Não consegui preparar o áudio."));
    reader.readAsDataURL(blob);
  });
}
async function transcribeAudio(blob){
  if(!session)throw new Error("A sessão expirou.");
  toast("A transcrever a voz…");
  const audio_data_url=await blobToDataUrl(blob);
  const {response,data}=await fetchJson("/api/comparador-transcribe",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+session.access_token},
    body:JSON.stringify({audio_data_url})
  },45000);
  if(!response.ok)throw new Error(data.message||data.error||"Não consegui transcrever a voz.");
  if(data.text)appendDictation(data.text);
}
async function stopRecorder(){
  if(mediaRecorder&&mediaRecorder.state!=="inactive")mediaRecorder.stop();
}
async function startRecorder(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error("Este navegador não permite gravação de voz nesta página.");
  mediaStream=await navigator.mediaDevices.getUserMedia({audio:true});
  const preferred=["audio/mp4","audio/webm;codecs=opus","audio/webm"].find(x=>MediaRecorder.isTypeSupported?.(x));
  mediaRecorder=preferred?new MediaRecorder(mediaStream,{mimeType:preferred}):new MediaRecorder(mediaStream);
  audioChunks=[];
  mediaRecorder.ondataavailable=e=>{if(e.data?.size)audioChunks.push(e.data)};
  mediaRecorder.onstop=async()=>{
    clearTimeout(recordingTimer);recordingTimer=null;setMicActive(false);
    const type=mediaRecorder?.mimeType||audioChunks[0]?.type||"audio/webm";
    const blob=new Blob(audioChunks,{type});
    mediaStream?.getTracks().forEach(t=>t.stop());mediaStream=null;mediaRecorder=null;audioChunks=[];
    if(blob.size<1000)return;
    try{await transcribeAudio(blob)}catch(error){toast(error.message)}
  };
  mediaRecorder.start();
  setMicActive(true);
  toast("A ouvir… toca outra vez para terminar.");
  recordingTimer=setTimeout(()=>stopRecorder(),20000);
}
async function startVoiceInput(){
  if(mediaRecorder&&mediaRecorder.state!=="inactive"){await stopRecorder();return}
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(Recognition){
    if(speechRecognition){try{speechRecognition.stop()}catch{};return}
    const r=new Recognition();speechRecognition=r;r.lang="pt-PT";r.interimResults=false;r.continuous=false;
    r.onstart=()=>setMicActive(true);
    r.onresult=e=>{const text=e.results?.[0]?.[0]?.transcript;if(text)appendDictation(text)};
    r.onerror=async e=>{
      if(e.error!=="aborted"&&e.error!=="no-speech")toast("A voz direta falhou. Vou usar gravação.");
      speechRecognition=null;setMicActive(false);
      if(e.error!=="not-allowed"&&e.error!=="service-not-allowed"){try{await startRecorder()}catch(error){toast(error.message)}}
    };
    r.onend=()=>{speechRecognition=null;if(!mediaRecorder||mediaRecorder.state==="inactive")setMicActive(false)};
    try{r.start();return}catch{speechRecognition=null;setMicActive(false)}
  }
  await startRecorder();
}

q("vehiclePhoto").addEventListener("change",ev=>attachImageFiles(ev.target.files));
q("vehicleUrl").addEventListener("paste",ev=>{
  const files=Array.from(ev.clipboardData?.files||[]).filter(file=>String(file.type||"").startsWith("image/"));
  if(!files.length){const file=imageFromClipboard(ev);if(file)files.push(file)}
  if(!files.length)return;
  ev.preventDefault();attachImageFiles(files);
});
q("removeImage").addEventListener("click",()=>{
  imageGeneration++;selectedImages=[];selectedImageData=null;selectedImageName="";q("vehiclePhoto").value="";setImageStatus("");
});
q("resetSearchBtn").addEventListener("click",resetSearchInput);
q("micBtn").addEventListener("click",()=>startVoiceInput().catch(error=>toast(error.message)));

async function loadMemories(){
  const {data,error}=await db.from("cap_memory_rules").select("rule_type,statement,scope,effect,evidence_level,confidence,created_at,valid_until").eq("active",true).eq("user_id",session.user.id).order("created_at",{ascending:false}).limit(200);
  if(error)throw new Error("Não foi possível recuperar as tuas orientações guardadas.");
  return data||[];
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fetchJson(url,options={},timeout=25000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{...options,signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    return {response,data};
  }finally{clearTimeout(timer)}
}
async function runMarketAnalysis(payload){
  let start;
  try{
    start=await fetchJson("/api/comparador-market",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+session.access_token},
      body:JSON.stringify(payload)
    },35000);
  }catch(error){
    throw new Error("A ligação caiu ao iniciar a pesquisa. Toca novamente em Analisar compra.");
  }
  if(!start.response.ok)throw new Error(start.data.message||start.data.error||"Falha ao iniciar o radar de mercado.");
  const registrationData=start.data.registration_data||null;
  if(start.data.subject)return start.data;
  const responseId=start.data.response_id;
  if(!responseId)throw new Error("O radar iniciou sem identificador de acompanhamento.");

  const mergeRegistration=result=>{
    if(!registrationData||!result?.subject)return result;
    result.subject.make=registrationData.make||result.subject.make;
    result.subject.model=registrationData.model||result.subject.model;
    result.subject.trim=registrationData.trim||result.subject.trim;
    result.subject.year=registrationData.year||result.subject.year;
    result.subject.first_registration=registrationData.first_registration||result.subject.first_registration;
    result.subject.fuel=registrationData.fuel||result.subject.fuel;
    result.subject.origin=registrationData.origin||result.subject.origin||"unknown";
    return result;
  };

  const startedAt=Date.now();
  let consecutiveNetworkFailures=0;
  while(Date.now()-startedAt<8*60*1000){
    await wait(2200);
    if(Date.now()-startedAt>12000)progress("A pesquisar o mercado…","");
    let poll;
    try{
      poll=await fetchJson("/api/comparador-market?response_id="+encodeURIComponent(responseId),{
        method:"GET",
        headers:{"authorization":"Bearer "+session.access_token}
      },20000);
      consecutiveNetworkFailures=0;
    }catch(error){
      consecutiveNetworkFailures++;
      if(consecutiveNetworkFailures<4)continue;
      throw new Error("A ligação à internet oscilou várias vezes. A pesquisa foi interrompida; tenta novamente.");
    }
    if(poll.response.status===202||poll.data.status==="queued"||poll.data.status==="in_progress")continue;
    if(!poll.response.ok)throw new Error(poll.data.message||poll.data.error||"Falha no radar de mercado.");
    return mergeRegistration(poll.data);
  }
  throw new Error("A pesquisa demorou demasiado. Nenhum valor de compra foi calculado.");
}

q("analyzeForm").addEventListener("submit",async ev=>{
  ev.preventDefault();
  if(preparingImages){toast("Aguarda a preparação das fotografias.");return}
  let entry;
  const rawInput=q("vehicleUrl").value.trim();
  if(!rawInput&&!selectedImageData){toast("Escreve uma matrícula, cola um link, dita ou anexa uma fotografia.");return}
  try{
    entry=rawInput?parseVehicleInput(rawInput):{mode:"manual",registration:null,url:null,description:"Fotografia anexada para identificação da viatura.",sourceUrl:"photo:"+Date.now(),sourceDomain:"photo"};
  }catch(error){toast(error.message);return}
  const url=entry.url;
  q("auto1Connection").classList.add("hidden");
  q("analyzeBtn").disabled=true;q("result").classList.add("hidden");q("emptyState").classList.add("hidden");
  currentAnalysisId=null;currentVehicle=null;currentResult=null;lastAnalysisContext=null;q("chat").innerHTML="";conversation=[];
  try{
    progress("A ler o anúncio…","A identificar a fonte e preparar a análise.");
    await createAnalysis(entry.sourceUrl,entry.sourceDomain);

    let reader;
    if(entry.mode==="manual"){
      reader={ok:true,status:"ok",source_kind:selectedImageData?"photo":"manual",page:{title:selectedImageData?(entry.description==="Fotografia anexada para identificação da viatura."?"Fotografia para leitura por IA":entry.description):entry.description,description:selectedImageData?"Fotografia fornecida pelo comerciante; a IA deve ler apenas o que estiver visível.":"Descrição fornecida pelo comerciante; campos omissos não confirmados.",text_sample:entry.description,json_ld:[]}};
    }else if(url.hostname==="www.auto1.com"&&url.pathname.includes("/app/merchant/car/")){
      const privateReaderAvailable=await checkAuto1();
      if(privateReaderAvailable){
        progress("A ler a AUTO1…","A usar a sessão AUTO1 já iniciada no Chrome.");
        try{
          const privateRead=await auto1Request("read",url.toString());
          reader=privateRead.reader;
        }catch(error){
          console.warn("Leitura privada AUTO1 indisponível; a usar fallback:",error);
          if(selectedImageData){
            progress("A ler a AUTO1…","A ligação privada não respondeu; vou usar a fotografia anexada.");
            reader=auto1ScreenshotReader(url.toString(),entry.description);
          }else{
            progress("A identificar a AUTO1…","A ligação privada não respondeu; vou continuar pelo código da oferta.");
            reader=auto1LinkReader(url.toString());
          }
        }
      }else if(selectedImageData){
        progress("A ler a AUTO1…","A usar o link e a fotografia em conjunto.");
        reader=auto1ScreenshotReader(url.toString(),entry.description);
      }else{
        progress("A identificar a AUTO1…","A usar o código da oferta e a pesquisa disponível, sem serviços pagos.");
        reader=auto1LinkReader(url.toString());
      }

      if(reader?.status!=="ok"||!reader.page?.text_sample)throw new Error("Não consegui preparar o link AUTO1 para análise.");
    }else{
      progress("A ler a página pública…","A tentar obter os dados do anúncio.");
      const resp=await fetch("/api/comparador-analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:url.toString()})});
      reader=await resp.json();
      if(reader.status!=="ok"){
        await updateAnalysis({status:reader.status==="needs_auth"?"needs_auth":"failed",reader,error_message:reader.message||"Leitura indisponível"});

        q("emptyState").classList.remove("hidden");
        q("emptyState").querySelector("h2").textContent=reader.status==="needs_auth"?"Este anúncio exige a tua sessão":"Não foi possível ler este anúncio diretamente";
        q("emptyState").querySelector("p").textContent="Não foi possível obter os dados desta fonte. Confirma que o link está ativo e tenta novamente.";

        return;
      }
    }
    await updateAnalysis({
      status:"searching",
      reader,
      vehicle:{page_title:reader.page?.title||""},
      source_snapshot:reader.page||{},
      source_last_seen_at:new Date().toISOString(),
      source_available:entry.mode==="manual"?null:true
    });

    progress("A pesquisar o mercado…","A normalizar a viatura e procurar comparáveis atuais em Portugal.");
    const imagesForAnalysis=selectedImages.map(image=>image.data);
    const marketPayload={url:url?.toString()||null,description:entry.description,registration:entry.registration||null,mode:entry.mode,page:reader.page||{},image_data_urls:imagesForAnalysis};
    const sourceHost=entry.registration?"Matrícula.co.pt":reader?.source_kind==="authenticated_browser"?url.hostname:imagesForAnalysis.length?"photo":entry.mode==="manual"?"manual":url.hostname;
    lastAnalysisContext={entry,reader,url:url?.toString()||null,sourceHost,marketPayload};
    const market=await runMarketAnalysis(marketPayload);

    const subject=mergeAuto1AuthenticatedFacts(market.subject||{},reader);
    const comparables=Array.isArray(market.comparables)?market.comparables:[];
    if(!subject.make||!subject.model||(entry.mode!=="manual"&&!(typeof subject.price==="number"&&subject.price>0))){
      renderReaderOnly(reader,url?.toString()||null);
      currentVehicle=subject;
      addMsg("assistant","Acrescenta a marca, o modelo e a versão na descrição acima para identificar a viatura.");
      renderRisks([{label:"Dados insuficientes para calcular com segurança.",severity:"high"}],[]);
      await updateAnalysis({status:"failed",vehicle:subject,reader,error_message:"Dados insuficientes após normalização"});
      return;
    }

    let memories=[],memoryWarning="";
    try{memories=relevantMemories(await loadMemories(),subject)}catch(error){memoryWarning=error.message}
    progress("A calcular a compra…","A aplicar comparabilidade, outliers, custos, margem e risco.");
    const result=evaluatePurchase({
      subject,
      comparables,
      current_purchase_price:typeof subject.price==="number"&&subject.price>0?subject.price:null,
      tax:{mode:subject.vat_deductible===true?"deductible":"gross",vat_rate:.23},
      costs:DEAL.costs,
      risk_flags:market.risk_flags||[],
      target_margin:DEAL.target_margin,
      minimum_margin:DEAL.minimum_margin
    });
    result.market.comment=market.market_comment||"";
    const missing=entry.mode==="manual"?manualMissing(subject):[];
    if(entry.registration)result.warnings.push("Identificação por matrícula: Matrícula.co.pt. Confirma a versão e os quilómetros antes de decidir a compra.");
    if(entry.mode==="manual"&&!entry.registration)result.warnings.push("Dados fornecidos por ti. A pesquisa confirma comparáveis, não os dados da tua viatura.");
    if(missing.length){
      result.purchase.maxPurchase=NaN;result.purchase.absoluteMax=NaN;result.purchase.expectedMargin=NaN;
      result.purchase.decision="Referência inicial — falta confirmar "+missing.join(", ");
      result.warnings.push("Completa a descrição com "+missing.join(", ")+" e volta a analisar para obter o teto de compra.");
      result.market.confidencePct=Math.min(result.market.confidencePct,40);
    }

    if(memoryWarning)result.warnings.push(memoryWarning);
    result.market.dealer_memories=memories;
    for(const rule of memories)result.warnings.push("Orientação tua: "+rule.statement);

    renderResult(result,entry.registration?"Matrícula.co.pt":selectedImageData?"photo":entry.mode==="manual"?"manual":url.hostname,market.risk_flags||[]);
    if(reader.source_kind==="authenticated_browser")q("sourceLabel").textContent="AUTO1 · Sessão autenticada · "+reader.vehicle_code;
    if(reader.source_kind==="auto1_link_only")q("sourceLabel").textContent="AUTO1 · Link · "+(reader.vehicle_code||"");
    if(reader.source_kind==="auto1_screenshot")q("sourceLabel").textContent="AUTO1 · Link + fotografia · "+(reader.vehicle_code||"");

    await updateAnalysis({
      status:"done",
      vehicle:subject,
      market:{...result.market,data_quality:market.data_quality||{},model:market.model||null},
      purchase:result.purchase,
      risks:market.risk_flags||[],
      reader
    });

    const auto1LinkOnly=reader?.source_kind==="auto1_link_only";
    const completion=missing.length
      ?(auto1LinkOnly
        ?"Reconheci o link AUTO1 e pesquisei o que estava disponível. Falta confirmar "+missing.join(", ")+". Se colares uma captura da ficha com ⌘V, completo a leitura sem qualquer serviço pago."
        :"Pesquisei o mercado. Falta confirmar "+missing.join(", ")+". Acrescenta esses dados no campo acima e volta a analisar.")
      :"Análise concluída. Podes perguntar ou ensinar-me algo sobre esta viatura.";
    addMsg("assistant",completion);
    await storeMessage("assistant",completion);
  }catch(err){
    q("emptyState").classList.remove("hidden");
    q("emptyState").querySelector("h2").textContent="Não consegui concluir esta leitura";
    const raw=String(err?.message||err);
    const message=/JSON|Unexpected|position/.test(raw)?"A resposta do serviço ficou inválida. Tenta novamente; não foi emitida uma recomendação de compra.":/Load failed|Failed to fetch|NetworkError|network connection/i.test(raw)?"A ligação caiu durante a análise. Tenta novamente; nenhum valor incompleto foi usado.":raw;
    q("emptyState").querySelector("p").textContent=message;
    await updateAnalysis({status:"failed",error_message:message});
  }finally{
    stopProgress();q("analyzeBtn").disabled=false;
  }
});

function scrollRefineDialog(){
  const box=q("refineDialogMessages");
  if(!box)return;
  requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight});
}
function appendRefineDialogMessage(role,message){
  if(!message)return;
  const box=q("refineDialogMessages");
  if(!box)return;
  const el=document.createElement("div");
  el.className="refine-dialog-message "+(role||"assistant");
  el.textContent=message;
  box.appendChild(el);
  scrollRefineDialog();
}
function showRefineDialog(state,message,tone="loading",reset=false){
  q("refineDialogState").textContent=state;
  q("refineDialogState").className="refine-dialog-state"+(tone==="success"?" success":tone==="error"?" error":"");
  const box=q("refineDialogMessages");
  if(reset&&box)box.innerHTML="";
  q("refineDialog").classList.remove("hidden");
  if(message)appendRefineDialogMessage(tone==="error"?"error":"assistant",message);
  scrollRefineDialog();
}
function closeRefineDialog(){q("refineDialog").classList.add("hidden")}
q("refineDialogClose").addEventListener("click",closeRefineDialog);
q("refineDialog").addEventListener("click",ev=>{if(ev.target===q("refineDialog"))closeRefineDialog()});

q("refineForm").addEventListener("submit",async ev=>{
  ev.preventDefault();
  const text=q("refineInput").value.trim();
  if(!text)return;
  if(!session||!lastAnalysisContext||!currentVehicle){
    toast("Faz primeiro uma análise.");
    return;
  }

  const button=q("refineBtn");
  const originalButtonText=button.textContent;
  q("refineInput").disabled=true;
  button.disabled=true;
  button.textContent="A analisar…";
  q("refineInlineStatus").textContent="A IA está a refazer a análise…";
  q("refineInlineStatus").classList.remove("hidden");
  showRefineDialog("A analisar…","", "loading", true);
  appendRefineDialogMessage("user",text);
  appendRefineDialogMessage("assistant","A cruzar a tua indicação com esta viatura e com a concorrência profissional.");
  addMsg("user","Refinar análise: "+text);
  await storeMessage("user","Refinar análise: "+text);

  try{
    progress("A refinar com IA…","A cruzar a tua indicação com a viatura e a concorrência profissional.");
    const previousRefinement=String(lastAnalysisContext.marketPayload?.refinement||"").trim();
    const combinedRefinement=previousRefinement?previousRefinement+"\n"+text:text;
    const payload={
      ...lastAnalysisContext.marketPayload,
      refinement:combinedRefinement,
      previous_subject:currentVehicle||null
    };
    const market=await runMarketAnalysis(payload);
    appendRefineDialogMessage("assistant","Pesquisa de mercado atualizada. A recalcular comparáveis, margem e teto de compra…");

    const subject={...(currentVehicle||{})};
    for(const [key,value] of Object.entries(market.subject||{})){
      if(value!==null&&value!==undefined&&value!=="")subject[key]=value;
    }
    const comparables=Array.isArray(market.comparables)?market.comparables:[];
    if(!subject.make||!subject.model)throw new Error("O refinamento não deixou a viatura suficientemente identificada.");

    let memories=[],memoryWarning="";
    try{memories=relevantMemories(await loadMemories(),subject)}catch(error){memoryWarning=error.message}

    progress("A recalcular a compra…","A atualizar comparáveis, custos, margem e risco.");
    const result=evaluatePurchase({
      subject,
      comparables,
      current_purchase_price:typeof subject.price==="number"&&subject.price>0?subject.price:null,
      tax:{mode:subject.vat_deductible===true?"deductible":"gross",vat_rate:.23},
      costs:DEAL.costs,
      risk_flags:market.risk_flags||[],
      target_margin:DEAL.target_margin,
      minimum_margin:DEAL.minimum_margin
    });
    result.market.comment=market.market_comment||"";
    appendRefineDialogMessage("assistant","Cálculo atualizado. A preparar a resposta final da IA…");

    const entry=lastAnalysisContext.entry;
    const reader=lastAnalysisContext.reader;
    const missing=entry.mode==="manual"?manualMissing(subject):[];
    if(entry.registration)result.warnings.push("Identificação por matrícula: Matrícula.co.pt. Confirma a versão e os quilómetros antes de decidir a compra.");
    if(entry.mode==="manual"&&!entry.registration)result.warnings.push("Dados fornecidos por ti. A pesquisa confirma comparáveis, não os dados da tua viatura.");
    if(missing.length){
      result.purchase.maxPurchase=NaN;
      result.purchase.absoluteMax=NaN;
      result.purchase.expectedMargin=NaN;
      result.purchase.decision="Referência inicial — falta confirmar "+missing.join(", ");
      result.warnings.push("Completa a descrição com "+missing.join(", ")+" e volta a analisar para obter o teto de compra.");
      result.market.confidencePct=Math.min(result.market.confidencePct,40);
    }
    if(memoryWarning)result.warnings.push(memoryWarning);
    result.market.dealer_memories=memories;
    for(const rule of memories)result.warnings.push("Orientação tua: "+rule.statement);

    renderResult(result,lastAnalysisContext.sourceHost,market.risk_flags||[]);
    if(reader?.source_kind==="authenticated_browser")q("sourceLabel").textContent="AUTO1 · Sessão autenticada · "+reader.vehicle_code;
    if(reader?.source_kind==="auto1_link_only")q("sourceLabel").textContent="AUTO1 · Link · "+(reader.vehicle_code||"");
    if(reader?.source_kind==="auto1_screenshot")q("sourceLabel").textContent="AUTO1 · Link + fotografia · "+(reader.vehicle_code||"");

    lastAnalysisContext.marketPayload={...payload,previous_subject:subject};
    await updateAnalysis({
      status:"done",
      vehicle:subject,
      market:{...result.market,data_quality:market.data_quality||{},model:market.model||null,refinement:combinedRefinement},
      purchase:result.purchase,
      risks:market.risk_flags||[],
      reader
    });

    const refinementAI=await learnFromRefinement(text);
    const learned=refinementAI.learned;
    q("refineInput").value="";
    const reply=(missing.length
      ?"Análise refeita com a tua indicação. Ainda falta confirmar "+missing.join(", ")+"."
      :"Análise refeita com a tua indicação e nova pesquisa de mercado.")
      +(learned?" A orientação também ficou guardada para análises futuras a que se aplique.":"");
    const priceSummary=Number.isFinite(Number(result.purchase?.maxPurchase))
      ?"\n\nNovo máximo de compra recomendado: "+fmt(result.purchase.maxPurchase)+"."
      :"";
    const visibleReply=(refinementAI.reply?refinementAI.reply+"\n\n":"")+reply+priceSummary;
    addMsg("assistant",reply);
    await storeMessage("assistant",reply);
    q("saveStatus").textContent="IA ativa";
    q("refineInlineStatus").textContent="Análise atualizada pela IA.";
    showRefineDialog("Análise atualizada",visibleReply,"success");
    toast(learned?"Análise refeita e orientação guardada.":"Análise refeita.");
  }catch(err){
    const message=String(err?.message||err);
    addMsg("assistant","Não consegui refazer a análise: "+message);
    await storeMessage("assistant","Não consegui refazer a análise: "+message);
    q("refineInlineStatus").textContent="Não foi possível refazer a análise.";
    showRefineDialog("Não foi possível concluir",message,"error");
    toast("Não foi possível refazer a análise.");
  }finally{
    stopProgress();
    q("refineInput").disabled=false;
    button.disabled=false;
    button.textContent=originalButtonText;
  }
});

q("chatForm").addEventListener("submit",async ev=>{
  ev.preventDefault();
  const text=q("chatInput").value.trim();
  if(!text||!session)return;

  const button=ev.currentTarget.querySelector("button[type=submit]");
  q("chatInput").value="";
  button.disabled=true;
  addMsg("user",text);
  await storeMessage("user",text);

  try{
    const memories=relevantMemories(await loadMemories(),currentVehicle||{});
    const response=await fetch("/api/comparador-ai",{
      method:"POST",
      headers:{
        "content-type":"application/json",
        "authorization":"Bearer "+session.access_token
      },
      body:JSON.stringify({
        message:text,
        analysis_id:currentAnalysisId,
        context:{
          vehicle:currentVehicle||null,
          valuation:currentResult?{
            market:currentResult.market,
            purchase:currentResult.purchase,
            tax:currentResult.tax,
            warnings:currentResult.warnings
          }:null,
          dealer_memories:memories||[],
          conversation:conversation.slice(0,-1).slice(-8)
        }
      })
    });

    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error||"A IA não respondeu.");

    const reply=data.reply||"Recebi a tua mensagem.";


    let savedRules=[];
    const memory=data.memory_rule;
    if(data.should_save_memory&&memory&&memory.rule_type&&memory.rule_type!=="none"){
      const scope=memory.scope||{};
      const {error}=await db.from("cap_memory_rules").insert({
        user_id:session.user.id,
        analysis_id:currentAnalysisId,
        rule_type:memory.rule_type,
        statement:memory.statement||text,
        scope,
        effect:memory.effect||{mode:"advisory"},
        evidence_level:"observation",
        confidence:Number.isFinite(Number(memory.confidence))?Number(memory.confidence):.6
      });
      if(error)throw error;
      savedRules=[memory];
      refreshMemoryCount();
    }

    addMsg("assistant",reply);
    if(savedRules.length)addMsg("assistant","Orientação guardada. Será recuperada nas próximas análises a que se aplica.");
    await storeMessage("assistant",reply,savedRules);
    q("saveStatus").textContent="IA ativa";
  }catch(err){
    const fallback="Não consegui concluir a resposta da IA. A tua mensagem não foi guardada como aprendizagem. Tenta novamente.";
    addMsg("assistant",fallback);
    await storeMessage("assistant",fallback,[]);
    q("saveStatus").textContent="IA pendente";
    console.warn("Comparador IA:",err);
  }finally{
    button.disabled=false;
  }
});

db.auth.onAuthStateChange((_event,data)=>{session=data;if(!data)showAuth()});
boot();

