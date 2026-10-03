import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const source=await readFile(new URL("./valuation.js",import.meta.url),"utf8");
const {evaluatePurchase,similarity}=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));

const observed=new Date().toISOString();
const subject={
  make:"Tesla",model:"Model Y",trim:"Long Range",generation:"1",fuel:"electric",
  battery_kwh:75,power_cv:350,drivetrain:"AWD",transmission:"automatic",
  year:2023,mileage_km:50000,price:25000,origin:"national"
};
const professional=(i,overrides={})=>({
  ...subject,
  label:"Stand "+i,
  url:"https://stand"+i+".example/car/"+i,
  source_domain:"stand"+i+".example",
  listing_id:"listing-"+i,
  seller_type:"professional",
  seller_name:"Stand "+i,
  country:"PT",
  availability:"available",
  price_basis:"gross",
  observed_at:observed,
  evidence:{verified:true,observed_at:observed,source:"web_search",source_url_verified:true},
  price:31500+i*250,
  mileage_km:50000+i*2500,
  ...overrides
});

test("one private advert can never issue a buying ceiling",()=>{
  const privateAd={...subject,url:"https://classifieds.example/1",seller_type:"private",price:32000};
  const r=evaluatePurchase({subject,comparables:[privateAd],current_purchase_price:22000,source_url:"https://auction.example/x"});
  assert.equal(r.purchase.eligible,false);
  assert.ok(Number.isNaN(r.purchase.maxPurchase));
  assert.ok(r.market.confidencePct<=39);
  assert.match(r.purchase.decision,/Referência provisória/);
});

test("unknown fields do not score as matching data",()=>{
  const thin={make:"Tesla",model:"Model Y",price:32000,url:"https://example.com/thin"};
  const complete=professional(1);
  assert.ok(similarity(subject,thin)<similarity(subject,complete));
  assert.ok(similarity(subject,thin)<62);
});

test("same vehicle replicated across portals is counted once",()=>{
  const a=professional(1,{url:"https://a.example/car/123",price:32000,mileage_km:55000});
  const b={...a,url:"https://b.example/listing/999",source_domain:"b.example"};
  const c=professional(3,{price:32750,mileage_km:60000});
  const d=professional(4,{price:33000,mileage_km:62500});
  const r=evaluatePurchase({subject,comparables:[a,b,c,d],source_url:"https://auction.example/x"});
  assert.equal(r.market.comparablesUsed,3);
  assert.ok(r.excluded.some(x=>x.reason.includes("duplicado")));
});

test("three distinct verified professional adverts can unlock a finite ceiling",()=>{
  const r=evaluatePurchase({
    subject,comparables:[professional(1),professional(2),professional(3)],
    source_url:"https://auction.example/x",current_purchase_price:25000,
    costs:{transport:150,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100},
    target_margin:3500,minimum_margin:1200
  });
  assert.equal(r.purchase.eligible,true);
  assert.equal(r.market.verifiedProfessionals,3);
  assert.ok(Number.isFinite(r.purchase.maxPurchase));
  assert.ok(r.purchase.maxPurchase<r.market.saleLikely);
  assert.ok(Number.isFinite(r.purchase.expectedMargin));
});

test("materially incompatible battery is excluded",()=>{
  const wrong=professional(9,{battery_kwh:50});
  const r=evaluatePurchase({subject,comparables:[wrong],source_url:"https://auction.example/x"});
  assert.equal(r.market.comparablesUsed,0);
  assert.ok(r.excluded.some(x=>x.reason==="bateria incompatível"));
});

test("current margin and ceiling margin are separate values",()=>{
  const r=evaluatePurchase({
    subject,comparables:[professional(1),professional(2),professional(3)],
    source_url:"https://auction.example/x",current_purchase_price:24500,
    costs:{transport:100},target_margin:3500,minimum_margin:1200
  });
  assert.ok(Number.isFinite(r.purchase.expectedMargin));
  assert.ok(Number.isFinite(r.purchase.marginAtCeiling));
  assert.notEqual(r.purchase.expectedMargin,r.market.saleLikely-r.purchase.maxPurchase);
});

test("default target margin remains 3500 euros",()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1),professional(2),professional(3)],source_url:"https://auction.example/x"});
  assert.equal(r.purchase.targetMargin,3500);
});
