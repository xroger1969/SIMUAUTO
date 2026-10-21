const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const {registrationCompatible,mergeRegistration,missingIdentity,marketCacheKey,reuseMarketCache,reuseInputCache,inputSignature,cacheAllowed}=require('../api/comparador-market')._test;
const subject={make:'Tesla',model:'Model Y',trim:'Long Range',year:2023,mileage_km:50000,fuel:'electric',price:30000};
function harness({vehicle=subject,provider={make:'BMW',model:'320d'},cache=[],stage='identify',extra={}}={}){
  let providerCalls=0,researchCalls=0,cacheWrites=0;
  const job={id:'00000000-0000-4000-8000-000000000001',response_id:'resp_1',context:{stage},status:'in_progress'};
  const output={status:'completed',output_text:JSON.stringify({subject:vehicle,comparables:[],...extra})};
  const access={authenticate:async()=>({token:'test'}),endpoint:fn=>fn,appError:(m,s)=>Object.assign(new Error(m),{status:s}),rest:async(t,p,o={})=>{
    if(p.startsWith('cap_registration_cache')){if(o.method==='POST'){cacheWrites++;return null;}return cache;}
    if(p.startsWith('cap_jobs?select'))return [structuredClone(job)];
    if(o.method==='PATCH'){if(p.includes('stage=eq.identify')&&job.context.stage!=='identify')return [];Object.assign(job,o.body);return [job];}
    throw Error(p);
  }};
  const ctx={module:{exports:{}},require:p=>p==='node:crypto'?require(p):p==='../lib/access'?access:p==='../lib/registration'?{...require('../lib/registration'),lookupRegistration:async()=>{providerCalls++;return provider;}}:require(path.resolve(base,'api',p)),console,process:{env:{OPENAI_API_KEY:'test'}},URL,Date,Set,AbortSignal,
    fetch:async(url,o)=>{if(o?.method==='POST'){researchCalls++;return {ok:true,json:async()=>({id:'resp_market',status:'queued'})};}return {ok:true,json:async()=>output};}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(base+'/api/comparador-market.js','utf8'),ctx);
  return {ctx,job,output,counts:()=>({providerCalls,researchCalls,cacheWrites}),poll:async()=>{let status,result;await ctx.module.exports({method:'GET',query:{job_id:job.id}},{status:n=>{status=n;return {json:x=>{result=x;}}}});return {status,result};}};
}
test('two-stage API preserves observed condition and PT location while enriching verified repair prices',async()=>{
  const observed={assessed:true,summary:'Relatório original',findings:[{component:'left_door',label:'Porta esquerda',category:'paint',action:'paint',status:'confirmed',quantity:1,evidence:'Riscos documentados na porta',source_image:1,cost:{}}],battery_soh_pct:null};
  const h=harness({extra:{condition_report:observed,auction_context:{is_auction:true,vehicle_location:'PT',origin_country:'DE'}}});
  const first=await h.poll();
  assert.equal(first.status,202);assert.equal(h.job.context.previous_condition_report.findings.length,1);
  const researched={...observed,battery_soh_pct:99,findings:[{...observed.findings[0],status:'ok',cost:{parts_min_eur:0,parts_max_eur:0,labour_min_eur:150,labour_max_eur:150,price_basis:'net',source_url:'https://oficina.example/pintura',source_title:'Pintura desde 150 EUR + IVA',fitment_note:'Confirmar em oficina'}}]};
  h.output.output_text=JSON.stringify({subject,comparables:[],condition_report:researched,auction_context:{vehicle_location:'foreign',origin_country:'DE'}});
  h.output.output=[{type:'web_search_call',action:{sources:[{url:'https://oficina.example/pintura'}]}}];
  const second=await h.poll();
  assert.equal(second.status,200);assert.equal(second.result.auction_context.vehicle_location,'PT');
  assert.equal(second.result.condition_report.battery_soh_pct,null);
  assert.equal(second.result.condition_report.findings[0].status,'confirmed');
  assert.equal(second.result.condition_report.findings[0].cost.source_verified,true);
  assert.equal(second.result.condition_report.findings[0].cost.labour_max_eur,150);
  assert.equal(h.job.result.condition_report.findings[0].evidence,observed.findings[0].evidence);
});
test('different Tesla and VW models never share identity merely through a word',()=>{
  for(const [a,b] of [['Model Y','Model 3'],['ID.4','ID.5'],['Golf','Golf Plus']])assert.equal(registrationCompatible({make:'Tesla',model:a},{make:'Tesla',model:b}),false);
  assert.equal(registrationCompatible({make:'VW',model:'ID.4'},{make:'Volkswagen',model:'ID 4'}),true);
});
test('o modelo de matrícula Kona é compatível com a versão Kona 1.6 Hybrid',()=>{
  assert.equal(registrationCompatible({make:'Hyundai',model:'Kona 1.6 Hybrid Prime'},{make:'Hyundai',model:'Kona'}),true);
  assert.equal(registrationCompatible({make:'Hyundai',model:'Kona Hybrid'},{make:'Hyundai',model:'Kona'}),true);
  assert.equal(registrationCompatible({make:'Hyundai',model:'Kona'},{make:'Hyundai',model:'Tucson'}),false);
});

