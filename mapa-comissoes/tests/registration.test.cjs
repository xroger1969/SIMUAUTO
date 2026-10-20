const {test}=require('node:test');const assert=require('node:assert/strict');
const {lookupRegistration,parseRegistration}=require('../lib/registration');
const xml=data=>'<Vehicle><vehicleJson>'+JSON.stringify(data).replaceAll('&','&amp;').replaceAll('"','&quot;')+'</vehicleJson></Vehicle>';
test('provider data retains unknowns and explicit origin',()=>{const r=parseRegistration(xml({CarMake:{CurrentTextValue:'TESLA'},CarModel:'MODEL Y',RegistrationYear:'2023'}));assert.equal(r.make,'TESLA');assert.equal(r.trim,null);assert.equal(r.origin,'unknown');assert.equal(parseRegistration(xml({CarMake:'VW',CarModel:'ID.4',Imported:1})).origin,'imported')});
test('free provider is attempted without paid credentials and invalid plates never call a provider',async()=>{let calls=0;const fetcher=async()=>{calls++;throw new TypeError('offline')};await assert.rejects(lookupRegistration('AA00AA',{username:'',fetcher}),{status:502});assert.equal(calls,1);await assert.rejects(lookupRegistration('not a plate',{username:'x',fetcher}),{status:400});assert.equal(calls,1)});
test('lookup uses documented HTTPS POST and decodes response',async()=>{let seen;const r=await lookupRegistration('aa-00-aa',{username:'test-only',fetcher:async(url,options)=>{seen={url,options};return {ok:true,text:async()=>xml({CarMake:'Tesla',CarModel:'Y',Imported:0})}}});assert.equal(seen.options.method,'POST');assert.equal(seen.options.body.get('RegistrationNumber'),'AA00AA');assert.equal(r.origin,'national')});
test('provider failures do not leak credentials or fabricate vehicle',async()=>{await assert.rejects(lookupRegistration('AA00AA',{username:'secret',fetcher:async()=>({ok:false})}),e=>!e.message.includes('secret'));assert.throws(()=>parseRegistration('<error/>'));assert.throws(()=>parseRegistration(xml({Error:'not found'})))});


test('Spottd identifies a plate first and correctly converts kW to CV',async()=>{
  const {parseSpottdData}=require('../lib/registration');
  const payload={data:{
    license_plate:'23-ZZ-90',registration_date:'2019-12-10',make:'FORD',model:'FOCUS',
    version:'?',year_built:2019,vehicle_type:'PASSAGEIROS',category:'LIGEIRO',
    body_type:'FECH.C/S TECTO ABRIR',colour:'BRANCO E OUTRAS',fuel:'GASOLINA',
    engine_displacement:'999',engine_power:'92',co2:null,seats:5,weight:1925
  }};
  let requests=0;
  const r=await lookupRegistration('23-ZZ-90',{
    username:'',spottdApiKey:'test-key',spottdBaseUrl:'https://spottd.example',
    fetcher:async(url,options)=>{
      requests++;
      assert.equal(url,'https://spottd.example/api/v1/registrations/23-ZZ-90');
      assert.equal(options.method,'GET');
      assert.equal(options.headers['X-API-Key'],'test-key');
      return {ok:true,status:200,json:async()=>payload};
    }
  });
  assert.equal(requests,1);
  assert.equal(r.provider,'spottd');
  assert.equal(r.registration,'23-ZZ-90');
  assert.equal(r.make,'FORD');assert.equal(r.model,'FOCUS');
  assert.equal(r.trim,null);assert.equal(r.year,2019);assert.equal(r.first_registration,null);assert.equal(r.registration_date_pt,'2019-12-10');
  assert.equal(r.engine_cc,999);assert.equal(r.power_kw,92);assert.equal(r.power_cv,125);
  assert.equal(r.co2_g_km,null);assert.equal(r.weight_kg,1925);assert.equal(r.origin,'unknown');
  assert.equal(parseSpottdData({data:payload.data},'23-ZZ-90').make,'FORD');
});
test('Spottd 404 falls back to the existing free service without another paid attempt',async()=>{
  const calls=[];
  const r=await lookupRegistration('23-ZZ-90',{
    username:'',spottdApiKey:'test-key',spottdBaseUrl:'https://spottd.example',
    fetcher:async(url)=>{
      calls.push(url);
      if(url.includes('spottd.example'))return {ok:false,status:404};
      return {ok:true,status:200,json:async()=>({success:true,data:{plate:'23ZZ90',make:'Ford',model:'Focus',year:2019}})};
    }
  });
  assert.equal(calls.length,2);assert.match(calls[0],/spottd/);assert.match(calls[1],/mycarplate/);
  assert.equal(r.provider,'mycarplate');
});
test('Spottd response for a different plate is ignored and never misidentifies the vehicle',async()=>{
  const calls=[];
  const r=await lookupRegistration('23-ZZ-90',{
    username:'',spottdApiKey:'test-key',spottdBaseUrl:'https://spottd.example',
    fetcher:async(url)=>{
      calls.push(url);
      if(url.includes('spottd.example'))return {ok:true,status:200,json:async()=>({data:{license_plate:'11-AA-11',make:'BMW',model:'320d'}})};
      return {ok:true,status:200,json:async()=>({success:true,data:{plate:'23ZZ90',make:'FORD',model:'FOCUS'}})};
    }
  });
  assert.equal(calls.length,2);assert.equal(r.make,'FORD');assert.equal(r.provider,'mycarplate');
});
test('Spottd credentials require an HTTPS origin and never accept credentials in URL',()=>{
  const {spottdEndpoint}=require('../lib/registration');
  assert.throws(()=>spottdEndpoint('http://spottd.example','23ZZ90'));
  assert.throws(()=>spottdEndpoint('https://user:pw@spottd.example','23ZZ90'));
  assert.throws(()=>spottdEndpoint('https://spottd.example/api/v1','23ZZ90'));
});
test('Spottd partial data does not invent trim, power, CO2 or origin',()=>{
  const {parseSpottdData}=require('../lib/registration');
  const r=parseSpottdData({data:{make:'Renault',model:'Clio',co2:null,engine_power:null}},'14-ID-91');
  assert.equal(r.trim,null);assert.equal(r.power_cv,null);assert.equal(r.co2_g_km,null);
  assert.equal(r.year,null);assert.equal(r.origin,'unknown');
  assert.throws(()=>parseSpottdData({data:{make:'BMW',model:'320d',license_plate:'11-AA-11'}},'14-ID-91'));
});

test('Spottd imported Mercedes: 2020 manufacture and July 2024 Portugal plate are independent',()=>{
  const {parseSpottdData}=require('../lib/registration');
  const r=parseSpottdData({data:{
    license_plate:'BM-55-DN',make:'MERCEDES-BENZ',model:'CLA 180 D(W118)',
    commercial_model:'CLA 180 D',year_built:2020,registration_date:'2024-07-17',
    fuel:'GASOLEO',engine_power:85,engine_displacement:1461,
    colour:'PRETO',vehicle_type:'PASSAGEIROS',category:'LIGEIRO',weight:2075,seats:5
  }},'BM-55-DN');
  assert.equal(r.year,2020);
  assert.equal(r.registration_date_pt,'2024-07-17');
  assert.equal(r.first_registration,null);
  assert.equal(r.commercial_model,'CLA 180 D');
  assert.equal(r.power_cv,116);
  assert.equal(r.weight_kg,2075);
  assert.equal(r.provider,'spottd');
});
