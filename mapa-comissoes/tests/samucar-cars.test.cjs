const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {registrationCompatible,finalizeMarketResponse,marketReady,mergeRegistration,estimateMileage}=require('../api/comparador-market')._test;
const load=name=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../comparador-auto-pro',name),'utf8')).toString('base64'));
const valuation=load('valuation.js'),input=load('input.js');

// Transcrição dos seis preçários. Versões não impressas continuam desconhecidas.
// Comparáveis abaixo são exclusivamente dados sintéticos de teste.
const cars=[
  {make:'Cupra',model:'Formentor',year:2021,fuel:'diesel',power_cv:150,mileage_km:132000,price:25990,registration:'AL-62-NP'},
  {make:'BMW',model:'225 XE',year:2017,fuel:'GASOLINA PLUG IN',power_cv:225,mileage_km:130000,price:15990,registration:'BC-75-NG'},
  {make:'Porsche',model:'Panamera',year:2013,fuel:'gasóleo',power_cv:250,mileage_km:270000,price:30990,registration:'BX-06-DA'},
  {make:'BMW',model:'118',year:2012,fuel:'gasóleo',power_cv:150,mileage_km:250000,price:13990,registration:null},
  {make:'BMW',model:'520D GT PACK M',year:2015,fuel:'gasóleo',power_cv:184,mileage_km:166000,price:19990,registration:'27-QJ-99'},
  {make:'Citroën',model:'C4 Grand Picasso',year:2016,fuel:'gasóleo',power_cv:120,mileage_km:216000,price:11990,registration:'AL-02-LT'}
];
const costs={transport:150,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100};
function comparable(subject,overrides={}){
  const {registration,...data}=subject;
  return {...data,price:subject.price+1300,mileage_km:subject.mileage_km+2000,
    url:'https://qa.example/independent-car',seller_type:'professional',country:'PT',
    availability:'available',price_basis:'gross',observed_at:new Date().toISOString(),
    evidence:{verified:true,source:'web_search',source_url_verified:true,observed_at:new Date().toISOString()},
    ...overrides};
}
function quote(subject,overrides={}){
  return {subject,comparables:[comparable(subject)],costs,target_margin:3500,
    source_context:{is_auction:false,vehicle_location:'PT'},...overrides};
}

for(const car of cars){
  const label=car.make+' '+car.model;
  test(label+': dados do preçário iniciam pesquisa sem inventar matrícula',async()=>{
    assert.equal(marketReady(car),true);
    const {parseVehicleInput}=await input;
    if(car.registration){
      assert.equal(parseVehicleInput(car.registration.replaceAll('-','').toLowerCase()).registration,car.registration);
    }else{
      assert.equal(parseVehicleInput('BMW 118 2012 gasóleo 250000 km').registration,undefined);
      assert.equal(car.registration,null);
    }
  });
  test(label+': margem e preparação reduzem o teto de compra',async()=>{
    const {evaluatePurchase}=await valuation;
    const base=quote(car),r=evaluatePurchase(base);
    assert.equal(r.market.comparablesUsed,1);
    assert.equal(r.purchase.effectiveCeiling,Math.max(0,Math.floor(r.market.saleLikely-r.purchase.fixedCosts-r.purchase.riskReserve-3500)));
    assert.ok(r.purchase.effectiveCeiling<r.market.saleLikely);
    const repaired=evaluatePurchase({...base,costs:{...costs,reconditioning:1450}});
    assert.equal(r.purchase.effectiveCeiling-repaired.purchase.effectiveCeiling,1000);
    assert.deepEqual(r.purchase,evaluatePurchase(base).purchase);
  });
  test(label+': sem mercado independente não recomenda compra',async()=>{
    const {evaluatePurchase}=await valuation;
    const r=evaluatePurchase(quote(car,{comparables:[]}));
    assert.equal(r.purchase.eligible,false);
    assert.equal(r.purchase.priceScenario,true);
    assert.equal(r.market.confidencePct,0);
    assert.ok(Number.isNaN(r.market.saleLikely));
    assert.ok(Number.isFinite(r.purchase.purchaseWithRepairs));
  });
  test(label+': data PT posterior preserva ano, quilómetros e preço confirmados',()=>{
    const r=mergeRegistration(car,{make:car.make,model:car.model,provider:'spottd',registration:car.registration,
      registration_date_pt:'2024-07-17',price:1,mileage_km:1});
    assert.equal(r.year,car.year);
    assert.equal(r.mileage_km,car.mileage_km);
    assert.equal(r.price,car.price);
  });
}

