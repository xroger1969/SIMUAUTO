(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.CommercialIdentity=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const num=(v,f=0)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))?Number(v):f;
const known=v=>v!==null&&v!==undefined&&v!=="";
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const norm=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g," ");
const same=(a,b)=>known(a)&&known(b)&&norm(a)===norm(b);
const fuel=v=>({
  eletrico:"electric",electrico:"electric",electric:"electric",
  gasolina:"petrol",petrol:"petrol",
  gasoleo:"diesel",diesel:"diesel",
  hibrido:"hybrid",hybrid:"hybrid",
  "hibrido plug in":"phev","plug in hybrid":"phev",phev:"phev",
  "gasolina plug in":"phev","gasolina plugin":"phev",
  "hibrido plug in gasolina":"phev","gasolina hibrido plug in":"phev",
  "hibrido plug in a gasolina":"phev","phev gasolina":"phev",
  "hibrido plug in diesel":"phev","hibrido plug in a gasoleo":"phev"
}[norm(v).replace(/[-_]+/g," ").replace(/\s+/g," ")]||norm(v));
const sellerType=c=>{
  const t=norm(c?.seller_type||c?.sellerType);
  if(["professional","dealer","stand","trade"].includes(t))return "professional";
  if(["private","particular"].includes(t))return "private";
  return "unknown";
};

