const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=path.join(__dirname,'../comparador-auto-pro');
const app=fs.readFileSync(path.join(base,'app-v2.js'),'utf8');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const source=(from,to)=>app.slice(app.indexOf(from),app.indexOf(to,app.indexOf(from)));
function harness(extra={}){
  const elements=new Map();
  const q=id=>{
    if(!elements.has(id)){
      const classes=new Set();
      elements.set(id,{textContent:'',innerHTML:'',children:[],classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,value)=>value?classes.add(x):classes.delete(x),contains:x=>classes.has(x)},appendChild(x){this.children.push(x)},append(...xs){this.children.push(...xs)},addEventListener(){}});
    }
    return elements.get(id);
  };
  const ctx={q,console,Date,Number,String,Object,Math,Array,JSON,Intl,Set,historyDate:new Intl.DateTimeFormat('pt-PT',{dateStyle:'short',timeStyle:'short'}),session:{user:{id:'user-one'},access_token:'test'},currentMarketData:null,...extra};
  vm.createContext(ctx);return ctx;
}

test('zero accepted market references never render a positive tier or fixed-market message',()=>{
  const ctx=harness();
  vm.runInContext(source('function hasMarketReference','function historyItem'),ctx);
  const result={market:{comparablesUsed:0,marketValue:null,searchTier:0,confidencePct:0},purchase:{}};
  assert.equal(ctx.hasMarketReference(result),false);
  assert.match(ctx.assessmentConfidenceLabel(result),/Sem referência de mercado/);
  assert.doesNotMatch(ctx.assessmentConfidenceLabel(result),/Nível 1/);
  assert.equal(ctx.marketSnapshotNote(result,{hit:true,snapshot_at:new Date().toISOString()}),'');
  result.market={comparablesUsed:2,marketValue:30000,searchTier:2,confidencePct:40};
  assert.match(ctx.assessmentConfidenceLabel(result),/índice de evidência 40%/);
  assert.match(ctx.marketSnapshotNote(result,{hit:true,snapshot_at:new Date().toISOString()}),/amostra reutilizada/);
  assert.match(ctx.assessmentConfidenceLabel({purchase:{priceScenario:true}}),/Nível 4/);
});

test('plate text, manual input and photographs never claim a public announcement was read',()=>{
  const ctx=harness({renderTagList(){},displayValue:v=>v??'—',originLabel:()=>'',fmt:String,esc:String});
  vm.runInContext(source('function renderVehicleReadout','const VALUATION_REQUIRED_FIELDS='),ctx);
  const reader={status:'ok',source_kind:'manual',page:{text_sample:'AL-47-IC'}};
  ctx.renderVehicleReadout({registration:'AL-47-IC'},{reader,entry:{mode:'manual',registration:'AL-47-IC'}});
  assert.equal(ctx.q('adReadStatus').textContent,'Identificação pela matrícula');
  assert.doesNotMatch(ctx.q('adReadStatus').textContent,/anúncio lido|carateres/);
  ctx.renderVehicleReadout({},{reader,entry:{mode:'manual'}});
  assert.equal(ctx.q('adReadStatus').textContent,'Descrição fornecida manualmente');
  ctx.renderVehicleReadout({},{reader:{...reader,source_kind:'photo'},entry:{mode:'manual'}});
  assert.equal(ctx.q('adReadStatus').textContent,'Leitura pelas fotografias fornecidas');
});

test('original risk flags and calculation warnings reach the visible risk list',()=>{
  assert.match(html,/id="riskList"[^>]*aria-live="polite"/);
  const ctx=harness({document:{createElement:()=>({})}});
  vm.runInContext(source('function renderRisks','function comparableElement'),ctx);
  ctx.renderRisks([{label:'Bateria por verificar',severity:'high'}],['Quilómetros estimados','Bateria por verificar']);
  assert.deepEqual(ctx.q('riskList').children.map(x=>x.textContent),['Bateria por verificar','Quilómetros estimados']);
  assert.equal(ctx.q('riskList').children[0].className,'risk high');
});

