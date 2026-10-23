import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./screen-wake-lock.js',import.meta.url),'utf8');
const {createScreenWakeLock}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function rig({supported=true,fail=false}={}){
  const doc=new EventTarget();doc.hidden=false;doc.visibilityState='visible';
  const win=new EventTarget(),sentinels=[],statuses=[];let calls=0;
  const lock=supported?{async request(type){
    assert.equal(type,'screen');calls++;
    if(fail)throw Object.assign(new Error('power saver'),{name:'NotAllowedError'});
    const s=new EventTarget();s.released=false;
    s.release=async()=>{s.released=true;s.dispatchEvent(new Event('release'));};
    sentinels.push(s);return s;
  }}:null;
  const wake=createScreenWakeLock({wakeLock:lock,doc,win,onStatus:x=>statuses.push(x),retryMs:0});
  return {wake,doc,win,sentinels,statuses,get calls(){return calls}};
}
test('enabling a visible app acquires screen wake lock',async()=>{
  const h=rig();h.wake.setEnabled(true);await flush();assert.equal(h.wake.status,'active');
  await h.wake.ensure();assert.equal(h.calls,1);h.wake.destroy();
});
test('background releases the lock and foreground re-acquires',async()=>{
  const h=rig();h.wake.setEnabled(true);await flush();
  h.doc.hidden=true;h.doc.visibilityState='hidden';h.doc.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.equal(h.wake.status,'inactive');assert.equal(h.sentinels[0].released,true);
  h.doc.hidden=false;h.doc.visibilityState='visible';h.doc.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.equal(h.wake.status,'active');assert.equal(h.calls,2);h.wake.destroy();
});
test('user can disable the lock, preventing further requests',async()=>{
  const h=rig();h.wake.setEnabled(true);await flush();h.wake.setEnabled(false);
  await flush();h.win.dispatchEvent(new Event('focus'));await flush();
  assert.equal(h.wake.status,'disabled');assert.equal(h.calls,1);h.wake.destroy();
});
test('unsupported browsers show unsupported, never a false success',async()=>{
  const h=rig({supported:false});h.wake.setEnabled(true);await flush();
  assert.equal(h.wake.status,'unsupported');h.wake.destroy();
});
test('OS denial shows blocked and can be retried',async()=>{
  const h=rig({fail:true});h.wake.setEnabled(true);await flush();assert.equal(h.wake.status,'blocked');
  await h.wake.ensure({force:true});assert.equal(h.calls,2);h.wake.destroy();
});
test('grant arriving after disabling is released',async()=>{
  const doc=new EventTarget();doc.hidden=false;doc.visibilityState='visible';let finish;
  const s={released:false,release:async function(){this.released=true},addEventListener(){}};
  const wake=createScreenWakeLock({doc,win:new EventTarget(),wakeLock:{request:()=>new Promise(r=>finish=r)}});
  wake.setEnabled(true);wake.setEnabled(false);finish(s);await flush();
  assert.equal(s.released,true);assert.equal(wake.status,'disabled');wake.destroy();
});
