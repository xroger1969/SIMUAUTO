const test=require("node:test");
const assert=require("node:assert/strict");
const {configuredModel,modelStatus}=require("../lib/model-config");
const ai=require("../api/comparador-ai");

async function withProvider(fetcher,run,env={OPENAI_API_KEY:"test-model-check",OPENAI_MODEL:""}){
  const oldFetch=global.fetch;
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  for(const [key,value] of Object.entries(env))process.env[key]=value;
  global.fetch=fetcher;
  delete require.cache[require.resolve("../lib/model-config")];
  try{return await run(require("../lib/model-config"));}
  finally{
    global.fetch=oldFetch;
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
}

test("blank configuration selects Astra; explicit drift remains visible",()=>{
  for(const env of [{},{OPENAI_MODEL:""},{OPENAI_MODEL:"  "}])assert.equal(configuredModel(env),"gpt-6-astra");
  assert.equal(configuredModel({OPENAI_MODEL:" gpt-6-astra "}),"gpt-6-astra");
  const drift=modelStatus({OPENAI_MODEL:"gpt-4.1-mini",OPENAI_API_KEY:"test-only"});
  assert.equal(drift.model,"gpt-4.1-mini");
  assert.equal(drift.matches_recommendation,false);
  assert.equal(drift.automatic_fallback,false);
  assert.equal(modelStatus({}).configured,false);
});

test("ordinary health is local and flags configuration drift",async()=>{
  await withProvider(()=>{throw new Error("Health must not generate or call OpenAI");},async()=>{
    let status,payload;
    const res={setHeader(){},status(v){status=v;return this;},json(v){payload=v;}};
    await ai({method:"GET",query:{}},res);
    assert.equal(status,503);
    assert.equal(payload.ok,false);
    assert.equal(payload.model,"gpt-4.1-mini");
    assert.equal(payload.model_check,undefined);
  },{OPENAI_API_KEY:"test-only",OPENAI_MODEL:"gpt-4.1-mini"});
});

test("catalog check uses a fixed read-only endpoint, coalesces requests and caches results",async()=>{
  let calls=0;
  await withProvider(async(url,options)=>{
    calls++;
    assert.equal(url,"https://api.openai.com/v1/models/gpt-6-astra");
    assert.equal(options.body,undefined);
    assert.equal(options.method,undefined);
    return {ok:true,status:200,json:async()=>({id:"gpt-6-astra",shutdown_date:null})};
  },async({verifyModelAvailability})=>{
    const [first,second]=await Promise.all([verifyModelAvailability(),verifyModelAvailability()]);
    assert.equal(first.available,true);
    assert.equal(second.provider_model,"gpt-6-astra");
    assert.equal(first.inference_verified,false);
    assert.equal((await verifyModelAvailability()).cached,true);
    assert.equal(calls,1);
    assert.doesNotMatch(JSON.stringify(first),/test-model-check|Bearer/);
  });
});

test("missing model and denied access never trigger a silent fallback or disclose provider errors",async()=>{
  for(const status of [401,403,404,429,500]){
    let calls=0;
    await withProvider(async()=>{
      calls++;
      return {ok:false,status,json:async()=>({error:{message:"private account details"}})};
    },async({verifyModelAvailability})=>{
      const result=await verifyModelAvailability();
      assert.equal(result.available,[401,403,404].includes(status)?false:null);
      assert.equal(result.inference_verified,false);
      assert.equal(calls,1);
      assert.doesNotMatch(JSON.stringify(result),/private account|test-model-check/);
    });
  }
});

test("network failure and a missing credential are reported as unverified",async()=>{
  await withProvider(async()=>{throw new Error("private network detail");},async({verifyModelAvailability})=>{
    assert.equal((await verifyModelAvailability()).status,"check_failed");
    process.env.OPENAI_API_KEY="";
    assert.equal((await verifyModelAvailability()).status,"not_configured");
  });
});
