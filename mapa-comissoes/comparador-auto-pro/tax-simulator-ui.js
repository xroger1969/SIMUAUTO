import {calculateTaxSim} from "./tax-simulator-calc.mjs";
const byId=id=>document.getElementById(id);
const eur=value=>Number(value).toLocaleString("pt-PT",{style:"currency",currency:"EUR"});
const parseEuroText=text=>{
 const raw=String(text||"").replace(/[^\d,.-]/g,"").trim();
 if(!raw||raw==="—")return null;
 const compact=raw.replace(/\s/g,"").replace(/\./g,"").replace(",",".");
 const value=Number(compact);
 return Number.isFinite(value)&&value>0?value:null;
};
const numeric=id=>{
 const el=byId(id),raw=el?.value??"";
 if(raw.trim()==="")throw new Error("Preenche o campo "+(el?.closest("label")?.firstChild?.textContent||id)+".");
 const n=Number(raw.replace(",","."));
 if(!Number.isFinite(n))throw new Error("Verifica o valor de "+id+".");
 return n;
};
function render(){
 const error=byId("taxSimError");
 try{
  const rateInput=byId("taxSimIrsRate").value.trim();
  const r=calculateTaxSim({purchase:numeric("taxSimPurchase"),sale:numeric("taxSimSale"),costs:numeric("taxSimCosts"),quarterlySales:numeric("taxSimQuarterly"),irsRate:rateInput===""?null:rateInput.replace(",",".")});
  error.hidden=true;error.textContent="";
  const values={taxSimMargin:r.grossMargin,taxSimVat:r.marginVat,taxSimExpense:r.costs,taxSimSocial:r.socialPerCar,taxSimTaxable:r.taxableIncome,taxSimBeforeIRS:r.beforeIRS};
  for(const [id,value] of Object.entries(values))byId(id).textContent=eur(value);
  byId("taxSimIrs").textContent=r.irsEstimate===null?"Por configurar":eur(r.irsEstimate);
  byId("taxSimAfterIRS").textContent=r.afterIRS===null?"Por configurar":eur(r.afterIRS);
  let alerts=[];
  if(r.exceedsSimplifiedSingleYearThreshold)alerts.push("Atenção: mantendo "+r.projectedAnnualVehicles+" vendas anuais de valor semelhante, a faturação projetada supera 250.000 €. Verifica a passagem a contabilidade organizada no próximo ano.");
  else if(r.requiresAnnualReview)alerts.push("Faturação anual projetada acima de 200.000 €: revê a permanência no regime simplificado com o contabilista.");
  if(r.socialMonthly>0)alerts.push("Com este ritmo, SS estimada de "+eur(r.socialMonthly)+"/mês no trimestre contributivo correspondente; imputação média de "+eur(r.socialPerCar)+" por carro.");
  else alerts.push("Neste cenário trimestral, a isenção de SS por acumulação poderá manter-se se os demais requisitos forem cumpridos.");
  if(r.irsEstimate===null)alerts.push("IRS não apurado: abre «Estimar IRS e ver critérios fiscais» e introduz uma taxa de referência.");
  if(r.grossMargin<0)alerts.push("Venda abaixo da compra: IVA da margem a 0 €, mas a receita da venda continua a entrar no IRS e na Segurança Social.");
  byId("taxSimWarning").textContent=alerts.join(" ");
 }catch(e){
  error.textContent=e.message;error.hidden=false;
  ["taxSimMargin","taxSimVat","taxSimExpense","taxSimSocial","taxSimTaxable","taxSimBeforeIRS","taxSimIrs","taxSimAfterIRS"].forEach(id=>byId(id).textContent="—");
  byId("taxSimWarning").textContent="";
 }
}
function useCurrentAssessment(){
 const root=byId("result");
 if(!root||root.classList.contains("hidden")){byId("taxSimSource").textContent="Faz uma avaliação primeiro ou introduz os valores manualmente.";return;}
 const buy=parseEuroText(byId("currentPrice")?.textContent);
 const sale=parseEuroText(byId("commercialSale")?.textContent);
 if(buy===null||sale===null){byId("taxSimSource").textContent="Sem preços reais suficientes nesta avaliação; não foram inventados valores.";return;}
 byId("taxSimPurchase").value=String(buy);
 byId("taxSimSale").value=String(sale);
 byId("taxSimSource").textContent="Compra = preço atual; venda = revenda estimada do mercado. Confirma-os antes de negociar.";
 render();
}
function openCalculator(withEvaluation=false){
 const panel=byId("taxSimulator");panel.open=true;
 if(withEvaluation)useCurrentAssessment();
 panel.scrollIntoView({behavior:"smooth",block:"start"});
}
for(const id of ["taxSimPurchase","taxSimSale","taxSimCosts","taxSimQuarterly","taxSimIrsRate"]){
 byId(id)?.addEventListener("input",render);
 byId(id)?.addEventListener("change",render);
}
byId("taxSimUseAssessment")?.addEventListener("click",useCurrentAssessment);
byId("taxSimOpenBtn")?.addEventListener("click",()=>openCalculator(false));
byId("taxSimFromResult")?.addEventListener("click",()=>openCalculator(true));
render();
