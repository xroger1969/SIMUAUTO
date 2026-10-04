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

test("one private advert issues only a low-confidence provisional buying estimate",()=>{
  const privateAd={...subject,url:"https://classifieds.example/1",seller_type:"private",price:32000};
  const r=evaluatePurchase({subject,comparables:[privateAd],current_purchase_price:22000,source_url:"https://auction.example/x"});
  assert.equal(r.purchase.eligible,false);
  assert.ok(Number.isNaN(r.purchase.maxPurchase));
  assert.ok(r.market.confidencePct<=39);
  assert.match(r.purchase.decision,/Teto provisório/);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(Number.isFinite(r.purchase.provisionalMaxPurchase));
  assert.ok(r.market.confidencePct<=20);
});

test('one professional comparable can produce an indicative purchase value',()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1)],costs:{reconditioning:450},target_margin:3500});
  assert.equal(r.purchase.eligible,false);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(Number.isFinite(r.purchase.effectiveCeiling));
  assert.ok(r.market.confidencePct<=20);
  assert.equal(r.purchase.provisionalMaxPurchase,Math.max(0,Math.floor(r.market.saleLikely-r.purchase.fixedCosts-r.purchase.riskReserve-3500)));
});
test('no comparables still cannot produce a purchase estimate',()=>{
  const r=evaluatePurchase({subject,comparables:[]});
  assert.equal(r.purchase.provisionalEligible,false);
  assert.ok(!Number.isFinite(r.purchase.effectiveCeiling));
});
test('missing mileage lowers confidence but does not hide a provisional market or purchase estimate',()=>{
  const r=evaluatePurchase({subject:{...subject,mileage_km:null},comparables:[professional(1)]});
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(Number.isFinite(r.market.saleLikely));
  assert.ok(Number.isFinite(r.purchase.effectiveCeiling));
  assert.ok(r.market.confidencePct<=45);
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


test("auction vehicle abroad adds 1200 euros compared with same auction vehicle already in Portugal",()=>{
  const base={
    subject,comparables:[professional(1),professional(2),professional(3)],
    source_url:"https://www.auto1.com/pt/app/merchant/car/TEST",
    costs:{transport:150,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100},
    target_margin:3500,minimum_margin:1200
  };
  const abroad=evaluatePurchase({...base,source_context:{is_auction:true,vehicle_location:"foreign"}});
  const inPortugal=evaluatePurchase({...base,source_context:{is_auction:true,vehicle_location:"PT"}});
  assert.equal(abroad.purchase.importCost,1200);
  assert.equal(inPortugal.purchase.importCost,0);
  assert.equal(abroad.purchase.fixedCosts-inPortugal.purchase.fixedCosts,1200);
  assert.equal(inPortugal.purchase.maxPurchase-abroad.purchase.maxPurchase,1200);
});

test("auction vehicle already in Portugal never receives the 1200 euro import cost",()=>{
  const r=evaluatePurchase({
    subject,comparables:[professional(1),professional(2),professional(3)],
    source_url:"https://auction.example/car/1",
    source_context:{is_auction:true,vehicle_location:"PT"}
  });
  assert.equal(r.purchase.importCost,0);
  assert.equal(r.purchase.needsLocationConfirmation,false);
});

test("Standvirtual never receives the 1200 euro auction import cost",()=>{
  const r=evaluatePurchase({
    subject:{...subject,origin:"imported"},
    comparables:[professional(1),professional(2),professional(3)],
    source_url:"https://www.standvirtual.com/carros/anuncio/teste",
    source_context:{is_auction:true,vehicle_location:"foreign"}
  });
  assert.equal(r.purchase.importCost,0);
  assert.equal(r.purchase.acquisition.isAuction,false);
  assert.equal(r.purchase.needsLocationConfirmation,false);
});

test("uncertain auction location asks for confirmation before issuing a ceiling",()=>{
  const r=evaluatePurchase({
    subject,comparables:[professional(1),professional(2),professional(3)],
    source_url:"https://auction.example/car/2",
    source_context:{is_auction:true,vehicle_location:"unknown"}
  });
  assert.equal(r.purchase.needsLocationConfirmation,true);
  assert.equal(r.purchase.eligible,false);
  assert.ok(Number.isNaN(r.purchase.maxPurchase));
  assert.match(r.purchase.decision,/Confirmar/);
  assert.ok(r.warnings.some(x=>x.includes("1 200 €")));
});


test("three professional but unverified adverts produce a provisional ceiling, not a confident recommendation",()=>{
  const unverified=[1,2,3].map(i=>professional(i,{evidence:{verified:false,observed_at:observed,source:"model_reported",source_url_verified:false}}));
  const r=evaluatePurchase({
    subject,comparables:unverified,source_url:"https://dealer.example/vehicle",
    current_purchase_price:25000,
    costs:{transport:150,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100},
    target_margin:3500,minimum_margin:1200
  });
  assert.equal(r.purchase.eligible,false);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(Number.isNaN(r.purchase.maxPurchase));
  assert.ok(Number.isFinite(r.purchase.provisionalMaxPurchase));
  assert.equal(r.purchase.effectiveCeiling,r.purchase.provisionalMaxPurchase);
  assert.match(r.purchase.decision,/Teto provisório/);
  assert.ok(r.market.confidencePct<=39);
});


test("photo-identified BMW 425d accepts inconsistent portal naming for the same F36 Gran Coupé",()=>{
  const bmw={
    make:"BMW",model:"Série 4 Gran Coupé",trim:"425d 2.0",fuel:"Diesel",
    generation:"F36",year:2017,mileage_km:170000,origin:"unknown"
  };
  const common={
    make:"BMW",fuel:"Diesel",generation:"F36",year:2016,
    seller_type:"professional",country:"PT",availability:"available",
    price_basis:"gross",observed_at:observed,
    evidence:{verified:false,observed_at:observed,source:"model_reported",source_url_verified:false},
    power_cv:224,transmission:"Automática",origin:"national"
  };
  const r=evaluatePurchase({
    subject:bmw,
    comparables:[
      {...common,model:"425 Gran Coupé",trim:"d Pack M Auto",price:26900,mileage_km:92000,url:"https://standvirtual.com/carros/anuncio/bmw-425d-1"},
      {...common,model:"425 Gran Coupé",trim:"d Pack M Auto",price:20900,mileage_km:228000,url:"https://standvirtual.com/carros/anuncio/bmw-425d-2"},
      {...common,model:"425d Gran Coupé",trim:"Luxury Line",price:21490,mileage_km:197000,url:"https://piscapisca.pt/carros/usados/bmw-serie-4-425d-3"}
    ],
    source_context:{is_auction:false,vehicle_location:"unknown"},
    costs:{transport:150,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100},
    target_margin:3500,minimum_margin:1200
  });
  assert.equal(r.market.comparablesUsed,3);
  assert.equal(r.market.professionalComparables,3);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(Number.isFinite(r.purchase.provisionalMaxPurchase));
});

test('registration conflict blocks both verified and provisional purchase ceilings',()=>{
  for(const verified of [true,false]){
    const r=evaluatePurchase({subject,comparables:[1,2,3].map(i=>professional(i,{evidence:{verified,observed_at:observed,source_url_verified:verified}})),risk_flags:[{code:'registration_unconfirmed',severity:'medium',reserve_eur:0}]});
    assert.equal(r.purchase.eligible,false);
    assert.ok(!r.purchase.provisionalEligible);
    assert.ok(!Number.isFinite(r.purchase.maxPurchase));
    assert.ok(!Number.isFinite(r.purchase.provisionalMaxPurchase));
  }
});

test('estimated mileage never becomes a confirmed purchase recommendation',()=>{
  const r=evaluatePurchase({subject:{...subject,mileage_estimated:true},comparables:[1,2,3].map(i=>professional(i))});
  assert.equal(r.purchase.eligible,false);assert.equal(r.purchase.provisionalEligible,true);assert.ok(Number.isFinite(r.purchase.effectiveCeiling));assert.ok(r.market.confidencePct<=39);
});

test('V2 can value a vehicle with make model year fuel but no trim or mileage',()=>{
  const thin={...subject,trim:null,mileage_km:null};
  const r=evaluatePurchase({subject:thin,comparables:[professional(1),professional(2)]});
  assert.ok(Number.isFinite(r.market.marketValue));
  assert.ok(Number.isFinite(r.market.saleLikely));
  assert.equal(r.purchase.provisionalEligible,true);
});