for(const [index,model] of [[1,'225xe'],[4,'520D GT'],[5,'Grand C4 Picasso']]){
  const car=cars[index];
  test(car.model+' / '+model+': matrícula equivalente não bloqueia a análise',async()=>{
    const reg={...car,model,provider:'spottd'};
    assert.equal(registrationCompatible(car,reg),true);
    assert.equal(registrationCompatible(reg,car),true);
    const r=await finalizeMarketResponse({status:'completed',output_text:JSON.stringify({subject:car,comparables:[]})},reg);
    assert.notEqual(r.valuation_blocked,true);
    assert.equal(r.subject.model,model);
    assert.equal(r.subject.price,car.price);
    assert.equal(r.subject.mileage_km,car.mileage_km);
  });
  test(car.model+' / '+model+': comparável equivalente continua utilizável',async()=>{
    const {evaluatePurchase}=await valuation;
    const r=evaluatePurchase(quote(car,{comparables:[comparable(car,{model})]}));
    assert.equal(r.market.comparablesUsed,1);
    assert.ok(Number.isFinite(r.purchase.effectiveCeiling));
  });
}

test('combustível plug-in do preçário equivale a PHEV, sem aceitar gasolina simples',async()=>{
  const {evaluatePurchase}=await valuation;
  const car={...cars[1],model:'225xe'};
  for(const fuel of ['GASOLINA PLUG IN','gasolina plug-in','híbrido plug-in','plug-in hybrid','PHEV']){
    const r=evaluatePurchase(quote({...car,fuel},{comparables:[comparable(car,{fuel:'phev'})]}));
    assert.equal(r.market.comparablesUsed,1,fuel);
  }
  for(const fuel of ['petrol','gasolina','hybrid','híbrido','diesel','electric']){
    const r=evaluatePurchase(quote(car,{comparables:[comparable(car,{fuel})]}));
    assert.equal(r.market.comparablesUsed,0,fuel);
    assert.ok(r.excluded.some(row=>row.reason==='combustível diferente'),fuel);
  }
});

test('normalização preserva diferenças de motor, carroçaria e modelo',async()=>{
  const {evaluatePurchase}=await valuation;
  for(const [car,model] of [
    [cars[1],'225e'],[cars[1],'225i'],[cars[3],'118d'],[cars[3],'118i'],
    [cars[4],'520D'],[cars[4],'520D Touring'],[cars[5],'C4 Picasso'],[cars[5],'C4']
  ]){
    assert.equal(registrationCompatible(car,{make:car.make,model}),false,car.model+' / '+model);
    const r=evaluatePurchase(quote(car,{comparables:[comparable(car,{model})]}));
    assert.equal(r.market.comparablesUsed,0,car.model+' / '+model);
  }
});

test('C4 Grand Picasso com ordem alternativa não conta a própria viatura outra vez',async()=>{
  const {evaluatePurchase}=await valuation;
  const car={...cars[5],registration:null,trim:'1.6 BlueHDi'};
  const r=evaluatePurchase(quote(car,{comparables:[comparable(car,{model:'Grand C4 Picasso',price:car.price,mileage_km:car.mileage_km})]}));
  assert.equal(r.market.comparablesUsed,0);
  assert.ok(r.excluded.some(row=>row.reason==='própria viatura / anúncio replicado'));
});

test('quilómetros em falta usam a referência PHEV equivalente e excluem gasolina simples',()=>{
  const car={...cars[1],mileage_km:null};
  const r=estimateMileage({subject:car,comparables:[
    comparable(cars[1],{url:'https://www.standvirtual.com/carros/anuncio/phev',model:'225xe',fuel:'phev',mileage_km:140000}),
    comparable(cars[1],{url:'https://www.standvirtual.com/carros/anuncio/petrol',model:'225xe',fuel:'petrol',mileage_km:5000})
  ]});
  assert.equal(r.subject.mileage_km,140000);
  assert.equal(r.subject.mileage_estimated,true);
  assert.equal(r.subject.mileage_estimate.sample_size,1);
});
