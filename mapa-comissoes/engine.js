(function(root){
  "use strict";

  const DEFAULT_CONFIG = {
    version: 1,
    globalMaxCommission: 750,
    financeCapPct: 100,
    volumeTiers: [
      { id: "t0", label: "0–1", from: 0, to: 1, noFinance: 0, fullFinance: 0 },
      { id: "t1", label: "2–3", from: 2, to: 3, noFinance: 120, fullFinance: 180 },
      { id: "t2", label: "4–5", from: 4, to: 5, noFinance: 160, fullFinance: 240 },
      { id: "t3", label: "6–7", from: 6, to: 7, noFinance: 220, fullFinance: 330 },
      { id: "t4", label: "8–9", from: 8, to: 9, noFinance: 300, fullFinance: 450 },
      { id: "t5", label: "10–11", from: 10, to: 11, noFinance: 400, fullFinance: 600 },
      { id: "t6", label: "12+", from: 12, to: null, noFinance: 500, fullFinance: 750 }
    ],
    marginBands: [
      { id: "m0", label: "< 1.000 €", min: null, max: 999.99, factor: 0.50 },
      { id: "m1", label: "1.000–1.499 €", min: 1000, max: 1499.99, factor: 0.75 },
      { id: "m2", label: "1.500–2.499 €", min: 1500, max: 2499.99, factor: 1.00 },
      { id: "m3", label: "2.500–3.499 €", min: 2500, max: 3499.99, factor: 1.05 },
      { id: "m4", label: "≥ 3.500 €", min: 3500, max: null, factor: 1.10 }
    ]
  };

  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const clamp = (v,min,max) => Math.min(Math.max(v,min),max);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

  function getVolumeTier(position, config){
    const p = Math.max(0, Math.floor(num(position)));
    return config.volumeTiers.find(t => p >= num(t.from) && (t.to === null || t.to === "" || p <= num(t.to)))
      || config.volumeTiers[config.volumeTiers.length - 1];
  }

  function getMarginBand(margin, config){
    const m = num(margin);
    return config.marginBands.find(b => (b.min === null || m >= num(b.min)) && (b.max === null || b.max === "" || m <= num(b.max)))
      || { id:"fallback", label:"Sem fator", factor:1 };
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

  function calcDeal(deal, salePosition, configInput){
    const config = configInput || DEFAULT_CONFIG;
    const salePrice = num(deal.salePrice);
    const financedAmount = Math.max(0, num(deal.financedAmount));
    const lenderRatePct = Math.max(0, num(deal.lenderRatePct));
    const vehicleMargin = calcVehicleMargin(deal);
    const financePctRaw = salePrice > 0 ? (financedAmount / salePrice) * 100 : 0;
    const financePct = clamp(financePctRaw, 0, Math.max(1, num(config.financeCapPct)));
    const financeRevenue = round2(financedAmount * lenderRatePct / 100);
    const volumeTier = getVolumeTier(salePosition, config);
    const marginBand = getMarginBand(vehicleMargin, config);

    const normalizedFinance = clamp(financePct / Math.max(1, num(config.financeCapPct)), 0, 1);
    const volumeFinanceCommission = round2(
      num(volumeTier.noFinance)
      + (num(volumeTier.fullFinance) - num(volumeTier.noFinance)) * normalizedFinance
    );

    const calculatedCommission = round2(
      Math.min(
        Math.max(0, num(config.globalMaxCommission)),
        Math.max(0, volumeFinanceCommission * num(marginBand.factor))
      )
    );

    const commission = deal.status === "cancelled"
      ? 0
      : (deal.commissionSnapshot && Number.isFinite(Number(deal.commissionSnapshot.amount))
          ? num(deal.commissionSnapshot.amount)
          : calculatedCommission);

    const resultBeforeCommission = round2(vehicleMargin + financeRevenue);
    const resultAfterCommission = round2(resultBeforeCommission - commission);

    return {
      salePosition,
      salePrice,
      financedAmount,
      lenderRatePct,
      vehicleMargin,
      financePctRaw: round2(financePctRaw),
      financePctApplied: round2(financePct),
      financeRevenue,
      volumeTier,
      marginBand,
      volumeFinanceCommission,
      calculatedCommission,
      commission: round2(commission),
      resultBeforeCommission,
      resultAfterCommission,
      commissionRatioPct: resultBeforeCommission > 0 ? round2((commission / resultBeforeCommission) * 100) : 0,
      isLocked: !!deal.commissionSnapshot
    };
  }

  function monthKey(value){
    const d = value ? new Date(value) : new Date();
    if(Number.isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
  }

  function calcSellerMonth(deals, sellerId, month, configInput){
    const config = configInput || DEFAULT_CONFIG;
    const rows = deals
      .filter(d => d.sellerId === sellerId && d.status !== "cancelled" && monthKey(d.saleDate) === month)
      .sort((a,b) => {
        const da = new Date(a.saleDate || a.createdAt || 0).getTime();
        const db = new Date(b.saleDate || b.createdAt || 0).getTime();
        if(da !== db) return da - db;
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      })
      .map((deal,index) => ({ deal, calc: calcDeal(deal, index + 1, config) }));

    const total = (selector) => round2(rows.reduce((sum,row) => sum + num(selector(row)),0));
    const totalPvp = total(r => r.calc.salePrice);
    const totalFinanced = total(r => r.calc.financedAmount);
    const totalMargin = total(r => r.calc.vehicleMargin);
    const totalFinanceRevenue = total(r => r.calc.financeRevenue);
    const totalCommission = total(r => r.calc.commission);
    const totalResult = total(r => r.calc.resultAfterCommission);

    return {
      rows,
      salesCount: rows.length,
      totalPvp,
      totalFinanced,
      financePenetrationPct: totalPvp > 0 ? round2(totalFinanced / totalPvp * 100) : 0,
      totalMargin,
      totalFinanceRevenue,
      totalCommission,
      totalResult,
      avgMarginPerCar: rows.length ? round2(totalMargin / rows.length) : 0,
      avgFinancedPerCar: rows.length ? round2(totalFinanced / rows.length) : 0
    };
  }

  function calcCompanyMonth(deals, sellers, month, configInput){
    const config = configInput || DEFAULT_CONFIG;
    const sellerMaps = sellers.filter(s => s.active !== false).map(s => ({
      seller: s,
      ...calcSellerMonth(deals, s.id, month, config)
    }));
    const total = (key) => round2(sellerMaps.reduce((sum,m) => sum + num(m[key]),0));
    const totalPvp = total("totalPvp");
    const totalFinanced = total("totalFinanced");
    return {
      sellerMaps,
      salesCount: sellerMaps.reduce((sum,m) => sum + m.salesCount,0),
      totalPvp,
      totalFinanced,
      financePenetrationPct: totalPvp > 0 ? round2(totalFinanced / totalPvp * 100) : 0,
      totalMargin: total("totalMargin"),
      totalFinanceRevenue: total("totalFinanceRevenue"),
      totalCommission: total("totalCommission"),
      totalResult: total("totalResult")
    };
  }

  function lockCommission(deal, salePosition, configInput){
    const config = configInput || DEFAULT_CONFIG;
    const calc = calcDeal(Object.assign({}, deal, {commissionSnapshot:null}), salePosition, config);
    const next = clone(deal);
    next.commissionSnapshot = {
      amount: calc.calculatedCommission,
      ruleVersion: num(config.version),
      lockedAt: new Date().toISOString(),
      salePosition,
      financePct: calc.financePctApplied,
      vehicleMargin: calc.vehicleMargin,
      volumeTierId: calc.volumeTier.id,
      marginBandId: calc.marginBand.id
    };
    next.status = "closed";
    return next;
  }

  root.DealerOpsEngine = {
    DEFAULT_CONFIG: clone(DEFAULT_CONFIG),
    clone,
    num,
    round2,
    monthKey,
    getVolumeTier,
    getMarginBand,
    calcVehicleMargin,
    calcDeal,
    calcSellerMonth,
    calcCompanyMonth,
    lockCommission
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