test('unknown km requires confirmation; explicit zero is allowed',()=>{
  for(const value of [null,undefined,'',-1,'unknown'])assert.ok(missingIdentity({...subject,mileage_km:value}).includes('mileage_km'));
  assert.deepEqual(missingIdentity({...subject,mileage_km:0}),[]);
});
test('registration cannot overwrite confirmed price mileage or trim',()=>{
  const r=mergeRegistration(subject,{make:'Tesla',model:'Model Y',trim:'RWD',price:1,mileage_km:0});
  assert.equal(r.price,30000);assert.equal(r.mileage_km,50000);assert.equal(r.trim,'Long Range');
});
test('same vehicle produces the same 24h market cache key across input sources',()=>{
  const manual={input_mode:'manual',original_url:null};
  const listing={input_mode:'url',original_url:'https://www.standvirtual.com/carros/anuncio/abc'};
  const a=marketCacheKey(subject,manual),b=marketCacheKey({...subject},listing);
  assert.equal(a,b);assert.match(a,/market-v5-model-fuel-20261021\|vehicle-v1/);
  assert.notEqual(a,marketCacheKey({...subject,trim:'Performance'},manual));
});
test('identical uploaded photos generate the same exact-input signature',()=>{
  const image='data:image/jpeg;base64,YWJj';
  const a=inputSignature({mode:'manual',description:' Tesla Model Y ',image_data_urls:[image]});
  const b=inputSignature({mode:'manual',description:'tesla   model y',image_data_urls:[image]});
  assert.equal(a,b);
  assert.match(a,/^input-v7-model-fuel-20261021:/);
  assert.notEqual(a,inputSignature({mode:'manual',description:'tesla model y',image_data_urls:['data:image/jpeg;base64,ZGVm']}));
});
test('force refresh is the only explicit bypass for stable cache',()=>{
  assert.equal(cacheAllowed({refinement_history:[]}),true);
  assert.equal(cacheAllowed({refinement_history:[],force_market_refresh:true}),false);
  assert.equal(cacheAllowed({refinement_history:['nova versão']}),false);
});
test('um resultado sem comparáveis não fica preso na cache de 24 horas',async()=>{
  const h=harness({stage:'completed'});
  h.job.status='completed';
  h.job.updated_at=new Date().toISOString();
  h.job.result={subject,comparables:[]};
  const lookup=h.ctx.module.exports._test.findFreshInputCache;
  assert.equal(await lookup('test','nova-assinatura'),null);
  h.job.result.comparables=[{url:'https://stand.example/vehicle/1',price:22000}];
  const cached=await lookup('test','nova-assinatura');
  assert.equal(cached.id,h.job.id);
});

