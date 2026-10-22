import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {calculateTaxSim} from "./tax-simulator-calc.mjs";

const source=readFileSync(new URL("./tax-simulator-ui.js",import.meta.url),"utf8").replace(/^import [^\n]+\n/,"");
const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");

function boot(storage=new Map(),shown=true,assessment=null){
 const data={taxSimPurchase:"19600",taxSimSale:"22990",taxSimCosts:"500",taxSimQuarterly:"3",taxSimIrsRate:""};
 const elements={};
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
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}};
 vm.runInNewContext(source,context,{filename:"tax-simulator-ui.js"});
 return {elements,storage,setAssessment:value=>{context.AutoProAssessment=value;},trigger:(id,name)=>elements[id].listeners[name]?.()};
}
const assessment=(overrides={})=>({
 purchase:{currentPrice:19600.45,effectiveCeiling:20100,fixedCosts:2710,riskReserve:190},
 market:{saleLikely:22990.80},tax:{mode:"gross",vatRate:.23},
 // These costs and import are already included in fixedCosts, never sum them twice.
 parameters:{costs:{auction_fee:100,transport:120,registration:90,warranty_reserve:350,stock_finance:200,other:50,reconditioning:600}},
 reconditioning:{appliedGross:600},
 ...overrides
});

test("interface compacta: 4 campos, 2 resultados e detalhes recolhidos",()=>{
 const start=html.indexOf('<details class="tax-simulator"');
 const end=html.indexOf('class="progress-panel',start);
 const section=html.slice(start,end);
 assert.equal((section.match(/class="tax-sim-fields"/g)||[]).length,1);
 assert.equal((section.match(/id="taxSim(?:Purchase|Sale|Costs|Quarterly)"/g)||[]).length,4);
 assert.equal((section.match(/class="tax-sim-principal(?: secondary)?"/g)||[]).length,2);
 assert.match(section,/id="taxSimSummary"/);
 assert.match(section,/<details class="tax-sim-details"/);
 assert.doesNotMatch(section,/<p class="tax-sim-intro"/);
 assert.doesNotMatch(section,/<small>Comissões,/);
});

test("os campos e a taxa de IRS sobrevivem a uma nova avaliação e ao recarregamento",()=>{
 const storage=new Map();
 let app=boot(storage);
 app.elements.taxSimPurchase.value="18350";
 app.trigger("taxSimPurchase","input");
 app.elements.taxSimIrsRate.value="25";
 app.trigger("taxSimIrsRate","input");
 assert.equal(app.elements.taxSimPurchase.value,"18350");
 assert.notEqual(app.elements.taxSimAfterIRS.textContent,"—");
 // A nova avaliação esconde o resultado, mas não deve alterar o simulador.
 app.elements.result.classList.contains=()=>true;
 app=boot(storage,false);
 assert.equal(app.elements.taxSimPurchase.value,"18350");
 assert.equal(app.elements.taxSimIrsRate.value,"25");
 assert.notEqual(app.elements.taxSimAfterIRS.textContent,"—");
});

test("importa preços e todos os custos estruturados sem perder cêntimos nem duplicar despesas",()=>{
 const app=boot(new Map(),true,assessment());
 // A rounded or stale display is not a source for the fiscal calculation.
 app.elements.currentPrice.textContent="19.600 €";
 app.elements.commercialSale.textContent="22.991 €";
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"19600.45");
 assert.equal(app.elements.taxSimSale.value,"22990.8");
 assert.equal(app.elements.taxSimCosts.value,"2900");
 assert.equal(app.elements.taxSimCosts.dataset.assessmentFixedCosts,"2710");
 assert.equal(app.elements.taxSimCosts.dataset.assessmentRiskReserve,"190");
 assert.match(app.elements.taxSimCosts.title,/Reserva de risco/);
 assert.equal(app.elements.taxSimMargin.textContent,(3390.35).toLocaleString("pt-PT",{style:"currency",currency:"EUR"}));
 assert.equal(app.elements.taxSimExpense.textContent,(2900).toLocaleString("pt-PT",{style:"currency",currency:"EUR"}));
});

