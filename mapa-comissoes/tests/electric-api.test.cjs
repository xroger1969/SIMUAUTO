const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const range=require("../comparador-auto-pro/electric-range.js");
const access=require("../lib/access");
const apiPath=path.resolve(__dirname,"../api/comparador-electric.js");
const jobId="00000000-0000-4000-8000-000000000003";
const car={make:"Dacia",model:"Spring",trim:"Essential",year:2023,fuel:"electric",power_cv:45};
function specification(vehicle=car){
  return {research_version:1,checked_at:new Date().toISOString(),identity:range.rangeIdentity(vehicle),status:"partial",
    battery:{capacity_kwh:26.8,basis:"usable",source_url:"https://e-brochure.dacia.pt/spring/mobile/m_spring_extreme_bbg_pt_novembre_2023.pdf",source_title:"Dacia 2023",evidence:"Capacidade utilizável: 26,8 kWh"},
    wltp:{combined_km:230,source_url:"https://presse.dacia.de/der-dacia-spring-agiler-city-stromer/",source_title:"Dacia 2023",evidence:"Electric 45: WLTP combined 230 km"},real_range:null,clarification:null};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness({known=false,quota=true,researchError=null,saved=null,delay=null,cacheFailure=false}={}){
  const stats={research:0,quotas:0,writes:[],researchInputs:[]};
  const job={id:jobId,status:"completed",created_at:"2026-10-01T08:00:00Z",updated_at:"2026-10-01T08:01:00Z",
    context:saved?{electric_specs:saved}:{},result:{subject:{...car},comparables:[{price:12000,url:"https://example.test/ad"}],market_comment:"Original market"}};
  const auth={...access,authenticate:async req=>{
    if(!req.headers.authorization)throw access.appError("Sessão inválida.",401,"invalid_auth");
    return {token:req.headers.authorization,user:{id:req.headers.authorization}};
  },takeQuota:async()=>{stats.quotas++;if(!quota)throw access.appError("Limit",429,"rate_limited");},
    rest:async(token,query,options={})=>{
      if(options.method==="PATCH"){stats.writes.push({query,body:structuredClone(options.body)});if(cacheFailure)throw Error("storage offline");Object.assign(job,structuredClone(options.body));return null;}
      if(query.includes("context->electric_specs"))return [];
      if(query.includes("id=eq."+jobId))return [structuredClone(job)];
      return [];
    }};
  const research={knownElectricSpecs:vehicle=>known?specification(vehicle):null,researchElectricSpecs:async vehicle=>{
    stats.research++;stats.researchInputs.push(vehicle);if(delay)await delay.promise;if(researchError)throw researchError;return specification(vehicle);
  }};
  const ctx={module:{exports:{}},Date,Map,Set,process,require:name=>name==="../lib/access"?auth:name==="../lib/electric-specs"?research:
    name.startsWith(".")?require(path.resolve(path.dirname(apiPath),name)):require(name)};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(apiPath,"utf8"),ctx);
  const call=async(body={vehicle:car,job_id:jobId},owner="owner")=>{
    let status=200,data;await ctx.module.exports({method:"POST",body,headers:{authorization:owner}},
      {setHeader(){},status(code){status=code;return this;},json(value){data=value;return value;}});return {status,data};
  };
  return {call,stats,job,api:ctx.module.exports._test};
}

