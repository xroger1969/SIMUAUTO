export const ENGINE_VERSION="2026-10-23-supervised-v1";
const identity=globalThis.CommercialIdentity;
if(!identity)throw new Error("CommercialIdentity must load before the valuation engine");
export const normalizeVehicleIdentity=identity.normalizeVehicleIdentity;
export const selectEligibleComparables=identity.selectEligibleComparables;
export const canonicalUrl=identity.canonicalUrl;
export const similarity=identity.similarity;


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
  "hibrido plug in":"phev","plug in hybrid":"phev",phev:"phev",
  "gasolina plug in":"phev","gasolina plugin":"phev",
  "hibrido plug in gasolina":"phev","gasolina hibrido plug in":"phev"
}[norm(v).replace(/[-_]+/g," ").replace(/\s+/g," ")]||norm(v));

// Commercial margin before personal taxes. The fiscal simulator reports net profit separately.
export function automaticMargin(sale){
  const value=num(sale);
  return Math.round((value<=15000?3500:value<=20000?3500+(value-15000)*.2:value<=25000?4500+(value-20000)*.1:5000+(value-25000)*.1)/50)*50;
}
export const FEEDBACK_KINDS=Object.freeze({retail_estimate:"Minha estimativa de revenda",retail_sale:"Venda concluída",auction_bid:"Licitação em curso",auction_hammer:"Adjudicação confirmada",purchase:"Compra concluída",margin:"Margem pretendida"});
const positive=v=>known(v)&&Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=10000000;
export function feedbackScope(vehicle){
  const v=normalizeVehicleIdentity(vehicle);
  const out={};
  for(const key of ["make","model","trim","fuel","generation","drivetrain","battery_kwh","year","mileage_km","mileage_estimated","registration"]){if(known(v[key]))out[key]=v[key];}
  return out;
}
export function feedbackMatches(rule,vehicle,now=Date.now()){
  if(rule?.active===false||rule?.effect?.mode!=="supervised"||rule.effect.version!==1)return false;
  const date=Date.parse(rule.updated_at||rule.created_at);
  if(!Number.isFinite(date)||date>now+86400000||now-date>120*86400000)return false;
  if(rule.valid_until&&(!Number.isFinite(Date.parse(rule.valid_until))||Date.parse(rule.valid_until)<=now))return false;
  const a=normalizeVehicleIdentity(rule.scope||{}),b=normalizeVehicleIdentity(vehicle);
  if(!a.make||!a.model||!same(a.make,b.make)||!same(a.model,b.model)||!a.fuel||fuel(a.fuel)!==fuel(b.fuel))return false;
  for(const key of ["trim","generation","drivetrain"]){if(known(a[key])&&(!known(b[key])||!same(a[key],b[key])))return false;}
  if(!positive(a.year)||!positive(b.year)||Math.abs(Number(a.year)-Number(b.year))>1)return false;
  if(fuel(a.fuel)==="electric"&&(!positive(a.battery_kwh)||!positive(b.battery_kwh)))return false;
  if(known(a.battery_kwh)&&(!known(b.battery_kwh)||Math.abs(Number(a.battery_kwh)-Number(b.battery_kwh))>5))return false;
  if(!known(a.mileage_km)||!known(b.mileage_km)||a.mileage_estimated||b.mileage_estimated||Math.abs(Number(a.mileage_km)-Number(b.mileage_km))>30000)return false;
  return true;
}
export function learningCalibration(rules,vehicle,{excludeAnalysisId=null,now=Date.now()}={}){
  // One vehicle, one observation per category: reevaluations cannot manufacture a sample.
  const latest=new Map();
  const category=k=>k==="margin"?"margin":["retail_sale","retail_estimate"].includes(k)?"retail":"trade";
  for(const r of [...(rules||[])].sort((a,b)=>Date.parse(b.updated_at||b.created_at)-Date.parse(a.updated_at||a.created_at))){
    if(r.analysis_id===excludeAnalysisId||!feedbackMatches(r,vehicle,now))continue;
    const e=r.effect,k=e.kind;
    if(!FEEDBACK_KINDS[k]||!positive(e.value))continue;
    // With no plate, conservatively collapse the same model/year/mileage bucket even across adverts.
    const fingerprint=[r.scope.make,r.scope.model,r.scope.trim,r.scope.year,Math.round(Number(r.scope.mileage_km)/5000)].join(":");
    const caseKey=String(r.scope?.registration||fingerprint).toLowerCase().replace(/[^a-z0-9]/g,"");
    if(!caseKey)continue;
    const key=caseKey+":"+category(k),old=latest.get(key);
    // A final sale/adjudication outranks a later estimate/bid for the same vehicle.
    if(old&&!(["retail_sale","auction_hammer","purchase"].includes(k)&&["retail_estimate","auction_bid"].includes(old.effect.kind)))continue;
    latest.set(key,r);
  }
  const rows=[...latest.values()];
  const retail=rows.filter(r=>["retail_sale","retail_estimate"].includes(r.effect.kind)&&positive(r.effect.baseline_sale)&&r.effect.value/r.effect.baseline_sale>=.65&&r.effect.value/r.effect.baseline_sale<=1.35);
  const median=xs=>{const a=xs.slice().sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null;};
  const weight=retail.reduce((s,r)=>s+(r.effect.kind==="retail_sale"?1:.35),0);
  const deviation=median(retail.map(r=>r.effect.value/r.effect.baseline_sale-1))||0;
  const saleAdjustmentPct=clamp(deviation*(weight/(weight+4)),-.05,.05);
  const margins=rows.filter(r=>r.effect.kind==="margin");
  const trade=rows.filter(r=>["auction_hammer","purchase"].includes(r.effect.kind)&&r.effect.price_basis==="gross"&&r.effect.fees_confirmed===true&&positive(r.effect.baseline_sale)&&r.effect.value/r.effect.baseline_sale>=.3&&r.effect.value/r.effect.baseline_sale<=1);
  return {saleAdjustmentPct,retailSamples:retail.length,confirmedSales:retail.filter(r=>r.effect.kind==="retail_sale").length,
    learnedMargin:margins.length>=3?median(margins.map(r=>Number(r.effect.value))):null,marginSamples:margins.length,
    tradeRatio:trade.length>=3?median(trade.map(r=>r.effect.value/r.effect.baseline_sale)):null,tradeSamples:trade.length,
    bidSamples:rows.filter(r=>r.effect.kind==="auction_bid").length,ids:rows.map(r=>r.id).filter(Boolean)};
}
export function buildFeedbackRecord({userId,analysisId,vehicle,result,kind,value,feesConfirmed=false,sourceUrl=null}){
  if(!userId||!analysisId||!FEEDBACK_KINDS[kind]||!positive(value))throw Error("Seleciona o tipo de registo e um valor positivo válido.");
  if(kind==="margin"&&Number(value)>100000)throw Error("A margem é demasiado elevada.");
  const scope=feedbackScope(vehicle);
  if(!scope.make||!scope.model)throw Error("Confirma a marca e o modelo antes de ensinar.");
  const baseline=result?.market?.saleBaseline??result?.market?.saleLikely;
  return {user_id:userId,analysis_id:analysisId,rule_type:"margin_cost",statement:FEEDBACK_KINDS[kind]+": "+Number(value)+" €",
    scope,effect:{mode:"supervised",version:1,kind,value:Number(value),baseline_sale:positive(baseline)?Number(baseline):null,
      price_basis:result?.tax?.mode==="deductible"?"net_or_deductible":"gross",fees_confirmed:feesConfirmed===true,source_url:sourceUrl||null},
    evidence_level:["retail_sale","auction_hammer","purchase"].includes(kind)?"internal_history":"observation",confidence:kind==="retail_estimate"?.35:.8,active:true,updated_at:new Date().toISOString()};
}
export async function feedbackRecordId(userId,analysisId,kind,cryptoApi=globalThis.crypto){
  const bytes=new Uint8Array(await cryptoApi.subtle.digest("SHA-256",new TextEncoder().encode([userId,analysisId,kind].join(":"))));
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes.slice(0,16),v=>v.toString(16).padStart(2,"0")).join("");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}
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


