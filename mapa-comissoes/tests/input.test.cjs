const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../comparador-auto-pro/input.js'),'utf8');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('Tesla short description enters manual AI research without a fabricated URL',async()=>{const {parseVehicleInput}=await modulePromise;const r=parseVehicleInput('Tesla Y dual motor 2023');assert.equal(r.mode,'manual');assert.equal(r.url,null);assert.equal(r.description,'Tesla Y dual motor 2023')});
test('URL mode preserves automatic AUTO1 source recognition',async()=>{const {parseVehicleInput}=await modulePromise;const r=parseVehicleInput('https://auto1.com/pt/app/merchant/car/BD03818?x=1');assert.equal(r.mode,'url');assert.equal(r.sourceDomain,'www.auto1.com')});
test('unknown km or trim require clarification before purchase ceiling',async()=>{const {manualMissing}=await modulePromise;assert.deepEqual(manualMissing({year:2023}),['quilómetros','versão exata']);assert.deepEqual(manualMissing({year:2023,mileage_km:0,trim:'Long Range'}),[])});
test('unsafe schemes and credentials are rejected instead of passed to AI as links',async()=>{const {parseVehicleInput}=await modulePromise;for(const raw of ['javascript:alert(1)','ftp://example.com','https://user:pass@example.com'])assert.throws(()=>parseVehicleInput(raw))});
test('input supports text as well as links and Spottd is an explicit external link',()=>{const html=fs.readFileSync(require('node:path').join(__dirname,'../comparador-auto-pro/index.html'),'utf8');assert.match(html,/id="vehicleUrl" type="text"/);assert.ok(html.includes('apps.apple.com/pt/app/spottd/id1516876698'))});
test('all standard Portuguese plate formats route to provider',async()=>{const {parseVehicleInput}=await modulePromise;for(const raw of ['AA-00-AA','00-AA-00','00-00-AA','AA-00-00','aa00aa'])assert.ok(parseVehicleInput(raw).registration);assert.equal(parseVehicleInput('Tesla Model 3').registration,undefined)});

test('shared iPhone text extracts the embedded link and ignores the introductory phrase',async()=>{
  const {parseVehicleInput}=await modulePromise;
  const r=parseVehicleInput('Dê uma vista de olhos neste Tesla Model 3: https://example.com/carro/123?x=1');
  assert.equal(r.mode,'url');
  assert.equal(r.url.toString(),'https://example.com/carro/123?x=1');
  assert.equal(r.description,'');
});

test('matrícula escrita sem hífens ou maiúsculas é formatada antes da pesquisa',async()=>{
  const {parseVehicleInput,formatVehiclePlate}=await modulePromise;
  for(const raw of ['bm55dn','BM55DN','bm-55-dn','Bm 55 dN','bm.55.dn']){
    assert.equal(formatVehiclePlate(raw),'BM-55-DN');
    const result=parseVehicleInput(raw);
    assert.equal(result.registration,'BM-55-DN');
    assert.equal(result.description,'BM-55-DN');
    assert.equal(result.sourceUrl,'plate:BM55DN');
    assert.equal(result.mode,'manual');
  }
  assert.equal(formatVehiclePlate('55bm55'),'55-BM-55');
  assert.equal(formatVehiclePlate('00aa00'),'00-AA-00');
  assert.equal(formatVehiclePlate('AA0000'),'AA-00-00');
  assert.equal(formatVehiclePlate('Tesla Y 2023'),null);
  assert.equal(formatVehiclePlate('bm55d'),null);
  assert.equal(formatVehiclePlate('bm55dn7'),null);
});
test('o formulário apresenta automaticamente a matrícula validada',()=>{
  const script=fs.readFileSync(require('node:path').join(__dirname,'../comparador-auto-pro/app-v2.js'),'utf8');
  assert.match(script,/addEventListener\("input",ev=>\{/);
  assert.match(script,/formatVehiclePlate\(ev.target.value\)/);
  assert.match(script,/else if\(entry.registration\)q\("vehicleUrl"\).value=entry.registration;/);
});
