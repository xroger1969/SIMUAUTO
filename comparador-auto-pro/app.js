import { evaluatePurchase } from "./valuation.js";

const SUPABASE_URL = "https://ciyycnjxteqpphgbkneg.supabase.co";
const SUPABASE_KEY = "sb_publishable_NLLNaEvhKHfoJNenqpObdA_sNA8UTNa";
const db = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const q=id=>document.getElementById(id);
const euro=new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const fmt=v=>Number.isFinite(Number(v))?euro.format(Number(v)):"—";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const toast=message=>{
  const el=q("toast");el.textContent=message;el.classList.add("show");
  clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),2200);
};

let session=null;
let member=null;
let currentAnalysisId=null;
let currentVehicle=null;

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
  const div=document.createElement("div");div.className="msg "+role;div.textContent=text;q("chat").appendChild(div);q("chat").scrollTop=q("chat").scrollHeight;
}
async function storeMessage(role,content,rules=[]){
  if(!session)return;
  await db.from("cap_messages").insert({analysis_id:currentAnalysisId,user_id:session.user.id,role,content,extracted_rules:rules});
}
async function refreshMemoryCount(){
  if(!session)return;
  const {count}=await db.from("cap_memory_rules").select("id",{count:"exact",head:true}).eq("active",true);
  q("memoryCount").textContent=(count||0)+" "+((count||0)===1?"regra":"regras");
}

function vehicleMeta(v){
  const bits=[];
  if(v.first_registration)bits.push(v.first_registration.slice(0,7).split("-").reverse().join("/"));
  else if(v.year)bits.push(v.year);
  if(v.mileage_km!=null)bits.push(Number(v.mileage_km).toLocaleString("pt-PT")+" km");
  if(v.power_cv)bits.push(v.power_cv+" cv");
  if(v.battery_kwh)bits.push(v.battery_kwh+" kWh úteis");
  return bits.join(" · ")||"Dados ainda incompletos";
}
function renderComparables(rows){
  const box=q("comparableList");box.innerHTML="";
  (rows||[]).slice(0,6).forEach(c=>{
    const el=document.createElement("div");el.className="comp";
    el.innerHTML="<div><strong>"+esc(c.label||c.trim||"Comparável")+"</strong><small>"+esc((c.year||"")+" · "+(c.mileage_km?Number(c.mileage_km).toLocaleString("pt-PT")+" km":""))+"</small></div><div style='text-align:right'><b>"+esc(fmt(c.price))+"</b><br><em>"+esc(c.similarity+"% semelhante")+"</em></div>";
    box.appendChild(el);
  });
}
function renderResult(result,sourceHost,riskFlags=[]){
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
}
function renderReaderOnly(reader,url){
  currentVehicle={make:"",model:"",trim:"",year:null,mileage_km:null};
  q("emptyState").classList.add("hidden");q("result").classList.remove("hidden");
  const host=new URL(url).hostname;
  q("sourceLabel").textContent=sourceName(host);
  q("vehicleTitle").textContent=reader.page?.title||"Anúncio lido";
  q("vehicleMeta").textContent=reader.page?.description||"Leitura concluída; falta normalizar a viatura.";
  ["maxPurchase","currentPrice","saleLikely","saleFast","expectedMargin"].forEach(id=>q(id).textContent="—");
  q("comparableCount").textContent="0";q("confidencePill").textContent="Confiança —";
  q("decisionText").textContent="Radar de mercado ainda não ligado nesta preview.";
  q("gapText").textContent="Sem decisão de compra ainda.";
  q("marketSummary").textContent="A leitura pública do link funcionou. A próxima camada vai transformar o anúncio em ficha estruturada e procurar comparáveis.";
  q("comparableList").innerHTML="";
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

q("analyzeForm").addEventListener("submit",async ev=>{
  ev.preventDefault();
  let url;
  try{url=new URL(q("vehicleUrl").value.trim())}catch{toast("Cola um link válido.");return}
  q("analyzeBtn").disabled=true;q("result").classList.add("hidden");q("emptyState").classList.add("hidden");
  currentAnalysisId=null;currentVehicle=null;q("chat").innerHTML="";
  try{
    progress("A ler o anúncio…","A identificar a fonte e preparar a análise.");
    await createAnalysis(url.toString(),url.hostname);

    progress("A ler a página pública…","Sem navegador pago: primeiro tentamos leitura direta e segura.");
    const resp=await fetch("/api/comparador-analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:url.toString()})});
    const reader=await resp.json();
    if(reader.status==="needs_auth"){
      await updateAnalysis({status:"needs_auth",reader,error_message:reader.message});
      q("emptyState").classList.remove("hidden");
      q("emptyState").querySelector("h2").textContent="Esta fonte exige sessão";
      q("emptyState").querySelector("p").textContent="O leitor público não inventa dados. A camada autenticada será ligada separadamente para esta plataforma.";
      toast("A origem exige autenticação.");
      return;
    }
    if(reader.status!=="ok"){
      await updateAnalysis({
        status:"failed",
        reader,
        error_message:reader.message||reader.error||"Falha de leitura",
        source_available:[404,410].includes(Number(reader.http_status))?false:null
      });
      throw new Error(reader.message||"Não foi possível ler o anúncio.");
    }
    renderReaderOnly(reader,url.toString());
    await updateAnalysis({
      status:"searching",
      reader,
      vehicle:{page_title:reader.page?.title||""},
      source_snapshot:reader.page||{},
      source_last_seen_at:new Date().toISOString(),
      source_available:true
    });
    addMsg("assistant","Consegui ler o anúncio. O próximo passo desta V1 é ligar a normalização automática e o radar de comparáveis.");
    await storeMessage("assistant","Consegui ler o anúncio. O próximo passo desta V1 é ligar a normalização automática e o radar de comparáveis.");
  }catch(err){
    q("emptyState").classList.remove("hidden");
    q("emptyState").querySelector("h2").textContent="Não consegui concluir esta leitura";
    q("emptyState").querySelector("p").textContent=String(err?.message||err);
    await updateAnalysis({status:"failed",error_message:String(err?.message||err)});
  }finally{
    stopProgress();q("analyzeBtn").disabled=false;
  }
});

q("chatForm").addEventListener("submit",async ev=>{
  ev.preventDefault();const text=q("chatInput").value.trim();if(!text)return;
  q("chatInput").value="";addMsg("user",text);await storeMessage("user",text);
  const type=ruleType(text);
  const scope=currentVehicle?{
    make:currentVehicle.make||null,model:currentVehicle.model||null,trim:currentVehicle.trim||null,
    year_min:currentVehicle.year||null,year_max:currentVehicle.year||null
  }:{};
  const effect=ruleEffect(text,type);
  const rule={
    rule_type:type,
    statement:text,
    scope,
    effect,
    evidence_level:"observation",
    confidence:.6,
    analysis_id:currentAnalysisId,
    user_id:session.user.id
  };
  const {error}=await db.from("cap_memory_rules").insert(rule);
  if(error){addMsg("assistant","Não consegui guardar esta observação: "+error.message);return}
  const reply=ruleReply(type);addMsg("assistant",reply);await storeMessage("assistant",reply,[{rule_type:type,statement:text,scope,effect}]);
  refreshMemoryCount();
});

db.auth.onAuthStateChange((_event,data)=>{session=data;if(!data)showAuth()});
boot();
