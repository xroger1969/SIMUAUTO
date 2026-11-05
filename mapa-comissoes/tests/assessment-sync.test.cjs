const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('./db-runtime/node_modules/jsdom');

const base=join(__dirname,'../comparador-auto-pro');
const html=readFileSync(join(base,'index.html'),'utf8');
const script=name=>readFileSync(join(base,name),'utf8').replace(/^import .*;\n/gm,'');
require('../comparador-auto-pro/commercial-identity.js');
const importSource=name=>import('data:text/javascript;base64,'+Buffer.from(readFileSync(join(base,name),'utf8')).toString('base64'));
const modules=Promise.all(['valuation.js','input.js','tax-simulator-calc.mjs'].map(importSource));
const owner='11111111-1111-4111-8111-111111111111';
const ford={make:'Ford',model:'Puma',trim:'1.0 EcoBoost',fuel:'petrol',year:2025,mileage_km:23897,registration:'BT-36-ZE'};
const tesla={make:'Tesla',model:'Model Y',trim:'Long Range',fuel:'electric',drivetrain:'AWD',year:2021,mileage_km:103000,registration:'AL-47-IC'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function until(predicate){
  for(let attempt=0;attempt<100;attempt++){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,2));
  }
  throw Error('The assessment did not finish');
}
function market(subject,price){
  return {subject,comparables:[1,2,3].map(i=>({...subject,price:price+i*100,registration:'AA-0'+i+'-BB',mileage_km:subject.mileage_km+i*1000,
    url:'https://dealer'+i+'.example/car/'+subject.registration,seller_type:'professional',country:'PT',
    seller_name:'Stand '+i,source_domain:'dealer'+i+'.example',listing_id:'listing-'+i,
    price_basis:'gross',availability:'available',observed_at:new Date().toISOString(),
    evidence:{verified:true,source_url_verified:true,observed_at:new Date().toISOString()}})),risk_flags:[]};
}

