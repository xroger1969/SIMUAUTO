const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const identity=require('../comparador-auto-pro/commercial-identity.js');
const {estimateMileage,mergeRegistration}=require('../api/comparador-market.js')._test;
const fixture=require('./fixtures/al47ic-market.json');
const bmwPhoto=require('./fixtures/bmw225e-photo-identity.json');
const engine=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.resolve(__dirname,'../comparador-auto-pro/valuation.js'),'utf8')).toString('base64'));
const urls=rows=>rows.map(row=>row.comp?.url||row.url).sort();
const marketInput=()=>({subject:structuredClone(fixture.subject),comparables:structuredClone(fixture.comparables),risk_flags:[],data_quality:{}});

test('BMW photo and Spottd identity reaches the pricing engine using a synthetic compatible advert',async()=>{
  const {evaluatePurchase}=await engine;
  const subject=mergeRegistration(bmwPhoto.subject,bmwPhoto.registration_data);
  const comparable={...subject,registration:null,model:'Serie-2 Active Tourer (U06)',trim:'225 e xDrive',mileage_km:90000,
    price:30000,url:'https://stand.example/synthetic-bmw',seller_type:'professional',country:'PT',availability:'available',price_basis:'gross'};
  const result=evaluatePurchase({subject,comparables:[comparable]});
  assert.equal(result.market.comparablesUsed,1);
  assert.ok(result.purchase.effectiveCeiling>0);
  assert.ok(result.purchase.effectiveCeiling<result.market.marketValue);
  assert.equal(result.purchase.eligible,false,'One synthetic reference must remain provisional');
  assert.equal(result.subject.price,null,'The hidden auction bid must never be fabricated');
  for(const patch of [{model:'Série 2 Gran Tourer'},{fuel:'petrol'},{generation:'F45'},{drivetrain:'fwd'}]){
    const bad=evaluatePurchase({subject,comparables:[{...comparable,...patch}]});
    assert.equal(bad.market.comparablesUsed,0,JSON.stringify(patch));
  }
});

test('real AL47IC snapshot uses the same eligible cohort for estimated mileage and final prices',async()=>{
  const {evaluatePurchase}=await engine;
  const market=marketInput();
  const before=identity.selectEligibleComparables(market.subject,market.comparables);
  assert.ok(before.rows.length>0,'The original model/trim shape must yield real useful references');
  estimateMileage(market);
  const result=evaluatePurchase({subject:market.subject,comparables:market.comparables});
  assert.equal(result.subject.model,'Model Y');
  assert.equal(result.subject.mileage_estimated,true);
  assert.deepEqual(urls(result.comparables),urls(before.rows));
  assert.deepEqual([...market.market_selection.accepted_urls].sort(),urls(result.comparables));
  assert.deepEqual([...market.subject.mileage_estimate.urls].sort(),urls(result.comparables));
  assert.equal(market.subject.mileage_estimate.sample_size,result.market.comparablesUsed);
  assert.ok(Number.isFinite(result.purchase.effectiveCeiling));
  assert.equal(result.purchase.eligible,false,'An inferred odometer cannot produce a firm recommendation');
  assert.ok(result.market.confidencePct<=45);
});

test('repeated mileage estimation preserves the cohort, mean and purchase ceiling',async()=>{
  const {evaluatePurchase}=await engine;
  const market=estimateMileage(marketInput());
  const first=evaluatePurchase({subject:market.subject,comparables:market.comparables});
  const mean=market.subject.mileage_km;
  const accepted=[...market.market_selection.accepted_urls].sort();
  estimateMileage(market);
  const second=evaluatePurchase({subject:market.subject,comparables:market.comparables});
  assert.equal(market.subject.mileage_km,mean);
  assert.deepEqual([...market.market_selection.accepted_urls].sort(),accepted);
  assert.equal(second.purchase.effectiveCeiling,first.purchase.effectiveCeiling);
  assert.equal(second.market.marketValue,first.market.marketValue);
});

test('sold, foreign and incompatible-drive ads cannot affect mileage or purchase values',async()=>{
  const {evaluatePurchase}=await engine;
  const market=marketInput(),base=structuredClone(market.comparables[0]);
  const bad=[
    {...base,url:'https://example.test/sold',availability:'sold',mileage_km:999999,price:1000},
    {...base,url:'https://example.test/foreign',country:'DE',mileage_km:1,price:1000},
    {...base,url:'https://example.test/rwd',trim:'Standard Range RWD',drivetrain:'RWD',mileage_km:1,price:1000}
  ];
  const original=estimateMileage(structuredClone(market));
  market.comparables.push(...bad);
  estimateMileage(market);
  const a=evaluatePurchase({subject:original.subject,comparables:original.comparables});
  const b=evaluatePurchase({subject:market.subject,comparables:market.comparables});
  assert.equal(market.subject.mileage_km,original.subject.mileage_km);
  assert.equal(b.purchase.effectiveCeiling,a.purchase.effectiveCeiling);
  assert.deepEqual(urls(b.comparables),urls(a.comparables));
  for(const ad of bad)assert.ok(b.excluded.some(row=>row.url===ad.url));
});

test('registration merge preserves a confirmed commercial trim and user odometer through evaluation',async()=>{
  const {evaluatePurchase}=await engine;
  const subject=mergeRegistration({...fixture.subject,model:'Model Y',trim:'Long Range AWD',mileage_km:72000,mileage_estimated:false,price:22000},fixture.registration_data);
  assert.equal(subject.model,'Model Y');
  assert.equal(subject.trim.toLowerCase(),'long range awd');
  assert.equal(subject.mileage_km,72000);
  assert.equal(subject.price,22000);
  const market=estimateMileage({subject,comparables:structuredClone(fixture.comparables)});
  assert.equal(market.subject.mileage_km,72000);
  const result=evaluatePurchase({subject:market.subject,comparables:market.comparables});
  assert.equal(result.subject.mileage_estimated,false);
  assert.ok(result.market.comparablesUsed>0);
});

test('the opportunity itself is excluded from both the mileage and price cohort',async()=>{
  const {evaluatePurchase}=await engine;
  const market=marketInput();
  market.source_url=market.comparables[0].url;
  estimateMileage(market);
  const result=evaluatePurchase({subject:market.subject,comparables:market.comparables,source_url:market.source_url});
  assert.ok(!market.subject.mileage_estimate.urls.includes(market.source_url));
  assert.ok(!result.comparables.some(row=>row.url===market.source_url));
  assert.deepEqual([...market.market_selection.accepted_urls].sort(),urls(result.comparables));
});
