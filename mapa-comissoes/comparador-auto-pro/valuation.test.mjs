import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

await import(new URL("./commercial-identity.js",import.meta.url));
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

test('unknown mileage keeps the same weighted estimator and still subtracts costs and target margin',()=>{
  const s={...subject,mileage_km:70000,mileage_estimated:true};
  const r=evaluatePurchase({subject:s,comparables:[professional(1,{price:29000}),professional(2,{price:31000}),professional(3,{price:37000})],target_margin:3500,costs:{transport:150,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100}});
  const fixed=evaluatePurchase({subject:{...s,mileage_estimated:false,mileage_km:70000},comparables:[professional(1,{price:29000}),professional(2,{price:31000}),professional(3,{price:37000})],target_margin:3500,costs:{transport:150,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100}});
  assert.equal(r.market.marketValue,fixed.market.marketValue);
  assert.equal(r.purchase.provisionalEligible,true);assert.equal(r.purchase.eligible,false);
  assert.ok(r.purchase.effectiveCeiling<=r.market.saleLikely-3500);
  assert.ok(r.market.confidencePct<=45);
});

test("one private advert issues only a low-confidence provisional buying estimate",()=>{
  const privateAd={...subject,url:"https://classifieds.example/1",seller_type:"private",price:32000};
  const r=evaluatePurchase({subject,comparables:[privateAd],current_purchase_price:22000,source_url:"https://auction.example/x"});
  assert.equal(r.purchase.eligible,false);
  assert.ok(Number.isNaN(r.purchase.maxPurchase));
  assert.ok(r.market.confidencePct<=47);
  assert.match(r.purchase.decision,/Teto provisório/);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(Number.isFinite(r.purchase.provisionalMaxPurchase));
  assert.ok(r.market.confidencePct<=52);
});

test('one professional comparable can produce an indicative purchase value',()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1)],costs:{reconditioning:450},target_margin:3500});
  assert.equal(r.purchase.eligible,false);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(Number.isFinite(r.purchase.effectiveCeiling));
  assert.ok(r.market.confidencePct<=52);
  assert.equal(r.purchase.provisionalMaxPurchase,Math.max(0,Math.floor(r.market.saleLikely-r.purchase.fixedCosts-r.purchase.riskReserve-3500)));
});
test('two comparables cannot show the same confidence ceiling as three',()=>{
  const two=evaluatePurchase({subject,comparables:[professional(1),professional(2)]});
  const three=evaluatePurchase({subject,comparables:[professional(1),professional(2),professional(3)]});
  assert.ok(two.market.confidencePct<=68);
  assert.equal(two.purchase.eligible,true);
  assert.ok(three.market.confidencePct>=two.market.confidencePct);
});
test('no comparables but a known price still produces two clearly hypothetical values',()=>{
  const r=evaluatePurchase({subject,comparables:[],costs:{reconditioning:600}});
  assert.equal(r.market.comparablesUsed,0);
  assert.equal(r.market.searchTier,4);
  assert.equal(r.market.confidencePct,0);
  assert.ok(Number.isNaN(r.market.saleLikely));
  assert.equal(r.purchase.priceScenario,true);
  assert.equal(r.purchase.eligible,false);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(Number.isFinite(r.purchase.purchaseWithoutRepairs));
  assert.equal(r.purchase.purchaseWithoutRepairs-r.purchase.purchaseWithRepairs,600);
  assert.match(r.purchase.decision,/SEM valor de mercado confirmado/);
});
test('no market and no observed price cannot invent a monetary quote',()=>{
  const r=evaluatePurchase({subject:{...subject,price:null},comparables:[]});
  assert.equal(r.purchase.priceScenario,false);
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

test("default target margin scales with the resale market",()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1),professional(2),professional(3)],source_url:"https://auction.example/x"});
  assert.ok(r.purchase.targetMargin>=5000);
  assert.equal(r.purchase.marginMode,"automatic");
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
  assert.ok(r.market.confidencePct<=47);
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
  assert.equal(r.purchase.eligible,false);assert.equal(r.purchase.provisionalEligible,true);assert.ok(Number.isFinite(r.purchase.effectiveCeiling));assert.ok(r.market.confidencePct<=47);
});

