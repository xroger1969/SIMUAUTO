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

async function boot(){
  const [engine,input,tax]=await modules;
  const dom=new JSDOM(html,{url:'https://example.test/comparador-auto-pro/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,q=id=>w.document.getElementById(id);
  let authChanged=()=>{},savedRevision=null,pendingJob=null,pendingAnalysis=null,delayedJobs=null;
  const db={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(fn){authChanged=fn;},
    signOut:async()=>{authChanged('SIGNED_OUT',null);}},from(table){
    const api={select(){return api;},eq(){return api;},order(){return api;},
      limit:async()=>delayedJobs||({data:pendingJob?[pendingJob]:[],error:null}),
      maybeSingle:async()=>({data:table==='cap_revisions'?savedRevision:table==='cap_analyses'?pendingAnalysis:null,error:null})};
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
    snapshot:{result,deal:{costs:{}},source:{domain:'Matrícula',url:'plate:'+result.subject.registration},research:{risk_flags:[]}}};}
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
  assert.equal(q('taxSimCosts').value,String(Math.round((first.purchase.fixedCosts+first.purchase.riskReserve)*100)/100));
  const oldProfit=q('taxSimAfterIRS').textContent;
  app.saved(first);
  h.reset();
  assert.equal(w.AutoProAssessment,null);
  for(const id of ['taxSimPurchase','taxSimSale','taxSimCosts'])assert.equal(q(id).value,'');
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
  for(const id of ['taxSimPurchase','taxSimSale','taxSimCosts'])assert.equal(app.q(id).value,'');
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
