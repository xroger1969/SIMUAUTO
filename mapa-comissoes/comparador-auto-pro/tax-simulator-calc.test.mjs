import test from "node:test";
import assert from "node:assert/strict";
import {calculateTaxSim} from "./tax-simulator-calc.mjs";

test("Peugeot em regime da margem e isenção trimestral",()=>{
 const r=calculateTaxSim({purchase:19600,sale:22990,quarterlySales:1});
 assert.equal(r.grossMargin,3390);assert.equal(r.marginVat,633.9);
 assert.equal(r.taxableIncome,3353.42);assert.equal(r.socialPerCar,0);
 assert.equal(r.beforeIRS,2756.1);assert.equal(r.afterIRS,null);
});
test("três viaturas por trimestre perdem isenção da SS e podem exceder limiar anual",()=>{
 const r=calculateTaxSim({purchase:19600,sale:22990,costs:500,quarterlySales:3,irsRate:31.1});
 assert.equal(r.socialMonthly,585.32);assert.equal(r.projectedAnnualVehicles,12);
 assert.ok(r.socialPerCar>0);assert.equal(r.exceedsSimplifiedSingleYearThreshold,true);
 assert.ok(r.afterIRS<r.beforeIRS);
});
test("margem negativa: não permite abater IVA negativo a outras viaturas, mas vendas continuam a contar para IRS",()=>{
 const r=calculateTaxSim({purchase:22000,sale:20000,costs:300,quarterlySales:1});
 assert.equal(r.marginVat,0);assert.equal(r.taxableIncome,3000);assert.equal(r.beforeIRS,-2300);
});
test("dois carros por trimestre: SS é calculada sobre o excesso",()=>{
 const r=calculateTaxSim({purchase:19600,sale:22990,quarterlySales:2});
 assert.ok(r.socialMonthly>200&&r.socialMonthly<220);
 assert.ok(r.socialPerCar<r.socialMonthly*3);
});
test("validação rejeita dados impossíveis",()=>{
 assert.throws(()=>calculateTaxSim({purchase:19600,sale:0}),/valores positivos/);
 assert.throws(()=>calculateTaxSim({purchase:19600,sale:22990,quarterlySales:2.5}),/entre 1 e 30/);
 assert.throws(()=>calculateTaxSim({purchase:19600,sale:22990,irsRate:75}),/taxa de IRS/);
});

test("a opção SS mantém o cálculo anterior quando está ativa ou é omitida",()=>{
 const values={purchase:33990,sale:36035,costs:1416,quarterlySales:3,irsRate:20};
 const implicit=calculateTaxSim(values);
 const active=calculateTaxSim({...values,includeSocialSecurity:true});
 assert.deepEqual(implicit,active);
 assert.equal(active.socialMonthly,1255.46);
 assert.equal(active.socialQuarter,3766.38);
 assert.equal(active.socialPerCar,1255.46);
 assert.equal(active.beforeIRS,-1008.86);
 assert.equal(active.afterIRS,-2078.44);
 assert.equal(active.inputs.includeSocialSecurity,true);
});

test("desativar SS no cenário da captura remove apenas a contribuição, antes e depois do IRS",()=>{
 const values={purchase:33990,sale:36035,costs:1416,quarterlySales:3,irsRate:20};
 const active=calculateTaxSim({...values,includeSocialSecurity:true});
 const inactive=calculateTaxSim({...values,includeSocialSecurity:false});
 assert.equal(inactive.socialMonthly,0);
 assert.equal(inactive.socialQuarter,0);
 assert.equal(inactive.socialPerCar,0);
 assert.equal(inactive.beforeIRS,246.6);
 assert.equal(inactive.afterIRS,-822.98);
 assert.equal(Math.round((inactive.beforeIRS-active.beforeIRS)*100),125546);
 assert.equal(Math.round((inactive.afterIRS-active.afterIRS)*100),125546);
 for(const key of ['grossMargin','marginVat','saleWithoutVat','costs','taxableIncome','relevantMonthly','exemptLimit','irsEstimate','projectedAnnualRevenue','projectedAnnualVehicles','requiresAnnualReview','exceedsSimplifiedSingleYearThreshold']){
  assert.equal(inactive[key],active[key],key+' não depende da opção SS');
 }
 assert.equal(inactive.marginVat,382.4);
 assert.equal(inactive.taxableIncome,5347.89);
 assert.equal(inactive.irsEstimate,1069.58);
 assert.equal(inactive.inputs.includeSocialSecurity,false);
});

test("SS opcional também funciona sem estimativa de IRS e quando a contribuição já era zero",()=>{
 const withoutIRS=calculateTaxSim({purchase:33990,sale:36035,costs:1416,quarterlySales:3,includeSocialSecurity:false});
 assert.equal(withoutIRS.beforeIRS,246.6);
 assert.equal(withoutIRS.irsEstimate,null);
 assert.equal(withoutIRS.afterIRS,null);
 const values={purchase:19600,sale:22990,quarterlySales:1};
 const active=calculateTaxSim({...values,includeSocialSecurity:true});
 const inactive=calculateTaxSim({...values,includeSocialSecurity:false});
 assert.equal(active.socialPerCar,0);
 assert.equal(inactive.beforeIRS,active.beforeIRS);
});

test("a opção SS rejeita valores não booleanos em vez de os interpretar como uma seleção",()=>{
 for(const includeSocialSecurity of ['false','true',0,1,null,NaN,[],{},new Boolean(false)]){
  assert.throws(()=>calculateTaxSim({purchase:19600,sale:22990,includeSocialSecurity}),/Segurança Social.*booleana/);
 }
});