// Keep original provider fields available while evaluating a commercial identity.
function canonicalDrive(value){
  const v=norm(value).replace(/[-_]+/g," ");
  if(/\b(awd|4wd|4x4|xdrive|quattro|4matic)\b|tracao integral|dual motor|all wheel/.test(v))return "awd";
  if(/\brwd\b|rear wheel|tracao traseira/.test(v))return "rwd";
  if(/\bfwd\b|front wheel|tracao dianteira/.test(v))return "fwd";
  return v;
}
function normalizeVehicleIdentity(vehicle={}){
  const v={...vehicle},raw=vehicle.commercial_identity?.raw||{make:vehicle.make??null,model:vehicle.model??null,trim:vehicle.trim??null,drivetrain:vehicle.drivetrain??null};
  let model=String(v.model||"").trim(),trim=String(v.trim||"").trim();
  const make=norm(v.make),joined=norm(model+" "+trim);
  const tesla=make==="tesla"&&model.match(/^model\s*([3sxy])(?:\s+(.+))?$/i);
  if(tesla){
    model="Model "+tesla[1].toUpperCase();
    const modelTrim=tesla[2]||"";
    if(modelTrim&&(!trim||/^\d+$/.test(trim)))trim=modelTrim;
    else if(modelTrim&&!norm(trim).includes(norm(modelTrim)))trim=modelTrim+" "+trim;
    // Provider homologation codes are not commercial versions.
    if(/^\d+$/.test(trim))trim="";
  }
  // BMW providers put the derivative in model (225e xDrive Active Tourer),
  // while reports use Série-2 Active Tourer (U06) plus a separate version.
  // Only collapse an explicit Tourer body; Série 2 alone remains ambiguous.
  const bmwModel=norm(model).replace(/[-_]+/g," ").replace(/\b(2\d{2})\s+(xe|d|i|e)\b/g,"$1$2");
  const tourer=make==="bmw"&&bmwModel.match(/\b(active|gran)\s+tourer\b/);
  if(tourer&&/\b(?:(?:serie|series)\s*2|2\s*series|2\d{2}(?:xe|d|i|e))\b/.test(bmwModel)){
    model="Série 2 "+(tourer[1]==="active"?"Active":"Gran")+" Tourer";
    const modelDerivative=bmwModel.match(/\b2\d{2}(?:xe|d|i|e)\b/)?.[0];
    if(modelDerivative&&(!derivativeCode({trim})||/^u2at$/i.test(trim))){
      const equipmentTrim=/^u2at$/i.test(trim)?"":trim;
      trim=[modelDerivative+(/\bxdrive\b/.test(bmwModel)?" xDrive":""),equipmentTrim].filter(Boolean).join(" ");
    }
    const generation=bmwModel.match(/\b(f45|f46|u06)\b/)?.[0];
    if(generation&&!known(v.generation))v.generation=generation.toUpperCase();
  }
  const explicitDrive=known(v.drivetrain)?canonicalDrive(v.drivetrain):"";
  const joinedDrive=canonicalDrive(joined);
  const inferredDrive=["awd","rwd","fwd"].includes(joinedDrive)?joinedDrive:"";
  let variant=null;
  if(make==="tesla"){
    if(/\bperformance\b/.test(joined))variant="performance";
    else if(/\blong range\b|\blongo alcance\b/.test(joined))variant="long range";
    else if(/\bstandard range\b/.test(joined))variant="standard range";
  }
  if(variant){
    const drive=explicitDrive||inferredDrive;
    trim=variant+(drive?" "+drive:"");
  }
  const canonicalMake={vw:"Volkswagen",volkswagen:"Volkswagen",mercedes:"Mercedes-Benz","mercedes benz":"Mercedes-Benz","mercedes-benz":"Mercedes-Benz",mercedesbenz:"Mercedes-Benz"}[make]||v.make;
  return {...v,make:canonicalMake,model:model||v.model,trim:trim||null,
    fuel:known(v.fuel)?fuel(v.fuel):v.fuel,
    drivetrain:explicitDrive||inferredDrive||v.drivetrain||null,
    commercial_identity:{version:"commercial-v2",raw,variant,
      drivetrain_conflict:vehicle.commercial_identity?.drivetrain_conflict===true||(!!explicitDrive&&!!inferredDrive&&explicitDrive!==inferredDrive)}};
}
function explicitVariantMatch(s,c){
  const a=s.commercial_identity?.variant,b=c.commercial_identity?.variant;
  return fuel(s.fuel)==="electric"&&fuel(c.fuel)==="electric"
    &&norm(s.make)==="tesla"&&norm(c.make)==="tesla"&&sameModel(s,c)
    &&a&&b&&a===b&&canonicalDrive(s.drivetrain)==="awd"&&canonicalDrive(c.drivetrain)==="awd"
    &&!s.commercial_identity?.drivetrain_conflict&&!c.commercial_identity?.drivetrain_conflict;
}
function powerDiscrepancy(s,c){
  return known(s.power_cv)&&known(c.power_cv)
    &&Math.abs(num(s.power_cv)-num(c.power_cv))>Math.max(45,num(s.power_cv)*.25);
}
function toleratedPowerDifference(s,c){
  const a=num(s.power_cv),b=num(c.power_cv);
  // Limited source disagreement (e.g. continuous vs advertised peak), not an unrestricted waiver.
  return explicitVariantMatch(s,c)&&Math.min(a,b)>=150&&Math.abs(a-b)<=200&&Math.max(a,b)/Math.min(a,b)<=1.8;
}
function commercialExclusion(c){
  if(known(c.availability)&&["sold","unavailable","removed","expired","vendido","indisponivel"].includes(norm(c.availability)))return "anúncio vendido ou indisponível";
  if(known(c.country)&&!["pt","portugal","unknown","desconhecido"].includes(norm(c.country)))return "anúncio fora de Portugal";
  if(known(c.price_basis)&&!["gross","unknown"].includes(norm(c.price_basis)))return "preço final com IVA não confirmado";
  if(c.price_conditioned===true&&!(num(c.cash_price)>0))return "preço condicionado sem preço a pronto confirmado";
  return null;
}