async function boot(preferences=null){
  const [engine,input,tax]=await modules;
  const dom=new JSDOM(html,{url:'https://example.test/comparador-auto-pro/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,q=id=>w.document.getElementById(id);
  let authChanged=()=>{},savedRevision=null,pendingJob=null,pendingAnalysis=null,delayedJobs=null;
  const db={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(fn){authChanged=fn;},
    signOut:async()=>{authChanged('SIGNED_OUT',null);}},from(table){
    const api={select(){return api;},eq(){return api;},order(){return api;},
      limit:async()=>delayedJobs||({data:pendingJob?[pendingJob]:[],error:null}),
      upsert:async()=>({error:null}),
      maybeSingle:async()=>({data:table==='cap_revisions'?savedRevision:table==='cap_analyses'?pendingAnalysis:table==='cap_preferences'?{settings:preferences}:null,error:null})};
    return api;
  }};
  w.supabase={createClient:()=>db};
  w.eval(script('commercial-identity.js'));
  w.createScreenWakeLock=()=>({enabled:false,setEnabled(value){this.enabled=value;},ensure:async()=>{}});
  w.evaluateBasePurchase=engine.evaluatePurchase;
  w.relevantMemories=()=>[];
  w.calculateTaxSim=tax.calculateTaxSim;
  Object.assign(w,input);
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.fetch=async()=>{throw Error('An integration test must not make an external request');};
  w.eval(script('app-v2.js')+`\n;globalThis.assessmentHarness={
    signIn(){session={user:{id:'${owner}'},access_token:'test'};q('authGate').classList.add('hidden');q('app').classList.remove('hidden');},
    setMarket(handler){runMarketAnalysis=handler;pollMarketJob=handler;},
    setMemories(handler){loadMemories=handler;},
    setPendingTeachingFeedback(value){pendingTeachingFeedback=value;},
    setPhotos(data='data:image/jpeg;base64,YQ=='){selectedImages=[{name:'viatura.jpeg',data}];selectedImageData=selectedImages[0].data;setImageStatus('');},
    render:renderResult,needsInfo:renderNeedsVehicleInfo,readerOnly:renderReaderOnly,needsPhotos:renderAuto1NeedsPhotos,
    openHistory:openSavedRevision,resume:resumePendingAnalysis,refine:refineEvaluation,
    mergeDeal,resetCosts:resetDealCosts,get deal(){return DEAL;},setDeal(value){DEAL=mergeDeal(value);syncDealForm();},loadPreferences:loadDealPreferences,
    reset(){resetAnalysisView({announce:false,focus:false,scroll:false});},
    get busy(){return activeOperation!==null;},get result(){return currentResult;}
  };
  createAnalysis=async()=>{currentAnalysisId='analysis-'+Date.now();return currentAnalysisId;};
  updateAnalysis=async()=>{};loadMemories=async()=>[];
  persistCompletedAnalysis=async()=>true;storeMessage=async()=>{};
  `);
  await new Promise(resolve=>setTimeout(resolve,0));
  w.eval(script('tax-simulator-ui.js'));
  const h=w.assessmentHarness;h.signIn();
  const events=[];
  w.addEventListener('autopro:assessment-change',()=>events.push({assessment:w.AutoProAssessment,visible:!q('result').classList.contains('hidden')}));
  function submit(plate){q('vehicleUrl').value=plate;q('analyzeForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
  async function analyze(data){h.setMarket(async()=>data);submit(data.subject.registration);await until(()=>!h.busy);assert.ok(h.result);return h.result;}
  function saved(result){savedRevision={id:'revision-one',analysis_id:'history-analysis',user_id:owner,created_at:'2026-10-01T12:00:00Z',
    snapshot:{result,deal:{costs:result.parameters.costs,risk_reserve:result.purchase.riskReserve},source:{domain:'Matrícula',url:'plate:'+result.subject.registration},research:{risk_flags:[]}}};}
  function pending(data){pendingJob={id:'job-one',analysis_id:'pending-analysis',context:{},created_at:'2026-10-01T12:00:00Z'};
    pendingAnalysis={source_url:'plate:'+data.subject.registration,source_domain:'Matrícula',reader:{},vehicle:data.subject};}
  return {dom,w,q,h,events,submit,analyze,saved,pending,delayJobs:promise=>{delayedJobs=promise;},expire:()=>authChanged('SIGNED_OUT',null)};
}

test('real analysis, reset, next car and saved history automatically update the ENI amounts',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  const {q,h,w,events}=app;
  q('taxSimIrsRate').value='25';q('taxSimIrsRate').dispatchEvent(new w.Event('input'));
  const first=await app.analyze(market(tesla,31450));
  assert.equal(q('taxSimPurchase').value,String(first.purchase.effectiveCeiling));
  assert.equal(q('taxSimSale').value,String(first.market.saleLikely));
  assert.equal(q('taxSimCosts').value,'0');
  const oldProfit=q('taxSimAfterIRS').textContent;
  app.saved(first);
  h.reset();
  assert.equal(w.AutoProAssessment,null);
  for(const id of ['taxSimPurchase','taxSimSale','taxSimCosts'])assert.equal(q(id).value,id==='taxSimCosts'?'0':'');
  assert.equal(q('taxSimAfterIRS').textContent,'—');
  assert.equal(q('taxSimIrsRate').value,'25');
  const second=await app.analyze(market(ford,23552));
  assert.equal(w.AutoProAssessment,second);
  assert.equal(q('taxSimPurchase').value,String(second.purchase.effectiveCeiling));
  assert.equal(q('taxSimSale').value,String(second.market.saleLikely));
  assert.notEqual(q('taxSimAfterIRS').textContent,oldProfit);
  assert.equal(second.purchase.marginMode,'automatic');
  const margin=second.purchase.targetMargin;
  q('taxSimPurchase').value='17000';q('taxSimPurchase').dispatchEvent(new w.Event('input'));
  h.render(second,'Matrícula');
  assert.equal(q('taxSimPurchase').value,'17000','redrawing the same assessment must preserve a manual edit');
  assert.equal(second.purchase.targetMargin,margin);
  const revised=await app.analyze(market(ford,24552));
  assert.notEqual(revised,second,'a fresh evaluation of the same plate is a new assessment');
  assert.equal(q('taxSimPurchase').value,String(revised.purchase.effectiveCeiling));
  assert.equal(q('taxSimSale').value,String(revised.market.saleLikely));
  await h.openHistory('revision-one');
  assert.equal(q('taxSimPurchase').value,String(first.purchase.effectiveCeiling));
  assert.equal(q('taxSimSale').value,String(first.market.saleLikely));
  assert.equal(q('taxSimIrsRate').value,'25');
  assert.ok(events.filter(event=>event.assessment).every(event=>event.visible),'the assessment must be visible before publishing it');
  assert.deepEqual(events.filter(event=>event.assessment).map(event=>event.assessment.subject.registration),['AL-47-IC','BT-36-ZE','BT-36-ZE','BT-36-ZE','AL-47-IC']);
});

test('new search clears the previous profit immediately and a late signed-out response cannot restore it',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  await app.analyze(market(tesla,31450));
  const response=deferred();app.h.setMarket(()=>response.promise);
  app.submit(ford.registration);
  assert.equal(app.w.AutoProAssessment,null);
  assert.equal(app.q('taxSimAfterIRS').textContent,'—');
  assert.equal(app.q('taxSimPurchase').value,'');
  await new Promise(resolve=>setTimeout(resolve,0));
  app.expire();
  response.resolve(market(ford,23552));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(app.w.AutoProAssessment,null);
  assert.equal(app.q('taxSimAfterIRS').textContent,'—');
  assert.deepEqual(app.events.filter(event=>event.assessment).map(event=>event.assessment.subject.registration),['AL-47-IC']);
});

test('identity follow-up, reader-only, private AUTO1 and sign-out clear an existing assessment',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  const result=await app.analyze(market(ford,23552));
  const clearers=[
    ()=>app.h.needsInfo({registration:ford.registration},{},{page:{}},'Matrícula',[{key:'make_model',label:'marca e modelo'}]),
    ()=>app.h.readerOnly({page:{title:'Anúncio'}},'https://dealer.example/car'),
    ()=>app.h.needsPhotos({vehicle_code:'offer-one'},'https://auto1.com/app/merchant/car/offer-one'),
    ()=>app.expire()
  ];
  for(const clear of clearers){
    app.h.render(result,'Matrícula');
    assert.equal(app.w.AutoProAssessment,result);
    clear();
    assert.equal(app.w.AutoProAssessment,null);
    assert.equal(app.events.at(-1).assessment,null);
    assert.equal(app.q('taxSimSale').value,'');
    assert.equal(app.q('taxSimAfterIRS').textContent,'—');
  }
});

