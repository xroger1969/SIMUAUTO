import {calculateTaxSim} from "./tax-simulator-calc.mjs?v=20261104-costs-v1";

// Só as preferências fiscais persistem entre pesquisas. Os montantes acompanham
// a avaliação visível e deixam de existir quando se inicia outra pesquisa.
const STORAGE_KEY="aap-tax-sim-v2";
const DEAL_FIELD_IDS=["taxSimPurchase","taxSimSale","taxSimCosts","taxSimReserve"];
const PREFERENCE_IDS=["taxSimQuarterly","taxSimIrsRate","taxSimSocialEnabled","taxSimAnnualSales","taxSimGrossSalary"];
const FIELD_IDS=[...DEAL_FIELD_IDS,...PREFERENCE_IDS];
let syncedAssessment;
const byId=id=>document.getElementById(id);
const eur=n=>Number(n).toLocaleString("pt-PT",{style:"currency",currency:"EUR"});
function saveState(){
 try{
  const value={};
  PREFERENCE_IDS.forEach(id=>{const el=byId(id);value[id]=el?.type==="checkbox"?el.checked:el?.value??"";});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(value));
 }catch{ /* armazenamento bloqueado: continuar sem guardar */ }
}
function restoreState(){
 try{
  const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
  if(!data||typeof data!=="object")return;
  PREFERENCE_IDS.forEach(id=>{
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
 ["taxSimAfterReserve","taxSimMargin","taxSimVat","taxSimExpense","taxSimSocial","taxSimTaxable","taxSimBeforeIRS","taxSimIrs","taxSimAfterIRS"].forEach(id=>{byId(id).textContent="—";});
 byId("taxSimSummary").textContent="—";
 byId("taxSimWarning").textContent="";
}
function clearCostSource(){
 const field=byId("taxSimCosts");
 field.title="";
 if(field.dataset){delete field.dataset.assessmentFixedCosts;delete field.dataset.assessmentRiskReserve;}
}
function clearDeal(){
 DEAL_FIELD_IDS.forEach(id=>{byId(id).value=["taxSimCosts","taxSimReserve"].includes(id)?"0":"";});
 clearCostSource();
 clearOutputs();
 const error=byId("taxSimError");
 error.hidden=true;error.textContent="";
 saveState();
}
function render(){
 const error=byId("taxSimError");
 saveState();
 if(["taxSimPurchase","taxSimSale"].every(id=>!byId(id).value.trim())){
  clearOutputs();error.hidden=true;error.textContent="";return;
 }
 try{
  const irs=byId("taxSimIrsRate").value.trim();
  const includeSocialSecurity=byId("taxSimSocialEnabled")?.checked===true;
  const r=calculateTaxSim({
   purchase:numberFrom("taxSimPurchase"),sale:numberFrom("taxSimSale"),
   costs:numberFrom("taxSimCosts"),reserve:numberFrom("taxSimReserve"),quarterlySales:numberFrom("taxSimQuarterly"),
   irsRate:irs?irs.replace(",","."):null,includeSocialSecurity,automaticIRS:true,
   annualSales:byId("taxSimAnnualSales")?numberFrom("taxSimAnnualSales"):10,
   monthlyGrossSalary:byId("taxSimGrossSalary")?numberFrom("taxSimGrossSalary"):730
  });
  error.hidden=true;error.textContent="";
  const ids={taxSimMargin:r.grossMargin,taxSimVat:r.marginVat,taxSimExpense:r.costs,taxSimSocial:r.socialPerCar,taxSimTaxable:r.taxableIncome,taxSimBeforeIRS:r.beforeIRS};
  Object.entries(ids).forEach(([id,val])=>{byId(id).textContent=eur(val);});
  byId("taxSimIrs").textContent=r.irsEstimate===null?"—":eur(r.irsEstimate);
  byId("taxSimAfterReserve").textContent=r.afterReserve===null?"—":eur(r.afterReserve);
  byId("taxSimAfterIRS").textContent=r.afterIRS===null?"—":eur(r.afterIRS);
  byId("taxSimSummary").textContent="Margem "+eur(r.grossMargin)+" · IVA "+eur(r.marginVat)+" · "+(includeSocialSecurity?"SS "+eur(r.socialPerCar):"SS não incluída")+" · Despesas "+eur(r.costs)+" · Reserva "+eur(r.reserve);
  const warnings=[];
  if(r.exceedsSimplifiedSingleYearThreshold)warnings.push("Projeção anual superior a 250.000 €: confirmar a obrigatoriedade de contabilidade organizada no ano seguinte.");
  else if(r.requiresAnnualReview)warnings.push("Projeção anual superior a 200.000 €: confirmar o enquadramento fiscal.");
  if(r.socialMonthly>0)warnings.push("SS mensal estimada: "+eur(r.socialMonthly)+".");
  if(r.irsMethod==="progressive-estimate")warnings.push("IRS automático: "+r.effectiveIRSRate.toLocaleString("pt-PT")+"% sobre a base tributável. Cenário individual, antes das deduções do agregado.");
  if(!includeSocialSecurity&&r.relevantMonthly>=r.exemptLimit)warnings.push("Sem isenção automática neste cenário: o rendimento relevante excede 4 IAS. Confirma a opção de SS.");
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
 if(purchase===null||sale===null||sale<=0){showUseError("Faltam preços nesta avaliação.");return false;}
 if([purchase,sale].some(value=>value>10000000)){showUseError("Os valores da avaliação são inválidos.");return false;}
 byId("taxSimPurchase").value=String(purchase);
 byId("taxSimSale").value=String(sale);
 byId("taxSimCosts").value="0";
 byId("taxSimReserve").value="0";
 clearCostSource();
 render();
 return true;
}
function syncAssessment(){
 const assessment=globalThis.AutoProAssessment||null;
 // A simples abertura do painel ou repetição do mesmo resultado não deve
 // substituir os ajustes manuais feitos neste negócio.
 if(assessment&&assessment===syncedAssessment)return;
 syncedAssessment=assessment;
 clearDeal();
 if(assessment){
  if(useAssessmentPrices()&&assessment.tax_simulation?.fields){
   const saved=assessment.tax_simulation.fields;
   FIELD_IDS.forEach(id=>{const el=byId(id);if(el&&typeof saved[id]==="string")el.value=saved[id];else if(el?.type==="checkbox"&&typeof saved[id]==="boolean")el.checked=saved[id];});
   render();
  }
 }
 byId("taxSimSaveStatus").textContent="";
}
function openSimulator(useAssessment=false){
 const panel=byId("taxSimulator");panel.open=true;
 if(useAssessment)useAssessmentPrices();
 panel.scrollIntoView({behavior:"smooth",block:"start"});
}
globalThis.AutoProTaxSimulation={snapshot(){
 const fields={};
 FIELD_IDS.forEach(id=>{const el=byId(id);fields[id]=el?.type==="checkbox"?el.checked:el?.value??"";});
 return {version:1,fields};
}};
byId("taxSimSave")?.addEventListener("click",async()=>{
 render();
 if(!byId("taxSimError").hidden)return;
 const status=byId("taxSimSaveStatus"),button=byId("taxSimSave");
 button.disabled=true;status.textContent="A guardar…";
 try{
  if(!globalThis.saveAutoProTaxSimulation)throw Error("Conclui uma avaliação primeiro.");
  const saved=await globalThis.saveAutoProTaxSimulation(globalThis.AutoProTaxSimulation.snapshot());
  status.textContent=saved?"Ajustes guardados no histórico.":"Por guardar. Usa Repetir gravação do histórico.";
 }catch(error){status.textContent=error.message;}
 finally{button.disabled=false;}
});
restoreState();
FIELD_IDS.forEach(id=>{
 const field=byId(id);
 const update=()=>{
  if(id==="taxSimCosts")clearCostSource();
  render();
 };
 field?.addEventListener("input",update);
 field?.addEventListener("change",update);
});
byId("taxSimUseAssessment")?.addEventListener("click",useAssessmentPrices);
byId("taxSimOpenBtn")?.addEventListener("click",()=>openSimulator(false));
byId("taxSimFromResult")?.addEventListener("click",()=>openSimulator(true));
globalThis.addEventListener("autopro:assessment-change",syncAssessment);
// Também funciona se a avaliação tiver terminado antes deste módulo carregar.
syncAssessment();