test("sem preço atual usa o teto e a importação seguinte substitui custos antigos por zero",()=>{
 const app=boot(new Map(),true,assessment({purchase:{currentPrice:null,effectiveCeiling:18500,fixedCosts:900,riskReserve:100}}));
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"18500");
 assert.equal(app.elements.taxSimCosts.value,"1000");
 app.setAssessment(assessment({purchase:{currentPrice:17000,effectiveCeiling:18000,fixedCosts:0,riskReserve:0}}));
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"17000");
 assert.equal(app.elements.taxSimCosts.value,"0");
 assert.equal(app.elements.taxSimCosts.dataset.assessmentRiskReserve,"0");
});

test("preços zero válidos não são confundidos com campos nulos ou não finitos",()=>{
 for(const currentPrice of [null,undefined,NaN,""]){
  const app=boot(new Map(),true,assessment({purchase:{currentPrice,effectiveCeiling:0,fixedCosts:0,riskReserve:0}}));
  app.trigger("taxSimUseAssessment","click");
  assert.equal(app.elements.taxSimPurchase.value,"0");
  assert.equal(app.elements.taxSimError.hidden,true);
 }
 const app=boot(new Map(),true,assessment({purchase:{currentPrice:0,effectiveCeiling:500,fixedCosts:0,riskReserve:0}}));
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"0");
});

test("sem venda positiva ou custos completos a importação é atómica",()=>{
 for(const invalid of [
  {market:{saleLikely:null}}, {market:{saleLikely:NaN}}, {market:{saleLikely:0}},
  {purchase:{currentPrice:18000,effectiveCeiling:20000,fixedCosts:null,riskReserve:10}},
  {purchase:{currentPrice:null,effectiveCeiling:null,fixedCosts:100,riskReserve:10}},
  {purchase:{currentPrice:18000,effectiveCeiling:20000,fixedCosts:100,riskReserve:NaN}}
 ]){
  const app=boot(new Map(),true,assessment(invalid));
  app.trigger("taxSimUseAssessment","click");
  assert.equal(app.elements.taxSimPurchase.value,"19600");
  assert.equal(app.elements.taxSimSale.value,"22990");
  assert.equal(app.elements.taxSimCosts.value,"500");
  assert.equal(app.elements.taxSimError.hidden,false);
 }
});

test("IVA dedutível não é convertido silenciosamente em IVA da margem",()=>{
 const app=boot(new Map(),true,assessment({tax:{mode:"deductible",vatRate:.23}}));
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"19600");
 assert.equal(app.elements.taxSimCosts.value,"500");
 assert.match(app.elements.taxSimError.textContent,/IVA dedutível.*IVA da margem/);
});

test("uma avaliação nova não altera o simulador antes de importar e uma edição manual remove a origem dos custos",()=>{
 const app=boot(new Map(),true,assessment());
 app.trigger("taxSimUseAssessment","click");
 app.setAssessment(null);
 assert.equal(app.elements.taxSimCosts.value,"2900");
 app.elements.taxSimCosts.value="750";
 app.trigger("taxSimCosts","input");
 assert.equal(app.elements.taxSimCosts.title,"");
 assert.equal(app.elements.taxSimCosts.dataset.assessmentRiskReserve,undefined);
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimCosts.value,"750");
 assert.equal(app.elements.taxSimError.hidden,false);
});

test("sem preços de avaliação não substitui os preços inseridos",()=>{
 const app=boot(new Map(),false);
 app.elements.taxSimPurchase.value="17100";
 app.trigger("taxSimPurchase","input");
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"17100");
 assert.equal(app.elements.taxSimSale.value,"22990");
 assert.equal(app.elements.taxSimError.hidden,false);
});

test("mostra apenas resumo numa linha e mantém o detalhe fiscal disponível",()=>{
 const app=boot();
 assert.match(app.elements.taxSimSummary.textContent,/Margem/);
 assert.match(app.elements.taxSimSummary.textContent,/IVA/);
 assert.match(app.elements.taxSimSummary.textContent,/SS/);
 assert.match(app.elements.taxSimSummary.textContent,/Despesas/);
 assert.ok(app.elements.taxSimSocial.textContent.includes("€"));
 assert.equal(app.elements.taxSimAfterIRS.textContent,"—");
});

