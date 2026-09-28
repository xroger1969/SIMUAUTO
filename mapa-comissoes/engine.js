(function(root){
  "use strict";

  const FINANCE_POINTS = [0,25,50,75,100];

  const DEFAULT_CONFIG = {
    version: 5,
    globalMinCommission: 120,
    globalMaxCommission: 750,
    financeCapPct: 100,
    volumeTiers: [
      { id:"t0", label:"0–1", from:0, to:1, financeGrid:{"0":120,"25":130,"50":140,"75":150,"100":160} },
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
        grid[String(point)]=Math.max(0,round2(legacyMin+(legacyMax-legacyMin)*(point/100)));
      }else{
        grid[String(point)]=num(defaultTier.financeGrid[String(point)]);
      }
    });
    return grid;
  }

  function tierLabel(from,to){
    return to===null ? from+"+" : from+"–"+to;
  }

  function bandLabel(min,max){
    if(min===null && max===null) return "Todas as margens";
    if(min===null) return "< "+Math.ceil(num(max)+0.01).toLocaleString("pt-PT")+" €";
    if(max===null) return "≥ "+Math.round(num(min)).toLocaleString("pt-PT")+" €";
    return Math.round(num(min)).toLocaleString("pt-PT")+"–"+Math.round(num(max)).toLocaleString("pt-PT")+" €";
  }

  function normalizeConfig(input){
    const source=input && typeof input==="object" ? input : {};
    const out=clone(DEFAULT_CONFIG);

    if(Number.isFinite(Number(source.version))) out.version=num(source.version);
    if(Number.isFinite(Number(source.globalMinCommission))) out.globalMinCommission=Math.max(0,num(source.globalMinCommission));
    if(Number.isFinite(Number(source.globalMaxCommission))) out.globalMaxCommission=Math.max(out.globalMinCommission,num(source.globalMaxCommission));
    if(Number.isFinite(Number(source.financeCapPct))) out.financeCapPct=clamp(num(source.financeCapPct),1,100);

    const tierSource=Array.isArray(source.volumeTiers) && source.volumeTiers.length ? source.volumeTiers : DEFAULT_CONFIG.volumeTiers;
    out.volumeTiers=tierSource.map((src,index)=>{
      const fallback=DEFAULT_CONFIG.volumeTiers[Math.min(index,DEFAULT_CONFIG.volumeTiers.length-1)];
      const fromCandidate=Number(src && src.from);
      const toRaw=src && src.to;
      const toCandidate=toRaw===null || toRaw==="" || typeof toRaw==="undefined" ? null : Number(toRaw);
      const from=Number.isFinite(fromCandidate) && fromCandidate>=0 ? Math.floor(fromCandidate) : fallback.from;
      const to=toCandidate===null ? null : (Number.isFinite(toCandidate) && toCandidate>=from ? Math.floor(toCandidate) : fallback.to);
      return {
        id:typeof src?.id==="string" && src.id ? src.id : "t"+index,
        label:tierLabel(from,to),
        from,
        to,
        financeGrid:normalizeFinanceGrid(src,fallback)
      };
    });

    const bandSource=Array.isArray(source.marginBands) && source.marginBands.length ? source.marginBands : DEFAULT_CONFIG.marginBands;
    out.marginBands=bandSource.map((src,index)=>{
      const fallback=DEFAULT_CONFIG.marginBands[Math.min(index,DEFAULT_CONFIG.marginBands.length-1)];
      const min=src?.min===null ? null : (src?.min==="" || typeof src?.min==="undefined"
        ? fallback.min
        : (Number.isFinite(Number(src.min)) ? num(src.min) : fallback.min));
      const max=src?.max===null ? null : (src?.max==="" || typeof src?.max==="undefined"
        ? fallback.max
        : (Number.isFinite(Number(src.max)) ? num(src.max) : fallback.max));
      return {
        id:typeof src?.id==="string" && src.id ? src.id : "m"+index,
        label:bandLabel(min,max),
        min,
        max,
        factor:Number.isFinite(Number(src?.factor)) ? Math.max(0,num(src.factor)) : fallback.factor
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
    const snapshot=deal && deal.commissionSnapshot && typeof deal.commissionSnapshot==="object"
      ? deal.commissionSnapshot
      : null;
    const locked=!!snapshot && (deal.status==="closed" || deal.status==="cancelled");
    const snapNum=(key,fallback)=>{
      const value=snapshot ? snapshot[key] : null;
      return value!==null && typeof value!=="undefined" && Number.isFinite(Number(value))
        ? num(value)
        : fallback;
    };

    const calculatedVehicleMargin=calcVehicleMargin(deal);
    const financePctRaw=salePrice>0 ? (financedAmount/salePrice)*100 : 0;
    const calculatedFinancePct=clamp(financePctRaw,0,Math.min(100,Math.max(1,num(config.financeCapPct))));
    const calculatedFinanceRevenue=round2(financedAmount*lenderRatePct/100);

    const vehicleMargin=locked ? snapNum("vehicleMargin",calculatedVehicleMargin) : calculatedVehicleMargin;
    const financePct=locked ? snapNum("financePct",calculatedFinancePct) : calculatedFinancePct;
    const financeRevenue=locked ? snapNum("financeRevenue",calculatedFinanceRevenue) : calculatedFinanceRevenue;

    const volumeTier=getVolumeTier(salePosition,config);
    const marginBandBase=getMarginBand(vehicleMargin,config);
    const financeBracket=getFinanceCommission(volumeTier,financePct);
    const volumeFinanceCommission=round2(locked ? snapNum("baseCommission",financeBracket.value) : financeBracket.value);
    const marginBand=locked
      ? Object.assign({},marginBandBase,{factor:snapNum("marginFactor",marginBandBase.factor)})
      : marginBandBase;

    const eligible=salePosition>=1 && volumeFinanceCommission>0;
    const noFinanceBase=Math.max(0,num(volumeTier.financeGrid["0"]));
    const vehicleComponent=Math.max(0,noFinanceBase*num(marginBand.factor));
    const financeBonus=Math.max(0,volumeFinanceCommission-noFinanceBase);
    const calculatedCommission=round2(
      eligible
        ? Math.min(
            Math.max(num(config.globalMinCommission),num(config.globalMaxCommission)),
            Math.max(0,num(config.globalMinCommission),vehicleComponent)+financeBonus
          )
        : 0
    );

    const commission=locked
      ? snapNum("amount",calculatedCommission)
      : calculatedCommission;

    const calculatedResultBefore=round2(vehicleMargin+financeRevenue);
    const resultBeforeCommission=round2(
      locked ? snapNum("resultBeforeCommission",calculatedResultBefore) : calculatedResultBefore
    );
    const calculatedResultAfter=round2(resultBeforeCommission-commission);
    const resultAfterCommission=round2(
      locked ? snapNum("resultAfterCommission",calculatedResultAfter) : calculatedResultAfter
    );

    return {
      salePosition,
      salePrice,
      financedAmount,
      lenderRatePct,
      vehicleMargin:round2(vehicleMargin),
      financePctRaw:round2(financePctRaw),
      financePctApplied:round2(financePct),
      financeRevenue:round2(financeRevenue),
      volumeTier,
      marginBand,
      financeBracket,
      volumeFinanceCommission,
      noFinanceBase:round2(noFinanceBase),
      vehicleComponent:round2(vehicleComponent),
      financeBonus:round2(financeBonus),
      calculatedCommission,
      commission:round2(commission),
      resultBeforeCommission,
      resultAfterCommission,
      commissionRatioPct:resultBeforeCommission>0 ? round2((commission/resultBeforeCommission)*100) : 0,
      isLocked:locked
    };
  }

  function monthKey(value){
    const d=value ? new Date(value) : new Date();
    if(Number.isNaN(d.getTime())) return "";
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  }

  function calcSellerMonth(deals,sellerId,month,configInput){
    const config=normalizeConfig(configInput);
    const monthDeals=deals
      .filter(d=>d.sellerId===sellerId && monthKey(d.saleDate)===month)
      .sort((a,b)=>{
        const da=new Date(a.saleDate||a.createdAt||0).getTime();
        const db=new Date(b.saleDate||b.createdAt||0).getTime();
        if(da!==db) return da-db;
        return String(a.createdAt||"").localeCompare(String(b.createdAt||""));
      });

    let officialPosition=0;
    let previewDraftsSeen=0;
    const rows=monthDeals.map(deal=>{
      let salePosition;
      if(deal.status==="closed"){
        officialPosition+=1;
        salePosition=deal.commissionSnapshot?.salePosition || officialPosition;
      }else if(deal.status==="cancelled"){
        salePosition=deal.commissionSnapshot?.salePosition || Math.max(1,officialPosition+1);
      }else{
        salePosition=Math.max(1,officialPosition+previewDraftsSeen+1);
        previewDraftsSeen+=1;
      }
      return {deal,calc:calcDeal(deal,salePosition,config)};
    });

    const officialRows=rows.filter(r=>r.deal.status==="closed");
    const projectedRows=rows.filter(r=>r.deal.status!=="cancelled");
    const totalFor=(source,selector)=>round2(source.reduce((sum,row)=>sum+num(selector(row)),0));

    const totalPvp=totalFor(officialRows,r=>r.calc.salePrice);
    const totalFinanced=totalFor(officialRows,r=>r.calc.financedAmount);
    const totalMargin=totalFor(officialRows,r=>r.calc.vehicleMargin);
    const totalFinanceRevenue=totalFor(officialRows,r=>r.calc.financeRevenue);
    const totalCommission=totalFor(officialRows,r=>r.calc.commission);
    const totalResult=totalFor(officialRows,r=>r.calc.resultAfterCommission);

    const projectedTotalPvp=totalFor(projectedRows,r=>r.calc.salePrice);
    const projectedTotalFinanced=totalFor(projectedRows,r=>r.calc.financedAmount);
    const projectedTotalMargin=totalFor(projectedRows,r=>r.calc.vehicleMargin);
    const projectedTotalFinanceRevenue=totalFor(projectedRows,r=>r.calc.financeRevenue);
    const projectedTotalCommission=totalFor(projectedRows,r=>r.deal.status==="draft" ? r.calc.calculatedCommission : r.calc.commission);
    const projectedTotalResult=totalFor(projectedRows,r=>r.deal.status==="draft"
      ? (r.calc.vehicleMargin+r.calc.financeRevenue-r.calc.calculatedCommission)
      : r.calc.resultAfterCommission);

    const draftCount=rows.filter(r=>r.deal.status==="draft").length;
    const cancelledCount=rows.filter(r=>r.deal.status==="cancelled").length;

    return {
      rows,
      officialRows,
      projectedRows,
      salesCount:officialRows.length,
      projectedSalesCount:projectedRows.length,
      draftCount,
      cancelledCount,
      totalPvp,
      totalFinanced,
      financePenetrationPct:totalPvp>0 ? round2(totalFinanced/totalPvp*100) : 0,
      totalMargin,
      totalFinanceRevenue,
      totalCommission,
      totalResult,
      avgMarginPerCar:officialRows.length ? round2(totalMargin/officialRows.length) : 0,
      avgFinancedPerCar:officialRows.length ? round2(totalFinanced/officialRows.length) : 0,
      projectedTotalPvp,
      projectedTotalFinanced,
      projectedFinancePenetrationPct:projectedTotalPvp>0 ? round2(projectedTotalFinanced/projectedTotalPvp*100) : 0,
      projectedTotalMargin,
      projectedTotalFinanceRevenue,
      projectedTotalCommission,
      projectedTotalResult,
      projectedAvgMarginPerCar:projectedRows.length ? round2(projectedTotalMargin/projectedRows.length) : 0,
      projectedAvgFinancedPerCar:projectedRows.length ? round2(projectedTotalFinanced/projectedRows.length) : 0
    };
  }

  function calcCompanyMonth(deals,sellers,month,configInput){
    const config=normalizeConfig(configInput);
    const sellerMaps=sellers.map(s=>({
      seller:s,
      ...calcSellerMonth(deals,s.id,month,config)
    }));
    const total=(key)=>round2(sellerMaps.reduce((sum,m)=>sum+num(m[key]),0));
    const totalPvp=total("totalPvp");
    const totalFinanced=total("totalFinanced");
    const projectedTotalPvp=total("projectedTotalPvp");
    const projectedTotalFinanced=total("projectedTotalFinanced");
    return {
      sellerMaps,
      salesCount:sellerMaps.reduce((sum,m)=>sum+m.salesCount,0),
      projectedSalesCount:sellerMaps.reduce((sum,m)=>sum+m.projectedSalesCount,0),
      draftCount:sellerMaps.reduce((sum,m)=>sum+m.draftCount,0),
      cancelledCount:sellerMaps.reduce((sum,m)=>sum+m.cancelledCount,0),
      totalPvp,
      totalFinanced,
      financePenetrationPct:totalPvp>0 ? round2(totalFinanced/totalPvp*100) : 0,
      totalMargin:total("totalMargin"),
      totalFinanceRevenue:total("totalFinanceRevenue"),
      totalCommission:total("totalCommission"),
      totalResult:total("totalResult"),
      projectedTotalPvp,
      projectedTotalFinanced,
      projectedFinancePenetrationPct:projectedTotalPvp>0 ? round2(projectedTotalFinanced/projectedTotalPvp*100) : 0,
      projectedTotalMargin:total("projectedTotalMargin"),
      projectedTotalFinanceRevenue:total("projectedTotalFinanceRevenue"),
      projectedTotalCommission:total("projectedTotalCommission"),
      projectedTotalResult:total("projectedTotalResult")
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
