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
