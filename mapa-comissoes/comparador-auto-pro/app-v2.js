import { evaluatePurchase } from "./valuation.js?v=20261003-8";
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

const DEFAULT_DEAL={
  costs:{auction_fee:0,transport:150,registration:0,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100},
  target_margin:3500,
  minimum_margin:1200
};
let DEAL=JSON.parse(JSON.stringify(DEFAULT_DEAL));
let activeOperation=null;
let operationSequence=0;
let currentMarketData=null;
let lastRefineFocus=null;
let auctionLocationOverride=null;

function setAuthMessage(message){q("authMessage").textContent=message||""}
function showAuth(){
  q("authGate").classList.remove("hidden");q("app").classList.add("hidden");
}
function showApp(){
  q("authGate").classList.add("hidden");q("app").classList.remove("hidden");
  initializeAppData().catch(error=>console.warn("Inicialização CAP:",error));
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
q("logoutBtn").addEventListener("click",async()=>{
  if(activeOperation){toast("A análise está em curso. Conclui-a antes de sair.");return}
  await db.auth.signOut();session=null;showAuth();
});

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
function hostFromUrl(raw){
  try{return new URL(raw).hostname.replace(/^www\./i,"").toLowerCase()}catch{return ""}
}
function sourceContextFor(sourceUrl,market){
  const host=hostFromUrl(sourceUrl);
  if(host==="standvirtual.com"||host.endsWith(".standvirtual.com")){
    return {is_auction:false,vehicle_location:"PT",evidence:"Standvirtual: viatura em Portugal e já matriculada."};
  }

  const knownAuctionHosts=["auto1.com","openlane.eu","openlane.com","ecarstrade.com","autorola.pt","autorola.com","bca.com","bca-europe.com","manheim.co.uk"];
  const knownAuction=knownAuctionHosts.some(domain=>host===domain||host.endsWith("."+domain));
  const detected=market?.auction_context&&typeof market.auction_context==="object"?market.auction_context:{};
  const evidence=String(detected.evidence||"");
  const detectedAuction=detected.is_auction===true&&/(leil[aã]o|auction|remarketing|wholesale|grossista)/i.test(evidence);

  if(!host){
    return {is_auction:false,vehicle_location:"unknown",evidence:"Sem link de leilão confirmado."};
  }

  const isAuction=knownAuction?true:detectedAuction?true:detected.is_auction===false?false:null;
  const detectedLocation=["PT","foreign","unknown"].includes(detected.vehicle_location)?detected.vehicle_location:"unknown";
  const vehicleLocation=auctionLocationOverride||detectedLocation;
  return {
    is_auction:isAuction,
    vehicle_location:vehicleLocation,
    evidence:auctionLocationOverride
      ?(auctionLocationOverride==="PT"?"Localização confirmada pelo utilizador: viatura já em Portugal.":"Localização confirmada pelo utilizador: viatura fora de Portugal/importada.")
      :evidence
  };
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
function displayValue(value,fallback="Por confirmar"){
  if(value===null||value===undefined||value==="")return fallback;
  return String(value);
}
function formatRegistrationDate(value){
  if(!value)return "Por confirmar";
  const text=String(value);
  const match=text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if(!match)return text;
  return match[3]?match[3]+"/"+match[2]+"/"+match[1]:match[2]+"/"+match[1];
}
function renderTagList(id,items){
  const box=q(id);if(!box)return;
  const unique=[...new Set((items||[]).map(item=>String(item||"").trim()).filter(Boolean))];
  box.innerHTML="";
  if(!unique.length){box.innerHTML='<span class="readout-empty">Não identificado no anúncio.</span>';return}
  unique.forEach(item=>{
    const tag=document.createElement("span");tag.className="readout-tag";tag.textContent=item;box.appendChild(tag);
  });
}
function renderVehicleReadout(vehicle,context=currentMarketData){
  const v=vehicle||{};
  const reader=context?.reader||null;
  const market=context?.market||null;
  const page=reader?.page||{};
  const kind=String(reader?.source_kind||"");
  const status=q("adReadStatus");
  if(status){
    let label="Leitura do anúncio por confirmar",tone="warn";
    const length=Number(page.text_length)||String(page.text_sample||"").length||0;
    const chars=length?Number(length).toLocaleString("pt-PT")+" carateres":"";
    if(kind==="auto1_link_only"){
      label="AUTO1 privada · o link sozinho não expõe a ficha";
    }else if(kind==="link_only"){
      label="Leitura direta bloqueada · dados pelo link + pesquisa web";
    }else if(kind==="photo_fallback"||kind==="auto1_screenshot"){
      label="Leitura pelas fotografias + contexto do link";tone="ok";
    }else if(kind==="authenticated_browser"){
      label="Anúncio lido em sessão autenticada"+(chars?" · "+chars:"");tone="ok";
    }else if(reader?.status==="ok"){
      label=(page.text_truncated===true?"Texto público lido parcialmente":"Texto público do anúncio lido")+(chars?" · "+chars:"");tone=page.text_truncated===true?"warn":"ok";
    }else if(context?.entry?.mode==="manual"){
      label="Descrição fornecida manualmente";tone="ok";
    }
    status.textContent=label;status.className="read-status "+tone;
  }

  const summary=q("adSummary");
  if(summary){
    summary.textContent=String(v.ad_summary||page.description||"O anúncio foi identificado, mas não devolveu uma descrição adicional estruturada.").trim();
  }

  const facts=[
    ["Marca",v.make],
    ["Modelo",v.model],
    ["Versão",v.trim],
    ["Geração",v.generation],
    ["1.ª matrícula",formatRegistrationDate(v.first_registration)],
    ["Ano",v.year],
    ["Quilómetros",v.mileage_km!=null?Number(v.mileage_km).toLocaleString("pt-PT")+" km":null],
    ["Preço anunciado",v.price!=null?fmt(v.price):null],
    ["Combustível",v.fuel],
    ["Potência",v.power_cv!=null?v.power_cv+" cv":null],
    ["Bateria",v.battery_kwh!=null?v.battery_kwh+" kWh":null],
    ["Autonomia",v.range_km!=null?v.range_km+" km":null],
    ["Cilindrada",v.engine_cc!=null?Number(v.engine_cc).toLocaleString("pt-PT")+" cc":null],
    ["Tração",v.drivetrain],
    ["Caixa",v.transmission],
    ["Carroçaria",v.body_type],
    ["Cor",v.color],
    ["Portas",v.doors],
    ["Lugares",v.seats],
    ["IVA dedutível",v.vat_deductible===true?"Sim":v.vat_deductible===false?"Não":null],
    ["Origem",originLabel(v.origin)],
    ["Garantia",v.warranty_months!=null?v.warranty_months+" meses":null],
    ["Vendedor",v.seller_name],
    ["Localização",v.location]
  ];
  const factsBox=q("vehicleFacts");
  if(factsBox){
    factsBox.innerHTML=facts.map(([label,value])=>'<div class="vehicle-fact"><span>'+esc(label)+'</span><strong>'+esc(displayValue(value))+'</strong></div>').join("");
  }
  renderTagList("vehicleEquipment",v.equipment||[]);
  renderTagList("vehicleHighlights",v.ad_highlights||[]);

  const quality=q("vehicleDataQuality");
  if(quality){
    const data=market?.data_quality||{};
    const completeness=Number.isFinite(Number(data.completeness_pct))?Number(data.completeness_pct):null;
    const uncertain=Array.isArray(data.uncertain_fields)?data.uncertain_fields.filter(Boolean):[];
    const notes=String(data.notes||"").trim();
    const parts=[];
    if(completeness!==null)parts.push("Completude da ficha: "+completeness+"%");
    if(uncertain.length)parts.push("Por confirmar: "+uncertain.join(", "));
    if(notes)parts.push(notes);
    if(page.text_truncated===true)parts.push("A página tinha mais texto do que o limite de leitura; a ficha acima não deve ser tratada como leitura integral.");
    quality.textContent=parts.join(" · ")||"Qualidade dos dados ainda não classificada.";
  }
}

function renderRisks(flags,warnings){
  const list=q("riskList");if(!list)return;list.innerHTML="";
  const all=[...(flags||[]).map(x=>({text:x.label,severity:x.severity||"medium"})),...(warnings||[]).map(x=>({text:x,severity:"medium"}))];
  if(!all.length)all.push({text:"Sem alertas relevantes registados nesta análise.",severity:"low"});
  all.forEach(x=>{
    const el=document.createElement("div");el.className="risk "+(x.severity==="high"?"high":x.severity==="low"?"low":"");el.textContent=x.text;list.appendChild(el);
  });
}
function comparableElement(c){
  const el=document.createElement("div");el.className="comp";
  const evidence=c.evidence?.verified===true?" · verificado":" · por confirmar";
  el.innerHTML="<div><strong>"+esc(c.label||c.trim||"Comparável")+"</strong><small>"+esc((c.year||"")+" · "+(c.mileage_km!=null?Number(c.mileage_km).toLocaleString("pt-PT")+" km":"km por confirmar")+" · "+originLabel(c.origin)+" · "+sellerLabel(c.seller_type)+evidence)+"</small></div><div style='text-align:right'><b>"+esc(fmt(c.price))+"</b><br><em>"+esc((c.similarity??0)+"% semelhante")+"</em></div>";
  if(c.url){try{const u=new URL(c.url);if(["https:","http:"].includes(u.protocol)){const a=document.createElement("a");a.href=u.toString();a.target="_blank";a.rel="noopener noreferrer";a.textContent="Consultar anúncio ↗";el.firstElementChild.appendChild(a)}}catch{}}
  return el;
}
function renderComparables(rows){
  const box=q("comparableList");box.innerHTML="";
  (rows||[]).slice(0,6).forEach(c=>box.appendChild(comparableElement(c)));
}
function renderEvidence(result){
  const all=q("allComparableList"),excluded=q("excludedList"),summary=q("evidenceSummary");
  if(!all||!excluded)return;
  all.innerHTML="";excluded.innerHTML="";
  (result.comparables||[]).forEach(c=>all.appendChild(comparableElement(c)));
  (result.excluded||[]).forEach(item=>{
    const el=document.createElement("div");el.className="evidence-excluded";
    el.innerHTML="<strong>"+esc(item.label||item.comp?.label||"Comparável excluído")+"</strong><span>"+esc(item.reason||"Excluído do cálculo")+"</span>";
    excluded.appendChild(el);
  });
  if(!(result.excluded||[]).length)excluded.innerHTML='<div class="evidence-empty">Sem exclusões adicionais.</div>';
  if(summary)summary.textContent="Ver evidência completa · "+(result.comparables?.length||0)+" usados · "+(result.excluded?.length||0)+" excluídos";
}
function renderResult(result,sourceHost,riskFlags=[]){
  currentResult=result||null;
  currentVehicle=result.subject||{};
  const shareBar=q("valuationShareBar");
  if(shareBar)shareBar.classList.add("hidden");
  const vehicleReadout=q("vehicleReadout");if(vehicleReadout)vehicleReadout.open=false;
  q("emptyState").classList.add("hidden");q("result").classList.remove("hidden");
  q("sourceLabel").textContent=sourceName(sourceHost);
  q("vehicleTitle").textContent=[currentVehicle.make,currentVehicle.model,currentVehicle.trim].filter(Boolean).join(" ")||"Viatura";
  q("vehicleMeta").textContent=vehicleMeta(currentVehicle);
  renderVehicleReadout(currentVehicle,currentMarketData);
  q("confidencePill").textContent=(result.purchase?.eligible?"Confiança ":result.purchase?.provisionalEligible?"Provisório ":"Referência ")+(result.market?.confidencePct??0)+"%";
  const rawCeiling=result.purchase?.effectiveCeiling;
  const displayedCeiling=rawCeiling!==null&&rawCeiling!==undefined&&Number.isFinite(Number(rawCeiling))?Number(rawCeiling):NaN;
  if(q("purchaseCeilingLabel"))q("purchaseCeilingLabel").textContent=result.purchase?.eligible
    ?"Máximo de compra recomendado"
    :result.purchase?.provisionalEligible
      ?"Valor de compra provisório"
      :"Máximo de compra recomendado";
  q("maxPurchase").textContent=fmt(displayedCeiling);
  q("currentPrice").textContent=fmt(result.purchase?.currentPrice);
  q("saleLikely").textContent=fmt(result.market?.saleLikely);
  q("saleFast").textContent=fmt(result.market?.saleFast);
  const hasCurrent=Number.isFinite(Number(result.purchase?.currentPrice));
  q("expectedMargin").textContent=fmt(hasCurrent?result.purchase?.expectedMargin:result.purchase?.marginAtCeiling);
  if(q("expectedMarginNote"))q("expectedMarginNote").textContent=hasCurrent?"após custos e reserva":"ao teto recomendado";
  q("comparableCount").textContent=String(result.market?.comparablesUsed??0);
  q("decisionText").textContent=result.purchase?.decision||"—";
  const auctionQuestion=q("auctionLocationQuestion");
  if(auctionQuestion){
    const needs=!!result.purchase?.needsLocationConfirmation;
    auctionQuestion.classList.toggle("hidden",!needs);
    const note=q("auctionLocationEvidence");
    if(note)note.textContent=needs
      ?"Detetei uma viatura de leilão, mas não consegui confirmar se já está em Portugal. Preciso desta resposta antes de aplicar ou excluir os 1 200 €."
      :"";
  }
  const gap=hasCurrent&&Number.isFinite(displayedCeiling)?Number(result.purchase.currentPrice)-displayedCeiling:NaN;
  q("gapText").textContent=Number.isFinite(gap)?(gap>0?fmt(gap)+" acima do valor-alvo":fmt(Math.abs(gap))+" abaixo do valor-alvo"):"—";
  const verified=result.market?.verifiedProfessionals??0;
  const quality=result.purchase?.eligible
    ?"Teto suportado por "+verified+" comparáveis profissionais verificados."
    :result.purchase?.provisionalEligible
      ?"Teto provisório calculado com pelo menos 3 comparáveis profissionais. Confirma a evidência antes de fechar a compra."
      :(result.warnings?.[0]||"Referência provisória: ainda não existe evidência suficiente para calcular um valor de compra.");
  if(q("qualityNote"))q("qualityNote").textContent=quality;
  q("marketSummary").textContent=Number.isFinite(Number(result.market?.marketValue))
    ?"Valor de mercado de referência: "+fmt(result.market.marketValue)+". "+(result.purchase?.eligible
      ?"A evidência mínima para o teto recomendado foi atingida."
      :result.purchase?.provisionalEligible
        ?"Existe base suficiente para um teto provisório, mas ainda falta confirmar a evidência profissional."
        :"Ainda não existe base suficiente para calcular um valor de compra.")
    :"Ainda não existe uma referência de mercado suficiente.";
  renderComparables(result.comparables);
  renderEvidence(result);
  renderRisks(riskFlags,result.warnings);
  const calcBox=q("calcBox");
  if(calcBox)calcBox.innerHTML=
    "Margem objetivo: <strong>"+esc(fmt(result.purchase?.targetMargin))+"</strong><br>"+
    "Custo importação/leilão: <strong>"+esc(fmt(result.purchase?.importCost||0))+"</strong><br>"+
    "Teto absoluto: <strong>"+esc(fmt(
      result.purchase?.absoluteMax!==null&&result.purchase?.absoluteMax!==undefined&&Number.isFinite(Number(result.purchase.absoluteMax))
        ?result.purchase.absoluteMax
        :result.purchase?.provisionalAbsoluteMax
    ))+"</strong><br>"+
    "Versão do motor: <strong>"+esc(result.engine_version||"—")+"</strong>";
  const shareReady=Number.isFinite(Number(result.purchase?.effectiveCeiling))&&Number.isFinite(Number(result.market?.saleFast));
  if(shareBar)shareBar.classList.toggle("hidden",!shareReady);
  syncDealForm();
}

function cleanValuationSummary(value){
  return String(value||"")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,"$1")
    .replace(/\s+/g," ")
    .trim();
}
function valuationShareData(){
  if(!currentResult||!currentVehicle)return null;
  const purchase=Number(currentResult.purchase?.effectiveCeiling);
  const saleFast=Number(currentResult.market?.saleFast);
  if(!Number.isFinite(purchase)||!Number.isFinite(saleFast))return null;
  const advertised=Number(currentResult.purchase?.currentPrice);
  const title=[currentVehicle.make,currentVehicle.model,currentVehicle.trim].filter(Boolean).join(" ")||"Viatura";
  const summary=cleanValuationSummary(currentVehicle.ad_summary||"").slice(0,700);
  return {
    title,
    meta:vehicleMeta(currentVehicle),
    summary,
    purchase,
    saleFast,
    advertised:Number.isFinite(advertised)?advertised:null,
    source:String(q("sourceLabel")?.textContent||"").trim(),
    provisional:currentResult.purchase?.eligible!==true,
    date:new Date().toLocaleDateString("pt-PT")
  };
}
function valuationShareText(data){
  const lines=[
    "COMPARADOR AUTO PRO",
    data.title,
    data.meta
  ];
  if(data.advertised!==null)lines.push("Preço do anúncio: "+fmt(data.advertised));
  lines.push(
    (data.provisional?"Cotação de compra provisória: ":"Cotação de compra ideal: ")+fmt(data.purchase),
    "Cotação de venda ideal para vender rápido: "+fmt(data.saleFast)
  );
  if(data.summary)lines.push("Resumo do anúncio: "+data.summary);
  if(data.source)lines.push("Fonte: "+data.source);
  lines.push("Análise: "+data.date);
  return lines.join("\n");
}
async function shareValuationSummary(){
  const data=valuationShareData();
  if(!data){toast("Ainda não existe uma cotação completa para partilhar.");return}
  const text=valuationShareText(data);
  try{
    if(navigator.share){
      await navigator.share({title:"Cotação · "+data.title,text});
      return;
    }
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      toast("Resumo copiado para partilhar.");
      return;
    }
    const area=document.createElement("textarea");
    area.value=text;area.style.position="fixed";area.style.opacity="0";
    document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();
    toast("Resumo copiado para partilhar.");
  }catch(error){
    if(error?.name!=="AbortError")toast("Não consegui abrir a partilha.");
  }
}
function printValuationSummary(){
  const data=valuationShareData();
  if(!data){toast("Ainda não existe uma cotação completa para imprimir.");return}
  const popup=window.open("","_blank");
  if(!popup){toast("O navegador bloqueou a janela de impressão.");return}
  const purchaseLabel=data.provisional?"Cotação de compra provisória":"Cotação de compra ideal";
  const advertised=data.advertised!==null
    ?'<div class="line"><span>Preço do anúncio</span><strong>'+esc(fmt(data.advertised))+'</strong></div>'
    :"";
  const summary=data.summary
    ?'<section><h2>Resumo do anúncio</h2><p>'+esc(data.summary)+'</p></section>'
    :"";
  popup.document.open();
  popup.document.write('<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cotação · '+esc(data.title)+'</title><style>'+
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#152033;margin:0;background:#fff}'+
    '.sheet{max-width:760px;margin:0 auto;padding:42px}'+
    '.screen-actions{display:flex;justify-content:flex-start;margin:0 0 24px}'+
    '.back-btn{appearance:none;-webkit-appearance:none;border:1px solid #d8dee8;background:#f7f9fb;color:#152033;border-radius:13px;padding:12px 16px;font:700 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;cursor:pointer;box-shadow:0 1px 2px rgba(21,32,51,.04)}'+
    '.back-btn:active{transform:translateY(1px);background:#eef2f6}'+
    '.brand{font-size:12px;font-weight:800;letter-spacing:.14em;color:#506176;text-transform:uppercase}'+
    'h1{font-size:28px;margin:8px 0 4px} .meta{color:#627085;margin-bottom:28px}'+
    '.quotes{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}'+
    '.quote{border:1px solid #d8dee8;border-radius:16px;padding:18px} .quote span{display:block;color:#627085;font-size:12px;margin-bottom:8px} .quote strong{font-size:28px}'+
    '.line{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #e5e9ef;padding:14px 0}'+
    'section{margin-top:26px;border-top:1px solid #e5e9ef;padding-top:20px} h2{font-size:16px;margin:0 0 10px} p{font-size:13px;line-height:1.6;margin:0}'+
    '.foot{margin-top:30px;color:#7a8798;font-size:11px}'+
    '@media(max-width:560px){.sheet{padding:24px}.quotes{grid-template-columns:1fr}.quote strong{font-size:24px}.back-btn{width:100%;padding:13px 16px}}'+
    '@media print{.screen-actions{display:none!important}.sheet{padding:18mm 14mm}.quotes{break-inside:avoid}}'+
    '</style></head><body><main class="sheet">'+
    '<div class="screen-actions"><button class="back-btn" id="backToComparator" type="button">← Voltar ao Comparador</button></div>'+
    '<div class="brand">Comparador Auto Pro</div>'+
    '<h1>'+esc(data.title)+'</h1>'+
    '<div class="meta">'+esc(data.meta)+'</div>'+
    advertised+
    '<div class="quotes">'+
      '<div class="quote"><span>'+esc(purchaseLabel)+'</span><strong>'+esc(fmt(data.purchase))+'</strong></div>'+
      '<div class="quote"><span>Cotação de venda ideal para vender rápido</span><strong>'+esc(fmt(data.saleFast))+'</strong></div>'+
    '</div>'+
    summary+
    '<div class="foot">'+(data.source?"Fonte: "+esc(data.source)+" · ":"")+'Análise: '+esc(data.date)+' · Valores indicativos com base na evidência disponível no momento da avaliação.</div>'+
    '</main><script>'+
      'document.getElementById("backToComparator")?.addEventListener("click",()=>{try{if(window.opener&&!window.opener.closed){window.opener.focus();window.close();return}}catch(e){}window.location.href="/comparador-auto-pro/"});'+
      'window.addEventListener("load",()=>{setTimeout(()=>window.print(),180)});'+
    '<\/script></body></html>');
  popup.document.close();
}
function renderAuto1NeedsPhotos(reader,url){
  currentResult=null;
  currentVehicle=null;
  q("result").classList.add("hidden");
  const empty=q("emptyState");
  empty.classList.remove("hidden");
  empty.querySelector("h2").textContent="AUTO1: falta a ficha da viatura";
  empty.querySelector("p").textContent="O link AUTO1 foi reconhecido, mas no iPhone a oferta é privada e o link sozinho não expõe marca, modelo, preço ou quilómetros. Anexa 1 a 3 capturas da ficha e volta a tocar em Analisar compra.";
  const panel=q("auto1Connection");
  if(panel){
    panel.classList.remove("hidden");
    const title=panel.querySelector("h3");
    if(title)title.textContent="AUTO1 · "+(reader?.vehicle_code||"oferta privada");
    setTimeout(()=>panel.scrollIntoView({behavior:"smooth",block:"center"}),120);
  }
}
function renderReaderOnly(reader,url){
  currentResult=null;
  const shareBar=q("valuationShareBar");if(shareBar)shareBar.classList.add("hidden");
  currentVehicle={make:"",model:"",trim:"",year:null,mileage_km:null};
  const vehicleReadout=q("vehicleReadout");if(vehicleReadout)vehicleReadout.open=false;
  q("emptyState").classList.add("hidden");q("result").classList.remove("hidden");
  const host=url?new URL(url).hostname:"Descrição manual";
  q("sourceLabel").textContent=sourceName(host);
  q("vehicleTitle").textContent=reader.page?.title||"Anúncio lido";
  q("vehicleMeta").textContent=reader.page?.description||"Leitura concluída; falta normalizar a viatura.";
  renderVehicleReadout(currentVehicle,{reader,market:null,entry:{mode:url?"url":"manual"}});
  ["maxPurchase","currentPrice","saleLikely","saleFast","expectedMargin"].forEach(id=>q(id).textContent="—");
  q("comparableCount").textContent="0";q("confidencePill").textContent="Confiança —";
  q("decisionText").textContent="Não foi possível confirmar todos os dados da viatura.";
  q("gapText").textContent="Sem decisão de compra ainda.";
  q("marketSummary").textContent=String(reader?.source_kind||"").startsWith("auto1_")
    ?"A AUTO1 não devolveu dados suficientes para identificar a viatura com segurança. Acrescenta capturas legíveis da ficha."
    :"A leitura pública do link funcionou. Confirma os dados do anúncio antes de tomar uma decisão de compra.";
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
async function updateAnalysis(patch,analysisId=currentAnalysisId){
  if(!analysisId)return;
  const payload={...patch,updated_at:new Date().toISOString()};
  const {error}=await db.from("cap_analyses").update(payload).eq("id",analysisId);
  if(error)throw new Error("Não foi possível guardar o estado da análise.");
}
function setOperationBusy(busy){
  for(const id of ["analyzeBtn","refineBtn","logoutBtn","vehicleUrl","vehiclePhoto","micBtn","resetSearchBtn","newSearchBtn","shareValuationBtn","printValuationBtn"]){
    if(q(id))q(id).disabled=!!busy;
  }
  const chatButton=q("chatForm")?.querySelector("button[type=submit]");
  if(chatButton)chatButton.disabled=!!busy;
}
function beginOperation(kind,analysisId=null){
  if(activeOperation)throw new Error("Já existe uma análise em curso.");
  const op={id:++operationSequence,kind,analysisId,requestKey:crypto.randomUUID(),jobId:null};
  activeOperation=op;setOperationBusy(true);return op;
}
function assertOperation(op){
  if(activeOperation!==op)throw new Error("Esta operação já não é a análise ativa.");
}
function finishOperation(op){
  if(activeOperation===op){activeOperation=null;setOperationBusy(false)}
}
function mergeDeal(settings){
  const src=settings&&typeof settings==="object"?settings:{};
  const out=JSON.parse(JSON.stringify(DEFAULT_DEAL));
  for(const key of Object.keys(out.costs)){
    const value=Number(src.costs?.[key]);
    if(Number.isFinite(value)&&value>=0)out.costs[key]=value;
  }
  for(const key of ["target_margin","minimum_margin"]){
    const value=Number(src[key]);
    if(Number.isFinite(value)&&value>=0)out[key]=value;
  }
  out.minimum_margin=Math.min(out.minimum_margin,out.target_margin);
  return out;
}
async function loadDealPreferences(){
  if(!session)return;
  const {data,error}=await db.from("cap_preferences").select("settings").eq("user_id",session.user.id).maybeSingle();
  if(error)throw error;
  DEAL=mergeDeal(data?.settings||DEFAULT_DEAL);
  syncDealForm();
}
function syncDealForm(){
  const map={
    targetMarginInput:DEAL.target_margin,minimumMarginInput:DEAL.minimum_margin,
    transportCostInput:DEAL.costs.transport,reconditioningCostInput:DEAL.costs.reconditioning,
    warrantyCostInput:DEAL.costs.warranty_reserve,stockCostInput:DEAL.costs.stock_finance,
    otherCostInput:DEAL.costs.other,auctionCostInput:DEAL.costs.auction_fee,registrationCostInput:DEAL.costs.registration
  };
  for(const [id,value] of Object.entries(map))if(q(id))q(id).value=String(value);
}
function dealFromForm(){
  const read=id=>Math.max(0,Number(q(id)?.value||0));
  return mergeDeal({
    target_margin:read("targetMarginInput"),minimum_margin:read("minimumMarginInput"),
    costs:{
      transport:read("transportCostInput"),reconditioning:read("reconditioningCostInput"),
      warranty_reserve:read("warrantyCostInput"),stock_finance:read("stockCostInput"),
      other:read("otherCostInput"),auction_fee:read("auctionCostInput"),registration:read("registrationCostInput")
    }
  });
}
async function saveDealPreferences(){
  const {error}=await db.from("cap_preferences").upsert({
    user_id:session.user.id,settings:DEAL,updated_at:new Date().toISOString()
  },{onConflict:"user_id"});
  if(error)throw new Error("Não foi possível guardar as premissas.");
}
async function saveAnalysisSnapshot(analysisId,snapshot){
  const {error}=await db.rpc("cap_save_analysis",{p_id:analysisId,p_snapshot:snapshot});
  if(error)throw new Error("A análise foi calculada, mas não foi possível guardar toda a evidência.");
}
function makeSnapshot(result,market,reader,entry,marketPayload){
  return {
    saved_at:new Date().toISOString(),
    result,
    research:{
      job_id:market?.job_id||null,response_id:market?.response_id||null,model:market?.model||null,
      search_sources:market?.search_sources||[],data_quality:market?.data_quality||{},risk_flags:market?.risk_flags||[]
    },
    reader,
    source:{url:entry?.sourceUrl||marketPayload?.url||null,domain:entry?.sourceDomain||null,mode:entry?.mode||null},
    deal:DEAL,
    memory_rules:result?.market?.dealer_memories||[]
  };
}
async function persistCompletedAnalysis(analysisId,result,market,reader,entry,marketPayload){
  await updateAnalysis({risks:market?.risk_flags||[],reader},analysisId);
  await saveAnalysisSnapshot(analysisId,makeSnapshot(result,market,reader,entry,marketPayload));
}
async function initializeAppData(){
  await Promise.allSettled([refreshMemoryCount(),loadDealPreferences()]);
  await resumePendingAnalysis();
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
function resetSearchInput({announce=true,focus=true}={}){
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

  if(focus)input.focus();
  if(announce)toast("Pesquisa limpa.");
}
function resetAnalysisView(){
  if(activeOperation){toast("Aguarda a análise que está em curso.");return}

  resetSearchInput({announce:false,focus:false});
  stopProgress();

  currentAnalysisId=null;
  currentVehicle=null;
  currentResult=null;
  currentMarketData=null;
  lastAnalysisContext=null;
  auctionLocationOverride=null;
  conversation=[];

  q("result").classList.add("hidden");
  q("emptyState").classList.add("hidden");
  q("valuationShareBar")?.classList.add("hidden");
  q("auto1Connection").classList.add("hidden");
  q("chat").innerHTML="";
  q("refineInput").value="";
  q("refineInlineStatus").textContent="";
  q("refineInlineStatus").classList.add("hidden");
  q("refineDialog").classList.add("hidden");
  q("refineDialogState").textContent="A analisar…";
  q("refineDialogState").className="refine-dialog-state";
  q("refineDialogMessages").innerHTML='<div class="refine-dialog-message assistant" id="refineDialogText">A cruzar a tua indicação com a viatura e o mercado.</div>';
  lastRefineFocus=null;

  q("analyzeForm").scrollIntoView({behavior:"smooth",block:"center"});
  setTimeout(()=>q("vehicleUrl").focus({preventScroll:true}),220);
  toast("Pronto para uma nova pesquisa.");
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
  if(files.length){
    ev.preventDefault();
    attachImageFiles(files);
    return;
  }

  const text=String(ev.clipboardData?.getData("text/plain")||"").trim();
  if(!text)return;
  try{
    const parsed=parseVehicleInput(text);
    if(parsed.mode==="url"&&parsed.url){
      ev.preventDefault();
      q("vehicleUrl").value=parsed.url.toString();
      toast("Link reconhecido.");
    }
  }catch{}
});
q("removeImage").addEventListener("click",()=>{
  imageGeneration++;selectedImages=[];selectedImageData=null;selectedImageName="";q("vehiclePhoto").value="";setImageStatus("");
});
q("resetSearchBtn").addEventListener("click",resetSearchInput);
q("newSearchBtn").addEventListener("click",resetAnalysisView);
q("shareValuationBtn").addEventListener("click",shareValuationSummary);
q("printValuationBtn").addEventListener("click",printValuationSummary);
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
async function pollMarketJob(jobId,operation,timeoutMs=8*60*1000){
  const startedAt=Date.now();let consecutiveNetworkFailures=0;
  while(Date.now()-startedAt<timeoutMs){
    assertOperation(operation);
    await wait(2200);
    if(Date.now()-startedAt>12000)progress("A pesquisar o mercado…","");
    let poll;
    try{
      poll=await fetchJson("/api/comparador-market?job_id="+encodeURIComponent(jobId),{
        method:"GET",headers:{authorization:"Bearer "+session.access_token}
      },20000);
      consecutiveNetworkFailures=0;
    }catch(error){
      consecutiveNetworkFailures++;
      if(consecutiveNetworkFailures<4)continue;
      throw new Error("A ligação à internet oscilou várias vezes. A pesquisa fica guardada e pode ser retomada.");
    }
    if(poll.response.status===202||["starting","queued","in_progress"].includes(poll.data.status))continue;
    if(!poll.response.ok)throw new Error(poll.data.message||poll.data.error||"Falha no radar de mercado.");
    return poll.data;
  }
  throw new Error("A pesquisa continua pendente. Fica guardada e será retomada quando voltares ao Comparador.");
}
async function runMarketAnalysis(payload,operation){
  assertOperation(operation);
  const requestBody={...payload,analysis_id:operation.analysisId,request_key:operation.requestKey};
  let start=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      start=await fetchJson("/api/comparador-market",{
        method:"POST",
        headers:{"content-type":"application/json","authorization":"Bearer "+session.access_token},
        body:JSON.stringify(requestBody)
      },40000);
      break;
    }catch(error){
      if(attempt===1)throw new Error("A ligação caiu ao iniciar a pesquisa. O pedido mantém o mesmo identificador para evitar duplicações.");
      await wait(700);
    }
  }
  assertOperation(operation);
  if(!start.response.ok)throw new Error(start.data.message||start.data.error||"Falha ao iniciar o radar de mercado.");
  if(start.data.subject)return start.data;
  const jobId=start.data.job_id;
  if(!jobId)throw new Error("O radar iniciou sem identificador persistente.");
  operation.jobId=jobId;
  const result=await pollMarketJob(jobId,operation);
  if(start.data.registration_data&&!result.registration_data)result.registration_data=start.data.registration_data;
  return result;
}
async function resumePendingAnalysis(){
  if(!session||activeOperation)return;
  const since=new Date(Date.now()-10*60*1000).toISOString();
  const {data:jobs,error}=await db.from("cap_jobs").select("id,analysis_id,status,context,created_at").in("status",["starting","queued","in_progress"]).gte("created_at",since).order("created_at",{ascending:false}).limit(1);
  if(error||!jobs?.length)return;
  const job=jobs[0];
  const {data:analysis}=await db.from("cap_analyses").select("source_url,source_domain,reader,vehicle").eq("id",job.analysis_id).maybeSingle();
  if(!analysis)return;
  const operation=beginOperation("resume",job.analysis_id);operation.jobId=job.id;
  currentAnalysisId=job.analysis_id;
  try{
    progress("A retomar a pesquisa…","A pesquisa anterior ficou guardada. Vou continuar do ponto onde parou.");
    const market=await pollMarketJob(job.id,operation);
    assertOperation(operation);
    const subject=market.subject||analysis.vehicle||{};
    const allRules=await loadMemories().catch(()=>[]);
    const memories=relevantMemories(allRules,subject);
    const result=evaluatePurchase({
      subject,comparables:Array.isArray(market.comparables)?market.comparables:[],
      source_url:analysis.source_url,
      current_purchase_price:typeof subject.price==="number"&&subject.price>0?subject.price:null,
      tax:{mode:subject.vat_deductible===true?"deductible":"gross",vat_rate:.23},
      source_context:sourceContextFor(analysis.source_url,market),
      costs:DEAL.costs,risk_flags:market.risk_flags||[],target_margin:DEAL.target_margin,minimum_margin:DEAL.minimum_margin
    });
    result.market.comment=market.market_comment||"";result.market.dealer_memories=memories;
    for(const rule of memories)result.warnings.push("Orientação considerada: "+rule.statement);
    const entry={sourceUrl:analysis.source_url,sourceDomain:analysis.source_domain,mode:job.context?.input_mode||"url"};
    const reader=analysis.reader||{};
    const marketPayload={url:analysis.source_url,dealer_memories:allRules.slice(0,12),registration_data:market.registration_data||job.context?.registration_data||null,refinement_history:job.context?.refinement_history||[]};
    currentMarketData={market,reader,entry,sourceHost:analysis.source_domain||"manual",marketPayload,allRules};
    lastAnalysisContext=currentMarketData;
    renderResult(result,currentMarketData.sourceHost,market.risk_flags||[]);
    await persistCompletedAnalysis(job.analysis_id,result,market,reader,entry,marketPayload);
    addMsg("assistant","Retomei e concluí a pesquisa que tinha ficado pendente.");
  }catch(error){console.warn("Retoma CAP:",error);toast(error.message)}
  finally{stopProgress();finishOperation(operation)}
}

