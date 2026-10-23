import test from 'node:test';
import assert from 'node:assert/strict';
import {annualProgressiveIRS,calculateTaxSim} from './tax-simulator-calc.mjs';
test('2026 brackets apply marginally and continuously, including solidarity',()=>{
 assert.equal(annualProgressiveIRS(8342),1042.75);
 assert.ok(Math.abs(annualProgressiveIRS(12587)-(1042.75+4245*.157))<.001);
 for(const bound of [8342,12587,17838,23089,29397,43090,46566,80000,86634,250000]){
  assert.ok(annualProgressiveIRS(bound+.01)>annualProgressiveIRS(bound));
  assert.ok(annualProgressiveIRS(bound+.01)-annualProgressiveIRS(bound)<.006);
 }
});
test('automatic estimate uses total annual sales plus employment, not the minimum bracket on every sale',()=>{
 const values={purchase:19600,sale:22990,costs:500,quarterlySales:3,includeSocialSecurity:false,automaticIRS:true,annualSales:10,monthlyGrossSalary:730};
 const r=calculateTaxSim(values);
 assert.equal(r.projectedAnnualVehicles,10);
 assert.equal(r.irsMethod,'progressive-estimate');
 assert.ok(Math.abs(r.otherTaxable-(730*14-537.13*8.54))<.001);
 assert.ok(r.effectiveIRSRate>12.5);
 assert.equal(r.afterIRS,Math.round((r.beforeIRS-r.irsEstimate)*100)/100);
 assert.ok(calculateTaxSim({...values,annualSales:1}).effectiveIRSRate<r.effectiveIRSRate);
 assert.ok(calculateTaxSim({...values,monthlyGrossSalary:2000}).irsEstimate>r.irsEstimate);
 const manual=calculateTaxSim({...values,irsRate:20});
 assert.equal(manual.irsMethod,'manual');assert.equal(manual.effectiveIRSRate,20);
 for(const annualSales of [0,2.5,121])assert.throws(()=>calculateTaxSim({...values,annualSales}));
});
