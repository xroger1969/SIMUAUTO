"use strict";

const assert = require("assert");

require("./engine.js");
const E = globalThis.DealerOpsEngine;

function almost(actual, expected, tolerance = 0.01) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`);
}

const cfg = E.DEFAULT_CONFIG;

const base = {
  salePrice: 25000,
  acquisitionCost: 21000,
  preparationCost: 500,
  warrantyCost: 500,
  otherDirectCosts: 500,
  lenderRatePct: 3.5,
  status: "draft"
};

for (const pct of [0, 25, 50, 75, 100, 125]) {
  const calc = E.calcDeal({ ...base, financedAmount: 25000 * pct / 100 }, 8, cfg);
  assert.equal(calc.financePctApplied, Math.min(pct, 100));
  assert.ok(calc.regularCommission >= cfg.globalMinCommission);
  assert.ok(calc.regularCommission <= cfg.globalMaxCommission);
  almost(calc.financedCapitalBonus, calc.financedAmount * cfg.financedCapitalBonusPct / 100);
  almost(calc.calculatedCommission, calc.regularCommission + calc.financedCapitalBonus);
}

const firstSaleNoFinance = E.calcDeal({ ...base, financedAmount: 0 }, 1, cfg);
const firstSaleHalfFinance = E.calcDeal({ ...base, financedAmount: 12500 }, 1, cfg);
const firstSaleFullFinance = E.calcDeal({ ...base, financedAmount: 25000 }, 1, cfg);
almost(firstSaleNoFinance.calculatedCommission, 120);
almost(firstSaleHalfFinance.regularCommission, 140);
almost(firstSaleHalfFinance.financedCapitalBonus, 125);
almost(firstSaleHalfFinance.calculatedCommission, 265);
almost(firstSaleFullFinance.regularCommission, 160);
almost(firstSaleFullFinance.financedCapitalBonus, 250);
almost(firstSaleFullFinance.calculatedCommission, 410);
assert.ok(firstSaleHalfFinance.calculatedCommission > firstSaleNoFinance.calculatedCommission);
assert.ok(firstSaleFullFinance.calculatedCommission > firstSaleHalfFinance.calculatedCommission);

const lowMarginNoFinance = E.calcDeal({
  ...base,
  salePrice: 22000,
  acquisitionCost: 21000,
  preparationCost: 500,
  warrantyCost: 500,
  otherDirectCosts: 500,
  financedAmount: 0
}, 1, cfg);
const lowMarginHalfFinance = E.calcDeal({
  ...base,
  salePrice: 22000,
  acquisitionCost: 21000,
  preparationCost: 500,
  warrantyCost: 500,
  otherDirectCosts: 500,
  financedAmount: 11000
}, 1, cfg);
assert.ok(lowMarginHalfFinance.calculatedCommission > lowMarginNoFinance.calculatedCommission,
  "financing incentives must remain visible even with a low margin factor");
almost(lowMarginHalfFinance.financedCapitalBonus, 110);

const negative = E.calcDeal({
  ...base,
  salePrice: 22000,
  acquisitionCost: 23000,
  financedAmount: 0
}, 1, cfg);
assert.ok(Number.isFinite(negative.vehicleMargin));
assert.ok(Number.isFinite(negative.resultAfterCommission));

const overFinance = E.calcDeal({ ...base, financedAmount: 40000 }, 8, cfg);
almost(overFinance.financePctRaw, 160);
almost(overFinance.financePctApplied, 100);

const locked = E.calcDeal({
  ...base,
  status: "closed",
  financedAmount: 18750,
  commissionSnapshot: {
    amount: 333,
    salePosition: 4,
    financePct: 75,
    vehicleMargin: 2500,
    financeRevenue: 656.25,
    baseCommission: 240,
    marginFactor: 1,
    resultBeforeCommission: 3156.25,
    resultAfterCommission: 2823.25
  }
}, 4, { ...cfg, globalMinCommission: 700, globalMaxCommission: 700 });

almost(locked.commission, 333);
almost(locked.vehicleMargin, 2500);
almost(locked.resultAfterCommission, 2823.25);
assert.equal(locked.isLocked, true);

const deals = [
  {
    ...base,
    id: "o1",
    sellerId: "seller",
    saleDate: "2026-09-01",
    createdAt: "2026-09-01T10:00:00Z",
    status: "closed",
    financedAmount: 0,
    commissionSnapshot: {
      amount: 120,
      salePosition: 1,
      financePct: 0,
      vehicleMargin: 2500,
      financeRevenue: 0,
      baseCommission: 120,
      marginFactor: 1,
      resultBeforeCommission: 2500,
      resultAfterCommission: 2380
    }
  },
  {
    ...base,
    id: "d1",
    sellerId: "seller",
    saleDate: "2026-09-02",
    createdAt: "2026-09-02T10:00:00Z",
    status: "draft",
    financedAmount: 12500
  },
  {
    ...base,
    id: "d2",
    sellerId: "seller",
    saleDate: "2026-09-03",
    createdAt: "2026-09-03T10:00:00Z",
    status: "draft",
    financedAmount: 18750
  }
];

const month = E.calcSellerMonth(deals, "seller", "2026-09", cfg);
assert.deepEqual(month.rows.map(row => row.calc.salePosition), [1, 2, 3]);
assert.equal(month.salesCount, 1);
assert.equal(month.draftCount, 2);
assert.equal(month.projectedSalesCount, 3);

const afterDelete = E.calcSellerMonth(deals.slice(1), "seller", "2026-09", cfg);
assert.deepEqual(afterDelete.rows.map(row => row.calc.salePosition), [1, 2]);
assert.equal(afterDelete.salesCount, 0);
assert.equal(afterDelete.draftCount, 2);
assert.equal(afterDelete.projectedSalesCount, 2);
assert.equal(afterDelete.totalResult, 0);
assert.ok(afterDelete.projectedTotalResult > 0);

const frozenOutOfOrder = E.calcSellerMonth([
  {
    ...base,
    id: "late",
    sellerId: "seller",
    saleDate: "2026-09-20",
    createdAt: "2026-09-20T10:00:00Z",
    status: "closed",
    financedAmount: 0,
    commissionSnapshot: {
      amount: 120,
      salePosition: 1,
      financePct: 0,
      vehicleMargin: 2500,
      financeRevenue: 0,
      baseCommission: 120,
      marginFactor: 1,
      resultBeforeCommission: 2500,
      resultAfterCommission: 2380
    }
  },
  {
    ...base,
    id: "early",
    sellerId: "seller",
    saleDate: "2026-09-05",
    createdAt: "2026-09-21T10:00:00Z",
    status: "closed",
    financedAmount: 0,
    commissionSnapshot: {
      amount: 120,
      salePosition: 2,
      financePct: 0,
      vehicleMargin: 2500,
      financeRevenue: 0,
      baseCommission: 120,
      marginFactor: 1,
      resultBeforeCommission: 2500,
      resultAfterCommission: 2380
    }
  },
  {
    ...base,
    id: "next-draft",
    sellerId: "seller",
    saleDate: "2026-09-01",
    createdAt: "2026-09-22T10:00:00Z",
    status: "draft",
    financedAmount: 12500
  }
], "seller", "2026-09", cfg);
const nextDraftRow = frozenOutOfOrder.rows.find(row => row.deal.id === "next-draft");
assert.equal(nextDraftRow.calc.salePosition, 3,
  "draft preview must use the next unused frozen monthly position, not sale-date order");

const tesla = E.calcSellerMonth([{
  id: "tesla",
  sellerId: "seller",
  saleDate: "2026-09-28",
  createdAt: "2026-09-28T10:30:26Z",
  status: "draft",
  salePrice: 21990,
  acquisitionCost: 17550,
  preparationCost: 560,
  warrantyCost: 0,
  otherDirectCosts: 0,
  financedAmount: 11000,
  lenderRatePct: 3.5
}], "seller", "2026-09", cfg);

almost(tesla.projectedTotalFinanced, 11000);
almost(tesla.projectedTotalMargin, 3880);
almost(tesla.projectedTotalCommission, 250.01);
almost(tesla.projectedTotalResult, 4014.99);

const capitalBonusExample = E.calcDeal({ ...base, financedAmount: 18000 }, 1, cfg);
almost(capitalBonusExample.financedCapitalBonus, 180);
almost(capitalBonusExample.calculatedCommission, capitalBonusExample.regularCommission + 180);

console.log("engine.test.js: OK");
