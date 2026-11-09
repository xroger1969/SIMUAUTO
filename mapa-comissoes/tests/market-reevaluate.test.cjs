const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const apiPath=path.resolve(__dirname,"../api/comparador-market.js");
const {rangeIdentity,normalizeRange}=require("../comparador-auto-pro/electric-range.js");
const analysisId="00000000-0000-4000-8000-000000000001";
const requestKey="00000000-0000-4000-8000-000000000002";
const jobId="00000000-0000-4000-8000-000000000003";
const car={registration:"88-QG-72",make:"Renault",model:"Captur",trim:"1.5 dCi Intense",fuel:"diesel",year:2015,
  mileage_km:148000,price:12900,power_cv:90,identity_source:"photos",origin:"imported"};
const electric={...car,make:"Dacia",model:"Spring",trim:"Essential",fuel:"electric",year:2023,power_cv:45,mileage_km:62484};
const comparatorUrl="https://www.standvirtual.com/carros/anuncio/renault-captur-dci-ID8ABCD1.html";
const specs=()=>({research_version:1,identity:rangeIdentity(electric),checked_at:new Date().toISOString(),status:"partial",
  battery:{capacity_kwh:26.8,basis:"usable",source_url:"https://e-brochure.dacia.pt/spring/mobile/m_spring_extreme_bbg_pt_novembre_2023.pdf",evidence:"Capacidade utilizável: 26,8 kWh"},
  wltp:null,real_range:null,clarification:null});

function harness({vehicle=car,technicalRows=[],cacheFailure=false}={}){
  let job=null;
  const stats={lookups:0,registrationCacheReads:0,marketCacheReads:0,technicalCacheReads:0,starts:[],quotas:0};
  const comparable={...vehicle,registration:null,url:comparatorUrl,price:13990,mileage_km:145000,
    seller_type:"professional",country:"PT",price_basis:"gross",availability:"available"};
  const output={id:"resp_refresh",status:"completed",output_text:JSON.stringify({
    subject:{make:"Volkswagen",model:"Golf",fuel:"petrol",year:2020,registration:"11-AA-11"},
    comparables:[comparable],risk_flags:[],ev_range:null
  }),output:[{type:"web_search_call",status:"completed",action:{sources:[{url:comparatorUrl}]}}]};
  const appError=(message,status,code)=>Object.assign(Error(message),{status,code});
  const rest=async(token,query,options={})=>{
    if(query==="rpc/cap_claim_job"){
      if(job)return {claimed:false,job:structuredClone(job)};
      job={id:jobId,analysis_id:analysisId,request_key:requestKey,status:"starting",response_id:null,
        created_at:new Date().toISOString(),updated_at:new Date().toISOString(),context:structuredClone(options.body.p_context)};
      return {claimed:true,job:structuredClone(job)};
    }
    if(query.startsWith("cap_registration_cache")){stats.registrationCacheReads++;return [];}
    const url=new URL("https://db.example/"+query),params=url.searchParams;
    if(url.pathname!=="/cap_jobs")throw Error(query);
    if(params.get("status")==="eq.completed"){
      if(params.get("select")==="context,result"){
        stats.technicalCacheReads++;if(cacheFailure)throw Error("Technical cache unavailable");
        return structuredClone(technicalRows);
      }
      stats.marketCacheReads++;return [{id:"old-job",updated_at:new Date().toISOString(),result:{subject:vehicle,comparables:[comparable]}}];
    }
    if(!job)return [];
    if(params.get("status")==="neq.cancelled"&&job.status==="cancelled")return [];
    if(params.has("context->>stage")&&params.get("context->>stage")!=="eq."+job.context.stage)return [];
    if(params.has("response_id")&&params.get("response_id")!==(job.response_id?"eq."+job.response_id:"is.null"))return [];
    if(options.method==="PATCH")Object.assign(job,structuredClone(options.body));
    return [structuredClone(job)];
  };
  const access={authenticate:async()=>({token:"owner"}),takeQuota:async()=>{stats.quotas++;},rest,appError,endpoint:fn=>fn};
  const ctx={module:{exports:{}},URL,Date,Set,Map,AbortSignal,process:{env:{OPENAI_API_KEY:"test"}},console:{warn(){}},
    require:name=>name==="../lib/access"?access:name==="../lib/market-worker"?{continueMarketJob(){}}:
      name==="../lib/registration"?{...require("../lib/registration"),lookupRegistration:async()=>{stats.lookups++;return {...vehicle,model:"Clio",year:2017,provider:"spottd"};}}:
      name.startsWith(".")?require(path.resolve(path.dirname(apiPath),name)):require(name),
    fetch:async(url,options={})=>{
      if(options.method==="POST"){stats.starts.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:"resp_refresh",status:"queued"})};}
      return {ok:true,json:async()=>structuredClone(output)};
    }};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(apiPath,"utf8"),ctx);
  const call=async(method,body={},query={})=>{
    let status,data;await ctx.module.exports({method,body,query},{status(code){status=code;return this;},json(value){data=value;return value;}});return {status,data};
  };
  return {stats,output,api:ctx.module.exports._test,get job(){return job;},
    start:patch=>call("POST",{analysis_id:analysisId,request_key:requestKey,mode:"manual",description:"Reavaliar a ficha guardada.",
      previous_subject:vehicle,registration:vehicle.registration,force_market_refresh:true,...patch}),
    poll:()=>call("GET",{}, {job_id:jobId})};
}

