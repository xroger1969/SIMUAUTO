const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../comparador-auto-pro/app-v2.js'),'utf8');
const result={subject:{make:'MINI',model:'Countryman',year:2017},comparables:[],risk_flags:[]};
function harness(handler){
  const stored=new Map(),calls=[],elements=new Map();
  const operation={analysisId:'analysis-one',requestKey:'request-one',kind:'analysis',owner:'user-one',controller:new AbortController()};
  const ctx={AbortController,setTimeout,clearTimeout,console,session:{user:{id:'user-one'},access_token:'test'},activeOperation:operation,
    q(id){if(!elements.has(id))elements.set(id,{classList:{add(){},remove(){}},addEventListener(){}});return elements.get(id);},
    localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},
    assertOperation(op){assert.equal(op,operation);},wait:async()=>{},progress(){},
    fetch:async(url,options)=>{calls.push({url,options});const response=await handler(url,options,calls.length);return {...response,json:async()=>response.body};}
  };
  vm.createContext(ctx);
  vm.runInContext(app.slice(app.indexOf('async function storageRequest'),app.indexOf('async function resumePendingAnalysis')),ctx);
  ctx.waitForMarketPoll=async()=>{};
  return {ctx,operation,stored,calls};
}

test('empty or incorrectly shaped JSON cannot finish a saved market job',async()=>{
  for(const body of [{},{subject:null},{subject:[]},{subject:'MINI'},{subject:{make:'MINI'},comparables:{}}]){
    const h=harness((url,options,call)=>({ok:true,status:200,body:call===1?body:result}));
    const value=await h.ctx.pollMarketJob('job-one',h.operation);
    assert.equal(value,result);
    assert.equal(h.calls.length,2);
    assert.ok(h.calls.every(call=>call.url==='/api/comparador-market?job_id=job-one'&&call.options.method==='GET'));
  }
});

test('persistent incomplete market responses become recoverable after bounded polling',async()=>{
  const h=harness(()=>({ok:true,status:200,body:{}}));
  await assert.rejects(h.ctx.pollMarketJob('job-one',h.operation),error=>error.recoverable===true&&/respostas incompletas/.test(error.message));
  assert.equal(h.calls.length,4);
});

test('202 without a pending state or persisted job is retried rather than trusted indefinitely',async()=>{
  const replies=[{ok:true,status:202,body:{}},{ok:true,status:202,body:{status:'queued',job_id:'job-one'}},{ok:true,status:200,body:result}];
  const h=harness(()=>replies.shift());
  assert.equal(await h.ctx.pollMarketJob('job-one',h.operation),result);
  assert.equal(h.calls.length,3);
});

test('retrying an incomplete start uses the same analysis and idempotency key',async()=>{
  let posts=0;
  const h=harness((url,options)=>options.method==='POST'
    ?++posts===1?{ok:true,status:200,body:{}}:{ok:true,status:202,body:{job_id:'job-one',status:'queued'}}
    :{ok:true,status:200,body:result});
  const value=await h.ctx.runMarketAnalysis({mode:'manual',description:'AA-41-BB'},h.operation);
  assert.equal(value,result);
  const requests=h.calls.filter(call=>call.options.method==='POST').map(call=>JSON.parse(call.options.body));
  assert.equal(requests.length,2);
  assert.deepEqual(requests[0],requests[1]);
  assert.equal(requests[0].request_key,'request-one');
  assert.equal(requests[0].analysis_id,'analysis-one');
  assert.equal(h.calls.filter(call=>call.options.method==='GET').length,1);
});

test('an incomplete start keeps a recoverable checkpoint and does not invent a vehicle',async()=>{
  const h=harness(()=>({ok:true,status:200,body:{}}));
  await assert.rejects(h.ctx.runMarketAnalysis({mode:'manual',description:'AA-41-BB'},h.operation),error=>error.recoverable===true&&/respostas incompletas/.test(error.message));
  assert.equal(h.calls.length,2);
  const checkpoint=JSON.parse(h.stored.get('cap:research-checkpoint:user-one'));
  assert.equal(checkpoint.analysisId,'analysis-one');
  assert.equal(checkpoint.jobId,null);
});

test('valid results and terminal cancellation keep their existing behavior',async()=>{
  const direct=harness(()=>({ok:true,status:200,body:result}));
  assert.equal(await direct.ctx.runMarketAnalysis({description:'MINI'},direct.operation),result);
  assert.equal(direct.calls.length,1);
  const cancelled=harness(()=>({ok:true,status:200,body:{status:'cancelled'}}));
  await assert.rejects(cancelled.ctx.pollMarketJob('job-one',cancelled.operation),error=>error.cancelled===true&&!error.recoverable);
  assert.equal(cancelled.calls.length,1);
});