/**
 * Parecer comercial independente da apresentação.
 * A pergunta essencial do comprador profissional é: "Com o preço realista de
 * revenda, TODOS os custos e a margem-alvo, quanto posso pagar?".
 * Intervalos de venda apenas quando há mais de um comparável independente.
 */
export function commercialDiagnosis(result){
  const market=result.market||{},purchase=result.purchase||{},report=result.condition_report||{};
  const subject=result.subject||{},prep=result.reconditioning||{},comps=result.comparables||[];
  const finite=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v));
  const euro=v=>Math.round(Number(v));
  const hasMarket=market.hasIndependentMarket===true&&finite(market.saleLikely);
  const current=finite(purchase.currentPrice)?Number(purchase.currentPrice):NaN;
  const ceiling=finite(purchase.effectiveCeiling)?Number(purchase.effectiveCeiling):NaN;
  const margin=finite(purchase.expectedMargin)?Number(purchase.expectedMargin):NaN;
  const target=finite(purchase.targetMargin)?Number(purchase.targetMargin):NaN;
  const profitShortfall=Number.isFinite(margin)&&Number.isFinite(target)?Math.max(0,target-margin):NaN;
  const excessBid=Number.isFinite(current)&&Number.isFinite(ceiling)?Math.max(0,current-ceiling):NaN;
  const discount=finite(market.marketValue)&&Number(market.marketValue)>0
    ?Number(market.saleLikely)/Number(market.marketValue):NaN;
  const adjusted=comps.map(c=>Number(c.adjustedPrice)).filter(x=>Number.isFinite(x)&&x>0);
  const enoughRange=hasMarket&&adjusted.length>=2&&Number.isFinite(discount);
  const saleRange=enoughRange
    ?{low:euro(Math.min(...adjusted)*discount),high:euro(Math.max(...adjusted)*discount)}
    :null;
  const electric=fuel(subject.fuel)==="electric";
  const soh=finite(report.battery_soh_pct)&&Number(report.battery_soh_pct)>0&&Number(report.battery_soh_pct)<=100
    ?Number(report.battery_soh_pct):null;
  const missingBatteryHealth=electric&&soh===null;
  const unpriced=prep.hasUnpriced===true;
  const auction=purchase.acquisition?.isAuction===true;
  const costs=result.parameters?.costs||{};
  const auctionFee=finite(costs.auction_fee)?Math.max(0,Number(costs.auction_fee)):0;
  const risks=[];
  if(!hasMarket)risks.push("Sem anúncios independentes: não existe preço de revenda verificado.");
  if(market.comparablesUsed===1)risks.push("Só um anúncio compatível: confirmar com outras referências.");
  if(market.broadenedMarket||Number(market.dispersion)>.25)risks.push("Mercado pouco homogéneo: os preços podem variar significativamente.");
  if(missingBatteryHealth)risks.push("Bateria: SOH não documentado. Pedir leitura/relatório antes de comprar.");
  if(unpriced)risks.push("Há intervenções ou danos por orçamentar; o teto de compra pode descer.");
  if(prep.hasCriticalUnpriced)risks.push("Existe diagnóstico de segurança ou mecânica crítico pendente.");
  if(purchase.needsLocationConfirmation)risks.push("Confirmar a localização física antes de fechar custos de importação.");
  if(auction)risks.push(auctionFee>0
    ?"Confirmar se a comissão do leilão já está incluída no lance: não duplicar custos nem esquecer IVA."
    :"Confirmar comissão, IVA aplicável e demais taxas do leilão antes de licitar.");
  if(report.assessed!==true)risks.push("Estado físico não integralmente confirmado; pedir inspeção e histórico.");
  let verdict="Referência insuficiente",tone="neutral";
  if(purchase.priceScenario||!hasMarket){
    verdict="Simulação financeira — não recomendar compra sem mercado independente";
  }else if(!Number.isFinite(ceiling)||purchase.needsLocationConfirmation){
    verdict="Confirmar custos e identificação antes de licitar";
  }else if(!Number.isFinite(current)){
    verdict="Preço máximo calculado — falta confirmar o preço de compra";
  }else if(finite(purchase.provisionalAbsoluteMax)&&current>Number(purchase.provisionalAbsoluteMax)
    ||finite(purchase.absoluteMax)&&current>Number(purchase.absoluteMax)){
    verdict="Não comprar — margem mínima insuficiente";tone="red";
  }else if(current>ceiling){
    verdict="Negociar — preço acima do teto para a margem pretendida";tone="amber";
  }else if(missingBatteryHealth||unpriced||!purchase.eligible){
    verdict="Preço potencialmente interessante — confirmar riscos antes de comprar";tone="neutral";
  }else{
    verdict="Compra dentro do objetivo de margem, sujeita a confirmação final";tone="green";
  }
  return {
    hasIndependentMarket:hasMarket,comparablesUsed:market.comparablesUsed||0,
    saleLikely:hasMarket?Number(market.saleLikely):null,
    saleFast:hasMarket&&finite(market.saleFast)?Number(market.saleFast):null,
    saleRange,askingPricesNotTransactions:true,
    currentPrice:Number.isFinite(current)?current:null,
    purchaseRole:purchase.acquisition?.priceRole||"unknown",
    targetCeiling:Number.isFinite(ceiling)?ceiling:null,
    excessBid:Number.isFinite(excessBid)?euro(excessBid):null,
    expectedMargin:hasMarket&&Number.isFinite(margin)?margin:null,
    targetMargin:Number.isFinite(target)?target:null,
    profitShortfall:hasMarket&&Number.isFinite(profitShortfall)?euro(profitShortfall):null,
    fixedCosts:finite(purchase.fixedCosts)?Number(purchase.fixedCosts):null,
    preparation:finite(prep.appliedGross)?Number(prep.appliedGross):null,
    riskReserve:finite(purchase.riskReserve)?Number(purchase.riskReserve):null,
    missingBatteryHealth,documentedSoh:soh,unpricedRepairs:unpriced,
    verdict,tone,risks
  };
}

