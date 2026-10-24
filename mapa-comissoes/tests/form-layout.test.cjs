const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../comparador-auto-pro');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'form-layout.css'),'utf8');
test('centred form rules load after existing themes with a dedicated cache version',()=>{
  const layout=html.indexOf('form-layout.css?v=20261024-button-states-v1');
  assert.ok(layout>html.indexOf('tax-simulator.css?')&&layout>html.indexOf('light-panels.css?'));
});
test('empty mobile page cannot reinstate the old viewport-sized spacer',()=>{
  assert.match(css,/#app:has\(#result.hidden\):has\(#progressPanel.hidden\) > \.hero/);
  assert.match(css,/flex:0 0 auto!important/);
  assert.match(css,/min-height:0!important/);
  assert.match(css,/padding:20px 0 18px!important/);
  assert.doesNotMatch(css,/(?:\d+(?:s|d)?vh|car-sunset|body\s*[:{])/);
});
test('entry icons participate in layout instead of overlapping input text',()=>{
  assert.match(css,/#analyzeForm \.input-tools\{position:static/);
  assert.match(css,/flex:1 1 0;min-width:0;width:0/);
  assert.match(css,/min-width:44px;min-height:44px/);
  assert.match(css,/font-size:16px/);
});
test('all existing input, reset, history and ENI hooks remain available',()=>{
  for(const id of ['vehicleUrl','vehicleMileage','vehicleMargin','vehiclePhoto','micBtn','resetSearchBtn','analyzeBtn','startNewAnalysisBtn','historyBtn','historySnapshotNotice','taxSimulator'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/placeholder="Matrícula ou link"/);
  assert.match(html,/aria-label="Link, matrícula ou descrição da viatura"/);
});
