(function(root,factory){
  const identity=typeof module==="object"&&module.exports?require("./commercial-identity.js"):root.CommercialIdentity;
  const api=factory(identity);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.ElectricRange=api;
})(globalThis,function(identity){
  const text=value=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const known=value=>value!==null&&value!==undefined&&String(value).trim()!=="";
  const positive=value=>known(value)&&Number.isFinite(Number(value))&&Number(value)>0;
  function safeUrl(value){
    try{
      const url=new URL(value);
      if(!["https:","http:"].includes(url.protocol)||url.username||url.password)return null;
      url.hash="";url.hostname=url.hostname.replace(/^www\./i,"").toLowerCase();
      for(const key of [...url.searchParams.keys()])if(/^(utm_.+|fbclid|gclid|ref|referrer|source)$/i.test(key))url.searchParams.delete(key);
      url.searchParams.sort();url.pathname=url.pathname.replace(/\/+$/,"")||"/";
      return url.toString();
    }catch{return null;}
  }
  function rangeIdentity(vehicle={}){
    const v=identity.normalizeVehicleIdentity(vehicle);
    const number=value=>positive(value)?Number(value):null;
    return {make:text(v.make),model:text(v.model),trim:text(v.trim),generation:text(v.generation),
      year:number(v.year),fuel:text(v.fuel),battery_kwh:number(v.battery_kwh),
      power_cv:number(v.power_cv),drivetrain:text(v.drivetrain)};
  }
  const isElectric=vehicle=>["electric","phev"].includes(rangeIdentity(vehicle).fuel);
  const sameIdentity=(a,b)=>JSON.stringify(rangeIdentity(a))===JSON.stringify(rangeIdentity(b));
  function matchingVersion(subject,reference){
    const a=rangeIdentity(subject),b=rangeIdentity(reference);
    if(!["electric","phev"].includes(a.fuel)||a.fuel!==b.fuel||!a.make||a.make!==b.make||!a.model||a.model!==b.model)return false;
    if(!a.year||a.year!==b.year)return false;
    for(const field of ["trim","generation","drivetrain"]){
      if(a[field]&&a[field]!==b[field])return false;
    }
    for(const field of ["battery_kwh","power_cv"]){
      if(a[field]&&(!b[field]||Math.abs(a[field]-b[field])>(field==="battery_kwh"?.6:Math.max(3,a[field]*.03))))return false;
    }
    // A model name alone cannot select a battery/range variant.
    return !!(a.trim&&a.trim===b.trim&&((a.battery_kwh&&b.battery_kwh)||(a.power_cv&&b.power_cv)));
  }
  function normalizeRealRange(candidate,subject,sources){
    if(!candidate||candidate.version_match!=="exact"||!matchingVersion(subject,candidate.vehicle))return null;
    const low=candidate.min_km,high=candidate.max_km,url=safeUrl(candidate.source_url);
    if(!Number.isInteger(low)||!Number.isInteger(high)||low<5||high<low||high>1500||!url)return null;
    if(!sources.some(source=>safeUrl(source?.url||source?.link)===url))return null;
    const evidence=String(candidate.evidence||"");
    const numbers=[...evidence.matchAll(/\b(\d{1,4})\s*km\b/gi)].map(match=>Number(match[1]));
    if(!numbers.includes(low)||!numbers.includes(high)||!String(candidate.conditions||"").trim())return null;
    return {min_km:low,max_km:high,source_url:url,conditions:String(candidate.conditions).slice(0,300),evidence:evidence.slice(0,600)};
  }
  function normalizeRange(candidate,subject,sources=[],observedAt=new Date().toISOString()){
    if(!candidate||candidate.cycle!=="WLTP_COMBINED"||candidate.version_match!=="exact")return null;
    if(!Number.isInteger(candidate.combined_km)||candidate.combined_km<10||candidate.combined_km>1500)return null;
    if(!["manufacturer","homologation"].includes(candidate.source_type)||!matchingVersion(subject,candidate.vehicle))return null;
    const url=safeUrl(candidate.source_url);
    if(!url||!sources.some(source=>safeUrl(source?.url||source?.link)===url))return null;
    const evidence=String(candidate.evidence||"").trim();
    if(!/wltp/i.test(evidence)||evidence.length<12)return null;
    // Reject contradictory cycles even if the model labels the field as combined.
    if(/\b(?:nedc|epa|city|urban[oa]?|urbain[e]?|urbano|stadt|stads|ville)\b/i.test(evidence))return null;
    const statedKm=[...evidence.matchAll(/\b(\d{2,4}(?:[.,]\d+)?)\s*(?:km|quil[oó]metros?|kilometres?|kilometers?)\b/gi)];
    if(!statedKm.some(match=>Number(match[1].replace(",","."))===candidate.combined_km))return null;
    return {combined_km:candidate.combined_km,cycle:"WLTP_COMBINED",source_url:url,
      source_title:String(candidate.source_title||"Fonte WLTP").slice(0,240),
      source_type:candidate.source_type,source_variant:String(candidate.source_variant||"").slice(0,240),
      reference_battery_kwh:positive(candidate.vehicle.battery_kwh)&&[...String(candidate.battery_evidence||evidence).matchAll(/(\d+(?:[.,]\d+)?)\s*kWh/gi)].some(m=>Number(m[1].replace(",","."))===Number(candidate.vehicle.battery_kwh))?Number(candidate.vehicle.battery_kwh):null,
      battery_evidence:String(candidate.battery_evidence||evidence).slice(0,600),
      battery_basis:["usable","gross"].includes(candidate.battery_basis)?candidate.battery_basis:"unknown",
      real_range:normalizeRealRange(candidate.real_range,subject,sources),
      evidence:evidence.slice(0,600),identity:rangeIdentity(subject),
      source_url_verified:true,observed_at:observedAt};
  }
  function confirmedRange(vehicle={}){
    const range=vehicle.ev_range;
    if(!isElectric(vehicle)||!range||range.source_url_verified!==true||range.cycle!=="WLTP_COMBINED")return null;
    if(!Number.isInteger(range.combined_km)||range.combined_km<10||range.combined_km>1500||!safeUrl(range.source_url))return null;
    if(!range.identity||!sameIdentity(vehicle,range.identity))return null;
    return range;
  }
  // Technical research is independent of the valuation and of the legacy
  // all-or-nothing WLTP object. A sourced battery remains useful on its own.
  function confirmedSpecs(vehicle={}){
    const specs=vehicle.ev_specs;
    if(!isElectric(vehicle)||!specs||specs.research_version!==1||!specs.identity||!sameIdentity(vehicle,specs.identity))return null;
    if(!["confirmed","partial","not_found"].includes(specs.status)||!Number.isFinite(Date.parse(specs.checked_at||"")))return null;
    const source=field=>field&&safeUrl(field.source_url)&&typeof field.evidence==="string"&&field.evidence.trim().length>0;
    const battery=source(specs.battery)&&positive(specs.battery.capacity_kwh)&&Number(specs.battery.capacity_kwh)<=500
      &&["usable","gross","unknown"].includes(specs.battery.basis)?specs.battery:null;
    const wltp=source(specs.wltp)&&Number.isInteger(specs.wltp.combined_km)&&specs.wltp.combined_km>=10&&specs.wltp.combined_km<=1500?specs.wltp:null;
    const real=specs.real_range;
    const realRange=source(real)&&Number.isInteger(real.min_km)&&Number.isInteger(real.max_km)&&real.min_km>=5&&real.max_km>=real.min_km&&real.max_km<=1500
      &&typeof real.conditions==="string"&&real.conditions.trim()?real:null;
    if(specs.status!=="not_found"&&!battery&&!wltp&&!realRange)return null;
    return {...specs,battery,wltp,real_range:realRange};
  }
  function needsSpecsResearch(vehicle={},now=Date.now()){
    if(!isElectric(vehicle))return false;
    const specs=confirmedSpecs(vehicle);
    if(!specs)return true;
    const age=now-Date.parse(specs.checked_at),ttl=specs.status==="not_found"?3600000:30*86400000;
    return age< -300000||age>=ttl;
  }
  const nullableString={type:["string","null"]},nullableNumber={type:["number","null"]};
  const vehicleProperties={make:nullableString,model:nullableString,trim:nullableString,generation:nullableString,
    year:{type:["integer","null"]},fuel:nullableString,battery_kwh:nullableNumber,power_cv:nullableNumber,drivetrain:nullableString};
  const realProperties={version_match:{type:"string",enum:["exact","ambiguous","unknown"]},vehicle:{type:"object",additionalProperties:false,required:Object.keys(vehicleProperties),properties:vehicleProperties},min_km:{type:"integer"},max_km:{type:"integer"},source_url:{type:"string"},conditions:{type:"string"},evidence:{type:"string"}};
  const properties={battery_evidence:nullableString,battery_basis:{type:"string",enum:["usable","gross","unknown"]},
    real_range:{anyOf:[{type:"null"},{type:"object",additionalProperties:false,required:Object.keys(realProperties),properties:realProperties}]},combined_km:{type:["integer","null"]},cycle:{type:"string",enum:["WLTP_COMBINED","WLTP_CITY","NEDC","EPA","unknown"]},
    version_match:{type:"string",enum:["exact","ambiguous","unknown"]},
    vehicle:{type:"object",additionalProperties:false,required:Object.keys(vehicleProperties),properties:vehicleProperties},
    source_url:nullableString,source_title:nullableString,source_variant:nullableString,
    source_type:{type:"string",enum:["manufacturer","homologation","other","unknown"]},evidence:{type:"string"}};
  const rangeSchema={anyOf:[{type:"null"},{type:"object",additionalProperties:false,required:Object.keys(properties),properties}]};
  return {rangeSchema,normalizeRange,confirmedRange,confirmedSpecs,needsSpecsResearch,isElectric,rangeIdentity,safeUrl};
});
