const DEFAULT_TIERS = [
  {label:"2–3 vendas", from:2, to:3, min:120, max:180},
  {label:"4–5 vendas", from:4, to:5, min:160, max:240},
  {label:"6–7 vendas", from:6, to:7, min:220, max:330},
  {label:"8–9 vendas", from:8, to:9, min:300, max:450},
  {label:"10–11 vendas", from:10, to:11, min:400, max:600},
  {label:"12+ vendas", from:12, to:null, min:500, max:750}
];

const state = {
  tiers: load("commissionPro.tiers", DEFAULT_TIERS),
  settings: load("commissionPro.settings", {healthyLimit:15, warningLimit:20, financeCap:100}),
  sales: load("commissionPro.sales", [
    {pvp:25000, margin:2800, financed:20000, financeRate:3.5, costs:0}
  ])
};

function load(key, fallback){
  try{
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? structuredClone(fallback);
  }catch(e){ return structuredClone(fallback); }
}
function save(){
  localStorage.setItem("commissionPro.tiers", JSON.stringify(state.tiers));
  localStorage.setItem("commissionPro.settings", JSON.stringify(state.settings));
  localStorage.setItem("commissionPro.sales", JSON.stringify(state.sales));
}
const € = new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const pct = new Intl.NumberFormat("pt-PT",{style:"percent",maximumFractionDigits:1});
const n = v => Number.isFinite(+v) ? +v : 0;
const clamp=(v,a,b)=>Math.min(Math.max(v,a),b);

function getTier(saleNumber){
  const num=n(saleNumber);
  if(num < state.tiers[0].from) return null;
  return state.tiers.find(t => num>=n(t.from) && (t.to===null || t.to==="" || num<=n(t.to))) || state.tiers[state.tiers.length-1];
}
function calcCommission(saleNumber,pvp,financed){
  const tier=getTier(saleNumber);
  if(!tier) return {tier:null, financePct: pvp>0? financed/pvp:0, commission:0, base:0, max:0};
  const rawPct = pvp>0 ? n(financed)/n(pvp) : 0;
  const cap = Math.max(1,n(state.settings.financeCap))/100;
  const applied = clamp(rawPct,0,cap);
  const normalized = clamp(applied/cap,0,1);
  const commission = n(tier.min) + (n(tier.max)-n(tier.min))*normalized;
  return {tier, financePct:rawPct, appliedPct:applied, commission, base:n(tier.min), max:n(tier.max)};
}
function calcOperation(saleNumber, sale){
  const pvp=n(sale.pvp), margin=n(sale.margin), financed=n(sale.financed), financeRate=n(sale.financeRate), costs=n(sale.costs);
  const c=calcCommission(saleNumber,pvp,financed);
  const financeRevenue=financed*(financeRate/100);
  const gross=margin+financeRevenue-costs;
  const net=gross-c.commission;
  const ratio=gross>0 ? c.commission/gross : 0;
  return {...c,pvp,margin,financed,financeRate,costs,financeRevenue,gross,net,ratio};
}
function roundEuro(v){return Math.round(n(v));}

const els = {};
[
"pvp","vehicleMargin","financed","financeRate","saleNumber","directCosts","financePctBig","financeMeter",
"commissionValue","tierLabel","financeRevenue","grossResult","netResult","commissionRatio","healthBadge",
"financeInsight","formulaTier","formulaFinance","formulaCommission","salesBody","tiersBody","healthyLimit",
"warningLimit","financeCap","monthSales","monthFinanced","monthFinancePct","monthCommissions","monthNet","monthMarginPct","toast"
].forEach(id=>els[id]=document.getElementById(id));

function health(ratio, gross){
  if(gross<=0) return {text:"Operação negativa",cls:"bad"};
  const p=ratio*100;
  if(p<=n(state.settings.healthyLimit)) return {text:"Rentabilidade saudável",cls:"good"};
  if(p<=n(state.settings.warningLimit)) return {text:"Atenção à margem",cls:"warn"};
  return {text:"Comissão elevada",cls:"bad"};
}