function modelKey(make,model){
  const m=norm(make);
  let v=norm(model);
  if(!v)return "";
  // Só normalizar grafias conhecidas; manter códigos de motor e carroçarias.
  if(m==="volkswagen"||m==="vw")v=v.replace(/^id[.\s]?([3-7])(?=\s|$)/,"id $1");
  if(m==="bmw")v=v.replace(/\b([1-8]\d{2})\s+(xe|xd|xi|d|i|e)\b/g,"$1$2");
  if(m==="citroen")v=v.replace(/\bgrand c4 picasso\b/g,"c4 grand picasso");
  if(["mercedes","mercedes benz","mercedes-benz","mercedesbenz"].includes(m)){
    const mv=v.replace(/[-_]+/g," ").replace(/\s+/g," ");
    // Portais alternam entre "Classe A", "A 180 d", "A180d" e códigos W/V.
    // Canonicalizar a família sem confundir CLA/GLA/Classe B.
    if(/^(?:classe|class)\s+a(?:\s|$)/.test(mv)||/^a\s*\d{2,3}(?:\s*[a-z]{0,3})?(?:\s|$)/.test(mv))return "classe a";
  }
  if(m==="smart"&&/^(?:fortwo|for two)(?:\s|$)/.test(v))return /\bcabrio\b|\bconvertible\b/.test(v)?"fortwo cabrio":"fortwo";
  if(m==="bmw"){
    const is4=/\bserie 4\b|\bseries 4\b|\b4\d{2}[a-z]{0,2}\b/.test(v);
    if(is4&&/\bgran coupe\b/.test(v))return "serie 4 gran coupe";
    if(is4&&/\bcabrio\b|\bconvertible\b/.test(v))return "serie 4 cabrio";
    if(is4&&/\bcoupe\b/.test(v))return "serie 4 coupe";
  }
  return v;
}

function modelFamilyKey(make,model){
  const m=norm(make);
  let v=modelKey(make,model);
  if(!v)return "";

  // Famílias com sintaxe própria: são tratadas antes do fallback genérico.
  if(["mercedes","mercedes benz","mercedes-benz","mercedesbenz"].includes(m))return v;

  if(m==="tesla"){
    const hit=v.match(/^model\s*([3sxy])(?:\s|$)/);
    if(hit)return "model "+hit[1];
  }

  if(m==="bmw"){
    const series=v.match(/\b(?:serie|series)\s*([1-8])\b/);
    const derivative=v.match(/\b([1-8])\d{2}(?:xe|xd|xi|d|i|e)?\b/);
    const n=series?.[1]||derivative?.[1];
    if(n){
      if(/\bactive tourer\b/.test(v))return "serie "+n+" active tourer";
      if(/\bgran tourer\b/.test(v))return "serie "+n+" gran tourer";
      if(/\bgran coupe\b/.test(v))return "serie "+n+" gran coupe";
      if(/\bgt\b|\bgran turismo\b/.test(v))return "serie "+n+" gt";
      if(/\bcabrio\b|\bconvertible\b/.test(v))return "serie "+n+" cabrio";
      if(/\bcoupe\b/.test(v))return "serie "+n+" coupe";
      if(/\btouring\b|\bestate\b|\bbreak\b/.test(v))return "serie "+n+" touring";
      return "serie "+n;
    }
    const x=v.match(/^x\s*([1-7])(?:\s|$)/);
    if(x)return "x"+x[1];
    const ix=v.match(/^i\s*(3|4|5|7|8|x\d?)(?:\s|$)/);
    if(ix)return "i"+ix[1];
  }

  if(m==="audi"){
    const hit=v.replace(/[-_]+/g," ").match(/^(rs|a|q|s)\s*([1-8])(?:\s|$)/);
    if(hit)return hit[1]+hit[2];
    if(/^tt(?:\s|$)/.test(v))return "tt";
    if(/^r8(?:\s|$)/.test(v))return "r8";
  }

  if(m==="volkswagen"||m==="vw"){
    const id=v.match(/^id\s*(3|4|5|7|buzz)(?:\s|$)/);
    if(id)return "id "+id[1];
  }

  if(m==="mazda"){
    const hit=v.replace(/[-_]+/g," ").match(/^(cx|mx)\s*(3|5|30|50|60|80|90)(?:\s|$)/);
    if(hit)return hit[1]+hit[2];
    const mazda=v.match(/^mazda\s*([236])(?:\s|$)/);
    if(mazda)return "mazda "+mazda[1];
  }

  if(m==="volvo"){
    const hit=v.replace(/[-_]+/g," ").match(/^(xc|ex|ec|v|s|c)\s*(30|40|60|70|90)(?:\s|$)/);
    if(hit)return hit[1]+hit[2];
  }

  // Fallback: conservar o nome comercial e cortar apenas o que claramente
  // parece motorização, geração, caixa, nível de equipamento ou carroçaria.
  // Isto cobre formatos como "Kona 1.6 Hybrid", "Qashqai J11 1.5 dCi",
  // "3008 1.5 BlueHDi", "Golf VII 2.0 TDI" ou "Focus Mk4".
  const tokens=v.replace(/[-_/]+/g," ").replace(/\s+/g," ").trim().split(" ").filter(Boolean);
  const stopWord=new Set([
    "tdi","tsi","tfsi","dci","hdi","bluehdi","crdi","cdi","cdti","multijet",
    "puretech","ecoboost","hybrid","hibrido","phev","electric","electrico","ev",
    "automatic","automatica","auto","manual","dsg","edc","cvt","steptronic",
    "business","style","premium","progressive","executive","comfort","allure","active",
    "edition","pack","trend","line","luxury","sport","sportback","variant","touring",
    "estate","break","sw","coupe","cabrio","convertible"
  ]);
  const out=[];
  for(const token of tokens){
    const compact=token.replace(/[^a-z0-9.]/g,"");
    const engineNumber=/^\d+(?:\.\d+)?$/.test(compact)&&out.length>0;
    const generation=/^(?:mk\d+|gen\d+|[ivx]{1,4}|[a-z]{1,2}\d{2,3})$/.test(compact)&&out.length>0;
    const power=/^\d{2,3}(?:cv|hp|kw)$/.test(compact)&&out.length>0;
    if(out.length&&(engineNumber||generation||power||stopWord.has(compact)))break;
    out.push(token);
    if(out.length>=3)break;
  }
  return out.join(" ")||v;
}

