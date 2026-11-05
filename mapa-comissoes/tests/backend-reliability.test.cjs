const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const apiPath=path.resolve(__dirname,'../api/comparador-market.js');
const analysis='00000000-0000-4000-8000-000000000001';
const request='00000000-0000-4000-8000-000000000002';
const jobId='00000000-0000-4000-8000-000000000003';
const car={registration:'AA-00-AA',make:'MINI',model:'Countryman',trim:'Cooper D',fuel:'diesel',year:2017};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,1));}throw Error('Timed out');}

function harness({cache=[],provider=car,quotaError=null}={}){
  let job=null,lookupDelay=null,failStartedSave=false;
  const stats={lookups:0,cacheWrites:0,cacheReads:0,starts:0,providerReads:0,quotas:0,collections:0};
  const output={id:'resp_one',status:'completed',output_text:JSON.stringify({subject:car,comparables:[]})};
  const appError=(message,status,code)=>Object.assign(Error(message),{status,code});
  const rest=async(token,query,options={})=>{
    if(query==='rpc/cap_claim_job'){
      const claimed=!job||job.request_key!==options.body.p_request;
      if(claimed)job={id:jobId,analysis_id:analysis,request_key:options.body.p_request,status:'starting',response_id:null,
        created_at:new Date().toISOString(),context:structuredClone(options.body.p_context)};
      return {claimed,job:structuredClone(job)};
    }
    const url=new URL('https://db.example/'+query),params=url.searchParams;
    if(url.pathname==='/cap_registration_cache'){
      if(options.method==='POST'){stats.cacheWrites++;return null;}
      stats.cacheReads++;return cache;
    }
    if(url.pathname!=='/cap_jobs')throw Error(query);
    if(params.get('status')==='eq.completed')return [];
    if(!job)return [];
    if(params.get('status')==='neq.cancelled'&&job.status==='cancelled')return [];
    if(params.has('context->>stage')&&params.get('context->>stage')!=='eq.'+job.context.stage)return [];
    if(params.has('response_id')&&params.get('response_id')!==(job.response_id?'eq.'+job.response_id:'is.null'))return [];
    if(options.method==='PATCH'){
      if(failStartedSave&&options.body.response_id){failStartedSave=false;throw appError('Temporary storage outage',503,'storage_error');}
      Object.assign(job,structuredClone(options.body));
    }
    return [structuredClone(job)];
  };
  const access={authenticate:async()=>({token:'owner'}),rest,appError,endpoint:fn=>fn,
    takeQuota:async()=>{stats.quotas++;if(quotaError)throw quotaError;}};
  const ctx={module:{exports:{}},URL,Date,Set,Map,AbortSignal,process:{env:{OPENAI_API_KEY:'test'}},console:{warn(){}},
    require:name=>name==='../lib/access'?access:name==='../lib/market-worker'?{continueMarketJob(){stats.collections++;}}:
      name==='../lib/registration'?{...require('../lib/registration'),lookupRegistration:async()=>{
        stats.lookups++;if(lookupDelay)await lookupDelay.promise;
        if(provider instanceof Error)throw provider;
        return structuredClone(provider);
      }}:name.startsWith('.')?require(path.resolve(path.dirname(apiPath),name)):require(name),
    fetch:async(url,options={})=>{
      if(url.endsWith('/cancel'))return {ok:true,json:async()=>({status:'cancelled'})};
      if(options.method==='POST'){stats.starts++;return {ok:true,json:async()=>({id:'resp_'+stats.starts,status:'queued'})};}
      stats.providerReads++;return {ok:true,json:async()=>structuredClone(output)};
    }};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(apiPath,'utf8'),ctx);
  async function call(method,body={},query={}){
    let status,data;
    await ctx.module.exports({method,body,query},{status(code){status=code;return this;},json(value){data=value;return value;}});
    return {status,data};
  }
  return {stats,output,api:ctx.module.exports._test,get job(){return job;},
    delayLookup(){return lookupDelay=deferred();},failNextStartedSave(){failStartedSave=true;},
    start:(patch={})=>call('POST',{analysis_id:analysis,request_key:request,mode:'manual',description:'AA-00-AA',registration:'AA-00-AA',...patch}),
    stop:()=>call('POST',{action:'cancel',job_id:jobId}),poll:()=>call('GET',{}, {job_id:jobId})};
}