test('resuming another job clears the old result and publishes only the completed resumed car',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  await app.analyze(market(tesla,31450));
  const data=market(ford,23552),response=deferred();app.pending(data);app.h.setMarket(()=>response.promise);
  const resumed=app.h.resume('job-one');
  await until(()=>app.h.busy);
  assert.equal(app.w.AutoProAssessment,null);
  assert.equal(app.q('taxSimAfterIRS').textContent,'—');
  assert.equal(app.q('result').classList.contains('hidden'),true);
  response.resolve(data);await resumed;
  assert.equal(app.w.AutoProAssessment.subject.registration,ford.registration);
  assert.equal(app.q('taxSimSale').value,String(app.w.AutoProAssessment.market.saleLikely));
  assert.ok(app.events.at(-1).visible);
});

test('a resumed response superseded during memory loading cannot publish an assessment',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  await app.analyze(market(tesla,31450));
  const data=market(ford,23552),memories=deferred();app.pending(data);app.h.setMarket(async()=>data);
  let readingMemories=false;app.h.setMemories(()=>{readingMemories=true;return memories.promise;});
  const resumed=app.h.resume('job-one');await until(()=>readingMemories);
  app.expire();memories.resolve([]);await resumed;
  assert.equal(app.w.AutoProAssessment,null);
  assert.equal(app.q('taxSimAfterIRS').textContent,'—');
  assert.deepEqual(app.events.filter(event=>event.assessment).map(event=>event.assessment.subject.registration),['AL-47-IC']);
});

test('sign-out during pending-job lookup prevents starting and publishing the abandoned assessment',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  await app.analyze(market(tesla,31450));
  const data=market(ford,23552),lookup=deferred();app.pending(data);app.delayJobs(lookup.promise);
  let polls=0;app.h.setMarket(async()=>{polls++;return data;});
  const resumed=app.h.resume('job-one');
  app.expire();
  lookup.resolve({data:[{id:'job-one',analysis_id:'pending-analysis',context:{}}],error:null});
  await resumed;
  assert.equal(polls,0);
  assert.equal(app.w.AutoProAssessment,null);
  assert.equal(app.q('taxSimAfterIRS').textContent,'—');
});

test('a failed new search leaves no purchase, sale, costs or profit from the previous car',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  await app.analyze(market(tesla,31450));
  app.h.setMarket(async()=>{throw Error('Pesquisa indisponível');});
  app.submit(ford.registration);await until(()=>!app.h.busy);
  assert.equal(app.w.AutoProAssessment,null);
  for(const id of ['taxSimPurchase','taxSimSale','taxSimCosts'])assert.equal(app.q(id).value,id==='taxSimCosts'?'0':'');
  assert.equal(app.q('taxSimAfterIRS').textContent,'—');
  assert.match(app.q('emptyState').textContent,/Pesquisa indisponível/);
});

test('notice dismiss preserves input and visible restart clears the full assessment',async t=>{
 const app=await boot();t.after(()=>app.dom.window.close());
 const {q,h,w}=app;
 await app.analyze(market(tesla,31450));
 q('vehicleUrl').value='https://www.auto1.com/app/merchant/car/example';
 h.needsPhotos({vehicle_code:'example'},q('vehicleUrl').value);
 q('dismissNoticeBtn').click();
 assert.ok(q('emptyState').classList.contains('hidden'));
 assert.ok(q('auto1Connection').classList.contains('hidden'));
 assert.match(q('vehicleUrl').value,/auto1/);
 await app.analyze(market(tesla,31450));
 q('clearAssessmentBtn').click();
 assert.equal(q('vehicleUrl').value,'');
 assert.equal(w.AutoProAssessment,null);
 assert.ok(q('result').classList.contains('hidden'));
 assert.equal(q('taxSimSale').value,'');
});


