const crypto=require("node:crypto");
const {authenticate,takeQuota,rest,endpoint,appError}=require("../lib/access");
const {rangeIdentity,isElectric,confirmedSpecs,needsSpecsResearch}=require("../comparador-auto-pro/electric-range.js");
const {researchElectricSpecs,knownElectricSpecs}=require("../lib/electric-specs");

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const completed=new Map(),pending=new Map();
const identityKey=vehicle=>crypto.createHash("sha256").update(JSON.stringify(rangeIdentity(vehicle))).digest("hex");
const sameIdentity=(a,b)=>identityKey(a)===identityKey(b);

function technicalVehicle(raw={}){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw appError("Ficha da viatura inválida.",400,"invalid_vehicle");
  // No registration, VIN, photos, prices, mileage, saved verification flags or
  // arbitrary instructions are sent to the research provider.
  const input={};
  for(const field of ["make","model","trim","generation","fuel","drivetrain"]){
    if(raw[field]!=null&&typeof raw[field]!=="string")throw appError("Identidade técnica inválida.",400,"invalid_vehicle");
    input[field]=String(raw[field]||"").trim().slice(0,160)||null;
  }
  for(const [field,min,max] of [["year",1990,new Date().getFullYear()+1],["battery_kwh",1,500],["power_cv",1,3000]]){
    const value=raw[field];
    input[field]=value===null||value===undefined||value===""?null:Number(value);
    if(input[field]!==null&&(!Number.isFinite(input[field])||input[field]<min||input[field]>max||(field==="year"&&!Number.isInteger(input[field])))){
      throw appError("Valor técnico inválido: "+field+".",400,"invalid_vehicle");
    }
  }
  const vehicle=rangeIdentity(input);
  if(!vehicle.make||!vehicle.model||!vehicle.year)throw appError("Confirma a marca, o modelo e o ano para pesquisar a bateria.",422,"incomplete_vehicle");
  if(!isElectric(vehicle))throw appError("A pesquisa de autonomia elétrica aplica-se a elétricos e híbridos plug-in.",422,"not_electric");
  return vehicle;
}

async function ownedJob(token,id){
  if(!id)return null;
  if(!uuid.test(id))throw appError("Identificador da avaliação inválido.",400,"invalid_job_id");
  const rows=await rest(token,"cap_jobs?select=id,status,result,context,created_at,updated_at&id=eq."+encodeURIComponent(id)+"&limit=1");
  const job=Array.isArray(rows)?rows[0]:null;
  if(!job)throw appError("Esta avaliação não está disponível na tua conta.",404,"job_not_found");
  if(job.status!=="completed"||!job.result?.subject)throw appError("Conclui a identificação da viatura antes da pesquisa técnica.",409,"job_not_completed");
  if(job.result.valuation_blocked)throw appError("Confirma primeiro a identidade da viatura.",409,"identity_unconfirmed");
  return job;
}

function reusable(specs,vehicle,force=false){
  const value=confirmedSpecs({...vehicle,ev_specs:specs});
  if(!value||needsSpecsResearch({...vehicle,ev_specs:value}))return null;
  if(force&&value.status!=="confirmed")return null;
  return value;
}
async function cachedSpecs(token,key,vehicle,force){
  try{
    const rows=await rest(token,"cap_jobs?select=context&status=eq.completed&context->electric_specs->>cache_key=eq."+encodeURIComponent(key)+"&order=updated_at.desc&limit=5");
    for(const row of Array.isArray(rows)?rows:[]){
      const specs=reusable(row.context?.electric_specs,vehicle,force);
      if(specs)return specs;
    }
  }catch{ /* A cache failure must not prevent an independent technical lookup. */ }
  return null;
}
async function storeSpecs(token,job,specs){
  if(!job)return;
  // Preserve the market's original timestamp. Updating technical information
  // must not make old advertisements eligible for another 24 hours.
  const marketCache={...job.result.market_cache,snapshot_at:job.result.market_cache?.snapshot_at||job.updated_at||job.created_at};
  const path="cap_jobs?id=eq."+encodeURIComponent(job.id)+"&status=eq.completed&updated_at=eq."+encodeURIComponent(job.updated_at);
  await rest(token,path,{method:"PATCH",headers:{Prefer:"return=minimal"},body:{
    context:{...job.context,electric_specs:specs},
    result:{...job.result,subject:{...job.result.subject,ev_specs:specs},market_cache:marketCache}
  }});
}
function remember(key,specs){
  if(completed.size>=200)completed.delete(completed.keys().next().value);
  completed.set(key,specs);
}

module.exports=endpoint(async function(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  const {token,user}=await authenticate(req);
  const requested=technicalVehicle(req.body?.vehicle);
  const job=await ownedJob(token,String(req.body?.job_id||"").trim());
  const vehicle=job?technicalVehicle(job.result.subject):requested;
  if(!sameIdentity(requested,vehicle))throw appError("A viatura foi alterada. Repete a pesquisa técnica na avaliação atual.",409,"vehicle_changed");
  const force=req.body?.force===true,key=identityKey(vehicle),scope=user.id+":"+key;
  // Only server-owned context is trusted for persisted research; never a
  // browser-supplied ev_specs/source_url_verified flag.
  let specs=reusable(job?.context?.electric_specs,vehicle,force)||reusable(completed.get(scope),vehicle,force);
  let cacheHit=!!specs;
  if(!specs){specs=reusable(knownElectricSpecs(vehicle),vehicle,force);cacheHit=!!specs;}
  if(!specs){specs=await cachedSpecs(token,key,vehicle,force);cacheHit=!!specs;}
  if(!specs){
    if(!pending.has(scope)){
      const task=(async()=>{
        await takeQuota(token,"market");
        const result=await researchElectricSpecs(vehicle);
        remember(scope,result);
        return result;
      })();
      pending.set(scope,task);
      // A settled failed lookup is not a permanent negative cache entry.
      task.finally(()=>{if(pending.get(scope)===task)pending.delete(scope);}).catch(()=>{});
    }
    specs=await pending.get(scope);
  }
  specs={...specs,cache_key:key};
  remember(scope,specs);
  let cacheSaved=true;
  try{await storeSpecs(token,job,specs);}catch{cacheSaved=false;}
  return res.status(200).json({ok:true,ev_specs:specs,cached:cacheHit,cache_saved:cacheSaved});
});
module.exports._test={technicalVehicle,identityKey,reusable,cachedSpecs,storeSpecs,ownedJob,completed,pending};
