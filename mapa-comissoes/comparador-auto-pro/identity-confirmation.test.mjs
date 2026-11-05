import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
await import(new URL('./commercial-identity.js',import.meta.url));
const source=await readFile(new URL('./valuation.js',import.meta.url),'utf8');
const {evaluatePurchase}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const subject={make:'Tesla',model:'Model Y',trim:'Long Range',generation:'1',fuel:'electric',battery_kwh:75,power_cv:350,
  drivetrain:'AWD',transmission:'automatic',year:2023,mileage_km:50000,price:25000,origin:'national'};
const observed=new Date().toISOString();
const professional=i=>({...subject,price:31500+i*250,mileage_km:50000+i*2500,url:'https://stand'+i+'.example/car/'+i,
  source_domain:'stand'+i+'.example',listing_id:'listing-'+i,seller_type:'professional',seller_name:'Stand '+i,
  country:'PT',availability:'available',price_basis:'gross',observed_at:observed,
  evidence:{verified:true,observed_at:observed,source:'web_search',source_url_verified:true}});
const input={subject,comparables:[professional(1),professional(2),professional(3)],target_margin:3500,
  costs:{transport:150,reconditioning:450,warranty_reserve:350},risk_reserve:200};

test('user-confirmed identity produces a provisional estimate without changing the price calculation',()=>{
  const verified=evaluatePurchase(input);
  assert.equal(verified.purchase.eligible,true);
  for(const patch of [{subject:{...subject,identity_source:'user_confirmed'}},{risk_flags:[{code:'identity_user_confirmed'}]}]){
    const manual=evaluatePurchase({...input,...patch});
    assert.equal(manual.purchase.eligible,false);
    assert.equal(manual.purchase.provisionalEligible,true);
    assert.equal(manual.market.confidencePct,45);
    assert.ok(Number.isNaN(manual.purchase.maxPurchase));
    assert.equal(manual.purchase.provisionalMaxPurchase,verified.purchase.maxPurchase);
    for(const field of ['marketValue','saleBaseline','saleLikely','saleFast'])assert.equal(manual.market[field],verified.market[field],field);
    for(const field of ['effectiveCeiling','purchaseWithRepairs','purchaseWithoutRepairs','targetMargin','fixedCosts','riskReserve'])assert.equal(manual.purchase[field],verified.purchase[field],field);
    assert.match(manual.warnings.join(' '),/Identidade confirmada por ti.*provisória/);
    assert.match(manual.purchase.decision,/provisóri/);
  }
});

test('a manual identity does not raise weaker evidence or invent prices without market references',()=>{
  const manual={...subject,identity_source:'user_confirmed'};
  const privateAd={...professional(1),seller_type:'private',evidence:{}};
  const weak=evaluatePurchase({...input,subject:manual,comparables:[privateAd]});
  const weakOriginal=evaluatePurchase({...input,comparables:[privateAd]});
  assert.equal(weak.market.confidencePct,weakOriginal.market.confidencePct);
  assert.ok(weak.market.confidencePct<45);
  assert.equal(weak.purchase.provisionalEligible,true);
  const empty=evaluatePurchase({...input,subject:{...manual,price:null},comparables:[]});
  assert.equal(empty.market.confidencePct,0);
  assert.equal(empty.purchase.eligible,false);
  assert.equal(empty.purchase.provisionalEligible,false);
  assert.ok(Number.isNaN(empty.purchase.effectiveCeiling));
});

test('a user-confirmed flag cannot override an unresolved explicit identity block',()=>{
  for(const block of [{valuation_blocked:true},{risk_flags:[{code:'identity_user_confirmed'},{code:'registration_unconfirmed'}]}]){
    const result=evaluatePurchase({...input,subject:{...subject,identity_source:'user_confirmed'},...block});
    assert.equal(result.purchase.eligible,false);
    assert.equal(result.purchase.provisionalEligible,false);
    assert.ok(Number.isNaN(result.purchase.effectiveCeiling));
  }
});
