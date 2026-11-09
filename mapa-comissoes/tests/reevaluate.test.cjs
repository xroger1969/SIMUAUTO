const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('./db-runtime/node_modules/jsdom');

const base=path.join(__dirname,'../comparador-auto-pro');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const script=name=>fs.readFileSync(path.join(base,name),'utf8').replace(/^import .*;\n/gm,'');
require('../comparador-auto-pro/commercial-identity.js');
const loadModule=name=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(base,name),'utf8')).toString('base64'));
const modules=Promise.all(['valuation.js','input.js'].map(loadModule));
const owner='00000000-0000-4000-8000-000000000001';
const analysisId='00000000-0000-4000-8000-000000000011';
const jobId='00000000-0000-4000-8000-000000000033';
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function until(predicate){
  for(let n=0;n<200;n++){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,2));
  }
  throw new Error('Reevaluation did not reach the expected state');
}
const vehicle={make:'Dacia',model:'Spring',trim:'Essential',year:2023,first_registration:'03/2023',fuel:'electric',
  power_cv:45,battery_kwh:26.8,mileage_km:62484,price:8900,origin:'imported',registration:null};
const condition={assessed:true,findings:[],checks:[],battery_soh_pct:91,inspection:{last_date:'2026-04-11',mileage_km:58000}};
const deal={margin_policy_version:1,target_margin:null,minimum_margin:1500,risk_reserve:280,
  costs:{auction_fee:0,transport:240,reconditioning:180,warranty_reserve:320,stock_finance:0,other:75,registration:35},
  reconditioning:{paint_mode:'trade',pricing_version:2,paint_min_eur:80,paint_max_eur:100}};
function market(subject=vehicle,price=13000){
  return {ok:true,status:'completed',job_id:jobId,subject:clone(subject),market_comment:'Amostra de teste',risk_flags:[],
    condition_report:clone(condition),condition_overrides:{front_bumper:150},auction_context:{is_auction:false,vehicle_location:'PT',evidence:'Viatura anunciada em Portugal'},
    comparables:[1,2,3].map(n=>({...subject,registration:'AA-0'+n+'-BB',price:price+n*100,mileage_km:subject.mileage_km+n*1000,
      url:'https://stand'+n+'.example/vehicle/spring',seller_name:'Stand '+n,seller_type:'professional',country:'PT',price_basis:'gross',availability:'available',
      evidence:{verified:true,source_url_verified:true,observed_at:new Date().toISOString()}}))};
}

