const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {sameModel,modelFamilyKey,selectEligibleComparables}=require('../comparador-auto-pro/commercial-identity');
const {marketSearchPlan,estimateMileage,registrationCompatible,marketReady,reuseInputCache}=require('../api/comparador-market')._test;
const snapshot=require('./fixtures/captur-diesel-market.json');

test('reusing pre-fix evidence refreshes eligibility and estimated km without changing the evidence timestamp',()=>{
  const cached={id:'old-job',updated_at:'2026-11-04T16:24:07.755Z',result:{...structuredClone(snapshot),market_selection:{accepted_count:0}}};
  const result=reuseInputCache(cached,'same-input');
  assert.ok(result.market_selection.accepted_count>0);
  assert.equal(result.subject.mileage_estimated,true);
  assert.equal(result.market_cache.snapshot_at,cached.updated_at);
  assert.equal(cached.result.subject.mileage_km,null);
  assert.equal(cached.result.market_selection.accepted_count,0);
});

test('production Captur Diesel snapshot recovers actual adverts without requiring trim or km',async()=>{
  const result=estimateMileage(structuredClone(snapshot));
  assert.ok(result.market_selection.accepted_count>0);
  assert.ok(!result.market_selection.exclusions.some(x=>x.reason==='modelo diferente ou desconhecido'));
  assert.equal(result.subject.trim,null);
  assert.equal(result.subject.mileage_estimated,true);
  assert.ok(result.subject.mileage_km>0);
  assert.equal(marketSearchPlan(snapshot.subject,1).family_model,'captur');
  assert.equal(registrationCompatible(snapshot.subject,{make:'Renault',model:'Captur'}),true);
  assert.equal(registrationCompatible(snapshot.subject,{make:'Renault',model:'Clio'}),false);
  const source=fs.readFileSync(path.join(__dirname,'../comparador-auto-pro/valuation.js'),'utf8');
  const {evaluatePurchase}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const valuation=evaluatePurchase({subject:result.subject,comparables:result.comparables});
  assert.ok(valuation.market.marketValue>0);
  assert.ok(valuation.purchase.purchaseWithoutRepairs>0);
  assert.ok(valuation.purchase.purchaseWithRepairs>0);
});

test('fuel suffixes do not change the model family or erase body distinctions',()=>{
  for(const [make,model,suffix] of [['Renault','Clio','Diesel'],['Renault','Captur','Gasóleo'],['Ford','Fiesta','Petrol'],['Peugeot','208','Gasolina']]){
    assert.equal(modelFamilyKey(make,model+' '+suffix),modelFamilyKey(make,model));
    assert.equal(sameModel({make,model:model+' '+suffix},{make,model}),true);
    assert.equal(sameModel({make,model},{make,model:model+' '+suffix}),true);
  }
  assert.equal(sameModel({make:'Renault',model:'Clio Diesel'},{make:'Renault',model:'Captur'}),false);
  assert.equal(sameModel({make:'Volkswagen',model:'Golf Plus Diesel'},{make:'Volkswagen',model:'Golf'}),false);
  assert.equal(modelFamilyKey('Renault','Clio Diesel'),'clio');
});

test('Clio Diesel permits a single approximate diesel advert, while excluding petrol and Captur',()=>{
  const subject={make:'Renault',model:'Clio Diesel',fuel:'diesel',year:2015,trim:null,mileage_km:null};
  const ad={make:'Renault',model:'Clio',trim:'1.5 dCi',fuel:'diesel',year:2017,mileage_km:140000,price:9000,url:'https://stand.example/clio/1',country:'PT',price_basis:'gross',seller_type:'professional',availability:'available'};
  const selected=selectEligibleComparables(subject,[ad,{...ad,url:'https://stand.example/clio/2',fuel:'petrol'},{...ad,url:'https://stand.example/captur/3',model:'Captur'}]);
  assert.equal(marketReady(subject),true);
  assert.equal(selected.rows.length,1);
  assert.equal(selected.rows[0].comp.url,ad.url);
  assert.ok(selected.excluded.some(x=>x.reason==='combustível diferente'));
  assert.ok(selected.excluded.some(x=>x.reason==='modelo diferente ou desconhecido'));
});
