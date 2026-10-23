from pathlib import Path

base = Path('mapa-comissoes/comparador-auto-pro')
p = base / 'app-v2.js'
s = p.read_text()
def replace(old, new):
    global s
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f'Expected one patch anchor, got {count}: {old[:100]}')
    s = s.replace(old, new, 1)

replace('let currentResult=null;\n', 'let currentResult=null;\nlet currentHistoryRevision=null;\nlet historyControlStates=[];\n')
replace('async function boot(){\n', 'async function boot(){\n  resetAnalysisView({announce:false,focus:false,scroll:false});\n')
replace('  await resumePendingAnalysis();\n', '  // Pending research is resumed only by an explicit action in the history.\n')
replace('function resetAnalysisView(){', 'function resetAnalysisView({announce=true,focus=true,scroll=true}={}){')
replace('  resetSearchInput({announce:false,focus:false});\n  stopProgress();', '  clearSavedRevisionView();\n  resetSearchInput({announce:false,focus:false});\n  stopProgress();')
replace('  q("analyzeForm").scrollIntoView({behavior:"smooth",block:"center"});\n  setTimeout(()=>q("vehicleUrl").focus({preventScroll:true}),220);\n  toast("Pronto para uma nova pesquisa.");', '  if(scroll)q("analyzeForm").scrollIntoView({behavior:"smooth",block:"center"});\n  if(focus)setTimeout(()=>q("vehicleUrl").focus({preventScroll:true}),220);\n  if(announce)toast("Pronto para uma nova pesquisa.");')
replace('async function resumePendingAnalysis(jobId=null,analysisId=null){\n  if(!session||activeOperation)return;', 'async function resumePendingAnalysis(jobId=null,analysisId=null){\n  if(!session||activeOperation||(!jobId&&!analysisId))return;')
replace('  else query=query.in("status",["starting","queued","in_progress"]);\n', '')
replace('  const operation=beginOperation("analysis");', '  clearSavedRevisionView();\n  const operation=beginOperation("analysis");')
replace('  const operation=beginOperation("resume",job.analysis_id);operation.jobId=job.id;', '  clearSavedRevisionView();\n  const operation=beginOperation("resume",job.analysis_id);operation.jobId=job.id;')
replace('    \'<small class="history-meta">\'+esc(comps)+\' comparável(is) · motor \'+esc(row.engine_version||"—")+\'</small>\'+\n  \'</article>\';', '    \'<small class="history-meta">\'+esc(comps)+\' comparável(is) · motor \'+esc(row.engine_version||"—")+\'</small>\'+\n    \'<button type="button" class="btn ghost small history-open-btn" data-history-revision="\'+esc(row.id)+\'" aria-label="Abrir avaliação de \'+title+\'">Abrir avaliação</button>\'+\n  \'</article>\';')