q("analyzeForm").addEventListener("submit",async ev=>{
  ev.preventDefault();
  if(activeOperation){toast("Já existe uma análise em curso.");return}
  if(preparingImages){toast("Aguarda a preparação das fotografias.");return}
  let entry;
  const rawInput=q("vehicleUrl").value.trim();
  if(!rawInput&&!selectedImageData){toast("Escreve uma matrícula, cola um link, dita ou anexa uma fotografia.");return}
  try{entry=rawInput?parseVehicleInput(rawInput):{mode:"manual",registration:null,url:null,description:"Fotografia anexada para identificação da viatura.",sourceUrl:"photo:"+Date.now(),sourceDomain:"photo"}}
  catch(error){toast(error.message);return}
  if(entry.mode==="url"&&entry.url)q("vehicleUrl").value=entry.url.toString();

  const operation=beginOperation("analysis");
  const url=entry.url;
  q("auto1Connection").classList.add("hidden");
  q("result").classList.add("hidden");q("emptyState").classList.add("hidden");
  currentAnalysisId=null;currentVehicle=null;currentResult=null;currentMarketData=null;lastAnalysisContext=null;auctionLocationOverride=null;q("chat").innerHTML="";conversation=[];

  try{
    progress("A ler o anúncio…","A identificar a fonte e preparar a análise.");
    operation.analysisId=await createAnalysis(entry.sourceUrl,entry.sourceDomain);
    assertOperation(operation);

    let reader;
    if(entry.mode==="manual"){
      reader={ok:true,status:"ok",source_kind:selectedImageData?"photo":"manual",page:{
        title:selectedImageData?(entry.description==="Fotografia anexada para identificação da viatura."?"Fotografia para leitura por IA":entry.description):entry.description,
        description:selectedImageData?"Fotografias fornecidas pelo comerciante; a IA deve ler apenas o que estiver visível.":"Descrição fornecida pelo comerciante; campos omissos não confirmados.",
        text_sample:entry.description,json_ld:[]
      }};
    }else if(url.hostname==="www.auto1.com"&&url.pathname.includes("/app/merchant/car/")){
      const privateReaderAvailable=await checkAuto1();
      if(privateReaderAvailable){
        progress("A ler a AUTO1…","A usar a sessão AUTO1 já iniciada no Chrome.");
        try{reader=(await auto1Request("read",url.toString())).reader}
        catch(error){
          console.warn("Leitura privada AUTO1 indisponível:",error);
          reader=selectedImageData?auto1ScreenshotReader(url.toString(),entry.description):auto1LinkReader(url.toString());
        }
      }else reader=selectedImageData?auto1ScreenshotReader(url.toString(),entry.description):auto1LinkReader(url.toString());
      if(reader?.status!=="ok"||!reader.page?.text_sample)throw new Error("Não consegui preparar o link AUTO1 para análise.");
    }else{
      progress("A ler a página pública…","A tentar obter os dados do anúncio.");
      const resp=await fetch("/api/comparador-analyze",{
        method:"POST",
        headers:{"content-type":"application/json","authorization":"Bearer "+session.access_token},
        body:JSON.stringify({url:url.toString()})
      });
      reader=await resp.json();
      if(reader.status!=="ok"){
        if(selectedImageData){
          reader={ok:true,status:"ok",source_kind:"photo_fallback",page:{
            title:"Fotografia + link",description:"A página não pôde ser lida; a análise usa as fotografias e conserva o link apenas como contexto.",
            text_sample:entry.description||("Source URL: "+url.toString()),json_ld:[],original_url:url.toString()
          }};
        }else{
          reader={ok:true,status:"ok",source_kind:"link_only",page:{
            title:"Link para análise",
            description:"A página não pôde ser lida diretamente. A IA deve usar o URL como pista, pesquisar a web e só confirmar dados suportados por evidência.",
            text_sample:"Source URL: "+url.toString(),
            json_ld:[],
            original_url:url.toString()
          }};
        }
      }
    }

    if(reader?.source_kind==="auto1_link_only"&&selectedImages.length===0){
      const message="AUTO1 privada: o link sozinho não expõe a ficha da viatura. É necessária uma captura da oferta ou uma sessão autenticada no computador.";
      await updateAnalysis({
        status:"needs_auth",reader,vehicle:{page_title:reader.page?.title||""},source_snapshot:reader.page||{},
        source_last_seen_at:new Date().toISOString(),source_available:false,error_message:message
      },operation.analysisId);
      renderAuto1NeedsPhotos(reader,url?.toString()||"");
      return;
    }

    await updateAnalysis({
      status:"searching",reader,vehicle:{page_title:reader.page?.title||""},source_snapshot:reader.page||{},
      source_last_seen_at:new Date().toISOString(),source_available:entry.mode==="manual"?null:["photo_fallback","link_only"].includes(reader.source_kind)?false:true
    },operation.analysisId);

    let allRules=[],memoryWarning="";
    try{allRules=await loadMemories()}catch(error){memoryWarning=error.message}
    progress("A pesquisar o mercado…","A normalizar a viatura e procurar concorrência profissional em Portugal.");
    const imagesForAnalysis=selectedImages.map(image=>image.data);
    const marketPayload={
      url:url?.toString()||null,description:entry.description,registration:entry.registration||null,mode:entry.mode,
      page:reader.page||{},image_data_urls:imagesForAnalysis,dealer_memories:allRules.slice(0,20),refinement_history:[]
    };
    const sourceHost=entry.registration?"Matrícula.co.pt":reader?.source_kind==="authenticated_browser"?url.hostname:imagesForAnalysis.length?"photo":entry.mode==="manual"?"manual":url.hostname;
    lastAnalysisContext={entry,reader,url:url?.toString()||null,sourceHost,marketPayload,allRules};
    const market=await runMarketAnalysis(marketPayload,operation);
    assertOperation(operation);
    if(market.registration_data)marketPayload.registration_data=market.registration_data;

    const subject=mergeAuto1AuthenticatedFacts(market.subject||{},reader);
    const comparables=Array.isArray(market.comparables)?market.comparables:[];
    if(!subject.make||!subject.model){
      renderReaderOnly(reader,url?.toString()||null);currentVehicle=subject;
      addMsg("assistant","Ainda falta identificar marca/modelo com segurança. Acrescenta informação ou fotografias mais legíveis.");
      await updateAnalysis({status:"failed",vehicle:subject,reader,error_message:"Dados insuficientes após normalização"},operation.analysisId);
      return;
    }

    const memories=relevantMemories(allRules,subject);
    progress("A calcular a compra…","A validar evidência, comparáveis, custos e margem.");
    const result=evaluatePurchase({
      subject,comparables,source_url:url?.toString()||null,
      current_purchase_price:typeof subject.price==="number"&&subject.price>0?subject.price:null,
      tax:{mode:subject.vat_deductible===true?"deductible":"gross",vat_rate:.23},
      source_context:sourceContextFor(url?.toString()||null,market),
      costs:DEAL.costs,risk_flags:market.risk_flags||[],target_margin:DEAL.target_margin,minimum_margin:DEAL.minimum_margin
    });
    result.market.comment=market.market_comment||"";
    if(entry.registration)result.warnings.push("A matrícula reforça a identificação, mas preço, quilómetros e versão mantêm a fonte própria e devem ser confirmados.");
    if(entry.mode==="manual"&&!entry.registration)result.warnings.push("Os dados da tua viatura foram fornecidos por ti ou pelas fotografias; a pesquisa não os substitui.");
    if(reader.source_kind==="link_only")result.warnings.push("O portal não permitiu leitura direta. A identificação foi tentada através do próprio link e da pesquisa web; confirma os dados principais antes de comprar.");
    if(memoryWarning)result.warnings.push(memoryWarning);
    result.market.dealer_memories=memories;
    for(const rule of memories)result.warnings.push("Orientação considerada: "+rule.statement);

    currentMarketData={market,reader,entry,sourceHost,marketPayload,allRules};
    lastAnalysisContext=currentMarketData;
    renderResult(result,sourceHost,market.risk_flags||[]);
    if(reader.source_kind==="authenticated_browser")q("sourceLabel").textContent="AUTO1 · Sessão autenticada · "+reader.vehicle_code;
    if(reader.source_kind==="auto1_link_only")q("sourceLabel").textContent="AUTO1 · Link · "+(reader.vehicle_code||"");
    if(reader.source_kind==="auto1_screenshot")q("sourceLabel").textContent="AUTO1 · Link + fotografia · "+(reader.vehicle_code||"");

    await persistCompletedAnalysis(operation.analysisId,result,market,reader,entry,marketPayload);
    const completion=result.purchase?.eligible
      ?"Análise concluída com evidência profissional suficiente para emitir o teto."
      :result.purchase?.provisionalEligible
        ?"Pesquisa concluída com teto provisório. Confirma a evidência antes de fechar a compra."
        :"Pesquisa concluída sem base suficiente para calcular um valor de compra.";
    addMsg("assistant",completion);await storeMessage("assistant",completion);
  }catch(err){
    q("emptyState").classList.remove("hidden");
    q("emptyState").querySelector("h2").textContent="Não consegui concluir esta leitura";
    const raw=String(err?.message||err);
    const message=/JSON|Unexpected|position/.test(raw)?"A resposta do serviço ficou inválida. Não foi emitida uma recomendação de compra.":/Load failed|Failed to fetch|NetworkError|network connection/i.test(raw)?"A ligação caiu. A pesquisa fica identificada para evitar duplicações.":raw;
    q("emptyState").querySelector("p").textContent=message;
    await updateAnalysis({status:"failed",error_message:message},operation.analysisId).catch(()=>{});
  }finally{
    stopProgress();finishOperation(operation);
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
  if(q("refineDialog").classList.contains("hidden"))lastRefineFocus=document.activeElement;
  q("refineDialogState").textContent=state;
  q("refineDialogState").className="refine-dialog-state"+(tone==="success"?" success":tone==="error"?" error":"");
  const box=q("refineDialogMessages");
  if(reset&&box)box.innerHTML="";
  q("refineDialog").classList.remove("hidden");
  q("refineDialogClose")?.focus({preventScroll:true});
  if(message)appendRefineDialogMessage(tone==="error"?"error":"assistant",message);
  scrollRefineDialog();
}
function closeRefineDialog(){
  q("refineDialog").classList.add("hidden");
  if(lastRefineFocus?.focus)lastRefineFocus.focus();
}
q("refineDialogClose").addEventListener("click",closeRefineDialog);
q("refineDialog").addEventListener("click",ev=>{if(ev.target===q("refineDialog"))closeRefineDialog()});
document.addEventListener("keydown",ev=>{if(ev.key==="Escape"&&!q("refineDialog").classList.contains("hidden"))closeRefineDialog()});

q("refineForm").addEventListener("submit",async ev=>{
  ev.preventDefault();
  const text=q("refineInput").value.trim();
  if(!text)return;
  if(activeOperation){toast("Aguarda a análise que está em curso.");return}
  if(!session||!lastAnalysisContext||!currentVehicle){toast("Faz primeiro uma análise.");return}

  const operation=beginOperation("refine",currentAnalysisId);
  const button=q("refineBtn"),originalButtonText=button.textContent;
  q("refineInput").disabled=true;button.textContent="A analisar…";
  q("refineInlineStatus").textContent="A IA está a refazer a análise…";q("refineInlineStatus").classList.remove("hidden");
  showRefineDialog("A analisar…","","loading",true);
  appendRefineDialogMessage("user",text);
  appendRefineDialogMessage("assistant","A testar a tua indicação contra esta viatura e a concorrência profissional.");
  addMsg("user","Refinar análise: "+text);await storeMessage("user","Refinar análise: "+text);

  try{
    const memories=relevantMemories(await loadMemories(),currentVehicle||{});
    progress("A refinar com IA…","A testar a tua indicação sem a assumir como facto.");
    const history=[...(lastAnalysisContext.marketPayload?.refinement_history||[]),text].slice(-5);
    const payload={
      ...lastAnalysisContext.marketPayload,
      refinement_history:history,
      previous_subject:currentVehicle||null,
      dealer_memories:memories,
      registration_data:lastAnalysisContext.marketPayload?.registration_data||null
    };
    const market=await runMarketAnalysis(payload,operation);
    assertOperation(operation);
    appendRefineDialogMessage("assistant","Pesquisa atualizada. A recalcular comparáveis, margem e teto…");

    const subject={...(currentVehicle||{})};
    for(const [key,value] of Object.entries(market.subject||{})){
      if(value!==null&&value!==undefined&&value!=="")subject[key]=value;
    }
    if(!subject.make||!subject.model)throw new Error("O refinamento não deixou a viatura suficientemente identificada.");

    progress("A recalcular a compra…","A validar a nova evidência e as premissas comerciais.");
    const result=evaluatePurchase({
      subject,comparables:Array.isArray(market.comparables)?market.comparables:[],source_url:lastAnalysisContext.url||null,
      current_purchase_price:typeof subject.price==="number"&&subject.price>0?subject.price:null,
      tax:{mode:subject.vat_deductible===true?"deductible":"gross",vat_rate:.23},
      source_context:sourceContextFor(lastAnalysisContext.url||null,market),
      costs:DEAL.costs,risk_flags:market.risk_flags||[],target_margin:DEAL.target_margin,minimum_margin:DEAL.minimum_margin
    });
    result.market.comment=market.market_comment||"";result.market.dealer_memories=memories;
    for(const rule of memories)result.warnings.push("Orientação considerada: "+rule.statement);
    appendRefineDialogMessage("assistant","Cálculo atualizado. A preparar a resposta final…");

    const entry=lastAnalysisContext.entry,reader=lastAnalysisContext.reader;
    const nextPayload={...payload,previous_subject:subject,registration_data:market.registration_data||payload.registration_data||null};
    currentMarketData={market,reader,entry,sourceHost:lastAnalysisContext.sourceHost,marketPayload:nextPayload,allRules:memories};
    lastAnalysisContext=currentMarketData;
    renderResult(result,currentMarketData.sourceHost,market.risk_flags||[]);
    await persistCompletedAnalysis(operation.analysisId,result,market,reader,entry,nextPayload);

    const refinementAI=await learnFromRefinement(text);
    q("refineInput").value="";
    const reply=(result.purchase?.eligible
      ?"Análise refeita com evidência suficiente para o teto."
      :result.purchase?.provisionalEligible
        ?"Análise refeita com teto provisório; confirma a evidência antes de fechar a compra."
        :"Análise refeita; ainda não existe base suficiente para calcular um valor de compra.")
      +(refinementAI.learned?" A orientação ficou guardada como hipótese para pesquisas futuras.":"");
    const priceSummary=Number.isFinite(Number(result.purchase?.effectiveCeiling))?"\n\nValor-alvo de compra: "+fmt(result.purchase.effectiveCeiling)+".":"";
    const visibleReply=(refinementAI.reply?refinementAI.reply+"\n\n":"")+reply+priceSummary;
    addMsg("assistant",reply);await storeMessage("assistant",reply);
    q("saveStatus").textContent="IA ativa";q("refineInlineStatus").textContent="Análise atualizada pela IA.";
    showRefineDialog("Análise atualizada",visibleReply,"success");
    toast(refinementAI.learned?"Análise refeita e orientação guardada.":"Análise refeita.");
  }catch(err){
    const message=String(err?.message||err);
    addMsg("assistant","Não consegui refazer a análise: "+message);await storeMessage("assistant","Não consegui refazer a análise: "+message);
    q("refineInlineStatus").textContent="Não foi possível refazer a análise.";showRefineDialog("Não foi possível concluir",message,"error");
  }finally{
    stopProgress();q("refineInput").disabled=false;button.textContent=originalButtonText;finishOperation(operation);
  }
});

q("chatForm").addEventListener("submit",async ev=>{
  ev.preventDefault();
  if(activeOperation){toast("Aguarda a análise que está em curso.");return}
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

async function applyAuctionLocationAnswer(vehicleLocation){
  if(activeOperation){toast("Aguarda a análise que está em curso.");return}
  if(!currentMarketData||!currentVehicle||!currentAnalysisId)return;
  auctionLocationOverride=vehicleLocation;
  const operation=beginOperation("auction-location",currentAnalysisId);
  try{
    const market=currentMarketData.market;
    const result=evaluatePurchase({
      subject:currentVehicle,
      comparables:Array.isArray(market.comparables)?market.comparables:[],
      source_url:currentMarketData.marketPayload?.url||null,
      current_purchase_price:typeof currentVehicle.price==="number"&&currentVehicle.price>0?currentVehicle.price:null,
      tax:{mode:currentVehicle.vat_deductible===true?"deductible":"gross",vat_rate:.23},
      source_context:sourceContextFor(currentMarketData.marketPayload?.url||null,market),
      costs:DEAL.costs,
      risk_flags:market.risk_flags||[],
      target_margin:DEAL.target_margin,
      minimum_margin:DEAL.minimum_margin
    });
    result.market.comment=market.market_comment||"";
    result.market.dealer_memories=relevantMemories(await loadMemories().catch(()=>[]),currentVehicle);
    renderResult(result,currentMarketData.sourceHost,market.risk_flags||[]);
    await persistCompletedAnalysis(currentAnalysisId,result,market,currentMarketData.reader,currentMarketData.entry,currentMarketData.marketPayload);
    toast(vehicleLocation==="PT"?"Confirmado: sem custo adicional de importação.":"Confirmado: acrescentados 1 200 € de importação.");
  }catch(error){
    auctionLocationOverride=null;
    toast(error.message);
  }finally{finishOperation(operation)}
}
q("auctionLocationPtBtn")?.addEventListener("click",()=>applyAuctionLocationAnswer("PT"));
q("auctionLocationForeignBtn")?.addEventListener("click",()=>applyAuctionLocationAnswer("foreign"));

q("assumptionsForm")?.addEventListener("submit",async ev=>{
  ev.preventDefault();
  if(activeOperation){toast("Aguarda a análise que está em curso.");return}
  const operation=beginOperation("recalculate",currentAnalysisId);
  try{
    DEAL=dealFromForm();
    await saveDealPreferences();
    syncDealForm();
    if(currentMarketData&&currentVehicle&&currentAnalysisId){
      const market=currentMarketData.market;
      const result=evaluatePurchase({
        subject:currentVehicle,comparables:Array.isArray(market.comparables)?market.comparables:[],
        source_url:currentMarketData.marketPayload?.url||null,
        current_purchase_price:typeof currentVehicle.price==="number"&&currentVehicle.price>0?currentVehicle.price:null,
        tax:{mode:currentVehicle.vat_deductible===true?"deductible":"gross",vat_rate:.23},
        source_context:sourceContextFor(currentMarketData.marketPayload?.url||null,market),
        costs:DEAL.costs,risk_flags:market.risk_flags||[],target_margin:DEAL.target_margin,minimum_margin:DEAL.minimum_margin
      });
      result.market.comment=market.market_comment||"";
      result.market.dealer_memories=relevantMemories(await loadMemories().catch(()=>[]),currentVehicle);
      renderResult(result,currentMarketData.sourceHost,market.risk_flags||[]);
      await persistCompletedAnalysis(currentAnalysisId,result,market,currentMarketData.reader,currentMarketData.entry,currentMarketData.marketPayload);
    }
    toast("Premissas guardadas e análise recalculada.");
  }catch(error){toast(error.message)}
  finally{finishOperation(operation)}
});

db.auth.onAuthStateChange((_event,data)=>{session=data;if(!data){activeOperation=null;showAuth()}});
boot();

