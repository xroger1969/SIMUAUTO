"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

new Function(app);

const qIds = [...app.matchAll(/\\bq\\("([^"]+)"\\)/g)].map(m => m[1]);
const htmlIds = [...html.matchAll(/\\bid="([^"]+)"/g)].map(m => m[1]);
const uniqueHtml = new Set(htmlIds);

for (const id of new Set(qIds)) {
  assert.ok(uniqueHtml.has(id), `app.js references missing DOM id: ${id}`);
}

assert.equal(htmlIds.length, uniqueHtml.size, "duplicate HTML ids found");

for (const marker of [
  "data-edit-deal",
  "data-confirm-deal",
  "data-delete-deal",
  "data-cancel-deal",
  "dealDeleteButton",
  "positionRowActionMenu",
  "closeRowActionMenus",
  "friendlyDealError",
  "deals_active_stock_unique",
  "deals_active_plate_unique"
]) {
  assert.ok(app.includes(marker) || html.includes(marker), `missing UI contract: ${marker}`);
}

assert.ok(/\.row-actions-menu\s*\{[^}]*position\s*:\s*fixed/.test(css),
  "row action menu must be fixed so table overflow cannot clip Edit/Tornar oficial");
assert.ok(/z-index\s*:\s*1000/.test(css), "row action menu must appear above the table");

for (const id of ["dealAcquisition", "dealPrep", "dealWarranty", "dealOther", "dealFinanced", "dealLenderRate"]) {
  assert.ok(new RegExp('id="' + id + '"[^>]*min="0"').test(html),
    id + " must prevent negative values in the browser");
}
assert.ok(/id="dealSalePrice"[^>]*min="0\.01"/.test(html),
  "PVP must be greater than zero in the browser");

console.log("ui-contract.test.js: OK");