export function evaluatePurchase(input,custom={}){
  const config={...DEFAULT_CONFIG,...custom};
  const selection=selectEligibleComparables(input.subject,input.comparables||[],{...config,source_url:input.source_url});
  const s=selection.subject,valid=selection.rows,excluded=selection.excluded;
  const {broadenedMarket,searchTier,marketBasis}=selection;
  const marketValue=Math.round(weightedMedian(valid.map(r=>({
    value:r.adjustedPrice,
    weight:Math.pow(r.similarity/100,2)*(sellerType(r.comp)==="professional"?1.25:.5)
  }))));
  const saleBaseline=Number.isFinite(marketValue)?Math.round(marketValue*(1-num(input.negotiation_discount_pct,config.negotiationDiscountPct))):NaN;
  const learning=learningCalibration(input.learning_rules||[],s,{excludeAnalysisId:input.analysis_id});
  const saleLikely=Number.isFinite(saleBaseline)?Math.min(marketValue,Math.round(saleBaseline*(1+learning.saleAdjustmentPct))):NaN;
  const saleFast=Number.isFinite(saleLikely)?Math.round(saleLikely*(1-num(input.fast_sale_discount_pct,config.fastSaleDiscountPct))):NaN;

  const verified=valid.filter(r=>recentEvidence(r.comp,config));
  const missing=subjectMissing(s);
  const dispersion=valid.length&&Number.isFinite(marketValue)
    ?Math.max(0,(quantile(valid.map(r=>r.adjustedPrice),.75)-quantile(valid.map(r=>r.adjustedPrice),.25))/(marketValue||1))
    :1;
  const acquisition=resolveAcquisitionContext(input,config);
  const warnings=[];
  const powerConflicts=valid.filter(r=>r.powerDiscrepancy);
  if(powerConflicts.length)warnings.push("Potência divergente entre fontes em "+powerConflicts.length+" anúncio(s) da mesma versão elétrica. Confirmar a especificação; referência provisória.");
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
    ?Math.round(clamp(Math.min(rawConfidence,comparableCountCap,evidenceCap,completenessCap,powerConflicts.length?45:95,searchTier===3?25:(dispersion>.45||broadenedMarket)?35:95),0,95))
    :0;
  const reconditioning=estimateReconditioning(input.condition_report,input.reconditioning_settings,s,input.costs?.reconditioning,input.tax?.mode,num(input.tax?.vat_rate,.23));
  const evidenceEligible=!broadenedMarket&&!powerConflicts.length&&!s.mileage_estimated&&Number.isFinite(marketValue)&&!missing.length
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
  if(s.mileage_estimated)warnings.push("Avaliação provisória pela média de quilómetros dos anúncios comparáveis. A quilometragem real da viatura é desconhecida; o preço é uma referência média de mercado.");
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
  const automaticTarget=automaticMargin(quoteSaleGross);
  const learnedTarget=learning.learnedMargin===null?automaticTarget:Math.max(3500,clamp(learning.learnedMargin,automaticTarget*.8,automaticTarget*1.3));
  const manualMargin=known(input.target_margin)&&Number.isFinite(Number(input.target_margin));
  const targetMargin=manualMargin?Math.max(0,Number(input.target_margin)):Math.round(learnedTarget/50)*50;
  const marginMode=manualMargin?"manual":learning.learnedMargin===null?"automatic":"learned";
  const minimumMargin=Math.max(0,Math.min(targetMargin,num(input.minimum_margin,config.minimumMargin)));

  const tradeCeiling=taxMode==="gross"&&Number.isFinite(saleLikely)&&learning.tradeRatio!==null?Math.floor(saleLikely*learning.tradeRatio):Infinity;
  const computedTargetCeiling=Number.isFinite(saleEconomic)?Math.max(0,Math.min(tradeCeiling,Math.floor((saleEconomic-fixedCosts-riskReserve-targetMargin)*factor))):NaN;
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

  const result = {
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
      marketBasis:valid.length?marketBasis:"none",marketValue,saleBaseline,saleLikely,saleFast,learning,confidencePct,dispersion,broadenedMarket,
      searchTier:priceScenario?4:valid.length?searchTier:0,hasIndependentMarket:valid.length>0,
      confidenceMethod:"heuristic-evidence-v3",sampleSize:valid.length
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
      marginMode,automaticTarget,tradeCeiling:Number.isFinite(tradeCeiling)?tradeCeiling:null,
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
    comparables:valid.sort((a,b)=>b.similarity-a.similarity).map(r=>({...r.comp,similarity:r.similarity,adjustedPrice:r.adjustedPrice,seller_type:sellerType(r.comp),power_discrepancy:r.powerDiscrepancy})),
    excluded,
    warnings
  };
  result.commercial=commercialDiagnosis(result);
  return result;
}


