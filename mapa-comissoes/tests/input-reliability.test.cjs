const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const input=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../comparador-auto-pro/input.js'),'utf8')).toString('base64'));

test('plates copied from iPhone text accept typographic dashes and retain the exact provider identity',async()=>{
  const {parseVehicleInput,formatVehiclePlate}=await input;
  for(const plate of ['AA — 41 — BB','aa–41–bb','AA‑41‑BB','AA−41−BB','ＡＡ－４１－ＢＢ','AA\u00a041\u00a0BB']){
    assert.equal(formatVehiclePlate(plate),'AA-41-BB');
    assert.equal(parseVehicleInput(plate).registration,'AA-41-BB');
    assert.equal(parseVehicleInput(plate).sourceUrl,'plate:AA41BB');
  }
});

test('plate normalisation does not turn incomplete plates, other identifiers or descriptions into a lookup',async()=>{
  const {parseVehicleInput,formatVehiclePlate}=await input;
  for(const value of ['AA—41—B','AA—41—BB—7','MINI Countryman — 2017','vin:AA41BB12345678901','AA/41/BB'])assert.equal(formatVehiclePlate(value),null);
  assert.equal(parseVehicleInput('MINI Countryman — 2017').registration,undefined);
});