test('V2 can value a vehicle with make model year fuel but no trim or mileage',()=>{
  const thin={...subject,trim:null,mileage_km:null};
  const r=evaluatePurchase({subject:thin,comparables:[professional(1),professional(2)]});
  assert.ok(Number.isFinite(r.market.marketValue));
  assert.ok(Number.isFinite(r.market.saleLikely));
  assert.equal(r.purchase.provisionalEligible,true);
});

test('Standvirtual asking price is not treated as an auction acquisition reference',()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1),professional(2)],source_url:'https://www.standvirtual.com/carros/anuncio/teste',current_purchase_price:19000});
  assert.equal(r.purchase.acquisition.isAuction,false);
  assert.equal(r.purchase.acquisition.priceRole,'asking_price');
  assert.ok(Number.isFinite(r.purchase.effectiveCeiling));
});
test('auction price is classified as acquisition price for direct bid comparison',()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1),professional(2)],source_url:'https://www.auto1.com/pt/vehicle/123',source_context:{is_auction:true,vehicle_location:'PT'},current_purchase_price:14000});
  assert.equal(r.purchase.acquisition.isAuction,true);
  assert.equal(r.purchase.acquisition.priceRole,'acquisition_price');
});

test('AUTO1 France automatically applies the foreign-auction logistics cost',()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1),professional(2)],source_url:'https://www.auto1.com/pt/vehicle/FR123',source_context:{is_auction:true,vehicle_location:'unknown',origin_country:'FR'},current_purchase_price:14000});
  assert.equal(r.purchase.acquisition.isAuction,true);
  assert.equal(r.purchase.acquisition.vehicleLocation,'foreign');
  assert.equal(r.purchase.importCost,1200);
  assert.equal(r.purchase.needsLocationConfirmation,false);
});
test('AUTO1 Portugal does not apply the foreign-auction logistics cost',()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1),professional(2)],source_url:'https://www.auto1.com/pt/vehicle/PT123',source_context:{is_auction:true,vehicle_location:'unknown',origin_country:'PT'},current_purchase_price:14000});
  assert.equal(r.purchase.acquisition.vehicleLocation,'PT');
  assert.equal(r.purchase.importCost,0);
});

test("Hyundai Kona 2022 é avaliado por outro ano, quilometragem e versão",()=>{
  const inspected={
    make:"Hyundai",model:"Kona",trim:"1.6 Hybrid Prime 2WD",fuel:"Híbrido",
    year:2022,mileage_km:118633,power_cv:141,transmission:"Dupla embreagem"
  };
  const comparable={
    ...professional(1),make:"Hyundai",model:"Kona 1.6 Hybrid",trim:"1.6 Hybrid",
    fuel:"hybrid",year:2020,mileage_km:144000,power_cv:141,
    price:19500,transmission:"automatic"
  };
  const result=evaluatePurchase({
    subject:inspected,comparables:[comparable],
    source_url:"https://www.auto1.com/pt/app/car/123",
    source_context:{is_auction:true,vehicle_location:"PT"},
    current_purchase_price:11420
  });
  assert.equal(result.market.comparablesUsed,1);
  assert.equal(result.purchase.provisionalEligible,true);
  assert.equal(result.purchase.eligible,false);
  assert.ok(Number.isFinite(result.market.marketValue));
  assert.ok(Number.isFinite(result.purchase.effectiveCeiling));
  assert.ok(result.market.confidencePct>0&&result.market.confidencePct<=52);
  assert.equal(result.purchase.importCost,0);
  assert.equal(result.market.confidenceMethod,"heuristic-evidence-v3");
});