test('invalid or mismatched cached identities cannot suppress a fresh plate lookup for a year',async()=>{
  for(const data of [{},{make:'MINI'},{...car,model:'?'},{...car,registration:'11-AA-11'}]){
    const h=harness({cache:[{data}]});
    const result=await h.api.lookupRegistrationCached('owner','AA00AA');
    assert.equal(result.model,'Countryman');assert.equal(result.cache_hit,false);
    assert.equal(h.stats.lookups,1);assert.equal(h.stats.cacheWrites,1);
  }
  const full=harness({cache:[{data:{...car,registration:null}}]});
  const result=await full.api.lookupRegistrationCached('owner','AA00AA');
  assert.equal(result.cache_hit,true);assert.equal(result.registration,'AA-00-AA');assert.equal(full.stats.lookups,0);
});

test('partial provider identities are returned as context without entering the yearly cache',async()=>{
  const h=harness({provider:{registration:'AA-00-AA',make:'MINI',model:null}});
  const result=await h.api.lookupRegistrationCached('owner','AA00AA');
  assert.equal(result.make,'MINI');assert.equal(h.stats.cacheWrites,0);
});

test('overlapping same-user plate lookups share one provider request without sharing across users',async()=>{
  const h=harness(),delay=h.delayLookup();
  const a=h.api.lookupRegistrationCached('owner','AA00AA');
  const b=h.api.lookupRegistrationCached('owner','AA-00-AA');
  const c=h.api.lookupRegistrationCached('another-owner','AA00AA');
  await until(()=>h.stats.lookups===2);delay.resolve();
  const results=await Promise.all([a,b,c]);
  assert.ok(results.every(result=>result.model==='Countryman'));
  assert.equal(h.stats.lookups,2);assert.equal(h.stats.cacheWrites,2);
});

test('duplicate submissions claim a durable job before plate lookup and never repeat paid startup',async()=>{
  const h=harness(),delay=h.delayLookup();
  const first=h.start();await until(()=>h.stats.lookups===1);
  assert.equal(h.job.id,jobId);
  const repeated=await h.start();
  assert.equal(repeated.status,202);assert.equal(repeated.data.job_id,jobId);
  assert.equal(h.stats.lookups,1);assert.equal(h.stats.quotas,1);assert.equal(h.stats.starts,0);
  delay.resolve();await first;
  assert.equal(h.stats.starts,1);assert.equal(h.job.context.stage,'market');
});

test('cancelling while the plate provider is pending prevents AI startup',async()=>{
  const h=harness(),delay=h.delayLookup();
  const first=h.start(),rejected=assert.rejects(first,error=>error.code==='market_job_cancelled');
  await until(()=>h.stats.lookups===1);await h.stop();delay.resolve();await rejected;
  assert.equal(h.job.status,'cancelled');assert.equal(h.stats.starts,0);
});

test('a quota refusal marks the durable job failed without querying the plate provider',async()=>{
  const h=harness({quotaError:Object.assign(Error('Temporarily rate limited'),{status:429,code:'rate_limited'})});
  await assert.rejects(h.start(),error=>error.status===429);
  assert.equal(h.job.status,'failed');assert.equal(h.stats.lookups,0);assert.equal(h.stats.starts,0);
});

test('a transient save failure after initial AI startup preserves and collects the existing response',async()=>{
  const h=harness();h.failNextStartedSave();
  const response=await h.start();
  assert.equal(response.status,202);assert.equal(h.stats.starts,1);
  assert.equal(h.job.response_id,'resp_1');assert.equal(h.job.status,'queued');
  assert.equal(h.stats.collections,1);
});

test('a failed supplier is not queried again on later identification or market polls',async()=>{
  const h=harness({provider:Error('Supplier temporarily unavailable')});
  await h.start({description:'MINI Countryman Cooper D 2017'});
  assert.equal(h.stats.lookups,1);
  let response=await h.poll();assert.equal(response.status,202);
  assert.equal(h.job.context.stage,'market');assert.equal(h.stats.lookups,1);
  h.output.output_text=JSON.stringify({subject:car,comparables:[{...car,registration:null,
    url:'https://stand.example/mini/1',price:19900,mileage_km:100000,seller_type:'professional',
    country:'PT',availability:'available',price_basis:'gross'}]});
  response=await h.poll();assert.equal(response.status,200);assert.equal(h.stats.lookups,1);
  assert.equal(response.data.market_selection.accepted_count,1);
});

