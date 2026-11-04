const test=require('node:test');
const assert=require('node:assert/strict');
const {collectMarketJob}=require('../lib/market-worker');
const {jobProgress}=require('../api/comparador-market')._test;

test('server collects identification and final research without browser polling',async()=>{
  let calls=0,time=0;
  const stages=[{status:202,data:{stage:'identify'}},{status:202,data:{stage:'market'}},{status:200,data:{subject:{make:'Peugeot'},comparables:[{}]}}];
  const result=await collectMarketJob(async()=>stages[calls++],{now:()=>time,deadline:30000,sleep:async ms=>{time+=ms;}});
  assert.equal(calls,3);assert.equal(result.status,200);assert.equal(result.data.subject.make,'Peugeot');
});
test('background collection stops on cancellation, expired auth and billing failure',async()=>{
  for(const status of [401,402,403,409]){
    let calls=0;
    await collectMarketJob(async()=>{calls++;throw Object.assign(Error('terminal'),{status});},{sleep:async()=>{}});
    assert.equal(calls,1);
  }
});
test('transient failures retry within bounds; terminal response and runtime budget stop collection',async()=>{
  let calls=0;
  const result=await collectMarketJob(async()=>{if(++calls<3)throw Error('network');return {status:200};},{sleep:async()=>{}});
  assert.equal(calls,3);assert.equal(result.status,200);
  calls=0;
  await collectMarketJob(async()=>{calls++;throw Error('network');},{sleep:async()=>{}});
  assert.equal(calls,3);
  calls=0;let time=0;
  await collectMarketJob(async()=>{calls++;return {status:202};},{now:()=>time,deadline:9000,sleep:async ms=>{time+=ms;}});
  assert.equal(calls,3);
});
test('progress reports observed stage and vehicle without exposing prompts or secrets',()=>{
  const progress=jobProgress({created_at:new Date(Date.now()-75000).toISOString(),context:{stage:'market',market_search_step:1,previous_subject:{make:'Peugeot',model:'2008',year:2021,mileage_km:120235},secret:'private'}},{output:[{type:'web_search_call',status:'completed'},{type:'web_search_call',status:'in_progress'}]});
  assert.equal(progress.stage,'market');assert.equal(progress.searches_completed,1);
  assert.equal(progress.vehicle.mileage_km,120235);assert.ok(progress.elapsed_seconds>=75);
  assert.doesNotMatch(JSON.stringify(progress),/secret|private/);
});