test("valores inválidos não exibem lucro incorreto",()=>{
 const app=boot();
 app.elements.taxSimSale.value="";
 app.trigger("taxSimSale","input");
 assert.equal(app.elements.taxSimError.hidden,false);
 assert.equal(app.elements.taxSimBeforeIRS.textContent,"—");
});

test("a opção visível começa desligada e recalcula apenas a contribuição da Segurança Social",()=>{
 assert.match(html,/<label[^>]*for="taxSimSocialEnabled"[^>]*><input id="taxSimSocialEnabled" type="checkbox">Incluir Segurança Social<\/label>/);
 const app=boot(),e=app.elements;
 e.taxSimPurchase.value="33990";e.taxSimSale.value="36035";e.taxSimCosts.value="1416";e.taxSimIrsRate.value="20";
 app.trigger("taxSimIrsRate","input");
 const eur=n=>n.toLocaleString("pt-PT",{style:"currency",currency:"EUR"});
 assert.equal(e.taxSimSocialEnabled.checked,false);
 assert.equal(e.taxSimSocial.textContent,eur(0));
 assert.equal(e.taxSimBeforeIRS.textContent,eur(246.6));
 assert.equal(e.taxSimAfterIRS.textContent,eur(-822.98));
 assert.match(e.taxSimSummary.textContent,/SS não incluída/);
 assert.doesNotMatch(e.taxSimWarning.textContent,/SS mensal estimada/);
 const vat=e.taxSimVat.textContent,taxable=e.taxSimTaxable.textContent,irs=e.taxSimIrs.textContent;
 e.taxSimSocialEnabled.checked=true;app.trigger("taxSimSocialEnabled","change");
 assert.equal(e.taxSimSocial.textContent,eur(1255.46));
 assert.equal(e.taxSimBeforeIRS.textContent,eur(-1008.86));
 assert.equal(e.taxSimAfterIRS.textContent,eur(-2078.44));
 assert.equal(e.taxSimVat.textContent,vat);assert.equal(e.taxSimTaxable.textContent,taxable);assert.equal(e.taxSimIrs.textContent,irs);
 assert.match(e.taxSimWarning.textContent,/SS mensal estimada/);
 e.taxSimSocialEnabled.checked=false;app.trigger("taxSimSocialEnabled","change");
 assert.equal(e.taxSimSocial.textContent,eur(0));
 assert.equal(e.taxSimBeforeIRS.textContent,eur(246.6));
 assert.equal(e.taxSimCosts.value,"1416");
});

test("a escolha da Segurança Social persiste ao recarregar e não é alterada ao importar outra avaliação",()=>{
 const storage=new Map();let app=boot(storage,true,assessment());
 app.elements.taxSimSocialEnabled.checked=true;app.trigger("taxSimSocialEnabled","change");
 app=boot(storage,false,assessment());
 assert.equal(app.elements.taxSimSocialEnabled.checked,true);
 assert.ok(JSON.parse(storage.get("aap-tax-sim-v2")).taxSimSocialEnabled);
 app.elements.result.classList.contains=()=>false;
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimSocialEnabled.checked,true);
 app.elements.taxSimSocialEnabled.checked=false;app.trigger("taxSimSocialEnabled","change");
 app=boot(storage);
 assert.equal(app.elements.taxSimSocialEnabled.checked,false);
});

test("montantes antigos são preservados sem ligar a Segurança Social por coerção de texto",()=>{
 for(const flag of [undefined,"false","true"]){
  const storage=new Map([["aap-tax-sim-v2",JSON.stringify({taxSimPurchase:"18000",taxSimSocialEnabled:flag})]]);
  const app=boot(storage);
  assert.equal(app.elements.taxSimPurchase.value,"18000");
  assert.equal(app.elements.taxSimSocialEnabled.checked,false);
 }
});
