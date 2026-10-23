import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {calculateTaxSim} from "./tax-simulator-calc.mjs";

const source=readFileSync(new URL("./tax-simulator-ui.js",import.meta.url),"utf8").replace(/^import [^\n]+\n/,"");
const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
const eur=n=>n.toLocaleString("pt-PT",{style:"currency",currency:"EUR"});

function boot(storage=new Map(),shown=true,assessment=null){
 const data={taxSimPurchase:"",taxSimSale:"",taxSimCosts:"",taxSimQuarterly:"3",taxSimIrsRate:"",taxSimAnnualSales:"10",taxSimGrossSalary:"730"};
 const elements={},events=new EventTarget();
 function create(id,value=""){
  const el={id,value,type:id==="taxSimSocialEnabled"?"checkbox":"text",checked:false,textContent:"",hidden:false,open:false,title:"",dataset:{},listeners:{},tagName:id==="taxSimQuarterly"?"SELECT":"INPUT",
   options:[{value:"1"},{value:"2"},{value:"3"},{value:"4"},{value:"6"}],
   classList:{contains:classname=>classname==="hidden"?!shown:false},
   addEventListener:(name,callback)=>{el.listeners[name]=callback;},
   closest:()=>({firstChild:{textContent:id}}),
   scrollIntoView:()=>{}};
  elements[id]=el;return el;
 }
 for(const [id,value] of Object.entries(data))create(id,value);
 for(const id of ["taxSimSocialEnabled","taxSimMargin","taxSimVat","taxSimExpense","taxSimSocial","taxSimTaxable","taxSimBeforeIRS","taxSimAfterIRS","taxSimIrs","taxSimSummary","taxSimWarning","taxSimError","taxSimUseAssessment","taxSimOpenBtn","taxSimFromResult","taxSimulator","result","currentPrice","commercialSale"])create(id);
 const context={calculateTaxSim,AutoProAssessment:assessment,document:{getElementById:id=>elements[id]||null},
  addEventListener:events.addEventListener.bind(events),
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}};
 vm.runInNewContext(source,context,{filename:"tax-simulator-ui.js"});
 return {elements,storage,
  setAssessment(value,{visible=value!==null,emit=true}={}){
   context.AutoProAssessment=value;shown=visible;
   if(emit)events.dispatchEvent(new Event("autopro:assessment-change"));
  },
  trigger:(id,name)=>elements[id].listeners[name]?.()};
}
const assessment=(overrides={})=>({
 subject:{make:"Peugeot",model:"3008",registration:"AA-00-AA"},
 purchase:{currentPrice:19600.45,effectiveCeiling:20100,fixedCosts:2710,riskReserve:190},
 market:{saleLikely:22990.80},tax:{mode:"gross",vatRate:.23},
 // These costs and import are already included in fixedCosts, never sum them twice.
 parameters:{costs:{auction_fee:100,transport:120,registration:90,warranty_reserve:350,stock_finance:200,other:50,reconditioning:600}},
 reconditioning:{appliedGross:600},
 ...overrides
});
function enterDeal(app,{purchase=19600,sale=22990,costs=500}={}){
 app.elements.taxSimPurchase.value=String(purchase);
 app.elements.taxSimSale.value=String(sale);
 app.elements.taxSimCosts.value=String(costs);
 app.trigger("taxSimCosts","input");
}
function assertEmptyDeal(app){
 for(const id of ["taxSimPurchase","taxSimSale","taxSimCosts"])assert.equal(app.elements[id].value,"",id);
 for(const id of ["taxSimMargin","taxSimVat","taxSimExpense","taxSimSocial","taxSimTaxable","taxSimBeforeIRS","taxSimIrs","taxSimAfterIRS","taxSimSummary"])assert.equal(app.elements[id].textContent,"—",id);
 assert.equal(app.elements.taxSimCosts.title,"");
 assert.equal(app.elements.taxSimCosts.dataset.assessmentFixedCosts,undefined);
 assert.equal(app.elements.taxSimCosts.dataset.assessmentRiskReserve,undefined);
 assert.equal(app.elements.taxSimWarning.textContent,"");
}