function renderSingle(){
  const sale={pvp:n(els.pvp.value),margin:n(els.vehicleMargin.value),financed:n(els.financed.value),financeRate:n(els.financeRate.value),costs:n(els.directCosts.value)};
  const r=calcOperation(n(els.saleNumber.value),sale);
  const displayPct=clamp(r.financePct,0,1.5);
  els.financePctBig.textContent=pct.format(r.financePct);
  els.financeMeter.style.width=(clamp(displayPct,0,1)*100)+"%";
  els.commissionValue.textContent=€.format(roundEuro(r.commission));
  els.tierLabel.textContent=r.tier ? r.tier.label+" · "+€.format(r.base)+" → "+€.format(r.max) : "Abaixo do primeiro escalão";
  els.financeRevenue.textContent=€.format(roundEuro(r.financeRevenue));
  els.grossResult.textContent=€.format(roundEuro(r.gross));
  els.netResult.textContent=€.format(roundEuro(r.net));
  els.commissionRatio.textContent=r.gross>0?pct.format(r.ratio):"—";
  const h=health(r.ratio,r.gross);
  els.healthBadge.textContent=h.text;
  els.healthBadge.className="health-badge "+h.cls;
  els.formulaTier.textContent=r.tier ? r.tier.label+": "+€.format(r.base)+" base" : "Sem comissão";
  els.formulaFinance.textContent=pct.format(r.financePct)+" do PVP financiado";
  els.formulaCommission.textContent=€.format(roundEuro(r.commission));

  const extra=Math.max(0,r.commission-r.base);
  if(r.financed<=0){
    els.financeInsight.textContent="Sem financiamento: a operação fica no valor mínimo de comissão do escalão. O financiamento aumenta a comissão apenas quando existe capital efetivamente financiado.";
  }else{
    const retained=r.financeRevenue-extra;
    els.financeInsight.innerHTML="O financiamento gera <strong>"+€.format(roundEuro(r.financeRevenue))+"</strong> para o stand. O incentivo adicional ao vendedor face a uma venda sem financiamento é <strong>"+€.format(roundEuro(extra))+"</strong>. Diferença antes dos restantes custos: <strong>"+€.format(roundEuro(retained))+"</strong>.";
  }
}

