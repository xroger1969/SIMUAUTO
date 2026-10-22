import {calculateTaxSim} from "./tax-simulator-calc.mjs?v=20261022-social-option-v1";

// Os montantes pertencem ao simulador, não à pesquisa de viaturas.
// A "Nova avaliação" nunca os deve substituir nem limpar.
const STORAGE_KEY="aap-tax-sim-v2";
const FIELD_IDS=["taxSimPurchase","taxSimSale","taxSimCosts","taxSimQuarterly","taxSimIrsRate","taxSimSocialEnabled"];
const byId=id=>document.getElementById(id);
const eur=n=>Number(n).toLocaleString("pt-PT",{style:"currency",currency:"EUR"});
function saveState(){
 try{
  const value={};
  FIELD_IDS.forEach(id=>{const el=byId(id);value[id]=el?.type==="checkbox"?el.checked:el?.value??"";});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(value));
 }catch{ /* armazenamento bloqueado: continuar sem guardar */ }
}
function restoreState(){
 try{
  const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
  if(!data||typeof data!=="object")return;
  FIELD_IDS.forEach(id=>{
   const el=byId(id),value=data[id];
   if(el?.type==="checkbox"){if(typeof value==="boolean")el.checked=value;return;}
   if(el&&typeof value==="string"&&(el.tagName!=="SELECT"||[...el.options].some(o=>o.value===value)))el.value=value;
  });
 }catch{ /* sem dados válidos */ }
}
function assessmentAmount(value){
 if(value===null||value===undefined||value==="")return null;
 const amount=Number(value);
 return Number.isFinite(amount)&&amount>=0?amount:null;
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
  const includeSocialSecurity=byId("taxSimSocialEnabled")?.checked===true;
  const r=calculateTaxSim({
   purchase:numberFrom("taxSimPurchase"),sale:numberFrom("taxSimSale"),
   costs:numberFrom("taxSimCosts"),quarterlySales:numberFrom("taxSimQuarterly"),
   irsRate:irs?irs.replace(",","."):null,includeSocialSecurity
  });
  error.hidden=true;error.textContent="";
  const ids={taxSimMargin:r.grossMargin,taxSimVat:r.marginVat,taxSimExpense:r.costs,taxSimSocial:r.socialPerCar,taxSimTaxable:r.taxableIncome,taxSimBeforeIRS:r.beforeIRS};
  Object.entries(ids).forEach(([id,val])=>{byId(id).textContent=eur(val);});
  byId("taxSimIrs").textContent=r.irsEstimate===null?"—":eur(r.irsEstimate);
  byId("taxSimAfterIRS").textContent=r.afterIRS===null?"—":eur(r.afterIRS);
  byId("taxSimSummary").textContent="Margem "+eur(r.grossMargin)+" · IVA "+eur(r.marginVat)+" · "+(includeSocialSecurity?"SS "+eur(r.socialPerCar):"SS não incluída")+" · Despesas "+eur(r.costs);
  const warnings=[];
  if(r.exceedsSimplifiedSingleYearThreshold)warnings.push("Projeção anual superior a 250.000 €: confirmar a obrigatoriedade de contabilidade organizada no ano seguinte.");
  else if(r.requiresAnnualReview)warnings.push("Projeção anual superior a 200.000 €: confirmar o enquadramento fiscal.");
  if(r.socialMonthly>0)warnings.push("SS mensal estimada: "+eur(r.socialMonthly)+".");
  if(r.irsEstimate===null)warnings.push("Para estimar o resultado após IRS, introduz uma taxa. O imposto anual real pode ser diferente.");
  if(r.grossMargin<0)warnings.push("Margem negativa: a venda continua relevante para "+(includeSocialSecurity?"IRS e SS.":"IRS."));
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
 const assessment=globalThis.AutoProAssessment;
 if(!result||result.classList.contains("hidden")||!assessment){showUseError("Conclui uma avaliação primeiro.");return false;}
 if(assessment.tax?.mode==="deductible"){
  showUseError("Esta avaliação usa IVA dedutível. O simulador ENI usa IVA da margem.");return false;
 }
 const purchase=assessmentAmount(assessment.purchase?.currentPrice)??assessmentAmount(assessment.purchase?.effectiveCeiling);
 const sale=assessmentAmount(assessment.market?.saleLikely);
 const fixedCosts=assessmentAmount(assessment.purchase?.fixedCosts),reserve=assessmentAmount(assessment.purchase?.riskReserve);
 if(purchase===null||sale===null||sale<=0||fixedCosts===null||reserve===null){showUseError("Faltam preços ou custos nesta avaliação.");return false;}
 const costs=Math.round((fixedCosts+reserve)*100)/100;
 if([purchase,sale,costs].some(value=>value>10000000)){showUseError("Os valores da avaliação são inválidos.");return false;}
 byId("taxSimPurchase").value=String(purchase);
 byId("taxSimSale").value=String(sale);
 const costField=byId("taxSimCosts");
 costField.value=String(costs);
 costField.title="Custos: "+eur(fixedCosts)+" · Reserva de risco: "+eur(reserve);
 if(costField.dataset){
  costField.dataset.assessmentFixedCosts=String(fixedCosts);
  costField.dataset.assessmentRiskReserve=String(reserve);
 }
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
 const update=()=>{
  if(id==="taxSimCosts"){
   field.title="";
   if(field.dataset){delete field.dataset.assessmentFixedCosts;delete field.dataset.assessmentRiskReserve;}
  }
  render();
 };
 field?.addEventListener("input",update);
 field?.addEventListener("change",update);
});
byId("taxSimUseAssessment")?.addEventListener("click",useAssessmentPrices);
byId("taxSimOpenBtn")?.addEventListener("click",()=>openSimulator(false));
byId("taxSimFromResult")?.addEventListener("click",()=>openSimulator(true));
render();