test("dois anúncios aproximados verificados bastam sem três carros iguais",()=>{
  const subjectK={make:"Hyundai",model:"Kona",trim:"1.6 Hybrid Prime",fuel:"hybrid",year:2022,mileage_km:118633};
  const comps=[professional(1,{make:"Hyundai",model:"Kona Hybrid",trim:"1.6 Hybrid",fuel:"hybrid",year:2021,mileage_km:95000,price:19000}),
    professional(2,{make:"Hyundai",model:"Kona",trim:"1.6 Hybrid Premium",fuel:"hybrid",year:2023,mileage_km:103000,price:21100})];
  const r=evaluatePurchase({subject:subjectK,comparables:comps});
  assert.equal(r.market.comparablesUsed,2);
  assert.ok(Number.isFinite(r.purchase.effectiveCeiling));
  assert.ok(r.market.confidencePct<=68);
});

test("a aproximação não mistura híbrido com diesel nem duplica anúncios",()=>{
  const h={make:"Hyundai",model:"Kona",trim:"1.6 Hybrid",fuel:"hybrid",year:2022,mileage_km:118633};
  const diesel=professional(1,{make:"Hyundai",model:"Kona",fuel:"diesel"});
  const good=professional(2,{make:"Hyundai",model:"Kona",fuel:"hybrid"});
  const repeat={...good,url:"https://mirror.example/clone"};
  const r=evaluatePurchase({subject:h,comparables:[diesel,good,repeat]});
  assert.equal(r.market.comparablesUsed,1);
  assert.ok(r.excluded.some(x=>/combustível diferente/.test(x.reason)));
  assert.ok(r.excluded.some(x=>/duplicado/.test(x.reason)));
});

test('repair costs produce two independent purchase quotes even when the repair estimate is high',()=>{
  const base={subject,comparables:[professional(1),professional(2),professional(3)],
    source_context:{is_auction:false,vehicle_location:'PT'},
    costs:{reconditioning:450,transport:150},target_margin:3500};
  const clean=evaluatePurchase(base);
  const repair=evaluatePurchase({...base,condition_report:{
    assessed:true,summary:'Danos confirmados nas fotografias',findings:[
      {component:'front_bumper',label:'Para-choques dianteiro',category:'body',
        action:'replace',status:'confirmed',quantity:1,evidence:'Peça partida na fotografia',
        source_image:1,safety_critical:false,technician_marked:false,
        cost:{parts_min_eur:null,parts_max_eur:null,labour_min_eur:null,labour_max_eur:null,price_basis:'unknown',source_url:null}}
    ]},reconditioning_settings:{overrides:{front_bumper:9000}}});
  assert.equal(repair.purchase.purchaseWithoutRepairs,clean.purchase.purchaseWithoutRepairs);
  assert.equal(repair.purchase.purchaseWithRepairs,repair.purchase.effectiveCeiling);
  assert.equal(repair.purchase.purchaseWithoutRepairs-repair.purchase.purchaseWithRepairs,9000);
  assert.equal(repair.purchase.eligible,true);
});

test('large dispersion lowers confidence without erasing either buy price',()=>{
  const a=professional(1,{price:14500});
  const b=professional(2,{price:23500});
  const c=professional(3,{price:36500});
  const r=evaluatePurchase({subject,comparables:[a,b,c],costs:{reconditioning:886},target_margin:3500});
  assert.ok(r.market.dispersion>.45);
  assert.equal(r.purchase.eligible,false);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(r.market.confidencePct<=35);
  assert.ok(Number.isFinite(r.purchase.purchaseWithoutRepairs));
  assert.ok(Number.isFinite(r.purchase.purchaseWithRepairs));
  assert.equal(r.purchase.purchaseWithoutRepairs-r.purchase.purchaseWithRepairs,886);
  assert.match(r.purchase.decision,/dispersos/);
  assert.ok(r.warnings.some(x=>/muito dispersos/i.test(x)));
});