function renderTiers(){
  els.tiersBody.innerHTML="";
  state.tiers.forEach((t,i)=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><strong>${t.label}</strong></td>
      <td><input class="table-input small" type="number" min="1" data-tier="${i}" data-key="from" value="${t.from}"></td>
      <td><input class="table-input small" type="number" min="1" data-tier="${i}" data-key="to" value="${t.to??""}" placeholder="∞"></td>
      <td><input class="table-input" type="number" min="0" step="10" data-tier="${i}" data-key="min" value="${t.min}"> €</td>
      <td><input class="table-input" type="number" min="0" step="10" data-tier="${i}" data-key="max" value="${t.max}"> €</td>`;
    els.tiersBody.appendChild(tr);
  });
  els.healthyLimit.value=state.settings.healthyLimit;
  els.warningLimit.value=state.settings.warningLimit;
  els.financeCap.value=state.settings.financeCap;
}

function saleRow(sale,i){
  const r=calcOperation(i+1,sale);
  const tr=document.createElement("tr");
  tr.innerHTML=`
    <td><strong>${i+1}</strong></td>
    <td><input class="table-input" type="number" step="100" data-sale="${i}" data-key="pvp" value="${sale.pvp}"></td>
    <td><input class="table-input" type="number" step="50" data-sale="${i}" data-key="margin" value="${sale.margin}"></td>
    <td><input class="table-input" type="number" step="100" data-sale="${i}" data-key="financed" value="${sale.financed}"></td>
    <td class="percent-output">${pct.format(r.financePct)}</td>
    <td><input class="table-input small" type="number" step=".1" data-sale="${i}" data-key="financeRate" value="${sale.financeRate}"> %</td>
    <td><input class="table-input" type="number" step="25" data-sale="${i}" data-key="costs" value="${sale.costs}"></td>
    <td class="table-output">${€.format(roundEuro(r.commission))}</td>
    <td class="table-output">${€.format(roundEuro(r.net))}</td>
    <td><button class="icon-btn" data-remove="${i}" title="Remover venda">×</button></td>`;
  return tr;
}
function renderSales(){
  els.salesBody.innerHTML="";
  state.sales.forEach((s,i)=>els.salesBody.appendChild(saleRow(s,i)));
  renderMonthSummary();
}
function renderMonthSummary(){
  const rows=state.sales.map((s,i)=>calcOperation(i+1,s));
  const sum=key=>rows.reduce((a,r)=>a+n(r[key]),0);
  const pvp=sum("pvp"), financed=sum("financed"), commissions=sum("commission"), net=sum("net");
  els.monthSales.textContent=rows.length;
  els.monthFinanced.textContent=€.format(roundEuro(financed));
  els.monthFinancePct.textContent=(pvp>0?pct.format(financed/pvp):"0%")+" do PVP total";
  els.monthCommissions.textContent=€.format(roundEuro(commissions));
  els.monthNet.textContent=€.format(roundEuro(net));
  els.monthMarginPct.textContent=(pvp>0?pct.format(net/pvp):"0%")+" sobre PVP";
}

function addSale(){
  const last=state.sales[state.sales.length-1]||{pvp:25000,margin:2500,financed:0,financeRate:3.5,costs:0};
  state.sales.push({...last, financed:0});
  save();renderSales();
  document.querySelector('[data-tab="month"]').click();
  toast("Venda adicionada");
}
function toast(msg){
  els.toast.textContent=msg;els.toast.classList.add("show");
  clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove("show"),1800);
}
function exportCSV(){
  const headers=["Venda","PVP","Margem viatura","Capital financiado","% PVP financiado","% financeira","Custos","Comissão","Resultado stand"];
  const lines=[headers.join(";")];
  state.sales.forEach((s,i)=>{
    const r=calcOperation(i+1,s);
    lines.push([i+1,r.pvp,r.margin,r.financed,(r.financePct*100).toFixed(2),r.financeRate,r.costs,roundEuro(r.commission),roundEuro(r.net)].join(";"));
  });
  const blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="simulacao-comissoes.csv";a.click();URL.revokeObjectURL(a.href);
}

document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
  btn.classList.add("active");document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
}));
["pvp","vehicleMargin","financed","financeRate","saleNumber","directCosts"].forEach(id=>els[id].addEventListener("input",renderSingle));

els.salesBody.addEventListener("input",e=>{
  const i=e.target.dataset.sale,key=e.target.dataset.key;
  if(i===undefined||!key)return;
  state.sales[+i][key]=n(e.target.value);save();renderSales();
});
els.salesBody.addEventListener("click",e=>{
  const i=e.target.dataset.remove;if(i===undefined)return;
  state.sales.splice(+i,1);save();renderSales();
});
els.tiersBody.addEventListener("input",e=>{
  const i=e.target.dataset.tier,key=e.target.dataset.key;if(i===undefined||!key)return;
  state.tiers[+i][key]= key==="to" && e.target.value==="" ? null : n(e.target.value);
  const t=state.tiers[+i];t.label=t.to===null ? t.from+"+ vendas" : t.from+"–"+t.to+" vendas";
  save();renderTiers();renderSingle();renderSales();
});
["healthyLimit","warningLimit","financeCap"].forEach(id=>els[id].addEventListener("input",()=>{
  state.settings[id]=n(els[id].value);save();renderSingle();renderSales();
}));
document.getElementById("btnAddSale").addEventListener("click",addSale);
document.getElementById("btnAddSale2").addEventListener("click",addSale);
document.getElementById("btnClearMonth").addEventListener("click",()=>{
  if(confirm("Limpar todas as vendas do mês?")){state.sales=[];save();renderSales();toast("Mês limpo");}
});
document.getElementById("btnSave").addEventListener("click",()=>{save();toast("Cenário guardado neste dispositivo");});
document.getElementById("btnExport").addEventListener("click",exportCSV);
document.getElementById("btnResetTiers").addEventListener("click",()=>{
  if(confirm("Repor a grelha de comissões original?")){
    state.tiers=structuredClone(DEFAULT_TIERS);save();renderTiers();renderSingle();renderSales();toast("Escalões repostos");
  }
});

renderTiers();renderSingle();renderSales();