test('a failed history write retains the calculated snapshot and can be retried',async()=>{
  const stored=new Map();let fail=true,writes=0;
  const ctx=harness({pendingAnalysisSaves:[],pendingSavesAttempt:null,activeOperation:null,toast(){},sessionStorage:{setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},makeSnapshot:(r,m,reader,entry,payload,kind)=>({result:r,calculation_kind:kind}),saveAnalysisSnapshot:async()=>{writes++;if(fail)throw Error('offline')}});
  vm.runInContext(source('function pendingSavesKey','async function initializeAppData'),ctx);
  const result={purchase:{effectiveCeiling:20000}};
  assert.equal(await ctx.persistCompletedAnalysis('analysis-one',result,{},null,null,null,'analysis'),false);
  assert.equal(ctx.pendingAnalysisSaves.length,1);
  assert.equal(ctx.pendingAnalysisSaves[0].snapshot.result.purchase.effectiveCeiling,20000);
  result.purchase.effectiveCeiling=1;
  assert.equal(ctx.pendingAnalysisSaves[0].snapshot.result.purchase.effectiveCeiling,20000);
  assert.equal(ctx.q('analysisSaveNotice').classList.contains('hidden'),false);
  assert.match([...stored.keys()][0],/user-one/);
  fail=false;
  assert.equal(await ctx.retryPendingSaves(),true);
  assert.equal(ctx.pendingAnalysisSaves.length,0);
  assert.equal(ctx.q('analysisSaveNotice').classList.contains('hidden'),true);
  assert.equal(writes,2);
});

test('network polling interruption is recoverable while a terminal provider failure is not',async()=>{
  const ctx=harness({assertOperation(){},wait:async()=>{},progress(){},fetchJson:async()=>{throw Error('network')}});
  vm.runInContext(source('function pendingResearchError','async function runMarketAnalysis'),ctx);
  await assert.rejects(ctx.pollMarketJob('job-one',{}),error=>error.recoverable===true);
  ctx.fetchJson=async()=>({response:{ok:false,status:502},data:{error:'market_job_failed',message:'Provider failed'}});
  await assert.rejects(ctx.pollMarketJob('job-one',{}),error=>!error.recoverable&&error.message==='Provider failed');
  ctx.fetchJson=async()=>({response:{ok:false,status:503},data:{error:'service_unavailable'}});
  await assert.rejects(ctx.pollMarketJob('job-one',{}),error=>error.recoverable===true);
  await assert.rejects(ctx.pollMarketJob('job-one',{},0),error=>error.recoverable===true);
});

test('history exposes an old pending job without a recent-time cutoff',async()=>{
  const calls=[];let resume=null;
  const query={select(){return this},eq(...args){calls.push(['eq',...args]);return this},in(){return this},order(){return this},limit:async()=>({data:[{id:'old-job',analysis_id:'old-analysis',created_at:'2026-09-01T12:00:00Z',context:{previous_subject:{make:'Tesla',model:'Model Y'}}}]})};
  const ctx=harness({db:{from:()=>query},document:{createElement:()=>({children:[],append(...xs){this.children.push(...xs)},addEventListener(name,fn){this.listener=fn}})},closeHistory(){},resumePendingAnalysis:id=>{resume=id}});
  vm.runInContext(source('async function loadRecoverableJobs','function openHistory'),ctx);
  await ctx.loadRecoverableJobs();
  assert.equal(ctx.q('historyPendingList').children.length,1);
  const [label,,button]=ctx.q('historyPendingList').children[0].children;
  assert.equal(label.textContent,'Tesla Model Y');
  button.listener();assert.equal(resume,'old-job');
  assert.deepEqual(calls,[['eq','user_id','user-one']]);
});


test('real page loads the shared identity module before the current valuation engine',()=>{
  const shared=html.indexOf('src="./commercial-identity.js?v=20261022-commercial-cohort-v2"');
  const appModule=html.indexOf('type="module" src="./app-v2.js?');
  assert.ok(shared>=0&&shared<appModule);
  assert.match(app,/valuation\.js\?v=20261022-commercial-cohort-v2/);
  assert.match(html,/tax-simulator-ui\.js\?v=20261022-compact-audit-v3/);
});

test('simultaneous save retries do not duplicate the same evidence write',async()=>{
  let release,writes=0;
  const ctx=harness({pendingAnalysisSaves:[{analysisId:'a',snapshot:{result:{}}}],pendingSavesAttempt:null,sessionStorage:{setItem(){},removeItem(){}},saveAnalysisSnapshot:async()=>{writes++;await new Promise(resolve=>{release=resolve})}});
  vm.runInContext(source('function pendingSavesKey','async function initializeAppData'),ctx);
  const first=ctx.retryPendingSaves(),second=ctx.retryPendingSaves();
  assert.equal(writes,1);release();
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(writes,1);
});