test('deductible VAT repair is discounted exactly once in both quotes',()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1),professional(2)],
    tax:{mode:'deductible',vat_rate:.23},costs:{reconditioning:100}});
  assert.ok(Math.abs((r.purchase.purchaseWithoutRepairs-r.purchase.purchaseWithRepairs)-123)<=1);
  assert.equal(r.reconditioning.appliedGross,123);
});

test('Smart 7800 EUR without comparable shows provisional buy quotes, not a validated resale',()=>{
  const r=evaluatePurchase({subject:{make:'Smart',model:'fortwo',fuel:'electric',year:2017,mileage_km:45424,price:7800},
    current_purchase_price:7800,comparables:[],costs:{reconditioning:886}});
  assert.equal(r.market.comparablesUsed,0);
  assert.equal(r.market.searchTier,4);
  assert.ok(!Number.isFinite(r.market.marketValue));
  assert.ok(!Number.isFinite(r.market.saleFast));
  assert.equal(r.purchase.priceScenario,true);
  assert.equal(r.purchase.eligible,false);
  assert.ok(Number.isFinite(r.purchase.purchaseWithoutRepairs));
  assert.ok(Number.isFinite(r.purchase.purchaseWithRepairs));
  assert.equal(r.purchase.purchaseWithoutRepairs-r.purchase.purchaseWithRepairs,886);
  assert.match(r.purchase.decision,/não é recomendação de compra/);
  assert.ok(r.warnings.some(x=>/NÃO confirmam o valor de revenda/.test(x)));
});

test('Smart fortwo electric drive listings with Coupé wording remain comparable',()=>{
  const smart={make:'Smart',model:'fortwo',trim:'electric drive 60 kW',fuel:'electric',
    year:2017,mileage_km:45424,transmission:'automatic',price:7800};
  const ads=[professional(1,{make:'Smart',model:'fortwo Coupé electric drive',trim:'60 kW',
    fuel:'electric',year:2017,mileage_km:53000,price:9800,battery_kwh:null,power_cv:82}),
    professional(2,{make:'Smart',model:'fortwo',trim:'electric drive',
    fuel:'electric',year:2018,mileage_km:61000,price:10500,battery_kwh:null,power_cv:82})];
  const r=evaluatePurchase({subject:smart,comparables:ads,costs:{reconditioning:886}});
  assert.equal(r.market.comparablesUsed,2);
  assert.ok(Number.isFinite(r.purchase.purchaseWithoutRepairs));
  assert.ok(Number.isFinite(r.purchase.purchaseWithRepairs));
});

test('strictly excluded but compatible near-match advertisements may yield cautious fallback',()=>{
  const far=professional(10,{trim:null,generation:null,year:2020,
    mileage_km:150000,drivetrain:'AWD',transmission:'manual',price:17600});
  const r=evaluatePurchase({subject,comparables:[far]},{minSimilarity:70});
  assert.equal(r.market.comparablesUsed,1);
  assert.equal(r.market.broadenedMarket,true);
  assert.equal(r.purchase.eligible,false);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(r.market.confidencePct<=35);
  assert.ok(Number.isFinite(r.purchase.purchaseWithoutRepairs));
  assert.ok(r.warnings.some(x=>/Nível 2|Nível 3|aproximados/i.test(x)));
});
test('third tier uses a distant but real same-model and same-fuel advert with confidence capped',()=>{
  const distant=professional(15,{trim:null,generation:null,year:2018,mileage_km:170000,
    drivetrain:'AWD',transmission:'manual',price:17000});
  const r=evaluatePurchase({subject,comparables:[distant]});
  assert.equal(r.market.comparablesUsed,1);
  assert.equal(r.market.searchTier,3);
  assert.ok(r.market.confidencePct<=25);
  assert.equal(r.purchase.eligible,false);
  assert.ok(Number.isFinite(r.purchase.purchaseWithoutRepairs));
  assert.ok(Number.isFinite(r.purchase.purchaseWithRepairs));
});
test('unknown auction location uses only a conservative provisional import allowance',()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1),professional(2)],
    source_url:'https://www.auto1.com/pt/vehicle/X',source_context:{is_auction:true,vehicle_location:'unknown'}});
  assert.equal(r.purchase.needsLocationConfirmation,true);
  assert.equal(r.purchase.importCost,1200);
  assert.equal(r.purchase.eligible,false);
  assert.equal(r.purchase.provisionalEligible,true);
  assert.ok(Number.isFinite(r.purchase.purchaseWithRepairs));
});
test('second-tier fallback never compares electric vehicles against diesel alternatives',()=>{
  const wrong=professional(10,{make:'Smart',model:'fortwo',fuel:'diesel',price:8000});
  const electric={make:'Smart',model:'fortwo',fuel:'electric',year:2017,mileage_km:45424};
  const r=evaluatePurchase({subject:electric,comparables:[wrong]});
  assert.equal(r.market.comparablesUsed,0);
  assert.ok(!Number.isFinite(r.purchase.purchaseWithRepairs));
});