test('saving fiscal edits creates a separate result and history restores both amounts',async t=>{
 const app=await boot();t.after(()=>app.dom.window.close());
 const first=await app.analyze(market(tesla,31450));
 app.q('taxSimCosts').value='250';app.q('taxSimReserve').value='400';
 app.q('taxSimCosts').dispatchEvent(new app.w.Event('input'));
 await app.w.saveAutoProTaxSimulation(app.w.AutoProTaxSimulation.snapshot());
 assert.equal(first.tax_simulation.fields.taxSimCosts,'250');
 assert.equal(first.tax_simulation.fields.taxSimReserve,'400');
 app.saved(first);
 await app.analyze(market(ford,23552));
 assert.equal(app.q('taxSimCosts').value,'0');
 await app.h.openHistory('revision-one');
 assert.equal(app.q('taxSimCosts').value,'250');assert.equal(app.q('taxSimReserve').value,'400');
});


test('commercial assessments start at zero, edits change the offer independently and the next car resets them',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  const legacy={costs:{transport:150,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100},risk_reserve:79};
  app.h.setDeal(legacy);
  const data=market(ford,13500);data.risk_flags=[{label:'Verificar histórico',reserve_eur:900}];
  const original=await app.analyze(data);
  assert.equal(original.purchase.fixedCosts,0);assert.equal(original.purchase.riskReserve,0);
  assert.equal(original.reconditioning.appliedGross,0);
  assert.equal(original.purchase.effectiveCeiling,Math.floor(original.market.saleLikely-original.purchase.targetMargin));
  for(const id of ['transportCostInput','reconditioningCostInput','warrantyCostInput','stockCostInput','otherCostInput','riskReserveInput'])assert.equal(app.q(id).value,'0',id);
  assert.match(app.q('commercialCostBreakdown').textContent,/Sem custos/);
  const apply=async()=>{app.q('assumptionsForm').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!app.h.busy);return app.h.result;};
  app.q('transportCostInput').value='150';app.q('riskReserveInput').value='250';
  const changed=await apply();
  assert.equal(changed.purchase.fixedCosts,150);assert.equal(changed.purchase.riskReserve,250);
  assert.equal(original.purchase.effectiveCeiling-changed.purchase.effectiveCeiling,400);
  assert.match(app.q('commercialCostBreakdown').textContent,/Transporte/);
  assert.match(app.q('commercialReserve').textContent,/250/);
  app.q('riskReserveInput').value='0';
  const noReserve=await apply();
  assert.equal(noReserve.purchase.fixedCosts,150);assert.equal(noReserve.purchase.riskReserve,0);
  assert.equal(noReserve.purchase.effectiveCeiling-changed.purchase.effectiveCeiling,250);
  app.saved(changed);
  await app.h.openHistory('revision-one');
  assert.equal(app.q('transportCostInput').value,'150');assert.equal(app.q('riskReserveInput').value,'250');
  assert.match(app.q('commercialReserve').textContent,/250/);
  const next=await app.analyze(market(tesla,30000));
  assert.equal(next.purchase.fixedCosts,0);assert.equal(next.purchase.riskReserve,0);
});


test('loading legacy account preferences keeps margin and workshop settings but clears old monetary assumptions',async t=>{
  const app=await boot({margin_policy_version:1,target_margin:4500,minimum_margin:1500,
    costs:{transport:150,reconditioning:450,warranty_reserve:350,stock_finance:150,other:100},risk_reserve:79,
    reconditioning:{pricing_version:2,paint_mode:'trade',paint_min_eur:90,paint_max_eur:110}});
  t.after(()=>app.dom.window.close());
  await app.h.loadPreferences();
  assert.equal(app.q('targetMarginInput').value,'4500');assert.equal(app.q('paintMaxInput').value,'110');
  for(const value of Object.values(app.h.deal.costs))assert.equal(value,0);
  assert.equal(app.h.deal.risk_reserve,0);
});

