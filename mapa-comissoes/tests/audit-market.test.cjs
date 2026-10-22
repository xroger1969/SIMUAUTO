const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const apiPath=path.resolve(__dirname,'../api/comparador-market.js');
const base=path.dirname(apiPath);
const car={registration:'AL-47-IC',make:'Tesla',model:'MODEL Y LONG RANGE AWD',trim:'3',year:2021,fuel:'electric',power_cv:351,mileage_km:null};
const ad=(patch={})=>({make:'Tesla',model:'Model Y',trim:'Long Range AWD',year:2021,fuel:'electric',drivetrain:'AWD',power_cv:514,mileage_km:103000,price:31450,url:'https://stand.example/model-y/1',seller_type:'professional',seller_name:'Stand',country:'PT',availability:'available',price_basis:'gross',...patch});
const ago=()=>new Date(Date.now()-120000).toISOString();
function harness({context={},response_id='resp_initial',comparables=[],cache=[]}={}){
  const job={id:'00000000-0000-4000-8000-000000000001',response_id,status:'in_progress',created_at:ago(),updated_at:ago(),context:{stage:'market',previous_subject:car,...context}};
  const stats={launches:[],providerReads:0};
  const output={status:'completed',id:response_id,output_text:JSON.stringify({subject:car,comparables})};
  let failLaunch=false,failStartedSave=false,providerStatus=200;
  const rest=async(token,query,options={})=>{
    const url=new URL('https://db.example/'+query),params=url.searchParams;
    if(options.method==='PATCH'){
      if(params.has('context->>stage')&&params.get('context->>stage')!=='eq.'+job.context.stage)return [];
      if(params.has('context->>transition_id')&&params.get('context->>transition_id')!=='eq.'+job.context.transition_id)return [];
      if(params.has('context->>pending_started_at')&&params.get('context->>pending_started_at')!=='eq.'+job.context.pending_started_at)return [];
      if(params.has('response_id')&&params.get('response_id')!==(job.response_id?'eq.'+job.response_id:'is.null'))return [];
      if(failStartedSave&&options.body.context?.stage==='market'&&options.body.response_id){failStartedSave=false;throw Error('temporary save failure');}
      Object.assign(job,structuredClone(options.body));return [structuredClone(job)];
    }
    if(params.has('status')&&params.get('status')==='eq.completed')return cache;
    if(url.pathname==='/cap_jobs')return [structuredClone(job)];
    if(url.pathname==='/cap_registration_cache')return [];
    throw Error(query);
  };
  const access={authenticate:async()=>({token:'test'}),endpoint:fn=>fn,appError:(message,status,code)=>Object.assign(Error(message),{status,code}),rest};
  const ctx={module:{exports:{}},require:p=>p==='../lib/access'?access:p==='../lib/registration'?{...require('../lib/registration'),lookupRegistration:async()=>car}:p.startsWith('.')?require(path.resolve(base,p)):require(p),console,process:{env:{OPENAI_API_KEY:'test'}},URL,Date,Set,Map,AbortSignal,
    fetch:async(url,options)=>{
      if(options?.method==='POST'){
        stats.launches.push({body:options.body,headers:options.headers});
        if(failLaunch){failLaunch=false;throw Error('connection reset');}
        return {ok:true,json:async()=>({id:'resp_market_'+stats.launches.length,status:'queued'})};
      }
      stats.providerReads++;
      return {ok:providerStatus===200,status:providerStatus,json:async()=>structuredClone(output)};
    }};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(apiPath,'utf8'),ctx);
  return {job,stats,output,setProviderStatus:status=>{providerStatus=status;},api:ctx.module.exports._test,failNextLaunch:()=>{failLaunch=true;},failNextStartedSave:()=>{failStartedSave=true;},poll:async()=>{
    let status,result;await ctx.module.exports({method:'GET',query:{job_id:job.id}},{status:n=>({json:value=>{status=n;result=value;}})});return {status,result};
  }};
}

test('raw adverts with no eligible price cannot be reused from either 24-hour cache',async()=>{
  const row={id:'cached',updated_at:new Date().toISOString(),result:{subject:car,comparables:[ad({model:'Model 3'})]}};
  const h=harness({cache:[row]});
  assert.equal(await h.api.findFreshInputCache('test','signature'),null);
  assert.equal(await h.api.findFreshMarketCache('test','key'),null);
  row.result.comparables=[ad({availability:'sold'})];
  assert.equal(await h.api.findFreshInputCache('test','signature'),null);
  row.result.comparables=[ad()];
  assert.equal((await h.api.findFreshMarketCache('test','key')).id,'cached');
});

test('same plate cache identity changes after fuel, version, drivetrain, battery, generation or actual km correction',()=>{
  const {marketCacheKey,inputSignature}=harness().api;
  const key=marketCacheKey(car);
  for(const patch of [{fuel:'petrol'},{trim:'Performance',model:'Model Y'},{drivetrain:'RWD'},{battery_kwh:50},{generation:'new'},{mileage_km:123000}])assert.notEqual(marketCacheKey({...car,...patch}),key);
  assert.notEqual(inputSignature({description:'AL-47-IC',previous_subject:car}),inputSignature({description:'AL-47-IC',previous_subject:{...car,mileage_km:123000}}));
});

