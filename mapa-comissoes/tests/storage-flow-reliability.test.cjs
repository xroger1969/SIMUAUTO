const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../comparador-auto-pro/app-v2.js'),'utf8');
const source=(from,to)=>app.slice(app.indexOf(from),app.indexOf(to,app.indexOf(from)));
function harness(){
  const signals=[],elements=new Map();
  const stalled={select(){return this;},eq(){return this;},maybeSingle(){return this;},
    upsert(){return this;},abortSignal(signal){signals.push(signal);return this;},then(){}};
  const ctx={AbortController,clearTimeout,console,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,5)),
    session:{user:{id:'user-one'}},activeOperation:null,currentAnalysisId:'analysis-one',currentVehicle:{make:'MINI'},currentResult:{},currentMarketData:null,
    q(id){if(!elements.has(id))elements.set(id,{textContent:'',classList:{add(){},remove(){}},addEventListener(){}});return elements.get(id);},
    db:{from:()=>stalled},toast(message){ctx.message=message;},
    beginOperation(kind){return ctx.activeOperation={kind,controller:new AbortController()};},
    assertOperation(operation){assert.equal(operation,ctx.activeOperation);},
    finishOperation(operation){if(ctx.activeOperation===operation)ctx.activeOperation=null;},
    buildFeedbackRecord:()=>({}),feedbackRecordId:async()=> 'feedback-one',loadMemories:async()=>[],
    DEAL:{costs:{},risk_reserve:0},DEFAULT_DEAL:{costs:{}}
  };
  vm.createContext(ctx);
  vm.runInContext(source('async function storageRequest','async function fetchJson'),ctx);
  vm.runInContext(source('async function openSavedRevision','q("historyList")'),ctx);
  vm.runInContext(source('async function refreshMemoryCount','async function requestTeachingReply'),ctx);
  vm.runInContext(source('async function saveSupervisedFeedback','async function captureEvaluationFeedback'),ctx);
  vm.runInContext(source('async function saveDealPreferences','async function saveAnalysisSnapshot'),ctx);
  return {ctx,signals,stalled};
}

test('a stalled saved-revision read releases its busy operation and leaves the current view intact',async()=>{
  const {ctx,signals}=harness();
  const previous=ctx.currentResult;
  await ctx.openSavedRevision('revision-one');
  assert.equal(ctx.activeOperation,null);
  assert.equal(ctx.currentResult,previous);
  assert.match(ctx.q('historyStatus').textContent,/demorou demasiado/);
  assert.equal(signals.length,1);assert.equal(signals[0].aborted,true);
});

test('a stalled preferences write has a deadline and receives the operation cancellation signal',async()=>{
  const {ctx,signals}=harness();
  const operation=ctx.beginOperation('recalculate');
  await assert.rejects(ctx.saveDealPreferences(),error=>error.code==='storage_timeout');
  assert.equal(signals[0].aborted,true);
  const request=ctx.saveDealPreferences();operation.controller.abort();
  await assert.rejects(request,error=>error.cancelled===true);
  assert.equal(signals[1].aborted,true);
});

test('a stalled automatic-learning write cannot wait forever after the valuation completed',async()=>{
  const {ctx,signals}=harness();
  ctx.beginOperation('analysis');
  await assert.rejects(ctx.saveSupervisedFeedback('margin',3500),error=>error.code==='storage_timeout');
  assert.equal(signals[0].aborted,true);
  assert.equal(ctx.lastLearningRecord,undefined);
});

test('the count refresh after a saved learning record is also bounded',async()=>{
  const {ctx,signals,stalled}=harness();
  const query={...stalled,upsert:async()=>({error:null})};
  ctx.db={from:()=>query};
  ctx.beginOperation('analysis');
  ctx.q('memoryCount').textContent='3 regras';
  await assert.rejects(ctx.saveSupervisedFeedback('margin',3500),error=>error.code==='storage_timeout');
  assert.equal(ctx.lastLearningRecord.id,'feedback-one','the successful write remains recorded even if its count refresh failed');
  assert.equal(ctx.q('memoryCount').textContent,'3 regras','do not turn a failed count lookup into a false zero');
  assert.equal(signals[0].aborted,true);
});

test('a late count from another account does not replace the visible count',async()=>{
  const {ctx,stalled}=harness();
  let resolve;
  ctx.db={from:()=>({...stalled,then(onResolve){resolve=onResolve;}})};
  ctx.q('memoryCount').textContent='2 regras';
  const request=ctx.refreshMemoryCount();
  await Promise.resolve();await Promise.resolve();
  ctx.session={user:{id:'another-user'}};
  resolve({count:30,error:null});await request;
  assert.equal(ctx.q('memoryCount').textContent,'2 regras');
});
