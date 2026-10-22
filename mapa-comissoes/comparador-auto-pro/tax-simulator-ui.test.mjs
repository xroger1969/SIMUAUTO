import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {calculateTaxSim} from "./tax-simulator-calc.mjs";

const source=readFileSync(new URL("./tax-simulator-ui.js",import.meta.url),"utf8").replace(/^import [^\n]+\n/,"");
const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");

function boot(storage=new Map(),shown=true){
 const data={taxSimPurchase:"19600",taxSimSale:"22990",taxSimCosts:"500",taxSimQuarterly:"3",taxSimIrsRate:""};
 const elements={};
 function create(id,value=""){
  const el={id,value,textContent:"",hidden:false,open:false,listeners:{},tagName:id==="taxSimQuarterly"?"SELECT":"INPUT",
   options:[{value:"1"},{value:"2"},{value:"3"},{value:"4"},{value:"6"}],
   classList:{contains:classname=>classname==="hidden"?!shown:false},
   addEventListener:(name,callback)=>{el.listeners[name]=callback;},
   closest:()=>({firstChild:{textContent:id}}),
   scrollIntoView:()=>{}};
  elements[id]=el;return el;
 }
 for(const [id,value] of Object.entries(data))create(id,value);
 for(const id of ["taxSimMargin","taxSimVat","taxSimExpense","taxSimSocial","taxSimTaxable","taxSimBeforeIRS","taxSimAfterIRS","taxSimIrs","taxSimSummary","taxSimWarning","taxSimError","taxSimUseAssessment","taxSimOpenBtn","taxSimFromResult","taxSimulator","result","currentPrice","commercialSale"])create(id);
 const context={calculateTaxSim,document:{getElementById:id=>elements[id]||null},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}};
 vm.runInNewContext(source,context,{filename:"tax-simulator-ui.js"});
 return {elements,storage,trigger:(id,name)=>elements[id].listeners[name]?.()};
}

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

test("importa os preços exibidos 19.600,00 € e 22.990 € sem perder os milhares",()=>{
 const app=boot();
 app.elements.currentPrice.textContent="19.600,00 €";
 app.elements.commercialSale.textContent="22.990 €";
 app.trigger("taxSimUseAssessment","click");
 assert.equal(app.elements.taxSimPurchase.value,"19600");
 assert.equal(app.elements.taxSimSale.value,"22990");
 assert.match(app.elements.taxSimMargin.textContent,/3\\s?390,00\\s?€/u);
 // A formatação pode usar espaços normais ou não separáveis: verificar moeda e ordem de grandeza.
 assert.ok(app.elements.taxSimBeforeIRS.textContent.includes("€"));
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
