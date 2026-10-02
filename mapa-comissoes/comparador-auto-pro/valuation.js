const DEFAULT_CONFIG = Object.freeze({
  weights:{identity:25,powertrain:20,year:15,mileage:15,performance:10,equipment:7,commercial:5,freshness:3},
  minSimilarity:55, negotiationDiscountPct:.02, fastSaleDiscountPct:.035,
  riskReservePct:.006, kmAdjustmentPer1000:20, ageAdjustmentPerMonth:55,
  equipmentUnitAdjustment:120, minimumMargin:1500, targetMargin:2000
});
const num=(v,f=0)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))?Number(v):f;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const norm=v=>String(v??"").trim().toLowerCase();
const same=(a,b)=>!!norm(a)&&norm(a)===norm(b);
const list=v=>Array.isArray(v)?v.map(norm).filter(Boolean):[];

function monthIndex(v){
  if(!v)return null; const d=new Date(v); if(Number.isNaN(d.getTime()))return null;
  return d.getUTCFullYear()*12+d.getUTCMonth();
}
function ageDelta(subject,comp){
  const a=monthIndex(subject.first_registration),b=monthIndex(comp.first_registration);
  if(a!=null&&b!=null)return a-b;
  return subject.year!=null&&comp.year!=null?(num(subject.year)-num(comp.year))*12:0;
}
function jaccard(a,b){
  const A=new Set(list(a)),B=new Set(list(b));
  if(!A.size&&!B.size)return 1;
  const i=[...A].filter(x=>B.has(x)).length,u=new Set([...A,...B]).size||1;
  return i/u;
}
function hardExclusion(s,c){
  if(!same(s.make,c.make))return "marca diferente";
  if(!same(s.model,c.model))return "modelo diferente";
  if(s.fuel&&c.fuel&&!same(s.fuel,c.fuel))return "combustível diferente";
  if(s.generation&&c.generation&&!same(s.generation,c.generation))return "geração diferente";
  if(s.battery_kwh&&c.battery_kwh&&Math.abs(num(s.battery_kwh)-num(c.battery_kwh))>=12)return "bateria incompatível";
  return null;
}
export function similarity(s,c,config=DEFAULT_CONFIG){
  const w=config.weights; let score=0;
  let identity=.45;
  if(s.generation&&c.generation)identity+=same(s.generation,c.generation)?.25:-.25;
  if(s.trim&&c.trim)identity+=same(s.trim,c.trim)?.30:0;
  score+=w.identity*clamp(identity,0,1);

  let pt=.5;
  if(same(s.fuel,c.fuel))pt+=.2;
  if(s.battery_kwh&&c.battery_kwh)pt+=clamp(1-Math.abs(num(s.battery_kwh)-num(c.battery_kwh))/15,0,1)*.3;
  score+=w.powertrain*clamp(pt,0,1);

  score+=w.year*clamp(1-Math.abs(num(s.year)-num(c.year))/5,0,1);
  score+=w.mileage*clamp(1-Math.abs(num(s.mileage_km)-num(c.mileage_km))/90000,0,1);

  let perf=.55;
  if(s.power_cv&&c.power_cv)perf+=clamp(1-Math.abs(num(s.power_cv)-num(c.power_cv))/180,0,1)*.30;
  if(s.drivetrain&&c.drivetrain)perf+=same(s.drivetrain,c.drivetrain)?.15:0;
  score+=w.performance*clamp(perf,0,1);
  score+=w.equipment*jaccard(s.equipment,c.equipment);

  let commercial=.45;
  if(s.vat_deductible!=null&&c.vat_deductible!=null)commercial+=s.vat_deductible===c.vat_deductible?.25:0;
  if(s.warranty_months!=null&&c.warranty_months!=null)commercial+=clamp(1-Math.abs(num(s.warranty_months)-num(c.warranty_months))/36,0,1)*.3;
  score+=w.commercial*clamp(commercial,0,1);
  score+=w.freshness*clamp(1-num(c.days_since_seen,30)/180,0,1);
  return Math.round(clamp(score,0,100)*10)/10;
}
function adjustedPrice(s,c,config){
  let p=num(c.price);
  if(c.mileage_km!=null&&s.mileage_km!=null)p+=(num(c.mileage_km)-num(s.mileage_km))/1000*config.kmAdjustmentPer1000;
  p+=ageDelta(s,c)*config.ageAdjustmentPerMonth;
  const S=new Set(list(s.equipment)),C=new Set(list(c.equipment));
  p+=([...S].filter(x=>!C.has(x)).length-[...C].filter(x=>!S.has(x)).length)*config.equipmentUnitAdjustment;
  return Math.round(p);
}
function quartiles(values){
  const a=[...values].sort((x,y)=>x-y);
  const q=p=>{if(!a.length)return NaN;const pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo)};
  return{q1:q(.25),q2:q(.5),q3:q(.75)};
}
function weightedMedian(rows){
  const a=[...rows].sort((x,y)=>x.value-y.value),total=a.reduce((s,x)=>s+x.weight,0);
  let acc=0; for(const x of a){acc+=x.weight;if(acc>=total/2)return x.value} return a.at(-1)?.value??NaN;
}
function confidence(rows,marketValue,s){
  if(!rows.length||!Number.isFinite(marketValue))return 0;
  const count=clamp(rows.length/14,0,1);
  const sim=rows.reduce((a,x)=>a+x.similarity,0)/rows.length/100;
  const q=quartiles(rows.map(x=>x.adjustedPrice));
  const disp=clamp(1-((q.q3-q.q1)/(marketValue||1))/.28,0,1);
  const complete=["make","model","year","mileage_km","fuel","price"].filter(k=>s[k]!==undefined&&s[k]!==null&&s[k]!=="").length/6;
  return Math.round(100*(count*.25+sim*.33+disp*.24+complete*.18));
}
export function evaluatePurchase(input,custom={}){
  const config={...DEFAULT_CONFIG,...custom,weights:{...DEFAULT_CONFIG.weights,...(custom.weights||{})}};
  const s=input.subject||{},excluded=[],rows=[];
  const seen=new Set();
  for(const c of input.comparables||[]){
    if(!(num(c.price)>0)){excluded.push({comp:c,reason:"preço inválido"});continue}
    const key=c.url?String(c.url).split("?")[0].replace(/\/$/,""):null;
    if(key&&seen.has(key)){excluded.push({comp:c,reason:"anúncio duplicado"});continue}
    if(key)seen.add(key);
    const reason=hardExclusion(s,c); if(reason){excluded.push({comp:c,reason});continue}
    const sim=similarity(s,c,config); if(sim<config.minSimilarity){excluded.push({comp:c,reason:`semelhança insuficiente (${sim}%)`});continue}
    rows.push({comp:c,similarity:sim,adjustedPrice:adjustedPrice(s,c,config)});
  }
  let valid=rows;
  if(rows.length>=5){
    const q=quartiles(rows.map(x=>x.adjustedPrice)),iqr=q.q3-q.q1,lo=q.q1-1.5*iqr,hi=q.q3+1.5*iqr;
    valid=[]; for(const r of rows){if(r.adjustedPrice<lo||r.adjustedPrice>hi)excluded.push({comp:r.comp,reason:"outlier de preço"});else valid.push(r)}
  }
  const marketValue=Math.round(weightedMedian(valid.map(x=>({value:x.adjustedPrice,weight:Math.pow(x.similarity/100,2)}))));
  const confidencePct=confidence(valid,marketValue,s);
  const saleLikely=Math.round(marketValue*(1-num(input.negotiation_discount_pct,config.negotiationDiscountPct)));
  const saleFast=Math.round(saleLikely*(1-num(input.fast_sale_discount_pct,config.fastSaleDiscountPct)));

  const tax=input.tax||{},vatRate=num(tax.vat_rate,.23),taxMode=tax.mode||(s.vat_deductible?"deductible":"gross"),factor=taxMode==="deductible"?1+vatRate:1;
  const toEconomic=v=>v/factor,fromEconomic=v=>v*factor;
  const saleEconomic=toEconomic(saleLikely);
  const costs=input.costs||{};
  const fixedCosts=["auction_fee","transport","registration","reconditioning","warranty_reserve","stock_finance","other"].reduce((a,k)=>a+num(costs[k]),0);
  const flagReserve=(input.risk_flags||[]).reduce((a,x)=>a+num(x.reserve_eur),0);
  const reserve=Math.round(saleEconomic*config.riskReservePct+flagReserve+(confidencePct<70?saleEconomic*.008:0));
  const targetMargin=num(input.target_margin,config.targetMargin),minimumMargin=num(input.minimum_margin,config.minimumMargin);
  const maxPurchase=Math.max(0,Math.round(fromEconomic(saleEconomic-fixedCosts-reserve-targetMargin)));
  const absoluteMax=Math.max(0,Math.round(fromEconomic(saleEconomic-fixedCosts-reserve-minimumMargin)));
  const currentPrice=num(input.current_purchase_price,NaN);
  const expectedMargin=Number.isFinite(currentPrice)?Math.round(saleEconomic-toEconomic(currentPrice)-fixedCosts-reserve):NaN;
  let decision="sem dados";
  if(Number.isFinite(currentPrice)&&Number.isFinite(maxPurchase)){
    if(currentPrice<=maxPurchase*.97)decision="compra muito interessante";
    else if(currentPrice<=maxPurchase)decision="boa compra";
    else if(currentPrice<=absoluteMax)decision="comprar só com justificação";
    else decision="não comprar";
  }
  return{
    subject:s,
    market:{comparablesReceived:(input.comparables||[]).length,comparablesUsed:valid.length,comparablesExcluded:excluded.length,marketValue,saleLikely,saleFast,confidencePct},
    purchase:{currentPrice,fixedCosts:Math.round(fixedCosts),riskReserve:reserve,targetMargin,minimumMargin,maxPurchase,absoluteMax,expectedMargin,decision},
    tax:{mode:taxMode,vatRate},
    comparables:valid.sort((a,b)=>b.similarity-a.similarity).map(x=>({label:x.comp.label,url:x.comp.url,price:num(x.comp.price),adjustedPrice:x.adjustedPrice,similarity:x.similarity,year:x.comp.year,mileage_km:x.comp.mileage_km,trim:x.comp.trim})),
    excluded:excluded.map(x=>({label:x.comp?.label,url:x.comp?.url,reason:x.reason})),
    warnings:[...(valid.length<5?["Poucos comparáveis válidos."]:[]),...(confidencePct<60?["Confiança baixa."]:[])]
  };
}
export {DEFAULT_CONFIG};