test('malformed completed responses fail once instead of leaving a permanently running job',async()=>{
  const h=harness();await h.start();h.output.output_text='{broken json';
  await assert.rejects(h.poll(),error=>error.code==='invalid_market_result');
  assert.equal(h.job.status,'failed');assert.equal(h.stats.providerReads,1);
  const repeated=await h.poll();
  assert.equal(repeated.status,502);assert.equal(h.stats.providerReads,1);
  assert.match(repeated.data.message,/resposta inválida/);
});

test('a genuine model conflict exposes both candidates and an explicit choice continues to market once',async()=>{
  const photo={...car,make:'Renault',model:'Clio',trim:'1.5 dCi',mileage_km:100000};
  const h=harness();
  h.output.output_text=JSON.stringify({subject:photo,comparables:[]});
  await h.start({description:'Renault Clio 1.5 dCi 2017',image_data_urls:['data:image/jpeg;base64,YWJj']});
  const blocked=await h.poll();
  assert.equal(blocked.data.valuation_blocked,true);
  assert.equal(blocked.data.identity_candidates.length,2);
  assert.equal(blocked.data.identity_candidates[0].vehicle.model,'Clio');
  assert.equal(blocked.data.identity_candidates[1].vehicle.model,'Countryman');
  const selected=blocked.data.identity_candidates[0].vehicle;
  const confirmation={make:selected.make,model:selected.model,trim:selected.trim,registration:selected.registration};
  await h.start({request_key:'00000000-0000-4000-8000-000000000004',previous_subject:blocked.data.subject,
    user_confirmed_identity:confirmation,identity_confirmation_only:true});
  assert.equal(h.job.context.stage,'market');assert.equal(h.stats.lookups,1);
  h.output.output_text=JSON.stringify({subject:car,comparables:[{...photo,registration:null,
    url:'https://stand.example/clio/1',price:11900,mileage_km:105000,seller_type:'professional',
    country:'PT',availability:'available',price_basis:'gross'}],risk_flags:[{code:'registration_unconfirmed'}]});
  const completed=await h.poll();
  assert.equal(completed.status,200);assert.notEqual(completed.data.valuation_blocked,true);
  assert.equal(completed.data.subject.model,'Clio');assert.equal(completed.data.subject.identity_source,'user_confirmed');
  assert.equal(completed.data.market_selection.accepted_count,1);assert.equal(h.stats.lookups,1);
  assert.ok(completed.data.risk_flags.some(flag=>flag.code==='identity_user_confirmed'));
  assert.ok(!completed.data.risk_flags.some(flag=>flag.code==='registration_unconfirmed'));
});

test('a model confirmation cannot silently decide a typed-versus-photographed plate conflict',async()=>{
  const h=harness();
  const data={status:'completed',metadata:{cap_registration:'AA-00-AA'},
    output_text:JSON.stringify({subject:{...car,registration:'11-BB-11'},comparables:[]})};
  const choice={make:'MINI',model:'Countryman',trim:'Cooper D'};
  const blocked=await h.api.finalizeMarketResponse(data,car,'owner',choice);
  assert.equal(blocked.valuation_blocked,true);
  assert.equal(blocked.identity_conflict.kind,'registration');
  assert.deepEqual(Array.from(blocked.identity_candidates,option=>option.vehicle.registration),['11-BB-11','AA-00-AA']);
  const resolved=await h.api.finalizeMarketResponse(data,car,'owner',{...choice,registration:'11-BB-11'});
  assert.notEqual(resolved.valuation_blocked,true);assert.equal(resolved.subject.registration,'11-BB-11');
  assert.equal(resolved.registration_data,null);assert.equal(h.stats.lookups,0);
});

test('a plate mismatch without a supplier response still offers both visible registrations',async()=>{
  const h=harness();
  const result=await h.api.finalizeMarketResponse({status:'completed',metadata:{cap_registration:'AA-00-AA'},
    output_text:JSON.stringify({subject:{...car,registration:'11-BB-11'},comparables:[]})},null,'owner');
  assert.equal(result.valuation_blocked,true);assert.equal(result.identity_candidates.length,2);
  assert.equal(result.identity_candidates[1].vehicle.registration,'AA-00-AA');
  assert.equal(result.identity_candidates[1].unverified,true);
});