test("electric research requires a session and rejects a vehicle different from the owned valuation",async()=>{
  const h=harness();
  assert.equal((await h.call(undefined,"")).status,401);
  assert.equal((await h.call({vehicle:car,job_id:"00000000-0000-4000-8000-000000000099"})).status,404);
  assert.equal((await h.call({vehicle:{...car,year:2026},job_id:jobId})).status,409);
  assert.equal(h.stats.research,0);
});
test("known official specifications do not spend another plate credit or AI quota",async()=>{
  const h=harness({known:true}),response=await h.call();
  assert.equal(response.status,200);assert.equal(response.data.ev_specs.wltp.combined_km,230);
  assert.equal(h.stats.research,0);assert.equal(h.stats.quotas,0);
});
test("technical enrichment preserves prices and the original age of the market snapshot",async()=>{
  const h=harness({known:true});
  const before=structuredClone(h.job.result),beforeDate=h.job.updated_at;
  await h.call();
  assert.deepEqual(h.job.result.comparables,before.comparables);
  assert.equal(h.job.result.market_comment,before.market_comment);
  assert.equal(h.job.result.market_cache.snapshot_at,beforeDate);
  assert.equal(h.job.status,"completed");
  assert.equal(h.job.result.subject.battery_kwh,undefined,"Nominal research must not change the vehicle/valuation inputs");
  assert.ok(h.stats.writes[0].query.includes("updated_at=eq."+encodeURIComponent(beforeDate)),"Concurrent result updates are guarded");
  assert.ok(h.job.context.electric_specs.cache_key);
});
test("only technical identity reaches research, not photos, registration or client verification flags",async()=>{
  const h=harness();
  const response=await h.call({vehicle:{...car,registration:"AA-00-AA",vin:"PRIVATE",price:10000,mileage_km:62484,image_data_urls:["secret"],ev_specs:specification()},job_id:null});
  assert.equal(response.status,200);assert.equal(h.stats.research,1);
  assert.deepEqual(Object.keys(h.stats.researchInputs[0]).sort(),Object.keys(range.rangeIdentity(car)).sort());
  assert.doesNotMatch(JSON.stringify(h.stats.researchInputs),/PRIVATE|AA-00-AA|62484|image_data|source_url/);
});
test("overlapping lookups deduplicate only within the same authenticated user",async()=>{
  const delay=deferred(),h=harness({delay});
  const first=h.call({vehicle:car}),second=h.call({vehicle:car}),third=h.call({vehicle:car},"another-owner");
  for(let i=0;i<50&&h.stats.research<2;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.stats.research,2);delay.resolve();
  await Promise.all([first,second,third]);assert.equal(h.stats.quotas,2);
});
test("failures remain optional and leave the completed market intact",async()=>{
  const h=harness({researchError:access.appError("Technical source unavailable",502,"electric_unavailable")});
  const original=structuredClone(h.job);
  const response=await h.call();assert.equal(response.status,502);
  assert.deepEqual(h.job,original);assert.equal(h.stats.writes.length,0);
  const blocked=harness({quota:false});assert.equal((await blocked.call()).status,429);assert.equal(blocked.stats.research,0);
  const cache=harness({known:true,cacheFailure:true});const ok=await cache.call();
  assert.equal(ok.status,200);assert.equal(ok.data.cache_saved,false);assert.equal(ok.data.ev_specs.battery.capacity_kwh,26.8);
});
test("separate fields survive and technical cache expires without carrying across vehicle identities",()=>{
  const specs=specification();
  const batteryOnly={...specs,wltp:null};
  assert.equal(range.confirmedSpecs({...car,ev_specs:batteryOnly}).battery.capacity_kwh,26.8);
  assert.equal(range.confirmedSpecs({...car,year:2026,ev_specs:specs}),null);
  assert.equal(range.needsSpecsResearch({...car,ev_specs:specs}),false);
  const negative={...specs,status:"not_found",battery:null,wltp:null,checked_at:new Date(Date.now()-3600001).toISOString()};
  assert.equal(range.needsSpecsResearch({...car,ev_specs:negative}),true);
  assert.equal(range.needsSpecsResearch({...car,fuel:"diesel"}),false);
  const partial={...specs,checked_at:new Date(Date.now()-31*86400000).toISOString()};
  assert.equal(range.needsSpecsResearch({...car,ev_specs:partial}),true);
});
test("an explicit retry can bypass a recent negative result without trusting browser-supplied research",async()=>{
  const saved={...specification(),status:"not_found",battery:null,wltp:null};
  const h=harness({saved});
  assert.equal((await h.call()).data.ev_specs.status,"not_found");assert.equal(h.stats.research,0);
  assert.equal((await h.call({vehicle:car,job_id:jobId,force:true})).data.ev_specs.wltp.combined_km,230);
  assert.equal(h.stats.research,1);
});
test("market identification and cached valuations cannot promote browser-injected technical verification",async()=>{
  const market=require("../api/comparador-market.js")._test;
  const fake={...specification(),wltp:{...specification().wltp,combined_km:999}};
  const result=await market.finalizeMarketResponse({output_text:JSON.stringify({subject:{...car,ev_specs:fake},comparables:[]})});
  assert.equal(result.subject.ev_specs,undefined);
  const stored={id:jobId,updated_at:new Date().toISOString(),result:{subject:{...car,ev_specs:fake},comparables:[]},context:{electric_specs:specification()}};
  const reused=market.reuseMarketCache(stored,{...car,ev_specs:fake},null,"key");
  assert.equal(reused.subject.ev_specs.wltp.combined_km,230);
  assert.equal(market.reuseInputCache(stored,"input").subject.ev_specs.wltp.combined_km,230);
  delete stored.context.electric_specs;
  assert.equal(market.reuseInputCache(stored,"input").subject.ev_specs,null);
});