test("interface compacta: 4 campos, 2 resultados, sem preços de exemplo e detalhes recolhidos",()=>{
 const start=html.indexOf('<details class="tax-simulator"');
 const end=html.indexOf('class="progress-panel',start);
 const section=html.slice(start,end);
 assert.equal((section.match(/class="tax-sim-fields"/g)||[]).length,1);
 assert.equal((section.match(/id="taxSim(?:Purchase|Sale|Costs|Quarterly)"/g)||[]).length,4);
 assert.equal((section.match(/class="tax-sim-principal(?: secondary)?"/g)||[]).length,2);
 assert.match(section,/id="taxSimSummary"/);
 assert.match(section,/<details class="tax-sim-details"/);
 assert.doesNotMatch(section,/<details\b[^>]*\bopen(?:[\s=>])/);
 assert.doesNotMatch(section,/<p class="tax-sim-intro"/);
 assert.doesNotMatch(section,/<small>Comissões,/);
 for(const id of ["taxSimPurchase","taxSimSale","taxSimCosts"]){
  const input=section.match(new RegExp('<input\\b[^>]*id="'+id+'"[^>]*>'))?.[0];
  assert.ok(input,id);assert.doesNotMatch(input,/\bvalue="[^\"]+"/);
 }
});

test("arranca vazio, sem lucro anterior nem erro, mesmo ao ajustar preferências",()=>{
 const app=boot();
 assertEmptyDeal(app);assert.equal(app.elements.taxSimError.hidden,true);
 app.elements.taxSimIrsRate.value="25";app.trigger("taxSimIrsRate","input");
 app.trigger("taxSimOpenBtn","click");
 assertEmptyDeal(app);assert.equal(app.elements.taxSimError.hidden,true);
 assert.equal(app.elements.taxSimulator.open,true);
});

test("nova avaliação Ford substitui automaticamente a simulação antiga, sem tocar em Usar avaliação",()=>{
 const app=boot();enterDeal(app);
 const priorProfit=app.elements.taxSimAfterIRS.textContent;
 assert.notEqual(priorProfit,"—");
 // Prices reproduce the report; the costs below are explicit test fixtures.
 const ford=assessment({subject:{make:"Ford",model:"Puma",registration:"BT-36-ZE"},
  purchase:{currentPrice:null,effectiveCeiling:16943,fixedCosts:1200,riskReserve:200},market:{saleLikely:23081}});
 app.setAssessment(ford);
 assert.equal(app.elements.taxSimPurchase.value,"16943");
 assert.equal(app.elements.taxSimSale.value,"23081");
 assert.equal(app.elements.taxSimCosts.value,"1400");
 assert.equal(app.elements.taxSimMargin.textContent,eur(6138));
 assert.equal(app.elements.taxSimExpense.textContent,eur(1400));
 assert.notEqual(app.elements.taxSimAfterIRS.textContent,priorProfit);
 assert.notEqual(app.elements.taxSimAfterIRS.textContent,"—");
 assert.equal(app.elements.taxSimError.hidden,true);
 assert.equal(app.elements.taxSimulator.open,false,"a atualização não abre o painel");
});

test("nova pesquisa limpa o negócio imediatamente e preserva apenas as preferências fiscais",()=>{
 const storage=new Map(),app=boot(storage,true,assessment());
 const values={taxSimQuarterly:"4",taxSimIrsRate:"25",taxSimAnnualSales:"8",taxSimGrossSalary:"900"};
 for(const [id,value] of Object.entries(values)){app.elements[id].value=value;app.trigger(id,"change");}
 app.elements.taxSimSocialEnabled.checked=true;app.trigger("taxSimSocialEnabled","change");
 app.setAssessment(null);
 assertEmptyDeal(app);assert.equal(app.elements.taxSimError.hidden,true);
 for(const [id,value] of Object.entries(values))assert.equal(app.elements[id].value,value);
 assert.equal(app.elements.taxSimSocialEnabled.checked,true);
 const saved=JSON.parse(storage.get("aap-tax-sim-v2"));
 assert.deepEqual(saved,{...values,taxSimSocialEnabled:true});
 const reopened=boot(storage,false);
 assertEmptyDeal(reopened);assert.equal(reopened.elements.taxSimError.hidden,true);
 for(const [id,value] of Object.entries(values))assert.equal(reopened.elements[id].value,value);
 assert.equal(reopened.elements.taxSimSocialEnabled.checked,true);
});

