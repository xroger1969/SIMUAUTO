// Reviewed against https://developers.openai.com/api/docs/models/gpt-6-astra
// on 2026-11-01. A catalog entry alone does not prove an inference succeeded.
const RECOMMENDED_MODEL="gpt-6-astra";
const POLICY_REVIEWED_AT="2026-11-01";
const CACHE_MS=15*60*1000;
let cache=null;
let pending=null;

function configuredModel(env=process.env){
  return String(env.OPENAI_MODEL||"").trim()||RECOMMENDED_MODEL;
}

function modelStatus(env=process.env){
  const model=configuredModel(env);
  return {
    configured:Boolean(env.OPENAI_API_KEY),model,api:"responses",
    recommended_model:RECOMMENDED_MODEL,
    matches_recommendation:model===RECOMMENDED_MODEL,
    policy_reviewed_at:POLICY_REVIEWED_AT,
    automatic_fallback:false
  };
}

async function verifyModelAvailability(){
  const model=configuredModel(),key=process.env.OPENAI_API_KEY;
  if(!key)return {status:"not_configured",available:null,inference_verified:false};
  if(cache?.model===model&&cache.key===key&&cache.expires>Date.now())return {...cache.result,cached:true};
  if(pending?.model===model&&pending.key===key)return pending.promise;
  const task={model,key};
  task.promise=(async()=>{
    let result;
    const checked_at=new Date().toISOString();
    try{
      const response=await fetch("https://api.openai.com/v1/models/"+encodeURIComponent(model),{
        headers:{authorization:"Bearer "+key},signal:AbortSignal.timeout(10000)
      });
      const data=await response.json().catch(()=>({}));
      const available=response.ok&&data.id===model;
      result={
        checked_at,available:response.ok?available:([401,403,404].includes(response.status)?false:null),
        status:available?"available":response.ok?"unexpected_model":
          response.status===404?"model_unavailable":
          [401,403].includes(response.status)?"access_denied":"check_failed",
        http_status:response.status,
        provider_model:response.ok&&typeof data.id==="string"?data.id:null,
        shutdown_date:response.ok&&typeof data.shutdown_date==="string"?data.shutdown_date:null,
        source:"models.retrieve",inference_verified:false
      };
    }catch{
      // Provider errors may contain account information: expose a fixed status only.
      result={checked_at,available:null,status:"check_failed",source:"models.retrieve",inference_verified:false};
    }
    cache={model,key,expires:Date.now()+CACHE_MS,result};
    return {...result,cached:false};
  })();
  pending=task;
  try{return await task.promise;}finally{if(pending===task)pending=null;}
}

module.exports={configuredModel,modelStatus,verifyModelAvailability};