test('stop preserves inputs and a late result cannot replace the next assessment',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  const {h,q,w}=app;const first=deferred(),second=deferred();let calls=0;
  w.fetch=async()=>({ok:true,json:async()=>({ok:true,status:'cancelled',provider_cancelled:true})});
  h.setMarket(async()=>{calls++;return calls===1?first.promise:second.promise;});
  assert.equal(q('stopAssessmentBtn').hidden,true);
  app.submit(tesla.registration);await until(()=>calls===1);
  assert.equal(q('stopAssessmentBtn').hidden,false);
  q('stopAssessmentBtn').click();
  assert.equal(h.busy,false);assert.equal(q('vehicleUrl').value,tesla.registration);
  assert.equal(q('vehicleUrl').disabled,false);assert.equal(q('stopAssessmentBtn').hidden,true);
  app.submit(ford.registration);await until(()=>calls===2);
  first.resolve(market(tesla,31450));await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.busy,true);assert.equal(h.result,null);assert.equal(q('stopAssessmentBtn').hidden,false);
  second.resolve(market(ford,23000));await until(()=>!h.busy);
  assert.equal(h.result.subject.make,'Ford');assert.equal(q('stopAssessmentBtn').hidden,true);
});

test('plate input alone is not shown as a successful plate identification',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  const data={subject:{registration:'86-QG-72'},comparables:[],risk_flags:[{code:'registration_lookup_unavailable',label:'Fornecedor indisponível'}]};
  app.h.setMarket(async()=>data);app.submit('86-QG-72');await until(()=>!app.h.busy);
  assert.match(app.q('adReadStatus').textContent,/Consulta da matrícula indisponível/);
  assert.doesNotMatch(app.q('adReadStatus').textContent,/^Identificação pela matrícula$/);
});

for(const legacy of [false,true])test('photo billing failure is visible by the button and preserves inputs'+(legacy?' (legacy server)':''),async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  const {h,q,w}=app;h.setPhotos();let calls=0;
  w.fetch=async(url,options)=>{
    calls++;assert.equal(url,'/api/comparador-market');
    assert.equal(JSON.parse(options.body).image_data_urls.length,1);
    return {ok:false,status:legacy?502:402,json:async()=>({error:legacy?'openai_market_error':'ai_credits_exhausted',message:'You have no credits remaining. Add credits to continue using the API.'})};
  };
  app.submit('');await until(()=>!h.busy);
  assert.equal(calls,1);assert.equal(q('analyzeBtn').disabled,false);
  assert.equal(q('analyzeBtn').dataset.state,'error');
  assert.equal(q('analyzeBtn').getAttribute('aria-busy'),'false');
  assert.equal(q('stopAssessmentBtn').hidden,true);
  assert.equal(q('emptyState').classList.contains('hidden'),false);
  assert.equal(q('emptyState').closest('.search-actions')!==null,true);
  assert.equal(w.document.activeElement,q('emptyState'));
  assert.match(q('emptyState').textContent,/sem créditos na API OpenAI/);
  assert.equal(q('apiBillingLink').hidden,false);
  assert.equal(q('attachmentStatus').classList.contains('hidden'),false);
  assert.match(q('attachmentList').textContent,/viatura.jpeg/);
  assert.equal(q('pendingResearch').classList.contains('hidden'),true);
  assert.equal(h.result,null);
  h.setMarket(async()=>market(ford,23552));
  app.submit('');await until(()=>!h.busy);
  assert.ok(h.result);assert.equal(q('emptyState').classList.contains('hidden'),true);
  assert.equal(q('apiBillingLink').hidden,true);
});

test('queued photo failure stops polling and displays billing recovery without discarding photographs',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  const {h,q,w}=app;h.setPhotos();let calls=0;
  const timer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timer(fn,ms===2200?0:ms,...args);
  w.fetch=async()=>{
    calls++;
    return calls===1?{ok:true,status:202,json:async()=>({job_id:'job-photo',status:'queued'})}
      :{ok:false,status:402,json:async()=>({error:'ai_credits_exhausted',message:'Sem créditos'})};
  };
  app.submit('');await until(()=>!h.busy);
  assert.equal(calls,2);assert.match(q('emptyState').textContent,/sem créditos na API OpenAI/);
  assert.equal(q('pendingResearch').classList.contains('hidden'),true);
  assert.match(q('attachmentList').textContent,/viatura.jpeg/);
  h.reset();assert.equal(q('emptyState').classList.contains('hidden'),true);
});

test('a real identity conflict explains both vehicles near the form and remains visibly awaiting confirmation',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  const reason='A fotografia identifica um Countryman, mas a matrícula corresponde a um Clubman. Confirma a viatura.';
  app.h.setMarket(async()=>({subject:{make:'MINI',model:'Countryman',registration:'AA-41-BB'},valuation_blocked:true,
    risk_flags:[{code:'registration_unconfirmed',label:reason}],comparables:[]}));
  app.submit('AA-41-BB');await until(()=>!app.h.busy);
  assert.equal(app.q('analyzeBtn').dataset.state,'needs-info');
  assert.equal(app.q('analyzeBtn').getAttribute('aria-busy'),'false');
  assert.equal(app.q('vehicleFollowupText').textContent,reason);
  assert.ok(app.q('emptyState').textContent.includes(reason));
  assert.equal(app.q('emptyState').classList.contains('hidden'),false);
  assert.doesNotMatch(app.q('marketSummary').textContent,/já foi iniciada/);
  assert.equal(app.q('stopAssessmentBtn').hidden,true);
  assert.equal(app.h.result,null);
});

