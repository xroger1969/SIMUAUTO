export const ENGINE_VERSION="2026-10-17-progressive-quote-v4";

export const DEFAULT_CONFIG=Object.freeze({
  minSimilarity:52,
  minVerifiedProfessionals:2,
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

// Item prices are gross EUR. Use the high end for buying; keep both ends visible.
export function estimateReconditioning(report={},settings={},subject={},minimum=0,taxMode="gross",vatRate=.23){
  const paintMin=Math.max(0,num(settings.paint_min_eur,80));
  const paintMax=Math.max(paintMin,num(settings.paint_max_eur,100));
  const mode=settings.paint_mode==="trade"?"trade":"web";
  const overrides=settings.overrides||{};
  const byComponent=new Map(),notes=[];
  const componentKey=v=>norm(v).replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
  const electric=fuel(subject.fuel)==="electric";
  const range=(a,b)=>known(a)&&Number.isFinite(Number(a))&&Number(a)>=0&&(!known(b)||(Number.isFinite(Number(b))&&Number(b)>=Number(a)))?[Number(a),known(b)?Number(b):Number(a)]:null;
  const genericKey=v=>/^(front|rear|left|right|interior|frente|traseira|esquerdo|direito|carrocaria|body|unknown|desconhecido)$/.test(v);
  const zone=v=>/^left/.test(v)?"left":/^right/.test(v)?"right":/^(front|bonnet)/.test(v)?"front":/^(rear|boot)/.test(v)?"rear":null;
  const findings=(Array.isArray(report?.findings)?report.findings:[]).slice(0,30);
  const detailedZones=new Set(findings.filter(f=>f?.status==="confirmed"&&["paint","body"].includes(f.category)&&!genericKey(componentKey(f.component))).map(f=>zone(componentKey(f.component))).filter(Boolean));
  const priority={inspect:0,diagnose:1,polish:2,paint:3,service:3,repair:4,repair_and_paint:5,replace:6};
  for(const f of findings){
    if(!f?.evidence||!f.component||f.status==="ok")continue;
    if(electric&&f.category==="maintenance"&&/engine_oil|oil_filter|fuel_filter|timing_belt|oleo.{0,8}motor|filtro.{0,8}(oleo|combustivel)|correia.{0,8}distribuicao/.test(componentKey(f.component+" "+f.label))){
      notes.push("Manutenção de motor de combustão excluída: esta viatura é elétrica.");continue;
    }
    const key=componentKey(f.component);
    // Technician-marked zones carry a minimum repair budget, without inventing panel counts.
    const generic=genericKey(key);
    const marked=f.technician_marked===true;
    if(generic&&marked&&detailedZones.has(key)){notes.push("Zona "+key+" já orçamentada nos painéis identificados; não foi somada novamente.");continue;}
    const provisionalZone=generic&&marked;
    const confirmed=f.status==="confirmed"&&(!generic||marked);
    const diagnostic=f.action==="diagnose"&&f.status==="suspected"&&!generic;
    let low=null,high=null,partial=false,basis="unpriced",source=null,parts=null,labour=null;
    const quantity=["paint","polish","repair_and_paint"].includes(f.action)?1:Math.max(1,Math.min(8,Math.trunc(num(f.quantity,1))));
    const c=f.cost||{};
    if(confirmed||diagnostic){
      if(known(overrides[key])&&Number.isFinite(Number(overrides[key]))&&Number(overrides[key])>=0&&Number(overrides[key])<=100000){
        low=high=Number(overrides[key]);basis="manual";
      }else if(f.action==="paint"&&["paint","body"].includes(f.category)&&mode==="trade"){
        low=paintMin;high=paintMax;basis="trade";
      }else if(c.source_verified===true&&c.source_url&&["gross","net"].includes(c.price_basis)){
        parts=range(c.parts_min_eur,c.parts_max_eur);labour=range(c.labour_min_eur,c.labour_max_eur);
        if(parts||labour){
          const vat=c.price_basis==="net"?1+vatRate:1;
          low=((parts?.[0]||0)+(labour?.[0]||0))*quantity*vat;
          high=((parts?.[1]||0)+(labour?.[1]||0))*quantity*vat;
          partial=!parts||!labour||(parts&&!known(c.parts_max_eur))||(labour&&!known(c.labour_max_eur));basis="web";source=c.source_url;
        }
      }
    }
    if(confirmed&&f.action==="paint"&&["paint","body"].includes(f.category)&&high===null){low=paintMin;high=paintMax;basis="fallback";partial=true;}
    const fromPrice=basis==="web"&&((parts&&!known(c.parts_max_eur))||(labour&&!known(c.labour_max_eur)));
    if(provisionalZone&&basis!=="manual")partial=true;
    const pendingReason=provisionalZone&&basis!=="manual"?"Dano confirmado pelo técnico; mínimo de uma intervenção nesta zona, com painéis exatos por confirmar.":fromPrice?"Preço publicado desde este valor; a fonte não confirma um máximo.":basis==="fallback"?"Hipótese provisória de 80–100 €; não foi encontrado preço publicado aplicável.":partial?"Orçamento incompleto: falta preço de peças ou de mão de obra.":"";
    const row={key,label:f.label||f.component,category:f.category,action:f.action,status:generic&&!marked?"unassessed":f.status,technicianMarked:marked,provisionalZone,pendingReason,fromPrice,
      evidence:f.evidence,sourceImage:f.source_image||null,quantity,low,high,partial,basis,source,
      sourceTitle:c.source_title||"",observedAt:c.observed_at||null,fitmentNote:c.fitment_note||"",parts,labour,
      safetyCritical:f.safety_critical===true};
    const previous=byComponent.get(key);
    // Multiple scratches and overlapping photos on one panel are one intervention.
    if(!previous||(priority[row.action]||0)>(priority[previous.action]||0)
      ||((priority[row.action]||0)===(priority[previous.action]||0)&&num(row.high,-1)>num(previous.high,-1)))byComponent.set(key,row);
  }
  const items=[...byComponent.values()];
  const estimatedMin=items.reduce((t,x)=>t+num(x.low),0),estimatedMax=items.reduce((t,x)=>t+num(x.high),0);
  const unpriced=items.filter(x=>x.high===null||x.partial).length;
  const grossFloor=Math.max(0,num(minimum))*(taxMode==="deductible"?1+vatRate:1);
  const appliedGross=Math.max(grossFloor,estimatedMax);
  const appliedEconomic=taxMode==="deductible"?appliedGross/(1+vatRate):appliedGross;
  return {items,estimatedMin,estimatedMax,unpriced,hasUnpriced:unpriced>0,
    assessed:report?.assessed===true,minimumGross:grossFloor,appliedGross,appliedEconomic,
    hasCriticalUnpriced:items.some(x=>x.safetyCritical&&(x.high===null||x.partial||x.status!=="confirmed")),
    paintMin,paintMax,paintMode:mode,notes:[...new Set(notes)]};
}

function modelKey(make,model){
  const m=norm(make),v=norm(model);
  if(!v)return "";
  if(m==="smart"&&/^(?:fortwo|for two)(?:\s|$)/.test(v))return /\bcabrio\b|\bconvertible\b/.test(v)?"fortwo cabrio":"fortwo";
  if(m==="bmw"){
    const is4=/\bserie 4\b|\bseries 4\b|\b4\d{2}[a-z]{0,2}\b/.test(v);
    if(is4&&/\bgran coupe\b/.test(v))return "serie 4 gran coupe";
    if(is4&&/\bcabrio\b|\bconvertible\b/.test(v))return "serie 4 cabrio";
    if(is4&&/\bcoupe\b/.test(v))return "serie 4 coupe";
  }
  return v;
}
// Os portais por vezes colocam a cilindrada/versão no campo «modelo».
// Aceitar essa extensão sem confundir famílias comerciais distintas.
const sameModel=(s,c)=>{
  if(!known(s?.model)||!known(c?.model))return false;
  const a=modelKey(s.make,s.model),b=modelKey(c.make,c.model);
  if(a===b)return true;
  const addedVersion=(short,long)=>short.length>=3&&long.startsWith(short+" ")
    &&/^(?:\d|hybrid\b|hibrid\b|phev\b|crdi\b|tdi\b|bluehdi\b|puretech\b|prime\b|premium\b|style\b|comfort\b|edition\b|pack\b|trend\b|executive\b|n line\b|gt line\b|automatic\b|2wd\b|awd\b)/.test(long.slice(short.length+1));
  return addedVersion(a,b)||addedVersion(b,a);
};

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
  // Geração, tração e caixa diferentes penalizam a semelhança;
  // não obrigam a descartar uma referência usada por aproximação.
  if(known(s.year)&&known(c.year)&&Math.abs(num(s.year)-num(c.year))>5)return "ano demasiado distante";
  if(known(s.mileage_km)&&known(c.mileage_km)&&Math.abs(num(s.mileage_km)-num(c.mileage_km))>150000)return "quilometragem demasiado distante";
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

  const originCountry=String(supplied.origin_country||"").trim().toUpperCase();
  const countryLocation=originCountry==="PT"?"PT":/^[A-Z]{2}$/.test(originCountry)?"foreign":"unknown";
  const vehicleLocation=["PT","foreign"].includes(supplied.vehicle_location)?supplied.vehicle_location:countryLocation;
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
  const s=input.subject||{},rows=[],excluded=[],nearMatches=[],wideMatches=[],seenUrls=new Set(),seenFingerprints=new Set();
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
    const similarityFloor=closeVariant?50:config.minSimilarity;
    if(!reason&&sim<similarityFloor)reason="dados insuficientes ou semelhança insuficiente ("+sim+"%)";

    // Escalões progressivos: modelo e combustível compatíveis, anúncio real em PT.
    if(reason?.startsWith("dados insuficientes ou semelhança insuficiente")
      &&c.country==="PT"&&c.price_basis==="gross"
      &&known(s.year)&&known(c.year)&&known(s.fuel)&&known(c.fuel)
      &&fuel(s.fuel)===fuel(c.fuel)){
      const yearDelta=Math.abs(num(s.year)-num(c.year));
      const match={comp:{...c,url},similarity:sim,adjustedPrice:adjustedPrice(s,c,config),fingerprint:fp};
      if(sim>=40&&yearDelta<=3)nearMatches.push(match);
      else if(sim>=20&&yearDelta<=5)wideMatches.push(match);
    }
    if(reason){
      excluded.push({label:c.label||c.trim||"Comparável",url:c.url||null,reason,comp:c});
      continue;
    }

    seenUrls.add(url);
    if(fp)seenFingerprints.add(fp);
    rows.push({comp:{...c,url},similarity:sim,adjustedPrice:adjustedPrice(s,c,config)});
  }

  let broadenedMarket=false,searchTier=1;
  if(!rows.length&&(nearMatches.length||wideMatches.length)){
    const candidatePool=nearMatches.length?nearMatches:wideMatches;
    searchTier=nearMatches.length?2:3;
    const fallbackUrls=new Set(),fallbackFingerprints=new Set();
    for(const match of [...candidatePool].sort((a,b)=>b.similarity-a.similarity)){
      const url=match.comp.url,fp=match.fingerprint;
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
  if(valid.length===1)warnings.push("A estimativa baseia-se num único anúncio; a dispersão do mercado não pode ser medida.");
  if(broadenedMarket)warnings.push(searchTier===3
    ?"Nível 3: anúncios reais do mesmo modelo e combustível, mas com semelhança baixa. Cotações provisórias, confiança muito reduzida."
    :"Nível 2: anúncios reais aproximados do mesmo modelo e combustível. Cotações provisórias, confiança reduzida.");
  if(valid.length&&verified.length<config.minVerifiedProfessionals)warnings.push("Amostra limitada ou com verificação incompleta: o valor é indicativo e requer confirmação antes de licitar.");
  if(valid.length&&marketBasis!=="professional")warnings.push("Sem preços profissionais confirmados; anúncios de particulares ou de origem desconhecida reduzem a confiança.");
  if(valid.length&&dispersion>.45)warnings.push("Preços de mercado muito dispersos: os valores de compra são apenas cenários indicativos de baixa confiança, não uma recomendação de licitação. Confirma os anúncios e ajustamentos antes de comprar.");
  else if(valid.length&&dispersion>.25)warnings.push("Dispersão de preços elevada; apenas uma cotação provisória até confirmar os anúncios.");
  const knownPrice=num(s.price)>0?num(s.price):num(input.current_purchase_price)>0?num(input.current_purchase_price):NaN;
  const priceScenario=!valid.length&&Number.isFinite(knownPrice);
  if(!valid.length)warnings.push(priceScenario
    ?"Sem preços de mercado independentes. As duas cotações são simulações financeiras baseadas apenas no preço conhecido da viatura: NÃO confirmam o valor de revenda nem recomendam comprar. Confirma o mercado antes de licitar."
    :"Sem comparáveis e sem preço conhecido: não é possível calcular euros sem inventar uma referência. Introduz o preço do anúncio/licitação ou fornece um comparável.");
  if(valid.some(r=>r.comp.price_basis!=="gross"))warnings.push("Existem preços cuja base com IVA incluído não foi confirmada.");
  if(valid.some(r=>r.comp.country!=="PT"))warnings.push("Existem comparáveis cuja localização em Portugal não foi confirmada.");
  if(acquisition.needsLocationConfirmation)warnings.push("Confirma se esta viatura de leilão já está em Portugal. Só é aplicado o custo adicional de 1 200 € quando a viatura de leilão está fora de Portugal/importada.");

  const identityBlocked=input.valuation_blocked===true||(input.risk_flags||[]).some(r=>r.code==="registration_unconfirmed");
  if(identityBlocked)warnings.push("Confirma a matrícula e a identificação da viatura antes de avaliar.");
  const criticalMissing=missing.filter(k=>k==="make"||k==="model");
  const avgSim=valid.length?valid.reduce((t,r)=>t+r.similarity,0)/valid.length:0;
  const completeness=(6-missing.length)/6;
  const reportedEvidence=valid.filter(r=>r.comp?.evidence?.reported_url===true||r.comp?.evidence?.source_url_verified===true).length;
  // Índice heurístico, não probabilidade estatística de acertar no preço.
  // Quantidade, semelhança, verificação, completude e dispersão têm efeitos independentes.
  const rawConfidence=valid.length
    ?10+avgSim*.40+Math.min(verified.length,3)*8
      +(reportedEvidence/valid.length)*10
      +(1-clamp(dispersion/.45,0,1))*8+completeness*8
      +Math.min(valid.length,4)*2
    :0;
  const comparableCountCap=valid.length===1?52:valid.length===2?68:valid.length===3?80:valid.length<=5?86:92;
  const evidenceCap=marketBasis!=="professional"?(marketBasis==="seller_unconfirmed"?45:42)
    :verified.length===0?47:92;
  const completenessCap=s.mileage_estimated||!known(s.mileage_km)?45:missing.length?58:95;
  const confidencePct=valid.length
    ?Math.round(clamp(Math.min(rawConfidence,comparableCountCap,evidenceCap,completenessCap,searchTier===3?25:(dispersion>.45||broadenedMarket)?35:95),0,95))
    :0;
  const reconditioning=estimateReconditioning(input.condition_report,input.reconditioning_settings,s,input.costs?.reconditioning,input.tax?.mode,num(input.tax?.vat_rate,.23));
  const evidenceEligible=!broadenedMarket&&!s.mileage_estimated&&Number.isFinite(marketValue)&&!missing.length
    &&verified.length>=config.minVerifiedProfessionals&&marketBasis==="professional"
    &&dispersion<=.25&&confidencePct>=62;
  // Price dispersion must lower confidence, not hide a calculable scenario.
  // A missing market price, identity conflict or unconfirmed auction location still blocks it.
  // Sem mercado: apenas cenário matemático, nunca valor comercial validado.
  const quoteSaleGross=priceScenario?Math.round(knownPrice*(1-num(input.negotiation_discount_pct,config.negotiationDiscountPct))):saleLikely;
  const provisionalEligible=!identityBlocked&&!criticalMissing.length
    &&(Number.isFinite(marketValue)&&valid.length>=1||priceScenario);
  const eligible=!identityBlocked&&evidenceEligible&&!acquisition.needsLocationConfirmation&&!reconditioning.hasUnpriced;
  if(reconditioning.hasUnpriced)warnings.push("Há "+reconditioning.unpriced+" intervenção(ões) ou zona(s) por confirmar/orçamentar. O teto de compra é provisório e pode descer com os custos em falta.");
  if(reconditioning.hasCriticalUnpriced)warnings.push("Há um problema potencialmente crítico por confirmar. É necessário diagnóstico antes da compra.");
  warnings.push(...reconditioning.notes);
  if(s.mileage_estimated)warnings.push("Quilómetros estimados pelo mercado do Standvirtual. Indica os quilómetros reais para aumentar a confiança da avaliação.");
  if(valid.length)warnings.push("Confiança "+confidencePct+"%: índice estimado da qualidade dos comparáveis, não uma probabilidade comprovada de acerto no preço.");
  if(acquisition.needsLocationConfirmation)warnings.push("Localização do leilão por confirmar: reservados provisoriamente "+config.auctionImportCost+" € de importação, apenas para o cenário.");
  if(!eligible&&provisionalEligible)warnings.unshift(priceScenario
    ?"Nível 4: simulação financeira sem anúncios comparáveis. NÃO é um preço comercial confirmado nem uma recomendação de compra."
    :"Estimativa indicativa com "+valid.length+" comparável(is) aceite(s)"+(marketBasis!=="professional"?" sem base profissional confirmada":"")+". Baixa confiança: confirmar estado, quilómetros e preços antes de comprar.");

  const tax=input.tax||{},vatRate=num(tax.vat_rate,.23);
  const taxMode=tax.mode==="deductible"?"deductible":"gross";
  const factor=taxMode==="deductible"?1+vatRate:1;
  const saleEconomic=Number.isFinite(quoteSaleGross)?quoteSaleGross/factor:NaN;
  const costs=input.costs||{};
  const baseFixedCosts=["auction_fee","transport","registration","warranty_reserve","stock_finance","other"]
    .reduce((t,k)=>t+Math.max(0,num(costs[k])),0)+reconditioning.appliedEconomic;
  // Sem país do leilão, aplicar preventivamente o cenário mais caro.
  const importCostAssumed=acquisition.needsLocationConfirmation?Math.max(0,num(config.auctionImportCost,1200)):acquisition.importCost;
  const fixedCosts=baseFixedCosts+importCostAssumed;
  const fixedCostsWithoutRepairs=fixedCosts-reconditioning.appliedEconomic;
  const pricedComponents=new Set(reconditioning.items.filter(x=>x.high!==null&&(!x.partial||x.basis==="fallback")).map(x=>x.key));
  const riskFlags=(input.risk_flags||[]).reduce((t,r)=>t+(pricedComponents.has(norm(r.related_component).replace(/[^a-z0-9]+/g,"_"))?0:Math.max(0,num(r.reserve_eur))),0);
  const riskReserve=Number.isFinite(saleEconomic)?Math.round(Math.max(0,saleEconomic*config.riskReservePct+riskFlags)):0;
  const targetMargin=Math.max(0,num(input.target_margin,config.targetMargin));
  const minimumMargin=Math.max(0,Math.min(targetMargin,num(input.minimum_margin,config.minimumMargin)));

  const computedTargetCeiling=Number.isFinite(saleEconomic)?Math.max(0,Math.floor((saleEconomic-fixedCosts-riskReserve-targetMargin)*factor)):NaN;
  const computedWithoutRepairs=Number.isFinite(saleEconomic)?Math.max(0,Math.floor((saleEconomic-fixedCostsWithoutRepairs-riskReserve-targetMargin)*factor)):NaN;
  const computedAbsoluteCeiling=Number.isFinite(saleEconomic)?Math.max(0,Math.floor((saleEconomic-fixedCosts-riskReserve-minimumMargin)*factor)):NaN;
  const maxPurchase=eligible?computedTargetCeiling:NaN;
  const absoluteMax=eligible?computedAbsoluteCeiling:NaN;
  const provisionalMaxPurchase=!eligible&&provisionalEligible?computedTargetCeiling:NaN;
  const provisionalAbsoluteMax=!eligible&&provisionalEligible?computedAbsoluteCeiling:NaN;
  const effectiveCeiling=Number.isFinite(maxPurchase)?maxPurchase:provisionalMaxPurchase;
  // Both quotes require the exact same independent market evidence. A missing
  // repair quote never hides the pre-repair price, but leaves the second provisional.
  const purchaseWithoutRepairs=eligible||provisionalEligible?computedWithoutRepairs:NaN;
  const purchaseWithRepairs=eligible||provisionalEligible?computedTargetCeiling:NaN;
  const currentPrice=num(input.current_purchase_price,NaN);
  const expectedMargin=Number.isFinite(currentPrice)&&Number.isFinite(saleEconomic)
    ?Math.round(saleEconomic-currentPrice/factor-fixedCosts-riskReserve)
    :NaN;
  const marginAtCeiling=Number.isFinite(effectiveCeiling)&&Number.isFinite(saleEconomic)
    ?Math.round(saleEconomic-effectiveCeiling/factor-fixedCosts-riskReserve)
    :NaN;

  let decision=valid.length?"Referência provisória — dados por confirmar":"sem dados";
  if(priceScenario&&provisionalEligible)decision="Simulação pelo preço conhecido — SEM valor de mercado confirmado; não é recomendação de compra";
  else if(acquisition.needsLocationConfirmation)decision="Confirmar localização do leilão — cenário provisório com importação presumida";
  else if(eligible){
    if(!Number.isFinite(currentPrice))decision="Teto estimado — indica o preço de compra";
    else if(currentPrice<=maxPurchase*.97)decision="compra muito interessante";
    else if(currentPrice<=maxPurchase)decision="boa compra";
    else if(currentPrice<=absoluteMax)decision="comprar só com justificação";
    else decision="não comprar";
  }else if(provisionalEligible){
    if(dispersion>.45)decision="Cenários indicativos — preços de mercado muito dispersos; confirmar antes de licitar";
    else if(broadenedMarket)decision="Cenários indicativos — anúncios com semelhança reduzida; confirmar antes de licitar";
    else if(!Number.isFinite(currentPrice))decision="Teto provisório — confirmar evidência";
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
      marketBasis:valid.length?marketBasis:"none",marketValue,saleLikely,saleFast,confidencePct,dispersion,broadenedMarket,
      searchTier:priceScenario?4:valid.length?searchTier:0,hasIndependentMarket:valid.length>0,
      confidenceMethod:"heuristic-evidence-v2",sampleSize:valid.length
    },
    purchase:{
      currentPrice,
      fixedCosts:Math.round(fixedCosts),
      baseFixedCosts:Math.round(baseFixedCosts),
      importCost:Math.round(importCostAssumed),
      priceScenario,referencePrice:priceScenario?knownPrice:null,
      referenceSource:priceScenario?(acquisition.priceRole==="acquisition_price"?"preço de aquisição/licitação":"preço pedido no anúncio"):null,
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
      purchaseWithoutRepairs,
      purchaseWithRepairs,
      provisionalEligible,
      expectedMargin,
      marginAtCeiling,
      decision,
      eligible
    },
    reconditioning,
    condition_report:input.condition_report||null,
    tax:{mode:taxMode,vatRate},
    parameters:{...config,costs:{...costs},reconditioning_settings:input.reconditioning_settings||{},source_context:{...(input.source_context||{})},acquisition},
    comparables:valid.sort((a,b)=>b.similarity-a.similarity).map(r=>({...r.comp,similarity:r.similarity,adjustedPrice:r.adjustedPrice,seller_type:sellerType(r.comp)})),
    excluded,
    warnings
  };
}

