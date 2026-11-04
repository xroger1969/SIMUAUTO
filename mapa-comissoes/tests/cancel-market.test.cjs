const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const apiPath=path.resolve(__dirname,'../api/comparador-market.js');
const analysis='00000000-0000-4000-8000-000000000001';
const request='00000000-0000-4000-8000-000000000002';
const jobId='00000000-0000-4000-8000-000000000003';
const car={make:'Renault',model:'Captur Diesel',fuel:'diesel',year:2015};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw Error('Timed out');}
function harness({existing=true}={}){
  let job=existing?{id:jobId,analysis_id:analysis,request_key:request,status:'in_progress',response_id:'resp_active',context:{stage:'market',previous_subject:car}}:null;
  const stats={starts:0,cancels:[],quota:0};
  let delayedStart=null,delayedPoll=null,failCancel=false;
  const rest=async(token,query,options={})=>{
    if(query==='rpc/cap_claim_job'){
      if(options.body.p_analysis!==analysis)throw Object.assign(Error('Access denied'),{status:403});
      const claimed=!job;
      if(!job)job={id:jobId,analysis_id:analysis,request_key:request,response_id:null,status:'starting',context:options.body.p_context};
      return {claimed,job:structuredClone(job)};
    }
    const url=new URL('https://db.example/'+query),p=url.searchParams;
    if(url.pathname==='/cap_registration_cache')return [];
    if(url.pathname!=='/cap_jobs')throw Error(query);
    if(!job||p.has('id')&&p.get('id')!=='eq.'+job.id)return [];
    const status=p.get('status');
    if(status?.startsWith('neq.')&&job.status===status.slice(4))return [];
    if(status?.startsWith('eq.')&&job.status!==status.slice(3))return [];
    if(status?.startsWith('in.')&&!status.slice(4,-1).split(',').includes(job.status))return [];
    if(p.has('context->>stage')&&p.get('context->>stage')!=='eq.'+job.context.stage)return [];
    if(p.has('response_id')&&p.get('response_id')!==(job.response_id?'eq.'+job.response_id:'is.null'))return [];
    if(options.method==='PATCH')Object.assign(job,structuredClone(options.body));
    return [structuredClone(job)];
  };
  const ctx={module:{exports:{}},require:p=>p==='../lib/access'?{authenticate:async()=>({token:'owner'}),takeQuota:async()=>{stats.quota++;},rest,endpoint:f=>f,appError:(m,s,c)=>Object.assign(Error(m),{status:s,code:c})}
    :p==='../lib/registration'?{...require('../lib/registration'),lookupRegistration:async()=>car}:p.startsWith('.')?require(path.resolve(path.dirname(apiPath),p)):require(p),
    console:{warn(){}},process:{env:{OPENAI_API_KEY:'test'}},URL,Date,Set,Map,AbortSignal,
    fetch:async(url,options={})=>{
      if(url.endsWith('/cancel')){stats.cancels.push(url);return {ok:!failCancel,status:failCancel?503:200,json:async()=>({status:'cancelled'})};}
      if(options.method==='POST'){
        stats.starts++;if(delayedStart)await delayedStart.promise;
        return {ok:true,json:async()=>({id:'resp_late',status:'queued'})};
      }
      if(delayedPoll)await delayedPoll.promise;
      return {ok:true,json:async()=>({id:'resp_active',status:'completed',output_text:JSON.stringify({subject:car,comparables:[]})})};
    }};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(apiPath,'utf8'),ctx);
  const call=async(method,body={},query={})=>{let status,data;await ctx.module.exports({method,body,query},{status:s=>({json:d=>{status=s;data=d;}})});return {status,data};};
  return {stats,get job(){return job;},api:ctx.module.exports._test,
    delayStart(){return delayedStart=deferred();},delayPoll(){return delayedPoll=deferred();},failCancel(){failCancel=true;},
    stop:(body={job_id:jobId})=>call('POST',{action:'cancel',...body}),
    start:()=>call('POST',{mode:'manual',description:'Renault Captur Diesel 2015',analysis_id:analysis,request_key:request}),
    poll:()=>call('GET',{}, {job_id:jobId})};
}

test('stop cancels the owned background response, stays idempotent and cannot be resumed',async()=>{
  const h=harness();
  const stopped=await h.stop();
  assert.equal(stopped.data.status,'cancelled');assert.equal(stopped.data.provider_cancelled,true);
  assert.equal(h.job.status,'cancelled');assert.equal(h.stats.cancels.length,1);
  await h.stop();assert.equal(h.job.status,'cancelled');
  await assert.rejects(h.poll(),e=>e.code==='market_job_cancelled'&&e.status===409);
  assert.equal(h.stats.starts,0);
});

test('stop before the start POST claims its key leaves a tombstone and prevents paid research',async()=>{
  const h=harness({existing:false});
  await h.stop({analysis_id:analysis,request_key:request});
  await assert.rejects(h.start(),e=>e.code==='market_job_cancelled');
  assert.equal(h.stats.starts,0);assert.equal(h.stats.quota,0);assert.equal(h.job.status,'cancelled');
});

test('a response created after cancellation is itself cancelled and cannot resurrect the job',async()=>{
  const h=harness({existing:false}),delay=h.delayStart();
  const starting=h.start();const rejected=assert.rejects(starting,e=>e.code==='market_job_cancelled');
  await until(()=>h.stats.starts===1);
  await h.stop({analysis_id:analysis,request_key:request});
  delay.resolve();await rejected;
  assert.equal(h.job.status,'cancelled');assert.equal(h.job.response_id,'resp_late');
  assert.ok(h.stats.cancels.some(u=>u.endsWith('/resp_late/cancel')));
});

test('an overlapping completed poll cannot start the next research stage after stop',async()=>{
  const h=harness(),delay=h.delayPoll();
  const polling=h.poll();await h.stop();delay.resolve();await polling;
  assert.equal(h.job.status,'cancelled');assert.equal(h.stats.starts,0);
});

test('cancelled jobs reject late completed result writes',async()=>{
  const h=harness();await h.stop();
  await assert.rejects(h.api.updateJob('owner',jobId,{status:'completed',result:{subject:car}}),e=>e.code==='market_job_cancelled');
  assert.equal(h.job.status,'cancelled');assert.equal(h.job.result,undefined);
});

test('unowned identifiers cannot cancel provider responses or create tombstones',async()=>{
  const h=harness();
  await assert.rejects(h.stop({job_id:'00000000-0000-4000-8000-000000000099'}),e=>e.status===404);
  await assert.rejects(h.stop({analysis_id:'00000000-0000-4000-8000-000000000099',request_key:request}),e=>e.status===403);
  assert.equal(h.stats.cancels.length,0);assert.equal(h.job.status,'in_progress');
});

test('provider cancellation failure is reported while the local job remains stopped',async()=>{
  const h=harness();h.failCancel();
  const stopped=await h.stop();assert.equal(stopped.data.provider_cancelled,false);
  assert.equal(h.job.status,'cancelled');
  await assert.rejects(h.poll(),e=>e.code==='market_job_cancelled');
});
