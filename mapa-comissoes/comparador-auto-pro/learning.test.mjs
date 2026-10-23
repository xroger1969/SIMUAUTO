import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
await import('./commercial-identity.js');
const source=await readFile(new URL('./valuation.js',import.meta.url),'utf8');
const {evaluatePurchase,automaticMargin,buildFeedbackRecord,feedbackRecordId,learningCalibration}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const car={make:'Tesla',model:'Model Y',trim:'Long Range',fuel:'electric',drivetrain:'AWD',battery_kwh:75,year:2023,mileage_km:50000,registration:'AA-00-AA',price:20000};
const comparable=i=>({...car,registration:'BB-'+i+'-CC',price:30000+i*100,url:'https://stand'+i+'.example/car',seller_type:'professional',country:'PT',price_basis:'gross',availability:'available',observed_at:new Date().toISOString(),evidence:{verified:true,observed_at:new Date().toISOString(),source_url_verified:true}});
const input={subject:car,comparables:[comparable(1),comparable(2),comparable(3)],costs:{transport:150,reconditioning:450},current_purchase_price:20000};
const baseline=evaluatePurchase(input);
function rule(i,kind='retail_sale',value=26000){return {...buildFeedbackRecord({userId:'owner',analysisId:'case-'+i,vehicle:{...car,registration:'AA-'+i+'-BB'},result:baseline,kind,value,feesConfirmed:true}),id:'row-'+i};}

test('automatic margins grow with resale price and explicit targets take precedence',()=>{
 assert.deepEqual([10000,15000,20000,25000,50000].map(automaticMargin),[3500,3500,4500,5000,7500]);
 const manual=evaluatePurchase({...input,target_margin:4250});
 assert.equal(manual.purchase.targetMargin,4250);assert.equal(manual.purchase.marginMode,'manual');
 assert.equal(evaluatePurchase({...input,target_margin:0}).purchase.targetMargin,0);
});
test('confirmed correction changes the next similar valuation, within 5%, without boosting evidence',()=>{
 const learned=evaluatePurchase({...input,learning_rules:[rule(1)]});
 assert.ok(learned.market.saleLikely<baseline.market.saleLikely);
 assert.ok(learned.market.saleLikely>=baseline.market.saleLikely*.95-1);
 assert.equal(learned.market.confidencePct,baseline.market.confidencePct);
 assert.equal(learned.market.saleBaseline,baseline.market.saleLikely);
 assert.ok(learned.purchase.effectiveCeiling<baseline.purchase.effectiveCeiling);
 const estimate=evaluatePurchase({...input,learning_rules:[rule(1,'retail_estimate')]});
 assert.ok(estimate.market.saleLikely>learned.market.saleLikely);
});
test('cannot learn itself, manufacture a sample by repeating an evaluation, or mix incompatible vehicles',()=>{
 const duplicate={...rule(1),id:'duplicate',analysis_id:'repeated'};
 assert.equal(learningCalibration([rule(1),duplicate],car).retailSamples,1);
 assert.equal(learningCalibration([rule(1)],car,{excludeAnalysisId:'case-1'}).retailSamples,0);
 for(const changes of [{battery_kwh:55},{trim:'Performance'},{fuel:'diesel'},{year:2020},{mileage_km:120000},{mileage_km:null},{battery_kwh:null}]){
  assert.equal(learningCalibration([rule(1)],{...car,...changes}).retailSamples,0);
 }
 assert.equal(learningCalibration([{...rule(1),active:false}],car).retailSamples,0);
 assert.equal(learningCalibration([{...rule(1),updated_at:'2025-01-01'}],car).retailSamples,0);
 assert.equal(learningCalibration([{...rule(1),scope:{...car,mileage_estimated:true}}],car).retailSamples,0);
});
test('unknown registrations deduplicate conservatively across different adverts',()=>{
 const a=rule(1),b=rule(2);delete a.scope.registration;delete b.scope.registration;
 a.effect.source_url='https://one.example/car';b.effect.source_url='https://two.example/car';
 assert.equal(learningCalibration([a,b],car).retailSamples,1);
});
test('bids cannot calibrate retail or trade prices; three completed cases can lower but never raise the buying ceiling',()=>{
 const bids=[1,2,3].map(i=>rule(i,'auction_bid',17000));
 assert.equal(learningCalibration(bids,car).tradeRatio,null);
 assert.equal(evaluatePurchase({...input,learning_rules:bids}).market.saleLikely,baseline.market.saleLikely);
 const hammers=[1,2,3].map(i=>rule(i,'auction_hammer',17000));
 const learned=evaluatePurchase({...input,learning_rules:hammers});
 assert.equal(learned.market.learning.tradeSamples,3);
 assert.ok(learned.purchase.effectiveCeiling<=17000);
 assert.equal(learned.market.saleLikely,baseline.market.saleLikely);
 const expensive=evaluatePurchase({...input,learning_rules:[1,2,3].map(i=>rule(i,'auction_hammer',29000))});
 assert.equal(expensive.purchase.effectiveCeiling,baseline.purchase.effectiveCeiling);
 hammers[0].effect.fees_confirmed=false;
 assert.equal(learningCalibration(hammers,car).tradeRatio,null);
});
test('at least three independent choices calibrate the margin, bounded by the price policy',()=>{
 const margins=[1,2,3].map(i=>rule(i,'margin',8000));
 assert.equal(learningCalibration(margins.slice(0,2),car).learnedMargin,null);
 const r=evaluatePurchase({...input,learning_rules:margins});
 assert.equal(r.purchase.marginMode,'learned');assert.ok(r.purchase.targetMargin<=r.purchase.automaticTarget*1.3+25);
 assert.equal(evaluatePurchase({...input,learning_rules:margins,target_margin:4000}).purchase.targetMargin,4000);
});
test('learning never invents a market where there are no independent adverts',()=>{
 const r=evaluatePurchase({...input,comparables:[],learning_rules:[rule(1)]});
 assert.equal(r.market.hasIndependentMarket,false);assert.ok(Number.isNaN(r.market.saleLikely));
 assert.equal(r.purchase.eligible,false);
});
test('feedback IDs are stable on retries, distinct by owner/case/kind, and values are validated',async()=>{
 const a=await feedbackRecordId('owner','case','retail_sale',webcrypto);
 assert.equal(a,await feedbackRecordId('owner','case','retail_sale',webcrypto));
 assert.notEqual(a,await feedbackRecordId('other','case','retail_sale',webcrypto));
 assert.notEqual(a,await feedbackRecordId('owner','case','auction_bid',webcrypto));
 assert.match(a,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 for(const value of [null,'',NaN,Infinity,-1,0,10000001])assert.throws(()=>rule(1,'retail_sale',value));
});
