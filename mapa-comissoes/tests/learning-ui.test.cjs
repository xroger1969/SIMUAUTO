const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {webcrypto}=require('node:crypto');
const {JSDOM}=require('./db-runtime/node_modules/jsdom');
const base=join(__dirname,'../comparador-auto-pro');
const html=readFileSync(join(base,'index.html'),'utf8');
const appSource=readFileSync(join(base,'app-v2.js'),'utf8').replace(/^import .*;\n/gm,'');
require('../comparador-auto-pro/commercial-identity.js');
const engine=import('data:text/javascript;base64,'+Buffer.from(readFileSync(join(base,'valuation.js'),'utf8')).toString('base64'));
const owner='11111111-1111-4111-8111-111111111111';
const caseId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vehicle={make:'Tesla',model:'Model Y',trim:'Long Range',fuel:'electric',drivetrain:'AWD',battery_kwh:75,year:2023,mileage_km:50000,registration:'AA-00-AA',price:20000};
async function boot(rows=new Map()){
 const e=await engine,dom=new JSDOM(html,{url:'https://example.test/comparador-auto-pro/',runScripts:'outside-only'}),w=dom.window;
 let authChanged=()=>{};
 const query=()=>{
  let filters=[],action=null;
  const api={select(){return api;},eq(k,v){filters.push([k,v]);return api;},order(){return api;},limit(){return api;},
   upsert(row){rows.set(row.id,structuredClone(row));return Promise.resolve({error:null});},
   update(patch){action=patch;return api;},
   then(resolve,reject){
    const data=[...rows.values()].filter(r=>filters.every(([k,v])=>r[k]===v));
    if(action)data.forEach(r=>rows.set(r.id,{...r,...action}));
    return Promise.resolve({data,count:data.length,error:null}).then(resolve,reject);
   }};return api;
 };
 const db={from:()=>query(),auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:fn=>{authChanged=fn;}}};
 w.supabase={createClient:()=>db};w.evaluateBasePurchase=e.evaluatePurchase;w.buildFeedbackRecord=e.buildFeedbackRecord;
 w.feedbackRecordId=(...args)=>e.feedbackRecordId(...args,webcrypto);
 w.relevantMemories=()=>[];w.parseVehicleInput=()=>{};w.manualMissing=()=>[];w.formatVehiclePlate=v=>v;w.parseOptionalMileage=()=>null;
 const comparables=[1,2,3].map(i=>({...vehicle,registration:'BB-'+i+'-CC',price:30000+i*100,url:'https://stand'+i+'.example/car',seller_type:'professional',country:'PT',price_basis:'gross',availability:'available',observed_at:new Date().toISOString(),evidence:{verified:true,observed_at:new Date().toISOString(),source_url_verified:true}}));
 const input={subject:vehicle,comparables,current_purchase_price:20000};
 w.eval(appSource+`\n;globalThis.learningHarness={
   setState(owner,id,vehicle,result){session={user:{id:owner},access_token:'test'};currentAnalysisId=id;currentVehicle=vehicle;currentResult=result;currentMarketData={marketPayload:{url:null}};},
   load:loadMemories,evaluate:evaluatePurchase,capture:captureEvaluationFeedback,
   get busy(){return activeOperation!==null;},get cached(){return learningRulesCache;}
 };`);
 await new Promise(resolve=>setTimeout(resolve,0));
 const result=e.evaluatePurchase(input);
 w.learningHarness.setState(owner,caseId,vehicle,result);
 return {dom,w,rows,e,input,result,authChanged:(...args)=>authChanged(...args)};
}
async function submit(app,value,kind='retail_sale'){
 const {w}=app;
 w.document.getElementById('learningKind').value=kind;
 w.document.getElementById('learningValue').value=String(value);
 w.document.getElementById('learningForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,2));if(!w.learningHarness.busy)return;}
 throw Error('Learning did not finish');
}
test('real DOM: correction persists, retry replaces it, next valuation uses it, and deactivation removes its effect',async()=>{
 const a=await boot();
 try{
  assert.ok(Number.isFinite(a.result.market.saleLikely));
  await submit(a,26000);
  assert.equal(a.rows.size,1);
  assert.match(a.w.document.getElementById('learningSaveStatus').textContent,/Registo guardado/);
  await submit(a,25500);
  assert.equal(a.rows.size,1);
  assert.equal([...a.rows.values()][0].effect.value,25500);
  a.w.learningHarness.setState(owner,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',vehicle,a.result);
  const learned=a.w.learningHarness.evaluate(a.input);
  assert.ok(learned.market.saleLikely<a.result.market.saleLikely);
  // Reload against the same backing store, then disable the original feedback.
  const b=await boot(a.rows);
  try{
   await b.w.learningHarness.load();
   b.w.document.getElementById('learningKind').value='retail_sale';
   b.w.document.getElementById('learningKind').dispatchEvent(new b.w.Event('change'));
   assert.equal(b.w.document.getElementById('learningValue').value,'25500');
   b.w.document.getElementById('learningUndoBtn').click();
   for(let i=0;i<100&&b.w.learningHarness.busy;i++)await new Promise(resolve=>setTimeout(resolve,2));
   assert.equal([...b.rows.values()][0].active,false);
   b.w.learningHarness.setState(owner,'next-case',vehicle,b.result);
   assert.equal(b.w.learningHarness.evaluate(b.input).market.saleLikely,b.result.market.saleLikely);
  }finally{b.dom.window.close();}
 }finally{a.dom.window.close();}
});
test('real DOM: per-car margin is applied and captured, but a pending bid does not become a completed transaction',async()=>{
 const a=await boot();
 try{
  a.w.document.getElementById('vehicleMargin').value='4750';
  const r=a.w.learningHarness.evaluate(a.input);
  assert.equal(r.purchase.targetMargin,4750);
  r.purchase.acquisition.isAuction=true;
  a.w.learningHarness.setState(owner,caseId,vehicle,r);
  await a.w.learningHarness.capture();
  assert.equal(a.rows.size,2);
  const kinds=[...a.rows.values()].map(x=>x.effect.kind).sort();
  assert.deepEqual(kinds,['auction_bid','margin']);
  assert.equal(a.e.learningCalibration([...a.rows.values()],vehicle).tradeSamples,0);
  a.authChanged('SIGNED_OUT',null);
  assert.equal(a.w.learningHarness.cached.length,0);
 }finally{a.dom.window.close();}
});