history = r'''// Reading a revision never runs the valuation engine or writes another revision.
function savedRevisionSnapshot(row){
  const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
  const original=row?.snapshot;
  if(!object(original)||!object(original.result)||!object(original.result.subject)||!object(original.result.market)||!object(original.result.purchase)){
    throw new Error("Este registo não contém a avaliação completa. Não foi feita uma nova pesquisa.");
  }
  const snapshot=JSON.parse(JSON.stringify(original));
  const result=snapshot.result;
  for(const key of ["comparables","excluded","warnings"]){
    if(!Array.isArray(result[key]))result[key]=[];
  }
  if(object(result.reconditioning)){
    if(!Array.isArray(result.reconditioning.items))result.reconditioning.items=[];
    if(!Array.isArray(result.reconditioning.notes))result.reconditioning.notes=[];
  }
  const research=object(snapshot.research)?snapshot.research:{};
  const source=object(snapshot.source)?snapshot.source:{};
  const sourceHost=String(source.domain||"manual");
  const entry={sourceUrl:source.url||null,sourceDomain:sourceHost,mode:source.mode||"manual",registration:result.subject.registration||null};
  const market={...research,subject:result.subject,comparables:result.comparables,
    condition_report:research.condition_report||result.condition_report||null,
    risk_flags:Array.isArray(research.risk_flags)?research.risk_flags:[]};
  const rawDate=row.created_at||snapshot.saved_at;
  const date=new Date(rawDate);
  return {snapshot,result,sourceHost,
    savedAt:Number.isFinite(date.getTime())?date.toISOString():null,
    context:{market,reader:snapshot.reader||{},entry,sourceHost,marketPayload:{url:entry.sourceUrl},allRules:snapshot.memory_rules||[]}};
}
function clearSavedRevisionView(){
  currentHistoryRevision=null;
  for(const [element,disabled] of historyControlStates)element.disabled=disabled;
  historyControlStates=[];
  q("historySnapshotNotice")?.classList.add("hidden");
  q("conditionPanel")?.classList.remove("hidden");
  syncDealForm();
}
function showSavedRevisionView(row,record){
  currentHistoryRevision={id:row.id,analysisId:row.analysis_id,savedAt:record.savedAt};
  const notice=q("historySnapshotNotice");
  if(notice){
    const when=record.savedAt?historyDate.format(new Date(record.savedAt)):"data indisponível";
    notice.textContent="Avaliação guardada · "+when+". Valores originais, sem nova pesquisa. Usa Nova avaliação para atualizar.";
    notice.classList.remove("hidden");
  }
  // Expose the saved assumptions without changing the user's current preferences.
  const deal=record.snapshot.deal||{};
  const fields={targetMarginInput:deal.target_margin,minimumMarginInput:deal.minimum_margin,
    transportCostInput:deal.costs?.transport,reconditioningCostInput:deal.costs?.reconditioning,
    warrantyCostInput:deal.costs?.warranty_reserve,stockCostInput:deal.costs?.stock_finance,
    otherCostInput:deal.costs?.other,auctionCostInput:deal.costs?.auction_fee,registrationCostInput:deal.costs?.registration,
    paintPriceModeInput:deal.reconditioning?.paint_mode,paintMinInput:deal.reconditioning?.paint_min_eur,paintMaxInput:deal.reconditioning?.paint_max_eur};
  for(const [id,value] of Object.entries(fields)){if(q(id))q(id).value=value??"";}
  const controls=new Set();
  for(const id of ["refineForm","conditionCostForm","assumptionsForm","chatForm"]){
    for(const element of q(id)?.querySelectorAll("input,select,textarea,button")||[])controls.add(element);
  }
  for(const id of ["refreshMarketBtn","auctionLocationPtBtn","auctionLocationForeignBtn"]){if(q(id))controls.add(q(id));}
  historyControlStates=[...controls].map(element=>[element,element.disabled]);
  for(const element of controls)element.disabled=true;
  const result=record.result;
  if(result.purchase.purchaseWithRepairs===undefined){
    q("purchaseCeilingLabel").textContent="Teto de compra guardado";
    q("maxPurchase").textContent=fmt(result.purchase.effectiveCeiling);
    q("purchaseWithoutRepairs").textContent="—";
    q("purchaseComparisonNote").textContent="Este registo não separava os valores com e sem reparações.";
  }
  if(!result.commercial)q("commercialPanel")?.classList.add("hidden");
  if(!result.reconditioning)q("conditionPanel")?.classList.add("hidden");
}
async function openSavedRevision(revisionId){
  if(!session||activeOperation||!revisionId)return;
  const owner=session.user.id;
  const operation=beginOperation("history");
  q("historyStatus").textContent="A abrir a avaliação guardada…";
  try{
    const {data:row,error}=await db.from("cap_revisions")
      .select("id,analysis_id,user_id,created_at,snapshot")
      .eq("user_id",owner).eq("id",revisionId).maybeSingle();
    assertOperation(operation);
    if(session?.user?.id!==owner)return;
    if(error||!row||row.user_id!==owner)throw new Error("Não foi possível abrir esta avaliação guardada. Tenta novamente.");
    const record=savedRevisionSnapshot(row);
    finishOperation(operation);
    resetAnalysisView({announce:false,focus:false,scroll:false});
    currentAnalysisId=row.analysis_id;
    currentMarketData=record.context;
    lastAnalysisContext=null;
    q("vehicleUrl").value=record.result.subject.registration||record.context.entry.sourceUrl||"";
    if(record.result.subject.mileage_km!=null&&!record.result.subject.mileage_estimated)q("vehicleMileage").value=record.result.subject.mileage_km;
    renderResult(record.result,record.sourceHost,record.context.market.risk_flags);
    showSavedRevisionView(row,record);
    closeHistory();
    q("result").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(error){
    if(session?.user?.id!==owner)return;
    q("historyStatus").textContent=error.message||"Não foi possível abrir a avaliação.";
    toast(q("historyStatus").textContent);
  }finally{finishOperation(operation);}
}
q("historyList")?.addEventListener("click",event=>{
  const button=event.target.closest?.("[data-history-revision]");
  if(button&&q("historyList").contains(button))openSavedRevision(button.dataset.historyRevision);
});

'''
replace('function openHistory(){\n', history + 'function openHistory(){\n')
replace('function beginOperation(kind,analysisId=null){\n  if(activeOperation)', 'function beginOperation(kind,analysisId=null){\n  if(currentHistoryRevision&&!["history","learning","learning-undo"].includes(kind))throw new Error("Esta avaliação guardada está em modo de consulta. Inicia uma nova avaliação.");\n  if(activeOperation)')
replace('    preparation:currentResult.reconditioning?.appliedGross||0,', '    preparation:currentResult.reconditioning?.appliedGross??null,')
replace('    date:new Date().toLocaleDateString("pt-PT")', '    date:currentHistoryRevision?(currentHistoryRevision.savedAt?new Date(currentHistoryRevision.savedAt).toLocaleDateString("pt-PT"):"Data não registada"):new Date().toLocaleDateString("pt-PT")')
replace('boot();\n', '''// BFCache restoration is a reopen; ordinary tab/phone backgrounding is not.
window.addEventListener("pageshow",event=>{
  if(event.persisted&&!activeOperation){
    resetAnalysisView({announce:false,focus:false,scroll:false});
    closeHistory();
  }
});
boot();
''')
replace('  if(activeOperation===op){activeOperation=null;setOperationBusy(false)}', '  if(activeOperation===op){activeOperation=null;setOperationBusy(false);if(currentHistoryRevision)for(const [element] of historyControlStates)element.disabled=true;}')
p.write_text(s)
html_path=base/'index.html'
h=html_path.read_text()
old='src="./app-v2.js?v=20261023-supervised-v1"'
assert h.count(old)==1
h=h.replace(old,'src="./app-v2.js?v=20261023-fresh-history-v1"')
old='<section class="result hidden" id="result">'
assert h.count(old)==1
h=h.replace(old,old+'\n      <div class="progress-panel hidden" id="historySnapshotNotice" role="status"></div>')
html_path.write_text(h)
print('Patched app-v2.js and index.html: fresh boot, explicit resume, full saved revisions.')