test("reset também limpa uma simulação manual que nunca teve avaliação associada",()=>{
 const app=boot();enterDeal(app);
 app.setAssessment(null);assertEmptyDeal(app);
 enterDeal(app,{purchase:17000,sale:21000,costs:350});
 app.setAssessment(null);assertEmptyDeal(app);
 assert.equal(app.elements.taxSimError.hidden,true);
});

test("importa preços estruturados sem perder cêntimos nem duplicar despesas, mesmo se o módulo carrega depois da avaliação",()=>{
 const app=boot(new Map(),true,assessment());
 assert.equal(app.elements.taxSimPurchase.value,"19600.45");
 assert.equal(app.elements.taxSimSale.value,"22990.8");
 assert.equal(app.elements.taxSimCosts.value,"2900");
 // A rounded or stale display is not a source for the fiscal calculation.
 app.elements.currentPrice.textContent="19.600 €";app.elements.commercialSale.textContent="22.991 €";
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"19600.45");
 assert.equal(app.elements.taxSimSale.value,"22990.8");
 assert.equal(app.elements.taxSimCosts.value,"2900");
 assert.equal(app.elements.taxSimCosts.dataset.assessmentFixedCosts,"2710");
 assert.equal(app.elements.taxSimCosts.dataset.assessmentRiskReserve,"190");
 assert.match(app.elements.taxSimCosts.title,/Reserva de risco/);
 assert.equal(app.elements.taxSimMargin.textContent,eur(3390.35));
 assert.equal(app.elements.taxSimExpense.textContent,eur(2900));
});

test("sem preço atual usa o teto e a avaliação seguinte substitui custos antigos por zero",()=>{
 const app=boot(new Map(),true,assessment({purchase:{currentPrice:null,effectiveCeiling:18500,fixedCosts:900,riskReserve:100}}));
 assert.equal(app.elements.taxSimPurchase.value,"18500");assert.equal(app.elements.taxSimCosts.value,"1000");
 app.setAssessment(assessment({purchase:{currentPrice:17000,effectiveCeiling:18000,fixedCosts:0,riskReserve:0}}));
 assert.equal(app.elements.taxSimPurchase.value,"17000");assert.equal(app.elements.taxSimCosts.value,"0");
 assert.equal(app.elements.taxSimCosts.dataset.assessmentRiskReserve,"0");
});

test("preços zero válidos não são confundidos com campos nulos ou não finitos",()=>{
 for(const currentPrice of [null,undefined,NaN,""]){
  const app=boot(new Map(),true,assessment({purchase:{currentPrice,effectiveCeiling:0,fixedCosts:0,riskReserve:0}}));
  assert.equal(app.elements.taxSimPurchase.value,"0");assert.equal(app.elements.taxSimError.hidden,true);
 }
 const app=boot(new Map(),true,assessment({purchase:{currentPrice:0,effectiveCeiling:500,fixedCosts:0,riskReserve:0}}));
 assert.equal(app.elements.taxSimPurchase.value,"0");
});

test("uma nova avaliação incompleta ou inválida limpa os valores antigos, sem importação parcial",()=>{
 for(const invalid of [
  {market:{saleLikely:null}}, {market:{saleLikely:NaN}}, {market:{saleLikely:0}}, {market:{saleLikely:10000001}},
  {purchase:{currentPrice:18000,effectiveCeiling:20000,fixedCosts:null,riskReserve:10}},
  {purchase:{currentPrice:null,effectiveCeiling:null,fixedCosts:100,riskReserve:10}},
  {purchase:{currentPrice:18000,effectiveCeiling:20000,fixedCosts:100,riskReserve:NaN}}
 ]){
  const app=boot(new Map(),true,assessment());
  assert.notEqual(app.elements.taxSimAfterIRS.textContent,"—");
  app.setAssessment(assessment(invalid));
  assertEmptyDeal(app);assert.equal(app.elements.taxSimError.hidden,false);
  assert.match(app.elements.taxSimError.textContent,/Faltam preços ou custos|valores da avaliação são inválidos/);
 }
});

