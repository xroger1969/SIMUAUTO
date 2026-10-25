// Presentation only: every mode uses the existing parser, uploader and voice recorder.
const byId=id=>document.getElementById(id);
const form=byId('analyzeForm');
const entry=byId('vehicleUrl');
const buttons=[...document.querySelectorAll('.mode-button')];
const modes={plate:['Matrícula da viatura','AA — 00 — AA'],link:['Link do anúncio','Cola o link do anúncio'],photos:['Fotografias da viatura','Detalhes adicionais (opcional)'],voice:['Descrição da viatura','Fala ou escreve os detalhes']};
function setMode(mode,{focus=false}={}){
 if(!modes[mode]||entry.disabled)return;
 form.dataset.inputMode=mode;
 buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
 byId('vehicleInputLabel').textContent=modes[mode][0];
 entry.placeholder=modes[mode][1];
 entry.inputMode=mode==='link'?'url':'text';
 if(focus)entry.focus({preventScroll:true});
}
buttons.forEach(button=>button.addEventListener('click',()=>{
 if(button.disabled)return;
 setMode(button.dataset.mode,{focus:['plate','link'].includes(button.dataset.mode)});
 if(button.dataset.mode==='photos'&&!byId('vehiclePhoto').disabled)byId('vehiclePhoto').click();
}));
function syncOptions(){
 const km=byId('vehicleMileage').value.trim();
 const margin=byId('vehicleMargin').value.trim();
 byId('mileagePreview').textContent=km?km+' km':'Opcional';
 byId('marginPreview').textContent=margin?Number(margin).toLocaleString('pt-PT')+' €':'Auto (3 500 €)';
}
form.addEventListener('input',syncOptions);
entry.addEventListener('input',()=>{
 if(/^https?:\/\//i.test(entry.value.trim()))setMode('link');
 else if(form.dataset.inputMode==='plate'&&entry.value.length>14)setMode('voice');
});
// The shared parser normalises pasted plates/URLs synchronously before this callback.
entry.addEventListener('paste',()=>queueMicrotask(()=>{
 if(/^https?:\/\//i.test(entry.value.trim()))setMode('link');
}));
for(const id of ['resetSearchBtn','startNewAnalysisBtn','newSearchBtn']){
 byId(id)?.addEventListener('click',()=>queueMicrotask(()=>{
  if(entry.disabled)return;
  syncOptions();setMode('plate');
  byId('mileageOptions').open=false;byId('marginOptions').open=false;
  byId('accountMenu').open=false;
 }));
}
byId('taxSimulator').addEventListener('toggle',()=>byId('taxSimOpenBtn').setAttribute('aria-expanded',String(byId('taxSimulator').open)));
document.addEventListener('click',event=>{
 const menu=byId('accountMenu');
 if(!menu.contains(event.target))menu.open=false;
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape')byId('accountMenu').open=false;
});
syncOptions();
