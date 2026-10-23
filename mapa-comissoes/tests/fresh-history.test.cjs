const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../comparador-auto-pro/app-v2.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../comparador-auto-pro/index.html'),'utf8');
function source(from,to){const a=app.indexOf(from),b=app.indexOf(to,a);assert.ok(a>=0&&b>a,from);return app.slice(a,b);}
function element(){
 const classes=new Set();
 return {value:'',textContent:'',innerHTML:'',disabled:false,dataset:{},children:[],listeners:{},previousElementSibling:{},
 classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on===undefined)on=!classes.has(x);on?classes.add(x):classes.delete(x);}},
 addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll(){return this.children;},contains(){return true;},scrollIntoView(){this.scrolled=true;},focus(){this.focused=true;}};
}
function harness(extra={}){
 const elements=new Map();
 const q=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const ctx={q,console,Date,Number,String,Object,Math,Array,JSON,Intl,Set,
 historyDate:new Intl.DateTimeFormat('pt-PT',{dateStyle:'short',timeStyle:'short'}),
 fmt:value=>value==null?'—':String(value),session:{user:{id:'user-one'}},activeOperation:null,
 currentHistoryRevision:null,historyControlStates:[],currentMarketData:null,currentAnalysisId:null,currentResult:null,lastAnalysisContext:null,
 syncDealForm(){ctx.preferenceSyncs++;},preferenceSyncs:0,toast(message){ctx.lastToast=message;},
 beginOperation(kind){ctx.activeOperation={kind};return ctx.activeOperation;},
 assertOperation(op){if(ctx.activeOperation!==op)throw Error('stale');},
 finishOperation(op){if(ctx.activeOperation===op)ctx.activeOperation=null;},
 resetAnalysisView(){ctx.clearSavedRevisionView();ctx.resets++;},resets:0,
 renderResult(result,host,risks){ctx.rendered={result,host,risks};ctx.currentResult=result;},
 closeHistory(){ctx.closed=true;},...extra};
 vm.createContext(ctx);
 vm.runInContext(source('// Reading a revision never','function openHistory'),ctx);
 return ctx;
}
function savedRow(){return {id:'revision-one',analysis_id:'analysis-one',user_id:'user-one',created_at:'2026-10-01T12:00:00Z',snapshot:{
 saved_at:'2026-10-01T11:59:59Z',source:{url:'plate:AL-47-IC',domain:'Matrícula',mode:'manual'},
 deal:{target_margin:3500,minimum_margin:1200,costs:{transport:150}},
 research:{risk_flags:[{label:'Verificar bateria',severity:'high'}]},
 result:{subject:{make:'Tesla',model:'Model Y',registration:'AL-47-IC',mileage_km:103000},
 market:{saleLikely:30000,saleFast:29000,comparablesUsed:1,marketValue:31000},
 purchase:{effectiveCeiling:24500,purchaseWithRepairs:24500,purchaseWithoutRepairs:25000,targetMargin:3500,eligible:false},
 comparables:[{label:'Model Y',price:31000}],warnings:['Valor provisório']}}};}
function dbReturning(ctx,row,error=null){
 const calls=[];
 const query={select(value){calls.push(['select',value]);return this;},eq(key,value){calls.push(['eq',key,value]);return this;},async maybeSingle(){return {data:row,error};}};
 ctx.db={from(table){calls.push(['from',table]);return query;}};
 return calls;
}