test('Mercedes 2020 imported and plated in 2024 has no four-year artificial age premium',()=>{
  const car={...subject,make:'Mercedes-Benz',model:'CLA',trim:'180 d',generation:'W118',
    fuel:'diesel',year:2020,first_registration:'2024-07',
    mileage_km:119283,power_cv:116,origin:'imported',price:20000};
  const comparable=professional(1,{...car,price:24100,first_registration:'2020-07'});
  const r=evaluatePurchase({subject:car,comparables:[comparable],target_margin:3500});
  assert.equal(r.market.comparablesUsed,1);
  assert.equal(r.comparables[0].adjustedPrice,24100);
  assert.equal(r.market.marketValue,24100);
  assert.ok(r.purchase.purchaseWithRepairs<r.market.saleLikely);
});


test("parecer comercial parte da revenda e subtrai custos e margem-alvo",()=>{
  const r=evaluatePurchase({
    subject,comparables:[professional(1),professional(2),professional(3)],
    current_purchase_price:29000,
    costs:{auction_fee:250,transport:300,reconditioning:650,warranty_reserve:350,stock_finance:150,other:100},
    source_context:{is_auction:true,vehicle_location:"PT"},target_margin:3500
  });
  assert.equal(r.commercial.hasIndependentMarket,true);
  assert.equal(r.commercial.saleLikely,r.market.saleLikely);
  assert.equal(r.commercial.targetCeiling,r.purchase.effectiveCeiling);
  assert.equal(r.commercial.fixedCosts,r.purchase.fixedCosts);
  assert.equal(r.commercial.expectedMargin,r.purchase.expectedMargin);
  assert.equal(r.commercial.targetMargin,3500);
  assert.equal(r.commercial.profitShortfall,Math.max(0,3500-r.purchase.expectedMargin));
  assert.equal(r.commercial.excessBid,Math.max(0,29000-r.purchase.effectiveCeiling));
  assert.ok(r.commercial.saleRange.low<=r.commercial.saleRange.high);
  assert.equal(r.commercial.askingPricesNotTransactions,true);
});