function modelMatchLevel(s,c){
  s=normalizeVehicleIdentity(s);c=normalizeVehicleIdentity(c);
  if(!known(s?.model)||!known(c?.model))return 0;
  // Na BMW, códigos como 225xe/225e ou 118d/118i identificam
  // derivativos tecnicamente distintos. A família pode orientar a pesquisa,
  // mas nunca transformar dois derivativos explícitos diferentes no mesmo modelo.
  if(norm(s.make)==="bmw"&&norm(c.make)==="bmw"){
    const sa=derivativeCode(s),cb=derivativeCode(c);
    if(sa&&cb&&sa!==cb)return 0;
    const bare=v=>/^\d{3}$/.test(norm(v?.model).replace(/\s+/g,""));
    if((sa&&!cb&&bare(c))||(cb&&!sa&&bare(s)))return 0;
  }
  const a=modelKey(s.make,s.model),b=modelKey(c.make,c.model);
  if(a===b)return 2;
  const addedVersion=(short,long)=>short.length>=3&&long.startsWith(short+" ")
    &&/^(?:\d|hybrid\b|hibrid\b|phev\b|crdi\b|tdi\b|bluehdi\b|puretech\b|prime\b|premium\b|style\b|comfort\b|edition\b|pack\b|trend\b|executive\b|n line\b|gt line\b|automatic\b|2wd\b|awd\b)/.test(long.slice(short.length+1));
  if(addedVersion(a,b)||addedVersion(b,a))return 2;
  const fa=modelFamilyKey(s.make,s.model),fb=modelFamilyKey(c.make,c.model);
  return fa&&fb&&fa===fb?1:0;
}

// Compatibilidade binária usada pelos gates antigos; a pontuação distingue
// correspondência exata (2) de apenas família comercial (1).
const sameModel=(s,c)=>modelMatchLevel(s,c)>0;

