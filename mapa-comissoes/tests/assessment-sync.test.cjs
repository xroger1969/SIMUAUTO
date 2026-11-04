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
    render:renderResult,needsInfo:renderNeedsVehicleInfo,readerOnly:renderReaderOnly,needsPhotos:renderAuto1NeedsPhotos,
    openHistory:openSavedRevision,resume:resumePendingAnalysis,
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
