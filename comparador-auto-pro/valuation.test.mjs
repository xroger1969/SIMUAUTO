import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePurchase, similarity } from "./valuation.js";

const subject={
  make:"Volkswagen",model:"ID.4",generation:"ID.4",trim:"Business Pro Performance",
  fuel:"electric",battery_kwh:77,power_cv:204,drivetrain:"RWD",year:2021,
  first_registration:"2021-08-01",mileage_km:59517,vat_deductible:true,price:23300,
  equipment:["acc stop&go","camera traseira","bancos aquecidos"]
};
const comps=[
  {...subject,label:"Business A",price:26000,mileage_km:76100,first_registration:"2021-12-01",days_since_seen:3},
  {...subject,label:"Business B",price:25999,mileage_km:99864,first_registration:"2021-08-01",days_since_seen:7},
  {...subject,trim:"Pro Performance Life",label:"Life",price:25900,mileage_km:59000,first_registration:"2021-10-01",days_since_seen:5},
  {...subject,trim:"Pro Performance 1st",label:"1st A",price:25800,mileage_km:50443,first_registration:"2021-03-01",days_since_seen:6},
  {...subject,trim:"Pro Performance 1st",label:"1st B",price:24950,mileage_km:85284,first_registration:"2021-06-01",days_since_seen:9},
  {...subject,battery_kwh:52,trim:"Pure",label:"wrong battery",price:21900,mileage_km:50000}
];

test("exact comparable scores strongly",()=>{
  assert.ok(similarity(subject,comps[0])>=85);
});

test("wrong battery is excluded and purchase ceiling is finite",()=>{
  const result=evaluatePurchase({
    subject,comparables:comps,current_purchase_price:23300,
    tax:{mode:"deductible",vat_rate:.23},
    costs:{auction_fee:370.5,transport:120,reconditioning:300,warranty_reserve:120,stock_finance:80},
    risk_flags:[{reserve_eur:250},{reserve_eur:180},{reserve_eur:120}],
    target_margin:1500,minimum_margin:900
  });
  assert.ok(Number.isFinite(result.purchase.maxPurchase));
  assert.ok(result.purchase.maxPurchase<result.market.saleLikely);
  assert.ok(result.excluded.some(x=>x.reason==="bateria incompatível"));
  assert.ok(result.market.comparablesUsed>=4);
});

test("deductible VAT uses a lower economic basis for margin",()=>{
  const result=evaluatePurchase({
    subject,comparables:comps.slice(0,5),current_purchase_price:22000,
    tax:{mode:"deductible",vat_rate:.23},costs:{},risk_flags:[],
    target_margin:0,minimum_margin:0
  },{riskReservePct:0});
  assert.equal(result.tax.mode,"deductible");
  assert.ok(result.purchase.maxPurchase<=result.market.saleLikely+1);
});