// Navigation must retain the published host, path, query and fragment. In
// particular, PiscaPisca's apex host redirects every path to the homepage.
// Repair that known legacy host without guessing missing listing identifiers.
function listingUrl(raw){
  try{
    const u=new URL(raw);
    if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return null;
    if(u.hostname==="piscapisca.pt")u.hostname="www.piscapisca.pt";
    return u.toString();
  }catch{return null}
}

// Comparison key only: never use this normalized value as a navigation URL.
function canonicalUrl(raw){
  try{
    const u=new URL(raw);
    if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return null;
    u.hash="";
    u.hostname=u.hostname.replace(/^www\./i,"").toLowerCase();
    for(const key of [...u.searchParams.keys()]){
      if(/^(utm_.+|fbclid|gclid|ref|referrer|source)$/i.test(key))u.searchParams.delete(key);
    }
    u.searchParams.sort();
    u.pathname=(u.pathname.replace(/\/+$/,"")||"/");
    return u.toString();
  }catch{return null}
}

function vehicleFingerprint(c){
  if(known(c?.vin))return "vin:"+norm(c.vin);
  if(known(c?.registration))return "plate:"+norm(c.registration).replace(/[^a-z0-9]/g,"");
  const keys=["make","model","trim","year","mileage_km","price"];
  if(!keys.every(k=>known(c?.[k])))return null;
  // Same specs are not proof that two independent dealers sell the same car.
  const seller=norm(c.seller_id||c.seller_name);
  if(!seller)return null;
  return "seller:"+seller+"|"+keys.map(k=>k==="model"?modelKey(c.make,c.model):norm(c[k])).join("|");
}

function monthIndex(v){
  if(!v)return null;
  const d=new Date(v);
  return Number.isNaN(d.getTime())?null:d.getUTCFullYear()*12+d.getUTCMonth();
}

function ageDelta(subject,comp){
  // A primeira matrícula portuguesa pode ser vários anos posterior ao fabrico,
  // especialmente num importado. Não serve como idade real da viatura.
  const ageMonth=vehicle=>{
    const month=monthIndex(vehicle.first_registration);
    if(month===null)return null;
    if(known(vehicle.year)&&Math.abs(Math.floor(month/12)-num(vehicle.year))>1)return null;
    return month;
  };
  const a=ageMonth(subject),b=ageMonth(comp);
  if(a!==null&&b!==null)return a-b;
  return known(subject.year)&&known(comp.year)?(num(subject.year)-num(comp.year))*12:0;
}

function equipmentSimilarity(a,b){
  const A=new Set(Array.isArray(a)?a.map(norm).filter(Boolean):[]);
  const B=new Set(Array.isArray(b)?b.map(norm).filter(Boolean):[]);
  if(!A.size||!B.size)return 0;
  const intersection=[...A].filter(x=>B.has(x)).length;
  return intersection/new Set([...A,...B]).size;
}

function trimSimilarity(a,b){
  if(!known(a)||!known(b))return 0;
  const A=norm(a),B=norm(b);
  if(A===B)return 1;
  if(A.length>=3&&B.length>=3&&(A.includes(B)||B.includes(A)))return 1;

  const tokens=v=>new Set(v.split(/[^a-z0-9]+/).filter(x=>x.length>=2));
  const ta=tokens(A),tb=tokens(B);
  if(!ta.size||!tb.size)return 0;
  const common=[...ta].filter(x=>tb.has(x)).length;
  const union=new Set([...ta,...tb]).size;
  const overlap=common/union;

  const code=v=>v.match(/\b\d{3}[a-z]{0,2}\b/i)?.[0]||null;
  const ca=code(A),cb=code(B);
  if(ca&&cb&&ca===cb)return Math.max(.9,overlap);
  return overlap;
}

function derivativeCode(v){
  const model=norm(v?.model),trim=norm(v?.trim);
  const joined=(model+" "+trim).trim().replace(/\b([1-8]\d{2})\s+(xe|xd|xi|d|i|e)\b/g,"$1$2");
  const direct=joined.match(/\b([1-8]\d{2})([a-z]{1,2})\b/);
  if(direct)return direct[1]+direct[2];
  const base=model.match(/\b([1-8]\d{2})\b/);
  const suffix=trim.match(/^([die])\b/);
  if(base&&suffix)return base[1]+suffix[1];
  return null;
}

