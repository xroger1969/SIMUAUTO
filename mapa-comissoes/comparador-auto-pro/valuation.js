export const ENGINE_VERSION="2026-10-04-purchase-first-v2";

export const DEFAULT_CONFIG=Object.freeze({
  minSimilarity:62,
  minVerifiedProfessionals:3,
  targetMargin:3500,
  minimumMargin:1200,
  auctionImportCost:1200,
  negotiationDiscountPct:.02,
  fastSaleDiscountPct:.035,
  riskReservePct:.006,
  kmAdjustmentPer1000:20,
  ageAdjustmentPerMonth:55,
  maxEvidenceAgeDays:7
});

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
  "hibrido plug-in":"phev","plug-in hybrid":"phev",phev:"phev"
}[norm(v)]||norm(v));
const sellerType=c=>{
  const t=norm(c?.seller_type||c?.sellerType);
  if(["professional","dealer","stand","trade"].includes(t))return "professional";
  if(["private","particular"].includes(t))return "private";
  return "unknown";
};

function modelKey(make,model){
  const m=norm(make),v=norm(model);
  if(!v)return "";
  if(m==="bmw"){
    const is4=/\bserie 4\b|\bseries 4\b|\b4\d{2}[a-z]{0,2}\b/.test(v);
    if(is4&&/\bgran coupe\b/.test(v))return "serie 4 gran coupe";
    if(is4&&/\bcabrio\b|\bconvertible\b/.test(v))return "serie 4 cabrio";
    if(is4&&/\bcoupe\b/.test(v))return "serie 4 coupe";
  }
  return v;
}
const sameModel=(s,c)=>known(s?.model)&&known(c?.model)&&modelKey(s.make,s.model)===modelKey(c.make,c.model);

export function canonicalUrl(raw){
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
  return keys.map(k=>norm(c[k])).join("|");
}

function monthIndex(v){
  if(!v)return null;
  const d=new Date(v);
  return Number.isNaN(d.getTime())?null:d.getUTCFullYear()*12+d.getUTCMonth();
}

function ageDelta(subject,comp){
  const a=monthIndex(subject.first_registration),b=monthIndex(comp.first_registration);
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
  const model=norm(v?.model),trim=norm(v?.trim),joined=(model+" "+trim).trim();
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
  if(known(s.generation)&&known(c.generation)&&!same(s.generation,c.generation))return "geração diferente";
  if(known(s.drivetrain)&&known(c.drivetrain)&&!same(s.drivetrain,c.drivetrain))return "tração diferente";
  if(known(s.transmission)&&known(c.transmission)&&!same(s.transmission,c.transmission))return "caixa diferente";
  if(known(s.battery_kwh)&&known(c.battery_kwh)&&Math.abs(num(s.battery_kwh)-num(c.battery_kwh))>=12)return "bateria incompatível";
  if(known(s.power_cv)&&known(c.power_cv)&&Math.abs(num(s.power_cv)-num(c.power_cv))>Math.max(45,num(s.power_cv)*.25))return "potência incompatível";
  return null;
}

