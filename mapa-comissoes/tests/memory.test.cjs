const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require('node:path').join(__dirname,'../comparador-auto-pro/memory.js'),'utf8')).toString('base64'));
test('rules are reused only for matching vehicles',async()=>{const {relevantMemories}=await modulePromise;const rules=[{statement:'motor sensível',scope:{make:'Citroën',model:'C4'}},{statement:'Tesla líquido',scope:{make:'Tesla'}},{statement:'minha política geral',scope:{}}];assert.deepEqual(relevantMemories(rules,{make:'Citroen',model:'C4'}).map(x=>x.statement),['motor sensível','minha política geral'])});
test('unknown year cannot match a year-limited rule',async()=>{const {relevantMemories}=await modulePromise;assert.equal(relevantMemories([{statement:'observação',scope:{year_min:2020,year_max:2022}}],{}).length,0)});
test('inactive or incompatible mileage rules never leak into analysis',async()=>{const {relevantMemories}=await modulePromise;assert.equal(relevantMemories([{statement:'inactive',active:false},{statement:'high mileage',scope:{mileage_min:100000}}],{mileage_km:50000}).length,0)});
test('a diesel observation cannot influence the petrol, hybrid or unknown-fuel version',async()=>{
  const {relevantMemories}=await modulePromise;
  const rule={statement:'vende-se lentamente',scope:{make:'Volvo',model:'V90',fuel:'gasóleo'}};
  assert.equal(relevantMemories([rule],{make:'Volvo',model:'V90',fuel:'diesel'}).length,1);
  for(const fuel of ['petrol','hybrid',null])assert.equal(relevantMemories([rule],{make:'Volvo',model:'V90',fuel}).length,0);
});
test('commercial identity aliases keep learning usable without broadening to a different Tesla version',async()=>{
  require('../comparador-auto-pro/commercial-identity.js');
  const {relevantMemories}=await modulePromise;
  const rule={statement:'observação do comerciante',scope:{make:'Tesla',model:'MODEL Y LONG RANGE AWD',fuel:'elétrico',year_min:2021,year_max:2021}};
  assert.equal(relevantMemories([rule],{make:'Tesla',model:'Model Y',trim:'Long Range AWD',fuel:'electric',year:2021}).length,1);
  assert.equal(relevantMemories([rule],{make:'Tesla',model:'Model Y',trim:'Standard Range RWD',fuel:'electric',year:2021}).length,0);
  assert.equal(relevantMemories([rule],{make:'Tesla',model:'Model Y',trim:'Long Range AWD',fuel:'electric',year:2020}).length,0);
});
test('UI exposes one entry field plus discreet evidence and assumptions',()=>{const html=fs.readFileSync(require('node:path').join(__dirname,'../comparador-auto-pro/index.html'),'utf8');assert.ok(html.includes('id="vehicleUrl"'));assert.equal((html.match(/id="vehicleUrl"/g)||[]).length,1);assert.ok(html.includes('id="qualityNote"'));assert.ok(html.includes('id="allComparableList"'));assert.ok(html.includes('id="excludedList"'));assert.ok(html.includes('id="assumptionsForm"'));assert.equal((html.match(/id="memoryCount"/g)||[]).length,1)});
