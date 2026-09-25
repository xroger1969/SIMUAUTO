(function(root){
  "use strict";

  const FINANCE_POINTS = [0,25,50,75,100];

  const DEFAULT_CONFIG = {
    version: 3,
    globalMinCommission: 120,
    globalMaxCommission: 750,
    financeCapPct: 100,
    volumeTiers: [
      { id:"t0", label:"0–1", from:0, to:1, financeGrid:{"0":0,"25":0,"50":0,"75":0,"100":0} },
      { id:"t1", label:"2–3", from:2, to:3, financeGrid:{"0":120,"25":135,"50":150,"75":165,"100":180} },
      { id:"t2", label:"4–5", from:4, to:5, financeGrid:{"0":160,"25":180,"50":200,"75":220,"100":240} },
      { id:"t3", label:"6–7", from:6, to:7, financeGrid:{"0":220,"25":248,"50":275,"75":303,"100":330} },
      { id:"t4", label:"8–9", from:8, to:9, financeGrid:{"0":300,"25":338,"50":375,"75":413,"100":450} },
      { id:"t5", label:"10–11", from:10, to:11, financeGrid:{"0":400,"25":450,"50":500,"75":550,"100":600} },
      { id:"t6", label:"12+", from:12, to:null, financeGrid:{"0":500,"25":563,"50":625,"75":688,"100":750} }
    ],
    marginBands: [
      { id:"m0", label:"< 1.000 €", min:null, max:999.99, factor:0.50 },
      { id:"m1", label:"1.000–1.499 €", min:1000, max:1499.99, factor:0.70 },
      { id:"m2", label:"1.500–1.999 €", min:1500, max:1999.99, factor:0.85 },
      { id:"m3", label:"2.000–2.499 €", min:2000, max:2499.99, factor:0.95 },
      { id:"m4", label:"≥ 2.500 €", min:2500, max:null, factor:1.00 }
    ]
  };

  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const clamp = (v,min,max) => Math.min(Math.max(v,min),max);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

  function normalizeFinanceGrid(sourceTier, defaultTier){
    const grid={};
    const legacyMin=Number.isFinite(Number(sourceTier && sourceTier.noFinance)) ? num(sourceTier.noFinance) : null;
    const legacyMax=Number.isFinite(Number(sourceTier && sourceTier.fullFinance)) ? num(sourceTier.fullFinance) : null;

    FINANCE_POINTS.forEach(point=>{
      const direct=sourceTier && sourceTier.financeGrid && sourceTier.financeGrid[String(point)];
      if(Number.isFinite(Number(direct))){
        grid[String(point)]=Math.max(0,num(direct));
      }else if(legacyMin!==null && legacyMax!==null){
        grid[String(point)]=Math.max(0,Math.round(legacyMin+(legacyMax-legacyMin)*(point/100)));
      }else{
        grid[String(point)]=num(defaultTier.financeGrid[String(point)]);
      }
    });
    return grid;
  }

  function normalizeConfig(input){
    const source=input && typeof input==="object" ? input : {};
    const out=clone(DEFAULT_CONFIG);

    if(Number.isFinite(Number(source.version))) out.version=num(source.version);
    if(Number.isFinite(Number(source.globalMinCommission))) out.globalMinCommission=Math.max(0,num(source.globalMinCommission));
    if(Number.isFinite(Number(source.globalMaxCommission))) out.globalMaxCommission=Math.max(out.globalMinCommission,num(source.globalMaxCommission));
    if(Number.isFinite(Number(source.financeCapPct))) out.financeCapPct=clamp(num(source.financeCapPct),1,100);

    const srcTiers=Array.isArray(source.volumeTiers) ? source.volumeTiers : [];
    out.volumeTiers=DEFAULT_CONFIG.volumeTiers.map((def,index)=>{
      const src=srcTiers.find(t=>t && t.id===def.id) || srcTiers[index] || {};
      const fromCandidate=Number(src.from);
      const toCandidate=src.to===null || src.to==="" ? null : Number(src.to);

      const from=Number.isFinite(fromCandidate) && fromCandidate>=0 && fromCandidate<100 ? fromCandidate : def.from;
      const to=(toCandidate===null)
        ? null
        : (Number.isFinite(toCandidate) && toCandidate>=from && toCandidate<100 ? toCandidate : def.to);

      const finalFrom=(def.id==="t0" && (from>10 || (to!==null && to>10))) ? def.from : from;
      const finalTo=(def.id==="t0" && (from>10 || (to!==null && to>10))) ? def.to : to;

      return {
        id:def.id,
        label: finalTo===null ? finalFrom+"+" : finalFrom+"–"+finalTo,
        from:finalFrom,
        to:finalTo,
        financeGrid:normalizeFinanceGrid(src,def)
      };
    });

    const srcBands=Array.isArray(source.marginBands) ? source.marginBands : [];
    out.marginBands=DEFAULT_CONFIG.marginBands.map((def,index)=>{
      const src=srcBands.find(b=>b && b.id===def.id) || srcBands[index] || {};
      return {
        id:def.id,
        label:typeof src.label==="string" && src.label ? src.label : def.label,
        min:src.min===null || src.min==="" ? null : (Number.isFinite(Number(src.min)) ? num(src.min) : def.min),
        max:src.max===null || src.max==="" ? null : (Number.isFinite(Number(src.max)) ? num(src.max) : def.max),
        factor:Number.isFinite(Number(src.factor)) ? Math.max(0,num(src.factor)) : def.factor
      };
    });

    return out;
  }

  function getVolumeTier(position, configInput){
    const config=normalizeConfig(configInput);
    const p=Math.max(0,Math.floor(num(position)));
    return config.volumeTiers.find(t=>p>=num(t.from) && (t.to===null || p<=num(t.to)))
      || config.volumeTiers[config.volumeTiers.length-1];
  }

  function getMarginBand(margin, configInput){
    const config=normalizeConfig(configInput);
    const m=num(margin);
    return config.marginBands.find(b=>(b.min===null || m>=num(b.min)) && (b.max===null || m<=num(b.max)))
      || {id:"fallback",label:"Sem fator",factor:1};
  }

  function getFinanceCommission(tier, financePct){
    const pctApplied=clamp(num(financePct),0,100);
    if(pctApplied<=0){
      const value=num(tier.financeGrid["0"]);
      return {value,lowerPoint:0,upperPoint:0,lowerValue:value,upperValue:value};
    }
    if(pctApplied>=100){
      const value=num(tier.financeGrid["100"]);
      return {value,lowerPoint:100,upperPoint:100,lowerValue:value,upperValue:value};
    }

    let lower=0, upper=100;
    for(let i=0;i<FINANCE_POINTS.length-1;i++){
      if(pctApplied>=FINANCE_POINTS[i] && pctApplied<=FINANCE_POINTS[i+1]){
        lower=FINANCE_POINTS[i];
        upper=FINANCE_POINTS[i+1];
        break;
      }
    }
    const lowerValue=num(tier.financeGrid[String(lower)]);
    const upperValue=num(tier.financeGrid[String(upper)]);
    const fraction=(pctApplied-lower)/(upper-lower);
    return {
      value:round2(lowerValue+(upperValue-lowerValue)*fraction),
      lowerPoint:lower,
      upperPoint:upper,
      lowerValue,
      upperValue
    };
  }

  function calcVehicleMargin(deal){
    return round2(
      num(deal.salePrice)
      - num(deal.acquisitionCost)
      - num(deal.preparationCost)
      - num(deal.warrantyCost)
      - num(deal.otherDirectCosts)
    );
  }

  function calcDeal(deal,salePosition,configInput){
    const config=normalizeConfig(configInput);
    const salePrice=num(deal.salePrice);
    const financedAmount=Math.max(0,num(deal.financedAmount));
    const lenderRatePct=Math.max(0,num(deal.lenderRatePct));
    const vehicleMargin=calcVehicleMargin(deal);
    const financePctRaw=salePrice>0 ? (financedAmount/salePrice)*100 : 0;
    const financePct=clamp(financePctRaw,0,Math.min(100,Math.max(1,num(config.financeCapPct))));
    const financeRevenue=round2(financedAmount*lenderRatePct/100);
    const volumeTier=getVolumeTier(salePosition,config);
    const marginBand=getMarginBand(vehicleMargin,config);
    const financeBracket=getFinanceCommission(volumeTier,financePct);
    const volumeFinanceCommission=round2(financeBracket.value);

    const eligible=salePosition>=2 && volumeFinanceCommission>0;
    const rawCommission=Math.max(0,volumeFinanceCommission*num(marginBand.factor));
    const calculatedCommission=round2(
      eligible
        ? clamp(rawCommission,Math.max(0,num(config.globalMinCommission)),Math.max(num(config.globalMinCommission),num(config.globalMaxCommission)))
        : 0
    );

    const commission=deal.status==="cancelled"
      ? 0
      : (deal.commissionSnapshot && Number.isFinite(Number(deal.commissionSnapshot.amount))
          ? num(deal.commissionSnapshot.amount)
          : calculatedCommission);

    const resultBeforeCommission=round2(vehicleMargin+financeRevenue);
    const resultAfterCommission=round2(resultBeforeCommission-commission);

    return {
      salePosition,
      salePrice,
      financedAmount,
      lenderRatePct,
      vehicleMargin,
      financePctRaw:round2(financePctRaw),
      financePctApplied:round2(financePct),
      financeRevenue,
      volumeTier,
      marginBand,
      financeBracket,
      volumeFinanceCommission,
      calculatedCommission,
      commission:round2(commission),
      resultBeforeCommission,
      resultAfterCommission,
      commissionRatioPct:resultBeforeCommission>0 ? round2((commission/resultBeforeCommission)*100) : 0,
      isLocked:!!deal.commissionSnapshot
    };
  }

  function monthKey(value){
    const d=value ? new Date(value) : new Date();
    if(Number.isNaN(d.getTime())) return "";
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  }

  function calcSellerMonth(deals,sellerId,month,configInput){
    const config=normalizeConfig(configInput);
    const rows=deals
      .filter(d=>d.sellerId===sellerId && d.status!=="cancelled" && monthKey(d.saleDate)===month)
      .sort((a,b)=>{
        const da=new Date(a.saleDate||a.createdAt||0).getTime();
        const db=new Date(b.saleDate||b.createdAt||0).getTime();
        if(da!==db) return da-db;
        return String(a.createdAt||"").localeCompare(String(b.createdAt||""));
      })
      .map((deal,index)=>({deal,calc:calcDeal(deal,index+1,config)}));

    const total=(selector)=>round2(rows.reduce((sum,row)=>sum+num(selector(row)),0));
    const totalPvp=total(r=>r.calc.salePrice);
    const totalFinanced=total(r=>r.calc.financedAmount);
    const totalMargin=total(r=>r.calc.vehicleMargin);
    const totalFinanceRevenue=total(r=>r.calc.financeRevenue);
    const totalCommission=total(r=>r.calc.commission);
    const totalResult=total(r=>r.calc.resultAfterCommission);

    return {
      rows,
      salesCount:rows.length,
      totalPvp,
      totalFinanced,
      financePenetrationPct:totalPvp>0 ? round2(totalFinanced/totalPvp*100) : 0,
      totalMargin,
      totalFinanceRevenue,
      totalCommission,
      totalResult,
      avgMarginPerCar:rows.length ? round2(totalMargin/rows.length) : 0,
      avgFinancedPerCar:rows.length ? round2(totalFinanced/rows.length) : 0
    };
  }

  function calcCompanyMonth(deals,sellers,month,configInput){
    const config=normalizeConfig(configInput);
    const sellerMaps=sellers.filter(s=>s.active!==false).map(s=>({
      seller:s,
      ...calcSellerMonth(deals,s.id,month,config)
    }));
    const total=(key)=>round2(sellerMaps.reduce((sum,m)=>sum+num(m[key]),0));
    const totalPvp=total("totalPvp");
    const totalFinanced=total("totalFinanced");
    return {
      sellerMaps,
      salesCount:sellerMaps.reduce((sum,m)=>sum+m.salesCount,0),
      totalPvp,
      totalFinanced,
      financePenetrationPct:totalPvp>0 ? round2(totalFinanced/totalPvp*100) : 0,
      totalMargin:total("totalMargin"),
      totalFinanceRevenue:total("totalFinanceRevenue"),
      totalCommission:total("totalCommission"),
      totalResult:total("totalResult")
    };
  }

  function lockCommission(deal,salePosition,configInput){
    const config=normalizeConfig(configInput);
    const calc=calcDeal(Object.assign({},deal,{commissionSnapshot:null}),salePosition,config);
    const next=clone(deal);
    next.commissionSnapshot={
      amount:calc.calculatedCommission,
      ruleVersion:num(config.version),
      lockedAt:new Date().toISOString(),
      salePosition,
      financePct:calc.financePctApplied,
      vehicleMargin:calc.vehicleMargin,
      volumeTierId:calc.volumeTier.id,
      marginBandId:calc.marginBand.id,
      financeBracket:clone(calc.financeBracket)
    };
    next.status="closed";
    return next;
  }

  root.DealerOpsEngine={
    FINANCE_POINTS:clone(FINANCE_POINTS),
    DEFAULT_CONFIG:clone(DEFAULT_CONFIG),
    clone,
    num,
    round2,
    normalizeConfig,
    monthKey,
    getVolumeTier,
    getMarginBand,
    getFinanceCommission,
    calcVehicleMargin,
    calcDeal,
    calcSellerMonth,
    calcCompanyMonth,
    lockCommission
  };
})(typeof globalThis!=="undefined" ? globalThis : window);