test('exact input reuse preserves the original market snapshot time',()=>{
  const cached={id:'old-job',updated_at:'2026-10-06T07:00:00.000Z',snapshot_at:'2026-10-06T06:55:00.000Z',result:{subject,comparables:[{url:'https://example.com/1',price:30000}],market_cache:{snapshot_at:'2026-10-06T06:55:00.000Z'}}};
  const r=reuseInputCache(cached,'input-v1:test');
  assert.equal(r.market_cache.hit,true);assert.equal(r.market_cache.reuse_mode,'exact_input');assert.equal(r.market_cache.snapshot_at,'2026-10-06T06:55:00.000Z');assert.equal(r.input_signature,'input-v1:test');
});
test('reused market snapshot keeps current vehicle facts and original snapshot time',()=>{
  const cached={id:'old-job',updated_at:'2026-10-06T07:00:00.000Z',snapshot_at:'2026-10-06T06:55:00.000Z',result:{subject:{...subject,mileage_km:49000},comparables:[{url:'https://example.com/1',price:30000}]}};
  const r=reuseMarketCache(cached,{...subject,mileage_km:50000},null,'key');
  assert.equal(r.subject.mileage_km,50000);assert.equal(r.market_cache.hit,true);assert.equal(r.market_cache.snapshot_at,'2026-10-06T06:55:00.000Z');
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


test('MyCarPlate Portugal response maps the useful technical fields',()=>{
  const {parseMyCarPlateData}=require('../lib/registration');
  const r=parseMyCarPlateData({success:true,data:{
    plate:'14ID91',country:'PT',make:'Renault',model:'Megane',version:'1.5 dCi',
    year:2009,engineSize:'1461',fuelType:'Diesel',horsePower:106,powerKw:78,
    doors:5,color:'Grey',firstRegistration:'2009-08-12',bodyClass:'Hatchback'
  }});
  assert.equal(r.registration,'14-ID-91');
  assert.equal(r.make,'Renault');
  assert.equal(r.model,'Megane');
  assert.equal(r.trim,'1.5 dCi');
  assert.equal(r.year,2009);
  assert.equal(r.engine_cc,1461);
  assert.equal(r.power_cv,106);
  assert.equal(r.fuel,'Diesel');
  assert.equal(r.provider,'mycarplate');
});

test('registration merge fills power from a plate provider without overwriting confirmed power',()=>{
  const missing=mergeRegistration({...subject,power_cv:null},{make:'Tesla',model:'Model Y',power_cv:351});
  const confirmed=mergeRegistration({...subject,power_cv:299},{make:'Tesla',model:'Model Y',power_cv:351});
  assert.equal(missing.power_cv,351);
  assert.equal(confirmed.power_cv,299);
});


test('MyCarPlate can infer a shared model from ambiguous Portuguese version options',()=>{
  const {parseMyCarPlateData}=require('../lib/registration');
  const r=parseMyCarPlateData({success:true,data:{
    plate:'14ID91',make:'Renault',model:null,year:2009,fuelType:'Diesel',firstRegistration:'2009-08-31',
    transmission:'Manual',confidence:0.9,
    versionOptions:[
      'Mégane II Break Diesel Fase II 1.5 dCi SE Exclusive | 105cv | 5P | 5L',
      'Mégane III Sport Tourer Diesel 1.5 dCi Dynamique | 110cv | 5P | 5L',
      'Mégane III Coupé Diesel 1.5 dCi Dynamique | 105cv | 2P | 5L'
    ]
  }});
  assert.equal(r.registration,'14-ID-91');
  assert.equal(r.make,'Renault');
  assert.equal(r.model,'Mégane');
  assert.equal(r.year,2009);
  assert.equal(r.fuel,'Diesel');
  assert.equal(r.transmission,'Manual');
  assert.equal(r.version_options.length,3);
});

test('plate-only manual text is eligible for identity web search',()=>{
  const {plateOnlyIdentityText}=require('../api/comparador-market')._test;
  assert.equal(plateOnlyIdentityText({registration_input:'14-ID-91',text_sample:'14-ID-91'}),true);
  assert.equal(plateOnlyIdentityText({registration_input:'14-ID-91',text_sample:'Renault Mégane 2009'}),false);
});

test('plate-only identification uses web search even when the text sample is the plate',async()=>{
  const h=harness();let body;
  h.ctx.fetch=async(u,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({id:'resp_plate_text'})};};
  await h.ctx.module.exports._test.startResponse({registration_input:'14-ID-91',original_url:null,text_sample:'14-ID-91',manual_description:'14-ID-91'},[],{},true);
  assert.deepEqual(body.tools,[{type:'web_search'}]);
  assert.equal(body.tool_choice,'auto');
});


test('Spottd manufacture year 2020 prevails over 2024 Portuguese registration date',()=>{
 const source={...subject,make:'MERCEDES-BENZ',model:'CLA 180 d W118',year:2024,first_registration:'2024-07',price:22000,mileage_km:119283,trim:'180 d'};
 const verified={provider:'spottd',make:'MERCEDES-BENZ',model:'CLA 180 d W118',year:2020,registration_date_pt:'2024-07-17',power_cv:116,weight_kg:2075,origin:'unknown'};
 const result=mergeRegistration(source,verified);
 assert.equal(result.year,2020);
 assert.equal(result.year_source,'spottd.year_built');
 assert.equal(result.registration_date_pt,'2024-07-17');
 assert.equal(result.first_registration,null);
 assert.equal(result.price,22000);
 assert.equal(result.mileage_km,119283);
 assert.equal(result.trim,'180 d');
 assert.equal(result.weight_kg,2075);
});
test('Spottd unknown year preserves existing year; market cache separates true year',()=>{
 assert.equal(mergeRegistration(subject,{provider:'spottd',year:null}).year,2023);
 assert.equal(mergeRegistration(subject,{provider:'mycarplate',year:2020}).year,2023);
 const older=marketCacheKey({...subject,registration:'BM-55-DN',year:2020});
 const newer=marketCacheKey({...subject,registration:'BM-55-DN',year:2024});
 assert.notEqual(older,newer);
});

test('legacy cached Spottd date is migrated without another paid API request',async()=>{
 const cached={data:{provider:'spottd',registration:'BM-55-DN',make:'MERCEDES-BENZ',
   model:'CLA 180 d W118',year:2020,first_registration:'2024-07-17'}};
 const h=harness({cache:[cached]});
 const actual=await h.ctx.module.exports._test.lookupRegistrationCached('test','BM-55-DN');
 assert.equal(actual.year,2020);
 assert.equal(actual.registration_date_pt,'2024-07-17');
 assert.equal(actual.first_registration,null);
 assert.equal(actual.cache_hit,true);
 assert.equal(h.counts().providerCalls,0);
});

test('metadados OpenAI respeitam o limite e os campos Spottd seguem no contexto',async()=>{
  const h=harness();let body;
  h.ctx.fetch=async(u,options)=>{
    body=JSON.parse(options.body);
    return {ok:true,json:async()=>({id:'resp_metadata',status:'queued'})};
  };
  const allMetadata={cap_job_id:'00000000-0000-4000-8000-000000000001',cap_registration:'BM-55-DN',cap_source_url:'plate:BM55DN'};
  for(let i=0;i<30;i++)allMetadata['cap_reg_extra_'+i]='extra-'+i;
  const reg={provider:'spottd',registration:'BM-55-DN',year:2020,registration_date_pt:'2024-07-17',make:'MERCEDES-BENZ',model:'CLA 180 d'};
  await h.ctx.module.exports._test.startResponse({registration_data:reg,registration_input:'BM-55-DN'},[],allMetadata,false);
  assert.ok(Object.keys(body.metadata).length<=4);
  assert.equal(body.metadata.cap_registration,'BM-55-DN');
  assert.equal(body.metadata.cap_reg_extra_0,undefined);
  assert.ok(body.input.includes('"year":2020'));
  assert.ok(body.input.includes('"registration_date_pt":"2024-07-17"'));
});