async function boot({sourceUrl='photo:1794209000000',sourceDomain='photo',auction=false}={}){
  const [engine,input]=await modules;
  const dom=new JSDOM(html,{url:'https://example.test/comparador-auto-pro/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,q=id=>w.document.getElementById(id);
  let savedRow=null,pendingJob=null,authChanged=()=>{},created=0;
  const requests=[],saves=[],updates=[];
  const db={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(fn){authChanged=fn;},signOut:async()=>authChanged('SIGNED_OUT',null)},
    from(table){const query={select(){return query;},eq(){return query;},order(){return query;},
      maybeSingle:async()=>({data:table==='cap_revisions'?savedRow:null,error:null}),
      upsert:async()=>({error:null}),limit:async()=>({data:table==='cap_jobs'&&pendingJob?[pendingJob]:[],error:null})};return query;}};
  w.supabase={createClient:()=>db};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.createScreenWakeLock=()=>({enabled:false,setEnabled(value){this.enabled=value;},ensure:async()=>{}});
  w.evaluateBasePurchase=engine.evaluatePurchase;w.relevantMemories=()=>[];Object.assign(w,input);
  w.eval(script('commercial-identity.js'));
  let http=async request=>({status:200,data:request.body?.action==='cancel'?{ok:true,status:'cancelled',provider_cancelled:true}:market(vehicle,15000)});
  w.fetch=async(url,options={})=>{
    const request={url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null,signal:options.signal};
    requests.push(request);
    if(!request.url.startsWith('/api/comparador-market'))throw Error('Unexpected network request: '+request.url);
    const response=await http(request);
    return {ok:response.status>=200&&response.status<300,status:response.status,json:async()=>response.data};
  };
  w.eval(script('app-v2.js')+`\n;globalThis.reevaluationHarness={
    signIn(){session={user:{id:'${owner}'},access_token:'test'};q('authGate').classList.add('hidden');q('app').classList.remove('hidden');},
    seed(result,context,settings){currentAnalysisId='${analysisId}';currentMarketData=context;lastAnalysisContext=context;
      DEAL=mergeDeal(settings);q('vehicleMargin').value='3900';renderResult(result,context.sourceHost,context.market.risk_flags);},
    setPreferences(settings){DEAL=mergeDeal(settings);syncDealForm();},
    openHistory:openSavedRevision,resume:resumePendingAnalysis,stop:stopActiveAssessment,
    get busy(){return !!activeOperation;},get result(){return currentResult;},get context(){return currentMarketData;},
    get history(){return currentHistoryRevision;},get deal(){return DEAL;},get vehicle(){return currentVehicle;},get analysisId(){return currentAnalysisId;}
  };
  loadMemories=async()=>[];storeMessage=async()=>{};researchElectricSpecs=async()=>{};
  waitForMarketPoll=async()=>{};
  `);
  await new Promise(resolve=>setTimeout(resolve,0));
  const h=w.reevaluationHarness;h.signIn();
  w.eval(`createAnalysis=async()=>globalThis.testCreateAnalysis();
    updateAnalysis=async(patch,id)=>globalThis.testUpdateAnalysis(patch,id);
    persistCompletedAnalysis=async(id,result,market,reader,entry,payload,kind)=>globalThis.testSave(id,makeSnapshot(result,market,reader,entry,payload,kind));`);
  w.testCreateAnalysis=async()=>{created++;return '00000000-0000-4000-8000-000000000022';};
  w.testUpdateAnalysis=async(patch,id)=>{updates.push({id,patch:clone(patch)});};
  w.testSave=async(id,snapshot)=>{saves.push({id,snapshot:clone(snapshot)});return true;};
  const oldMarket=market();
  if(auction)oldMarket.auction_context={is_auction:true,vehicle_location:'foreign',origin_country:'FR',evidence:'Leilão em França identificado nas fotografias.'};
  const original=engine.evaluatePurchase({subject:clone(vehicle),current_purchase_price:vehicle.price,comparables:oldMarket.comparables,condition_report:clone(condition),
    reconditioning_settings:clone(deal.reconditioning),costs:clone(deal.costs),risk_reserve:deal.risk_reserve,target_margin:3900,minimum_margin:deal.minimum_margin,
    source_context:auction?clone(oldMarket.auction_context):{is_auction:false,vehicle_location:'PT',evidence:'Fotografias da viatura'}});
  const reader={ok:true,status:'ok',source_kind:'photo',page:{title:'Dacia Spring Essential',text_sample:'Dacia Spring Essential 2023 · 62 484 km · 8 900 €',description:'Fotografia lida anteriormente.'}};
  const validLink=/^https?:\/\//.test(sourceUrl);
  const context={market:oldMarket,reader,sourceHost:sourceDomain,entry:{sourceUrl,sourceDomain,mode:validLink?'url':'manual',registration:null},
    marketPayload:{url:validLink?sourceUrl:null,mode:validLink?'url':'manual',description:reader.page.text_sample,registration:null,image_data_urls:['data:image/jpeg;base64,YQ==']},allRules:[]};
  h.seed(original,clone(context),clone(deal));
  const snapshot={saved_at:'2026-11-09T07:22:00Z',calculation_kind:'analysis',result:clone(original),deal:clone(deal),reader:clone(reader),
    source:{url:sourceUrl,domain:sourceDomain,mode:validLink?'url':'manual'},
    research:{job_id:jobId,condition_report:clone(condition),condition_overrides:{front_bumper:150},risk_flags:[],auction_context:clone(oldMarket.auction_context)}};
  savedRow={id:'revision-original',analysis_id:analysisId,user_id:owner,created_at:'2026-11-09T07:22:00Z',snapshot};
  const click=()=>{
    const button=q('reevaluateBtn');assert.ok(button,'A visible reevaluation control must exist');
    button.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
  };
  return {dom,w,q,h,requests,saves,updates,original,context,savedRow,snapshot,click,get created(){return created;},
    setHttp(handler){http=handler;},setPendingJob(job){pendingJob=job;},expire(){authChanged('SIGNED_OUT',null);},close(){dom.window.close();}};
}

test('reevaluating the current car performs a fresh market search with the same vehicle and commercial assumptions',async()=>{
  const a=await boot();try{
    const original=clone(a.original);
    assert.equal(a.q('reevaluateBtn').hidden,false);
    assert.match(a.q('reevaluateBtn').textContent,/reavaliar/i);
    a.click();await until(()=>a.requests.length>0&&!a.h.busy);
    const calls=a.requests.filter(r=>r.method==='POST'&&r.body?.action!=='cancel');assert.equal(calls.length,1);
    const body=calls[0].body;
    assert.equal(body.force_market_refresh,true);
    for(const field of ['make','model','trim','year','first_registration','fuel','power_cv','battery_kwh','mileage_km','price'])assert.equal(body.previous_subject[field],vehicle[field],field);
    assert.deepEqual(body.previous_condition_report,condition);
    assert.equal(a.h.result.subject.mileage_km,62484);assert.equal(a.h.result.subject.price,8900);
    assert.equal(a.h.result.purchase.targetMargin,3900);assert.equal(a.h.result.purchase.riskReserve,280);
    for(const [key,value] of Object.entries(deal.costs))assert.equal(a.h.result.parameters.costs[key],value,key);
    assert.notEqual(a.h.result.market.marketValue,original.market.marketValue,'New references must enter the new calculation');
    assert.equal(a.saves.length,1);assert.deepEqual(clone(a.original),original,'The previous calculation remains intact');
    assert.equal(a.h.context.market.condition_overrides.front_bumper,150);
  }finally{a.close();}
});

test('a photo-only historical revision can be reevaluated without uploading again, preserving its costs and manual margin',async()=>{
  const a=await boot();try{
    const original=clone(a.savedRow);
    a.h.setPreferences({...deal,target_margin:7000,risk_reserve:999,costs:{...deal.costs,transport:999}});
    await a.h.openHistory('revision-original');
    assert.equal(a.requests.length,0,'Opening a revision is still read-only');
    assert.equal(a.h.history.id,'revision-original');assert.equal(a.q('reevaluateBtn').disabled,false);
    a.q('vehicleMargin').value='9000';
    a.click();await until(()=>a.requests.length>0&&!a.h.busy);
    const body=a.requests.find(r=>r.method==='POST'&&r.body?.action!=='cancel').body;
    assert.equal(body.mode,'manual');assert.equal(body.url,null);assert.equal(body.force_market_refresh,true);
    assert.ok(body.description.length>10);assert.match(body.description,/Dacia/i);assert.match(body.description,/Spring/i);
    assert.doesNotMatch(body.description,/^PHOTO:/i);assert.ok(!body.registration||!/PHOTO/i.test(body.registration));
    assert.ok(!body.image_data_urls?.length,'Historical extracted facts work without stored photo bytes');
    assert.equal(body.previous_subject.year,2023);assert.equal(body.previous_subject.mileage_km,62484);assert.equal(body.previous_subject.price,8900);
    assert.deepEqual(body.previous_condition_report,condition);
    assert.equal(a.h.result.purchase.targetMargin,3900,'The historical per-car margin wins over other inputs');
    assert.equal(a.h.result.purchase.riskReserve,280);
    assert.equal(a.h.result.parameters.costs.transport,240);
    assert.equal(a.h.result.parameters.costs.reconditioning,180);
    assert.equal(a.saves.length,1);assert.equal(a.saves[0].snapshot.calculation_kind,'reevaluation');
    assert.deepEqual(a.savedRow,original,'The original saved revision is immutable');
    assert.equal(a.h.history,null,'The updated result is editable independently of the original revision');
    assert.doesNotMatch(a.q('vehicleUrl').value,/^PHOTO:/i,'The input displays a useful identity rather than a photo identifier');
  }finally{a.close();}
});

test('a legacy revision without saved deal or margin mode preserves its recorded amounts instead of inheriting current preferences',async()=>{
  const a=await boot();try{
    delete a.savedRow.snapshot.deal;
    delete a.savedRow.snapshot.result.purchase.marginMode;
    const original=clone(a.savedRow);
    a.h.setPreferences({...deal,target_margin:7000,risk_reserve:999,costs:{...deal.costs,transport:999,reconditioning:999}});
    await a.h.openHistory('revision-original');
    a.q('vehicleMargin').value='9000';
    a.click();await until(()=>a.requests.length>0&&!a.h.busy);
    assert.equal(a.saves.length,1);assert.equal(a.saves[0].snapshot.calculation_kind,'reevaluation');
    assert.equal(a.h.result.purchase.targetMargin,3900);
    assert.equal(a.h.result.purchase.riskReserve,280);
    for(const [key,value] of Object.entries(deal.costs))assert.equal(a.h.result.parameters.costs[key],value,key);
    assert.equal(a.h.result.parameters.reconditioning_settings.paint_mode,'trade');
    assert.deepEqual(a.savedRow,original,'Updating a legacy result leaves the old revision unchanged');
  }finally{a.close();}
});

test('a real source link stays in the new snapshot while reevaluation uses the extracted identity without rereading the advert',async()=>{
  const url='https://www.standvirtual.com/carros/anuncio/dacia-spring-test';
  const a=await boot({sourceUrl:url,sourceDomain:'standvirtual.com'});try{
    await a.h.openHistory('revision-original');a.click();await until(()=>a.requests.length>0&&!a.h.busy);
    const body=a.requests.find(r=>r.method==='POST'&&r.body?.action!=='cancel').body;
    assert.equal(body.mode,'manual');assert.equal(body.url,null);assert.equal(body.force_market_refresh,true);
    assert.equal(body.previous_subject.trim,'Essential');assert.equal(body.previous_subject.price,8900);
    assert.equal(a.saves[0].snapshot.source.url,url);
    assert.equal(a.saves[0].snapshot.result.parameters.source_context.vehicle_location,'PT');
    assert.ok(a.requests.every(r=>r.url.startsWith('/api/comparador-market')));
  }finally{a.close();}
});

test('a photo-only auction retains its recorded foreign location and import cost during reevaluation',async()=>{
  const a=await boot({auction:true});try{
    await a.h.openHistory('revision-original');
    assert.equal(a.h.result.purchase.importCost,1200);
    a.click();await until(()=>a.requests.length>0&&!a.h.busy);
    const body=a.requests.find(r=>r.method==='POST'&&r.body?.action!=='cancel').body;
    assert.equal(body.previous_auction_context.vehicle_location,'foreign');
    assert.equal(a.h.result.purchase.importCost,1200);
    assert.equal(a.h.result.parameters.source_context.is_auction,true);
    assert.equal(a.h.result.parameters.source_context.vehicle_location,'foreign');
  }finally{a.close();}
});

test('a terminal reevaluation failure preserves the original current or historical result and allows retry',async()=>{
  for(const historical of [false,true]){
    const a=await boot();try{
      if(historical)await a.h.openHistory('revision-original');
      const original=a.h.result,old=clone(original),saved=clone(a.savedRow);
      a.setHttp(async()=>({status:503,data:{error:'market_job_failed',message:'Pesquisa temporariamente indisponível'}}));
      a.click();await until(()=>a.requests.length>0&&!a.h.busy);
      assert.equal(a.h.result,original);assert.deepEqual(clone(a.h.result),old);
      assert.equal(a.q('result').classList.contains('hidden'),false);assert.equal(a.saves.length,0);
      assert.equal(a.q('reevaluateBtn').disabled,false);assert.deepEqual(a.savedRow,saved);
      assert.equal(a.h.history?.id||null,historical?'revision-original':null);
      a.setHttp(async()=>({status:200,data:market(vehicle,16000)}));a.click();await until(()=>a.saves.length===1&&!a.h.busy);
      assert.equal(a.saves.length,1);assert.notEqual(a.h.result.market.marketValue,old.market.marketValue);
    }finally{a.close();}
  }
});

test('double tapping creates one job and cancellation preserves history even if the response arrives later',async()=>{
  const a=await boot();try{
    await a.h.openHistory('revision-original');
    const original=a.h.result,old=clone(original),saved=clone(a.savedRow),gate=deferred();
    a.setHttp(async request=>{
      if(request.body?.action==='cancel')return {status:200,data:{ok:true,status:'cancelled',provider_cancelled:true}};
      if(request.method==='POST')return {status:202,data:{ok:true,status:'queued',job_id:jobId}};
      return gate.promise;
    });
    a.click();a.click();await until(()=>a.requests.some(r=>r.method==='GET'));
    assert.equal(a.requests.filter(r=>r.method==='POST'&&r.body?.action!=='cancel').length,1);
    assert.equal(a.h.result,original,'The existing values remain available during research');
    assert.equal(a.q('reevaluateBtn').disabled,true);
    assert.equal(a.q('stopAssessmentBtn').hidden,false);
    a.h.stop();await until(()=>!a.h.busy);
    gate.resolve({status:200,data:market(vehicle,17000)});
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(a.saves.length,0);assert.equal(a.h.result,original);assert.deepEqual(clone(a.h.result),old);
    assert.equal(a.h.history?.id,'revision-original');assert.deepEqual(a.savedRow,saved);
    assert.equal(a.q('reevaluateBtn').disabled,false);
    assert.equal(a.requests.filter(r=>r.body?.action==='cancel').length,1);
  }finally{a.close();}
});

test('an interrupted reevaluation resumes the existing job with its saved costs and margin instead of starting again',async()=>{
  const a=await boot();try{
    await a.h.openHistory('revision-original');
    a.setHttp(async request=>request.method==='POST'
      ?{status:202,data:{ok:true,status:'queued',job_id:jobId}}
      :{status:503,data:{error:'temporary_connection_error',message:'Ligação temporariamente indisponível'}});
    a.click();await until(()=>a.requests.filter(r=>r.method==='GET').length>=4&&!a.h.busy);
    assert.equal(a.saves.length,0);assert.equal(a.q('pendingResearch').classList.contains('hidden'),false);
    const checkpoint=JSON.parse(a.w.localStorage.getItem('cap:research-checkpoint:'+owner));
    assert.equal(checkpoint.jobId,jobId);assert.equal(checkpoint.reevaluation.analysisId,analysisId);
    assert.equal(checkpoint.reevaluation.targetMargin,3900);assert.equal(checkpoint.reevaluation.deal.risk_reserve,280);
    assert.ok(!JSON.stringify(checkpoint).includes('data:image/'),'Resumption persists extracted facts without photo bytes');
    a.setPendingJob({id:jobId,analysis_id:analysisId,status:'in_progress',context:{force_market_refresh:true},created_at:new Date().toISOString()});
    a.h.setPreferences({...deal,target_margin:7000,risk_reserve:999,costs:{...deal.costs,transport:999}});a.q('vehicleMargin').value='9000';
    a.setHttp(async()=>({status:200,data:market(vehicle,16000)}));
    await a.h.resume(jobId);
    assert.equal(a.requests.filter(r=>r.method==='POST').length,1,'Resumption must poll the existing paid job');
    assert.ok(a.requests.at(-1).url.includes('resume=1'));
    assert.equal(a.saves.length,1);assert.equal(a.saves[0].snapshot.calculation_kind,'reevaluation');
    assert.equal(a.h.result.purchase.targetMargin,3900);assert.equal(a.h.result.purchase.riskReserve,280);
    assert.equal(a.h.result.parameters.costs.transport,240);assert.equal(a.h.result.subject.price,8900);
  }finally{a.close();}
});
