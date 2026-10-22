import {calculateTaxSim} from "./tax-simulator-calc.mjs";

// Os montantes pertencem ao simulador, não à pesquisa de viaturas.
// A "Nova avaliação" nunca os deve substituir nem limpar.
const STORAGE_KEY="aap-tax-sim-v2";
const FIELD_IDS=["taxSimPurchase","taxSimSale","taxSimCosts","taxSimQuarterly","taxSimIrsRate"];
const byId=id=>document.getElementById(id);
const eur=n=>Number(n).toLocaleString("pt-PT",{style:"currency",currency:"EUR"});
function saveState(){
 try{
  const value={};
  FIELD_IDS.forEach(id=>{value[id]=byId(id)?.value??"";});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(value));
 }catch{ /* armazenamento bloqueado: continuar sem guardar */ }
}
function restoreState(){
 try{
  const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
  if(!data||typeof data!=="object")return;
  FIELD_IDS.forEach(id=>{
   const el=byId(id),value=data[id];
   if(el&&typeof value==="string"&&(el.tagName!=="SELECT"||[...el.options].some(o=>o.value===value)))el.value=value;
  });
 }catch{ /* sem dados válidos */ }
}
function parseMoney(text){
 const raw=String(text??"").replace(/[^\d,.\-]/g,"");
 if(!raw||raw==="—")return null;
 // O comparador apresenta preços como 22.990 € ou 22.990,00 €.
 const normalized=raw.includes(",")?raw.replace(/\./g,"").replace(",","."):(/^\d{1,3}(?:\.\d{3})+$/.test(raw)?raw.replace(/\./g,""):raw);
 const num=Number(normalized);
 return Number.isFinite(num)&&num>0?num:null;
}
function numberFrom(id){
 const el=byId(id),raw=String(el?.value??"").trim();
 if(!raw)throw Error("Preenche "+(el?.closest("label")?.firstChild?.textContent?.trim()||"o campo")+".");
 const val=Number(raw.replace(",","."));
 if(!Number.isFinite(val))throw Error("Valor inválido.");
 return val;
}
function clearOutputs(){
 ["taxSimMargin","taxSimVat","taxSimExpense","taxSimSocial","taxSimTaxable","taxSimBeforeIRS","taxSimIrs","taxSimAfterIRS"].forEach(id=>{byId(id).textContent="—";});
 byId("taxSimSummary").textContent="—";
 byId("taxSimWarning").textContent="";
}
function render(){
 const error=byId("taxSimError");
 saveState();
 try{
  const irs=byId("taxSimIrsRate").value.trim();
  const r=calculateTaxSim({
   purchase:numberFrom("taxSimPurchase"),sale:numberFrom("taxSimSale"),
   costs:numberFrom("taxSimCosts"),quarterlySales:numberFrom("taxSimQuarterly"),
   irsRate:irs?irs.replace(",","."):null
  });
  error.hidden=true;error.textContent="";
  const ids={taxSimMargin:r.grossMargin,taxSimVat:r.marginVat,taxSimExpense:r.costs,taxSimSocial:r.socialPerCar,taxSimTaxable:r.taxableIncome,taxSimBeforeIRS:r.beforeIRS};
  Object.entries(ids).forEach(([id,val])=>{byId(id).textContent=eur(val);});
  byId("taxSimIrs").textContent=r.irsEstimate===null?"—":eur(r.irsEstimate);
  byId("taxSimAfterIRS").textContent=r.afterIRS===null?"—":eur(r.afterIRS);
  byId("taxSimSummary").textContent="Margem "+eur(r.grossMargin)+" · IVA "+eur(r.marginVat)+" · SS "+eur(r.socialPerCar)+" · Despesas "+eur(r.costs);
  const warnings=[];
  if(r.exceedsSimplifiedSingleYearThreshold)warnings.push("Projeção anual superior a 250.000 €: confirmar a obrigatoriedade de contabilidade organizada no ano seguinte.");
  else if(r.requiresAnnualReview)warnings.push("Projeção anual superior a 200.000 €: confirmar o enquadramento fiscal.");
  if(r.socialMonthly>0)warnings.push("SS mensal estimada: "+eur(r.socialMonthly)+".");
  if(r.irsEstimate===null)warnings.push("Para estimar o resultado após IRS, introduz uma taxa. O imposto anual real pode ser diferente.");
  if(r.grossMargin<0)warnings.push("Margem negativa: a venda continua relevante para IRS e SS.");
  byId("taxSimWarning").textContent=warnings.join(" ");
 }catch(e){
  clearOutputs();
  error.hidden=false;
  error.textContent=e.message||"Verifica os valores.";
 }
}
function showUseError(message){
 const error=byId("taxSimError");
 error.hidden=false;
 error.textContent=message;
}
function useAssessmentPrices(){
 const result=byId("result");
 if(!result||result.classList.contains("hidden")){showUseError("Conclui uma avaliação primeiro.");return false;}
 const purchase=parseMoney(byId("currentPrice")?.textContent),sale=parseMoney(byId("commercialSale")?.textContent);
 if(purchase===null||sale===null){showUseError("Faltam preços confirmados nesta avaliação.");return false;}
 byId("taxSimPurchase").value=String(purchase);
 byId("taxSimSale").value=String(sale);
 render();
 return true;
}
function openSimulator(useAssessment=false){
 const panel=byId("taxSimulator");panel.open=true;
 if(useAssessment)useAssessmentPrices();
 panel.scrollIntoView({behavior:"smooth",block:"start"});
}
restoreState();
FIELD_IDS.forEach(id=>{
 const field=byId(id);
 field?.addEventListener("input",render);
 field?.addEventListener("change",render);
});
byId("taxSimUseAssessment")?.addEventListener("click",useAssessmentPrices);
byId("taxSimOpenBtn")?.addEventListener("click",()=>openSimulator(false));
byId("taxSimFromResult")?.addEventListener("click",()=>openSimulator(true));
render();