function variantSimilarity(s,c){
  const a=derivativeCode(s),b=derivativeCode(c);
  if(a&&b&&a===b)return 1;
  return trimSimilarity(s?.trim,c?.trim);
}

function hardExclusion(s,c){
  if(!same(s.make,c.make))return "marca diferente ou desconhecida";
  if(!sameModel(s,c))return "modelo diferente ou desconhecido";
  if(known(s.fuel)&&known(c.fuel)&&fuel(s.fuel)!==fuel(c.fuel))return "combustível diferente";
  if(s.commercial_identity?.drivetrain_conflict||c.commercial_identity?.drivetrain_conflict)return "tração contraditória na identificação";
  if(known(s.generation)&&known(c.generation)&&!same(s.generation,c.generation))return "geração incompatível";
  if(known(s.drivetrain)&&known(c.drivetrain)&&canonicalDrive(s.drivetrain)!==canonicalDrive(c.drivetrain))return "tração incompatível";
  if(norm(s.make)==="tesla"&&s.commercial_identity?.variant&&c.commercial_identity?.variant
    &&s.commercial_identity.variant!==c.commercial_identity.variant)return "versão elétrica incompatível";
  if(known(s.year)&&known(c.year)&&Math.abs(num(s.year)-num(c.year))>5)return "ano demasiado distante";
  if(known(s.mileage_km)&&known(c.mileage_km)&&Math.abs(num(s.mileage_km)-num(c.mileage_km))>150000)return "quilometragem demasiado distante";
  if(known(s.battery_kwh)&&known(c.battery_kwh)&&Math.abs(num(s.battery_kwh)-num(c.battery_kwh))>=12)return "bateria incompatível";
  if(powerDiscrepancy(s,c)&&!toleratedPowerDifference(s,c))return "potência incompatível";
  return null;
}

function similarity(s,c){
  s=normalizeVehicleIdentity(s);c=normalizeVehicleIdentity(c);
  let score=0,total=0;
  const add=(weight,value)=>{total+=weight;score+=weight*clamp(value,0,1)};

  const modelLevel=modelMatchLevel(s,c);
  add(25,same(s.make,c.make)?(modelLevel===2?1:modelLevel===1?.78:0):0);
  if(known(s.trim)&&known(c.trim))add(18,variantSimilarity(s,c));
  if(known(s.generation)&&known(c.generation))add(7,same(s.generation,c.generation)?1:0);
  if(known(s.fuel)&&known(c.fuel))add(10,fuel(s.fuel)===fuel(c.fuel)?1:0);
  if(known(s.year)&&known(c.year))add(14,1-Math.abs(num(s.year)-num(c.year))/4);
  if(known(s.mileage_km)&&known(c.mileage_km))add(14,1-Math.abs(num(s.mileage_km)-num(c.mileage_km))/90000);
  if(known(s.power_cv)&&known(c.power_cv))add(5,1-Math.abs(num(s.power_cv)-num(c.power_cv))/120);
  if(known(s.drivetrain)&&known(c.drivetrain))add(4,same(s.drivetrain,c.drivetrain)?1:0);
  if(known(s.transmission)&&known(c.transmission))add(6,same(s.transmission,c.transmission)?1:0);
  if(known(s.vat_deductible)&&known(c.vat_deductible))add(2,s.vat_deductible===c.vat_deductible?1:0);
  const equip=equipmentSimilarity(s.equipment,c.equipment);
  if(equip>0)add(1,equip);

  if(!total)return 0;
  const completeness=total/100;
  const normalized=score/total;
  return Math.round(clamp(normalized*(.45+.55*completeness),0,1)*1000)/10;
}

