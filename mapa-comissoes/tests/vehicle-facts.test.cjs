const test=require('node:test');const assert=require('node:assert/strict');
const {mergeFacts}=require('../lib/vehicle-facts');
test('partial provider cannot clear mileage price and trim',()=>{
 const {subject}=mergeFacts({mileage_km:82000,price:24900,trim:'Long Range'},{mileage_km:null,price:null}, {make:'Tesla',model:'Model 3'});
 assert.equal(subject.mileage_km,82000);assert.equal(subject.price,24900);assert.equal(subject.trim,'Long Range');
});
test('confirmed user field resists later unsupported inference',()=>{
 const previous=mergeFacts({}, {mileage_km:82000},null,[{field:'mileage_km',source:'user',status:'confirmed'}]).subject;
 const r=mergeFacts(previous,{mileage_km:98000});assert.equal(r.subject.mileage_km,82000);assert.equal(r.conflicts.length,1);
});
test('explicit user correction updates same vehicle and preserves other fields',()=>{
 const r=mergeFacts({make:'Tesla',mileage_km:82000},{mileage_km:98000},null,[{field:'mileage_km',source:'user',status:'confirmed'}]);
 assert.equal(r.subject.mileage_km,98000);assert.equal(r.subject.make,'Tesla');
});
test('registration first date discrepancy remains visible',()=>{
 const r=mergeFacts({year:2021},{},{year:2020,provider:'test'});assert.equal(r.subject.year,2021);assert.equal(r.conflicts[0].field,'year');
});
