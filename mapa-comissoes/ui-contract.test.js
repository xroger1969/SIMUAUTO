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
  "closeRowActionMenus"
]) {
  assert.ok(app.includes(marker) || html.includes(marker), `missing UI contract: ${marker}`);
}

assert.ok(/\\.row-actions-menu\\{[^}]*position:fixed/.test(css),
  "row action menu must be fixed so table overflow cannot clip Edit/Tornar oficial");
assert.ok(/z-index:1000/.test(css), "row action menu must appear above the table");

console.log("ui-contract.test.js: OK");