test('photographs and reset controls cannot mutate the inputs while an assessment is running',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  app.h.setPhotos();const result=deferred();let payload;
  app.h.setMarket(data=>{payload=data;return result.promise;});
  app.submit(ford.registration);await until(()=>!!payload);
  const remove=app.q('attachmentList').querySelector('button');
  assert.equal(remove.disabled,true);assert.equal(app.q('removeImage').disabled,true);
  assert.equal(app.q('clearAssessmentBtn').disabled,true);
  remove.click();app.q('removeImage').click();app.q('clearAssessmentBtn').click();
  assert.equal(payload.image_data_urls.length,1);
  assert.match(app.q('attachmentList').textContent,/viatura.jpeg/);
  assert.equal(app.q('vehicleUrl').value,ford.registration);
  result.resolve(market(ford,23000));await until(()=>!app.h.busy);
  assert.equal(app.q('removeImage').disabled,false);
  assert.equal(app.q('attachmentList').querySelector('button').disabled,false);
});

test('a blocked or malformed listing reader still evaluates the supplied photograph',async t=>{
  for(const malformed of [false,true]){
    const app=await boot();t.after(()=>app.dom.window.close());app.h.setPhotos();let payload;
    app.w.fetch=async url=>{
      assert.equal(url,'/api/comparador-analyze');
      if(!malformed)throw new TypeError('Load failed');
      return {ok:true,status:200,json:async()=>{throw new SyntaxError('HTML');}};
    };
    app.h.setMarket(async data=>{payload=data;return market(ford,23000);});
    app.submit('https://www.standvirtual.com/carros/anuncio/teste-ID1.html');await until(()=>!app.h.busy);
    assert.ok(app.h.result);assert.equal(payload.image_data_urls.length,1);
    assert.match(payload.page.description||'A página não pôde ser lida',/não pôde ser lida/);
    assert.equal(payload.url,'https://www.standvirtual.com/carros/anuncio/teste-ID1.html');
  }
});

test('an expired session at the listing reader stops instead of bypassing authentication via photos',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());app.h.setPhotos();let marketCalls=0;
  app.w.fetch=async()=>({ok:false,status:401,json:async()=>({message:'A sessão expirou. Entra novamente.'})});
  app.h.setMarket(async()=>{marketCalls++;return market(ford,23000);});
  app.submit('https://www.standvirtual.com/carros/anuncio/teste-ID1.html');await until(()=>!app.h.busy);
  assert.equal(marketCalls,0);assert.equal(app.h.result,null);
  assert.match(app.q('emptyState').textContent,/sessão expirou/);
  assert.match(app.q('attachmentList').textContent,/viatura.jpeg/);
});

test('replacing a photograph with the same total count is accepted as new identity evidence',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());app.h.setPhotos();let calls=0,refined;
  app.h.setMarket(async payload=>{
    calls++;
    if(calls===1)return {subject:{registration:ford.registration},comparables:[],risk_flags:[]};
    refined=payload;return market(ford,23000);
  });
  app.submit(ford.registration);await until(()=>!app.h.busy);
  app.q('attachmentList').querySelector('button').click();
  app.h.setPhotos('data:image/jpeg;base64,Yg==');
  app.q('vehicleFollowupForm').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>!!app.h.result);
  assert.equal(calls,2);assert.equal(refined.image_data_urls.length,1);
  assert.equal(refined.image_data_urls[0],'data:image/jpeg;base64,Yg==');
});

test('transient malformed polling is retried against the same saved job and never yields an empty identification',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());app.h.setPhotos();let posts=0,polls=0;
  const timer=app.w.setTimeout.bind(app.w);app.w.setTimeout=(fn,ms,...args)=>timer(fn,ms===2200?0:ms,...args);
  app.w.fetch=async(url,options)=>{
    if(options.method==='POST'){posts++;return {ok:true,status:202,json:async()=>({status:'queued',job_id:'job-existing'})};}
    polls++;assert.match(url,/job_id=job-existing/);
    if(polls===1)return {ok:true,status:200,json:async()=>{throw new SyntaxError('Truncated JSON');}};
    return {ok:true,status:200,json:async()=>market(ford,23000)};
  };
  app.submit('');await until(()=>!app.h.busy);
  assert.equal(posts,1);assert.equal(polls,2);
  assert.equal(app.h.result.subject.model,'Puma');assert.equal(app.q('analyzeBtn').dataset.state,'complete');
});

