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
test('missing km launches market research so V2 can estimate it',async()=>{
  const h=harness({vehicle:{...subject,mileage_km:null}});const r=await h.poll();
  assert.equal(r.status,202);assert.equal(h.counts().researchCalls,1);assert.equal(h.job.context.stage,'market');
  assert.equal(h.job.context.previous_subject.mileage_km,null);
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

test('provider outage keeps explicit plate and does not block a visually identified vehicle',async()=>{
  const h=harness();
  const result=await h.ctx.module.exports._test.finalizeMarketResponse({
    status:'completed',
    metadata:{cap_registration:'14-ID-91',cap_registration_lookup:'unavailable'},
    output_text:JSON.stringify({subject:{...subject,registration:'14-ID-91'},comparables:[],risk_flags:[],data_quality:{completeness_pct:80,uncertain_fields:[],notes:''}})
  },null,'test');
  assert.notEqual(result.valuation_blocked,true);
  assert.equal(result.subject.registration,'14-ID-91');
  assert.ok(result.risk_flags.some(r=>r.code==='registration_lookup_unavailable'));
});

test('typed plate mismatch with photographed plate still blocks',async()=>{
  const h=harness();
  const result=await h.ctx.module.exports._test.finalizeMarketResponse({
    status:'completed',
    metadata:{cap_registration:'14-ID-91',cap_registration_lookup:'unavailable'},
    output_text:JSON.stringify({subject:{...subject,registration:'AA-00-AA'},comparables:[],risk_flags:[],data_quality:{completeness_pct:80,uncertain_fields:[],notes:''}})
  },null,'test');
  assert.equal(result.valuation_blocked,true);
  assert.ok(result.risk_flags.some(r=>r.code==='registration_unconfirmed'));
});

test('bounded context preserves plate when supplier lookup fails',()=>{
  const {boundedContext}=require('../api/comparador-market')._test;
  const ctx=boundedContext({registration:'14-ID-91'},null,'supplier unavailable');
  assert.equal(ctx.registration_input,'14-ID-91');
  assert.equal(ctx.registration_lookup_warning,'supplier unavailable');
});

test('registration-only identification may use web search when provider is unavailable',async()=>{
  const h=harness();let body;
  h.ctx.fetch=async(u,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({id:'resp_plate'})};};
  await h.ctx.module.exports._test.startResponse({registration_input:'14-ID-91',original_url:null,text_sample:''},[],{},true);
  assert.deepEqual(body.tools,[{type:'web_search'}]);
  assert.equal(body.tool_choice,'auto');
});

test('Standvirtual mileage mean is labelled estimated and ignores duplicates and other portals',()=>{
  const {estimateMileage}=require('../api/comparador-market')._test;
  const car={...subject,registration:'AA-00-AA',mileage_km:null};
  const ad=(id,km)=>({...subject,url:'https://www.standvirtual.com/carros/anuncio/'+id,mileage_km:km,seller_type:'professional',country:'PT',availability:'available',evidence:{source_url_verified:true}});
  const a=ad('one',80000),b=ad('two',120000);
  const r=estimateMileage({subject:car,comparables:[a,b,a,{...ad('other',900000),url:'https://olx.pt/car/1'}]});
  assert.equal(r.subject.mileage_km,100000);assert.equal(r.subject.mileage_estimated,true);assert.equal(r.subject.mileage_estimate.sample_size,2);
  assert.equal(estimateMileage({subject:{...car,mileage_km:90000},comparables:[a,b]}).subject.mileage_km,90000);
});
test('reported Standvirtual URLs can supply provisional km while incompatible adverts cannot',()=>{
  const {estimateMileage}=require('../api/comparador-market')._test;
  const car={...subject,registration:'AA-00-AA',mileage_km:null};
  const base={...subject,url:'https://www.standvirtual.com/carros/anuncio/1',mileage_km:80000,country:'PT',availability:'available',evidence:{}};
  assert.equal(estimateMileage({subject:car,comparables:[base]}).subject.mileage_km,80000);
  for(const patch of [{make:'BMW'},{model:'Model 3'},{fuel:'diesel'},{mileage_km:null},{availability:'sold'}])assert.equal(estimateMileage({subject:car,comparables:[{...base,...patch}]}).subject.mileage_km,null);
});
test('estimated mileage is removed before asking AI to read later real mileage',()=>{
  const {boundedContext}=require('../api/comparador-market')._test;
  const ctx=boundedContext({previous_subject:{...subject,mileage_km:100000,mileage_estimated:true}},null);
  assert.equal(ctx.previous_subject.mileage_km,null);assert.equal(ctx.previous_subject.mileage_estimated,false);
});

test('V2 market readiness allows missing trim fuel and mileage once plate identifies make model and year',()=>{
  const {marketReady}=require('../api/comparador-market')._test;
  assert.equal(marketReady({registration:'24-GV-85',make:'Citroen',model:'Berlingo',year:2008,trim:null,fuel:null,mileage_km:null}),true);
});
test('search source extraction walks nested response structures',()=>{
  const {searchSources}=require('../api/comparador-market')._test;
  const rows=searchSources({output:[{type:'web_search_call',action:{results:[{sources:[{url:'https://www.standvirtual.com/carros/anuncio/x',title:'Berlingo'}]}]}}]});
  assert.equal(rows.length,1);assert.match(rows[0].url,/standvirtual/);
});