test('initialization keeps failed history saves but never resumes or polls a prior research job',async()=>{
 let resumed=0,retried=0;
 const ctx=harness({refreshMemoryCount:async()=>{},loadDealPreferences:async()=>{},loadMemories:async()=>[],
 pendingSavesKey:()=> 'pending',sessionStorage:{getItem:()=>JSON.stringify([{analysisId:'old',snapshot:{result:{}}}])},
 retryPendingSaves:async()=>{retried++;},resumePendingAnalysis:async()=>{resumed++;}});
 vm.runInContext(source('async function initializeAppData','function auto1Request'),ctx);
 await ctx.initializeAppData();
 assert.equal(resumed,0);assert.equal(retried,1);
 assert.equal(ctx.pendingAnalysisSaves[0].analysisId,'old');
});
test('boot clears the assessment without moving focus or resuming a prior job',async()=>{
 let options;
 const ctx=harness({db:{auth:{getSession:async()=>({data:{session:null}})}},showAuth(){},resetAnalysisView:o=>{options=o;}});
 vm.runInContext(source('async function boot','q("authForm")'),ctx);
 await ctx.boot();
 assert.equal(JSON.stringify(options),JSON.stringify({announce:false,focus:false,scroll:false}));
});
test('resume requires a job or analysis explicitly selected by the user',async()=>{
 const ctx=harness({db:{from(){throw Error('must not read jobs at startup');}}});
 vm.runInContext(source('async function resumePendingAnalysis','q("analyzeForm")'),ctx);
 await ctx.resumePendingAnalysis();
 assert.equal(ctx.activeOperation,null);
});
test('history rows expose an accessible open button with the revision id, not merely an analysis id',()=>{
 const ctx=harness({esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'),calculationKindLabel:()=> 'Avaliação'});
 vm.runInContext(source('function historyItem','async function loadHistory'),ctx);
 const html=ctx.historyItem({...savedRow(),vehicle_title:'Tesla <Y>',confidence_pct:45,comparables_used:1});
 assert.match(html,/data-history-revision="revision-one"/);
 assert.match(html,/Abrir avaliação<\/button>/);
 assert.match(html,/aria-label="Abrir avaliação de Tesla &lt;Y>/);
});
test('opening a revision reads its owner-scoped snapshot, reproduces the amounts, and does not recalculate or write',async()=>{
 const ctx=harness({evaluatePurchase(){throw Error('must not recalculate');},persistCompletedAnalysis(){throw Error('must not write');}});
 const row=savedRow(),original=JSON.stringify(row);
 const calls=dbReturning(ctx,row);
 await ctx.openSavedRevision(row.id);
 assert.deepEqual(calls.filter(x=>x[0]==='eq'),[['eq','user_id','user-one'],['eq','id','revision-one']]);
 assert.equal(ctx.rendered.result.purchase.effectiveCeiling,24500);
 assert.equal(ctx.rendered.result.market.saleLikely,30000);
 assert.equal(ctx.rendered.result.comparables[0].price,31000);
 assert.equal(ctx.rendered.risks[0].label,'Verificar bateria');
 assert.equal(ctx.currentAnalysisId,'analysis-one');assert.equal(ctx.closed,true);
 assert.equal(ctx.q('vehicleUrl').value,'AL-47-IC');
 assert.equal(ctx.activeOperation,null);assert.equal(JSON.stringify(row),original);
 assert.match(ctx.q('historySnapshotNotice').textContent,/Valores originais, sem nova pesquisa/);
});
test('the stored snapshot is copied, not mutated, and legacy numeric values are not synthesized',()=>{
 const ctx=harness(),row=savedRow();delete row.snapshot.result.purchase.purchaseWithRepairs;delete row.snapshot.result.purchase.purchaseWithoutRepairs;
 const record=ctx.savedRevisionSnapshot(row);
 assert.equal(record.result.purchase.purchaseWithRepairs,undefined);
 record.result.subject.model='changed';assert.equal(row.snapshot.result.subject.model,'Model Y');
 assert.equal(record.result.purchase.effectiveCeiling,24500);
});
test('legacy revisions show their original ceiling without inventing repair scenarios or modern commercial fields',async()=>{
 const ctx=harness(),row=savedRow();delete row.snapshot.result.purchase.purchaseWithRepairs;delete row.snapshot.result.purchase.purchaseWithoutRepairs;
 dbReturning(ctx,row);await ctx.openSavedRevision(row.id);
 assert.equal(ctx.q('purchaseCeilingLabel').textContent,'Teto de compra guardado');
 assert.equal(ctx.q('maxPurchase').textContent,'24500');
 assert.equal(ctx.q('purchaseWithoutRepairs').textContent,'—');
 assert.match(ctx.q('purchaseComparisonNote').textContent,/não separava/);
 assert.equal(ctx.q('commercialPanel').classList.contains('hidden'),true);
 assert.equal(ctx.q('conditionPanel').classList.contains('hidden'),true);
});
test('missing or malformed historical data produces an explicit error and never starts a replacement evaluation',async()=>{
 for(const snapshot of [null,{}, {result:{subject:{},market:null,purchase:{}}}]){
  const ctx=harness(),row={...savedRow(),snapshot};dbReturning(ctx,row);
  await ctx.openSavedRevision(row.id);
  assert.equal(ctx.rendered,undefined);assert.equal(ctx.activeOperation,null);
  assert.match(ctx.lastToast,/não contém a avaliação completa/);assert.equal(ctx.closed,undefined);
 }
});
test('network errors preserve the existing view and leave retry possible',async()=>{
 const ctx=harness();dbReturning(ctx,null,{message:'offline'});
 await ctx.openSavedRevision('revision-one');
 assert.equal(ctx.resets,0);assert.equal(ctx.rendered,undefined);assert.equal(ctx.activeOperation,null);
 assert.match(ctx.q('historyStatus').textContent,/Tenta novamente/);
});
test('another owner cannot be rendered even if a malformed response bypasses the query filter',async()=>{
 const ctx=harness(),row={...savedRow(),user_id:'another-user'};dbReturning(ctx,row);
 await ctx.openSavedRevision(row.id);assert.equal(ctx.rendered,undefined);assert.equal(ctx.resets,0);
});
test('late history responses are discarded when the authenticated account changes',async()=>{
 const ctx=harness();let resolve;
 const query={select(){return this;},eq(){return this;},maybeSingle(){return new Promise(r=>{resolve=r;});}};
 ctx.db={from:()=>query};const request=ctx.openSavedRevision('revision-one');
 ctx.session={user:{id:'another-user'}};resolve({data:savedRow()});await request;
 assert.equal(ctx.rendered,undefined);assert.equal(ctx.resets,0);assert.equal(ctx.lastToast,undefined);
});
test('saved assumptions are visible read-only and do not replace the current user preferences',()=>{
 const ctx=harness({DEAL:{target_margin:7000}}),row=savedRow(),record=ctx.savedRevisionSnapshot(row);
 const input=element(),button=element();button.disabled=true;ctx.q('assumptionsForm').children=[input,button];
 ctx.showSavedRevisionView(row,record);
 assert.equal(ctx.q('targetMarginInput').value,3500);assert.equal(ctx.DEAL.target_margin,7000);
 assert.equal(input.disabled,true);assert.equal(ctx.q('refreshMarketBtn').disabled,true);
 ctx.clearSavedRevisionView();
 assert.equal(input.disabled,false);assert.equal(button.disabled,true);assert.equal(ctx.currentHistoryRevision,null);
 assert.equal(ctx.q('historySnapshotNotice').classList.contains('hidden'),true);
 assert.equal(ctx.q('conditionPanel').classList.contains('hidden'),false);
});
test('saved revision dates, including unknown dates, do not become the date of a new assessment',()=>{
 const ctx=harness({currentVehicle:{make:'Tesla',model:'Model Y'},vehicleMeta:()=>'',cleanValuationSummary:()=>''});
 ctx.currentResult=savedRow().snapshot.result;
 vm.runInContext(source('function valuationShareData','function valuationShareText'),ctx);
 ctx.currentHistoryRevision={savedAt:'2026-10-01T12:00:00Z'};
 assert.equal(ctx.valuationShareData().date,new Date('2026-10-01T12:00:00Z').toLocaleDateString('pt-PT'));
 ctx.currentHistoryRevision={savedAt:null};assert.equal(ctx.valuationShareData().date,'Data não registada');
});
test('BFCache reopening clears idle results, but a normal background/foreground switch does not',()=>{
 let handler,resets=0,closed=0;
 const ctx=harness({window:{addEventListener(name,fn){assert.equal(name,'pageshow');handler=fn;}},resetAnalysisView(){resets++;},closeHistory(){closed++;},boot(){}});
 vm.runInContext(app.slice(app.indexOf('// BFCache restoration')),ctx);
 handler({persisted:false});assert.equal(resets,0);
 handler({persisted:true});assert.equal(resets,1);assert.equal(closed,1);
 ctx.activeOperation={kind:'analysis'};handler({persisted:true});assert.equal(resets,1);
});
test('a clean reset clears all current assessment state without deleting history, sign-in or preferences',()=>{
 const ctx=harness({pendingResearch:{jobId:'old'},currentVehicle:{make:'Tesla'},currentResult:{},currentMarketData:{},lastAnalysisContext:{},currentAnalysisId:'old',conversation:['old'],
 resetSearchInput(){ctx.q('vehicleUrl').value='';ctx.q('vehicleMileage').value='';},stopProgress(){ctx.q('progressPanel').classList.add('hidden');},hideVehicleFollowup(){},
 setTimeout(){throw Error('unexpected focus timer');}});
 vm.runInContext(source('function resetAnalysisView','function loadImageElement'),ctx);
 ctx.resetAnalysisView({announce:false,focus:false,scroll:false});
 for(const field of ['currentVehicle','currentResult','currentMarketData','lastAnalysisContext','currentAnalysisId','pendingResearch'])assert.equal(ctx[field],null,field);
 assert.equal(ctx.q('result').classList.contains('hidden'),true);
 assert.equal(ctx.q('progressPanel').classList.contains('hidden'),true);
 assert.equal(ctx.session.user.id,'user-one');assert.equal(ctx.lastToast,undefined);
});
test('the real entry page requests the fixed script and includes the historical snapshot notice',()=>{
 assert.match(html,/app-v2\.js\?v=20261023-voice-v1/);
 assert.match(html,/id="historySnapshotNotice" role="status"/);
});