export function similarity(s,c){
  let score=0,total=0;
  const add=(weight,value)=>{total+=weight;score+=weight*clamp(value,0,1)};

  add(25,same(s.make,c.make)&&sameModel(s,c)?1:0);
  if(known(s.trim)&&known(c.trim))add(18,variantSimilarity(s,c));
  if(known(s.generation)&&known(c.generation))add(7,same(s.generation,c.generation)?1:0);
  if(known(s.fuel)&&known(c.fuel))add(10,fuel(s.fuel)===fuel(c.fuel)?1:0);
  if(known(s.year)&&known(c.year))add(14,1-Math.abs(num(s.year)-num(c.year))/4);
  if(known(s.mileage_km)&&known(c.mileage_km))add(14,1-Math.abs(num(s.mileage_km)-num(c.mileage_km))/90000);
  if(known(s.power_cv)&&known(c.power_cv))add(5,1-Math.abs(num(s.power_cv)-num(c.power_cv))/120);
  if(known(s.drivetrain)&&known(c.drivetrain))add(4,same(s.drivetrain,c.drivetrain)?1:0);
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
  return Math.round(p);
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

function recentEvidence(c,config){
  if(c?.evidence?.verified!==true)return false;
  if(sellerType(c)!=="professional")return false;
  if(c.country!=="PT"||c.price_basis!=="gross"||c.availability!=="available")return false;
  const observed=Date.parse(c?.evidence?.observed_at||c?.observed_at||"");
  if(!Number.isFinite(observed))return false;
  return Date.now()-observed<=config.maxEvidenceAgeDays*86400000 && Date.now()-observed>=-3600000;
}

function subjectMissing(s){
  return ["make","model","trim","year","mileage_km","fuel"].filter(k=>!known(s[k]));
}

function sourceHost(raw){
  try{return new URL(raw).hostname.replace(/^www\./i,"").toLowerCase()}catch{return ""}
}

export function resolveAcquisitionContext(input,config=DEFAULT_CONFIG){
  const host=sourceHost(input?.source_url);
  if(host==="standvirtual.com"||host.endsWith(".standvirtual.com")){
    return {isAuction:false,vehicleLocation:"PT",priceRole:"asking_price",importCost:0,needsLocationConfirmation:false,reason:"standvirtual_pt"};
  }

  const supplied=input?.source_context&&typeof input.source_context==="object"?input.source_context:{};
  let isAuction=supplied.is_auction===true?true:supplied.is_auction===false?false:null;
  if(host==="auto1.com"||host.endsWith(".auto1.com"))isAuction=true;

  const vehicleLocation=["PT","foreign","unknown"].includes(supplied.vehicle_location)?supplied.vehicle_location:"unknown";
  if(isAuction!==true){
    return {isAuction,vehicleLocation,priceRole:"asking_price",importCost:0,needsLocationConfirmation:false,reason:isAuction===false?"not_auction":"auction_not_detected"};
  }
  if(vehicleLocation==="PT"){
    return {isAuction:true,vehicleLocation,priceRole:"acquisition_price",importCost:0,needsLocationConfirmation:false,reason:"auction_vehicle_in_pt"};
  }
  if(vehicleLocation==="foreign"){
    return {isAuction:true,vehicleLocation,priceRole:"acquisition_price",importCost:Math.max(0,num(config.auctionImportCost,1200)),needsLocationConfirmation:false,reason:"auction_import"};
  }
  return {isAuction:true,vehicleLocation:"unknown",priceRole:"acquisition_price",importCost:0,needsLocationConfirmation:true,reason:"auction_location_unknown"};
}

export function evaluatePurchase(input,custom={}){
  const config={...DEFAULT_CONFIG,...custom};
  const s=input.subject||{},rows=[],excluded=[],seenUrls=new Set(),seenFingerprints=new Set();
  const sourceUrl=canonicalUrl(input.source_url);
  const subjectFp=vehicleFingerprint(s);

  for(const c of input.comparables||[]){
    let reason=null;
    const url=canonicalUrl(c.url);
    const fp=vehicleFingerprint(c);

    if(!(num(c.price)>0))reason="preço inválido";
    else if(!url)reason="URL inválido";
    else if(sourceUrl&&url===sourceUrl)reason="própria viatura";
    else if(subjectFp&&fp===subjectFp)reason="própria viatura / anúncio replicado";
    else if(seenUrls.has(url)||(fp&&seenFingerprints.has(fp)))reason="mesma viatura / anúncio duplicado";
    else reason=hardExclusion(s,c);

    const sim=reason?0:similarity(s,c);
    const closeVariant=!reason
      &&same(s.make,c.make)
      &&sameModel(s,c)
      &&(!known(s.fuel)||!known(c.fuel)||fuel(s.fuel)===fuel(c.fuel))
      &&(!known(s.trim)||!known(c.trim)||variantSimilarity(s,c)>=.9)
      &&(!known(s.year)||!known(c.year)||Math.abs(num(s.year)-num(c.year))<=1);
    const similarityFloor=closeVariant?55:config.minSimilarity;
    if(!reason&&sim<similarityFloor)reason="dados insuficientes ou semelhança insuficiente ("+sim+"%)";

    if(reason){
      excluded.push({label:c.label||c.trim||"Comparável",url:c.url||null,reason,comp:c});
      continue;
    }

    seenUrls.add(url);
    if(fp)seenFingerprints.add(fp);
    rows.push({comp:{...c,url},similarity:sim,adjustedPrice:adjustedPrice(s,c,config)});
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

  const marketValue=Math.round(weightedMedian(valid.map(r=>({
    value:r.adjustedPrice,
    weight:Math.pow(r.similarity/100,2)*(sellerType(r.comp)==="professional"?1.25:.5)
  }))));
  const saleLikely=Number.isFinite(marketValue)?Math.round(marketValue*(1-num(input.negotiation_discount_pct,config.negotiationDiscountPct))):NaN;
  const saleFast=Number.isFinite(saleLikely)?Math.round(saleLikely*(1-num(input.fast_sale_discount_pct,config.fastSaleDiscountPct))):NaN;

  const verified=valid.filter(r=>recentEvidence(r.comp,config));
  const missing=subjectMissing(s);
  const dispersion=valid.length&&Number.isFinite(marketValue)
    ?Math.max(0,(quantile(valid.map(r=>r.adjustedPrice),.75)-quantile(valid.map(r=>r.adjustedPrice),.25))/(marketValue||1))
    :1;
  const acquisition=resolveAcquisitionContext(input,config);
  const warnings=[];
  if(missing.length)warnings.push("Falta confirmar: "+missing.join(", ")+".");
  if(verified.length<config.minVerifiedProfessionals)warnings.push("Referência provisória: são necessárias pelo menos "+config.minVerifiedProfessionals+" viaturas profissionais distintas e verificadas.");
  if(marketBasis!=="professional")warnings.push("Sem amostra profissional confirmada suficiente.");
  if(dispersion>.25)warnings.push("Dispersão de preços demasiado elevada para emitir um teto de compra.");
  if(valid.some(r=>r.comp.price_basis!=="gross"))warnings.push("Existem preços cuja base com IVA incluído não foi confirmada.");
  if(valid.some(r=>r.comp.country!=="PT"))warnings.push("Existem comparáveis cuja localização em Portugal não foi confirmada.");
  if(acquisition.needsLocationConfirmation)warnings.push("Confirma se esta viatura de leilão já está em Portugal. Só é aplicado o custo adicional de 1 200 € quando a viatura de leilão está fora de Portugal/importada.");

  const identityBlocked=input.valuation_blocked===true||(input.risk_flags||[]).some(r=>r.code==="registration_unconfirmed");
  if(identityBlocked)warnings.push("Confirma a matrícula e a identificação da viatura antes de avaliar.");
  const professionalCount=valid.filter(r=>sellerType(r.comp)==="professional").length;
  const criticalMissing=missing.filter(k=>k==="make"||k==="model");
  const evidenceEligible=!s.mileage_estimated&&Number.isFinite(marketValue)&&!missing.length&&verified.length>=config.minVerifiedProfessionals&&marketBasis==="professional"&&dispersion<=.25;
  const provisionalEligible=!identityBlocked&&!criticalMissing.length&&Number.isFinite(marketValue)&&valid.length>=1&&dispersion<=.45&&!acquisition.needsLocationConfirmation;
  const eligible=!identityBlocked&&evidenceEligible&&!acquisition.needsLocationConfirmation;
  const avgSim=valid.length?valid.reduce((t,r)=>t+r.similarity,0)/valid.length:0;
  const completeness=(6-missing.length)/6;
  const reportedEvidence=valid.filter(r=>r.comp?.evidence?.reported_url===true||r.comp?.evidence?.source_url_verified===true).length;
  const rawConfidence=valid.length
    ?Math.min(95,Math.min((verified.length+reportedEvidence*.35)/8,1)*35+(avgSim/100)*35+(1-clamp(dispersion/.45,0,1))*15+completeness*15)
    :0;
  const provisionalCap=valid.length===1?20:s.mileage_estimated||verified.length===0?39:marketBasis!=="professional"?30:missing.length?45:55;
  const confidencePct=Math.round(Math.min(eligible?95:provisionalCap,rawConfidence));
  if(s.mileage_estimated)warnings.push("Quilómetros estimados pelo mercado do Standvirtual. Indica os quilómetros reais para aumentar a confiança da avaliação.");
  if(!eligible&&provisionalEligible)warnings.unshift("Estimativa indicativa com "+valid.length+" comparável(is) aceite(s)"+(marketBasis!=="professional"?" sem base profissional confirmada":"")+". Baixa confiança: confirmar estado, quilómetros e preços antes de comprar.");

  const tax=input.tax||{},vatRate=num(tax.vat_rate,.23);
  const taxMode=tax.mode==="deductible"?"deductible":"gross";
  const factor=taxMode==="deductible"?1+vatRate:1;
  const saleEconomic=Number.isFinite(saleLikely)?saleLikely/factor:NaN;
  const costs=input.costs||{};
  const baseFixedCosts=["auction_fee","transport","registration","reconditioning","warranty_reserve","stock_finance","other"]
    .reduce((t,k)=>t+Math.max(0,num(costs[k])),0);
  const fixedCosts=baseFixedCosts+acquisition.importCost;
  const riskFlags=(input.risk_flags||[]).reduce((t,r)=>t+Math.max(0,num(r.reserve_eur)),0);
  const riskReserve=Number.isFinite(saleEconomic)?Math.round(Math.max(0,saleEconomic*config.riskReservePct+riskFlags)):0;
  const targetMargin=Math.max(0,num(input.target_margin,config.targetMargin));
  const minimumMargin=Math.max(0,Math.min(targetMargin,num(input.minimum_margin,config.minimumMargin)));

  const computedTargetCeiling=Number.isFinite(saleEconomic)?Math.max(0,Math.floor((saleEconomic-fixedCosts-riskReserve-targetMargin)*factor)):NaN;
  const computedAbsoluteCeiling=Number.isFinite(saleEconomic)?Math.max(0,Math.floor((saleEconomic-fixedCosts-riskReserve-minimumMargin)*factor)):NaN;
  const maxPurchase=eligible?computedTargetCeiling:NaN;
  const absoluteMax=eligible?computedAbsoluteCeiling:NaN;
  const provisionalMaxPurchase=!eligible&&provisionalEligible?computedTargetCeiling:NaN;
  const provisionalAbsoluteMax=!eligible&&provisionalEligible?computedAbsoluteCeiling:NaN;
  const effectiveCeiling=Number.isFinite(maxPurchase)?maxPurchase:provisionalMaxPurchase;
  const currentPrice=num(input.current_purchase_price,NaN);
  const expectedMargin=Number.isFinite(currentPrice)&&Number.isFinite(saleEconomic)
    ?Math.round(saleEconomic-currentPrice/factor-fixedCosts-riskReserve)
    :NaN;
  const marginAtCeiling=Number.isFinite(effectiveCeiling)&&Number.isFinite(saleEconomic)
    ?Math.round(saleEconomic-effectiveCeiling/factor-fixedCosts-riskReserve)
    :NaN;

  let decision=valid.length?"Referência provisória — dados por confirmar":"sem dados";
  if(acquisition.needsLocationConfirmation)decision="Confirmar se a viatura de leilão já está em Portugal";
  else if(eligible){
    if(!Number.isFinite(currentPrice))decision="Teto estimado — indica o preço de compra";
    else if(currentPrice<=maxPurchase*.97)decision="compra muito interessante";
    else if(currentPrice<=maxPurchase)decision="boa compra";
    else if(currentPrice<=absoluteMax)decision="comprar só com justificação";
    else decision="não comprar";
  }else if(provisionalEligible){
    if(!Number.isFinite(currentPrice))decision="Teto provisório — confirmar evidência";
    else if(currentPrice<=provisionalMaxPurchase)decision="Teto provisório — preço dentro do alvo; confirmar evidência";
    else decision="Teto provisório — preço acima do alvo; confirmar evidência";
  }

  return {
    engine_version:ENGINE_VERSION,
    subject:s,
    market:{
      comparablesReceived:(input.comparables||[]).length,
      comparablesUsed:valid.length,
      comparablesExcluded:excluded.length,
      professionalComparables:valid.filter(r=>sellerType(r.comp)==="professional").length,
      verifiedProfessionals:verified.length,
      privateComparables:valid.filter(r=>sellerType(r.comp)==="private").length,
      unknownSellerComparables:valid.filter(r=>sellerType(r.comp)==="unknown").length,
      marketBasis,marketValue,saleLikely,saleFast,confidencePct
    },
    purchase:{
      currentPrice,
      fixedCosts:Math.round(fixedCosts),
      baseFixedCosts:Math.round(baseFixedCosts),
      importCost:Math.round(acquisition.importCost),
      needsLocationConfirmation:acquisition.needsLocationConfirmation,
      acquisition,
      riskReserve,
      targetMargin,
      minimumMargin,
      maxPurchase,
      absoluteMax,
      provisionalMaxPurchase,
      provisionalAbsoluteMax,
      effectiveCeiling,
      provisionalEligible,
      expectedMargin,
      marginAtCeiling,
      decision,
      eligible
    },
    tax:{mode:taxMode,vatRate},
    parameters:{...config,costs:{...costs},source_context:{...(input.source_context||{})},acquisition},
    comparables:valid.sort((a,b)=>b.similarity-a.similarity).map(r=>({...r.comp,similarity:r.similarity,adjustedPrice:r.adjustedPrice,seller_type:sellerType(r.comp)})),
    excluded,
    warnings
  };
}