test("eletrico sem SOH não recebe parecer verde apesar de teto favorável",()=>{
  const r=evaluatePurchase({
    subject,comparables:[professional(1),professional(2),professional(3)],
    current_purchase_price:14000
  });
  assert.equal(r.purchase.eligible,true);
  assert.equal(r.commercial.missingBatteryHealth,true);
  assert.equal(r.commercial.documentedSoh,null);
  assert.equal(r.commercial.tone,"neutral");
  assert.match(r.commercial.risks.join(" "),/SOH/);
});
test("SOH documentado desbloqueia o alerta da bateria",()=>{
  const r=evaluatePurchase({
    subject,comparables:[professional(1),professional(2),professional(3)],
    current_purchase_price:14000,
    condition_report:{assessed:true,battery_soh_pct:91,findings:[]}
  });
  assert.equal(r.commercial.missingBatteryHealth,false);
  assert.equal(r.commercial.documentedSoh,91);
  assert.equal(r.commercial.tone,"green");
});
test("leilão acima da margem mínima apresenta não comprar e aviso de taxas",()=>{
  const r=evaluatePurchase({
    subject,comparables:[professional(1),professional(2),professional(3)],
    current_purchase_price:40000,
    source_url:"https://www.auto1.com/pt/vehicle/test",
    source_context:{is_auction:true,vehicle_location:"PT"},
    costs:{auction_fee:500,reconditioning:100}
  });
  assert.equal(r.commercial.tone,"red");
  assert.match(r.commercial.verdict,/Não comprar/);
  assert.ok(r.commercial.risks.some(x=>x.includes("comissão")));
});
test("sem comparáveis não inventar intervalo de mercado nem margem verificada",()=>{
  const r=evaluatePurchase({
    subject,comparables:[],current_purchase_price:25000,
    source_url:"https://www.auto1.com/pt/vehicle/test",
    source_context:{is_auction:true,vehicle_location:"PT"}
  });
  assert.equal(r.commercial.hasIndependentMarket,false);
  assert.equal(r.commercial.saleLikely,null);
  assert.equal(r.commercial.saleRange,null);
  assert.equal(r.commercial.expectedMargin,null);
  assert.equal(r.commercial.tone,"neutral");
  assert.match(r.commercial.verdict,/Simulação/);
});


test('AL47IC real snapshot recognizes the commercial family and keeps power discrepancies provisional',async()=>{
  const snapshot=JSON.parse(await readFile(new URL('../tests/fixtures/al47ic-market.json',import.meta.url),'utf8'));
  const r=evaluatePurchase(snapshot);
  assert.equal(r.subject.model,'Model Y');
  assert.equal(r.subject.trim,'long range awd');
  assert.equal(r.subject.commercial_identity.raw.model,'MODEL Y LONG RANGE AWD');
  assert.ok(r.market.comparablesUsed>=2);
  assert.ok(Number.isFinite(r.market.saleLikely));
  assert.ok(Number.isFinite(r.purchase.effectiveCeiling));
  assert.equal(r.purchase.eligible,false);
  assert.ok(r.comparables.some(c=>c.power_discrepancy));
  assert.ok(r.warnings.some(w=>/Potência divergente/.test(w)));
  assert.ok(r.market.confidencePct<=45);
});

test('AWD, generation and electric variant guards survive broadened searches',()=>{
  for(const [patch,reason] of [
    [{drivetrain:'RWD',trim:'Long Range RWD'},/tração incompatível/],
    [{generation:'2'},/geração incompatível/],
    [{trim:'Performance'},/versão elétrica incompatível/],
    [{fuel:'petrol'},/combustível diferente/],
    [{battery_kwh:45},/bateria incompatível/]
  ]){
    const r=evaluatePurchase({subject,comparables:[professional(1,patch)]});
    assert.equal(r.market.comparablesUsed,0,JSON.stringify(patch));
    assert.ok(r.excluded.some(x=>reason.test(x.reason)),JSON.stringify(patch));
  }
});

test('electric power is not waived for an unidentified variant',()=>{
  const r=evaluatePurchase({subject:{...subject,trim:null},comparables:[professional(1,{power_cv:514})]});
  assert.equal(r.market.comparablesUsed,0);
  assert.ok(r.excluded.some(x=>/potência incompatível/.test(x.reason)));
});

test('sold, foreign and unconfirmed conditioned prices cannot sustain a market',()=>{
  for(const patch of [{availability:'sold'},{country:'FR'},{price_basis:'net'},{price_conditioned:true,cash_price:null}]){
    const r=evaluatePurchase({subject,comparables:[professional(1,patch)]});
    assert.equal(r.market.comparablesUsed,0,JSON.stringify(patch));
    assert.equal(r.market.hasIndependentMarket,false);
  }
  const cash=evaluatePurchase({subject,comparables:[professional(1,{price:25000,price_conditioned:true,cash_price:32000})]});
  assert.equal(cash.comparables[0].price,32000);
});

