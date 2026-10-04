const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const {registrationCompatible,mergeRegistration,missingIdentity}=require('../api/comparador-market')._test;
const subject={make:'Tesla',model:'Model Y',trim:'Long Range',year:2023,mileage_km:50000,fuel:'electric',price:30000};
function harness({vehicle=subject,provider={make:'BMW',model:'320d'},cache=[],stage='identify'}={}){
  let providerCalls=0,researchCalls=0,cacheWrites=0;
  const job={id:'00000000-0000-4000-8000-000000000001',response_id:'resp_1',context:{stage},status:'in_progress'};
  const output={status:'completed',output_text:JSON.stringify({subject:vehicle,comparables:[]})};
  const access={authenticate:async()=>({token:'test'}),endpoint:fn=>fn,appError:(m,s)=>Object.assign(new Error(m),{status:s}),rest:async(t,p,o={})=>{
    if(p.startsWith('cap_registration_cache')){if(o.method==='POST'){cacheWrites++;return null;}return cache;}
    if(p.startsWith('cap_jobs?select'))return [structuredClone(job)];
    if(o.method==='PATCH'){if(p.includes('stage=eq.identify')&&job.context.stage!=='identify')return [];Object.assign(job,o.body);return [job];}
    throw Error(p);
  }};
  const ctx={module:{exports:{}},require:p=>p==='../lib/access'?access:p==='../lib/registration'?{...require('../lib/registration'),lookupRegistration:async()=>{providerCalls++;return provider;}}:require(path.resolve(base,'api',p)),console,process:{env:{OPENAI_API_KEY:'test'}},URL,Date,Set,AbortSignal,
    fetch:async(url,o)=>{if(o?.method==='POST'){researchCalls++;return {ok:true,json:async()=>({id:'resp_market',status:'queued'})};}return {ok:true,json:async()=>output};}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(base+'/api/comparador-market.js','utf8'),ctx);
  return {ctx,job,counts:()=>({providerCalls,researchCalls,cacheWrites}),poll:async()=>{let status,result;await ctx.module.exports({method:'GET',query:{job_id:job.id}},{status:n=>{status=n;return {json:x=>{result=x;}}}});return {status,result};}};
}
test('different Tesla and VW models never share identity merely through a word',()=>{
  for(const [a,b] of [['Model Y','Model 3'],['ID.4','ID.5'],['Golf','Golf Plus']])assert.equal(registrationCompatible({make:'Tesla',model:a},{make:'Tesla',model:b}),false);
  assert.equal(registrationCompatible({make:'VW',model:'ID.4'},{make:'Volkswagen',model:'ID 4'}),true);
});
test('unknown km requires confirmation; explicit zero is allowed',()=>{
  for(const value of [null,undefined,'',-1,'unknown'])assert.ok(missingIdentity({...subject,mileage_km:value}).includes('mileage_km'));
  assert.deepEqual(missingIdentity({...subject,mileage_km:0}),[]);
});
test('registration cannot overwrite confirmed price mileage or trim',()=>{
  const r=mergeRegistration(subject,{make:'Tesla',model:'Model Y',trim:'RWD',price:1,mileage_km:0});
  assert.equal(r.price,30000);assert.equal(r.mileage_km,50000);assert.equal(r.trim,'Long Range');
});
test('photo mismatch blocks before any research is launched',async()=>{
  const h=harness({vehicle:{...subject,registration:'AA-00-AA'}});const r=await h.poll();
  assert.equal(r.result.valuation_blocked,true);assert.equal(r.result.comparables.length,0);assert.equal(h.counts().researchCalls,0);
});
test('missing km returns a follow-up without research',async()=>{
  const h=harness({vehicle:{...subject,mileage_km:null}});const r=await h.poll();
  assert.ok(r.result.missing_fields.includes('mileage_km'));assert.equal(h.counts().researchCalls,0);
});
test('complete identity launches research as the second stage',async()=>{
  const h=harness();const r=await h.poll();assert.equal(r.status,202);assert.equal(h.counts().researchCalls,1);assert.equal(h.job.context.stage,'market');assert.equal(h.job.context.previous_subject.price,30000);
});
test('cache hit avoids provider and preserves complete data',async()=>{
  const h=harness({vehicle:{...subject,registration:'AA-00-AA'},cache:[{data:{make:'Tesla',model:'Model Y',registration:'AA-00-AA'}}]});await h.poll();assert.equal(h.counts().providerCalls,0);assert.equal(h.counts().researchCalls,1);
});
test('cache miss stores provider result once',async()=>{
  const h=harness({vehicle:{...subject,registration:'AA-00-AA'},provider:{make:'Tesla',model:'Model Y',registration:'AA-00-AA'}});await h.poll();assert.equal(h.counts().providerCalls,1);assert.equal(h.counts().cacheWrites,1);
});
test('photo identification has no web search tool',async()=>{
  const h=harness();let body;h.ctx.fetch=async(u,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({id:'resp_photo'})};};
  await h.ctx.module.exports._test.startResponse({},['data:image/jpeg;base64,YWJj'],{},true);assert.deepEqual(body.tools,[]);
});
test('UI requests null km and registration conflict confirmation',()=>{
  const s=fs.readFileSync(base+'/comparador-auto-pro/app-v2.js','utf8');const ctx={};vm.createContext(ctx);vm.runInContext(s.slice(s.indexOf('const VALUATION_REQUIRED_FIELDS='),s.indexOf('function followupQuestion')),ctx);
  assert.ok(ctx.missingVehicleFields({...subject,mileage_km:null}).some(f=>f.key==='mileage_km'));
  assert.ok(ctx.missingVehicleFields(subject,{valuation_blocked:true}).some(f=>f.key==='registration'));
});

test('simultaneous polls launch only one market search',async()=>{
  const h=harness();await Promise.all([h.poll(),h.poll()]);assert.equal(h.counts().researchCalls,1);
});
test('previously supplied registration is also checked against vehicle',async()=>{
  const h=harness();const result=await h.ctx.module.exports._test.finalizeMarketResponse({status:'completed',output_text:JSON.stringify({subject,comparables:[]})},{make:'BMW',model:'320d'});
  assert.equal(result.valuation_blocked,true);assert.equal(result.subject.make,'Tesla');
});