function adjustedPrice(s,c,config){
  let p=num(c.price);
  if(known(c.mileage_km)&&known(s.mileage_km))p+=(num(c.mileage_km)-num(s.mileage_km))/1000*config.kmAdjustmentPer1000;
  p+=ageDelta(s,c)*config.ageAdjustmentPerMonth;
  // A coarse age/km model must never overwhelm the observed price.
  const maxPct=clamp(num(config.maxAdjustmentPct,.25),0,.5),base=num(c.price);
  return Math.round(clamp(p,Math.max(1,base*(1-maxPct)),base*(1+maxPct)));
}

function quantile(values,p){
  const a=[...values].filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return NaN;
  const pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);
  return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);
}

function weightedMedian(rows){
  const a=[...rows].sort((x,y)=>x.value-y.value);
  const total=a.reduce((s,x)=>s+x.weight,0);
  let acc=0;
  for(const x of a){acc+=x.weight;if(acc>=total/2)return x.value}
  return a.at(-1)?.value??NaN;
}


function selectEligibleComparables(subject,comparables,custom={}){
  const config={minSimilarity:52,kmAdjustmentPer1000:20,ageAdjustmentPerMonth:55,...custom};
  const original=normalizeVehicleIdentity(subject||{});
  // Estimated km describe the cohort, never select or weight their own cohort.
  const s=original.mileage_estimated?{...original,mileage_km:null}:original;
  const input={comparables,source_url:custom.source_url};
  const rows=[],excluded=[],nearMatches=[],wideMatches=[],seenUrls=new Set(),seenFingerprints=new Set();
  const sourceUrl=canonicalUrl(custom.source_url),subjectFp=vehicleFingerprint(s);
  const evidenceQuality=c=>(c?.evidence?.verified===true?100:0)+(sellerType(c)==="professional"?10:0)+(c?.evidence?.source_url_verified===true?2:0);
  // Retain the strongest observation when a portal listing was discovered twice.
  const ordered=[...(input.comparables||[])].sort((a,b)=>evidenceQuality(b)-evidenceQuality(a));
  for(const raw of ordered){
    const c=normalizeVehicleIdentity(raw);
    if(c.price_conditioned===true&&num(c.cash_price)>0)c.price=num(c.cash_price);
    let reason=null;
    const url=canonicalUrl(c.url),destination=listingUrl(c.url);
    const fp=vehicleFingerprint(c);

    if(!(num(c.price)>0))reason="preço inválido";
    else if(!url)reason="URL inválido";
    else if(sourceUrl&&url===sourceUrl)reason="própria viatura";
    else if(subjectFp&&fp===subjectFp)reason="própria viatura / anúncio replicado";
    else if(seenUrls.has(url)||(fp&&seenFingerprints.has(fp)))reason="mesma viatura / anúncio duplicado";
    else reason=commercialExclusion(c)||hardExclusion(s,c);

    const sim=reason?0:similarity(s,c);
    const closeVariant=!reason
      &&same(s.make,c.make)
      &&sameModel(s,c)
      &&(!known(s.fuel)||!known(c.fuel)||fuel(s.fuel)===fuel(c.fuel))
      &&(!known(s.trim)||!known(c.trim)||variantSimilarity(s,c)>=.9)
      &&(!known(s.year)||!known(c.year)||Math.abs(num(s.year)-num(c.year))<=1);
    const similarityFloor=closeVariant?50:config.minSimilarity;
    if(!reason&&sim<similarityFloor)reason="dados insuficientes ou semelhança insuficiente ("+sim+"%)";

    // Escalões progressivos: modelo e combustível compatíveis, anúncio real em PT.
    if(reason?.startsWith("dados insuficientes ou semelhança insuficiente")
      &&c.country==="PT"&&c.price_basis==="gross"
      &&known(s.year)&&known(c.year)&&known(s.fuel)&&known(c.fuel)
      &&fuel(s.fuel)===fuel(c.fuel)){
      const yearDelta=Math.abs(num(s.year)-num(c.year));
      const match={comp:{...c,url:destination},similarity:sim,adjustedPrice:adjustedPrice(s,c,config),fingerprint:fp};
      if(sim>=40&&yearDelta<=3)nearMatches.push(match);
      else if(sim>=20&&yearDelta<=5)wideMatches.push(match);
    }
    if(reason){
      excluded.push({label:c.label||c.trim||"Comparável",url:c.url||null,reason,comp:c});
      continue;
    }

    seenUrls.add(url);
    if(fp)seenFingerprints.add(fp);
    rows.push({comp:{...c,url:destination},similarity:sim,adjustedPrice:adjustedPrice(s,c,config)});
  }

  let broadenedMarket=false,searchTier=1;
  if(!rows.length&&(nearMatches.length||wideMatches.length)){
    const candidatePool=nearMatches.length?nearMatches:wideMatches;
    searchTier=nearMatches.length?2:3;
    const fallbackUrls=new Set(),fallbackFingerprints=new Set();
    for(const match of [...candidatePool].sort((a,b)=>b.similarity-a.similarity)){
      const url=canonicalUrl(match.comp.url),fp=match.fingerprint;
      if(fallbackUrls.has(url)||(fp&&fallbackFingerprints.has(fp)))continue;
      fallbackUrls.add(url);if(fp)fallbackFingerprints.add(fp);
      rows.push({comp:match.comp,similarity:match.similarity,adjustedPrice:match.adjustedPrice});
    }
    broadenedMarket=rows.length>0;
    if(broadenedMarket){
      for(let i=excluded.length-1;i>=0;i--){
        if(excluded[i].reason?.startsWith("dados insuficientes ou semelhança insuficiente")
          &&fallbackUrls.has(canonicalUrl(excluded[i].url)))excluded.splice(i,1);
      }
    }
  }

  const professionalRows=rows.filter(r=>sellerType(r.comp)==="professional");
  const nonPrivateRows=rows.filter(r=>sellerType(r.comp)!=="private");
  let marketBasis="private_reference",basisRows=rows;
  if(professionalRows.length){
    marketBasis="professional";
    basisRows=professionalRows;
    for(const r of rows){
      if(sellerType(r.comp)!=="professional")excluded.push({
        label:r.comp.label||r.comp.trim||"Comparável",
        url:r.comp.url||null,
        reason:sellerType(r.comp)==="private"?"anúncio particular — fora da referência profissional":"vendedor não confirmado — fora da referência profissional",
        comp:r.comp
      });
    }
  }else if(nonPrivateRows.length){
    marketBasis="seller_unconfirmed";
    basisRows=nonPrivateRows;
    for(const r of rows){
      if(sellerType(r.comp)==="private")excluded.push({label:r.comp.label||"Comparável",url:r.comp.url||null,reason:"anúncio particular — referência secundária",comp:r.comp});
    }
  }

  let valid=basisRows;
  if(valid.length>=5){
    const q1=quantile(valid.map(r=>r.adjustedPrice),.25),q3=quantile(valid.map(r=>r.adjustedPrice),.75),iqr=q3-q1;
    const lo=q1-1.5*iqr,hi=q3+1.5*iqr;
    valid=valid.filter(r=>{
      const ok=r.adjustedPrice>=lo&&r.adjustedPrice<=hi;
      if(!ok)excluded.push({label:r.comp.label||"Comparável",url:r.comp.url||null,reason:"outlier de preço",comp:r.comp});
      return ok;
    });
  }


  return {subject:original,rows:valid.map(r=>({...r,adjustedPrice:adjustedPrice(original,r.comp,config),powerDiscrepancy:powerDiscrepancy(s,r.comp)})),excluded,broadenedMarket,searchTier:valid.length?searchTier:0,marketBasis:valid.length?marketBasis:"none"};
}
return {normalizeVehicleIdentity,selectEligibleComparables,canonicalUrl,listingUrl,sameModel,modelFamilyKey,modelMatchLevel,similarity,canonicalFuel:fuel,canonicalDrive,explicitVariantMatch,derivativeCode};
});
