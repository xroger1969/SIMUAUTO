// Observations belong to this vehicle/input; price evidence belongs to a cited source.
const nullableNumber={type:["number","null"],minimum:0,maximum:100000};
const costSchema={
  type:"object",additionalProperties:false,
  required:["parts_min_eur","parts_max_eur","labour_min_eur","labour_max_eur","price_basis","source_url","source_title","fitment_note"],
  properties:{
    parts_min_eur:nullableNumber,parts_max_eur:nullableNumber,
    labour_min_eur:nullableNumber,labour_max_eur:nullableNumber,
    price_basis:{type:"string",enum:["gross","net","unknown"]},
    source_url:{type:["string","null"]},source_title:{type:["string","null"]},fitment_note:{type:"string"}
  }
};
const conditionSchema={
  type:"object",additionalProperties:false,
  required:["assessed","summary","findings","checks","maintenance_notes","inspection","battery_soh_pct"],
  properties:{
    assessed:{type:"boolean"},summary:{type:"string"},
    findings:{type:"array",maxItems:30,items:{
      type:"object",additionalProperties:false,
      required:["component","label","category","action","status","quantity","evidence","source_image","safety_critical","cost"],
      properties:{
        component:{type:"string",description:"Identificador físico inequívoco, por exemplo front_bumper, left_door, right_rear_wing, front_brake_pads. Uma zona genérica não é um painel."},
        label:{type:"string"},category:{type:"string",enum:["paint","body","mechanical","maintenance","tyres","interior","electrical","inspection"]},
        action:{type:"string",enum:["polish","paint","repair","repair_and_paint","replace","service","diagnose","inspect"]},
        status:{type:"string",enum:["confirmed","suspected","unassessed","ok"]},
        quantity:{type:"integer",minimum:1,maximum:8},evidence:{type:"string"},
        source_image:{type:["integer","null"],minimum:1,maximum:6},safety_critical:{type:"boolean"},cost:costSchema
      }
    }},
    checks:{type:"array",maxItems:20,items:{type:"object",additionalProperties:false,required:["system","result","note"],properties:{
      system:{type:"string"},result:{type:"string",enum:["no_findings_reported","issue","not_tested","unknown"]},note:{type:"string"}
    }}},
    maintenance_notes:{type:"array",maxItems:12,items:{type:"string"}},
    inspection:{type:"object",additionalProperties:false,required:["last_date","mileage_km","due_date"],properties:{
      last_date:{type:["string","null"]},mileage_km:{type:["integer","null"],minimum:0},due_date:{type:["string","null"]}
    }},
    battery_soh_pct:{type:["number","null"],minimum:0,maximum:100}
  }
};
const clip=(v,n=700)=>String(v??"").slice(0,n);
const key=v=>clip(v,120).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
const amount=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=100000?Number(v):null;
function sourceUrl(v){try{const u=new URL(v);if(!["https:","http:"].includes(u.protocol)||u.username||u.password)return null;u.hash="";u.hostname=u.hostname.replace(/^www\./i,"");u.pathname=u.pathname.replace(/\/+$/,"")||"/";return u.toString()}catch{return null}}
function normalizeConditionReport(raw={},sources=[],observedAt=new Date().toISOString()){
  raw=raw&&typeof raw==="object"?raw:{};
  const urls=new Set(sources.map(x=>sourceUrl(x?.url)).filter(Boolean));
  const findings=(Array.isArray(raw.findings)?raw.findings:[]).slice(0,30).flatMap(item=>{
    if(!item||!key(item.component)||!clip(item.evidence).trim())return [];
    const c=item.cost||{},url=sourceUrl(c.source_url);
    const categories=conditionSchema.properties.findings.items.properties.category.enum;
    const actions=conditionSchema.properties.findings.items.properties.action.enum;
    const statuses=conditionSchema.properties.findings.items.properties.status.enum;
    return [{
      component:key(item.component),label:clip(item.label,160),
      category:categories.includes(item.category)?item.category:"maintenance",
      action:actions.includes(item.action)?item.action:"inspect",
      status:statuses.includes(item.status)?item.status:"unassessed",
      quantity:Math.max(1,Math.min(8,Math.trunc(Number(item.quantity)||1))),evidence:clip(item.evidence),
      source_image:Number.isInteger(item.source_image)&&item.source_image>=1&&item.source_image<=6?item.source_image:null,
      safety_critical:item.safety_critical===true,
      cost:{
        parts_min_eur:amount(c.parts_min_eur),parts_max_eur:amount(c.parts_max_eur),
        labour_min_eur:amount(c.labour_min_eur),labour_max_eur:amount(c.labour_max_eur),
        price_basis:["gross","net"].includes(c.price_basis)?c.price_basis:"unknown",
        source_url:url,source_title:clip(c.source_title,200),fitment_note:clip(c.fitment_note,500),
        source_verified:!!url&&urls.has(url),observed_at:observedAt
      }
    }];
  });
  const inspection=raw.inspection||{};
  return {
    version:"condition-v1",assessed:raw.assessed===true,summary:clip(raw.summary,1200),findings,
    checks:(Array.isArray(raw.checks)?raw.checks:[]).slice(0,20).map(x=>({system:clip(x?.system,100),result:["no_findings_reported","issue","not_tested","unknown"].includes(x?.result)?x.result:"unknown",note:clip(x?.note,350)})),
    maintenance_notes:(Array.isArray(raw.maintenance_notes)?raw.maintenance_notes:[]).slice(0,12).map(x=>clip(x,500)),
    inspection:{last_date:clip(inspection.last_date,30)||null,mileage_km:amount(inspection.mileage_km),due_date:clip(inspection.due_date,30)||null},
    battery_soh_pct:amount(raw.battery_soh_pct)!==null&&amount(raw.battery_soh_pct)<=100?amount(raw.battery_soh_pct):null
  };
}
function mergeConditionReports(observed,researched){
  if(!observed?.assessed&&!observed?.findings?.length)return researched||observed||{};
  const priced=new Map((researched?.findings||[]).map(x=>[key(x.component)+"|"+x.action,x]));
  return {...observed,findings:(observed.findings||[]).map(x=>({...x,cost:priced.get(key(x.component)+"|"+x.action)?.cost||x.cost}))};
}
function needsConditionResearch(report){
  return (report?.findings||[]).some(x=>["confirmed","suspected"].includes(x.status));
}
module.exports={conditionSchema,normalizeConditionReport,mergeConditionReports,needsConditionResearch};
