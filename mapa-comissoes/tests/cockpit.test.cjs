const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('./db-runtime/node_modules/jsdom');
const root=path.join(__dirname,'../comparador-auto-pro');
function setup(){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{runScripts:'outside-only',url:'https://example.test/'});
 dom.window.eval(fs.readFileSync(path.join(root,'cockpit.js'),'utf8'));
 const q=id=>dom.window.document.getElementById(id);
 return {dom,w:dom.window,q};
}
test('input modes retain the entered vehicle and keep the original form controls',()=>{
 const {dom,q,w}=setup();
 q('vehicleUrl').value='BM-55-DN';
 q('linkModeBtn').click();
 assert.equal(q('vehicleUrl').value,'BM-55-DN');
 assert.equal(q('vehicleUrl').placeholder,'Cola o link do anúncio');
 assert.equal(q('linkModeBtn').getAttribute('aria-pressed'),'true');
 q('plateModeBtn').click();
 assert.equal(q('vehicleUrl').value,'BM-55-DN');
 assert.equal(q('analyzeForm').dataset.inputMode,'plate');
 for(const id of ['vehicleUrl','vehicleMileage','vehicleMargin','vehiclePhoto'])assert.equal(q(id).form,q('analyzeForm'));
 q('vehicleUrl').value='https://example.test/anuncio';
 q('vehicleUrl').dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(q('analyzeForm').dataset.inputMode,'link');
 dom.window.close();
});
test('photos open the existing multiple uploader and disabled modes cannot interrupt an evaluation',()=>{
 const {dom,q}=setup();let opened=0;
 q('vehiclePhoto').click=()=>opened++;
 q('photosModeBtn').click();assert.equal(opened,1);
 assert.equal(q('vehiclePhoto').multiple,true);
 q('photosModeBtn').disabled=true;q('vehicleUrl').disabled=true;
 q('photosModeBtn').click();q('linkModeBtn').click();
 assert.equal(opened,1);assert.equal(q('analyzeForm').dataset.inputMode,'photos');
 dom.window.close();
});
test('optional settings are closed initially, reflect edits, and reset without losing hooks',async()=>{
 const {dom,q,w}=setup();
 assert.equal(q('mileageOptions').open,false);assert.equal(q('marginOptions').open,false);
 q('mileageOptions').open=true;q('vehicleMileage').value='125 000';
 q('vehicleMargin').value='4000';q('vehicleMargin').dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(q('mileagePreview').textContent,'125 000 km');
 assert.match(q('marginPreview').textContent,/4.*000.*€/);
 q('vehicleMileage').value='';q('vehicleMargin').value='';
 q('startNewAnalysisBtn').click();await new Promise(resolve=>queueMicrotask(resolve));
 assert.equal(q('mileagePreview').textContent,'Opcional');assert.equal(q('mileageOptions').open,false);
 const ids=[...w.document.querySelectorAll('[id]')].map(el=>el.id);
 assert.equal(new Set(ids).size,ids.length,'all interactive IDs remain unique');
 dom.window.close();
});
