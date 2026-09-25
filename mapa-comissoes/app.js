(() => {
  "use strict";

  const E = globalThis.DealerOpsEngine;
  if (!E) {
    document.body.innerHTML = "<p style='padding:30px;color:white'>Erro: motor de cálculo não carregado.</p>";
    return;
  }

  const STORAGE_KEY = "mapaComissoes.v1";
  const euro = new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR",maximumFractionDigits:0});
  const percent = new Intl.NumberFormat("pt-PT",{style:"percent",maximumFractionDigits:1});
  const q = (id) => document.getElementById(id);
  const qa = (sel) => Array.from(document.querySelectorAll(sel));
  const num = E.num;

  function uid(prefix){
    if(globalThis.crypto && crypto.randomUUID) return prefix + "_" + crypto.randomUUID();
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }

  function currentMonth(){
    const d=new Date();
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  }
  function today(){
    const d=new Date();
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }

  const seed = {
    companyName: "Mapa Comercial",
    month: currentMonth(),
    config: E.clone(E.DEFAULT_CONFIG),
    ruleHistory: [{version:1, savedAt:new Date().toISOString(), config:E.clone(E.DEFAULT_CONFIG)}],
    sellers: [{id:"seller_1",name:"Vendedor 1",active:true,createdAt:new Date().toISOString()}],
    deals: []
  };

  function load(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(!raw) return E.clone(seed);
      const parsed=JSON.parse(raw);
      return {
        companyName: parsed.companyName || seed.companyName,
        month: parsed.month || currentMonth(),
        config: E.normalizeConfig(parsed.config || E.DEFAULT_CONFIG),
        ruleHistory: Array.isArray(parsed.ruleHistory) ? parsed.ruleHistory : seed.ruleHistory,
        sellers: Array.isArray(parsed.sellers) && parsed.sellers.length ? parsed.sellers : seed.sellers,
        deals: Array.isArray(parsed.deals) ? parsed.deals : []
      };
    }catch(err){
      console.error(err);
      return E.clone(seed);
    }
  }

  let state=load();
  let currentSellerId=(state.sellers.find(s=>s.active!==false)||state.sellers[0]||{}).id || "";
  let currentView="dashboard";

  function save(){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  }
  function fmtMoney(v){ return euro.format(Math.round(num(v))); }
  function fmtPct(v){ return percent.format(num(v)/100); }
  function sellerName(id){ return (state.sellers.find(s=>s.id===id)||{}).name || "—"; }
  function vehicleLabel(d){ return d.vehicle || "Viatura sem descrição"; }
  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
  }
  function toast(message){
    const el=q("toast");
    el.textContent=message; el.classList.add("show");
    clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),1900);
  }

  function activeSellers(){ return state.sellers.filter(s=>s.active!==false); }
  function getSellerMonth(id){ return E.calcSellerMonth(state.deals,id,state.month,state.config); }
  function getCompanyMonth(){ return E.calcCompanyMonth(state.deals,activeSellers(),state.month,state.config); }

  function renderBrand(){
    q("brandName").textContent=state.companyName;
    q("companyName").value=state.companyName;
    q("ruleVersion").textContent="Versão "+state.config.version;
  }

  function renderSellerOptions(){
    const sellers=activeSellers();
    if(!sellers.some(s=>s.id===currentSellerId)) currentSellerId=(sellers[0]||{}).id||"";
    [q("sellerSelector"),q("dealSeller")].forEach(select=>{
      if(!select) return;
      const old=select.value;
      select.innerHTML=sellers.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join("");
      if(sellers.some(s=>s.id===old)) select.value=old;
      else if(currentSellerId) select.value=currentSellerId;
    });
    if(q("sellerSelector")) q("sellerSelector").value=currentSellerId;
  }

  function renderDashboard(){
    const c=getCompanyMonth();
    q("dashNet").textContent=fmtMoney(c.totalResult);
    q("dashSales").textContent=c.salesCount;
    q("dashPvp").textContent=fmtMoney(c.totalPvp);
    q("dashFinanced").textContent=fmtMoney(c.totalFinanced);
    q("dashFinancePct").textContent=fmtPct(c.financePenetrationPct)+" do PVP";
    q("dashMargin").textContent=fmtMoney(c.totalMargin);
    q("dashFinanceRevenue").textContent=fmtMoney(c.totalFinanceRevenue);
    q("dashCommissions").textContent=fmtMoney(c.totalCommission);

    const box=q("sellerCards");
    const maps=c.sellerMaps;
    if(!maps.length){
      box.innerHTML='<div class="empty">Adiciona um vendedor para começar.</div>';
      return;
    }
    box.innerHTML=maps.map(m=>{
      const financeWidth=Math.min(100,Math.max(0,m.financePenetrationPct));
      const tier=E.getVolumeTier(m.salesCount,state.config);
      return '<article class="seller-card" data-open-seller="'+m.seller.id+'">'+
        '<div class="seller-card-head"><div style="display:flex;align-items:center;gap:10px"><div class="seller-avatar">'+escapeHtml(m.seller.name.slice(0,2).toUpperCase())+'</div><div><h3>'+escapeHtml(m.seller.name)+'</h3><small>'+m.salesCount+' vendas · escalão '+escapeHtml(tier.label)+'</small></div></div><strong>'+fmtMoney(m.totalResult)+'</strong></div>'+
        '<div class="seller-card-kpis"><div><span>MARGEM</span><strong>'+fmtMoney(m.totalMargin)+'</strong></div><div><span>FINANCIADO</span><strong>'+fmtPct(m.financePenetrationPct)+'</strong></div><div><span>COMISSÕES</span><strong>'+fmtMoney(m.totalCommission)+'</strong></div></div>'+
        '<div class="progress"><i style="width:'+financeWidth+'%"></i></div>'+
      '</article>';
    }).join("");
  }

  function renderSellerMap(){
    const seller=state.sellers.find(s=>s.id===currentSellerId);
    if(!seller){
      q("sellerMapBody").innerHTML='<tr><td colspan="12" class="empty">Sem vendedor selecionado.</td></tr>';
      return;
    }
    const m=getSellerMonth(seller.id);
    const tier=E.getVolumeTier(m.salesCount,state.config);
    q("sellerSales").textContent=m.salesCount;
    q("sellerTier").textContent="Escalão "+tier.label;
    q("sellerFinanced").textContent=fmtMoney(m.totalFinanced);
    q("sellerFinancePct").textContent=fmtPct(m.financePenetrationPct)+" do PVP";
    q("sellerAvgMargin").textContent=fmtMoney(m.avgMarginPerCar);
    q("sellerCommission").textContent=fmtMoney(m.totalCommission);
    q("sellerNet").textContent=fmtMoney(m.totalResult);
    q("sellerMapTitle").textContent="Operações de "+seller.name;

    const body=q("sellerMapBody");
    if(!m.rows.length){
      body.innerHTML='<tr><td colspan="12" class="empty">Ainda não existem operações neste mês.</td></tr>';
      return;
    }
    body.innerHTML=m.rows.map(({deal,calc})=>
      '<tr>'+
      '<td><strong>'+calc.salePosition+'</strong></td>'+
      '<td>'+escapeHtml(deal.saleDate||"—")+'</td>'+
      '<td><strong>'+escapeHtml(vehicleLabel(deal))+'</strong><br><span class="muted">'+escapeHtml(deal.stock||deal.plate||"")+'</span></td>'+
      '<td>'+fmtMoney(calc.salePrice)+'</td>'+
      '<td class="'+(calc.vehicleMargin<0?"negative":"")+'">'+fmtMoney(calc.vehicleMargin)+'</td>'+
      '<td>'+fmtMoney(calc.financedAmount)+'</td>'+
      '<td>'+fmtPct(calc.financePctRaw)+'</td>'+
      '<td>'+fmtMoney(calc.financeRevenue)+'</td>'+
      '<td><strong>'+fmtMoney(calc.commission)+'</strong>'+(calc.isLocked?' <span class="badge locked">fixa</span>':'')+'</td>'+
      '<td class="'+(calc.resultAfterCommission<0?"negative":"positive")+'"><strong>'+fmtMoney(calc.resultAfterCommission)+'</strong></td>'+
      '<td><span class="badge '+deal.status+'">'+statusLabel(deal.status)+'</span></td>'+
      '<td><button class="link-btn" data-edit-deal="'+deal.id+'">Editar</button></td>'+
      '</tr>'
    ).join("");
  }

  function renderOperations(){
    const search=(q("operationSearch").value||"").trim().toLowerCase();
    const rows=[];
    activeSellers().forEach(s=>{
      const m=E.calcSellerMonth(state.deals,s.id,state.month,state.config);
      m.rows.forEach(row=>rows.push({...row,seller:s}));
    });
    rows.sort((a,b)=>String(b.deal.saleDate||"").localeCompare(String(a.deal.saleDate||"")));
    const filtered=rows.filter(r=>{
      if(!search) return true;
      return [r.deal.stock,r.deal.plate,r.deal.vehicle,r.seller.name].join(" ").toLowerCase().includes(search);
    });
    const body=q("allDealsBody");
    if(!filtered.length){
      body.innerHTML='<tr><td colspan="12" class="empty">Nenhuma operação encontrada.</td></tr>';
      return;
    }
    body.innerHTML=filtered.map(({deal,calc,seller})=>
      '<tr>'+
      '<td>'+escapeHtml(deal.saleDate||"—")+'</td><td>'+escapeHtml(seller.name)+'</td>'+
      '<td>'+escapeHtml(deal.stock||"—")+'</td><td>'+escapeHtml(deal.plate||"—")+'</td><td><strong>'+escapeHtml(vehicleLabel(deal))+'</strong></td>'+
      '<td>'+fmtMoney(calc.salePrice)+'</td><td>'+fmtMoney(calc.vehicleMargin)+'</td><td>'+fmtMoney(calc.financedAmount)+' <span class="muted">('+fmtPct(calc.financePctRaw)+')</span></td>'+
      '<td><strong>'+fmtMoney(calc.commission)+'</strong></td><td class="'+(calc.resultAfterCommission<0?"negative":"positive")+'"><strong>'+fmtMoney(calc.resultAfterCommission)+'</strong></td>'+
      '<td><span class="badge '+deal.status+'">'+statusLabel(deal.status)+'</span></td>'+
      '<td><button class="link-btn" data-edit-deal="'+deal.id+'">Editar</button></td>'+
      '</tr>'
    ).join("");
  }

  function statusLabel(status){
    return status==="closed"?"Fechada":status==="cancelled"?"Cancelada":"Rascunho";
  }

  function renderSellerAdmin(){
    const box=q("sellerAdminList");
    if(!state.sellers.length){
      box.innerHTML='<div class="empty">Sem vendedores.</div>';
      return;
    }
    box.innerHTML=state.sellers.map(s=>
      '<div class="seller-admin-row">'+
        '<span class="badge '+(s.active===false?"cancelled":"closed")+'">'+(s.active===false?"inativo":"ativo")+'</span>'+
        '<input value="'+escapeHtml(s.name)+'" data-seller-name="'+s.id+'" '+(s.active===false?"disabled":"")+'>'+
        '<button type="button" data-toggle-seller="'+s.id+'">'+(s.active===false?"Reativar":"Desativar")+'</button>'+
      '</div>'
    ).join("");
  }

  function renderRules(){
    state.config=E.normalizeConfig(state.config);
    q("globalMaxCommission").value=state.config.globalMaxCommission;
    q("financeCapPct").value=state.config.financeCapPct;
    q("volumeTiersBody").innerHTML=state.config.volumeTiers.map((t,i)=>{
      const cells=E.FINANCE_POINTS.map(point=>
        '<td><div class="commission-cell"><input type="number" min="0" step="1" data-tier="'+i+'" data-point="'+point+'" value="'+num(t.financeGrid[String(point)])+'"><span>€</span></div></td>'
      ).join("");
      return '<tr><td><strong>'+escapeHtml(t.label)+'</strong><small class="tier-hint">'+(t.id==="t0"?"sem comissão inicial":"vendas no mês")+'</small></td>'+cells+'</tr>';
    }).join("");
    q("marginBandsBody").innerHTML=state.config.marginBands.map((b,i)=>
      '<tr><td><strong>'+escapeHtml(b.label)+'</strong></td>'+
      '<td><input type="number" data-margin="'+i+'" data-key="min" value="'+(b.min??"")+'" placeholder="−∞"></td>'+
      '<td><input type="number" data-margin="'+i+'" data-key="max" value="'+(b.max??"")+'" placeholder="+∞"></td>'+
      '<td><input type="number" step=".05" data-margin="'+i+'" data-key="factor" value="'+b.factor+'"> ×</td></tr>'
    ).join("");
  }

  function renderAll(){
    renderBrand();
    renderSellerOptions();
    renderDashboard();
    renderSellerMap();
    renderOperations();
    renderSellerAdmin();
    renderRules();
    renderSimulator();
  }

  function switchView(name){
    currentView=name;
    qa(".view").forEach(v=>v.classList.remove("active"));
    qa(".nav-item").forEach(b=>b.classList.remove("active"));
    q("view-"+name).classList.add("active");
    const btn=document.querySelector('.nav-item[data-view="'+name+'"]');
    if(btn) btn.classList.add("active");
    const titles={dashboard:"Visão geral",sellers:"Vendedores",operations:"Operações",simulator:"Simulador",backoffice:"Backoffice"};
    q("pageTitle").textContent=titles[name]||"Mapa Comercial";
    if(name==="sellers") renderSellerMap();
    if(name==="operations") renderOperations();
  }

  function openDealModal(dealId, presetSeller){
    const deal=dealId ? state.deals.find(d=>d.id===dealId) : null;
    q("dealModalTitle").textContent=deal?"Editar operação":"Nova operação";
    q("dealId").value=deal?.id||"";
    renderSellerOptions();
    q("dealSeller").value=deal?.sellerId||presetSeller||currentSellerId||activeSellers()[0]?.id||"";
    q("dealDate").value=deal?.saleDate||today();
    q("dealStatus").value=deal?.status||"draft";
    q("dealStock").value=deal?.stock||"";
    q("dealPlate").value=deal?.plate||"";
    q("dealVehicle").value=deal?.vehicle||"";
    q("dealSalePrice").value=deal?.salePrice??"";
    q("dealAcquisition").value=deal?.acquisitionCost??"";
    q("dealPrep").value=deal?.preparationCost??0;
    q("dealWarranty").value=deal?.warrantyCost??0;
    q("dealOther").value=deal?.otherDirectCosts??0;
    q("dealFinanced").value=deal?.financedAmount??0;
    q("dealLender").value=deal?.lender||"";
    q("dealLenderRate").value=deal?.lenderRatePct??3.5;
    q("dealNotes").value=deal?.notes||"";
    updateDealPreview();
    q("dealModal").classList.add("open");
  }

  function closeDealModal(){ q("dealModal").classList.remove("open"); }

  function formDeal(){
    const existing=state.deals.find(d=>d.id===q("dealId").value);
    return {
      id: existing?.id || uid("deal"),
      sellerId:q("dealSeller").value,
      saleDate:q("dealDate").value,
      status:q("dealStatus").value,
      stock:q("dealStock").value.trim(),
      plate:q("dealPlate").value.trim().toUpperCase(),
      vehicle:q("dealVehicle").value.trim(),
      salePrice:num(q("dealSalePrice").value),
      acquisitionCost:num(q("dealAcquisition").value),
      preparationCost:num(q("dealPrep").value),
      warrantyCost:num(q("dealWarranty").value),
      otherDirectCosts:num(q("dealOther").value),
      financedAmount:num(q("dealFinanced").value),
      lender:q("dealLender").value.trim(),
      lenderRatePct:num(q("dealLenderRate").value),
      notes:q("dealNotes").value.trim(),
      createdAt:existing?.createdAt||new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      commissionSnapshot:existing?.commissionSnapshot||null
    };
  }

  function positionForDraft(candidate){
    const all=state.deals.filter(d=>d.id!==candidate.id).concat(candidate);
    const month=E.monthKey(candidate.saleDate);
    const map=E.calcSellerMonth(all,candidate.sellerId,month,state.config);
    const idx=map.rows.findIndex(r=>r.deal.id===candidate.id);
    return idx>=0 ? idx+1 : Math.max(1,map.rows.length);
  }

  function updateDealPreview(){
    const d=formDeal();
    if(!d.sellerId || !d.saleDate) return;
    const pos=positionForDraft({...d,status:"draft",commissionSnapshot:null});
    const c=E.calcDeal({...d,status:"draft",commissionSnapshot:null},pos,state.config);
    q("dealPreviewMargin").textContent=fmtMoney(c.vehicleMargin);
    q("dealPreviewFinancePct").textContent=fmtPct(c.financePctRaw);
    q("dealPreviewCommission").textContent=fmtMoney(c.calculatedCommission);
    q("dealPreviewNet").textContent=fmtMoney(c.resultAfterCommission);
  }

  function saveDealFromForm(ev){
    ev.preventDefault();
    let next=formDeal();
    const existing=state.deals.find(d=>d.id===next.id);

    if(next.salePrice<=0 || !next.vehicle || !next.sellerId){
      toast("Preenche vendedor, viatura e PVP.");
      return;
    }

    if(next.status==="draft"){
      next.commissionSnapshot=null;
    }else if(next.status==="closed"){
      if(existing?.commissionSnapshot){
        next.commissionSnapshot=existing.commissionSnapshot;
      }else{
        const pos=positionForDraft({...next,status:"draft",commissionSnapshot:null});
        next=E.lockCommission({...next,status:"draft",commissionSnapshot:null},pos,state.config);
      }
    }else if(next.status==="cancelled"){
      next.commissionSnapshot=existing?.commissionSnapshot||null;
    }

    const idx=state.deals.findIndex(d=>d.id===next.id);
    if(idx>=0) state.deals[idx]=next; else state.deals.push(next);
    currentSellerId=next.sellerId;
    save(); closeDealModal(); renderAll(); toast("Operação guardada.");
  }

  function renderSimulator(){
    const deal={
      salePrice:num(q("simSalePrice").value),
      acquisitionCost:num(q("simAcquisition").value),
      preparationCost:num(q("simPrep").value),
      warrantyCost:num(q("simWarranty").value),
      otherDirectCosts:num(q("simOther").value),
      financedAmount:num(q("simFinanced").value),
      lenderRatePct:num(q("simLenderRate").value),
      status:"draft"
    };
    const pos=Math.max(1,num(q("simPosition").value));
    const c=E.calcDeal(deal,pos,state.config);
    q("simCommission").textContent=fmtMoney(c.calculatedCommission);
    q("simMargin").textContent=fmtMoney(c.vehicleMargin);
    q("simFinancePct").textContent=fmtPct(c.financePctRaw);
    q("simFinanceRevenue").textContent=fmtMoney(c.financeRevenue);
    q("simNet").textContent=fmtMoney(c.resultAfterCommission);
    q("simRule").textContent="Escalão "+c.volumeTier.label+" · margem "+c.marginBand.label+" · fator "+c.marginBand.factor+"×";
    const b=c.financeBracket;
    const bracketText=b.lowerPoint===b.upperPoint
      ? b.lowerPoint+"% = "+fmtMoney(b.lowerValue)
      : "entre "+b.lowerPoint+"% ("+fmtMoney(b.lowerValue)+") e "+b.upperPoint+"% ("+fmtMoney(b.upperValue)+")";
    q("simExplain").innerHTML="Com <strong>"+fmtPct(c.financePctApplied)+"</strong> do PVP financiado, a comissão-base é calculada "+bracketText+" e resulta em <strong>"+fmtMoney(c.volumeFinanceCommission)+"</strong>. Aplicando o fator de margem de <strong>"+c.marginBand.factor+"×</strong>, a comissão estimada fica em <strong>"+fmtMoney(c.calculatedCommission)+"</strong>.";
  }

  function addSeller(){
    if(activeSellers().length>=5){
      toast("O limite desta versão é 5 vendedores.");
      return;
    }
    q("newSellerName").value="";
    q("sellerModal").classList.add("open");
    setTimeout(()=>q("newSellerName").focus(),50);
  }
  function closeSellerModal(){ q("sellerModal").classList.remove("open"); }
  function saveSeller(ev){
    ev.preventDefault();
    const name=q("newSellerName").value.trim();
    if(!name) return;
    if(activeSellers().length>=5){ toast("Limite de 5 vendedores."); return; }
    const s={id:uid("seller"),name,active:true,createdAt:new Date().toISOString()};
    state.sellers.push(s); currentSellerId=s.id; save(); closeSellerModal(); renderAll(); switchView("sellers"); toast("Vendedor adicionado.");
  }

  function readRulesFromDom(){
    const config=E.normalizeConfig(state.config);
    config.globalMaxCommission=Math.max(0,num(q("globalMaxCommission").value));
    config.financeCapPct=Math.min(100,Math.max(1,num(q("financeCapPct").value)));

    qa("#volumeTiersBody input[data-point]").forEach(input=>{
      const i=Number(input.dataset.tier);
      const point=String(input.dataset.point);
      if(Number.isNaN(i)||!config.volumeTiers[i]||!E.FINANCE_POINTS.includes(Number(point))) return;
      config.volumeTiers[i].financeGrid[point]=Math.max(0,num(input.value));
    });

    qa("#marginBandsBody input").forEach(input=>{
      const i=Number(input.dataset.margin),key=input.dataset.key;
      if(Number.isNaN(i)||!key) return;
      config.marginBands[i][key]=input.value==="" ? null : num(input.value);
    });
    config.marginBands.forEach(b=>{
      b.factor=Math.max(0,num(b.factor));
      if(b.min===null) b.label="< "+fmtMoney((b.max||0)+.01);
      else if(b.max===null) b.label="≥ "+fmtMoney(b.min);
      else b.label=fmtMoney(b.min)+"–"+fmtMoney(b.max);
    });
    return E.normalizeConfig(config);
  }

  function saveRules(){
    state.companyName=q("companyName").value.trim()||"Mapa Comercial";
    const next=readRulesFromDom();
    next.version=num(state.config.version)+1;
    state.config=next;
    state.ruleHistory.push({version:next.version,savedAt:new Date().toISOString(),config:E.clone(next)});
    save(); renderAll(); toast("Nova versão das regras guardada.");
  }

  function resetRules(){
    if(!confirm("Repor os valores iniciais do modelo? As operações já fechadas mantêm a comissão congelada.")) return;
    const next=E.clone(E.DEFAULT_CONFIG);
    next.version=num(state.config.version)+1;
    state.config=next;
    state.ruleHistory.push({version:next.version,savedAt:new Date().toISOString(),config:E.clone(next)});
    save(); renderAll(); toast("Regras iniciais repostas.");
  }

  function exportCSV(){
    const rows=[["Data","Vendedor","Stock","Matricula","Viatura","PVP","Margem","Capital financiado","Percentagem financiada","Receita financeira","Comissao","Resultado","Estado","Versao regra"]];
    activeSellers().forEach(s=>{
      const m=E.calcSellerMonth(state.deals,s.id,state.month,state.config);
      m.rows.forEach(({deal,calc})=>rows.push([
        deal.saleDate,s.name,deal.stock||"",deal.plate||"",deal.vehicle||"",calc.salePrice,calc.vehicleMargin,calc.financedAmount,calc.financePctRaw,calc.financeRevenue,calc.commission,calc.resultAfterCommission,statusLabel(deal.status),deal.commissionSnapshot?.ruleVersion||state.config.version
      ]));
    });
    const csv="\uFEFF"+rows.map(r=>r.map(v=>String(v??"").replace(/"/g,'""')).map(v=>'"'+v+'"').join(";")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="mapa-comercial-"+state.month+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  function bindEvents(){
    qa(".nav-item").forEach(btn=>btn.addEventListener("click",()=>switchView(btn.dataset.view)));
    q("monthPicker").value=state.month;
    q("monthPicker").addEventListener("change",()=>{state.month=q("monthPicker").value||currentMonth();save();renderAll();});
    q("btnNewDeal").addEventListener("click",()=>openDealModal());
    q("btnNewDeal2").addEventListener("click",()=>openDealModal());
    q("btnNewDealForSeller").addEventListener("click",()=>openDealModal(null,currentSellerId));
    q("btnExport").addEventListener("click",exportCSV);
    q("btnGoSellers").addEventListener("click",()=>switchView("sellers"));
    q("sellerSelector").addEventListener("change",()=>{currentSellerId=q("sellerSelector").value;renderSellerMap();});
    q("operationSearch").addEventListener("input",renderOperations);
    q("btnAddSeller").addEventListener("click",addSeller);
    q("btnAddSeller2").addEventListener("click",addSeller);
    q("sellerForm").addEventListener("submit",saveSeller);
    qa("[data-close-seller]").forEach(el=>el.addEventListener("click",closeSellerModal));
    qa("[data-close-modal]").forEach(el=>el.addEventListener("click",closeDealModal));
    q("dealForm").addEventListener("submit",saveDealFromForm);
    qa("#dealForm input,#dealForm select").forEach(el=>el.addEventListener("input",updateDealPreview));
    qa("#simForm input").forEach(el=>el.addEventListener("input",renderSimulator));
    q("btnSaveRules").addEventListener("click",saveRules);
    q("btnResetRules").addEventListener("click",resetRules);

    document.addEventListener("click",(ev)=>{
      const sellerCard=ev.target.closest("[data-open-seller]");
      if(sellerCard){ currentSellerId=sellerCard.dataset.openSeller; renderSellerOptions(); switchView("sellers"); return; }
      const edit=ev.target.closest("[data-edit-deal]");
      if(edit){ openDealModal(edit.dataset.editDeal); return; }
      const toggle=ev.target.closest("[data-toggle-seller]");
      if(toggle){
        const s=state.sellers.find(x=>x.id===toggle.dataset.toggleSeller);
        if(!s) return;
        if(s.active===false && activeSellers().length>=5){toast("Limite de 5 vendedores ativos.");return;}
        s.active=s.active===false;
        save();renderAll();toast(s.active?"Vendedor reativado.":"Vendedor desativado.");return;
      }
    });

    q("sellerAdminList").addEventListener("change",(ev)=>{
      const input=ev.target.closest("[data-seller-name]");
      if(!input) return;
      const s=state.sellers.find(x=>x.id===input.dataset.sellerName);
      if(!s) return;
      s.name=input.value.trim()||s.name;
      save();renderAll();
    });

    q("dealModal").addEventListener("click",ev=>{if(ev.target===q("dealModal")) closeDealModal();});
    q("sellerModal").addEventListener("click",ev=>{if(ev.target===q("sellerModal")) closeSellerModal();});
    document.addEventListener("keydown",ev=>{if(ev.key==="Escape"){closeDealModal();closeSellerModal();}});
  }

  bindEvents();
  renderAll();
})();
