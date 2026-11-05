const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../comparador-auto-pro/app-v2.js'),'utf8');
function harness(fetch){
  const context={AbortController,setTimeout,clearTimeout,fetch,console};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('async function storageRequest'),app.indexOf('function pendingResearchError')),context);
  return context;
}

test('a successful HTTP response with invalid JSON is never treated as an empty vehicle',async()=>{
  const ctx=harness(async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected HTML');}}));
  await assert.rejects(ctx.fetchJson('/api/comparador-market'),error=>error.code==='invalid_service_response');
  for(const value of [null,[],false,'unavailable']){
    ctx.fetch=async()=>({ok:true,status:200,json:async()=>value});
    await assert.rejects(ctx.fetchJson('/api/comparador-market'),error=>error.code==='invalid_service_response');
  }
});

test('HTML gateway and upload-size errors retain HTTP status for bounded retry or user correction',async()=>{
  for(const status of [502,413,401]){
    const ctx=harness(async()=>({ok:false,status,json:async()=>{throw new SyntaxError('HTML');}}));
    const response=await ctx.fetchJson('/api/comparador-market');
    assert.equal(response.response.status,status);
    assert.equal(response.data.error,'invalid_service_response');
    if(status===413)assert.match(response.data.message,/fotografias excederam/);
  }
});

test('request deadline and caller cancellation abort the actual network request',async()=>{
  let observed;
  const ctx=harness((url,options)=>{
    observed=options.signal;
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(Object.assign(new Error('Abort'),{name:'AbortError'}));
      if(observed.aborted)abort();else observed.addEventListener('abort',abort,{once:true});
    });
  });
  await assert.rejects(ctx.fetchJson('/api/comparador-analyze',{},5),error=>error.name==='AbortError');
  assert.equal(observed.aborted,true);
  const controller=new AbortController();
  const request=ctx.fetchJson('/api/comparador-analyze',{signal:controller.signal},1000);
  controller.abort();
  await assert.rejects(request,error=>error.name==='AbortError');
  assert.equal(observed.aborted,true);
});

test('a database connection that never settles is bounded and its request is aborted',async()=>{
  let signal;
  const query={abortSignal(value){signal=value;return this;},then(){}};
  const ctx=harness();
  await assert.rejects(ctx.storageRequest(query,{timeout:5}),error=>error.code==='storage_timeout');
  assert.equal(signal.aborted,true);
  const controller=new AbortController();
  const request=ctx.storageRequest(query,{timeout:1000,signal:controller.signal});
  controller.abort();
  await assert.rejects(request,error=>error.cancelled===true);
  assert.equal(signal.aborted,true);
  assert.equal((await ctx.storageRequest(Promise.resolve({data:{id:'saved'}}))).data.id,'saved');
});