test("IVA dedutível não é convertido em IVA da margem nem conserva o lucro do carro anterior",()=>{
 const app=boot(new Map(),true,assessment());
 app.setAssessment(assessment({tax:{mode:"deductible",vatRate:.23}}));
 assertEmptyDeal(app);assert.equal(app.elements.taxSimError.hidden,false);
 assert.match(app.elements.taxSimError.textContent,/IVA dedutível.*IVA da margem/);
});

test("ajustes manuais sobrevivem ao mesmo resultado, abertura do painel e alterações fiscais; Usar avaliação repõe-os",()=>{
 const current=assessment(),app=boot(new Map(),true,current);
 enterDeal(app,{purchase:18350,sale:23500,costs:750});
 assert.equal(app.elements.taxSimCosts.title,"");
 assert.equal(app.elements.taxSimCosts.dataset.assessmentRiskReserve,undefined);
 const profit=app.elements.taxSimAfterIRS.textContent;
 app.setAssessment(current);app.trigger("taxSimOpenBtn","click");
 assert.equal(app.elements.taxSimAfterIRS.textContent,profit);
 app.elements.taxSimIrsRate.value="25";app.trigger("taxSimIrsRate","input");
 app.elements.taxSimSocialEnabled.checked=true;app.trigger("taxSimSocialEnabled","change");
 assert.equal(app.elements.taxSimPurchase.value,"18350");assert.equal(app.elements.taxSimSale.value,"23500");assert.equal(app.elements.taxSimCosts.value,"750");
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"19600.45");assert.equal(app.elements.taxSimSale.value,"22990.8");assert.equal(app.elements.taxSimCosts.value,"2900");
 assert.equal(app.elements.taxSimIrsRate.value,"25");assert.equal(app.elements.taxSimSocialEnabled.checked,true);
});

test("nova avaliação da mesma matrícula e abertura de outro resultado histórico substituem os ajustes",()=>{
 const first=assessment(),app=boot(new Map(),true,first);enterDeal(app,{purchase:18350});
 const updated=assessment({market:{saleLikely:24000},purchase:{currentPrice:19000,effectiveCeiling:20500,fixedCosts:800,riskReserve:200}});
 assert.equal(updated.subject.registration,first.subject.registration);
 app.setAssessment(updated);
 assert.equal(app.elements.taxSimPurchase.value,"19000");assert.equal(app.elements.taxSimSale.value,"24000");assert.equal(app.elements.taxSimCosts.value,"1000");
 app.setAssessment(first);
 assert.equal(app.elements.taxSimPurchase.value,"19600.45");assert.equal(app.elements.taxSimSale.value,"22990.8");assert.equal(app.elements.taxSimCosts.value,"2900");
});

test("sem avaliação, Usar avaliação avisa sem substituir uma simulação manual",()=>{
 const app=boot(new Map(),false);enterDeal(app,{purchase:17100});
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"17100");assert.equal(app.elements.taxSimSale.value,"22990");assert.equal(app.elements.taxSimCosts.value,"500");
 assert.equal(app.elements.taxSimError.hidden,false);assert.match(app.elements.taxSimError.textContent,/Conclui uma avaliação/);
});

test("mostra apenas resumo numa linha e mantém o detalhe fiscal disponível",()=>{
 const app=boot();enterDeal(app);
 for(const label of [/Margem/,/IVA/,/SS/,/Despesas/])assert.match(app.elements.taxSimSummary.textContent,label);
 assert.ok(app.elements.taxSimSocial.textContent.includes("€"));assert.notEqual(app.elements.taxSimAfterIRS.textContent,"—");
});

