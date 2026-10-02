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
let conversation=[];

const DEAL={
  costs:{auction_fee:0,transport:150,registration:0,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100},
  target_margin:2000,
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

const originLabel=v=>v==="national"?"Nacional":v==="imported"?"Importado":"Origem por confirmar";
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
  const list=q("riskList");list.innerHTML="";
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
    el.innerHTML="<div><strong>"+esc(c.label||c.trim||"Comparável")+"</strong><small>"+esc((c.year||"")+" · "+(c.mileage_km?Number(c.mileage_km).toLocaleString("pt-PT")+" km":"")+" · "+originLabel(c.origin))+"</small></div><div style='text-align:right'><b>"+esc(fmt(c.price))+"</b><br><em>"+esc(c.similarity+"% semelhante")+"</em></div>";
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
  q("expectedMargin").textContent=fmt(result.purchase?.expectedMargin);
  q("comparableCount").textContent=String(result.market?.comparablesUsed??0);
  q("decisionText").textContent=result.purchase?.decision||"—";
  const gap=(result.purchase?.currentPrice??0)-(result.purchase?.maxPurchase??0);
  q("gapText").textContent=Number.isFinite(gap)?(gap>0?fmt(gap)+" acima do recomendado":fmt(Math.abs(gap))+" abaixo do recomendado"):"—";
  q("marketSummary").textContent="Valor de mercado estimado em "+fmt(result.market?.marketValue)+". O preço provável de venda é separado do preço pedido e o cálculo exclui incompatibilidades e outliers.";
  renderComparables(result.comparables);
  renderRisks(riskFlags,result.warnings);
  q("calcBox").innerHTML=
    "Custos económicos considerados: <strong>"+esc(fmt(result.purchase?.fixedCosts))+"</strong><br>"+
    "Reserva de risco: <strong>"+esc(fmt(result.purchase?.riskReserve))+"</strong><br>"+
    "Margem objetivo: <strong>"+esc(fmt(result.purchase?.targetMargin))+"</strong><br>"+
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
  q("calcBox").textContent="O motor de cálculo só é ativado quando existirem dados suficientes do carro e do mercado.";
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
async function loadMemories(){
  const {data,error}=await db.from("cap_memory_rules").select("rule_type,statement,scope,effect,evidence_level,confidence,created_at,valid_until").eq("active",true).eq("user_id",session.user.id).order("created_at",{ascending:false}).limit(200);
  if(error)throw new Error("Não foi possível recuperar as tuas orientações guardadas.");
  return data||[];
}

q("analyzeForm").addEventListener("submit",async ev=>{
  ev.preventDefault();
  let entry;
  try{entry=parseVehicleInput(q("vehicleUrl").value)}catch(error){toast(error.message);return}
  const url=entry.url;
  q("auto1Connection").classList.add("hidden");
  q("analyzeBtn").disabled=true;q("result").classList.add("hidden");q("emptyState").classList.add("hidden");
  currentAnalysisId=null;currentVehicle=null;currentResult=null;q("chat").innerHTML="";conversation=[];
  try{
    progress("A ler o anúncio…","A identificar a fonte e preparar a análise.");
    await createAnalysis(entry.sourceUrl,entry.sourceDomain);

    let reader;
    if(entry.mode==="manual"){
      reader={ok:true,status:"ok",source_kind:"manual",page:{title:entry.description,description:"Descrição fornecida pelo comerciante; campos omissos não confirmados.",text_sample:entry.description,json_ld:[]}};
    }else if(url.hostname==="www.auto1.com"&&url.pathname.includes("/app/merchant/car/")){
      if(!await checkAuto1()){
        q("auto1Connection").classList.remove("hidden");
        throw new Error("Para ler a AUTO1, ativa a ligação indicada abaixo e mantém a sessão iniciada.");
      }
      progress("A ler a AUTO1 na tua sessão…","A extensão abre a ficha no Chrome. Se necessário, inicia sessão na aba AUTO1.");
      const capture=await auto1Request("read",url.toString());
      reader=capture.reader;
      if(reader?.status!=="ok"||!reader.page?.text_sample)throw new Error("A AUTO1 não devolveu dados suficientes da ficha.");
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
    const marketResp=await fetch("/api/comparador-market",{
      method:"POST",
      headers:{
        "content-type":"application/json",
        "authorization":"Bearer "+session.access_token
      },
      body:JSON.stringify({url:url?.toString()||null,description:entry.description,mode:entry.mode,page:reader.page||{}})
    });
    const market=await marketResp.json().catch(()=>({}));
    if(!marketResp.ok)throw new Error(market.message||market.error||"Falha no radar de mercado.");

    const subject=market.subject||{};
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
    if(entry.mode==="manual")result.warnings.push("Dados fornecidos por ti. A pesquisa confirma comparáveis, não os dados da tua viatura.");
    if(missing.length){
      result.purchase.maxPurchase=NaN;result.purchase.absoluteMax=NaN;result.purchase.expectedMargin=NaN;
      result.purchase.decision="Referência inicial — falta confirmar "+missing.join(", ");
      result.warnings.push("Completa a descrição com "+missing.join(", ")+" e volta a analisar para obter o teto de compra.");
      result.market.confidencePct=Math.min(result.market.confidencePct,40);
    }

    if(memoryWarning)result.warnings.push(memoryWarning);
    result.market.dealer_memories=memories;
    for(const rule of memories)result.warnings.push("Orientação tua: "+rule.statement);

    renderResult(result,entry.mode==="manual"?"Descrição manual":url.hostname,market.risk_flags||[]);
    if(reader.source_kind==="authenticated_browser")q("sourceLabel").textContent="AUTO1 · Sessão autenticada · "+reader.vehicle_code;

    await updateAnalysis({
      status:"done",
      vehicle:subject,
      market:{...result.market,data_quality:market.data_quality||{},model:market.model||null},
      purchase:result.purchase,
      risks:market.risk_flags||[],
      reader
    });

    const completion=missing.length?"Pesquisei o mercado. Falta confirmar "+missing.join(", ")+". Acrescenta esses dados no campo acima e volta a analisar.":"Análise concluída. Podes perguntar ou ensinar-me algo sobre esta viatura.";
    addMsg("assistant",completion);
    await storeMessage("assistant",completion);
  }catch(err){
    q("emptyState").classList.remove("hidden");
    q("emptyState").querySelector("h2").textContent="Não consegui concluir esta leitura";
    q("emptyState").querySelector("p").textContent=/JSON|Unexpected|position/.test(String(err?.message))?"A resposta do serviço ficou inválida. Tenta novamente; não foi emitida uma recomendação de compra.":String(err?.message||err);
    await updateAnalysis({status:"failed",error_message:String(err?.message||err)});
  }finally{
    stopProgress();q("analyzeBtn").disabled=false;
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
