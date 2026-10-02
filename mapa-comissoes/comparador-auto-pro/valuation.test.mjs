import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source=await readFile(new URL("./valuation.js",import.meta.url),"utf8");
const {evaluatePurchase}=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
const subject={make:"Citroën",model:"C4",fuel:"petrol",year:2020,mileage_km:50000,price:15000};
const comp={...subject,price:16000,url:"https://example.com/car/1"};
test("invalid prices and duplicate URLs never influence valuation",()=>{
 const r=evaluatePurchase({subject,comparables:[comp,{...comp,url:comp.url+"?utm=test"},{...comp,price:null},{...comp,price:-1}],current_purchase_price:15000});
 assert.equal(r.market.comparablesUsed,1);assert.equal(r.market.comparablesExcluded,3);
});
test("missing kilometres are not treated as zero",()=>{
 const r=evaluatePurchase({subject,comparables:[{...comp,mileage_km:null}]});
 assert.equal(r.market.marketValue,16000);
});
test("without comparables no buying recommendation is issued",()=>{
 const r=evaluatePurchase({subject,comparables:[],current_purchase_price:15000});
 assert.equal(r.purchase.decision,"sem dados");assert.ok(Number.isNaN(r.purchase.maxPurchase));
});
test("costs and margin lower purchase ceiling by their economic amount",()=>{
 const base={subject,comparables:[comp],current_purchase_price:15000};
 const a=evaluatePurchase(base),b=evaluatePurchase({...base,costs:{transport:500},target_margin:2500});
 assert.equal(a.purchase.maxPurchase-b.purchase.maxPurchase,1000);
});