test("valores manuais inválidos não exibem lucro incorreto",()=>{
 const app=boot();enterDeal(app);
 app.elements.taxSimSale.value="";app.trigger("taxSimSale","input");
 assert.equal(app.elements.taxSimError.hidden,false);assert.equal(app.elements.taxSimBeforeIRS.textContent,"—");assert.equal(app.elements.taxSimAfterIRS.textContent,"—");
});

test("a opção visível começa desligada e recalcula apenas a contribuição da Segurança Social",()=>{
 assert.match(html,/<label[^>]*for="taxSimSocialEnabled"[^>]*><input id="taxSimSocialEnabled" type="checkbox">Incluir Segurança Social<\/label>/);
 const app=boot(),e=app.elements;
 e.taxSimPurchase.value="33990";e.taxSimSale.value="36035";e.taxSimCosts.value="1416";e.taxSimIrsRate.value="20";
 app.trigger("taxSimIrsRate","input");
 assert.equal(e.taxSimSocialEnabled.checked,false);assert.equal(e.taxSimSocial.textContent,eur(0));
 assert.equal(e.taxSimBeforeIRS.textContent,eur(246.6));assert.equal(e.taxSimAfterIRS.textContent,eur(-822.98));
 assert.match(e.taxSimSummary.textContent,/SS não incluída/);assert.doesNotMatch(e.taxSimWarning.textContent,/SS mensal estimada/);
 const vat=e.taxSimVat.textContent,taxable=e.taxSimTaxable.textContent,irs=e.taxSimIrs.textContent;
 e.taxSimSocialEnabled.checked=true;app.trigger("taxSimSocialEnabled","change");
 assert.equal(e.taxSimSocial.textContent,eur(1255.46));assert.equal(e.taxSimBeforeIRS.textContent,eur(-1008.86));assert.equal(e.taxSimAfterIRS.textContent,eur(-2078.44));
 assert.equal(e.taxSimVat.textContent,vat);assert.equal(e.taxSimTaxable.textContent,taxable);assert.equal(e.taxSimIrs.textContent,irs);assert.match(e.taxSimWarning.textContent,/SS mensal estimada/);
 e.taxSimSocialEnabled.checked=false;app.trigger("taxSimSocialEnabled","change");
 assert.equal(e.taxSimSocial.textContent,eur(0));assert.equal(e.taxSimBeforeIRS.textContent,eur(246.6));assert.equal(e.taxSimCosts.value,"1416");
});

test("a escolha da Segurança Social persiste ao recarregar e entre avaliações",()=>{
 const storage=new Map();let app=boot(storage,true,assessment());
 app.elements.taxSimSocialEnabled.checked=true;app.trigger("taxSimSocialEnabled","change");
 app=boot(storage,false);
 assert.equal(app.elements.taxSimSocialEnabled.checked,true);assert.ok(JSON.parse(storage.get("aap-tax-sim-v2")).taxSimSocialEnabled);
 app.setAssessment(assessment());assert.equal(app.elements.taxSimSocialEnabled.checked,true);
 app.elements.taxSimSocialEnabled.checked=false;app.trigger("taxSimSocialEnabled","change");
 app=boot(storage);assert.equal(app.elements.taxSimSocialEnabled.checked,false);
});

test("migra dados antigos preservando preferências, descartando montantes e sem coerção textual da Segurança Social",()=>{
 for(const flag of [undefined,"false","true"]){
  const storage=new Map([["aap-tax-sim-v2",JSON.stringify({taxSimPurchase:"19600",taxSimSale:"22990",taxSimCosts:"500",taxSimIrsRate:"25",taxSimQuarterly:"4",taxSimSocialEnabled:flag})]]);
  const app=boot(storage);assertEmptyDeal(app);
  assert.equal(app.elements.taxSimIrsRate.value,"25");assert.equal(app.elements.taxSimQuarterly.value,"4");assert.equal(app.elements.taxSimSocialEnabled.checked,false);
  const saved=JSON.parse(storage.get("aap-tax-sim-v2"));
  assert.equal(saved.taxSimPurchase,undefined);assert.equal(saved.taxSimSale,undefined);assert.equal(saved.taxSimCosts,undefined);
 }
});