test('session expiry during polling preserves a recoverable checkpoint and unlocks the form',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());app.h.setPhotos();let calls=0;
  app.w.fetch=async()=>++calls===1?{ok:true,status:202,json:async()=>({job_id:'job-session',status:'queued'})}
    :{ok:false,status:401,json:async()=>({error:'invalid_auth',message:'A sessão expirou.'})};
  app.submit('');await until(()=>!app.h.busy);
  assert.equal(app.q('pendingResearch').classList.contains('hidden'),false);
  assert.match(app.q('pendingResearchText').textContent,/sessão expirou/);
  const checkpoint=JSON.parse(app.w.localStorage.getItem('cap:research-checkpoint:'+owner));
  assert.equal(checkpoint.jobId,'job-session');
  assert.equal(app.q('vehicleUrl').disabled,false);assert.equal(app.q('analyzeBtn').disabled,false);
});

test('ambiguous identity opens a clear conversation and choosing a vehicle continues with explicit user provenance',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());let calls=0,confirmation;
  const photo={make:'Renault',model:'Clio',trim:'1.5 dCi',fuel:'diesel',year:2015,registration:'88-QG-72'};
  const plate={make:'Renault',model:'Captur',trim:null,fuel:'diesel',year:2015,registration:'88-QG-72'};
  app.h.setMarket(async payload=>{
    calls++;
    if(calls===1)return {subject:photo,valuation_blocked:true,comparables:[],
      identity_candidates:[{source:'photos',vehicle:photo},{source:'registration',vehicle:plate}],
      risk_flags:[{code:'registration_unconfirmed',label:'A fotografia indica Clio e a consulta da matrícula indica Captur.'}]};
    confirmation=payload.user_confirmed_identity;
    assert.equal(payload.identity_confirmation_only,true);
    return {...market({...plate,identity_source:'user_confirmed'},12000),risk_flags:[{code:'identity_user_confirmed',label:'Identidade confirmada pelo utilizador.'}]};
  });
  app.submit('88-QG-72');await until(()=>!app.h.busy);
  assert.equal(app.q('refineDialog').classList.contains('hidden'),false);
  assert.equal(app.q('refineDialogTitle').textContent,'Vamos confirmar a viatura');
  assert.match(app.q('refineDialogMessages').textContent,/Qual é o carro/);
  const choice=[...app.q('identityChoices').querySelectorAll('button')].find(button=>/Captur/.test(button.textContent));
  assert.match(choice.textContent,/88-QG-72/);
  choice.click();await until(()=>calls===2&&!app.h.busy);
  assert.deepEqual(JSON.parse(JSON.stringify(confirmation)),{make:'Renault',model:'Captur',registration:'88-QG-72'});
  assert.equal(app.h.result.subject.model,'Captur');
  assert.equal(app.h.result.subject.trim,null,'a corrected identity must not inherit the wrong old trim');
  assert.equal(app.q('identityChoices').hidden,true);
  assert.equal(app.q('openIdentityDialogBtn').hidden,true);
});

test('a short yes in the identity conversation confirms the sole visible candidate and advances',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());let calls=0,confirmation;
  const mini={make:'MINI',model:'Countryman',trim:'Cooper D',fuel:'diesel',year:2017,registration:'AA-41-BB'};
  app.h.setMarket(async payload=>{
    calls++;
    if(calls===1)return {subject:mini,valuation_blocked:true,comparables:[],risk_flags:[{code:'registration_unconfirmed',label:'Confirma o modelo.'}]};
    confirmation=payload.user_confirmed_identity;return market({...mini,identity_source:'user_confirmed'},18000);
  });
  app.h.setPendingTeachingFeedback({analysisId:'previous-assessment',owner,kind:'margin',value:3500});
  app.q('teachingFeedback').hidden=false;
  app.submit('AA-41-BB');await until(()=>!app.h.busy);
  assert.match(app.q('refineDialogMessages').textContent,/É este o carro/);
  assert.equal(app.q('teachingFeedback').hidden,true);
  app.q('teachingInput').value='Sim';
  app.q('teachingForm').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>calls===2&&!app.h.busy);
  assert.equal(confirmation.model,'Countryman');assert.equal(confirmation.registration,'AA-41-BB');
  assert.equal(app.h.result.subject.model,'Countryman');
});

