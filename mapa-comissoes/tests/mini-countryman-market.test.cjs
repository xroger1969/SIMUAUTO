const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeVehicleIdentity,sameModel,modelFamilyKey,selectEligibleComparables}=require('../comparador-auto-pro/commercial-identity');
const {registrationCompatible,finalizeMarketResponse,marketSearchPlan,estimateMileage}=require('../api/comparador-market')._test;

// Synthetic prices/URLs exercise the flow; these are not market quotations.
const provider={registration:'AA-00-AA',make:'MINI',model:'Countryman Cooper D (FMX)',trim:null,
  year:2017,fuel:'GASOLEO',power_cv:150,power_kw:110,provider:'spottd'};
const photo={registration:'AA-00-AA',make:'Mini',model:'Countryman',trim:'Cooper D',
  year:2017,fuel:'diesel',mileage_km:null,power_cv:150};
const advert=(patch={})=>({...photo,registration:null,url:'https://stand.example/mini-countryman',
  seller_type:'professional',country:'PT',availability:'available',price_basis:'gross',price:19900,
  mileage_km:110000,...patch});

test('MINI provider model separates Countryman and Cooper D without losing raw data',()=>{
  const result=normalizeVehicleIdentity(provider);
  assert.equal(result.model,'Countryman');
  assert.equal(result.trim,'Cooper D');
  assert.equal(result.fuel,'diesel');
  assert.equal(result.commercial_identity.raw.model,'Countryman Cooper D (FMX)');
  assert.equal(modelFamilyKey(provider.make,provider.model),'countryman');
  assert.deepEqual(normalizeVehicleIdentity(result),result);
  for(const model of ['Countryman Cooper D (FMX)','Cooper D Countryman','MINI COUNTRYMAN Cooper D']){
    assert.equal(registrationCompatible(photo,{...provider,model}),true,model);
  }
});

test('MINI photo and plate identity proceeds to usable market data instead of blocking',async()=>{
  const result=await finalizeMarketResponse({status:'completed',metadata:{cap_registration:'AA-00-AA'},
    output_text:JSON.stringify({subject:photo,comparables:[advert()]})},provider);
  assert.notEqual(result.valuation_blocked,true);
  assert.equal(result.subject.model,'Countryman');
  assert.equal(result.subject.trim,'Cooper D');
  assert.equal(selectEligibleComparables(result.subject,result.comparables).rows.length,1);
  estimateMileage(result);
  assert.equal(result.market_selection.accepted_count,1);
  assert.equal(result.subject.mileage_km,110000);
  assert.equal(result.subject.mileage_estimated,true);
  const plan=marketSearchPlan(provider,0);
  assert.equal(plan.model,'Countryman');
  assert.equal(plan.trim,'Cooper D');
});

test('observed November 5 MINI conflict treats Cooper D (FMX) and Cooper D FMX as the same identity',async()=>{
  const observed={...photo,trim:'Cooper D (FMX)'};
  const registration={...provider,model:'Countryman Cooper D',trim:'FMX'};
  assert.equal(registrationCompatible(observed,registration),true);
  const result=await finalizeMarketResponse({status:'completed',metadata:{cap_registration:'AA-00-AA'},
    output_text:JSON.stringify({subject:observed,comparables:[advert()]})},registration);
  assert.notEqual(result.valuation_blocked,true);
  assert.equal(result.subject.model,'Countryman');
  assert.equal(result.subject.trim,'Cooper D (FMX)');
  assert.equal(selectEligibleComparables(result.subject,result.comparables).rows.length,1);
});

test('MINI normalization keeps explicit bodies and variants distinct',()=>{
  for(const patch of [
    {model:'Clubman',trim:'Cooper D'}, {model:'Paceman',trim:'Cooper D'},
    {model:'Cooper D',trim:null}, {model:'Countryman',trim:'Cooper SD'},
    {model:'Countryman Cooper SE ALL4',trim:null}, {model:'Countryman',trim:'Cooper S'},
    {model:'Countryman',trim:'John Cooper Works'}, {make:'BMW'}
  ])assert.equal(registrationCompatible(photo,{...provider,...patch}),false,JSON.stringify(patch));
  assert.equal(sameModel(photo,{...photo,model:'Countryman / Clubman',trim:'Cooper D'}),false);
  assert.equal(sameModel(photo,{...photo,model:'Countryman Cooper SD',trim:'Cooper D'}),false);
  for(const patch of [{fuel:'petrol'},{drivetrain:'ALL4'},{generation:'U25'}]){
    const car={...photo,drivetrain:'FWD',generation:'F60'};
    assert.equal(selectEligibleComparables(car,[advert(patch)]).rows.length,0,JSON.stringify(patch));
  }
});

test('MINI SE ALL4 spelling preserves the explicit PHEV version and all-wheel drive',()=>{
  const car=normalizeVehicleIdentity({make:'MINI',model:'Cooper S E Countryman ALL4',fuel:'phev'});
  assert.equal(car.model,'Countryman');assert.equal(car.drivetrain,'awd');
  assert.equal(sameModel(car,{make:'MINI',model:'Countryman',trim:'Cooper SE ALL4',fuel:'phev'}),true);
  assert.equal(sameModel(car,{make:'MINI',model:'Countryman',trim:'Cooper D',fuel:'diesel'}),false);
});