test('confirmation is bounded and cannot transfer another vehicle specifications or masquerade as a supplier',()=>{
  const h=harness();
  for(const value of [true,[],{}, {make:'MINI'}, {make:'MINI',model:'?'},
    {make:'MINI',model:'Countryman',registration:'invalid'}, {make:'MINI',model:'x'.repeat(121)}]){
    assert.throws(()=>h.api.confirmedIdentity(value),error=>error.code==='invalid_identity_confirmation');
  }
  const clean=h.api.confirmedIdentity({make:' MINI ',model:'Countryman',source:'spottd',power_cv:2000});
  assert.equal(clean.make,'MINI');assert.equal(clean.source,undefined);assert.equal(clean.power_cv,undefined);
  const result=h.api.applyConfirmedIdentity({make:'Tesla',model:'Model Y',year:2021,power_cv:351,battery_kwh:75,fuel:'electric',price:35000},clean);
  for(const field of ['year','power_cv','battery_kwh','fuel'])assert.equal(result[field],undefined);
  assert.equal(result.price,null);assert.equal(result.identity_source,'user_confirmed');
});

test('choosing another plate of the same model clears old vehicle facts and reapplies only structured mileage',()=>{
  const h=harness();
  const old={...car,mileage_km:100000,price:19900,power_cv:150,engine_cc:1995,equipment:['Panoramic roof']};
  const chosen=h.api.applyConfirmedIdentity(old,{make:'MINI',model:'Countryman',trim:'Cooper D',registration:'11-BB-11'});
  assert.equal(chosen.registration,'11-BB-11');assert.equal(chosen.model,'Countryman');
  assert.equal(chosen.mileage_km,null);assert.equal(chosen.price,null);assert.equal(chosen.equipment.length,0);
  for(const field of ['year','fuel','power_cv','engine_cc'])assert.equal(chosen[field],undefined);
  const entered=h.api.applyMileageInput({subject:chosen},{mileage_input_km:125000});
  assert.equal(entered.subject.mileage_km,125000);assert.equal(entered.subject.mileage_source,'user');
});

test('confirmation participates in exact-input caching and single-photo recovery counts the legacy input alias',()=>{
  const h=harness(),body={mode:'manual',description:'AA-00-AA'};
  assert.notEqual(h.api.inputSignature(body),h.api.inputSignature({...body,user_confirmed_identity:{make:'MINI',model:'Countryman'}}));
  assert.equal(h.api.boundedContext({...body,image_data_url:'data:image/jpeg;base64,YWJj'}).image_count,1);
});

test('later free-text corrections still run identification while retaining an earlier user identity choice',async()=>{
  const h=harness({cache:[{data:car}]});
  await h.start({previous_subject:{...car,mileage_km:100000},
    user_confirmed_identity:{make:'MINI',model:'Countryman',trim:'Cooper D',registration:'AA-00-AA'},
    refinement_history:['Corrige os quilómetros para 125000.']});
  assert.equal(h.job.context.stage,'identify');assert.equal(h.stats.lookups,0);
  h.output.output_text=JSON.stringify({subject:{...car,mileage_km:125000},comparables:[]});
  await h.poll();
  assert.equal(h.job.context.previous_subject.mileage_km,125000);
  assert.equal(h.job.context.previous_subject.identity_source,'user_confirmed');
});

test('the initial plate shortcut cannot discard a later free-text correction',async()=>{
  const h=harness({cache:[{data:car}]});
  await h.start({previous_subject:{...car,mileage_km:100000},refinement_history:['São 125000 km.']});
  assert.equal(h.job.context.stage,'identify');
  h.output.output_text=JSON.stringify({subject:{...car,mileage_km:125000},comparables:[]});
  await h.poll();assert.equal(h.job.context.previous_subject.mileage_km,125000);
});

test('a later different model or plate asks for a new choice instead of restoring the previous confirmation',async()=>{
  for(const patch of [{make:'Renault',model:'Clio',trim:'1.5 dCi'},{registration:'11-BB-11'}]){
    const h=harness();
    await h.start({previous_subject:car,user_confirmed_identity:{make:'MINI',model:'Countryman',trim:'Cooper D',registration:'AA-00-AA'},
      refinement_history:['Correção da viatura.']});
    h.output.output_text=JSON.stringify({subject:{...car,...patch},comparables:[]});
    const result=await h.poll();
    assert.equal(result.data.valuation_blocked,true,JSON.stringify(patch));
    assert.equal(result.data.identity_candidates.length,2);
    assert.equal(result.data.identity_candidates[1].source_label,'Confirmado anteriormente por ti');
    assert.equal(h.stats.lookups,0);
  }
});