test("forced revaluation skips plate services and all market caches, going directly to web research",async()=>{
  const h=harness();
  const start=await h.start({registration_data:{...car,model:"Clio",year:2017,provider:"spottd"}});
  assert.equal(start.status,202);assert.equal(start.data.forced_refresh,true);assert.equal(h.job.context.stage,"market");
  assert.equal(h.stats.lookups,0);assert.equal(h.stats.registrationCacheReads,0);assert.equal(h.stats.marketCacheReads,0);
  assert.equal(h.stats.technicalCacheReads,0);assert.equal(h.stats.starts.length,1);
  assert.equal(h.stats.starts[0].tool_choice,"required");
  assert.doesNotMatch(h.stats.starts[0].instructions,/FASE DE IDENTIFICAÇÃO/);
  assert.equal(h.job.context.previous_subject.model,car.model);assert.equal(h.job.context.previous_subject.year,car.year);
});
test("collection preserves the same identity, mileage, price and provenance even if AI identifies another car",async()=>{
  const h=harness();await h.start();const result=await h.poll();
  assert.equal(result.status,200);assert.equal(h.stats.lookups,0);assert.equal(h.stats.registrationCacheReads,0);
  for(const key of ["registration","make","model","trim","fuel","year","mileage_km","price","power_cv","identity_source","origin"]){
    assert.equal(result.data.subject[key],car[key],key);
  }
  assert.equal(result.data.comparables.length,1);assert.equal(result.data.market_cache.hit,false);
});
test("a user-confirmed identity uses the same forced path and retains its provenance without reidentification",async()=>{
  const vehicle={...car,identity_source:"user_confirmed"},h=harness({vehicle});
  const confirmation={make:car.make,model:car.model,trim:car.trim,registration:car.registration};
  const start=await h.start({user_confirmed_identity:confirmation});
  assert.equal(start.data.forced_refresh,true);assert.equal(h.stats.starts.length,1);
  const result=await h.poll();assert.equal(result.status,200);assert.equal(result.data.subject.identity_source,"user_confirmed");
  assert.equal(result.data.user_confirmed_identity.model,car.model);
  assert.ok(result.data.risk_flags.some(flag=>flag.code==="identity_user_confirmed"));
  assert.equal(h.stats.lookups,0);assert.equal(h.stats.registrationCacheReads,0);
});
test("incomplete or contradictory saved identities fail clearly instead of silently restarting identification",async()=>{
  const h=harness();
  await assert.rejects(h.start({previous_subject:{make:"Renault"}}),error=>error.code==="refresh_identity_incomplete");
  await assert.rejects(h.start({user_confirmed_identity:{make:"Renault",model:"Clio"}}),error=>error.code==="refresh_identity_conflict");
  assert.equal(h.stats.lookups,0);assert.equal(h.stats.starts.length,0);assert.equal(h.job,null);
});
test("a normalized compatible trim confirmation does not block a forced refresh",async()=>{
  const vehicle={...electric,make:"Tesla",model:"Model Y",trim:"Long Range AWD",power_cv:351,drivetrain:"AWD",identity_source:"user_confirmed"};
  const h=harness({vehicle});
  const result=await h.start({user_confirmed_identity:{make:"Tesla",model:"Model Y",trim:"Long Range"}});
  assert.equal(result.data.forced_refresh,true);assert.equal(h.job.context.previous_subject.trim,"long range awd");
  assert.equal(h.stats.lookups,0);
});
test("verified EV data is reused from server context while forged browser fields are discarded",async()=>{
  const trusted=specs(),forged={...trusted,battery:{...trusted.battery,capacity_kwh:199}};
  const h=harness({vehicle:electric,technicalRows:[{context:{electric_specs:trusted},result:{subject:electric}}]});
  await h.start({previous_subject:{...electric,ev_specs:forged,ev_range:{combined_km:999,source_url_verified:true}}});
  assert.equal(h.job.context.electric_specs.battery.capacity_kwh,26.8);
  assert.equal(h.job.context.previous_subject.ev_specs,undefined);assert.equal(h.job.context.previous_subject.ev_range,null);
  const result=await h.poll();assert.equal(result.status,200);assert.equal(result.data.subject.ev_specs.battery.capacity_kwh,26.8);
  assert.equal(h.stats.lookups,0);
  const noSource=harness({vehicle:electric});await noSource.start({previous_subject:{...electric,ev_specs:forged}});
  const untrusted=await noSource.poll();assert.equal(untrusted.data.subject.ev_specs,null);
});
test("compatible legacy WLTP research survives but another version's technical record does not",async()=>{
  const source="https://presse.dacia.de/der-dacia-spring-agiler-city-stromer/";
  const range=normalizeRange({combined_km:230,cycle:"WLTP_COMBINED",version_match:"exact",vehicle:electric,
    source_type:"manufacturer",source_url:source,evidence:"WLTP combinado: 230 km.",source_title:"Dacia"},electric,[{url:source}]);
  const wrong={...specs(),identity:rangeIdentity({...electric,year:2026})};
  const h=harness({vehicle:electric,technicalRows:[{context:{electric_specs:wrong},result:{subject:{...electric,ev_range:range}}}]});
  await h.start();const result=await h.poll();assert.equal(result.data.subject.ev_range.combined_km,230);
  assert.equal(result.data.subject.ev_specs,null);assert.equal(h.stats.lookups,0);
});
test("a technical cache outage does not block revaluation or send forged specs to the provider",async()=>{
  const h=harness({vehicle:electric,cacheFailure:true});await h.start({previous_subject:{...electric,ev_specs:specs()}});
  assert.equal(h.stats.starts.length,1);assert.equal(h.job.context.electric_specs,null);
  const result=await h.poll();assert.equal(result.status,200);assert.equal(result.data.subject.model,electric.model);
});