test('zero eligible adverts triggers bounded normalized-family recovery and records reasons',async()=>{
  const h=harness({comparables:[ad({model:'Model 3'})]});
  let r=await h.poll();assert.equal(r.status,202);assert.equal(h.job.context.market_search_step,1);
  let request=JSON.parse(h.stats.launches[0].body);
  let context=JSON.parse(request.input.split('ANÚNCIO A ANALISAR:\n')[1].split('\n\n')[0]);
  assert.equal(context.market_search_plan.model,'Model Y');assert.equal(context.market_search_plan.min_year,2018);
  assert.equal(context.market_search_plan.trim,null);assert.equal(context.previous_subject.trim,'long range awd');
  assert.equal(h.job.context.market_attempts[0].accepted_count,0);
  assert.ok(Object.keys(h.job.context.market_attempts[0].exclusion_reasons).some(k=>k.includes('modelo')));
  r=await h.poll();assert.equal(r.status,202);assert.equal(h.job.context.market_search_step,2);
  r=await h.poll();assert.equal(r.status,200);assert.equal(h.stats.launches.length,2);
  assert.equal(r.result.market_attempts.length,3);assert.equal(r.result.market_selection.accepted_count,0);
});

test('recovery stops immediately when a usable comparable is found',async()=>{
  const h=harness();await h.poll();
  h.output.output_text=JSON.stringify({subject:car,comparables:[ad()]});
  const r=await h.poll();
  assert.equal(r.status,200);assert.equal(h.stats.launches.length,1);assert.equal(r.result.market_selection.accepted_count,1);
  assert.equal(r.result.subject.mileage_km,103000);assert.equal(r.result.market_attempts.length,2);
});

test('overlapping empty-market polls claim only one paid recovery request',async()=>{
  const h=harness();const results=await Promise.all([h.poll(),h.poll()]);
  assert.ok(results.every(r=>r.status===202));assert.equal(h.stats.launches.length,1);
});

test('a fresh transition lease returns pending before polling the old provider response',async()=>{
  const h=harness({context:{stage:'market_pending',transition_id:'lease',pending_started_at:new Date().toISOString()}});
  const r=await h.poll();assert.equal(r.status,202);assert.equal(h.stats.providerReads,0);assert.equal(h.stats.launches.length,0);
});

test('stale pending lease is recovered once even when no response id exists',async()=>{
  const h=harness({response_id:null,context:{stage:'market_pending',transition_id:'lease',pending_started_at:ago()}});
  await Promise.all([h.poll(),h.poll()]);
  assert.equal(h.stats.launches.length,1);assert.equal(h.job.context.stage,'market');assert.match(h.job.response_id,/resp_market/);
});

test('interrupted provider launch resumes with the identical idempotency key and body',async()=>{
  const h=harness();h.failNextLaunch();
  const first=await h.poll();assert.equal(first.status,202);assert.equal(h.job.context.stage,'market_pending');
  h.job.context.pending_started_at=ago();
  const resumed=await h.poll();assert.equal(resumed.status,202);
  assert.equal(h.stats.launches.length,2);
  assert.equal(h.stats.launches[0].headers['Idempotency-Key'],h.stats.launches[1].headers['Idempotency-Key']);
  assert.equal(h.stats.launches[0].body,h.stats.launches[1].body);
});

test('a successful provider launch retains its response id when the first persistence attempt fails',async()=>{
  const h=harness();h.failNextStartedSave();const r=await h.poll();
  assert.equal(r.status,202);assert.equal(h.job.response_id,'resp_market_1');assert.equal(h.job.context.stage,'market');
  assert.equal(h.stats.launches.length,1);
});

test('photo startup without persisted bytes terminates clearly after the lease expires',async()=>{
  const h=harness({response_id:null,context:{stage:'identify',image_count:2,initial_started_at:ago()}});
  const r=await h.poll();assert.equal(r.status,502);assert.equal(r.result.error,'market_start_interrupted');assert.equal(h.stats.launches.length,0);
});

test('market schema and instructions capture conditioned cash prices and sold adverts',async()=>{
  const h=harness();await h.poll();const request=JSON.parse(h.stats.launches[0].body);
  const props=request.text.format.schema.properties.comparables.items.properties;
  assert.ok(props.price_conditioned);assert.ok(props.cash_price);assert.ok(props.availability.enum.includes('sold'));
  assert.match(request.instructions,/price_conditioned=true/);
});

test('unknown year recovery never searches a fabricated year zero',()=>{
  const plan=harness().api.marketSearchPlan({...car,year:null},1);
  assert.equal(plan.min_year,null);assert.equal(plan.max_year,null);
});

test('finalization retains raw provider identity and rejected candidates for explained exclusions',async()=>{
  const h=harness();const raw={...car,provider:'spottd'};
  const result=await h.api.finalizeMarketResponse({status:'completed',metadata:{cap_source_url:'https://stand.example/model-y/1'},output_text:JSON.stringify({subject:{...car,model:'Model Y',trim:'Long Range AWD'},comparables:[ad(),ad({url:'invalid',price:0})]})},raw,'test');
  assert.equal(result.registration_data.model,'MODEL Y LONG RANGE AWD');
  assert.equal(result.subject.model,'Model Y');assert.equal(result.subject.trim,'long range awd');
  assert.equal(result.comparables.length,2);assert.equal(h.api.hasUsefulMarket(result),false);
  const selected=h.api.marketSelection(result);
  assert.ok(selected.excluded.some(row=>row.reason==='própria viatura'));
  assert.ok(selected.excluded.some(row=>row.reason==='preço inválido'));
});


test('expired upstream responses terminate recovery with a clear restart message',async()=>{
  for(const status of [404,410]){
    const h=harness();h.setProviderStatus(status);const r=await h.poll();
    assert.equal(r.status,502);assert.equal(r.result.error,'market_job_failed');assert.equal(h.job.status,'failed');
    assert.match(r.result.message,/nova pesquisa/);assert.equal(h.stats.launches.length,0);
  }
});