test('matching specs from independent sellers do not collapse into one vehicle',()=>{
  const a=professional(1,{price:32000,mileage_km:55000});
  const b={...a,seller_name:'Independent seller',url:'https://other.example/car/1'};
  const r=evaluatePurchase({subject,comparables:[a,b]});
  assert.equal(r.market.comparablesUsed,2);
  const replicated=evaluatePurchase({subject,comparables:[a,{...a,url:'https://other.example/car/2'}]});
  assert.equal(replicated.market.comparablesUsed,1);
});

test('age and mileage adjustments stay positive and bounded on cheap cars',()=>{
  const car={make:'Renault',model:'Clio',fuel:'petrol',year:2005,mileage_km:200000};
  const ad={...car,year:2010,mileage_km:50000,url:'https://stand.example/cheap',price:1000,country:'PT',availability:'available',price_basis:'gross',seller_type:'professional'};
  const r=evaluatePurchase({subject:car,comparables:[ad]});
  assert.equal(r.market.comparablesUsed,1);
  assert.ok(r.comparables[0].adjustedPrice>=750);
  assert.ok(r.comparables[0].adjustedPrice<=1250);
});

test('zero samples without a known price report tier zero and zero confidence',()=>{
  const r=evaluatePurchase({subject:{...subject,price:null},comparables:[]});
  assert.equal(r.market.searchTier,0);
  assert.equal(r.market.confidencePct,0);
  assert.equal(r.market.hasIndependentMarket,false);
});


test('known manufacturer aliases share the same family identity',()=>{
  const car={make:'VW',model:'Golf',fuel:'diesel',year:2020,mileage_km:80000};
  const ad={...car,make:'Volkswagen',url:'https://stand.example/golf',price:18000};
  assert.equal(evaluatePurchase({subject:car,comparables:[ad]}).market.comparablesUsed,1);
});


test('a same-variant Tesla with absurd power is still rejected',()=>{
  const r=evaluatePurchase({subject,comparables:[professional(1,{power_cv:1500})]});
  assert.equal(r.market.comparablesUsed,0);
  assert.ok(r.excluded.some(x=>/potência incompatível/.test(x.reason)));
});

test('duplicate ordering retains verified professional evidence',()=>{
  const verified=professional(1);
  const first={...verified,seller_type:'unknown',evidence:{verified:false}};
  const r=evaluatePurchase({subject,comparables:[first,verified]});
  assert.equal(r.market.comparablesUsed,1);
  assert.equal(r.market.verifiedProfessionals,1);
  assert.equal(r.comparables[0].seller_type,'professional');
});

test('contradictory drive metadata survives repeated normalization',()=>{
  const raw={...subject,model:'Model Y Long Range RWD',drivetrain:'AWD',trim:null};
  const once=globalThis.CommercialIdentity.normalizeVehicleIdentity(raw);
  const twice=globalThis.CommercialIdentity.normalizeVehicleIdentity(once);
  assert.equal(twice.commercial_identity.drivetrain_conflict,true);
  const r=evaluatePurchase({subject:twice,comparables:[professional(1)]});
  assert.equal(r.market.comparablesUsed,0);
  assert.ok(r.excluded.some(x=>/tração contraditória/.test(x.reason)));
});


test('Volkswagen ID punctuation aliases preserve the model number',()=>{
  const identity=globalThis.CommercialIdentity;
  assert.equal(identity.sameModel({make:'VW',model:'ID.4'},{make:'Volkswagen',model:'ID 4'}),true);
  assert.equal(identity.sameModel({make:'VW',model:'ID.4'},{make:'Volkswagen',model:'ID 5'}),false);
  const car={make:'VW',model:'ID.4',fuel:'electric',year:2021,mileage_km:80000};
  const ad={...car,make:'Volkswagen',model:'ID 4',url:'https://stand.example/id4',price:24000};
  assert.equal(evaluatePurchase({subject:car,comparables:[ad]}).market.comparablesUsed,1);
});