test('written plate and trim corrections are re-identified instead of selecting the old candidate',async t=>{
  for(const reply of ['É MINI Countryman, matrícula AB-12-CD','É MINI Countryman Cooper S','É MINI Countryman Cooper D com 135 000 km']){
    const app=await boot();t.after(()=>app.dom.window.close());let calls=0,refinement;
    const mini={make:'MINI',model:'Countryman',trim:'Cooper D',fuel:'diesel',year:2017,registration:'AA-41-BB'};
    app.h.setMarket(async payload=>{
      calls++;
      if(calls===1)return {subject:mini,valuation_blocked:true,comparables:[],risk_flags:[{code:'registration_unconfirmed',label:'Confirma o modelo.'}]};
      refinement=payload;return market(mini,18000);
    });
    app.submit('AA-41-BB');await until(()=>!app.h.busy);
    app.q('teachingInput').value=reply;
    app.q('teachingForm').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));
    await until(()=>calls===2&&!app.h.busy);
    assert.equal(refinement.user_confirmed_identity,undefined,reply);
    assert.equal(refinement.identity_confirmation_only,false);
    assert.equal(refinement.refinement_history.at(-1),reply);
  }
});

test('unknown identity asks only for make and model and lets the user close and reopen the conversation',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());
  app.h.setMarket(async()=>({subject:{registration:'AA-41-BB'},comparables:[],risk_flags:[]}));
  app.submit('AA-41-BB');await until(()=>!app.h.busy);
  assert.match(app.q('refineDialogMessages').textContent,/Que carro é este\? Diz-me a marca e o modelo/);
  assert.doesNotMatch(app.q('refineDialogMessages').textContent,/quilómetros|ano|combustível/);
  assert.equal(app.q('teachingMicBtn').disabled,false);
  app.q('refineDialogClose').click();assert.equal(app.q('refineDialog').classList.contains('hidden'),true);
  app.q('openIdentityDialogBtn').click();assert.equal(app.q('refineDialog').classList.contains('hidden'),false);
});

test('later refinements re-read details and another-car replies clear the previous confirmation',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());const payloads=[];
  const clio={make:'Renault',model:'Clio',fuel:'diesel',year:2015,mileage_km:120000,registration:ford.registration};
  app.h.setMarket(async payload=>{
    payloads.push(payload);
    if(payloads.length===1)return {subject:ford,valuation_blocked:true,comparables:[],risk_flags:[{code:'registration_unconfirmed',label:'Confirma o modelo.'}]};
    return market(payloads.length===4?clio:{...ford,mileage_km:42000,identity_source:'user_confirmed'},15000);
  });
  app.submit(ford.registration);await until(()=>!app.h.busy);
  app.q('identityChoices').querySelector('button').click();await until(()=>payloads.length===2&&!app.h.busy);
  assert.equal(payloads[1].identity_confirmation_only,true);
  await app.h.refine('Os quilómetros corretos são 42 000.');
  assert.equal(payloads[2].identity_confirmation_only,false);
  assert.equal(payloads[2].user_confirmed_identity.model,'Puma');
  assert.equal(app.h.result.subject.mileage_km,42000);

  app.h.needsInfo(ford,{valuation_blocked:true,identity_candidates:[{source:'user_confirmed',vehicle:ford}]},{},'Matrícula',[{key:'make_model',label:'marca e modelo'}]);
  [...app.q('identityChoices').querySelectorAll('button')].find(button=>button.textContent==='É outro carro').click();
  app.q('teachingInput').value='É um Renault Clio';
  app.q('teachingForm').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>payloads.length===4&&!app.h.busy);
  assert.equal(payloads[3].identity_confirmation_only,false);
  assert.equal(Object.hasOwn(payloads[3],'user_confirmed_identity'),false);
  assert.equal(app.h.result.subject.model,'Clio');
});

test('different plate candidates are shown explicitly and an ambiguous yes never selects either one',async t=>{
  const app=await boot();t.after(()=>app.dom.window.close());let calls=0;
  const car={make:'MINI',model:'Countryman',trim:'Cooper D',fuel:'diesel',year:2017};
  app.h.setMarket(async()=>{calls++;return {subject:{...car,registration:'AA-41-BB'},valuation_blocked:true,comparables:[],
    identity_candidates:[{source:'photos',vehicle:{...car,registration:'AA-41-BB'}},{source:'registration',vehicle:{...car,registration:'AB-12-CD'}}],
    risk_flags:[{code:'registration_unconfirmed',label:'Duas matrículas diferentes.'}]};});
  app.submit('AA-41-BB');await until(()=>!app.h.busy);
  assert.match(app.q('refineDialogMessages').textContent,/AA-41-BB/);assert.match(app.q('refineDialogMessages').textContent,/AB-12-CD/);
  app.q('teachingInput').value='Sim';app.q('teachingForm').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls,1);assert.equal(app.h.result,null);
  assert.match(app.q('refineDialogMessages').textContent,/escolhe a identificação correta/);
});
