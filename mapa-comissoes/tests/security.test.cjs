const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const {publicIp}=require("../lib/safe-fetch");
const transcribe=require("../api/comparador-transcribe");

test("reader rejects private, metadata and documentation networks",()=>{
  for(const ip of ["127.0.0.1","10.0.0.1","169.254.169.254","172.16.0.1","192.168.1.1","100.64.0.1","192.0.2.1","198.51.100.1","203.0.113.1","::1","fc00::1","fe80::1","2001:db8::1"])assert.equal(publicIp(ip),false,ip);
  assert.equal(publicIp("8.8.8.8"),true);
  assert.equal(publicIp("2606:4700:4700::1111"),true);
});

test("voice accepts MediaRecorder codec parameters",()=>{
  const parsed=transcribe._test.parseAudioDataUrl("data:audio/webm;codecs=opus;base64,YWJj");
  assert.equal(parsed.mime,"audio/webm");
  assert.equal(parsed.payload,"YWJj");
  assert.equal(transcribe._test.parseAudioDataUrl("data:text/plain;base64,YWJj"),null);
});

test("market jobs are owner-bound and research is required",()=>{
  const src=fs.readFileSync(path.join(__dirname,"../api/comparador-market.js"),"utf8");
  assert.match(src,/cap_claim_job/);
  assert.match(src,/job_id/);
  assert.match(src,/tool_choice:"required"/);
  assert.match(src,/source_url_verified/);
});

test("registration enrichment preserves confirmed price and km; identity replacement clears unrelated vehicle data",()=>{
  const {mergeRegistration,applyConfirmedIdentity}=require('../api/comparador-market')._test;
  const subject={make:'MINI',model:'Countryman',trim:'Cooper D',year:2017,mileage_km:120000,price:19900,power_cv:150};
  const enriched=mergeRegistration(subject,{make:'MINI',model:'Countryman',mileage_km:0,price:1,power_cv:116});
  assert.equal(enriched.mileage_km,120000);assert.equal(enriched.price,19900);assert.equal(enriched.power_cv,150);
  const same=applyConfirmedIdentity(subject,{make:'MINI',model:'Countryman',trim:'Cooper D'});
  assert.equal(same.mileage_km,120000);assert.equal(same.price,19900);
  const replaced=applyConfirmedIdentity(subject,{make:'Tesla',model:'Model Y'});
  assert.equal(replaced.mileage_km,null);assert.equal(replaced.price,null);assert.equal(replaced.power_cv,undefined);
});

test("public reader requires auth and a quota before outbound reading",()=>{
  const src=fs.readFileSync(path.join(__dirname,"../api/comparador-analyze.js"),"utf8");
  assert.match(src,/authenticate\(req\)/);
  assert.match(src,/takeQuota\(token,"reader"\)/);
  assert.match(src,/safeFetch/);
});
