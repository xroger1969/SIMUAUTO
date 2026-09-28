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
  const dateTime = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" });
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
  function fmtDateTime(v) {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
  }
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

  function localId(prefix) {
    if (globalThis.crypto && crypto.randomUUID) return prefix + "_" + crypto.randomUUID().slice(0, 8);
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const INFO_TEXT = {
    companyName: "Nome apresentado no Mapa Comercial. Pode ser o nome do stand ou o nome interno do projeto.",
    globalMinCommission: "Valor mínimo pago numa venda elegível. Evita que os fatores de margem reduzam a comissão abaixo deste valor.",
    globalMaxCommission: "Teto máximo da comissão normal calculada pela grelha. O bónus percentual sobre o capital financiado soma-se depois e pode fazer a comissão total ultrapassar este valor.",
    financedCapitalBonusPct: "Percentagem do capital financiado que pode ser somada à comissão normal do vendedor. Ex.: 18.000 € financiados a 1% = +180 €.",
    financedCapitalBonusStartSale: "Posição mínima da venda no mês a partir da qual o vendedor passa a ser elegível para o bónus de financiamento. Ex.: 4 significa que as vendas 1, 2 e 3 recebem apenas a comissão normal.",
    financeCapPct: "Percentagem máxima do PVP considerada para calcular a comissão ligada ao financiamento.",
    maxSellers: "Número máximo de vendedores que podem estar ativos ao mesmo tempo. Pode ser ajustado entre 1 e 25.",
    referenceLenderRatePct: "Percentagem paga pela financeira ao stand, usada como valor inicial nas novas operações. É receita do stand e não é o bónus do vendedor.",
    dealSeller: "Vendedor responsável pela operação.",
    dealDate: "Data que coloca a venda no mês correto e determina a posição no escalão mensal.",
    dealStatus: "Rascunho permite editar. Oficial congela a comissão. O administrador pode anular a venda para manter histórico ou eliminá-la definitivamente quando necessário.",
    dealStock: "Número interno de stock da viatura. O sistema bloqueia outro rascunho ou venda oficial com o mesmo número de stock.",
    dealPlate: "Matrícula da viatura, útil para pesquisa e controlo. O sistema bloqueia outra operação ativa com a mesma matrícula, mesmo que seja escrita com separadores diferentes.",
    dealVehicle: "Marca, modelo e versão da viatura.",
    dealSalePrice: "Preço de venda ao cliente (PVP).",
    dealAcquisition: "Valor pago pelo stand para adquirir a viatura.",
    dealPrep: "Custos de preparação ou recondicionamento antes da venda.",
    dealWarranty: "Custo imputado à garantia da viatura.",
    dealOther: "Outros custos diretos ligados especificamente a esta operação.",
    dealFinanced: "Capital efetivamente financiado ao cliente.",
    dealLender: "Entidade financeira usada na operação.",
    dealLenderRate: "Percentagem que a financeira paga ao stand sobre o capital financiado. Não é a taxa de juro do cliente.",
    dealFinanceBonusEnabled: "Decisão da chefia para esta operação. Mesmo estando ativado, o bónus só é pago se a posição da venda atingir o mínimo definido no Backoffice.",
    dealNotes: "Observações internas sobre a operação.",
    simPosition: "Posição desta venda no mês do vendedor.",
    simSalePrice: "PVP usado apenas nesta simulação.",
    simAcquisition: "Custo de aquisição usado apenas nesta simulação.",
    simPrep: "Preparação/recondicionamento usado apenas nesta simulação.",
    simWarranty: "Custo de garantia usado apenas nesta simulação.",
    simOther: "Outros custos diretos usados apenas nesta simulação.",
    simFinanced: "Capital financiado usado apenas nesta simulação.",
    simLenderRate: "Percentagem paga pela financeira ao stand, usada apenas nesta simulação."
  };

  function infoMarkup(text) {
    return '<button type="button" class="info-btn" data-info="' + escapeHtml(text) + '" aria-label="Informação">i</button>';
  }

  function installInfoButtons() {
    Object.entries(INFO_TEXT).forEach(([id, text]) => {
      const field = q(id);
      const label = field?.closest("label");
      const title = label?.querySelector(":scope > span");
      if (!title || title.querySelector(".info-btn")) return;
      title.insertAdjacentHTML("beforeend", " " + infoMarkup(text));
    });
  }

  function showInfo(button) {
    const pop = q("infoPopover");
    if (!pop) return;
    pop.textContent = button.dataset.info || "";
    const rect = button.getBoundingClientRect();
    pop.classList.add("show");
    const width = Math.min(310, window.innerWidth - 24);
    pop.style.width = width + "px";
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.left - width / 2 + rect.width / 2));
    let top = rect.bottom + 9;
    if (top + pop.offsetHeight > window.innerHeight - 12) top = Math.max(12, rect.top - pop.offsetHeight - 9);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function hideInfo() {
    q("infoPopover")?.classList.remove("show");
  }

  let session = null;
  let member = null;
  let ruleVersionById = {};
  let currentSellerId = "";
  let currentView = "dashboard";
  let state = {
    companyName: "Mapa Comercial",
    month: currentMonth(),
    settings: {
      maxSellers: 5,
      referenceLenderRatePct: 3.5
    },
    config: E.clone(E.DEFAULT_CONFIG),
    sellers: [],
    deals: []
  };

  function isAdmin() { return member?.role === "admin"; }
  function activeSellers() { return state.sellers.filter(s => s.active !== false); }
  function reportSellers() {
    const sellersWithDeals = new Set(state.deals.map(d => d.sellerId));
    return state.sellers.filter(s => s.active !== false || sellersWithDeals.has(s.id));
  }
  function vehicleLabel(d) { return d.vehicle || "Viatura sem descrição"; }
  function getSellerMonth(id) { return E.calcSellerMonth(state.deals, id, state.month, state.config); }
  function getCompanyMonth() { return E.calcCompanyMonth(state.deals, reportSellers(), state.month, state.config); }

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
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await db.rpc("get_current_member");
      if (!error) {
        member = data || null;
        return;
      }
      lastError = error;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw lastError || new Error("Não foi possível validar o acesso.");
  }

  async function loadConfiguration() {
    const { data, error } = await db.rpc("get_map_configuration");
    if (error) throw error;
    const payload = data || {};

    state.companyName = payload.company_name || "Mapa Comercial";

    if (!isAdmin()) {
      state.settings.maxSellers = 1;
      state.settings.referenceLenderRatePct = 0;
      state.config = E.clone(E.DEFAULT_CONFIG);
      ruleVersionById = {};
      return;
    }

    state.settings.maxSellers = Math.max(1, Math.min(25, num(payload.max_sellers) || 5));
    state.settings.referenceLenderRatePct = Math.max(0, Math.min(20, num(payload.reference_lender_rate_pct)));

    const active = payload.rule || {};
    ruleVersionById = active.id ? { [active.id]: active.version } : {};

    state.config = E.normalizeConfig({
      version: active.version,
      globalMinCommission: num(active.global_min_commission),
      globalMaxCommission: num(active.global_max_commission),
      financeCapPct: num(active.finance_cap_pct),
      financedCapitalBonusPct: num(active.financed_capital_bonus_pct),
      financedCapitalBonusStartSale: num(active.financed_capital_bonus_start_sale) || 1,
      volumeTiers: (payload.volume_tiers || []).map(t => ({
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
      marginBands: (payload.margin_bands || []).map(b => ({
        id: b.band_code,
        label: b.label,
        min: b.min_margin === null ? null : num(b.min_margin),
        max: b.max_margin === null ? null : num(b.max_margin),
        factor: num(b.factor)
      }))
    });
  }

  function rowToDeal(r) {
    const sellerSafe = !isAdmin();
    if (sellerSafe) {
      return {
        id: r.id,
        sellerId: r.seller_id,
        saleDate: r.sale_date,
        status: r.status,
        stock: r.stock || "",
        plate: r.plate || "",
        vehicle: r.vehicle || "",
        salePrice: num(r.pvp),
        isFinanced: !!r.is_financed,
        createdAt: r.sale_date,
        closedAt: r.closed_at,
        cancelledAt: r.cancelled_at,
        sellerSafe: true,
        commissionSnapshot: r.commission_amount === null ? null : {
          amount: num(r.commission_amount),
          salePosition: r.sale_position,
          lockedAt: r.closed_at
        }
      };
    }

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
      financeBonusEnabled: r.finance_bonus_enabled !== false,
      notes: r.notes || "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      closedAt: r.closed_at,
      closedBy: r.closed_by,
      closedByEmail: r.closed_by_email || "",
      cancelledAt: r.cancelled_at,
      cancelledBy: r.cancelled_by,
      cancelledByEmail: r.cancelled_by_email || "",
      cancellationReason: r.cancellation_reason || "",
      commissionSnapshot: r.commission_amount === null ? null : {
        amount: num(r.commission_amount),
        ruleVersion: ruleVersionById[r.rule_set_id] || state.config.version,
        lockedAt: r.closed_at,
        salePosition: r.sale_position,
        financePct: r.finance_pct === null ? null : num(r.finance_pct),
        vehicleMargin: r.vehicle_margin === null ? null : num(r.vehicle_margin),
        financeRevenue: r.finance_revenue === null ? null : num(r.finance_revenue),
        baseCommission: r.base_commission === null ? null : num(r.base_commission),
        marginFactor: r.margin_factor === null ? null : num(r.margin_factor),
        financedCapitalBonusPct: r.financed_capital_bonus_pct === null ? 0 : num(r.financed_capital_bonus_pct),
        financedCapitalBonusAmount: r.financed_capital_bonus_amount === null ? 0 : num(r.financed_capital_bonus_amount),
        financeBonusApplied: !!r.finance_bonus_applied,
        resultBeforeCommission: r.result_before_commission === null ? null : num(r.result_before_commission),
        resultAfterCommission: r.result_after_commission === null ? null : num(r.result_after_commission)
      }
    };
  }

  async function loadDeals() {
    const start = state.month + "-01";
    const end = nextMonthStart(state.month);
    const { data, error } = await db.rpc("get_deals_month", { p_start: start, p_end: end });
    if (error) throw error;
    state.deals = (data || []).map(rowToDeal);
  }

  async function refreshData(message) {
    setSync("A sincronizar…", true);
    await Promise.all([loadConfiguration(), loadSellers()]);
    await loadDeals();
    renderAll();
    setSync(message || "Dados sincronizados", false);
  }

  async function enterSession(nextSession) {
    session = nextSession;
    if (!session) {
      member = null;
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

    setAuthMessage("");
    showOnlyGate("app");
    q("userIdentity").textContent = session.user.email || "Utilizador";
    q("rolePill").textContent = isAdmin() ? "Administrador" : "Vendedor";
    await refreshData();
    applyRoleUi();
  }

  async function startSession() {
    const { data } = await db.auth.getSession();
    await enterSession(data.session);
  }

  function applyRoleUi() {
    const admin = isAdmin();
    const sellerNav = document.querySelector('[data-view="sellers"]');

    qa(".nav-item").forEach(btn => {
      btn.hidden = !admin && btn.dataset.view !== "sellers";
    });

    ["btnAddSeller", "btnAddSeller2", "btnNewDeal", "btnNewDeal2", "btnNewDealForSeller", "btnExport", "btnGoSellers"].forEach(id => {
      if (q(id)) q(id).hidden = !admin;
    });

    if (q("sellerSelector")) q("sellerSelector").hidden = !admin;
    if (q("dealSeller")) q("dealSeller").disabled = !admin;

    if (sellerNav) {
      sellerNav.innerHTML = admin ? "<span>◎</span>Vendedores" : "<span>◎</span>Meu mapa";
    }

    const toolbar = q("sellerSelector")?.closest(".inline-actions");
    if (toolbar) toolbar.hidden = !admin;

    const sellerToolbar = document.querySelector("#view-sellers .split-toolbar");
    const sellerEyebrow = sellerToolbar?.querySelector(".eyebrow");
    const sellerHeading = sellerToolbar?.querySelector("h2");
    if (sellerEyebrow) sellerEyebrow.textContent = admin ? "Até " + state.settings.maxSellers + " vendedores" : "Área pessoal";
    if (sellerHeading) sellerHeading.textContent = admin ? "Mapa individual" : "Meu mapa mensal";

    if (!admin) {
      if (currentView !== "sellers") switchView("sellers");
      q("pageTitle").textContent = "Meu mapa";
    }
  }

  function renderBrand() {
    q("brandName").textContent = state.companyName;
    if (!isAdmin()) return;
    q("companyName").value = state.companyName;
    q("ruleVersion").textContent = "Versão " + state.config.version;
    q("maxSellers").value = state.settings.maxSellers;
    q("referenceLenderRatePct").value = state.settings.referenceLenderRatePct;
  }

  function renderSellerOptions(includeDealSellerId) {
    const report = reportSellers();
    if (!report.some(s => s.id === currentSellerId)) currentSellerId = (activeSellers()[0] || report[0] || {}).id || "";

    const sellerSelector = q("sellerSelector");
    if (sellerSelector) {
      const old = sellerSelector.value;
      sellerSelector.innerHTML = report.map(s =>
        '<option value="' + s.id + '">' + escapeHtml(s.name) + (s.active === false ? ' · inativo' : '') + '</option>'
      ).join("");
      if (report.some(s => s.id === old)) sellerSelector.value = old;
      else if (currentSellerId) sellerSelector.value = currentSellerId;
    }

    const dealSeller = q("dealSeller");
    if (dealSeller) {
      const dealOptions = activeSellers().slice();
      const historical = includeDealSellerId ? state.sellers.find(s => s.id === includeDealSellerId) : null;
      if (historical && !dealOptions.some(s => s.id === historical.id)) dealOptions.push(historical);
      const old = dealSeller.value;
      dealSeller.innerHTML = dealOptions.map(s =>
        '<option value="' + s.id + '">' + escapeHtml(s.name) + (s.active === false ? ' · inativo' : '') + '</option>'
      ).join("");
      if (dealOptions.some(s => s.id === old)) dealSeller.value = old;
      else if (includeDealSellerId && dealOptions.some(s => s.id === includeDealSellerId)) dealSeller.value = includeDealSellerId;
      else if (currentSellerId && dealOptions.some(s => s.id === currentSellerId)) dealSeller.value = currentSellerId;
    }

    if (sellerSelector && currentSellerId) sellerSelector.value = currentSellerId;
  }

  function renderDashboard() {
    const c = getCompanyMonth();
    const preview = c.draftCount > 0;
    const prefix = preview ? "~" : "";
    q("dashNet").textContent = prefix + fmtMoney(preview ? c.projectedTotalResult : c.totalResult);
    q("dashSales").textContent = c.salesCount;
    if (q("dashSalesHint")) q("dashSalesHint").textContent =
      c.draftCount + " rascunho" + (c.draftCount === 1 ? "" : "s") + " pendente" + (c.draftCount === 1 ? "" : "s") +
      (preview ? " · valores em prévia" : "");
    q("dashPvp").textContent = prefix + fmtMoney(preview ? c.projectedTotalPvp : c.totalPvp);
    q("dashFinanced").textContent = prefix + fmtMoney(preview ? c.projectedTotalFinanced : c.totalFinanced);
    q("dashFinancePct").textContent = fmtPct(preview ? c.projectedFinancePenetrationPct : c.financePenetrationPct) + " do PVP" + (preview ? " · prévia" : "");
    q("dashMargin").textContent = prefix + fmtMoney(preview ? c.projectedTotalMargin : c.totalMargin);
    q("dashFinanceRevenue").textContent = prefix + fmtMoney(preview ? c.projectedTotalFinanceRevenue : c.totalFinanceRevenue);
    q("dashCommissions").textContent = prefix + fmtMoney(preview ? c.projectedTotalCommission : c.totalCommission);

    const box = q("sellerCards");
    const maps = c.sellerMaps;
    if (!maps.length) {
      box.innerHTML = '<div class="empty">' + (isAdmin() ? "Adiciona um vendedor para começar." : "Ainda não existem operações atribuídas.") + '</div>';
      return;
    }
    box.innerHTML = maps.map(m => {
      const sellerPreview = m.draftCount > 0;
      const financePctValue = sellerPreview ? m.projectedFinancePenetrationPct : m.financePenetrationPct;
      const financeWidth = Math.min(100, Math.max(0, financePctValue));
      const tier = E.getVolumeTier(sellerPreview ? m.projectedSalesCount : m.salesCount, state.config);
      const sellerPrefix = sellerPreview ? "~" : "";
      return '<article class="seller-card" data-open-seller="' + m.seller.id + '">' +
        '<div class="seller-card-head"><div style="display:flex;align-items:center;gap:10px"><div class="seller-avatar">' + escapeHtml(m.seller.name.slice(0, 2).toUpperCase()) + '</div><div><h3>' + escapeHtml(m.seller.name) + (m.seller.active === false ? ' <span class="badge cancelled">inativo</span>' : '') + '</h3><small>' + m.salesCount + ' oficiais · ' + m.draftCount + ' rascunho' + (m.draftCount === 1 ? '' : 's') + (sellerPreview ? ' · prévia' : '') + ' · escalão ' + escapeHtml(tier.label) + '</small></div></div><strong>' + sellerPrefix + fmtMoney(sellerPreview ? m.projectedTotalResult : m.totalResult) + '</strong></div>' +
        '<div class="seller-card-kpis"><div><span>MARGEM</span><strong>' + sellerPrefix + fmtMoney(sellerPreview ? m.projectedTotalMargin : m.totalMargin) + '</strong></div><div><span>FINANCIADO</span><strong>' + fmtPct(financePctValue) + '</strong></div><div><span>COMISSÕES</span><strong>' + sellerPrefix + fmtMoney(sellerPreview ? m.projectedTotalCommission : m.totalCommission) + '</strong></div></div>' +
        '<div class="progress"><i style="width:' + financeWidth + '%"></i></div>' +
        '</article>';
    }).join("");
  }

  function closeRowActionMenus(except) {
    qa(".row-actions[open]").forEach(details => {
      if (details !== except) details.removeAttribute("open");
    });
  }

  function positionRowActionMenu(details) {
    if (!details?.open) return;
    const summary = details.querySelector("summary");
    const menu = details.querySelector(".row-actions-menu");
    if (!summary || !menu) return;

    menu.style.visibility = "hidden";
    menu.style.left = "0px";
    menu.style.top = "0px";

    const trigger = summary.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 12;
    const gap = 8;

    let left = trigger.right - menuRect.width;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));

    let top = trigger.top - menuRect.height - gap;
    if (top < margin) top = trigger.bottom + gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - menuRect.height - margin));

    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
    menu.style.visibility = "visible";
  }

  function dealActionsHtml(deal) {
    const actions = [];
    actions.push('<button type="button" data-edit-deal="' + deal.id + '">' + (deal.status === "draft" ? "Editar" : "Ver detalhes") + '</button>');
    if (deal.status === "draft") {
      actions.push('<button type="button" class="positive-action" data-confirm-deal="' + deal.id + '">✓ Tornar oficial</button>');
      actions.push('<button type="button" class="danger-action" data-delete-deal="' + deal.id + '">🗑 Eliminar definitivamente</button>');
    } else if (isAdmin()) {
      if (deal.status === "closed") {
        actions.push('<button type="button" class="danger-action" data-cancel-deal="' + deal.id + '">⛔ Anular venda</button>');
      }
      actions.push('<button type="button" class="danger-action" data-delete-deal="' + deal.id + '">🗑 Eliminar definitivamente</button>');
    }
    return '<details class="row-actions"><summary aria-label="Ações" title="Ações">•••</summary><div class="row-actions-menu">' + actions.join("") + '</div></details>';
  }

  function renderRestrictedSellerMap(seller) {
    const rows = state.deals
      .filter(d => d.sellerId === seller.id)
      .sort((a,b) => String(a.saleDate || "").localeCompare(String(b.saleDate || "")));
    const official = rows.filter(d => d.status === "closed");
    const drafts = rows.filter(d => d.status === "draft").length;
    const pvpTotal = official.reduce((sum,d) => sum + num(d.salePrice), 0);
    const financedCount = official.filter(d => d.isFinanced).length;
    const commissionTotal = official.reduce((sum,d) => sum + num(d.commissionSnapshot?.amount), 0);
    const avgCommission = official.length ? commissionTotal / official.length : 0;

    q("sellerSales").textContent = official.length;
    q("sellerTier").textContent = official.length + " venda" + (official.length === 1 ? "" : "s") + " oficial" + (official.length === 1 ? "" : "is") +
      (drafts ? " · " + drafts + " em preparação" : "");
    q("sellerFinanced").textContent = fmtMoney(pvpTotal);
    q("sellerFinancePct").textContent = "volume vendido";
    q("sellerAvgMargin").textContent = financedCount;
    q("sellerCommission").textContent = fmtMoney(commissionTotal);
    q("sellerNet").textContent = fmtMoney(avgCommission);
    q("sellerMapTitle").textContent = "As minhas vendas — " + seller.name;

    const cards = [
      [q("sellerFinanced"), "PVP vendido", "volume oficial"],
      [q("sellerAvgMargin"), "Vendas financiadas", "operações com financiamento"],
      [q("sellerCommission"), "Comissões", "total acumulado do mês"],
      [q("sellerNet"), "Comissão média", "por venda oficial"]
    ];
    cards.forEach(([valueEl,label,small]) => {
      const card = valueEl?.closest(".kpi");
      if (!card) return;
      const span = card.querySelector(":scope > span");
      const smallEl = card.querySelector(":scope > small");
      if (span) span.textContent = label;
      if (smallEl) smallEl.textContent = small;
    });

    const header = q("sellerMapBody")?.closest("table")?.querySelector("thead tr");
    if (header) {
      header.innerHTML = "<th>#</th><th>Data</th><th>Viatura</th><th>PVP</th><th>Financiamento</th><th>Comissão</th><th>Estado</th>";
    }

    const body = q("sellerMapBody");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Ainda não existem vendas neste mês.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(deal => {
      const pos = deal.status === "closed" ? (deal.commissionSnapshot?.salePosition || "—") : "—";
      const commission = deal.status === "closed" ? fmtMoney(deal.commissionSnapshot?.amount || 0) : "—";
      return '<tr class="deal-row status-' + deal.status + '">' +
        '<td><strong>' + pos + '</strong></td>' +
        '<td>' + escapeHtml(deal.saleDate || "—") + '</td>' +
        '<td><strong>' + escapeHtml(vehicleLabel(deal)) + '</strong><br><span class="muted">' + escapeHtml(deal.plate || deal.stock || "") + '</span></td>' +
        '<td>' + fmtMoney(deal.salePrice) + '</td>' +
        '<td>' + (deal.isFinanced ? '<span class="badge closed">Sim</span>' : '<span class="muted">Não</span>') + '</td>' +
        '<td><strong>' + commission + '</strong></td>' +
        '<td><span class="badge ' + deal.status + '">' + statusLabel(deal.status) + '</span></td>' +
        '</tr>';
    }).join("");
  }

  function renderSellerMap() {
    const seller = state.sellers.find(s => s.id === currentSellerId);
    if (!seller) {
      q("sellerMapBody").innerHTML = '<tr><td colspan="' + (isAdmin() ? "12" : "7") + '" class="empty">Sem vendedor selecionado.</td></tr>';
      return;
    }
    if (!isAdmin()) {
      renderRestrictedSellerMap(seller);
      return;
    }
    const m = getSellerMonth(seller.id);
    const preview = m.draftCount > 0;
    const salesForDisplay = preview ? m.projectedSalesCount : m.salesCount;
    const tier = E.getVolumeTier(salesForDisplay, state.config);
    const prefix = preview ? "~" : "";
    q("sellerSales").textContent = salesForDisplay;
    q("sellerTier").textContent = m.salesCount + " oficiais · " + m.draftCount + " rascunho" + (m.draftCount === 1 ? "" : "s") + (preview ? " · valores em prévia" : "") + " · Escalão " + tier.label;
    q("sellerFinanced").textContent = prefix + fmtMoney(preview ? m.projectedTotalFinanced : m.totalFinanced);
    q("sellerFinancePct").textContent = fmtPct(preview ? m.projectedFinancePenetrationPct : m.financePenetrationPct) + " do PVP" + (preview ? " · prévia" : "");
    q("sellerAvgMargin").textContent = prefix + fmtMoney(preview ? m.projectedAvgMarginPerCar : m.avgMarginPerCar);
    q("sellerCommission").textContent = prefix + fmtMoney(preview ? m.projectedTotalCommission : m.totalCommission);
    q("sellerNet").textContent = prefix + fmtMoney(preview ? m.projectedTotalResult : m.totalResult);
    q("sellerMapTitle").textContent = "Operações de " + seller.name + (seller.active === false ? " · inativo" : "");

    const body = q("sellerMapBody");
    if (!m.rows.length) {
      body.innerHTML = '<tr><td colspan="12" class="empty">Ainda não existem operações neste mês.</td></tr>';
      return;
    }
    body.innerHTML = m.rows.map(({ deal, calc }) => {
      const official = deal.status === "closed";
      const cancelled = deal.status === "cancelled";
      const pos = official ? (deal.commissionSnapshot?.salePosition || calc.salePosition) : "—";
      const commission = cancelled ? "—" : (deal.status === "draft" ? "~" + fmtMoney(calc.calculatedCommission) : fmtMoney(calc.commission));
      const result = cancelled ? "—" : (deal.status === "draft" ? "~" + fmtMoney(calc.resultAfterCommission) : fmtMoney(calc.resultAfterCommission));
      return '<tr class="deal-row status-' + deal.status + '">' +
        '<td><strong>' + pos + '</strong></td>' +
        '<td>' + escapeHtml(deal.saleDate || "—") + '</td>' +
        '<td><strong>' + escapeHtml(vehicleLabel(deal)) + '</strong><br><span class="muted">' + escapeHtml(deal.stock || deal.plate || "") + '</span></td>' +
        '<td>' + fmtMoney(calc.salePrice) + '</td>' +
        '<td class="' + (calc.vehicleMargin < 0 ? "negative" : "") + '">' + fmtMoney(calc.vehicleMargin) + '</td>' +
        '<td>' + fmtMoney(calc.financedAmount) + '</td>' +
        '<td>' + fmtPct(calc.financePctRaw) + '</td>' +
        '<td>' + fmtMoney(calc.financeRevenue) + '</td>' +
        '<td><strong>' + commission + '</strong>' + (official && calc.isLocked ? ' <span class="badge locked">fixa</span>' : (deal.status === "draft" ? ' <span class="badge draft">prévia</span>' : '')) + (!cancelled && calc.financedCapitalBonus > 0 ? '<br><span class="muted">+' + fmtMoney(calc.financedCapitalBonus) + ' bónus capital</span>' : '') + '</td>' +
        '<td class="' + (!cancelled && calc.resultAfterCommission < 0 ? "negative" : (!cancelled ? "positive" : "")) + '"><strong>' + result + '</strong></td>' +
        '<td><span class="badge ' + deal.status + '">' + statusLabel(deal.status) + '</span></td>' +
        '<td>' + dealActionsHtml(deal) + '</td>' +
        '</tr>';
    }).join("");
  }

  function renderOperations() {
    const search = (q("operationSearch").value || "").trim().toLowerCase();
    const rows = [];
    state.sellers.forEach(s => {
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
    body.innerHTML = filtered.map(({ deal, calc, seller }) => {
      const cancelled = deal.status === "cancelled";
      const commission = cancelled ? "—" : (deal.status === "draft" ? "~" + fmtMoney(calc.calculatedCommission) : fmtMoney(calc.commission));
      const result = cancelled ? "—" : (deal.status === "draft" ? "~" + fmtMoney(calc.resultAfterCommission) : fmtMoney(calc.resultAfterCommission));
      return '<tr class="deal-row status-' + deal.status + '">' +
        '<td>' + escapeHtml(deal.saleDate || "—") + '</td><td>' + escapeHtml(seller.name) + (seller.active === false ? ' <span class="badge cancelled">inativo</span>' : '') + '</td>' +
        '<td>' + escapeHtml(deal.stock || "—") + '</td><td>' + escapeHtml(deal.plate || "—") + '</td><td><strong>' + escapeHtml(vehicleLabel(deal)) + '</strong></td>' +
        '<td>' + fmtMoney(calc.salePrice) + '</td><td>' + fmtMoney(calc.vehicleMargin) + '</td><td>' + fmtMoney(calc.financedAmount) + ' <span class="muted">(' + fmtPct(calc.financePctRaw) + ')</span></td>' +
        '<td><strong>' + commission + '</strong>' + (deal.status === "draft" ? ' <span class="badge draft">prévia</span>' : '') + (!cancelled && calc.financedCapitalBonus > 0 ? '<br><span class="muted">+' + fmtMoney(calc.financedCapitalBonus) + ' bónus capital</span>' : '') + '</td><td class="' + (!cancelled && calc.resultAfterCommission < 0 ? "negative" : (!cancelled ? "positive" : "")) + '"><strong>' + result + '</strong></td>' +
        '<td><span class="badge ' + deal.status + '">' + statusLabel(deal.status) + '</span></td>' +
        '<td>' + dealActionsHtml(deal) + '</td>' +
        '</tr>';
    }).join("");
  }

  function statusLabel(status) {
    return status === "closed" ? "Oficial" : status === "cancelled" ? "Anulada" : "Rascunho";
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
      '<button type="button" class="seller-delete" data-delete-seller="' + s.id + '">Eliminar</button>' +
      '</div>'
    ).join("");
  }

  function renderRules() {
    state.config = E.normalizeConfig(state.config);
    q("globalMinCommission").value = state.config.globalMinCommission;
    q("globalMaxCommission").value = state.config.globalMaxCommission;
    q("financeCapPct").value = state.config.financeCapPct;
    q("financedCapitalBonusPct").value = state.config.financedCapitalBonusPct;
    q("financedCapitalBonusStartSale").value = state.config.financedCapitalBonusStartSale;
    q("maxSellers").value = state.settings.maxSellers;
    q("referenceLenderRatePct").value = state.settings.referenceLenderRatePct;

    q("volumeTiersBody").innerHTML = state.config.volumeTiers.map((t, i) => {
      const canRemove = state.config.volumeTiers.length > 1;
      return '<tr>' +
        '<td><strong class="tier-label">' + escapeHtml(t.label) + '</strong><small class="tier-hint">vendas no mês ' + infoMarkup("Define o intervalo de posições de venda que usa esta comissão normal.") + '</small></td>' +
        '<td><input class="small" type="number" min="0" step="1" data-tier="' + i + '" data-key="from" value="' + num(t.from) + '"></td>' +
        '<td><input class="small" type="number" min="0" step="1" data-tier="' + i + '" data-key="to" value="' + (t.to ?? "") + '" placeholder="∞"></td>' +
        '<td><div class="commission-cell"><input type="number" min="0" step="1" data-tier="' + i + '" data-point="0" value="' + num(t.financeGrid["0"]) + '"><span>€</span></div></td>' +
        '<td><button type="button" class="table-action danger" data-remove-tier="' + i + '" ' + (canRemove ? "" : "disabled") + '>×</button></td>' +
        '</tr>';
    }).join("");

    q("marginBandsBody").innerHTML = state.config.marginBands.map((b, i) => {
      const canRemove = state.config.marginBands.length > 1;
      return '<tr>' +
        '<td><strong class="margin-label">' + escapeHtml(b.label) + '</strong> ' + infoMarkup("A faixa de margem determina o fator aplicado à comissão-base para proteger a rentabilidade.") + '</td>' +
        '<td><input type="number" step=".01" data-margin="' + i + '" data-key="min" value="' + (b.min ?? "") + '" placeholder="−∞"></td>' +
        '<td><input type="number" step=".01" data-margin="' + i + '" data-key="max" value="' + (b.max ?? "") + '" placeholder="+∞"></td>' +
        '<td><input type="number" min="0" step=".05" data-margin="' + i + '" data-key="factor" value="' + b.factor + '"> ×</td>' +
        '<td><button type="button" class="table-action danger" data-remove-margin="' + i + '" ' + (canRemove ? "" : "disabled") + '>×</button></td>' +
        '</tr>';
    }).join("");
  }

  function renderAll() {
    q("monthPicker").value = state.month;
    renderBrand();
    renderSellerOptions();
    renderSellerMap();
    if (isAdmin()) {
      renderDashboard();
      renderOperations();
      renderSellerAdmin();
      renderRules();
      renderSimulator();
      installInfoButtons();
    }
    applyRoleUi();
  }

  function switchView(name) {
    if (!isAdmin()) name = "sellers";
    else if (name === "backoffice" && !isAdmin()) name = "dashboard";
    currentView = name;
    qa(".view").forEach(v => v.classList.remove("active"));
    qa(".nav-item").forEach(b => b.classList.remove("active"));
    q("view-" + name).classList.add("active");
    const btn = document.querySelector('.nav-item[data-view="' + name + '"]');
    if (btn) btn.classList.add("active");
    const titles = { dashboard: "Visão geral", sellers: isAdmin() ? "Vendedores" : "Meu mapa", operations: "Operações", simulator: "Simulador", presentation: "Apresentação", backoffice: "Backoffice" };
    q("pageTitle").textContent = titles[name] || "Mapa Comercial";
    if (name === "sellers") renderSellerMap();
    if (name === "operations") renderOperations();
  }

  function openDealModal(dealId, presetSeller) {
    const deal = dealId ? state.deals.find(d => d.id === dealId) : null;
    const title = !deal ? "Nova operação" : deal.status === "draft" ? "Editar rascunho" : deal.status === "closed" ? "Venda oficial" : "Venda anulada";
    q("dealModalTitle").textContent = title;
    q("dealId").value = deal?.id || "";
    renderSellerOptions(deal?.sellerId);
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
    q("dealLenderRate").value = deal?.lenderRatePct ?? state.settings.referenceLenderRatePct;
    q("dealFinanceBonusEnabled").checked = deal ? deal.financeBonusEnabled !== false : true;
    q("dealNotes").value = deal?.notes || "";

    const locked = !!deal && deal.status !== "draft";
    qa("#dealForm input,#dealForm textarea").forEach(el => {
      if (el.id === "dealId") return;
      el.disabled = locked;
    });
    q("dealSeller").disabled = !isAdmin() || locked;
    q("dealDate").disabled = locked;

    if (locked) {
      q("dealStatus").innerHTML = '<option value="' + deal.status + '">' + statusLabel(deal.status) + '</option>';
      q("dealStatus").disabled = true;
    } else {
      q("dealStatus").innerHTML = '<option value="draft">Rascunho</option><option value="closed">Oficial</option>';
      q("dealStatus").disabled = false;
      q("dealStatus").value = deal?.status || "draft";
    }

    const audit = q("dealAuditInfo");
    if (audit) {
      if (!deal || deal.status === "draft") {
        audit.hidden = true;
        audit.innerHTML = "";
      } else {
        const official = '<strong>Oficializada:</strong> ' + fmtDateTime(deal.closedAt) + ' · ' + escapeHtml(deal.closedByEmail || "utilizador autenticado");
        const cancelled = deal.status === "cancelled"
          ? '<br><strong>Anulada:</strong> ' + fmtDateTime(deal.cancelledAt) + ' · ' + escapeHtml(deal.cancelledByEmail || "administrador") +
            (deal.cancellationReason ? '<br><strong>Motivo:</strong> ' + escapeHtml(deal.cancellationReason) : '')
          : '';
        audit.innerHTML = official + cancelled;
        audit.hidden = false;
      }
    }

    q("dealSaveButton").hidden = locked;
    const deleteButton = q("dealDeleteButton");
    if (deleteButton) {
      deleteButton.hidden = !deal || (deal.status !== "draft" && !isAdmin());
    }
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
      financeBonusEnabled: q("dealFinanceBonusEnabled").checked,
      notes: q("dealNotes").value.trim()
    };
  }

  function positionForDraft(candidate) {
    const synthetic = { ...candidate, id: candidate.id || "preview", createdAt: new Date().toISOString(), commissionSnapshot: null };
    const all = state.deals.filter(d => d.id !== candidate.id).concat(synthetic);
    const month = E.monthKey(candidate.saleDate);
    const map = E.calcSellerMonth(all, candidate.sellerId, month, state.config);
    const idx = map.rows.findIndex(r => r.deal.id === synthetic.id);
    return idx >= 0 ? map.rows[idx].calc.salePosition : Math.max(1, map.salesCount + 1);
  }

  function updateDealPreview() {
    const existing = q("dealId").value ? state.deals.find(x => x.id === q("dealId").value) : null;
    if (existing && existing.status !== "draft" && existing.commissionSnapshot) {
      const pos = existing.commissionSnapshot.salePosition || 1;
      const c = E.calcDeal(existing, pos, state.config);
      q("dealPreviewMargin").textContent = fmtMoney(c.vehicleMargin);
      q("dealPreviewFinancePct").textContent = fmtPct(c.financePctApplied);
      q("dealPreviewFinanceBonus").textContent = fmtMoney(c.financedCapitalBonus);
      q("dealPreviewCommission").textContent = fmtMoney(c.commission);
      q("dealPreviewNet").textContent = fmtMoney(c.resultAfterCommission);
      return;
    }

    const d = formDeal();
    if (!d.sellerId || !d.saleDate) return;
    const pos = positionForDraft({ ...d, status: "draft" });
    const c = E.calcDeal({ ...d, status: "draft", commissionSnapshot: null }, pos, state.config);
    q("dealPreviewMargin").textContent = fmtMoney(c.vehicleMargin);
    q("dealPreviewFinancePct").textContent = fmtPct(c.financePctRaw);
    q("dealPreviewFinanceBonus").textContent = fmtMoney(c.financedCapitalBonus);
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
      finance_bonus_enabled: d.financeBonusEnabled !== false,
      notes: d.notes || null
    };
  }

  function dealSanityWarnings(d) {
    const warnings = [];
    const pvp = Math.max(0, num(d.salePrice));
    if (d.lenderRatePct > 8) {
      warnings.push("A comissão da financeira ao stand é " + String(d.lenderRatePct).replace(".", ",") + "%. Confirma que não querias escrever, por exemplo, 3,5%.");
    }
    if (pvp > 0 && d.financedAmount > pvp) {
      warnings.push("O capital financiado (" + fmtMoney(d.financedAmount) + ") é superior ao PVP (" + fmtMoney(pvp) + ").");
    }
    if (pvp > 0 && d.acquisitionCost > pvp) {
      warnings.push("O custo de aquisição (" + fmtMoney(d.acquisitionCost) + ") é superior ao PVP (" + fmtMoney(pvp) + ").");
    }
    const unusuallyHighCosts = [
      ["Preparação / recondicionamento", d.preparationCost],
      ["Garantia", d.warrantyCost],
      ["Outros custos diretos", d.otherDirectCosts]
    ].filter(([, value]) => pvp > 0 && value > Math.max(10000, pvp * 0.25));
    unusuallyHighCosts.forEach(([label, value]) => {
      warnings.push(label + " parece elevado: " + fmtMoney(value) + ".");
    });

    const margin = E.calcVehicleMargin(d);
    if (margin < 0) {
      warnings.push("A operação tem margem negativa de " + fmtMoney(margin) + ".");
    }
    return warnings;
  }

  function confirmSuspiciousDeal(d) {
    const warnings = dealSanityWarnings(d);
    if (!warnings.length) return true;
    return confirm(
      "Confirma estes valores antes de guardar:\n\n• " +
      warnings.join("\n• ") +
      "\n\nGuardar mesmo assim?"
    );
  }

  function friendlyDealError(error) {
    const text = [error?.message, error?.details, error?.hint, error?.constraint].filter(Boolean).join(" ");
    if (text.includes("deals_active_stock_unique") || /n\.º de stock/i.test(text)) {
      q("dealStock")?.focus();
      return "Já existe uma operação ativa com este n.º de stock. Confirma o stock ou anula/elimina a operação anterior.";
    }
    if (text.includes("deals_active_plate_unique") || /matrícula/i.test(text)) {
      q("dealPlate")?.focus();
      return "Já existe uma operação ativa com esta matrícula. Confirma a matrícula ou anula/elimina a operação anterior.";
    }
    if (text.includes("deals_lender_rate_pct_max_check")) {
      q("dealLenderRate")?.focus();
      return "A comissão da financeira ao stand não pode exceder 20%. Confirma se querias escrever 3,5% em vez de 35%.";
    }
    if (error?.code === "23514") {
      return "Há um valor inválido na operação. Confirma PVP, custos, financiamento e percentagens.";
    }
    return error?.message || "Não foi possível guardar a operação.";
  }

  async function saveDealFromForm(ev) {
    ev.preventDefault();
    const d = formDeal();
    if (d.salePrice <= 0 || !d.vehicle || !d.sellerId || !d.saleDate) {
      toast("Preenche vendedor, data, viatura e PVP.");
      return;
    }
    if ([d.acquisitionCost, d.preparationCost, d.warrantyCost, d.otherDirectCosts, d.financedAmount, d.lenderRatePct].some(v => v < 0)) {
      toast("Custos, financiamento e percentagens não podem ter valores negativos.");
      return;
    }
    if (d.lenderRatePct > 20) {
      q("dealLenderRate")?.focus();
      toast("A comissão da financeira ao stand não pode exceder 20%. Confirma se querias escrever 3,5% em vez de 35%.");
      return;
    }
    if (!confirmSuspiciousDeal(d)) return;

    const existing = d.id ? state.deals.find(x => x.id === d.id) : null;
    const becomingOfficial = d.status === "closed" && (!existing || existing.status === "draft");
    if (becomingOfficial && !confirm("Confirmar esta operação como venda oficial? A partir deste momento será contabilizada no mapa comercial e a comissão ficará congelada.")) {
      return;
    }

    setSync("A guardar operação…", true);
    const payload = { ...dealPayload(d), id: d.id || null };
    const result = await db.rpc("save_deal", { p_deal: payload });

    if (result.error) {
      console.error(result.error);
      setSync("Erro ao guardar", false);
      toast(friendlyDealError(result.error));
      return;
    }

    currentSellerId = d.sellerId;
    closeDealModal();
    await refreshData("Operação guardada");
    toast(d.status === "closed" ? "Venda oficial confirmada e comissão congelada." : "Rascunho guardado.");
  }

  function loadRecommendedScenario() {
    q("simPosition").value = 8;
    q("simSalePrice").value = 25000;
    q("simAcquisition").value = 21000;
    q("simPrep").value = 500;
    q("simWarranty").value = 500;
    q("simOther").value = 500;
    q("simFinanced").value = 18750;
    q("simLenderRate").value = state.settings.referenceLenderRatePct;
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
      financeBonusEnabled: true,
      status: "draft"
    };

    const invalidNumbers = [
      deal.acquisitionCost,
      deal.preparationCost,
      deal.warrantyCost,
      deal.otherDirectCosts,
      deal.financedAmount,
      deal.lenderRatePct
    ].some(value => value < 0);

    if (deal.salePrice <= 0 || invalidNumbers || deal.lenderRatePct > 20) {
      q("simCommission").textContent = "—";
      q("simMargin").textContent = "—";
      q("simFinancePct").textContent = "—";
      q("simFinanceRevenue").textContent = "—";
      q("simFinancedCapitalBonus").textContent = "—";
      q("simNet").textContent = "—";
      q("simRule").textContent = "Corrige os valores";
      q("simExplain").innerHTML = deal.lenderRatePct > 20
        ? "<strong>Valor inválido:</strong> a comissão da financeira ao stand não pode exceder 20%. Se escreveste 35, confirma se querias indicar 3,5%."
        : "<strong>Valor inválido:</strong> o PVP tem de ser superior a zero e os restantes valores não podem ser negativos.";
      return;
    }

    const pos = Math.max(1, num(q("simPosition").value));
    const c = E.calcDeal(deal, pos, state.config);
    q("simCommission").textContent = fmtMoney(c.calculatedCommission);
    q("simMargin").textContent = fmtMoney(c.vehicleMargin);
    q("simFinancePct").textContent = fmtPct(c.financePctRaw);
    q("simFinanceRevenue").textContent = fmtMoney(c.financeRevenue);
    q("simFinancedCapitalBonus").textContent = fmtMoney(c.financedCapitalBonus);
    q("simNet").textContent = fmtMoney(c.resultAfterCommission);
    q("simRule").textContent = "Escalão " + c.volumeTier.label + " · margem " + c.marginBand.label + " · fator " + c.marginBand.factor + "× · mínimo " + fmtMoney(state.config.globalMinCommission);
    const sanityWarnings = dealSanityWarnings(deal);
    const warningHtml = sanityWarnings.length
      ? '<div class="sim-warning"><strong>⚠ Confirma:</strong> ' + sanityWarnings.map(escapeHtml).join(" ") + "</div>"
      : "";
    const bonusText = c.financeBonusEligible
      ? " Nesta posição, o vendedor já é elegível para o bónus financeiro: <strong>" + fmtPct(c.financedCapitalBonusPct) + "</strong> de <strong>" + fmtMoney(c.financedAmount) + "</strong> = <strong>" + fmtMoney(c.financedCapitalBonus) + "</strong>."
      : " Nesta posição, não há bónus financeiro. O bónus começa na venda n.º <strong>" + state.config.financedCapitalBonusStartSale + "</strong> e pode ainda ser desligado individualmente pela chefia.";
    q("simExplain").innerHTML = warningHtml + "A comissão normal desta venda é <strong>" + fmtMoney(c.regularCommission) + "</strong>, calculada pelo volume de vendas e protegida pela margem." + bonusText + " Comissão total: <strong>" + fmtMoney(c.calculatedCommission) + "</strong>.";
  }

  function addSeller() {
    if (!isAdmin()) return;
    if (activeSellers().length >= state.settings.maxSellers) {
      toast("O limite configurado é " + state.settings.maxSellers + " vendedores ativos.");
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
    const config = E.clone(state.config);
    config.globalMinCommission = Math.max(0, num(q("globalMinCommission").value));
    config.globalMaxCommission = Math.max(config.globalMinCommission, num(q("globalMaxCommission").value));
    config.financeCapPct = Math.min(100, Math.max(1, num(q("financeCapPct").value)));
    config.financedCapitalBonusPct = Math.min(20, Math.max(0, num(q("financedCapitalBonusPct").value)));
    config.financedCapitalBonusStartSale = Math.max(1, Math.min(99, Math.floor(num(q("financedCapitalBonusStartSale").value) || 1)));

    qa("#volumeTiersBody input").forEach(input => {
      const i = Number(input.dataset.tier);
      if (Number.isNaN(i) || !config.volumeTiers[i]) return;
      if (input.dataset.point) {
        const point = String(input.dataset.point);
        if (E.FINANCE_POINTS.includes(Number(point))) config.volumeTiers[i].financeGrid[point] = Math.max(0, num(input.value));
        return;
      }
      if (input.dataset.key === "from") config.volumeTiers[i].from = Math.max(0, Math.floor(num(input.value)));
      if (input.dataset.key === "to") config.volumeTiers[i].to = input.value === "" ? null : Math.max(0, Math.floor(num(input.value)));
    });

    qa("#marginBandsBody input").forEach(input => {
      const i = Number(input.dataset.margin);
      const key = input.dataset.key;
      if (Number.isNaN(i) || !key || !config.marginBands[i]) return;
      config.marginBands[i][key] = input.value === "" ? null : num(input.value);
    });

    config.volumeTiers.sort((a,b)=>num(a.from)-num(b.from));
    config.volumeTiers.forEach(t => {
      t.id = t.id || localId("tier");
      t.label = t.to === null ? t.from + "+" : t.from + "–" + t.to;
    });

    config.marginBands.forEach(b => {
      b.id = b.id || localId("margin");
      b.factor = Math.max(0, num(b.factor));
      if (b.min === null && b.max === null) b.label = "Todas as margens";
      else if (b.min === null) b.label = "< " + fmtMoney((b.max || 0) + .01);
      else if (b.max === null) b.label = "≥ " + fmtMoney(b.min);
      else b.label = fmtMoney(b.min) + "–" + fmtMoney(b.max);
    });

    return E.normalizeConfig(config);
  }

  function addVolumeTier() {
    const config = readRulesFromDom();
    const last = config.volumeTiers[config.volumeTiers.length - 1];
    const from = last?.to === null ? num(last.from) + 2 : num(last?.to) + 1;
    if (last && last.to === null) last.to = Math.max(last.from, from - 1);
    config.volumeTiers.push({
      id: localId("tier"),
      label: from + "+",
      from,
      to: null,
      financeGrid: (() => { const v = num(last?.financeGrid?.["0"]) || 120; return {"0":v,"25":v,"50":v,"75":v,"100":v}; })()
    });
    state.config = E.normalizeConfig(config);
    renderRules();
    installInfoButtons();
  }

  function addMarginBand() {
    const config = readRulesFromDom();
    const last = config.marginBands[config.marginBands.length - 1];
    const min = last?.max === null ? num(last?.min) + 500 : num(last?.max) + .01;
    if (last && last.max === null) last.max = Math.max(num(last.min), min - .01);
    config.marginBands.push({
      id: localId("margin"),
      label: "≥ " + fmtMoney(min),
      min,
      max: null,
      factor: num(last?.factor) || 1
    });
    state.config = E.normalizeConfig(config);
    renderRules();
    installInfoButtons();
  }

  function removeVolumeTier(index) {
    const config = readRulesFromDom();
    if (config.volumeTiers.length <= 1) return;
    config.volumeTiers.splice(index,1);
    config.volumeTiers.sort((a,b)=>num(a.from)-num(b.from));
    config.volumeTiers.forEach((t,i)=>{
      if (i === 0) t.from = Math.min(t.from,1);
      if (i < config.volumeTiers.length - 1) t.to = Math.max(t.from, config.volumeTiers[i+1].from - 1);
      else t.to = null;
    });
    state.config = E.normalizeConfig(config);
    renderRules();
  }

  function removeMarginBand(index) {
    const config = readRulesFromDom();
    if (config.marginBands.length <= 1) return;
    config.marginBands.splice(index,1);
    config.marginBands.forEach((b,i)=>{
      if (i === 0) b.min = null;
      if (i === config.marginBands.length - 1) b.max = null;
      if (i > 0 && config.marginBands[i-1].max !== null) b.min = num(config.marginBands[i-1].max) + .01;
    });
    state.config = E.normalizeConfig(config);
    renderRules();
  }

  function configToRpc(config) {
    return {
      tiers: config.volumeTiers.map((t, i) => ({
        tier_code: t.id || ("t" + i),
        label: t.label,
        from_sales: t.from,
        to_sales: t.to,
        commission_0: num(t.financeGrid["0"]),
        commission_25: num(t.financeGrid["0"]),
        commission_50: num(t.financeGrid["0"]),
        commission_75: num(t.financeGrid["0"]),
        commission_100: num(t.financeGrid["0"]),
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

  async function persistRules(config, companyName, settingsOverride) {
    const payload = configToRpc(config);
    const settings = settingsOverride || state.settings;
    const { data, error } = await db.rpc("save_configuration", {
      p_company_name: companyName,
      p_global_min_commission: config.globalMinCommission,
      p_global_max_commission: config.globalMaxCommission,
      p_finance_cap_pct: config.financeCapPct,
      p_financed_capital_bonus_pct: Math.max(0, Math.min(20, num(config.financedCapitalBonusPct))),
      p_financed_capital_bonus_start_sale: Math.max(1, Math.min(99, Math.floor(num(config.financedCapitalBonusStartSale) || 1))),
      p_max_sellers: Math.max(1, Math.min(25, Math.floor(num(settings.maxSellers) || 5))),
      p_reference_lender_rate_pct: Math.max(0, Math.min(20, num(settings.referenceLenderRatePct))),
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
    const settings = {
      maxSellers: Math.max(1, Math.min(25, Math.floor(num(q("maxSellers").value) || 5))),
      referenceLenderRatePct: Math.max(0, Math.min(20, num(q("referenceLenderRatePct").value)))
    };
    try {
      setSync("A guardar nova versão…", true);
      const version = await persistRules(next, companyName, settings);
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
      const version = await persistRules(
        E.clone(E.DEFAULT_CONFIG),
        q("companyName").value.trim() || "Mapa Comercial",
        { maxSellers: 5, referenceLenderRatePct: 3.5 }
      );
      await refreshData("Regras v" + version + " guardadas");
      toast("Regras iniciais repostas.");
    } catch (err) {
      console.error(err);
      setSync("Erro ao repor regras", false);
      toast(err.message || "Não foi possível repor as regras.");
    }
  }

  function exportCSV() {
    const rows = [["Data", "Vendedor", "Stock", "Matricula", "Viatura", "PVP", "Margem", "Capital financiado", "Percentagem financiada", "Receita financeira", "Bonus capital financiado", "Comissao total", "Resultado", "Estado", "Versao regra", "Oficializada em", "Oficializada por", "Anulada em", "Anulada por", "Motivo anulacao"]];
    reportSellers().forEach(s => {
      const m = E.calcSellerMonth(state.deals, s.id, state.month, state.config);
      m.rows.forEach(({ deal, calc }) => rows.push([
        deal.saleDate, s.name, deal.stock || "", deal.plate || "", deal.vehicle || "",
        calc.salePrice, calc.vehicleMargin, calc.financedAmount, calc.financePctRaw,
        calc.financeRevenue, deal.status === "cancelled" ? "" : calc.financedCapitalBonus,
        deal.status === "cancelled" ? "" : calc.commission,
        deal.status === "cancelled" ? "" : calc.resultAfterCommission,
        statusLabel(deal.status), deal.commissionSnapshot?.ruleVersion || state.config.version,
        deal.closedAt || "", deal.closedByEmail || "", deal.cancelledAt || "", deal.cancelledByEmail || "", deal.cancellationReason || ""
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
    if (s.active === false && activeSellers().length >= state.settings.maxSellers) {
      toast("Limite configurado: " + state.settings.maxSellers + " vendedores ativos.");
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

  async function confirmOfficialDeal(id) {
    const deal = state.deals.find(d => d.id === id);
    if (!deal || deal.status !== "draft") return;
    if (!confirm("Confirmar esta operação como venda oficial? Vai passar a contar nas vendas, comissões, margem e resultado do mês.")) return;
    setSync("A tornar venda oficial…", true);
    const { error } = await db.rpc("confirm_deal", { p_deal_id: id });
    if (error) {
      console.error(error);
      setSync("Erro ao confirmar", false);
      toast(error.message || "Não foi possível tornar a venda oficial.");
      return;
    }
    currentSellerId = deal.sellerId;
    await refreshData("Venda oficial confirmada");
    toast("Venda oficial confirmada e comissão congelada.");
  }

  async function deleteDealPermanently(id) {
    const deal = state.deals.find(d => d.id === id);
    if (!deal) return false;
    if (deal.status !== "draft" && !isAdmin()) return false;

    const label = deal.status === "draft"
      ? "este rascunho"
      : 'a venda "' + (deal.vehicle || deal.plate || deal.stock || "selecionada") + '"';
    const warning = deal.status === "draft"
      ? "Eliminar definitivamente " + label + "? Esta ação não pode ser desfeita."
      : "Eliminar DEFINITIVAMENTE " + label + "? A operação será removida do mapa, das contas e do histórico operacional. Esta ação não pode ser desfeita.";
    if (!confirm(warning)) return false;

    setSync("A eliminar operação…", true);
    let error = null;
    if (isAdmin()) {
      const result = await db.rpc("delete_deal_permanently", { p_deal_id: id });
      error = result.error;
    } else {
      const result = await db.from("deals").delete().eq("id", id).eq("status", "draft");
      error = result.error;
    }

    if (error) {
      console.error(error);
      setSync("Erro ao eliminar", false);
      toast(error.message || "Não foi possível eliminar a operação.");
      return false;
    }

    if (q("dealId").value === id) closeDealModal();
    await refreshData("Operação eliminada");
    toast("Operação eliminada definitivamente.");
    return true;
  }

  async function cancelOfficialDeal(id) {
    if (!isAdmin()) return;
    const deal = state.deals.find(d => d.id === id);
    if (!deal || deal.status !== "closed") return;
    const reason = prompt("Motivo da anulação (opcional):", "");
    if (reason === null) return;
    if (!confirm("Anular esta venda oficial? Deixará de contar nos resultados e comissões, mas ficará guardada no histórico.")) return;
    setSync("A anular venda…", true);
    const { error } = await db.rpc("cancel_deal", {
      p_deal_id: id,
      p_reason: reason.trim() || null
    });
    if (error) {
      console.error(error);
      setSync("Erro ao anular", false);
      toast(error.message || "Não foi possível anular a venda.");
      return;
    }
    await refreshData("Venda anulada");
    toast("Venda anulada e preservada no histórico.");
  }

  async function deleteSeller(id) {
    if (!isAdmin()) return;
    const seller = state.sellers.find(s => s.id === id);
    if (!seller) return;
    if (!confirm('Eliminar definitivamente o vendedor "' + seller.name + '"? Só será permitido se nunca tiver operações registadas.')) return;
    setSync("A verificar vendedor…", true);
    const { error } = await db.rpc("delete_unused_seller", { p_seller_id: id });
    if (error) {
      console.error(error);
      setSync("Não eliminado", false);
      toast(error.message || "Não foi possível eliminar o vendedor.");
      return;
    }
    if (currentSellerId === id) currentSellerId = "";
    await refreshData("Vendedor eliminado");
    toast("Vendedor eliminado definitivamente.");
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
    q("dealDeleteButton")?.addEventListener("click", async () => {
      const id = q("dealId").value;
      if (id) await deleteDealPermanently(id);
    });
    qa("#dealForm input,#dealForm select").forEach(el => el.addEventListener("input", updateDealPreview));
    qa("#simForm input").forEach(el => el.addEventListener("input", renderSimulator));
    q("btnSaveRules").addEventListener("click", saveRules);
    q("btnResetRules").addEventListener("click", resetRules);
    q("btnRecommendedScenario").addEventListener("click", loadRecommendedScenario);
    q("btnAddTier").addEventListener("click", addVolumeTier);
    q("btnAddMarginBand").addEventListener("click", addMarginBand);

    document.addEventListener("click", async (ev) => {
      const actionSummary = ev.target.closest(".row-actions summary");
      if (actionSummary) {
        const details = actionSummary.closest(".row-actions");
        closeRowActionMenus(details);
        requestAnimationFrame(() => positionRowActionMenu(details));
        return;
      }

      if (!ev.target.closest(".row-actions")) closeRowActionMenus();

      const info = ev.target.closest("[data-info]");
      if (info) {
        ev.stopPropagation();
        showInfo(info);
        return;
      }
      hideInfo();

      const removeTier = ev.target.closest("[data-remove-tier]");
      if (removeTier) {
        removeVolumeTier(Number(removeTier.dataset.removeTier));
        return;
      }

      const removeMargin = ev.target.closest("[data-remove-margin]");
      if (removeMargin) {
        removeMarginBand(Number(removeMargin.dataset.removeMargin));
        return;
      }

      const sellerCard = ev.target.closest("[data-open-seller]");
      if (sellerCard) {
        currentSellerId = sellerCard.dataset.openSeller;
        renderSellerOptions();
        switchView("sellers");
        return;
      }

      const edit = ev.target.closest("[data-edit-deal]");
      if (edit) {
        closeRowActionMenus();
        openDealModal(edit.dataset.editDeal);
        return;
      }

      const confirmDeal = ev.target.closest("[data-confirm-deal]");
      if (confirmDeal) {
        closeRowActionMenus();
        await confirmOfficialDeal(confirmDeal.dataset.confirmDeal);
        return;
      }

      const deleteDeal = ev.target.closest("[data-delete-deal]");
      if (deleteDeal) {
        closeRowActionMenus();
        await deleteDealPermanently(deleteDeal.dataset.deleteDeal);
        return;
      }

      const cancelDeal = ev.target.closest("[data-cancel-deal]");
      if (cancelDeal) {
        closeRowActionMenus();
        await cancelOfficialDeal(cancelDeal.dataset.cancelDeal);
        return;
      }

      const toggle = ev.target.closest("[data-toggle-seller]");
      if (toggle) {
        await toggleSeller(toggle.dataset.toggleSeller);
        return;
      }

      const removeSeller = ev.target.closest("[data-delete-seller]");
      if (removeSeller) {
        await deleteSeller(removeSeller.dataset.deleteSeller);
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
        hideInfo();
      }
    });
    window.addEventListener("resize", () => {
      hideInfo();
      closeRowActionMenus();
    });
    window.addEventListener("scroll", () => {
      hideInfo();
      closeRowActionMenus();
    }, true);

    db.auth.onAuthStateChange((_event, nextSession) => {
      setTimeout(() => {
        enterSession(nextSession).catch(err => {
          console.error(err);
          showOnlyGate("auth");
          setAuthMessage("Erro ao validar a sessão.", "error");
        });
      }, 0);
    });
  }

  bindEvents();
  startSession().catch(err => {
    console.error(err);
    showOnlyGate("auth");
    setAuthMessage("Erro ao iniciar a aplicação.", "error");
  });
})();
