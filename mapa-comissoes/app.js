(() => {
  "use strict";

  const E = globalThis.DealerOpsEngine;
  const Supabase = globalThis.supabase;
  if (!E || !Supabase) {
    document.body.innerHTML = "<p style='padding:30px;color:white'>Erro: dependências da aplicação não carregadas.</p>";
    return;
  }

  const SUPABASE_URL = "https://ciyycnjxteqpphgbkneg.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NLLNaEvhKHfoJNenqpObdA_sNA8UTNa";
  const db = Supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    db: { schema: "mapa_comercial" },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const euro = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat("pt-PT", { style: "percent", maximumFractionDigits: 1 });
  const q = (id) => document.getElementById(id);
  const qa = (sel) => Array.from(document.querySelectorAll(sel));
  const num = E.num;

  function currentMonth() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function nextMonthStart(month) {
    const parts = month.split("-").map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1], 1));
    return d.toISOString().slice(0, 10);
  }
  function fmtMoney(v) { return euro.format(Math.round(num(v))); }
  function fmtPct(v) { return percent.format(num(v) / 100); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }
  function toast(message) {
    const el = q("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function setSync(message, busy) {
    const el = q("syncStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("busy", !!busy);
  }

  let session = null;
  let member = null;
  let ruleVersionById = {};
  let currentSellerId = "";
  let currentView = "dashboard";
  let state = {
    companyName: "Mapa Comercial",
    month: currentMonth(),
    config: E.clone(E.DEFAULT_CONFIG),
    sellers: [],
    deals: []
  };

  function isAdmin() { return member?.role === "admin"; }
  function activeSellers() { return state.sellers.filter(s => s.active !== false); }
  function vehicleLabel(d) { return d.vehicle || "Viatura sem descrição"; }
  function getSellerMonth(id) { return E.calcSellerMonth(state.deals, id, state.month, state.config); }
  function getCompanyMonth() { return E.calcCompanyMonth(state.deals, activeSellers(), state.month, state.config); }

  function showOnlyGate(which) {
    q("authGate").classList.toggle("open", which === "auth");
    q("pendingGate").classList.toggle("open", which === "pending");
    q("appShell").classList.toggle("hidden-app", which !== "app");
  }

  function setAuthMessage(message, kind) {
    const el = q("authMessage");
    el.textContent = message || "";
    el.className = "auth-message" + (kind ? " " + kind : "");
  }

  async function signIn(ev) {
    ev?.preventDefault();
    const email = q("authEmail").value.trim();
    const password = q("authPassword").value;
    if (!email || !password) {
      setAuthMessage("Indica o email e a palavra-passe.", "error");
      return;
    }
    setAuthMessage("A entrar…");
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthMessage(error.message, "error");
      return;
    }
    setAuthMessage("");
  }

  async function signUp() {
    const email = q("authEmail").value.trim();
    const password = q("authPassword").value;
    if (!email || password.length < 6) {
      setAuthMessage("Usa um email válido e uma palavra-passe com pelo menos 6 caracteres.", "error");
      return;
    }
    setAuthMessage("A criar conta…");
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) {
      setAuthMessage(error.message, "error");
      return;
    }
    if (!data.session) {
      setAuthMessage("Conta criada. Confirma o email recebido e depois entra.", "ok");
    } else {
      setAuthMessage("Conta criada. A aguardar autorização do administrador.", "ok");
    }
  }

  async function signOut() {
    await db.auth.signOut();
    member = null;
    session = null;
    state.sellers = [];
    state.deals = [];
    showOnlyGate("auth");
  }

  async function loadMembership() {
    const { data, error } = await db.from("members")
      .select("user_id,role,seller_id,active")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) throw error;
    member = data || null;
  }

  async function loadSettings() {
    const { data, error } = await db.from("app_settings")
      .select("company_name,max_sellers,reference_lender_rate_pct")
      .eq("id", 1)
      .single();
    if (error) throw error;
    state.companyName = data.company_name || "Mapa Comercial";
  }

  async function loadSellers() {
    const { data, error } = await db.from("sellers")
      .select("id,name,email,active,sort_order,created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    state.sellers = (data || []).map(r => ({
      id: r.id,
      name: r.name,
      email: r.email || "",
      active: r.active,
      sortOrder: r.sort_order,
      createdAt: r.created_at
    }));
    if (!state.sellers.some(s => s.id === currentSellerId)) {
      currentSellerId = (activeSellers()[0] || state.sellers[0] || {}).id || "";
    }
  }

  async function loadRules() {
    const { data: ruleSets, error: rulesError } = await db.from("rule_sets")
      .select("id,version,name,is_active,global_min_commission,global_max_commission,finance_cap_pct,created_at")
      .order("version", { ascending: false });
    if (rulesError) throw rulesError;
    ruleVersionById = Object.fromEntries((ruleSets || []).map(r => [r.id, r.version]));
    const active = (ruleSets || []).find(r => r.is_active) || (ruleSets || [])[0];
    if (!active) {
      state.config = E.clone(E.DEFAULT_CONFIG);
      return;
    }

    const results = await Promise.all([
      db.from("volume_tiers").select("*").eq("rule_set_id", active.id).order("sort_order", { ascending: true }),
      db.from("margin_bands").select("*").eq("rule_set_id", active.id).order("sort_order", { ascending: true })
    ]);
    const tiersResult = results[0];
    const bandsResult = results[1];
    if (tiersResult.error) throw tiersResult.error;
    if (bandsResult.error) throw bandsResult.error;

    state.config = E.normalizeConfig({
      version: active.version,
      globalMinCommission: num(active.global_min_commission),
      globalMaxCommission: num(active.global_max_commission),
      financeCapPct: num(active.finance_cap_pct),
      volumeTiers: (tiersResult.data || []).map(t => ({
        id: t.tier_code,
        label: t.label,
        from: t.from_sales,
        to: t.to_sales,
        financeGrid: {
          "0": num(t.commission_0),
          "25": num(t.commission_25),
          "50": num(t.commission_50),
          "75": num(t.commission_75),
          "100": num(t.commission_100)
        }
      })),
      marginBands: (bandsResult.data || []).map(b => ({
        id: b.band_code,
        label: b.label,
        min: b.min_margin === null ? null : num(b.min_margin),
        max: b.max_margin === null ? null : num(b.max_margin),
        factor: num(b.factor)
      }))
    });
  }

  function rowToDeal(r) {
    return {
      id: r.id,
      sellerId: r.seller_id,
      saleDate: r.sale_date,
      status: r.status,
      stock: r.stock || "",
      plate: r.plate || "",
      vehicle: r.vehicle || "",
      salePrice: num(r.pvp),
      acquisitionCost: num(r.acquisition_cost),
      preparationCost: num(r.preparation_cost),
      warrantyCost: num(r.warranty_cost),
      otherDirectCosts: num(r.other_direct_costs),
      financedAmount: num(r.financed_amount),
      lender: r.lender || "",
      lenderRatePct: num(r.lender_rate_pct),
      notes: r.notes || "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      commissionSnapshot: r.commission_amount === null ? null : {
        amount: num(r.commission_amount),
        ruleVersion: ruleVersionById[r.rule_set_id] || state.config.version,
        lockedAt: r.closed_at,
        salePosition: r.sale_position,
        financePct: num(r.finance_pct),
        vehicleMargin: num(r.vehicle_margin)
      }
    };
  }

  async function loadDeals() {
    const start = state.month + "-01";
    const end = nextMonthStart(state.month);
    const { data, error } = await db.from("deals")
      .select("*")
      .gte("sale_date", start)
      .lt("sale_date", end)
      .order("sale_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    state.deals = (data || []).map(rowToDeal);
  }

  async function refreshData(message) {
    setSync("A sincronizar…", true);
    await Promise.all([loadSettings(), loadSellers(), loadRules()]);
    await loadDeals();
    renderAll();
    setSync(message || "Dados sincronizados", false);
  }

  async function startSession() {
    const { data } = await db.auth.getSession();
    session = data.session;
    if (!session) {
      showOnlyGate("auth");
      return;
    }

    try {
      await loadMembership();
    } catch (err) {
      console.error(err);
      setAuthMessage("Não foi possível validar o acesso.", "error");
      showOnlyGate("auth");
      return;
    }

    if (!member || member.active === false) {
      q("pendingEmail").textContent = session.user.email || "conta autenticada";
      showOnlyGate("pending");
      return;
    }

    showOnlyGate("app");
    q("userIdentity").textContent = session.user.email || "Utilizador";
    q("rolePill").textContent = isAdmin() ? "Administrador" : "Vendedor";
    await refreshData();
    applyRoleUi();
  }

  function applyRoleUi() {
    const admin = isAdmin();
    const backofficeNav = document.querySelector('[data-view="backoffice"]');
    if (backofficeNav) backofficeNav.hidden = !admin;
    ["btnAddSeller", "btnAddSeller2"].forEach(id => { if (q(id)) q(id).hidden = !admin; });
    if (q("dealSeller")) q("dealSeller").disabled = !admin;
    if (!admin && currentView === "backoffice") switchView("dashboard");
  }

  function renderBrand() {
    q("brandName").textContent = state.companyName;
    q("companyName").value = state.companyName;
    q("ruleVersion").textContent = "Versão " + state.config.version;
  }

  function renderSellerOptions() {
    const sellers = activeSellers();
    if (!sellers.some(s => s.id === currentSellerId)) currentSellerId = (sellers[0] || {}).id || "";
    [q("sellerSelector"), q("dealSeller")].forEach(select => {
      if (!select) return;
      const old = select.value;
      select.innerHTML = sellers.map(s => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join("");
      if (sellers.some(s => s.id === old)) select.value = old;
      else if (currentSellerId) select.value = currentSellerId;
    });
    if (q("sellerSelector")) q("sellerSelector").value = currentSellerId;
  }

  function renderDashboard() {
    const c = getCompanyMonth();
    q("dashNet").textContent = fmtMoney(c.totalResult);
    q("dashSales").textContent = c.salesCount;
    q("dashPvp").textContent = fmtMoney(c.totalPvp);
    q("dashFinanced").textContent = fmtMoney(c.totalFinanced);
    q("dashFinancePct").textContent = fmtPct(c.financePenetrationPct) + " do PVP";
    q("dashMargin").textContent = fmtMoney(c.totalMargin);
    q("dashFinanceRevenue").textContent = fmtMoney(c.totalFinanceRevenue);
    q("dashCommissions").textContent = fmtMoney(c.totalCommission);

    const box = q("sellerCards");
    const maps = c.sellerMaps;
    if (!maps.length) {
      box.innerHTML = '<div class="empty">' + (isAdmin() ? "Adiciona um vendedor para começar." : "Ainda não existem operações atribuídas.") + '</div>';
      return;
    }
    box.innerHTML = maps.map(m => {
      const financeWidth = Math.min(100, Math.max(0, m.financePenetrationPct));
      const tier = E.getVolumeTier(m.salesCount, state.config);
      return '<article class="seller-card" data-open-seller="' + m.seller.id + '">' +
        '<div class="seller-card-head"><div style="display:flex;align-items:center;gap:10px"><div class="seller-avatar">' + escapeHtml(m.seller.name.slice(0, 2).toUpperCase()) + '</div><div><h3>' + escapeHtml(m.seller.name) + '</h3><small>' + m.salesCount + ' vendas · escalão ' + escapeHtml(tier.label) + '</small></div></div><strong>' + fmtMoney(m.totalResult) + '</strong></div>' +
        '<div class="seller-card-kpis"><div><span>MARGEM</span><strong>' + fmtMoney(m.totalMargin) + '</strong></div><div><span>FINANCIADO</span><strong>' + fmtPct(m.financePenetrationPct) + '</strong></div><div><span>COMISSÕES</span><strong>' + fmtMoney(m.totalCommission) + '</strong></div></div>' +
        '<div class="progress"><i style="width:' + financeWidth + '%"></i></div>' +
        '</article>';
    }).join("");
  }

  function renderSellerMap() {
    const seller = state.sellers.find(s => s.id === currentSellerId);
    if (!seller) {
      q("sellerMapBody").innerHTML = '<tr><td colspan="12" class="empty">Sem vendedor selecionado.</td></tr>';
      return;
    }
    const m = getSellerMonth(seller.id);
    const tier = E.getVolumeTier(m.salesCount, state.config);
    q("sellerSales").textContent = m.salesCount;
    q("sellerTier").textContent = "Escalão " + tier.label;
    q("sellerFinanced").textContent = fmtMoney(m.totalFinanced);
    q("sellerFinancePct").textContent = fmtPct(m.financePenetrationPct) + " do PVP";
    q("sellerAvgMargin").textContent = fmtMoney(m.avgMarginPerCar);
    q("sellerCommission").textContent = fmtMoney(m.totalCommission);
    q("sellerNet").textContent = fmtMoney(m.totalResult);
    q("sellerMapTitle").textContent = "Operações de " + seller.name;

    const body = q("sellerMapBody");
    if (!m.rows.length) {
      body.innerHTML = '<tr><td colspan="12" class="empty">Ainda não existem operações neste mês.</td></tr>';
      return;
    }
    body.innerHTML = m.rows.map(({ deal, calc }) =>
      '<tr>' +
      '<td><strong>' + calc.salePosition + '</strong></td>' +
      '<td>' + escapeHtml(deal.saleDate || "—") + '</td>' +
      '<td><strong>' + escapeHtml(vehicleLabel(deal)) + '</strong><br><span class="muted">' + escapeHtml(deal.stock || deal.plate || "") + '</span></td>' +
      '<td>' + fmtMoney(calc.salePrice) + '</td>' +
      '<td class="' + (calc.vehicleMargin < 0 ? "negative" : "") + '">' + fmtMoney(calc.vehicleMargin) + '</td>' +
      '<td>' + fmtMoney(calc.financedAmount) + '</td>' +
      '<td>' + fmtPct(calc.financePctRaw) + '</td>' +
      '<td>' + fmtMoney(calc.financeRevenue) + '</td>' +
      '<td><strong>' + fmtMoney(calc.commission) + '</strong>' + (calc.isLocked ? ' <span class="badge locked">fixa</span>' : '') + '</td>' +
      '<td class="' + (calc.resultAfterCommission < 0 ? "negative" : "positive") + '"><strong>' + fmtMoney(calc.resultAfterCommission) + '</strong></td>' +
      '<td><span class="badge ' + deal.status + '">' + statusLabel(deal.status) + '</span></td>' +
      '<td><button class="link-btn" data-edit-deal="' + deal.id + '">' + (deal.status === "draft" ? "Editar" : "Ver") + '</button></td>' +
      '</tr>'
    ).join("");
  }

  function renderOperations() {
    const search = (q("operationSearch").value || "").trim().toLowerCase();
    const rows = [];
    activeSellers().forEach(s => {
      const m = E.calcSellerMonth(state.deals, s.id, state.month, state.config);
      m.rows.forEach(row => rows.push({ ...row, seller: s }));
    });
    rows.sort((a, b) => String(b.deal.saleDate || "").localeCompare(String(a.deal.saleDate || "")));
    const filtered = rows.filter(r => {
      if (!search) return true;
      return [r.deal.stock, r.deal.plate, r.deal.vehicle, r.seller.name].join(" ").toLowerCase().includes(search);
    });
    const body = q("allDealsBody");
    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="12" class="empty">Nenhuma operação encontrada.</td></tr>';
      return;
    }
    body.innerHTML = filtered.map(({ deal, calc, seller }) =>
      '<tr>' +
      '<td>' + escapeHtml(deal.saleDate || "—") + '</td><td>' + escapeHtml(seller.name) + '</td>' +
      '<td>' + escapeHtml(deal.stock || "—") + '</td><td>' + escapeHtml(deal.plate || "—") + '</td><td><strong>' + escapeHtml(vehicleLabel(deal)) + '</strong></td>' +
      '<td>' + fmtMoney(calc.salePrice) + '</td><td>' + fmtMoney(calc.vehicleMargin) + '</td><td>' + fmtMoney(calc.financedAmount) + ' <span class="muted">(' + fmtPct(calc.financePctRaw) + ')</span></td>' +
      '<td><strong>' + fmtMoney(calc.commission) + '</strong></td><td class="' + (calc.resultAfterCommission < 0 ? "negative" : "positive") + '"><strong>' + fmtMoney(calc.resultAfterCommission) + '</strong></td>' +
      '<td><span class="badge ' + deal.status + '">' + statusLabel(deal.status) + '</span></td>' +
      '<td><button class="link-btn" data-edit-deal="' + deal.id + '">' + (deal.status === "draft" ? "Editar" : "Ver") + '</button></td>' +
      '</tr>'
    ).join("");
  }

  function statusLabel(status) {
    return status === "closed" ? "Fechada" : status === "cancelled" ? "Cancelada" : "Rascunho";
  }

  function renderSellerAdmin() {
    const box = q("sellerAdminList");
    if (!state.sellers.length) {
      box.innerHTML = '<div class="empty">Sem vendedores.</div>';
      return;
    }
    box.innerHTML = state.sellers.map(s =>
      '<div class="seller-admin-row">' +
      '<span class="badge ' + (s.active === false ? "cancelled" : "closed") + '">' + (s.active === false ? "inativo" : "ativo") + '</span>' +
      '<input value="' + escapeHtml(s.name) + '" data-seller-name="' + s.id + '" ' + (s.active === false ? "disabled" : "") + '>' +
      '<button type="button" data-toggle-seller="' + s.id + '">' + (s.active === false ? "Reativar" : "Desativar") + '</button>' +
      '</div>'
    ).join("");
  }

  function renderRules() {
    state.config = E.normalizeConfig(state.config);
    q("globalMinCommission").value = state.config.globalMinCommission;
    q("globalMaxCommission").value = state.config.globalMaxCommission;
    q("financeCapPct").value = state.config.financeCapPct;
    q("volumeTiersBody").innerHTML = state.config.volumeTiers.map((t, i) => {
      const cells = E.FINANCE_POINTS.map(point =>
        '<td><div class="commission-cell"><input type="number" min="0" step="1" data-tier="' + i + '" data-point="' + point + '" value="' + num(t.financeGrid[String(point)]) + '"><span>€</span></div></td>'
      ).join("");
      return '<tr><td><strong>' + escapeHtml(t.label) + '</strong><small class="tier-hint">' + (t.id === "t0" ? "sem comissão inicial" : "vendas no mês") + '</small></td>' + cells + '</tr>';
    }).join("");
    q("marginBandsBody").innerHTML = state.config.marginBands.map((b, i) =>
      '<tr><td><strong>' + escapeHtml(b.label) + '</strong></td>' +
      '<td><input type="number" data-margin="' + i + '" data-key="min" value="' + (b.min ?? "") + '" placeholder="−∞"></td>' +
      '<td><input type="number" data-margin="' + i + '" data-key="max" value="' + (b.max ?? "") + '" placeholder="+∞"></td>' +
      '<td><input type="number" step=".05" data-margin="' + i + '" data-key="factor" value="' + b.factor + '"> ×</td></tr>'
    ).join("");
  }

  function renderAll() {
    q("monthPicker").value = state.month;
    renderBrand();
    renderSellerOptions();
    renderDashboard();
    renderSellerMap();
    renderOperations();
    if (isAdmin()) {
      renderSellerAdmin();
      renderRules();
    }
    renderSimulator();
    applyRoleUi();
  }

  function switchView(name) {
    if (name === "backoffice" && !isAdmin()) name = "dashboard";
    currentView = name;
    qa(".view").forEach(v => v.classList.remove("active"));
    qa(".nav-item").forEach(b => b.classList.remove("active"));
    q("view-" + name).classList.add("active");
    const btn = document.querySelector('.nav-item[data-view="' + name + '"]');
    if (btn) btn.classList.add("active");
    const titles = { dashboard: "Visão geral", sellers: "Vendedores", operations: "Operações", simulator: "Simulador", backoffice: "Backoffice" };
    q("pageTitle").textContent = titles[name] || "Mapa Comercial";
    if (name === "sellers") renderSellerMap();
    if (name === "operations") renderOperations();
  }

  function openDealModal(dealId, presetSeller) {
    const deal = dealId ? state.deals.find(d => d.id === dealId) : null;
    q("dealModalTitle").textContent = deal ? (deal.status === "draft" ? "Editar operação" : "Operação fechada") : "Nova operação";
    q("dealId").value = deal?.id || "";
    renderSellerOptions();
    q("dealSeller").value = deal?.sellerId || presetSeller || currentSellerId || activeSellers()[0]?.id || "";
    q("dealDate").value = deal?.saleDate || today();
    q("dealStock").value = deal?.stock || "";
    q("dealPlate").value = deal?.plate || "";
    q("dealVehicle").value = deal?.vehicle || "";
    q("dealSalePrice").value = deal?.salePrice ?? "";
    q("dealAcquisition").value = deal?.acquisitionCost ?? "";
    q("dealPrep").value = deal?.preparationCost ?? 0;
    q("dealWarranty").value = deal?.warrantyCost ?? 0;
    q("dealOther").value = deal?.otherDirectCosts ?? 0;
    q("dealFinanced").value = deal?.financedAmount ?? 0;
    q("dealLender").value = deal?.lender || "";
    q("dealLenderRate").value = deal?.lenderRatePct ?? 3.5;
    q("dealNotes").value = deal?.notes || "";

    const locked = !!deal && deal.status !== "draft";
    qa("#dealForm input,#dealForm textarea").forEach(el => {
      if (el.id === "dealId") return;
      el.disabled = locked;
    });
    q("dealSeller").disabled = !isAdmin() || locked;
    q("dealDate").disabled = locked;

    if (locked && isAdmin() && deal.status === "closed") {
      q("dealStatus").innerHTML = '<option value="closed">Fechada</option><option value="cancelled">Cancelada</option>';
      q("dealStatus").disabled = false;
      q("dealStatus").value = deal.status;
    } else {
      q("dealStatus").innerHTML = '<option value="draft">Rascunho</option><option value="closed">Fechada</option><option value="cancelled">Cancelada</option>';
      q("dealStatus").disabled = locked;
      q("dealStatus").value = deal?.status || "draft";
    }

    q("dealSaveButton").hidden = locked && !(isAdmin() && deal.status === "closed");
    updateDealPreview();
    q("dealModal").classList.add("open");
  }

  function closeDealModal() { q("dealModal").classList.remove("open"); }

  function formDeal() {
    return {
      id: q("dealId").value || null,
      sellerId: q("dealSeller").value,
      saleDate: q("dealDate").value,
      status: q("dealStatus").value,
      stock: q("dealStock").value.trim(),
      plate: q("dealPlate").value.trim().toUpperCase(),
      vehicle: q("dealVehicle").value.trim(),
      salePrice: num(q("dealSalePrice").value),
      acquisitionCost: num(q("dealAcquisition").value),
      preparationCost: num(q("dealPrep").value),
      warrantyCost: num(q("dealWarranty").value),
      otherDirectCosts: num(q("dealOther").value),
      financedAmount: num(q("dealFinanced").value),
      lender: q("dealLender").value.trim(),
      lenderRatePct: num(q("dealLenderRate").value),
      notes: q("dealNotes").value.trim()
    };
  }

  function positionForDraft(candidate) {
    const synthetic = { ...candidate, id: candidate.id || "preview", createdAt: new Date().toISOString(), commissionSnapshot: null };
    const all = state.deals.filter(d => d.id !== candidate.id).concat(synthetic);
    const month = E.monthKey(candidate.saleDate);
    const map = E.calcSellerMonth(all, candidate.sellerId, month, state.config);
    const idx = map.rows.findIndex(r => r.deal.id === synthetic.id);
    return idx >= 0 ? idx + 1 : Math.max(1, map.rows.length);
  }

  function updateDealPreview() {
    const d = formDeal();
    if (!d.sellerId || !d.saleDate) return;
    const pos = positionForDraft({ ...d, status: "draft" });
    const c = E.calcDeal({ ...d, status: "draft", commissionSnapshot: null }, pos, state.config);
    q("dealPreviewMargin").textContent = fmtMoney(c.vehicleMargin);
    q("dealPreviewFinancePct").textContent = fmtPct(c.financePctRaw);
    q("dealPreviewCommission").textContent = fmtMoney(c.calculatedCommission);
    q("dealPreviewNet").textContent = fmtMoney(c.resultAfterCommission);
  }

  function dealPayload(d) {
    return {
      seller_id: d.sellerId,
      sale_date: d.saleDate,
      status: d.status,
      stock: d.stock || null,
      plate: d.plate || null,
      vehicle: d.vehicle,
      pvp: d.salePrice,
      acquisition_cost: d.acquisitionCost,
      preparation_cost: d.preparationCost,
      warranty_cost: d.warrantyCost,
      other_direct_costs: d.otherDirectCosts,
      financed_amount: d.financedAmount,
      lender: d.lender || null,
      lender_rate_pct: d.lenderRatePct,
      notes: d.notes || null
    };
  }

  async function saveDealFromForm(ev) {
    ev.preventDefault();
    const d = formDeal();
    if (d.salePrice <= 0 || !d.vehicle || !d.sellerId) {
      toast("Preenche vendedor, viatura e PVP.");
      return;
    }

    setSync("A guardar operação…", true);
    const payload = dealPayload(d);
    let result;
    if (d.id) {
      result = await db.from("deals").update(payload).eq("id", d.id).select().single();
    } else {
      result = await db.from("deals").insert(payload).select().single();
    }

    if (result.error) {
      console.error(result.error);
      setSync("Erro ao guardar", false);
      toast(result.error.message || "Não foi possível guardar a operação.");
      return;
    }

    currentSellerId = result.data.seller_id;
    closeDealModal();
    await refreshData("Operação guardada");
    toast(result.data.status === "closed" ? "Operação fechada e comissão congelada." : "Operação guardada.");
  }

  function loadRecommendedScenario() {
    q("simPosition").value = 8;
    q("simSalePrice").value = 25000;
    q("simAcquisition").value = 21000;
    q("simPrep").value = 500;
    q("simWarranty").value = 500;
    q("simOther").value = 500;
    q("simFinanced").value = 18750;
    q("simLenderRate").value = 3.5;
    renderSimulator();
    toast("Cenário recomendado carregado.");
  }

  function renderSimulator() {
    const deal = {
      salePrice: num(q("simSalePrice").value),
      acquisitionCost: num(q("simAcquisition").value),
      preparationCost: num(q("simPrep").value),
      warrantyCost: num(q("simWarranty").value),
      otherDirectCosts: num(q("simOther").value),
      financedAmount: num(q("simFinanced").value),
      lenderRatePct: num(q("simLenderRate").value),
      status: "draft"
    };
    const pos = Math.max(1, num(q("simPosition").value));
    const c = E.calcDeal(deal, pos, state.config);
    q("simCommission").textContent = fmtMoney(c.calculatedCommission);
    q("simMargin").textContent = fmtMoney(c.vehicleMargin);
    q("simFinancePct").textContent = fmtPct(c.financePctRaw);
    q("simFinanceRevenue").textContent = fmtMoney(c.financeRevenue);
    q("simNet").textContent = fmtMoney(c.resultAfterCommission);
    q("simRule").textContent = "Escalão " + c.volumeTier.label + " · margem " + c.marginBand.label + " · fator " + c.marginBand.factor + "× · mínimo " + fmtMoney(state.config.globalMinCommission);
    const b = c.financeBracket;
    const bracketText = b.lowerPoint === b.upperPoint
      ? b.lowerPoint + "% = " + fmtMoney(b.lowerValue)
      : "entre " + b.lowerPoint + "% (" + fmtMoney(b.lowerValue) + ") e " + b.upperPoint + "% (" + fmtMoney(b.upperValue) + ")";
    q("simExplain").innerHTML = "Com <strong>" + fmtPct(c.financePctApplied) + "</strong> do PVP financiado, a comissão-base é calculada " + bracketText + " e resulta em <strong>" + fmtMoney(c.volumeFinanceCommission) + "</strong>. A margem comercial é <strong>" + fmtMoney(c.vehicleMargin) + "</strong>, por isso aplica-se o fator <strong>" + c.marginBand.factor + "×</strong>. O resultado final é <strong>" + fmtMoney(c.calculatedCommission) + "</strong>, respeitando o mínimo de <strong>" + fmtMoney(state.config.globalMinCommission) + "</strong> e o máximo de <strong>" + fmtMoney(state.config.globalMaxCommission) + "</strong>.";
  }

  function addSeller() {
    if (!isAdmin()) return;
    if (activeSellers().length >= 5) {
      toast("O limite é 5 vendedores ativos.");
      return;
    }
    q("newSellerName").value = "";
    q("sellerModal").classList.add("open");
    setTimeout(() => q("newSellerName").focus(), 50);
  }

  function closeSellerModal() { q("sellerModal").classList.remove("open"); }

  async function saveSeller(ev) {
    ev.preventDefault();
    if (!isAdmin()) return;
    const name = q("newSellerName").value.trim();
    if (!name) return;
    const maxOrder = Math.max(0, ...state.sellers.map(s => num(s.sortOrder)));
    const { data, error } = await db.from("sellers")
      .insert({ name, active: true, sort_order: maxOrder + 1 })
      .select()
      .single();
    if (error) {
      toast(error.message || "Não foi possível adicionar o vendedor.");
      return;
    }
    currentSellerId = data.id;
    closeSellerModal();
    await refreshData("Vendedor adicionado");
    switchView("sellers");
  }

  function readRulesFromDom() {
    const config = E.normalizeConfig(state.config);
    config.globalMinCommission = Math.max(0, num(q("globalMinCommission").value));
    config.globalMaxCommission = Math.max(config.globalMinCommission, num(q("globalMaxCommission").value));
    config.financeCapPct = Math.min(100, Math.max(1, num(q("financeCapPct").value)));

    qa("#volumeTiersBody input[data-point]").forEach(input => {
      const i = Number(input.dataset.tier);
      const point = String(input.dataset.point);
      if (Number.isNaN(i) || !config.volumeTiers[i] || !E.FINANCE_POINTS.includes(Number(point))) return;
      config.volumeTiers[i].financeGrid[point] = Math.max(0, num(input.value));
    });

    qa("#marginBandsBody input").forEach(input => {
      const i = Number(input.dataset.margin);
      const key = input.dataset.key;
      if (Number.isNaN(i) || !key) return;
      config.marginBands[i][key] = input.value === "" ? null : num(input.value);
    });

    config.marginBands.forEach(b => {
      b.factor = Math.max(0, num(b.factor));
      if (b.min === null) b.label = "< " + fmtMoney((b.max || 0) + .01);
      else if (b.max === null) b.label = "≥ " + fmtMoney(b.min);
      else b.label = fmtMoney(b.min) + "–" + fmtMoney(b.max);
    });

    return E.normalizeConfig(config);
  }

  function configToRpc(config) {
    return {
      tiers: config.volumeTiers.map((t, i) => ({
        tier_code: t.id || ("t" + i),
        label: t.label,
        from_sales: t.from,
        to_sales: t.to,
        commission_0: num(t.financeGrid["0"]),
        commission_25: num(t.financeGrid["25"]),
        commission_50: num(t.financeGrid["50"]),
        commission_75: num(t.financeGrid["75"]),
        commission_100: num(t.financeGrid["100"]),
        sort_order: i
      })),
      bands: config.marginBands.map((b, i) => ({
        band_code: b.id || ("m" + i),
        label: b.label,
        min_margin: b.min,
        max_margin: b.max,
        factor: num(b.factor),
        sort_order: i
      }))
    };
  }

  async function persistRules(config, companyName) {
    const payload = configToRpc(config);
    const { data, error } = await db.rpc("save_rule_set", {
      p_company_name: companyName,
      p_global_min_commission: config.globalMinCommission,
      p_global_max_commission: config.globalMaxCommission,
      p_finance_cap_pct: config.financeCapPct,
      p_volume_tiers: payload.tiers,
      p_margin_bands: payload.bands
    });
    if (error) throw error;
    return data;
  }

  async function saveRules() {
    if (!isAdmin()) return;
    const companyName = q("companyName").value.trim() || "Mapa Comercial";
    const next = readRulesFromDom();
    try {
      setSync("A guardar nova versão…", true);
      const version = await persistRules(next, companyName);
      await refreshData("Regras v" + version + " guardadas");
      toast("Nova versão das regras guardada.");
    } catch (err) {
      console.error(err);
      setSync("Erro ao guardar regras", false);
      toast(err.message || "Não foi possível guardar as regras.");
    }
  }

  async function resetRules() {
    if (!isAdmin()) return;
    if (!confirm("Repor os valores iniciais do modelo? As operações já fechadas mantêm a comissão congelada.")) return;
    try {
      setSync("A repor regras…", true);
      const version = await persistRules(E.clone(E.DEFAULT_CONFIG), q("companyName").value.trim() || "Mapa Comercial");
      await refreshData("Regras v" + version + " guardadas");
      toast("Regras iniciais repostas.");
    } catch (err) {
      console.error(err);
      setSync("Erro ao repor regras", false);
      toast(err.message || "Não foi possível repor as regras.");
    }
  }

  function exportCSV() {
    const rows = [["Data", "Vendedor", "Stock", "Matricula", "Viatura", "PVP", "Margem", "Capital financiado", "Percentagem financiada", "Receita financeira", "Comissao", "Resultado", "Estado", "Versao regra"]];
    activeSellers().forEach(s => {
      const m = E.calcSellerMonth(state.deals, s.id, state.month, state.config);
      m.rows.forEach(({ deal, calc }) => rows.push([
        deal.saleDate, s.name, deal.stock || "", deal.plate || "", deal.vehicle || "",
        calc.salePrice, calc.vehicleMargin, calc.financedAmount, calc.financePctRaw,
        calc.financeRevenue, calc.commission, calc.resultAfterCommission,
        statusLabel(deal.status), deal.commissionSnapshot?.ruleVersion || state.config.version
      ]));
    });
    const csv = "\uFEFF" + rows.map(r => r.map(v => String(v ?? "").replace(/"/g, '""')).map(v => '"' + v + '"').join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mapa-comercial-" + state.month + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function toggleSeller(id) {
    if (!isAdmin()) return;
    const s = state.sellers.find(x => x.id === id);
    if (!s) return;
    if (s.active === false && activeSellers().length >= 5) {
      toast("Limite de 5 vendedores ativos.");
      return;
    }
    const { error } = await db.from("sellers").update({ active: s.active === false }).eq("id", id);
    if (error) {
      toast(error.message || "Não foi possível alterar o vendedor.");
      return;
    }
    await refreshData(s.active === false ? "Vendedor reativado" : "Vendedor desativado");
  }

  async function renameSeller(id, name) {
    if (!isAdmin()) return;
    const next = name.trim();
    if (!next) return;
    const { error } = await db.from("sellers").update({ name: next }).eq("id", id);
    if (error) {
      toast(error.message || "Não foi possível alterar o nome.");
      return;
    }
    await refreshData("Nome atualizado");
  }

  function bindEvents() {
    q("authForm").addEventListener("submit", signIn);
    q("btnSignup").addEventListener("click", signUp);
    q("btnLogout").addEventListener("click", signOut);
    q("btnPendingLogout").addEventListener("click", signOut);

    qa(".nav-item").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));

    q("monthPicker").addEventListener("change", async () => {
      state.month = q("monthPicker").value || currentMonth();
      await loadDeals();
      renderAll();
      setSync("Mês carregado");
    });

    q("btnNewDeal").addEventListener("click", () => openDealModal());
    q("btnNewDeal2").addEventListener("click", () => openDealModal());
    q("btnNewDealForSeller").addEventListener("click", () => openDealModal(null, currentSellerId));
    q("btnExport").addEventListener("click", exportCSV);
    q("btnGoSellers").addEventListener("click", () => switchView("sellers"));
    q("sellerSelector").addEventListener("change", () => {
      currentSellerId = q("sellerSelector").value;
      renderSellerMap();
    });
    q("operationSearch").addEventListener("input", renderOperations);
    q("btnAddSeller").addEventListener("click", addSeller);
    q("btnAddSeller2").addEventListener("click", addSeller);
    q("sellerForm").addEventListener("submit", saveSeller);
    qa("[data-close-seller]").forEach(el => el.addEventListener("click", closeSellerModal));
    qa("[data-close-modal]").forEach(el => el.addEventListener("click", closeDealModal));
    q("dealForm").addEventListener("submit", saveDealFromForm);
    qa("#dealForm input,#dealForm select").forEach(el => el.addEventListener("input", updateDealPreview));
    qa("#simForm input").forEach(el => el.addEventListener("input", renderSimulator));
    q("btnSaveRules").addEventListener("click", saveRules);
    q("btnResetRules").addEventListener("click", resetRules);
    q("btnRecommendedScenario").addEventListener("click", loadRecommendedScenario);

    document.addEventListener("click", async (ev) => {
      const sellerCard = ev.target.closest("[data-open-seller]");
      if (sellerCard) {
        currentSellerId = sellerCard.dataset.openSeller;
        renderSellerOptions();
        switchView("sellers");
        return;
      }

      const edit = ev.target.closest("[data-edit-deal]");
      if (edit) {
        openDealModal(edit.dataset.editDeal);
        return;
      }

      const toggle = ev.target.closest("[data-toggle-seller]");
      if (toggle) {
        await toggleSeller(toggle.dataset.toggleSeller);
      }
    });

    q("sellerAdminList").addEventListener("change", async (ev) => {
      const input = ev.target.closest("[data-seller-name]");
      if (!input) return;
      await renameSeller(input.dataset.sellerName, input.value);
    });

    q("dealModal").addEventListener("click", ev => { if (ev.target === q("dealModal")) closeDealModal(); });
    q("sellerModal").addEventListener("click", ev => { if (ev.target === q("sellerModal")) closeSellerModal(); });
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape") {
        closeDealModal();
        closeSellerModal();
      }
    });

    db.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      if (!nextSession) {
        member = null;
        showOnlyGate("auth");
        return;
      }
      await startSession();
    });
  }

  bindEvents();
  startSession().catch(err => {
    console.error(err);
    showOnlyGate("auth");
    setAuthMessage("Erro ao iniciar a aplicação.", "error");
  });
})();
