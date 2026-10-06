const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const load=()=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(__dirname+'/../comparador-auto-pro/commercial-input.js','utf8')).toString('base64'));
test('explicit Portuguese margin amounts are interpreted consistently',async()=>{
 const {commercialInstruction}=await load();for(const text of ['Quero ganhar pelo menos 3.000 €','Quero ganhar pelo menos 3000 euros','Quero ganhar pelo menos 3 000 €'])assert.deepEqual(commercialInstruction(text),{type:'target_margin',value:3000});
});
test('purchase scenario preserves the exact price',async()=>{const {commercialInstruction}=await load();assert.deepEqual(commercialInstruction('E se conseguir comprar por 18.000 €?'),{type:'purchase_price',value:18000});});
test('mixed vehicle instructions cannot silently change money assumptions',async()=>{const {commercialInstruction}=await load();for(const text of ['Tem 120.000 km','É importado','Quero ganhar pelo menos 3000 € mas tem um dano','Vende por 18.000 €'])assert.equal(commercialInstruction(text),null);});
