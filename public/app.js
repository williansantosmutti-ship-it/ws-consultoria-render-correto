const state = {
  user: null,
  settings: {},
  data: {},
  page: "dashboard",
  query: "",
  filters: {},
  filterOpen: new Set(),
  navOpen: new Set(),
  dashboardFilter: "resumo",
  reportFilter: "geral",
  reportOptions: {},
  scheduleView: "week",
  scheduleWeekStart: "",
  scheduleImport: {
    status: "idle",
    fileName: "",
    message: "",
    rows: [],
    rawText: "",
    weekStart: ""
  },
  calendarDate: new Date(),
  remindersOpen: false,
  activeToasts: new Set(),
  dismissedAlerts: new Set(JSON.parse(localStorage.getItem("ws-dismissed-alerts") || "[]"))
};

const DEFAULT_SALES_SHEET_URL = "https://docs.google.com/spreadsheets/d/1VUVzx5q_emUtQtj0k2IG_6Nv2vwIrPcVRLw74UcWb4Y/edit?gid=161138712#gid=161138712";
const SALES_AUTO_SYNC_MS = 60000;
const COMMERCIAL_SELLER_KEYS = new Set(["IVAN", "LUISE", "ISIS", "BRUNA", "ADRIELE"]);
let salesAutoTimer = null;

const mapState = {
  files: [],
  preloaded: [],
  search: "",
  selectedQuery: "Lauro de Freitas BA"
};

const menu = [
  { id: "dashboard", label: "Painel", page: "dashboard" },
  {
    id: "supervision",
    label: "Supervisão Comercial",
    items: [
      ["agenda", "Agenda"],
      ["weeklySchedules", "Programação"],
      ["coverageMap", "Mapa"],
      ["visits", "Relacionamento com Condomínios"],
      ["expansions", "Expansão"]
    ]
  },
  {
    id: "commercial",
    label: "Gestão Comercial",
    items: [
      ["sales", "Vendas"],
      ["sellers", "Vendedores"],
      ["plans", "Planos"]
    ]
  },
  {
    id: "condominiums",
    label: "Gestão de Condomínios",
    items: [["condos", "Condomínios"]]
  },
  {
    id: "admin",
    label: "Administração",
    items: [
      ["reports", "Relatórios"],
      ["backup", "Backup"],
      ["logs", "Histórico"],
      ["users", "Acessos"],
      ["settings", "Empresa"]
    ]
  }
];

const tabs = menu.flatMap((group) => group.page ? [[group.page, group.label]] : group.items);

const $ = (selector) => document.querySelector(selector);
const fmtDate = (value) => {
  if (!value) return "-";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("pt-BR");
  }
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};
const fmtTime = (value) => value ? new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "";
const fmtDateTime = (value) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-";
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const todayISO = () => new Date().toISOString().slice(0, 10);

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "Nao foi possivel concluir.");
  return json;
}

async function boot() {
  registerServiceWorker();
  $("#todayLabel").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  $("#loginForm").addEventListener("submit", login);
  $("#logoutBtn").addEventListener("click", logout);
  $("#themeBtn").addEventListener("click", toggleTheme);
  $("#reminderBtn").addEventListener("click", toggleReminderDrawer);
  try {
    const session = await request("/api/me");
    state.user = session.user;
    state.settings = session.settings;
    await loadAll();
    showApp();
  } catch {
    $("#login").classList.remove("hidden");
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }
}

async function login(event) {
  event.preventDefault();
  $("#loginMessage").textContent = "";
  const form = new FormData(event.currentTarget);
  try {
    const session = await request("/api/login", { method: "POST", body: Object.fromEntries(form) });
    state.user = session.user;
    state.settings = session.settings;
    await loadAll();
    showApp();
  } catch (error) {
    $("#loginMessage").textContent = error.message;
  }
}

async function logout() {
  clearInterval(salesAutoTimer);
  await request("/api/logout", { method: "POST" });
  location.reload();
}

async function loadAll() {
  state.data = await request("/api/all");
  state.settings = state.data.settings;
  for (const key of ["condos", "visits", "sellers", "sales", "plans", "expansions", "weeklySchedules", "activities", "users"]) {
    if (!Array.isArray(state.data[key])) state.data[key] = [];
  }
  await loadMapLayers();
}

async function loadMapLayers() {
  try {
    const response = await fetch("/map-layers.json", { cache: "no-store" });
    if (!response.ok) return;
    const json = await response.json();
    mapState.preloaded = Array.isArray(json.layers) ? json.layers : [];
    const first = mapState.preloaded.flatMap((layer) => layer.points || [])[0];
    if (first && mapState.selectedQuery === "Lauro de Freitas BA") mapState.selectedQuery = `${first.lat},${first.lng}`;
  } catch {
    mapState.preloaded = [];
  }
}

function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  renderNav();
  render();
  startReminders();
  startSalesAutoSync();
}

function renderNav() {
  const activeGroup = menu.find((group) => group.items?.some(([id]) => id === state.page));
  if (activeGroup) state.navOpen.add(activeGroup.id);
  $("#nav").innerHTML = menu.map((group) => {
    if (group.page) {
      return `<button class="nav-btn ${state.page === group.page ? "active" : ""}" data-page="${group.page}">${group.label}</button>`;
    }
    const open = state.navOpen.has(group.id);
    const active = group.items.some(([id]) => id === state.page);
    return `<div class="nav-group ${open ? "open" : ""} ${active ? "active-group" : ""}">
      <button class="nav-group-btn" data-nav-group="${group.id}"><span>${open ? "▼" : "▶"}</span>${group.label}</button>
      <div class="nav-submenu">
        ${group.items.map(([id, label]) => `<button class="nav-btn nav-sub ${state.page === id ? "active" : ""}" data-page="${id}">${label}</button>`).join("")}
      </div>
    </div>`;
  }).join("");
  $("#nav").querySelectorAll("[data-nav-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.navGroup;
      state.navOpen.has(id) ? state.navOpen.delete(id) : state.navOpen.add(id);
      renderNav();
    });
  });
  $("#nav").querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => goToPage(button.dataset.page));
  });
}

function render() {
  $("#pageTitle").textContent = pageLabel(state.page);
  renderLogo();
  applyTheme();
  renderReminderBadge();
  renderReminderDrawer();
  const views = { dashboard, agenda, condos, weeklySchedules, coverageMap, visits, expansions, sellers, sales, plans, reports, backup, logs, users, settings };
  $("#content").innerHTML = views[state.page]();
  bindPageEvents();
}

function goToPage(page) {
  state.page = page;
  state.query = "";
  renderNav();
  render();
}

function applyTheme() {
  const theme = localStorage.getItem("ws-theme") || state.settings.theme || "dark";
  document.body.dataset.theme = theme;
  updateThemeButton(theme);
}

function toggleTheme() {
  const next = (document.body.dataset.theme || "dark") === "dark" ? "light" : "dark";
  localStorage.setItem("ws-theme", next);
  document.body.dataset.theme = next;
  updateThemeButton(next);
}

function updateThemeButton(theme) {
  const button = $("#themeBtn");
  if (!button) return;
  const nextLabel = theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro";
  button.textContent = theme === "dark" ? "\u2600" : "\u{1F319}";
  button.title = nextLabel;
  button.setAttribute("aria-label", nextLabel);
}

function renderLogo() {
  const slot = $("#logoSlot");
  if (state.settings.logoUrl) {
    slot.innerHTML = `<img src="${escapeHtml(state.settings.logoUrl)}" alt="Logo">`;
    slot.style.background = "white";
  } else {
    slot.textContent = "WS";
    slot.style.background = state.settings.primaryColor || "#13251f";
  }
  document.documentElement.style.setProperty("--primary", state.settings.primaryColor || "#13251f");
  document.documentElement.style.setProperty("--accent", state.settings.accentColor || "#c9a227");
}

function reminderEvents() {
  return upcomingEvents().filter((event) => !state.dismissedAlerts.has(alertKey(event))).slice(0, 8);
}

function renderReminderBadge() {
  const count = reminderEvents().length;
  const badge = $("#reminderBadge");
  badge.textContent = count;
  badge.classList.toggle("hidden", count === 0);
}

function renderReminderDrawer() {
  const drawer = $("#alerts");
  const soon = reminderEvents();
  drawer.classList.toggle("hidden", !state.remindersOpen);
  drawer.innerHTML = `<div class="reminder-drawer-head">
    <strong>Lembretes</strong>
    <button class="icon close-reminders" data-close-reminders>×</button>
  </div>
  ${soon.length ? soon.map(reminderItem).join("") : `<div class="empty compact">Nenhum lembrete pendente.</div>`}`;
  bindReminderEvents();
}

function reminderItem(event) {
  return `<div class="alert reminder-item">
    <span><strong>${fmtDateTime(event.date)}</strong> - ${escapeHtml(event.title)}<small>${escapeHtml(event.note || "")}</small></span>
    <div class="alert-actions">
      ${reminderActionButton(event)}
      <button class="ghost" data-dismiss-alert="${alertKey(event)}">Fechar</button>
    </div>
  </div>`;
}

function reminderActionButton(event) {
  const ref = `${event.type}:${event.id}`;
  if (event.type === "weeklySchedules") return `<button class="secondary" data-email="${ref}">Email equipe</button>`;
  return `<button class="secondary" data-calendar="${ref}">Google Agenda</button>`;
}

function renderAlerts() {
  const soon = upcomingEvents().filter((event) => !state.dismissedAlerts.has(alertKey(event))).slice(0, 4);
  $("#toastArea").innerHTML = soon.filter((event) => state.activeToasts.has(alertKey(event))).map((event) => `<div class="toast">
    <button class="toast-close" data-close-toast="${alertKey(event)}">×</button>
    <strong>${fmtDateTime(event.date)}</strong>
    <span>${escapeHtml(event.title)}</span>
    <small>${escapeHtml(event.note || "")}</small>
  </div>`).join("");
  renderReminderBadge();
  renderReminderDrawer();
  bindReminderEvents();
}

function toggleReminderDrawer() {
  state.remindersOpen = !state.remindersOpen;
  renderReminderDrawer();
}

function bindReminderEvents() {
  document.querySelectorAll("[data-dismiss-alert]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => dismissAlert(button.dataset.dismissAlert));
  });
  document.querySelectorAll("[data-close-toast]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => closeToast(button.dataset.closeToast));
  });
  $("[data-close-reminders]")?.addEventListener("click", () => {
    state.remindersOpen = false;
    renderReminderDrawer();
  }, { once: true });
}

function dashboard() {
  const filter = state.dashboardFilter;
  return `
    <section class="card dashboard-filter">
      <div class="section-head">
        <h3>Visão do painel</h3>
        <div class="segmented">
          ${segment("resumo", "Resumo", filter)}
          ${segment("vendas", "Vendas", filter)}
          ${segment("visitas", "Visitas", filter)}
          ${segment("expansao", "Expansão", filter)}
          ${segment("vistoria", "Vistoria", filter)}
        </div>
      </div>
    </section>
    ${dashboardContent(filter)}`;
}

function dashboardContent(filter) {
  if (filter === "vendas") return salesDashboard();
  if (filter === "visitas") return visitsDashboard("Visitas", (visit) => true);
  if (filter === "expansao") return expansionDashboard("Protocolos de implantação e ampliação", (item) => item.type !== "Vistoria");
  if (filter === "vistoria") return expansionDashboard("Vistorias", (item) => item.type === "Vistoria");
  return summaryDashboard();
}

function summaryDashboard() {
  const month = new Date().toISOString().slice(0, 7);
  const salesMonth = visibleSalesRows().filter((sale) => String(sale.date || "").startsWith(month));
  const openVisits = state.data.visits.filter((visit) => visit.status !== "Concluida").length;
  const openExpansions = state.data.expansions.filter((item) => !["Concluido", "Cancelado"].includes(item.status)).length;
  const todayEvents = upcomingEvents(true).filter((event) => String(event.date || "").slice(0, 10) === todayISO());
  const nextEvent = upcomingEvents()[0];
  return `
    <section class="dashboard-hero">
      <div>
        <span>Operação WS Consultoria</span>
        <h3>Controle comercial, visitas e equipe em um só painel</h3>
        <p>${nextEvent ? `Próxima atividade: ${escapeHtml(nextEvent.title)} em ${fmtDateTime(nextEvent.date)}.` : "Nenhuma atividade futura pendente no momento."}</p>
      </div>
      <div class="hero-actions">
        <button class="primary" data-new="weeklySchedules">Programar equipe</button>
        <button class="secondary" data-new="sales">Lançar venda</button>
        <button class="secondary" data-new="visits">Agendar visita</button>
      </div>
    </section>
    <div class="grid cols-4">
      ${metric("Condomínios", state.data.condos.length)}
      ${metric("Visitas abertas", openVisits)}
      ${metric("Vendas do mês", salesMonth.length)}
      ${metric("Protocolos em aberto", openExpansions)}
    </div>
    ${smartRecommendations()}
    <div class="grid cols-2">
      <section class="card">
        <div class="section-head"><h3>Hoje</h3><button class="primary" data-new="weeklySchedules">Nova programação</button></div>
        ${table(["Horário", "Atividade", "Status"], todayEvents.slice(0, 8).map((event) => [fmtTime(event.date), event.title, status(event.status)]))}
      </section>
      <section class="card">
        <div class="section-head"><h3>Ranking de vendedores</h3><button class="primary" data-new="sales">Nova venda</button></div>
        ${table(["Vendedor", "Vendas", "Valor"], sellerRanking().map((row) => [row.name, row.count, money(row.value)]))}
      </section>
    </div>
    <section class="card">
      <div class="section-head"><h3>Próximas atividades</h3><button class="secondary" data-page-jump="weeklySchedules">Ver programação</button></div>
      ${table(["Data", "Atividade", "Local"], upcomingEvents().slice(0, 10).map((event) => [fmtDateTime(event.date), event.title, event.location || "-"]))}
    </section>`;
}

function smartRecommendations() {
  const latest = latestVisitByCondo();
  const stale60 = state.data.condos.filter((condo) => daysSince(latest.get(condo.id)?.date) > 60).length;
  const nextToday = upcomingEvents().filter((event) => String(event.date || "").slice(0, 10) === todayISO()).length;
  const expansionRisk = state.data.expansions.filter((item) => ["Em análise", "Aguardando aprovação", "Em vistoria", "Em inspeção"].includes(item.status)).length;
  const sellerRows = sellerRanking();
  const leader = sellerRows[0];
  const suggestions = [
    stale60 ? { title: `${stale60} condomínios sem visita há mais de 60 dias`, note: "Priorize retorno em locais com potencial comercial alto.", action: "Ver histórico", page: "weeklySchedules" } : null,
    expansionRisk ? { title: `${expansionRisk} demandas de expansão pedem acompanhamento`, note: "Acompanhe aprovações e vistorias para evitar perda de prazo.", action: "Ver expansão", page: "expansions" } : null,
    leader ? { title: `${leader.name} lidera o mês com ${leader.count} venda(s)`, note: "Use o padrão do melhor desempenho para orientar a equipe.", action: "Ver vendedores", page: "sellers" } : null,
    nextToday ? { title: `${nextToday} atividade(s) ainda hoje`, note: "Confira programação e relacionamento antes de sair para campo.", action: "Ver agenda", page: "agenda" } : null
  ].filter(Boolean).slice(0, 4);
  if (!suggestions.length) return "";
  return `<section class="card insight-card">
    <div class="section-head"><h3>Sugestões inteligentes</h3><small>Prioridades geradas pelo sistema</small></div>
    <div class="insight-grid">
      ${suggestions.map((item) => `<article class="insight-item">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.note)}</span>
        <button class="secondary" data-page-jump="${item.page}">${escapeHtml(item.action)}</button>
      </article>`).join("")}
    </div>
  </section>`;
}

function salesDashboard() {
  const month = new Date().toISOString().slice(0, 7);
  const sales = visibleSalesRows().filter((sale) => String(sale.date || "").startsWith(month));
  return `
    <div class="grid cols-3">
      ${metric("Vendas no mês", sales.length)}
      ${metric("Receita apurada", money(sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0)))}
      ${metric("Ticket médio", money(sales.length ? sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0) / sales.length : 0))}
    </div>
    <section class="card">${barChart("Vendas por vendedor", sellerRanking().map((row) => ({ label: row.name, value: row.count })))}</section>
    <section class="card">${table(["Data", "Vendedor", "Cliente", "Valor"], sales.slice(0, 12).map((sale) => [fmtDate(sale.date), saleSellerName(sale) || "-", sale.customer || "-", money(sale.value)]))}</section>`;
}

function visitsDashboard(title, predicate) {
  const rows = state.data.visits.filter(predicate);
  return `
    <div class="grid cols-3">
      ${metric("Total", rows.length)}
      ${metric("Pendentes", rows.filter((item) => item.status !== "Concluida").length)}
      ${metric("Concluidas", rows.filter((item) => item.status === "Concluida").length)}
    </div>
    <section class="card">${barChart(`${title} por status`, counts(rows, "status"))}</section>
    <section class="card">${table(["Data", "Condomínio", "Status", "Obs"], rows.slice(0, 12).map((visit) => [fmtDateTime(visit.date), findById("condos", visit.condoId)?.name || "-", status(visit.status), visit.notes || "-"]))}</section>`;
}

function expansionDashboard(title, predicate) {
  const rows = state.data.expansions.filter(predicate);
  return `
    <div class="grid cols-3">
      ${metric("Protocolos", rows.length)}
      ${metric("Na engenharia", rows.filter((item) => item.status === "Na fila da engenharia").length)}
      ${metric("Em projeto", rows.filter((item) => item.status === "Projeto").length)}
    </div>
    <section class="card">${barChart(title, counts(rows, "status"))}</section>
    <section class="card">${table(["Condomínio", "Protocolo IXC", "Status", "Obs"], rows.slice(0, 12).map((item) => [item.condoName, item.protocol, status(item.status), item.notes || "-"]))}</section>`;
}

function agenda() {
  return `
    <section class="card">
      <div class="section-head">
        <h3>${state.calendarDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</h3>
        <div class="toolbar">
          <button class="secondary" data-cal-prev>Mês anterior</button>
          <button class="secondary" data-cal-today>Hoje</button>
          <button class="secondary" data-cal-next>Próximo mês</button>
          <button class="primary" data-new="visits">Nova visita</button>
        </div>
      </div>
      ${calendarGrid()}
    </section>`;
}

function calendarGrid() {
  const base = state.calendarDate;
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const days = [];
  const events = upcomingEvents(true);
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const iso = day.toISOString().slice(0, 10);
    const inMonth = day.getMonth() === base.getMonth();
    const dayEvents = events.filter((event) => String(event.date || "").slice(0, 10) === iso);
    days.push(`<div class="calendar-day ${inMonth ? "" : "muted-day"} ${iso === todayISO() ? "today" : ""}">
      <strong>${day.getDate()}</strong>
      ${dayEvents.map((event) => `<button class="calendar-event" data-calendar="${event.type}:${event.id}">${fmtTime(event.date)} ${escapeHtml(event.title)}<small>${escapeHtml(event.note || "")}</small></button>`).join("")}
    </div>`);
  }
  return `<div class="calendar-head">${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((day) => `<span>${day}</span>`).join("")}</div><div class="calendar-grid">${days.join("")}</div>`;
}

function condos() {
  const rows = filteredWithPage("condos");
  return `
    ${filterPanel("condos", [
      filterText("city", "Cidade"),
      filterText("neighborhood", "Bairro"),
      filterSelect("status", "Status", ["Ativo", "Pendente", "Inativo"]),
      filterText("administradora", "Administradora"),
      filterText("sindico", "Síndico")
    ])}
    ${listView("Cadastro mestre de condomínios", "condos", ["Nome", "Cidade/Bairro", "Endereço", "Última ida", "Próximo retorno", "Síndico / Administradora", "Unidades", "Status", "Ações"], rows.map((item) => {
    const visitInfo = condoVisitSummary(item.id);
    return [
    item.name,
    [item.city, item.neighborhood].filter(Boolean).join(" / ") || "-",
    item.address || "-",
    visitInfo.lastHtml,
    visitInfo.nextHtml,
    [item.contactName, item.managerCompany, item.phone].filter(Boolean).join(" | ") || "-",
    item.capacity || "-",
    status(item.status || "Ativo"),
    actions("condos", item.id)
  ];
  }))}`;
}

function condoVisitSummary(condoId) {
  const records = [];
  state.data.weeklySchedules.forEach((item) => {
    if (item.condoId !== condoId || !item.date) return;
    records.push({
      date: `${item.date}T${item.startTime || "12:00"}:00`,
      sellers: scheduleSellers(item),
      followUpDays: Number(item.followUpDays || 30),
      source: "Programação",
      status: item.status || "Programada"
    });
  });
  state.data.visits.forEach((visit) => {
    if (visit.condoId !== condoId || !visit.date) return;
    records.push({
      date: visit.date,
      sellers: findById("sellers", visit.sellerId)?.name || visit.responsible || "-",
      followUpDays: 30,
      source: "Relacionamento",
      status: visit.status || "-"
    });
  });
  records.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const last = records[0];
  if (!last) return { lastHtml: "Sem histórico", nextHtml: "Programar primeira ida" };
  const next = new Date(last.date);
  next.setDate(next.getDate() + Number(last.followUpDays || 30));
  const overdue = next < new Date();
  return {
    lastHtml: `${fmtDate(last.date)}<small>${escapeHtml(last.sellers || "-")} | ${escapeHtml(last.status || "-")}</small>`,
    nextHtml: `${fmtDate(next.toISOString())}<small>${overdue ? "Retorno vencido" : "Retorno programado"} | ${escapeHtml(last.source)}</small>`
  };
}

function weeklySchedules() {
  const rows = filteredWithPage("weeklySchedules").sort((a, b) => `${a.date || ""}${a.startTime || ""}`.localeCompare(`${b.date || ""}${b.startTime || ""}`));
  const selectedWeekStart = state.scheduleWeekStart || currentMondayISO();
  const selectedPeriod = schedulePeriodFromDate(selectedWeekStart);
  const boardRows = rows.filter((item) => String(item.date || "") >= selectedPeriod.from && String(item.date || "") <= selectedPeriod.to);
  const today = todayISO();
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);
  const weekRows = state.data.weeklySchedules.filter((item) => item.date >= today && item.date <= weekEndIso);
  return `
    <div class="grid cols-3">
      ${metric("Programações da semana", weekRows.length)}
      ${metric("Condomínios na rota", new Set(weekRows.map((item) => item.condoId).filter(Boolean)).size)}
      ${metric("Equipes externas", weekRows.filter((item) => item.accessMode === "Ficar externo").length)}
    </div>
    ${filterPanel("weeklySchedules", [
      filterInput("from", "Início", "date"),
      filterInput("to", "Fim", "date"),
      filterSelect("seller", "Consultor", options("sellers").slice(1)),
      filterText("region", "Região"),
      filterSelect("condo", "Condomínio", options("condos").slice(1)),
      filterSelect("status", "Status", ["Programada", "Confirmada", "Em andamento", "Concluída", "Reagendar", "Cancelada"])
    ])}
    ${scheduleImportPanel()}
    <section class="card">
      <div class="section-head">
        <h3>Programação</h3>
        <div class="toolbar">
          <div class="segmented">
            ${scheduleSegment("week", "Semana operacional")}
            ${scheduleSegment("history", "Histórico de visitas")}
          </div>
          <div class="week-picker">
            <button class="secondary" type="button" data-schedule-week-nav="-7">Anterior</button>
            <label>Semana<input type="date" data-schedule-week value="${escapeHtml(selectedWeekStart)}"></label>
            <button class="secondary" type="button" data-schedule-week-nav="7">Próxima</button>
          </div>
          <button class="secondary" data-copy-schedule>Copiar programação</button>
          <button class="secondary" data-download-schedule>Baixar PDF</button>
          <button class="primary" data-new="weeklySchedules">Adicionar rota</button>
        </div>
      </div>
      ${state.scheduleView === "history" ? scheduleHistoryView() : weeklyBoard(boardRows, selectedWeekStart)}
    </section>`;
}

function scheduleImportPanel() {
  const weekStart = state.scheduleImport.weekStart || currentMondayISO();
  const rows = state.scheduleImport.rows || [];
  const ready = rows.filter((row) => row.condoId && row.sellerIds.length && row.date);
  const pending = rows.length - ready.length;
  return `<section class="card schedule-import-card">
    <div class="section-head">
      <div>
        <h3>Importar programação por PDF</h3>
        <p class="hint">Selecione o arquivo da programação semanal. O sistema identifica dia, consultor e condomínio usando os cadastros já salvos. Semanas anteriores permanecem salvas; escolha a segunda-feira correta antes de lançar.</p>
      </div>
      <div class="toolbar">
        <label>Segunda-feira da semana<input type="date" data-import-week-start value="${escapeHtml(weekStart)}"></label>
        <label class="file-button">Ler PDF<input type="file" data-import-schedule-pdf accept="application/pdf,.pdf"></label>
        ${rows.length ? `<button class="secondary" data-clear-schedule-import>Limpar</button>` : ""}
        ${ready.length ? `<button class="primary" data-commit-schedule-import>Lançar ${ready.length} rota(s)</button>` : ""}
      </div>
    </div>
    ${state.scheduleImport.message ? `<p class="import-message">${escapeHtml(state.scheduleImport.message)}</p>` : ""}
    ${rows.length ? `<div class="import-summary">
      <span><strong>${rows.length}</strong>linha(s) lida(s)</span>
      <span><strong>${ready.length}</strong>pronta(s) para lançar</span>
      <span><strong>${pending}</strong>precisa(m) revisão</span>
      <span><strong>${escapeHtml(state.scheduleImport.fileName || "-")}</strong>arquivo</span>
    </div>
    ${scheduleImportSpreadsheet(rows)}
    ${scheduleImportIssues(rows)}` : `<div class="empty compact">Nenhum PDF lido ainda.</div>`}
  </section>`;
}

function scheduleImportSpreadsheet(rows) {
  const byDay = new Map(importWeekdays().map((day, index) => [index, []]));
  rows.forEach((row) => byDay.get(row.dayIndex)?.push(row));
  return `<div class="import-sheet">
    ${[...byDay.entries()].map(([dayIndex, dayRows]) => `<section class="import-day ${dayRows.some((row) => !row.ready) ? "has-issues" : ""}">
      <header>
        <strong>${escapeHtml(importWeekdays()[dayIndex]?.label || "Dia")}</strong>
        <span>${dayRows.filter((row) => row.ready).length}/${dayRows.length || 0} pronta(s)</span>
      </header>
      <div class="import-day-body">
        ${dayRows.length ? dayRows.map(scheduleImportCard).join("") : `<div class="empty compact">Sem rota</div>`}
      </div>
    </section>`).join("")}
  </div>`;
}

function scheduleImportCard(row) {
  return `<article class="import-route ${row.ready ? "ready" : "review"}">
    <div>
      <strong>${escapeHtml(row.consultantText || "-")}</strong>
      <span>${escapeHtml(row.startTime)} às ${escapeHtml(row.endTime)}</span>
    </div>
    <p>${escapeHtml(row.condoText || "Sem condomínio")}</p>
    <small>${escapeHtml(row.condoName || row.issue || "Revisar cadastro")}</small>
  </article>`;
}

function scheduleImportIssues(rows) {
  const issues = rows.filter((row) => !row.ready).slice(0, 8);
  if (!issues.length) return "";
  return `<div class="import-issues">
    <strong>Pontos para revisar</strong>
    ${issues.map((row) => `<span>${escapeHtml(row.dayLabel)} - ${escapeHtml(row.consultantText || "-")} - ${escapeHtml(row.condoText || "-")}: ${escapeHtml(row.issue)}</span>`).join("")}
  </div>`;
}

function scheduleSegment(id, label) {
  return `<button class="${state.scheduleView === id ? "active" : ""}" data-schedule-view="${id}">${label}</button>`;
}

function coverageMap() {
  const condoPoints = state.data.condos.map((condo) => ({ label: condo.name, address: condo.address, lat: parseCoords(condo.coordinates)?.lat, lng: parseCoords(condo.coordinates)?.lng, source: "Condomínio cadastrado", kind: "Condomínio" })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
  const preloadedPoints = mapState.preloaded.flatMap((file) => (file.points || []).map((point) => ({ ...point, source: file.name, kind: point.type || "KML/KMZ" })));
  const importedPoints = mapState.files.flatMap((file) => file.points.map((point) => ({ ...point, source: file.name, kind: point.type || "Importado" })));
  const allPoints = [...condoPoints, ...preloadedPoints, ...importedPoints];
  const visiblePoints = filterMapPoints(allPoints);
  const query = mapState.selectedQuery || allPoints[0]?.address || (allPoints[0] ? `${allPoints[0].lat},${allPoints[0].lng}` : "Lauro de Freitas BA");
  const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
  return `
    <div class="grid cols-3">
      ${metric("Condomínios com coordenada", condoPoints.length)}
      ${metric("Arquivos KML/KMZ carregados", mapState.preloaded.length + mapState.files.length)}
      ${metric("Locais marcados", allPoints.length)}
    </div>
    <section class="card">
      <div class="section-head">
        <h3>Mapa Google de cobertura</h3>
        <div class="toolbar">
          <label class="file-button">Adicionar KML/KMZ<input type="file" data-map-files accept=".kml,.kmz" multiple></label>
          <button class="secondary" data-export-kml>Exportar KML</button>
          <button class="secondary" data-export-map-list>Baixar lista</button>
        </div>
      </div>
      <div class="google-map-frame google-map-with-pins">
        <iframe title="Mapa Google" src="${escapeHtml(mapUrl)}" loading="lazy"></iframe>
        ${googleMapOverlay(visiblePoints)}
      </div>
      <p class="hint">Os arquivos KML/KMZ enviados já foram carregados. Os símbolos aparecem sobre o Google Maps para facilitar a identificação visual; clique em um local para centralizar o mapa.</p>
      <div class="map-points-panel">
        <div class="section-head">
          <h3>Locais marcados que atendemos</h3>
          <div class="toolbar">
            <input data-map-search placeholder="Pesquisar condomínio ou ponto..." value="${escapeHtml(mapState.search)}">
            <button class="secondary" data-map-search-apply>Pesquisar</button>
            <button class="secondary" data-clear-map-files>Limpar importações extras</button>
          </div>
        </div>
        <div class="map-point-list">
          ${visiblePoints.slice(0, 600).map((point) => `<button data-map-query="${escapeHtml(point.address || `${point.lat},${point.lng}`)}">${escapeHtml(point.label)}<small>${escapeHtml(point.kind)} | ${escapeHtml(point.source || "")}</small></button>`).join("") || `<div class="empty">Nenhum local marcado encontrado.</div>`}
        </div>
        ${visiblePoints.length > 600 ? `<p class="hint">Mostrando os primeiros 600 locais para manter a tela leve. Use a pesquisa para encontrar um condomínio específico.</p>` : ""}
      </div>
    </section>`;
}

function visits() {
  const rows = filteredWithPage("visits").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return `
    ${relationshipDashboard(rows)}
    ${filterPanel("visits", [
      filterInput("from", "Início", "date"),
      filterInput("to", "Fim", "date"),
      filterSelect("seller", "Responsável", options("sellers").slice(1)),
      filterSelect("condo", "Condomínio", options("condos").slice(1)),
      filterSelect("status", "Status", relationshipStatuses()),
      filterSelect("partnership", "Parceria", ["Alto", "Médio", "Baixo"])
    ])}
    ${listView("Relacionamento com Condomínios", "visits", ["Data", "Condomínio", "Responsável", "Cupom", "Relacionamento", "Próxima visita", "Status", "Ações"], rows.map((visit) => [
    fmtDateTime(visit.date),
    findById("condos", visit.condoId)?.name || "-",
    findById("sellers", visit.sellerId)?.name || visit.responsible || "-",
    visit.couponDelivered || visit.couponCode ? "Sim" : "Não",
    `${visit.relationship || "-"}<small>Potencial: ${escapeHtml(visit.commercialPotential || "-")}</small>`,
    fmtDate(visit.nextVisit),
    status(visit.status || "Agendada"),
    actions("visits", visit.id, true)
  ]))}`;
}

function expansions() {
  const rows = filteredWithPage("expansions");
  return `
    ${expansionMetrics(rows)}
    ${filterPanel("expansions", [
      filterSelect("type", "Tipo da demanda", ["Vistoria", "Inspeção", "Implantação"]),
      filterSelect("status", "Status", expansionStatuses()),
      filterSelect("seller", "Responsável", options("sellers").slice(1)),
      filterText("city", "Cidade"),
      filterText("neighborhood", "Bairro"),
      filterSelect("condo", "Condomínio", options("condos").slice(1))
    ])}
    ${listView("Expansão da operação", "expansions", ["Condomínio", "Endereço", "Responsável", "Tipo", "Prevista", "Status", "Ações"], rows.map((item) => [
    item.condoName,
    item.address || "-",
    findById("sellers", item.sellerId)?.name || item.responsible || "-",
    item.type || "-",
    fmtDate(item.expectedDate || item.date),
    status(item.status || "Em análise"),
    actions("expansions", item.id, true)
  ]))}`;
}

function sellers() {
  const rankings = sellerRanking();
  const sellers = visibleCommercialSellers();
  const monthSales = visibleSalesRows().filter((sale) => String(sale.date || "").startsWith(new Date().toISOString().slice(0, 7)));
  return `
    <div class="seller-grid">
      ${sellers.map((seller) => sellerPanel(seller, monthSales)).join("")}
    </div>
    <section class="card">
      <div class="section-head"><h3>Ranking automático</h3></div>
      ${table(["Posição", "Vendedor", "Vendas", "Receita", "Conversão"], rankings.map((row, index) => [
        index + 1,
        row.name,
        row.count,
        money(row.value),
        `${row.conversion}%`
      ]))}
    </section>
    ${listView("Equipe de vendedores", "sellers", ["Nome", "Contato", "Meta mensal", "Status", "Vendas mês", "Ações"], sellers.map((seller) => [
    seller.name,
    [seller.phone, seller.email].filter(Boolean).join(" | ") || "-",
    seller.goal || 0,
    status(seller.status || "Ativo"),
    sellerRanking().find((row) => row.id === seller.id)?.count || 0,
    actions("sellers", seller.id)
  ]))}`;
}

function sales() {
  const rows = filteredWithPage("sales", visibleSalesRows()).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return `
    ${salesMetrics(rows)}
    ${filterPanel("sales", [
      filterInput("from", "Início", "date"),
      filterInput("to", "Fim", "date"),
      filterSelect("seller", "Vendedor", commercialSellerOptions()),
      filterSelect("condo", "Condomínio", options("condos").slice(1)),
      filterSelect("plan", "Plano", options("plans").slice(1)),
      filterSelect("saleType", "Tipo", ["Venda nova", "Repetidor de sinal", "Upgrade", "Downgrade", "Cancelamento"]),
      filterSelect("status", "Status", ["Confirmada", "Pendente", "Cancelada"]),
      filterInput("minValue", "Valor mínimo", "number")
    ])}
    <section class="card">
      <div class="section-head">
        <h3>Planilha online em tempo real</h3>
        <button class="primary" data-import-sales>Atualizar vendas da planilha</button>
      </div>
      <form id="salesSheetForm" class="form-grid">
        ${input("salesSheetUrl", "Link da planilha online", state.settings.salesSheetUrl || DEFAULT_SALES_SHEET_URL, "url", "full")}
        <p class="hint full">Atualização automática ativa a cada 1 minuto. O sistema importa somente IVAN, LUISE, ISIS, BRUNA e ADRIELE, classificando venda nova, repetidor de sinal, upgrade, downgrade e cancelamento.</p>
        <label class="full">Ou cole aqui os dados copiados da planilha<textarea name="csvText" placeholder="Cole as colunas com cabeçalho: vendedor, cliente, plano, valor, data..."></textarea></label>
        <button class="secondary" type="button" data-import-sales-text>Importar dados colados</button>
      </form>
    </section>
    ${listView("Vendas e apuração", "sales", ["Data", "Vendedor", "Tipo", "Plano", "Cliente", "Condomínio", "Valor", "Status", "Ações"], rows.map((sale) => [
      fmtDate(sale.date),
      saleSellerName(sale) || "-",
      saleTypeLabel(sale),
      findById("plans", sale.planId)?.name || sale.planName || "-",
      sale.customer || "-",
      sale.condoName || findById("condos", sale.condoId)?.name || "-",
      money(sale.value),
      status(saleStatusLabel(sale)),
      actions("sales", sale.id)
    ]))}`;
}

function plans() {
  const rows = filteredWithPage("plans");
  return `
    ${filterPanel("plans", [
      filterSelect("status", "Ativo/Inativo", ["Ativo", "Promocional", "Inativo"]),
      filterText("speed", "Velocidade"),
      filterInput("maxValue", "Valor até", "number")
    ])}
    ${listView("Planos comercializados", "plans", ["Cidade", "Serviço", "Plano", "Preço", "Status", "Anexo/tabela", "Ações"], rows.map((plan) => [
    plan.city || "-",
    plan.serviceType || "-",
    `${escapeHtml(plan.name || "-")}<small>${escapeHtml(plan.speed || "")}</small>`,
    money(plan.price),
    status(plan.status || "Ativo"),
    plan.sheetUrl ? `<a href="${escapeHtml(plan.sheetUrl)}" target="_blank">Abrir tabela</a>` : "-",
    actions("plans", plan.id)
  ]))}`;
}

function reports() {
  const filter = state.reportFilter;
  const selected = selectedReportOptions(filter);
  return `
    <section class="card report-builder">
      <div class="section-head report-builder-head">
        <div>
          <h3>Montar relatório</h3>
          <p class="hint">Escolha a área e marque somente as informações que devem sair no documento.</p>
        </div>
        <div class="toolbar">
          <button class="secondary" data-copy-report>Copiar resumo</button>
          <button class="secondary" data-download-report>TXT</button>
          <button class="secondary" data-download-report-excel>Excel</button>
          <button class="secondary" data-download-report-pdf>PDF / Imprimir</button>
        </div>
      </div>
      <div class="report-area-grid">
        ${reportAreas().map((area) => reportAreaButton(area, filter)).join("")}
      </div>
      <div class="report-options-box">
        <div>
          <strong>Informações do relatório</strong>
          <small>O PDF/Excel será gerado com base nesta seleção.</small>
        </div>
        <div class="report-option-grid">
          ${reportOptionList(filter).map((option) => reportOptionCard(option, selected.has(option.key))).join("")}
        </div>
      </div>
    </section>
    ${reportPreview()}`;
}

function backup() {
  const content = JSON.stringify(state.data, null, 2);
  const sizeKb = Math.max(1, Math.round(new Blob([content]).size / 1024));
  const collections = [
    ["Condomínios", state.data.condos.length],
    ["Relacionamentos", state.data.visits.length],
    ["Programações", state.data.weeklySchedules.length],
    ["Vendas", state.data.sales.length],
    ["Expansões", state.data.expansions.length],
    ["Planos", state.data.plans.length],
    ["Usuários", state.data.users.length],
    ["Histórico", state.data.activities.length]
  ];
  return `
    <div class="grid cols-4">
      ${metric("Tamanho estimado", `${sizeKb} KB`)}
      ${metric("Bases incluídas", collections.length)}
      ${metric("Registros totais", collections.reduce((sum, row) => sum + Number(row[1] || 0), 0))}
      ${metric("Última geração", fmtDateTime(new Date().toISOString()))}
    </div>
    <section class="card backup-panel">
      <div class="section-head">
        <div>
          <h3>Backup completo do sistema</h3>
          <p class="hint">Exporta todos os cadastros, vendas, programações, relacionamento, usuários, configurações e histórico.</p>
        </div>
        <div class="toolbar">
          <button class="secondary" data-copy-backup>Copiar backup</button>
          <button class="primary" data-download-backup>Baixar JSON</button>
        </div>
      </div>
      <div class="backup-summary">
        ${collections.map(([label, value]) => `<span><strong>${value}</strong>${escapeHtml(label)}</span>`).join("")}
      </div>
      <p class="backup-note">Guarde o arquivo em local seguro. Ele contém dados operacionais e acessos do sistema.</p>
    </section>`;
}

function users() {
  return listView("Acessos e categorias", "users", ["Nome", "Email", "Categoria", "Status", "Ações"], filtered("users").map((user) => [
    user.name,
    user.email,
    user.role,
    status(user.active ? "Ativo" : "Inativo", user.active ? "" : "danger"),
    userActions(user)
  ]));
}

function logs() {
  return `
    <section class="card">
      <div class="section-head">
        <h3>Histórico operacional</h3>
        <div class="toolbar">
          <input data-search placeholder="Buscar..." value="${escapeHtml(state.query)}">
          <button class="secondary" data-copy-logs>Copiar histórico</button>
        </div>
      </div>
      ${table(["Data", "Usuário", "Ação", "Detalhe"], filtered("activities").map((item) => [
        fmtDateTime(item.date),
        item.user || "-",
        item.action || "-",
        item.details || "-"
      ]))}
    </section>`;
}

function settings() {
  return `
    <section class="card">
      <div class="section-head"><h3>Personalização e notificações</h3></div>
      <form id="settingsForm" class="form-grid">
        ${input("companyName", "Nome da empresa", state.settings.companyName || "WS CONSULTORIA")}
        ${input("adminEmail", "Email do administrador", state.settings.adminEmail || "")}
        ${input("notificationEmail", "Email para confirmações", state.settings.notificationEmail || "")}
        ${input("primaryColor", "Cor principal premium", state.settings.primaryColor || "#13251f", "color")}
        ${input("accentColor", "Cor de destaque", state.settings.accentColor || "#c9a227", "color")}
        ${select("theme", "Tema inicial", ["dark", "light"], state.settings.theme || "dark")}
        ${input("logoUrl", "URL ou caminho da logo", state.settings.logoUrl || "", "text", "full")}
        ${input("salesSheetUrl", "Link da planilha de vendas", state.settings.salesSheetUrl || DEFAULT_SALES_SHEET_URL, "url", "full")}
        <label class="full">Observações de integração<textarea name="integrationNotes">${escapeHtml(state.settings.integrationNotes || "Lembretes aparecem na tela e podem usar notificações do navegador. Email automático e Google Agenda direto precisam de credenciais SMTP e Google Calendar API.")}</textarea></label>
        <button class="primary" type="submit">Salvar configurações</button>
      </form>
    </section>`;
}

function listView(title, collection, headers, rows, noSearch = false) {
  return `
    <section class="card">
      <div class="section-head">
        <h3>${title}</h3>
        <div class="toolbar">
          ${noSearch ? "" : `<input data-search placeholder="Buscar..." value="${escapeHtml(state.query)}">`}
          <button class="primary" data-new="${collection}">Novo</button>
        </div>
      </div>
      ${table(headers, rows)}
    </section>`;
}

function filterPanel(page, fields) {
  const active = Object.values(state.filters[page] || {}).filter(Boolean).length;
  const open = state.filterOpen.has(page);
  return `<section class="filter-card ${open ? "open" : ""}">
    <div class="filter-head compact">
      <button class="primary" type="button" data-filter-toggle="${page}">Filtro</button>
      <div class="filter-actions">
        <small>${active ? `${active} filtro(s) ativo(s)` : "Sem filtros ativos"}</small>
        <button class="secondary" type="button" data-filter-clear="${page}">Limpar</button>
      </div>
    </div>
    <div class="filter-panel">
      <div class="filter-grid">${fields.join("")}</div>
    </div>
  </section>`;
}

function filterInput(key, label, type = "text") {
  return `<label>${label}<input data-filter="${state.page}:${key}" type="${type}" value="${escapeHtml(filterValue(state.page, key))}"></label>`;
}

function filterText(key, label) {
  return filterInput(key, label, "text");
}

function filterSelect(key, label, values) {
  const current = filterValue(state.page, key);
  const opts = [{ id: "", name: "Todos" }, ...values.map((value) => typeof value === "object" ? value : { id: value, name: value })];
  return `<label>${label}<select data-filter="${state.page}:${key}">
    ${opts.map((item) => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(current) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
  </select></label>`;
}

function filterValue(page, key) {
  return state.filters[page]?.[key] || "";
}

function relationshipDashboard(rows) {
  const now = Date.now();
  const latest = latestVisitByCondo();
  const noVisit30 = state.data.condos.filter((condo) => daysSince(latest.get(condo.id)?.date, now) > 30).length;
  const noVisit60 = state.data.condos.filter((condo) => daysSince(latest.get(condo.id)?.date, now) > 60).length;
  const strong = rows.filter((visit) => ["Excelente", "Bom"].includes(visit.relationship) || visit.partnershipInterest === "Alto").length;
  const weak = rows.filter((visit) => ["Regular", "Ruim"].includes(visit.relationship) || visit.partnershipInterest === "Baixo").length;
  const priority = rows.filter((visit) => visit.commercialPotential === "Alto" && !["Finalizado", "Visitado"].includes(visit.status)).length;
  return `<div class="grid cols-5">
    ${metric("Sem visita > 30 dias", noVisit30)}
    ${metric("Sem visita > 60 dias", noVisit60)}
    ${metric("Parceria forte", strong)}
    ${metric("Parceria fraca", weak)}
    ${metric("Prioritários", priority)}
  </div>`;
}

function expansionMetrics(rows) {
  return `<div class="grid cols-5">
    ${metric("Vistorias pendentes", rows.filter((item) => item.type === "Vistoria" && !["Concluído", "Reprovado"].includes(item.status)).length)}
    ${metric("Inspeções pendentes", rows.filter((item) => item.type === "Inspeção" && !["Concluído", "Reprovado"].includes(item.status)).length)}
    ${metric("Implantações em andamento", rows.filter((item) => item.type === "Implantação" && item.status === "Em implantação").length)}
    ${metric("Implantações concluídas", rows.filter((item) => item.type === "Implantação" && item.status === "Concluído").length)}
    ${metric("Novos em prospecção", rows.filter((item) => item.status === "Em análise").length)}
  </div>`;
}

function visibleCommercialSellers() {
  return state.data.sellers.filter((seller) => COMMERCIAL_SELLER_KEYS.has(firstNameKey(seller.name)));
}

function commercialSellerOptions() {
  return visibleCommercialSellers().map((seller) => ({ id: seller.id, name: seller.name }));
}

function saleSellerName(sale) {
  return findById("sellers", sale.sellerId)?.name || sale.sellerName || sellerNameFromExternalKey(sale) || "";
}

function visibleSalesRows(rows = state.data.sales) {
  return rows.filter((sale) => COMMERCIAL_SELLER_KEYS.has(firstNameKey(saleSellerName(sale))));
}

function sellerNameFromExternalKey(sale) {
  const key = firstNameKey(String(sale.externalKey || "").split("|")[1] || "");
  return COMMERCIAL_SELLER_KEYS.has(key) ? key : "";
}

function firstNameKey(value) {
  return normalizeKey(value).split(" ")[0] || "";
}

function saleTypeLabel(sale) {
  const raw = sale.type || sale.saleType || sale.category || "";
  const text = normalizeKey([raw, sale.planName, sale.notes, sale.status].filter(Boolean).join(" "));
  if (text.includes("CANCEL")) return "Cancelamento";
  if (text.includes("REPETIDOR")) return "Repetidor de sinal";
  if (text.includes("DOWNGRADE") || text.includes("DOWGRAD")) return "Downgrade";
  if (text.includes("UPGRADE")) return "Upgrade";
  return raw || "Venda nova";
}

function saleStatusLabel(sale) {
  const text = normalizeKey([sale.status, sale.type, sale.saleType].filter(Boolean).join(" "));
  if (text.includes("CANCEL")) return "Cancelada";
  if (text.includes("AGUARD") || text.includes("PENDENTE") || text.includes("OBSTRU")) return "Pendente";
  return "Confirmada";
}

function salesMetrics(rows) {
  const today = todayISO();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekIso = weekAgo.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const confirmed = rows.filter((sale) => saleStatusLabel(sale) !== "Cancelada");
  const goal = visibleCommercialSellers().reduce((sum, seller) => sum + Number(seller.goal || 0), 0);
  return `<div class="grid cols-5">
    ${metric("Vendas do dia", confirmed.filter((sale) => String(sale.date || "").slice(0, 10) === today).length)}
    ${metric("Semana", confirmed.filter((sale) => String(sale.date || "").slice(0, 10) >= weekIso).length)}
    ${metric("Mês", confirmed.filter((sale) => String(sale.date || "").startsWith(month)).length)}
    ${metric("Meta", goal)}
    ${metric("Conversão", `${confirmed.length}/${rows.length || 0}`)}
  </div>
  <div class="grid cols-5">
    ${metric("Venda nova", rows.filter((sale) => saleTypeLabel(sale) === "Venda nova").length)}
    ${metric("Repetidor", rows.filter((sale) => saleTypeLabel(sale) === "Repetidor de sinal").length)}
    ${metric("Upgrade", rows.filter((sale) => saleTypeLabel(sale) === "Upgrade").length)}
    ${metric("Downgrade", rows.filter((sale) => saleTypeLabel(sale) === "Downgrade").length)}
    ${metric("Cancelamentos", rows.filter((sale) => saleTypeLabel(sale) === "Cancelamento" || saleStatusLabel(sale) === "Cancelada").length)}
  </div>`;
}

function sellerPanel(seller, monthSales) {
  const rows = monthSales.filter((sale) => sale.sellerId === seller.id);
  const value = rows.reduce((sum, sale) => sum + Number(sale.value || 0), 0);
  const last = rows.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
  const conversion = seller.goal ? Math.round((rows.length / Number(seller.goal || 1)) * 100) : 0;
  return `<section class="card seller-card">
    <div>
      <h3>${escapeHtml(seller.name)}</h3>
      <span>${escapeHtml(seller.status || "Ativo")}</span>
    </div>
    <strong>${rows.length}</strong>
    <small>Meta: ${seller.goal || 0} | Conversão: ${conversion}% | Ticket médio: ${money(rows.length ? value / rows.length : 0)}</small>
    <small>Última venda: ${last ? fmtDate(last.date) : "-"}</small>
  </section>`;
}

function latestVisitByCondo() {
  const map = new Map();
  state.data.visits.forEach((visit) => {
    if (!visit.condoId || !visit.date) return;
    const current = map.get(visit.condoId);
    if (!current || String(visit.date) > String(current.date)) map.set(visit.condoId, visit);
  });
  return map;
}

function daysSince(date, now = Date.now()) {
  if (!date) return 9999;
  return Math.floor((now - new Date(date).getTime()) / 86400000);
}

function dateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dateOnlyTime(value) {
  const iso = dateOnly(value);
  return iso ? new Date(`${iso}T12:00:00`) : null;
}

function addDaysISO(value, days) {
  const date = dateOnlyTime(value);
  if (!date) return "";
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function daysBetweenISO(from, to) {
  const start = dateOnlyTime(from);
  const end = dateOnlyTime(to);
  if (!start || !end) return 9999;
  return Math.round((end - start) / 86400000);
}

function daysSinceISO(value) {
  return daysBetweenISO(value, todayISO());
}

function daysUntilISO(value) {
  return daysBetweenISO(todayISO(), value);
}

function table(headers, rows) {
  if (!rows.length) return `<div class="empty">Nenhum registro encontrado.</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function metric(label, value) {
  return `<section class="card metric"><strong>${value}</strong><span>${label}</span></section>`;
}

function segment(id, label, active) {
  return `<button class="${active === id ? "active" : ""}" data-dashboard-filter="${id}">${label}</button>`;
}

function status(label, tone = "") {
  const warn = ["Agendada", "Pendente", "Em andamento", "Na fila da engenharia", "Comercial", "Projeto"].includes(label) ? "warn" : "";
  return `<span class="status ${tone || warn}">${escapeHtml(label || "-")}</span>`;
}

function actions(collection, id, calendar = false) {
  return `<div class="row-actions">
    ${calendar ? `<button class="secondary" data-calendar="${collection}:${id}">Agenda</button><button class="secondary" data-email="${collection}:${id}">Email</button>` : ""}
    <button class="secondary" data-edit="${collection}:${id}">Editar</button>
    <button class="danger" data-delete="${collection}:${id}">Excluir</button>
  </div>`;
}

function userActions(user) {
  const toggleLabel = user.active ? "Desativar" : "Ativar";
  const nextActive = user.active ? "false" : "true";
  const self = state.user?.id === user.id;
  return `<div class="row-actions">
    <button class="secondary" data-toggle-user="${user.id}:${nextActive}" ${self ? "disabled" : ""}>${toggleLabel}</button>
    <button class="secondary" data-edit="users:${user.id}">Editar</button>
    <button class="danger" data-delete="users:${user.id}" ${self ? "disabled" : ""}>Excluir</button>
  </div>`;
}

function bindPageEvents() {
  document.querySelectorAll("[data-new]").forEach((button) => button.addEventListener("click", () => openForm(button.dataset.new)));
  document.querySelectorAll("[data-schedule-condo]").forEach((button) => button.addEventListener("click", () => openScheduleForCondo(button.dataset.scheduleCondo)));
  document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    const [collection, id] = button.dataset.edit.split(":");
    openForm(collection, findById(collection, id));
  }));
  document.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => removeItem(...button.dataset.delete.split(":"))));
  document.querySelectorAll("[data-toggle-user]").forEach((button) => button.addEventListener("click", () => toggleUser(...button.dataset.toggleUser.split(":"))));
  document.querySelectorAll("[data-page-jump]").forEach((button) => button.addEventListener("click", () => {
    goToPage(button.dataset.pageJump);
  }));
  document.querySelectorAll("[data-map]").forEach((button) => button.addEventListener("click", () => openMap(button.dataset.map)));
  document.querySelectorAll("[data-map-query]").forEach((button) => button.addEventListener("click", () => {
    mapState.selectedQuery = button.dataset.mapQuery;
    render();
  }));
  $("[data-map-search]")?.addEventListener("change", (event) => {
    mapState.search = event.target.value;
    render();
  });
  $("[data-map-search]")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    mapState.search = event.currentTarget.value;
    render();
  });
  $("[data-map-search-apply]")?.addEventListener("click", () => {
    mapState.search = $("[data-map-search]")?.value || "";
    render();
  });
  document.querySelectorAll("[data-calendar]").forEach((button) => button.addEventListener("click", () => openCalendar(button.dataset.calendar)));
  document.querySelectorAll("[data-email]").forEach((button) => button.addEventListener("click", () => openEmail(button.dataset.email)));
  bindReminderEvents();
  document.querySelectorAll("[data-search]").forEach((input) => input.addEventListener("input", () => {
    state.query = input.value;
    render();
  }));
  document.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("input", () => {
    const [page, key] = input.dataset.filter.split(":");
    state.filters[page] = { ...(state.filters[page] || {}), [key]: input.value };
    render();
  }));
  document.querySelectorAll("[data-filter-toggle]").forEach((button) => button.addEventListener("click", () => {
    const page = button.dataset.filterToggle;
    state.filterOpen.has(page) ? state.filterOpen.delete(page) : state.filterOpen.add(page);
    render();
  }));
  document.querySelectorAll("[data-filter-clear]").forEach((button) => button.addEventListener("click", () => {
    state.filters[button.dataset.filterClear] = {};
    state.query = "";
    render();
  }));
  document.querySelectorAll("[data-dashboard-filter]").forEach((button) => button.addEventListener("click", () => {
    state.dashboardFilter = button.dataset.dashboardFilter;
    render();
  }));
  document.querySelectorAll("[data-schedule-view]").forEach((button) => button.addEventListener("click", () => {
    state.scheduleView = button.dataset.scheduleView;
    render();
  }));
  $("[data-schedule-week]")?.addEventListener("change", (event) => {
    state.scheduleWeekStart = currentMondayISO(new Date(`${event.target.value || todayISO()}T12:00:00`));
    render();
  });
  document.querySelectorAll("[data-schedule-week-nav]").forEach((button) => button.addEventListener("click", () => {
    const base = new Date(`${state.scheduleWeekStart || currentMondayISO()}T12:00:00`);
    base.setDate(base.getDate() + Number(button.dataset.scheduleWeekNav || 0));
    state.scheduleWeekStart = currentMondayISO(base);
    render();
  }));
  $("[data-report-filter]")?.addEventListener("change", (event) => {
    state.reportFilter = event.target.value;
    render();
  });
  document.querySelectorAll("[data-report-area]").forEach((button) => button.addEventListener("click", () => {
    state.reportFilter = button.dataset.reportArea;
    render();
  }));
  document.querySelectorAll("[data-report-option]").forEach((input) => input.addEventListener("change", () => {
    setReportOption(state.reportFilter, input.dataset.reportOption, input.checked);
    render();
  }));
  $("[data-copy-report]")?.addEventListener("click", () => navigator.clipboard.writeText(buildReport()));
  $("[data-download-report]")?.addEventListener("click", downloadReport);
  $("[data-download-report-pdf]")?.addEventListener("click", printExecutiveReport);
  $("[data-download-report-excel]")?.addEventListener("click", downloadReportExcel);
  $("[data-copy-backup]")?.addEventListener("click", backupData);
  $("[data-download-backup]")?.addEventListener("click", downloadBackup);
  $("[data-copy-logs]")?.addEventListener("click", copyLogs);
  $("[data-copy-schedule]")?.addEventListener("click", copyWeeklySchedule);
  $("[data-download-schedule]")?.addEventListener("click", downloadWeeklySchedule);
  $("[data-import-schedule-pdf]")?.addEventListener("change", importWeeklySchedulePdf);
  $("[data-import-week-start]")?.addEventListener("change", (event) => {
    state.scheduleImport.weekStart = event.target.value || currentMondayISO();
    state.scheduleWeekStart = state.scheduleImport.weekStart;
    if (state.scheduleImport.rawText) {
      state.scheduleImport.rows = parseWeeklyScheduleText(state.scheduleImport.rawText, state.scheduleImport.weekStart);
    }
    render();
  });
  $("[data-clear-schedule-import]")?.addEventListener("click", clearScheduleImport);
  $("[data-commit-schedule-import]")?.addEventListener("click", commitScheduleImport);
  $("[data-map-files]")?.addEventListener("change", importMapFiles);
  $("[data-clear-map-files]")?.addEventListener("click", () => {
    mapState.files = [];
    render();
  });
  $("[data-export-kml]")?.addEventListener("click", exportCoverageKml);
  $("[data-export-map-list]")?.addEventListener("click", exportMapList);
  $("[data-cal-prev]")?.addEventListener("click", () => moveCalendar(-1));
  $("[data-cal-next]")?.addEventListener("click", () => moveCalendar(1));
  $("[data-cal-today]")?.addEventListener("click", () => {
    state.calendarDate = new Date();
    render();
  });
  $("[data-import-sales]")?.addEventListener("click", importSales);
  $("[data-import-sales-text]")?.addEventListener("click", importSalesText);
  $("#settingsForm")?.addEventListener("submit", saveSettings);
}

function formFields(collection, item = {}) {
  const condoOptions = options("condos", item.condoId);
  const sellerOptions = options("sellers", item.sellerId);
  const planOptions = options("plans", item.planId);
  const fields = {
    condos: [
      input("name", "Nome do condomínio", item.name, "text", "full"),
      input("city", "Cidade", item.city),
      input("neighborhood", "Bairro", item.neighborhood),
      input("address", "Endereço completo", item.address, "text", "full"),
      input("contactName", "Síndico", item.contactName),
      input("managerCompany", "Administradora", item.managerCompany),
      input("capacity", "Quantidade de unidades", item.capacity, "number"),
      input("phone", "Telefone", item.phone),
      input("email", "Email", item.email, "email"),
      select("status", "Status", ["Ativo", "Pendente", "Inativo"], item.status),
      area("notes", "Observações", item.notes, "full")
    ],
    weeklySchedules: [
      select("condoId", "Condomínio", condoOptions, item.condoId, "full"),
      input("address", "Endereço", item.address || findById("condos", item.condoId)?.address || "", "text", "full"),
      input("date", "Data", item.date || todayISO(), "date"),
      input("startTime", "Horário inicial", item.startTime || "09:00", "time"),
      input("endTime", "Horário final", item.endTime || "12:00", "time"),
      multiSelect("sellerIds", "Responsáveis", sellerOptions.slice(1), item.sellerIds || (item.sellerId ? [item.sellerId] : []), "full"),
      input("workArea", "Área / setor de atuação", item.workArea || "", "text", "full"),
      select("accessMode", "Atuação no condomínio", ["Pode entrar", "Ficar externo", "Aguardando autorização"], item.accessMode || "Pode entrar"),
      select("status", "Status", ["Programada", "Confirmada", "Em andamento", "Concluída", "Reagendar", "Cancelada"], item.status || "Programada"),
      input("followUpDays", "Voltar em quantos dias", item.followUpDays || 30, "number"),
      `<div class="schedule-helper full" data-schedule-helper>${scheduleHelperHtml(item.condoId, item.date)}</div>`,
      area("notes", "Orientações para a equipe", item.notes, "full")
    ],
    visits: [
      select("condoId", "Condomínio", condoOptions, item.condoId, "full"),
      input("syndic", "Síndico", item.syndic || findById("condos", item.condoId)?.contactName || ""),
      input("managerCompany", "Administradora", item.managerCompany || findById("condos", item.condoId)?.managerCompany || ""),
      input("date", "Data e hora", item.date ? item.date.slice(0, 16) : "", "datetime-local"),
      select("sellerId", "Responsável", sellerOptions, item.sellerId),
      select("couponDelivered", "Cupom entregue", ["Sim", "Não"], item.couponDelivered || (item.couponCode ? "Sim" : "Não")),
      select("entryAllowed", "Permite entrada", ["Sim", "Não"], item.entryAllowed || "Sim"),
      select("partnershipInterest", "Interesse na parceria", ["Alto", "Médio", "Baixo"], item.partnershipInterest),
      select("relationship", "Relacionamento", ["Excelente", "Bom", "Regular", "Ruim"], item.relationship),
      select("commercialPotential", "Potencial comercial", ["Alto", "Médio", "Baixo"], item.commercialPotential),
      select("status", "Status", relationshipStatuses(), item.status || "Pendente"),
      input("nextVisit", "Próxima visita", item.nextVisit ? String(item.nextVisit).slice(0, 10) : "", "date"),
      input("purpose", "Objetivo", item.purpose || "Relacionamento"),
      input("couponCode", "Código do cupom", item.couponCode),
      area("notes", "Observações", item.notes, "full"),
      area("result", "Feedback / próximos passos", item.result, "full")
    ],
    expansions: [
      select("condoId", "Condomínio cadastrado", condoOptions, item.condoId, "full"),
      input("condoName", "Nome de condomínio", item.condoName, "text", "full"),
      input("address", "Endereço completo", item.address, "text", "full"),
      input("city", "Cidade", item.city),
      input("neighborhood", "Bairro", item.neighborhood),
      select("sellerId", "Responsável", sellerOptions, item.sellerId),
      input("protocol", "Protocolo no IXC", item.protocol),
      select("type", "Tipo da demanda", ["Vistoria", "Inspeção", "Implantação"], item.type || "Vistoria"),
      input("expectedDate", "Data prevista", item.expectedDate ? String(item.expectedDate).slice(0, 10) : "", "date"),
      input("doneDate", "Data realizada", item.doneDate ? String(item.doneDate).slice(0, 10) : "", "date"),
      input("date", "Agenda / prazo", item.date ? item.date.slice(0, 16) : "", "datetime-local"),
      select("status", "Status", expansionStatuses(), item.status || "Em análise"),
      area("notes", "Observações", item.notes, "full")
    ],
    sellers: [
      input("name", "Nome", item.name, "text", "full"),
      input("phone", "Telefone", item.phone),
      input("email", "Email", item.email, "email"),
      input("goal", "Meta mensal", item.goal, "number"),
      select("status", "Status", ["Ativo", "Em treinamento", "Inativo"], item.status)
    ],
    sales: [
      input("date", "Data", item.date || todayISO(), "date"),
      select("sellerId", "Vendedor", sellerOptions, item.sellerId),
      select("planId", "Plano", planOptions, item.planId),
      input("customer", "Cliente", item.customer),
      input("condoName", "Condomínio", item.condoName),
      input("value", "Valor", item.value, "number"),
      select("status", "Status", ["Confirmada", "Pendente", "Cancelada"], item.status),
      area("notes", "Observações", item.notes, "full")
    ],
    plans: [
      input("city", "Cidade", item.city),
      select("serviceType", "Tipo de serviço", ["Internet fibra", "Internet condomínio", "Telefonia", "TV", "Combo", "Outro"], item.serviceType),
      input("name", "Nome do plano", item.name, "text", "full"),
      input("speed", "Velocidade", item.speed),
      input("price", "Preço mensal", item.price, "number"),
      input("installation", "Instalação", item.installation, "number"),
      input("sheetUrl", "Anexo/link da tabela", item.sheetUrl, "url", "full"),
      select("status", "Status", ["Ativo", "Promocional", "Inativo"], item.status),
      area("details", "Detalhes / tabela colada", item.details, "full")
    ],
    users: [
      input("name", "Nome", item.name, "text", "full"),
      input("email", "Email", item.email, "email"),
      input("password", item.id ? "Nova senha (opcional)" : "Senha", "", "password"),
      select("role", "Perfil", ["Administrador", "Supervisor", "Coordenador", "Consultor", "Visitante"], item.role),
      select("active", "Status", [{ id: true, name: "Ativo" }, { id: false, name: "Inativo" }], item.active !== false),
      area("permissions", "Permissões por módulo (separe por vírgula)", Array.isArray(item.permissions) ? item.permissions.join(", ") : item.permissions, "full")
    ]
  };
  return fields[collection] || [];
}

function openForm(collection, item = {}) {
  const modal = $("#modalTemplate").content.firstElementChild.cloneNode(true);
  modal.querySelector("h3").textContent = `${item.id ? "Editar" : "Novo"} ${labelFor(collection)}`;
  modal.querySelector(".modal-body").innerHTML = `<div class="form-grid">${formFields(collection, item).join("")}</div>`;
  modal.querySelectorAll(".close").forEach((button) => button.addEventListener("click", () => modal.remove()));
  if (collection === "weeklySchedules") hydrateScheduleForm(modal);
  modal.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const raw = Object.fromEntries(formData);
    for (const [key] of formData.entries()) {
      if (key.endsWith("[]")) raw[key.slice(0, -2)] = formData.getAll(key).filter(Boolean);
    }
    if (collection === "weeklySchedules") {
      const condo = findById("condos", raw.condoId);
      raw.condoName = condo?.name || raw.condoName || "";
      raw.address = raw.address || condo?.address || "";
      if (!raw.sellerId && Array.isArray(raw.sellerIds)) raw.sellerId = raw.sellerIds[0] || "";
    }
    if (collection === "visits") {
      const condo = findById("condos", raw.condoId);
      raw.condoName = condo?.name || raw.condoName || "";
      raw.syndic = raw.syndic || condo?.contactName || "";
      raw.managerCompany = raw.managerCompany || condo?.managerCompany || "";
    }
    if (collection === "expansions") {
      const condo = findById("condos", raw.condoId);
      raw.condoName = raw.condoName || condo?.name || "";
      raw.address = raw.address || condo?.address || "";
      raw.city = raw.city || condo?.city || "";
      raw.neighborhood = raw.neighborhood || condo?.neighborhood || "";
    }
    const body = normalize(collection, raw);
    const saved = await request(item.id ? `/api/${collection}/${item.id}` : `/api/${collection}`, {
      method: item.id ? "PUT" : "POST",
      body
    });
    modal.remove();
    await loadAll();
    render();
    if (collection === "weeklySchedules" && scheduleSellerEmails(saved).length && confirm("Abrir email com a programação da semana para os consultores?")) {
      openWeeklyScheduleEmail(`weeklySchedules:${saved.id}`);
    }
  });
  document.body.appendChild(modal);
}

function input(name, label, value = "", type = "text", klass = "") {
  return `<label class="${klass}">${label}<input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}"></label>`;
}

function area(name, label, value = "", klass = "") {
  return `<label class="${klass}">${label}<textarea name="${name}">${escapeHtml(value ?? "")}</textarea></label>`;
}

function select(name, label, values, selected = "", klass = "") {
  const opts = values.map((value) => {
    const id = typeof value === "object" ? value.id : value;
    const text = typeof value === "object" ? value.name : value;
    return `<option value="${escapeHtml(id)}" ${String(id) === String(selected ?? "") ? "selected" : ""}>${escapeHtml(text)}</option>`;
  }).join("");
  return `<label class="${klass}">${label}<select name="${name}">${opts}</select></label>`;
}

function multiSelect(name, label, values, selected = [], klass = "") {
  const selectedSet = new Set((Array.isArray(selected) ? selected : [selected]).map(String));
  const opts = values.map((value) => {
    const id = typeof value === "object" ? value.id : value;
    const text = typeof value === "object" ? value.name : value;
    return `<option value="${escapeHtml(id)}" ${selectedSet.has(String(id)) ? "selected" : ""}>${escapeHtml(text)}</option>`;
  }).join("");
  return `<label class="${klass}">${label}<select name="${name}[]" multiple size="${Math.min(6, Math.max(3, values.length))}">${opts}</select><small class="field-hint">Segure Ctrl para selecionar mais de um responsável.</small></label>`;
}

function options(collection) {
  const values = (state.data[collection] || []).map((item) => ({ id: item.id, name: item.name }));
  return [{ id: "", name: "Selecione" }, ...values];
}

function hydrateScheduleForm(modal) {
  const condoSelect = modal.querySelector("select[name='condoId']");
  const dateInput = modal.querySelector("input[name='date']");
  const addressInput = modal.querySelector("input[name='address']");
  const helper = modal.querySelector("[data-schedule-helper]");
  const update = () => {
    const condo = findById("condos", condoSelect?.value);
    if (addressInput && condo?.address) addressInput.value = condo.address;
    if (helper) helper.innerHTML = scheduleHelperHtml(condoSelect?.value, dateInput?.value);
  };
  condoSelect?.addEventListener("change", update);
  dateInput?.addEventListener("change", update);
  update();
}

function scheduleHelperHtml(condoId, date = todayISO()) {
  if (!condoId) return "Selecione um condomínio para ver histórico de visita e prazo de retorno.";
  const info = condoScheduleInfo(condoId, date);
  return `
    <strong>${escapeHtml(info.title)}</strong>
    <span>${escapeHtml(info.detail)}</span>
  `;
}

function condoScheduleInfo(condoId, date = todayISO()) {
  const condo = findById("condos", condoId);
  const last = lastCondoActivity(condoId, date);
  if (!last) {
    return {
      title: "Sem visita registrada",
      detail: `${condo?.name || "Condomínio"} deve entrar como prioridade de primeira passagem.`
    };
  }
  const base = new Date(date || todayISO());
  const lastDate = new Date(last.date);
  const days = Math.max(0, Math.floor((base - lastDate) / 86400000));
  const followUpDays = Number(last.followUpDays || 30);
  const next = new Date(lastDate);
  next.setDate(next.getDate() + followUpDays);
  const overdue = next < base;
  return {
    title: `${days} dia(s) sem passar neste condomínio`,
    detail: overdue ? `Retorno recomendado: agora. Última passagem em ${fmtDate(last.date)}.` : `Próximo retorno sugerido: ${fmtDate(next.toISOString())}. Última passagem em ${fmtDate(last.date)}.`
  };
}

function lastCondoActivity(condoId, beforeDate = todayISO()) {
  const before = new Date(`${beforeDate || todayISO()}T23:59:59`).getTime();
  const visitRows = state.data.visits
    .filter((item) => item.condoId === condoId && item.date && new Date(item.date).getTime() <= before)
    .map((item) => ({ date: item.date, followUpDays: 30 }));
  const scheduleRows = state.data.weeklySchedules
    .filter((item) => item.condoId === condoId && item.date && new Date(`${item.date}T12:00:00`).getTime() <= before)
    .map((item) => ({ date: `${item.date}T12:00:00`, followUpDays: item.followUpDays || 30 }));
  return [...visitRows, ...scheduleRows].sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

function scheduleReminder(item) {
  const info = condoScheduleInfo(item.condoId, item.date);
  return `<strong>${escapeHtml(info.title)}</strong><small>${escapeHtml(info.detail)}</small>`;
}

function weekDays(weekStart = currentMondayISO()) {
  const start = new Date(`${weekStart || currentMondayISO()}T12:00:00`);
  return Array.from({ length: 6 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function weeklyBoard(rows, weekStart = currentMondayISO()) {
  const byDate = new Map();
  rows.forEach((item) => {
    const key = item.date || "";
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(item);
  });
  return `<div class="weekly-board">
    ${weekDays(weekStart).map((day) => {
      const iso = day.toISOString().slice(0, 10);
      const items = byDate.get(iso) || [];
      return `<section class="week-column">
        <header>
          <strong>${day.toLocaleDateString("pt-BR", { weekday: "short" })}</strong>
          <span>${day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
        </header>
        <div class="week-items">
          ${items.length ? items.map(scheduleCard).join("") : `<button class="empty-day" data-new="weeklySchedules">Adicionar rota</button>`}
        </div>
      </section>`;
    }).join("")}
  </div>`;
}

function scheduleCard(item) {
  const condo = findById("condos", item.condoId);
  const info = condoScheduleInfo(item.condoId, item.date);
  return `<article class="schedule-card">
    <div>
      <strong>${escapeHtml(condo?.name || item.condoName || "Condomínio")}</strong>
      <small>${item.startTime || "-"} às ${item.endTime || "-"} | ${escapeHtml(scheduleSellers(item) || "Equipe")}</small>
    </div>
    <span>${escapeHtml(item.workArea || item.accessMode || "Atuação")}</span>
    <p>${escapeHtml(info.title)}</p>
    <div class="row-actions">
      <button class="secondary" data-edit="weeklySchedules:${item.id}">Editar</button>
      <button class="secondary" data-email="weeklySchedules:${item.id}">Enviar equipe</button>
      <button class="secondary" data-map="${escapeHtml(item.address || condo?.address || "")}">Mapa</button>
      <button class="danger" data-delete="weeklySchedules:${item.id}">Excluir</button>
    </div>
  </article>`;
}

function scheduleHistoryView() {
  const rows = scheduleHistoryRows();
  const allRows = scheduleHistoryRows({ ignoreQuery: true });
  const reminders = allRows
    .filter((row) => row.nextDate && row.nextDelta <= 7)
    .sort((a, b) => a.nextDelta - b.nextDelta || b.priorityScore - a.priorityScore)
    .slice(0, 8);
  const lowActionRows = allRows
    .filter((row) => row.priorityScore >= 45)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.daysWithoutAction - a.daysWithoutAction)
    .slice(0, 8);
  return `
    <div class="history-toolbar">
      <input data-search placeholder="Buscar condomínio, endereço ou responsável..." value="${escapeHtml(state.query)}">
      <p class="hint">Veja a última ação por condomínio, retorno recomendado, última venda e locais com baixa movimentação comercial.</p>
    </div>
    <div class="history-kpis">
      ${historyKpi("Retorno vencido", allRows.filter((row) => row.overdue).length, "danger")}
      ${historyKpi("Sem ação +30 dias", allRows.filter((row) => row.daysWithoutAction > 30).length, "warn")}
      ${historyKpi("Sem ação +60 dias", allRows.filter((row) => row.daysWithoutAction > 60).length, "danger")}
      ${historyKpi("Sem venda +60 dias", allRows.filter((row) => row.daysWithoutSale > 60).length, "warn")}
    </div>
    ${historyReminderPanel(reminders)}
    ${historyPriorityPanel(lowActionRows)}
    ${table(["Condomínio / endereço", "Última ação", "Última venda", "Lembrete", "Movimento comercial", "Ações"], rows.map((row) => [
      `${escapeHtml(row.condoName)}<small>${escapeHtml(row.address || "")}</small>`,
      historyLastActionCell(row),
      historyLastSaleCell(row),
      historyReminderCell(row),
      historyMovementCell(row),
      historyRowActions(row)
    ]))}
  `;
}

function historyKpi(label, value, tone = "") {
  return `<section class="history-kpi ${tone}"><strong>${value}</strong><span>${escapeHtml(label)}</span></section>`;
}

function historyReminderPanel(rows) {
  if (!rows.length) return "";
  return `<section class="history-panel">
    <div class="section-head"><h3>Lembretes de retorno</h3><span class="hint">Condomínios vencidos ou próximos de voltar</span></div>
    <div class="history-card-grid">
      ${rows.map(historyReminderCard).join("")}
    </div>
  </section>`;
}

function historyPriorityPanel(rows) {
  if (!rows.length) return "";
  return `<section class="history-panel">
    <div class="section-head"><h3>Baixa ação comercial</h3><span class="hint">Sugestões para montar a próxima programação</span></div>
    <div class="history-card-grid">
      ${rows.map(historyPriorityCard).join("")}
    </div>
  </section>`;
}

function historyReminderCard(row) {
  return `<article class="history-card ${row.overdue ? "danger" : ""}">
    <div><strong>${escapeHtml(row.condoName)}</strong><span>${escapeHtml(row.reminderText)}</span></div>
    <small>Última ação: ${row.lastDate ? fmtDate(row.lastDate) : "Nunca"}${row.lastSource ? ` | ${escapeHtml(row.lastSource)}` : ""}</small>
    <small>${escapeHtml(row.sellers || "Sem responsável recente")}</small>
    ${historyRowActions(row)}
  </article>`;
}

function historyPriorityCard(row) {
  return `<article class="history-card priority">
    <div><strong>${escapeHtml(row.condoName)}</strong><span>${escapeHtml(row.priorityText)}</span></div>
    <small>Última ação: ${row.lastDate ? fmtDate(row.lastDate) : "Nunca"} | ${row.actions30} ação(ões) em 30 dias</small>
    <small>Última venda: ${row.lastSaleDate ? fmtDate(row.lastSaleDate) : "Sem venda registrada"} | ${row.sales60} venda(s) em 60 dias</small>
    ${historyRowActions(row)}
  </article>`;
}

function historyLastActionCell(row) {
  if (!row.lastDate) return `Nunca<small>Programar primeira ida</small>`;
  return `${fmtDate(row.lastDate)}<small>${escapeHtml(row.lastSource || "Ação")} | ${escapeHtml(row.sellers || "-")}</small>`;
}

function historyLastSaleCell(row) {
  if (!row.lastSaleDate) return `Sem venda<small>${row.sales60} venda(s) em 60 dias</small>`;
  return `${fmtDate(row.lastSaleDate)}<small>${row.sales30} venda(s) em 30 dias | ${row.sales60} em 60 dias</small>`;
}

function historyReminderCell(row) {
  const tone = !row.lastDate ? "warn" : row.overdue ? "danger" : row.nextDelta <= 7 ? "warn" : "";
  return `${status(row.reminderText, tone)}<small>${escapeHtml(row.priorityText)}</small>`;
}

function historyMovementCell(row) {
  return `${row.actions30} ação(ões) em 30 dias<small>${row.actions60} em 60 dias | Histórico total: ${row.count}</small>`;
}

function historyRowActions(row) {
  return `<div class="row-actions">
    <button class="primary" data-schedule-condo="${escapeHtml(row.condoId)}">Programar</button>
    ${row.address ? `<button class="secondary" data-map="${escapeHtml(row.address)}">Mapa</button>` : ""}
  </div>`;
}

function scheduleHistoryRows(options = {}) {
  const byCondo = new Map();
  state.data.condos.forEach((condo) => {
    byCondo.set(condo.id, emptyHistoryRow(condo.id, condo.name, condo.address));
  });
  const ensureRow = (condoId, fallback = {}) => {
    const condo = findById("condos", condoId);
    if (!byCondo.has(condoId)) byCondo.set(condoId, emptyHistoryRow(condoId, fallback.condoName || condo?.name || "Condomínio", fallback.address || condo?.address || ""));
    return byCondo.get(condoId);
  };
  const addAction = (condoId, action) => {
    if (!condoId || !action.date) return;
    const row = ensureRow(condoId, action);
    const actionDate = dateOnly(action.date);
    const days = daysSinceISO(actionDate);
    row.count += 1;
    if (days <= 30) row.actions30 += 1;
    if (days <= 60) row.actions60 += 1;
    if (!row.lastDate || actionDate > row.lastDate) {
      row.lastDate = actionDate;
      row.lastSource = action.source || "Ação";
      row.nextDate = action.nextDate ? dateOnly(action.nextDate) : addDaysISO(actionDate, Number(action.followUpDays || 30));
      row.sellers = action.sellers || "";
      row.workArea = action.workArea || "";
    }
  };
  state.data.weeklySchedules.forEach((item) => addAction(item.condoId, {
    date: item.date,
    condoName: item.condoName,
    address: item.address || findById("condos", item.condoId)?.address || "",
    source: "Programação",
    sellers: scheduleSellers(item),
    workArea: item.workArea || item.accessMode || "",
    followUpDays: item.followUpDays || 30
  }));
  state.data.visits.forEach((visit) => {
    const condo = findById("condos", visit.condoId);
    addAction(visit.condoId, {
      date: visit.date,
      condoName: condo?.name || "Condomínio",
      address: condo?.address || "",
      source: "Relacionamento",
      sellers: findById("sellers", visit.sellerId)?.name || visit.responsible || "Visita registrada",
      workArea: visit.purpose || visit.status || "",
      nextDate: visit.nextVisit,
      followUpDays: 30
    });
  });
  visibleSalesRows().forEach((sale) => {
    if (!sale.condoId || !sale.date) return;
    const condo = findById("condos", sale.condoId);
    const row = ensureRow(sale.condoId, { condoName: sale.condoName || condo?.name, address: condo?.address || "" });
    const saleDate = dateOnly(sale.date);
    const days = daysSinceISO(saleDate);
    if (days <= 30) row.sales30 += 1;
    if (days <= 60) row.sales60 += 1;
    if (!row.lastSaleDate || saleDate > row.lastSaleDate) row.lastSaleDate = saleDate;
  });
  byCondo.forEach((row) => {
    row.daysWithoutAction = row.lastDate ? daysSinceISO(row.lastDate) : 9999;
    row.daysWithoutSale = row.lastSaleDate ? daysSinceISO(row.lastSaleDate) : 9999;
    row.nextDelta = row.nextDate ? daysUntilISO(row.nextDate) : -9999;
    row.overdue = Boolean(row.lastDate) && row.nextDelta < 0;
    row.reminderText = historyReminderText(row);
    row.priorityText = historyPriorityText(row);
    row.priorityScore = historyPriorityScore(row);
  });
  const q = state.query.trim().toLowerCase();
  return [...byCondo.values()]
    .filter((row) => options.ignoreQuery || !q || JSON.stringify(row).toLowerCase().includes(q))
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return String(a.nextDate || "9999").localeCompare(String(b.nextDate || "9999"));
    });
}

function emptyHistoryRow(condoId, condoName, address) {
  return {
    condoId,
    condoName,
    address,
    lastDate: "",
    lastSource: "",
    nextDate: "",
    sellers: "",
    workArea: "",
    overdue: false,
    count: 0,
    actions30: 0,
    actions60: 0,
    lastSaleDate: "",
    sales30: 0,
    sales60: 0,
    daysWithoutAction: 9999,
    daysWithoutSale: 9999,
    nextDelta: 9999,
    priorityScore: 0,
    priorityText: "",
    reminderText: ""
  };
}

function historyPriorityScore(row) {
  let score = 0;
  if (!row.lastDate) score += 80;
  if (row.overdue) score += 35;
  if (row.daysWithoutAction > 60) score += 35;
  else if (row.daysWithoutAction > 30) score += 20;
  if (!row.actions30) score += 12;
  if (row.daysWithoutSale > 60) score += 16;
  if (!row.sales60) score += 10;
  return score;
}

function historyReminderText(row) {
  if (!row.lastDate) return "Primeira ação pendente";
  if (!row.nextDate) return "Definir retorno";
  if (row.nextDelta < 0) return `Vencido há ${Math.abs(row.nextDelta)} dia(s)`;
  if (row.nextDelta === 0) return "Retorno hoje";
  return `Retorno em ${row.nextDelta} dia(s)`;
}

function historyPriorityText(row) {
  if (!row.lastDate) return "Sem histórico de ação";
  if (row.daysWithoutAction > 60) return `Sem ação há ${row.daysWithoutAction} dia(s)`;
  if (row.daysWithoutSale > 60) return `Sem venda há ${row.daysWithoutSale} dia(s)`;
  if (!row.actions30) return "Sem ação nos últimos 30 dias";
  return "Acompanhar recorrência";
}

function openScheduleForCondo(condoId) {
  const row = scheduleHistoryRows({ ignoreQuery: true }).find((item) => item.condoId === condoId);
  const condo = findById("condos", condoId);
  if (!condo && !row) return alert("Condomínio não localizado para programar.");
  const targetDate = row?.nextDate && row.nextDelta >= 0 ? row.nextDate : todayISO();
  openForm("weeklySchedules", {
    condoId,
    condoName: condo?.name || row?.condoName || "",
    address: condo?.address || row?.address || "",
    date: targetDate,
    startTime: "09:00",
    endTime: "12:00",
    workArea: "Ação comercial / relacionamento",
    accessMode: "Pode entrar",
    status: "Programada",
    followUpDays: 30,
    notes: row ? `${row.reminderText}. ${row.priorityText}. Última ação: ${row.lastDate ? fmtDate(row.lastDate) : "sem histórico"}.` : "Programação criada a partir do histórico."
  });
}

function scheduleActions(item) {
  const condo = findById("condos", item.condoId);
  const address = item.address || condo?.address || "";
  return address ? `<div class="row-actions"><button class="secondary" data-map="${escapeHtml(address)}">Mapa</button></div>` : "";
}

function scheduleSellers(item) {
  const ids = scheduleSellerIds(item);
  return ids.map((id) => findById("sellers", id)?.name).filter(Boolean).join(", ");
}

function parseCoords(value) {
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

function openMap(address) {
  if (!address) return alert("Este registro não tem endereço para abrir no mapa.");
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, "_blank");
}

async function importMapFiles(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  try {
    const imported = [];
    for (const file of files) {
      const kmlText = await readKmlOrKmz(file);
      imported.push({ name: file.name, text: kmlText, points: parseKmlPoints(kmlText) });
    }
    mapState.files = [...mapState.files, ...imported];
    if (imported[0]?.points[0]) mapState.selectedQuery = `${imported[0].points[0].lat},${imported[0].points[0].lng}`;
    render();
  } catch (error) {
    alert(error.message);
  }
}

async function readKmlOrKmz(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".kml")) return file.text();
  if (!lower.endsWith(".kmz")) throw new Error("Importe apenas arquivos KML ou KMZ.");
  if (!window.JSZip) throw new Error("Leitor KMZ não carregou. Atualize a página e tente novamente.");
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const kmlEntry = Object.values(zip.files).find((entry) => entry.name.toLowerCase().endsWith(".kml"));
  if (!kmlEntry) throw new Error(`O arquivo ${file.name} não contém KML.`);
  return kmlEntry.async("text");
}

function parseKmlPoints(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const placemarks = [...doc.querySelectorAll("Placemark")];
  return placemarks.map((placemark, index) => {
    const label = placemark.querySelector("name")?.textContent?.trim() || `Ponto ${index + 1}`;
    const coordText = placemark.querySelector("Point coordinates, coordinates")?.textContent?.trim() || "";
    const first = coordText.split(/\s+/).find(Boolean);
    if (!first) return null;
    const [lng, lat] = first.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { label, lat, lng };
  }).filter(Boolean);
}

function filterMapPoints(points) {
  const q = mapState.search.trim().toLowerCase();
  if (!q) return points;
  return points.filter((point) => [point.label, point.address, point.source, point.kind].some((value) => String(value || "").toLowerCase().includes(q)));
}

function googleMapOverlay(points) {
  const usable = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (!usable.length) return "";
  const maxPins = usable.slice(0, 180);
  const lats = usable.map((point) => point.lat);
  const lngs = usable.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const rangeLat = maxLat - minLat || 1;
  const rangeLng = maxLng - minLng || 1;
  return `<div class="google-pin-layer" aria-label="Pontos de cobertura">
    ${maxPins.map((point) => {
      const left = Math.min(96, Math.max(4, ((point.lng - minLng) / rangeLng) * 92 + 4));
      const top = Math.min(92, Math.max(8, (1 - ((point.lat - minLat) / rangeLat)) * 84 + 8));
      const label = point.kind === "Condomínio" ? "C" : "R";
      return `<button class="google-pin ${point.kind === "Condomínio" ? "condo" : "network"}" style="left:${left}%;top:${top}%" title="${escapeHtml(point.label)}" data-map-query="${escapeHtml(point.address || `${point.lat},${point.lng}`)}">${label}</button>`;
    }).join("")}
  </div>`;
}

function buildCoverageKml() {
  const condoPlacemarks = state.data.condos.map((condo) => {
    const coords = parseCoords(condo.coordinates);
    if (!coords) return "";
    return `<Placemark><name>${xmlEscape(condo.name)}</name><description>${xmlEscape(condo.address || "")}</description><Point><coordinates>${coords.lng},${coords.lat},0</coordinates></Point></Placemark>`;
  }).join("");
  const layerPlacemarks = mapState.preloaded.flatMap((file) => (file.points || []).map((point) => {
    return `<Placemark><name>${xmlEscape(point.label)}</name><description>${xmlEscape(file.name || point.type || "KML/KMZ")}</description><Point><coordinates>${point.lng},${point.lat},0</coordinates></Point></Placemark>`;
  })).join("");
  const imported = mapState.files.map((file) => file.text).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Sistema de Gestão Comercial - Cobertura</name>
    ${condoPlacemarks}
    ${layerPlacemarks}
    ${imported.replace(/<\?xml[^>]*>/g, "").replace(/<\/?kml[^>]*>/g, "").replace(/<\/?Document[^>]*>/g, "")}
  </Document>
</kml>`;
}

function exportCoverageKml() {
  download(new Blob([buildCoverageKml()], { type: "application/vnd.google-earth.kml+xml;charset=utf-8" }), `mapa-cobertura-${todayISO()}.kml`);
}

function exportMapList() {
  const condoRows = state.data.condos.map((condo) => {
    const coords = parseCoords(condo.coordinates);
    return [condo.name, condo.address || "", coords?.lat || "", coords?.lng || ""].join("\t");
  });
  const fileRows = mapState.files.flatMap((file) => file.points.map((point) => [point.label, file.name, point.lat, point.lng].join("\t")));
  const preloadedRows = mapState.preloaded.flatMap((file) => (file.points || []).map((point) => [point.label, file.name, point.lat, point.lng].join("\t")));
  const content = [["Nome", "Origem/Endereço", "Latitude", "Longitude"].join("\t"), ...condoRows, ...preloadedRows, ...fileRows].join("\n");
  download(new Blob([content], { type: "text/plain;charset=utf-8" }), `lista-mapa-${todayISO()}.txt`);
}

function xmlEscape(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char]));
}

function coverageCanvas(points, importedPoints = []) {
  const external = importedPoints.map((point) => ({ condo: { id: `kml-${point.lat}-${point.lng}`, name: point.label, address: `${point.lat},${point.lng}` }, coords: { lat: point.lat, lng: point.lng }, imported: true }));
  const allPoints = [...points, ...external];
  if (!allPoints.length) return `<div class="empty">Sem coordenadas cadastradas para montar o mapa.</div>`;
  const scheduledIds = new Set(state.data.weeklySchedules.map((item) => item.condoId).filter(Boolean));
  const lats = allPoints.map((item) => item.coords.lat);
  const lngs = allPoints.map((item) => item.coords.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const rangeLat = maxLat - minLat || 1;
  const rangeLng = maxLng - minLng || 1;
  return `<div class="coverage-map">
    ${allPoints.map(({ condo, coords, imported }) => {
      const left = ((coords.lng - minLng) / rangeLng) * 92 + 4;
      const top = (1 - ((coords.lat - minLat) / rangeLat)) * 84 + 8;
      const active = scheduledIds.has(condo.id) ? "active" : "";
      const importedClass = imported ? "imported" : "";
      return `<button class="map-point ${active} ${importedClass}" style="left:${left}%;top:${top}%" title="${escapeHtml(condo.name)}" data-map-query="${escapeHtml(condo.address || condo.name)}"></button>`;
    }).join("")}
    <div class="map-legend"><span><i></i> Cobertura cadastrada</span><span><i class="active"></i> Na programação</span><span><i class="imported"></i> KML/KMZ</span></div>
  </div>`;
}

function normalize(collection, body) {
  ["price", "installation", "value", "goal", "capacity", "followUpDays"].forEach((key) => {
    if (body[key] !== undefined) body[key] = Number(body[key] || 0);
  });
  if (body.date && body.date.length === 16) body.date = new Date(body.date).toISOString();
  if (collection === "users") {
    body.active = body.active === true || String(body.active).toLowerCase() === "true";
    body.permissions = String(body.permissions || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!body.password) delete body.password;
  }
  return body;
}

async function saveSettings(event) {
  event.preventDefault();
  await request("/api/settings", { method: "POST", body: Object.fromEntries(new FormData(event.currentTarget)) });
  await loadAll();
  render();
}

function startSalesAutoSync() {
  clearInterval(salesAutoTimer);
  if (!state.user) return;
  const run = () => importSales({ silent: true, auto: true });
  salesAutoTimer = setInterval(run, SALES_AUTO_SYNC_MS);
  setTimeout(run, 3500);
}

async function importSales(options = {}) {
  const silent = options?.silent === true;
  const url = $("#salesSheetForm input[name='salesSheetUrl']")?.value || state.settings.salesSheetUrl || DEFAULT_SALES_SHEET_URL;
  try {
    const result = await request("/api/sales/import", { method: "POST", body: { url, silent } });
    if (!silent) alert(`${result.imported} venda(s) importada(s).`);
    await loadAll();
    if (!silent || (["sales", "sellers", "dashboard", "reports"].includes(state.page) && !document.querySelector(".modal-backdrop"))) render();
  } catch (error) {
    if (!silent) alert(error.message);
  }
}

async function importSalesText() {
  const csvText = $("#salesSheetForm textarea[name='csvText']")?.value || "";
  if (!csvText.trim()) return alert("Cole os dados copiados da planilha antes de importar.");
  try {
    const result = await request("/api/sales/import", { method: "POST", body: { csvText } });
    alert(`${result.imported} venda(s) importada(s).`);
    await loadAll();
    render();
  } catch (error) {
    alert(error.message);
  }
}

let pdfLoaderPromise = null;

async function importWeeklySchedulePdf(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  state.scheduleImport = {
    ...state.scheduleImport,
    status: "loading",
    fileName: file.name,
    message: "Lendo PDF e cruzando com os cadastros...",
    rows: [],
    rawText: "",
    weekStart: state.scheduleImport.weekStart || currentMondayISO()
  };
  render();
  try {
    const text = await extractPdfText(file);
    const rows = parseWeeklyScheduleText(text, state.scheduleImport.weekStart);
    const ready = rows.filter((row) => row.ready).length;
    state.scheduleImport = {
      ...state.scheduleImport,
      status: "ready",
      rawText: text,
      rows,
      message: `${rows.length} linha(s) identificada(s). ${ready} pronta(s) para lançar.`
    };
  } catch (error) {
    state.scheduleImport = {
      ...state.scheduleImport,
      status: "error",
      message: `Não foi possível ler o PDF: ${error.message}`,
      rows: [],
      rawText: ""
    };
  }
  render();
}

async function extractPdfText(file) {
  if (!pdfLoaderPromise) {
    pdfLoaderPromise = import("/vendor/pdf.min.mjs").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
      return pdfjsLib;
    });
  }
  const pdfjsLib = await pdfLoaderPromise;
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    pages.push(pdfTextLines(content.items).join("\n"));
  }
  return pages.join("\n");
}

function pdfTextLines(items) {
  const lines = new Map();
  items.forEach((item) => {
    const text = String(item.str || "").trim();
    if (!text) return;
    const x = Math.round(item.transform?.[4] || 0);
    const y = Math.round(item.transform?.[5] || 0);
    const key = [...lines.keys()].find((current) => Math.abs(current - y) <= 2) ?? y;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ x, text });
  });
  return [...lines.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseWeeklyScheduleText(text, weekStart = currentMondayISO()) {
  const lines = String(text || "").split(/\r?\n/).map(cleanScheduleLine).filter(Boolean);
  const blocks = [];
  let current = null;
  let pendingDay = null;
  lines.forEach((line) => {
    const dayIndex = detectWeekday(line);
    if (dayIndex >= 0 && !isScheduleImportHeader(line)) {
      if (current) {
        current.dayIndex = dayIndex;
        const routeLine = stripWeekdayFromScheduleLine(line);
        if (routeLine && !ignoreScheduleImportLine(routeLine)) current.lines.push(routeLine);
      } else {
        pendingDay = dayIndex;
      }
      return;
    }
    if (isScheduleImportHeader(line)) {
      current = { dayIndex: pendingDay ?? blocks.length, lines: [] };
      blocks.push(current);
      pendingDay = null;
      return;
    }
    if (current) current.lines.push(line);
  });
  const rows = [];
  blocks.forEach((block) => {
    const parsedRows = block.lines
      .flatMap(splitScheduleImportLine)
      .map((line) => parseScheduleImportLine(line))
      .filter(Boolean);
    const rowsPerDay = estimateScheduleRowsPerDay(parsedRows);
    parsedRows.forEach((row, index) => {
      rows.push(resolveScheduleImportRow(row, block.dayIndex + Math.floor(index / rowsPerDay), weekStart));
    });
  });
  return rows;
}

function cleanScheduleLine(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isScheduleImportHeader(line) {
  const value = normalizeKey(line);
  return value.includes("DIA") && value.includes("CONSULTOR") && !value.includes("ATIVIDADE");
}

function stripWeekdayFromScheduleLine(line) {
  const labels = [
    "SEGUNDA-FEIRA", "SEGUNDA FEIRA", "SEGUNDA",
    "TERCA-FEIRA", "TERCA FEIRA", "TERCA",
    "TERÇA-FEIRA", "TERÇA FEIRA", "TERÇA",
    "QUARTA-FEIRA", "QUARTA FEIRA", "QUARTA",
    "QUINTA-FEIRA", "QUINTA FEIRA", "QUINTA",
    "SEXTA-FEIRA", "SEXTA FEIRA", "SEXTA",
    "SABADO", "SÁBADO"
  ];
  let text = ` ${line} `;
  labels.forEach((label) => {
    text = text.replace(new RegExp(`\\b${escapeRegExp(label)}\\b`, "gi"), " ");
  });
  const sellers = [...new Set(scheduleSellerAliases().map((alias) => alias.label).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (sellers.length) {
    const match = text.match(new RegExp(`(?:^|\\s)(?:${sellers.join("|")})(?:\\s|$)`, "i"));
    if (match) {
      const sellerStart = match.index + (match[0].startsWith(" ") ? 1 : 0);
      if (sellerStart > 0 && detectWeekday(text.slice(0, sellerStart)) >= 0) text = text.slice(sellerStart);
    }
  }
  return cleanScheduleLine(text);
}

function splitScheduleImportLine(line) {
  const text = cleanScheduleLine(line);
  if (!text || isScheduleImportHeader(text) || ignoreScheduleImportLine(text)) return [text];
  const labels = [...new Set(scheduleSellerAliases().map((alias) => alias.label).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (!labels.length) return [text];
  const chunks = text.split(new RegExp(`\\s+(?=(?:${labels.join("|")})(?:\\s|$))`, "gi")).map(cleanScheduleLine).filter(Boolean);
  return chunks.length ? chunks : [text];
}

function estimateScheduleRowsPerDay(rows) {
  const seen = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const key = normalizeKey(rows[index]?.consultantText);
    if (!key) continue;
    if (seen.has(key) && index > 0) return Math.max(1, index);
    seen.add(key);
  }
  const activeSellers = state.data.sellers.filter((seller) => String(seller.status || "Ativo") !== "Inativo").length;
  return Math.max(1, Math.min(activeSellers || 5, 5));
}

function parseScheduleImportLine(line) {
  if (ignoreScheduleImportLine(line)) return null;
  const { text, startTime, endTime } = extractScheduleTime(line);
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const aliases = scheduleSellerAliases();
  const normalized = normalizeKey(text);
  let matchedAlias = aliases.find((alias) => normalized === alias.key || normalized.startsWith(`${alias.key} `));
  if (!matchedAlias && parts.length) matchedAlias = { label: parts[0], words: 1, seller: null };
  const consultantText = parts.slice(0, matchedAlias.words).join(" ");
  const condoText = parts.slice(matchedAlias.words).join(" ");
  return { consultantText, condoText, startTime, endTime, seller: matchedAlias.seller || null };
}

function ignoreScheduleImportLine(line) {
  const value = normalizeKey(line);
  if (!value) return true;
  if (/^\d{1,2}H(?:\d{2})?(?:\s|-|A|AS)*\d{0,2}H?\d{0,2}$/.test(value)) return true;
  return ["PROGRAMACAO", "PROGRAMAÇÃO", "DA SEMANA", "CAMPO SEMANAL", "REGIAO", "REGIÃO", "ATIVIDADE", "CONDOMINIOS RUA", "HORARIO", "SABADO"].some((token) => value.includes(normalizeKey(token)));
}

function extractScheduleTime(line) {
  const match = String(line).match(/(\d{1,2})\s*h(?:[:.]?(\d{2}))?\s*(?:-|a|às|as)\s*(\d{1,2})\s*h(?:[:.]?(\d{2}))?/i);
  if (!match) return { text: line, startTime: "08:00", endTime: "17:00" };
  const startTime = `${match[1].padStart(2, "0")}:${match[2] || "00"}`;
  const endTime = `${match[3].padStart(2, "0")}:${match[4] || "00"}`;
  return { text: line.replace(match[0], "").trim(), startTime, endTime };
}

function scheduleSellerAliases() {
  const aliases = [];
  state.data.sellers.forEach((seller) => {
    const name = String(seller.name || "").trim();
    if (!name) return;
    const parts = name.split(/\s+/).filter(Boolean);
    aliases.push({ key: normalizeKey(name), label: name, words: parts.length, seller });
    if (parts[0]) aliases.push({ key: normalizeKey(parts[0]), label: parts[0], words: 1, seller });
    if (normalizeKey(parts[0]) === "ISIS") aliases.push({ key: "ISIS SILVA", label: "ISIS SILVA", words: 2, seller });
  });
  ["IVAN", "BRUNA", "ADRIELE", "LUISE", "ISIS SILVA", "FLAVIA"].forEach((name) => {
    if (!aliases.some((alias) => alias.key === normalizeKey(name))) aliases.push({ key: normalizeKey(name), label: name, words: name.split(/\s+/).length, seller: null });
  });
  return aliases.sort((a, b) => b.key.length - a.key.length);
}

function resolveScheduleImportRow(row, dayIndex, weekStart) {
  const boundedDayIndex = Math.max(0, Math.min(dayIndex, 5));
  const seller = row.seller || findBestSeller(row.consultantText);
  const condo = findBestCondo(row.condoText);
  const issue = [
    seller ? "" : "consultor não cadastrado",
    condo ? "" : "condomínio não localizado"
  ].filter(Boolean).join("; ");
  return {
    dayIndex: boundedDayIndex,
    dayLabel: importWeekdays()[boundedDayIndex]?.label || "Dia",
    date: dateFromWeekStart(weekStart, boundedDayIndex),
    consultantText: row.consultantText,
    condoText: row.condoText,
    sellerIds: seller ? [seller.id] : [],
    sellerNames: seller?.name || "",
    condoId: condo?.id || "",
    condoName: condo?.name || "",
    address: condo?.address || "",
    startTime: row.startTime || "08:00",
    endTime: row.endTime || "17:00",
    accessMode: "Pode entrar",
    status: "Programada",
    followUpDays: 30,
    workArea: "Área geral",
    issue: issue || "",
    ready: Boolean(seller && condo)
  };
}

function findBestSeller(value) {
  const key = normalizeKey(value);
  return state.data.sellers.find((seller) => {
    const sellerKey = normalizeKey(seller.name);
    const first = sellerKey.split(" ")[0];
    return sellerKey === key || first === key || key.startsWith(`${first} `);
  });
}

function findBestCondo(value) {
  const query = normalizeKey(value);
  if (!query) return null;
  const aliasMatch = findCondoByImportAlias(query);
  if (aliasMatch) return aliasMatch;
  const queryCompact = query.replace(/\s+/g, "");
  const queryTokens = query.split(" ").filter((token) => token.length > 1);
  let best = { condo: null, score: 0 };
  state.data.condos.forEach((condo) => {
    const fields = [
      { value: condo.name, weight: 25, cap: 120 },
      { value: condo.condoName, weight: 25, cap: 120 },
      { value: condo.neighborhood, weight: -12, cap: 50 },
      { value: condo.address, weight: -18, cap: 48 }
    ].filter((field) => field.value).map((field) => ({ ...field, key: normalizeKey(field.value) }));
    let score = 0;
    fields.forEach(({ key: name, weight, cap }) => {
      const compact = name.replace(/\s+/g, "");
      const nameTokens = name.split(" ").filter((token) => token.length > 1 && !importStopwords().has(token));
      let current = 0;
      if (name === query) current = 110;
      else if (compact === queryCompact) current = 105;
      else if (name.includes(query) || query.includes(name)) current = queryTokens.length === 1 ? 72 : 92;
      else {
        const overlap = queryTokens.filter((token) => !importStopwords().has(token) && nameTokens.some((nameToken) => importTokenMatch(token, nameToken))).length;
        current = overlap ? 35 + (overlap / Math.max(1, queryTokens.filter((token) => !importStopwords().has(token)).length)) * 55 : 0;
        const similarity = compactSimilarity(queryCompact, compact);
        if (similarity >= 0.82) current = Math.max(current, 82 + similarity * 12);
      }
      current = Math.min(cap, current + weight);
      score = Math.max(score, current);
    });
    if (score > best.score) best = { condo, score };
  });
  return best.score >= 58 ? best.condo : null;
}

function findCondoByImportAlias(query) {
  const aliases = {
    "INTER VILAS": ["INTERVILLAS"],
    "PICUAIA": ["CONDOMINIO RESERVA DO PICUAIA", "COND RESERVAS DO PICUAIA", "RESERVA DO PICUAIA"],
    "ARBORIS": ["ARBORIS"],
    "RIVIERA": ["CONDOMINIO RIVIERA", "RIVIERA PRACAS", "RESIDENCIAL RIVIERA"],
    "SANTA TEREZA": ["SANTA TEREZA"],
    "VILLE LOZART": ["VILLE LOZATH", "VILLE LOZARTH"],
    "VILLE LOZATH": ["VILLE LOZATH", "VILLE LOZARTH"],
    "PIATA VILLE": ["PIATA VILLE"],
    "RESERVA PRAIA BURAQUINHO": ["RESERVA PRAIA DE BURAQUINHO"],
    "MANSAO EMILIA": ["MANSAO EMILIA"],
    "BEIRA RIO": ["BEIRA RIO"],
    "IMBUI VILLE": ["IMBUI VILLE"],
    "NEW JOANES": ["NEW JOANES"]
  };
  const values = aliases[query] || aliases[query.replace(/\s+/g, " ")] || [];
  for (const alias of values) {
    const aliasKey = normalizeKey(alias);
    const exact = state.data.condos.find((condo) => normalizeKey(condo.name) === aliasKey || normalizeKey(condo.condoName) === aliasKey);
    if (exact) return exact;
    const byName = state.data.condos.find((condo) => {
      const name = normalizeKey(condo.name || condo.condoName || "");
      return name.includes(aliasKey) || aliasKey.includes(name);
    });
    if (byName) return byName;
  }
  return null;
}

function importStopwords() {
  return new Set(["DE", "DA", "DO", "DAS", "DOS", "COND", "CONDOMINIO", "RESIDENCIAL", "EDIFICIO"]);
}

function importTokenMatch(token, nameToken) {
  if (token === nameToken) return true;
  if (token.length < 4 || nameToken.length < 4) return false;
  return token.includes(nameToken) || nameToken.includes(token);
}

function compactSimilarity(a, b) {
  if (!a || !b) return 0;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshteinDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
    }
  }
  return dp[a.length][b.length];
}

function importWeekdays() {
  return [
    { label: "Segunda-feira", offset: 0 },
    { label: "Terça-feira", offset: 1 },
    { label: "Quarta-feira", offset: 2 },
    { label: "Quinta-feira", offset: 3 },
    { label: "Sexta-feira", offset: 4 },
    { label: "Sábado", offset: 5 }
  ];
}

function detectWeekday(line) {
  const value = normalizeKey(line);
  const aliases = [
    ["SEGUNDA FEIRA", "SEGUNDA"],
    ["TERCA FEIRA", "TERCA", "TER A FEIRA", "TER A"],
    ["QUARTA FEIRA", "QUARTA"],
    ["QUINTA FEIRA", "QUINTA"],
    ["SEXTA FEIRA", "SEXTA"],
    ["SABADO", "S BADO"]
  ];
  return aliases.findIndex((dayAliases) => dayAliases.some((alias) => value.includes(alias)));
}

function currentMondayISO(date = new Date()) {
  const base = new Date(date);
  const diff = base.getDay() === 0 ? -6 : 1 - base.getDay();
  base.setDate(base.getDate() + diff);
  return base.toISOString().slice(0, 10);
}

function dateFromWeekStart(weekStart, offset) {
  const date = new Date(`${weekStart || currentMondayISO()}T12:00:00`);
  date.setDate(date.getDate() + Number(offset || 0));
  return date.toISOString().slice(0, 10);
}

function schedulePeriodFromDate(value = todayISO()) {
  const base = new Date(`${String(value || todayISO()).slice(0, 10)}T12:00:00`);
  const diff = base.getDay() === 0 ? -6 : 1 - base.getDay();
  base.setDate(base.getDate() + diff);
  const end = new Date(base);
  end.setDate(base.getDate() + 5);
  return { from: base.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function normalizeSchedulePeriod(period = {}) {
  const from = String(period.from || "").slice(0, 10);
  const to = String(period.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  return { from, to };
}

function schedulePeriodLabel(period = schedulePeriodFromDate(todayISO())) {
  const selected = normalizeSchedulePeriod(period) || schedulePeriodFromDate(todayISO());
  return `Período: ${fmtDate(selected.from)} a ${fmtDate(selected.to)}`;
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Ã‡/g, "C")
    .replace(/Ã/g, "A")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .toUpperCase();
}

function clearScheduleImport() {
  state.scheduleImport = { status: "idle", fileName: "", message: "", rows: [], rawText: "", weekStart: currentMondayISO() };
  render();
}

async function commitScheduleImport() {
  const rows = state.scheduleImport.rows.filter((row) => row.ready && !isDuplicateImportedSchedule(row));
  const duplicates = state.scheduleImport.rows.filter((row) => row.ready && isDuplicateImportedSchedule(row)).length;
  if (!rows.length) return alert(duplicates ? "Todas as rotas prontas já existem na programação." : "Nenhuma rota pronta para lançar.");
  if (!confirm(`Lançar ${rows.length} rota(s) na programação?${duplicates ? ` ${duplicates} duplicada(s) serão ignoradas.` : ""}`)) return;
  let imported = 0;
  for (const row of rows) {
    await request("/api/weeklySchedules", {
      method: "POST",
      body: {
        condoId: row.condoId,
        condoName: row.condoName,
        address: row.address,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        sellerIds: row.sellerIds,
        sellerId: row.sellerIds[0] || "",
        workArea: row.workArea,
        accessMode: row.accessMode,
        status: row.status,
        followUpDays: row.followUpDays,
        notes: `Importado do PDF ${state.scheduleImport.fileName || "Programação semanal"}`
      }
    });
    imported += 1;
  }
  await loadAll();
  const launchedWeek = rows[0]?.date ? currentMondayISO(new Date(`${rows[0].date}T12:00:00`)) : state.scheduleImport.weekStart || currentMondayISO();
  state.scheduleWeekStart = launchedWeek;
  state.scheduleImport = { status: "done", fileName: "", message: `${imported} rota(s) lançada(s). ${duplicates} duplicada(s) ignorada(s). Semanas anteriores continuam salvas no histórico.`, rows: [], rawText: "", weekStart: launchedWeek };
  render();
}

function isDuplicateImportedSchedule(row) {
  const sellerKey = row.sellerIds.join(",");
  return state.data.weeklySchedules.some((item) => {
    const itemSellerIds = Array.isArray(item.sellerIds) && item.sellerIds.length ? item.sellerIds : [item.sellerId].filter(Boolean);
    return String(item.date || "") === row.date
      && String(item.condoId || "") === row.condoId
      && String(item.startTime || "") === row.startTime
      && itemSellerIds.join(",") === sellerKey;
  });
}

async function removeItem(collection, id) {
  const text = collection === "weeklySchedules" ? "Deseja excluir esta programação?" : "Deseja excluir este registro?";
  if (!confirm(text)) return;
  await request(`/api/${collection}/${id}`, { method: "DELETE" });
  await loadAll();
  render();
}

async function toggleUser(id, active) {
  await request(`/api/users/${id}`, { method: "PUT", body: { active: active === "true" } });
  await loadAll();
  render();
}

function dismissAlert(key) {
  state.dismissedAlerts.add(key);
  state.activeToasts.delete(key);
  localStorage.setItem("ws-dismissed-alerts", JSON.stringify([...state.dismissedAlerts]));
  renderAlerts();
}

function closeToast(key) {
  state.activeToasts.delete(key);
  renderAlerts();
}

function openCalendar(ref) {
  if (String(ref).startsWith("weeklySchedules:")) return openWeeklyScheduleEmail(ref);
  const event = eventFromRef(ref);
  if (!event) return;
  const start = new Date(event.date || Date.now());
  const end = event.endDate ? new Date(event.endDate) : new Date(start.getTime() + 60 * 60 * 1000);
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", `WS Consultoria - ${event.title}`);
  url.searchParams.set("dates", `${gcalDate(start)}/${gcalDate(end)}`);
  url.searchParams.set("details", event.note || "");
  url.searchParams.set("location", event.location || "");
  if (event.recur || event.type === "weeklySchedules") url.searchParams.set("recur", event.recur || "RRULE:FREQ=WEEKLY");
  if (event.attendees?.length) url.searchParams.set("add", event.attendees.join(","));
  window.open(url.toString(), "_blank");
}

function openEmail(ref) {
  if (String(ref).startsWith("weeklySchedules:")) return openWeeklyScheduleEmail(ref);
  const event = eventFromRef(ref);
  if (!event) return;
  const to = event.attendees?.length ? event.attendees.join(",") : state.settings.notificationEmail || state.settings.adminEmail || "";
  const subject = `Programação - ${event.title}`;
  const body = `Sistema de Gestão Comercial\n\nAtividade: ${event.title}\nData: ${fmtDateTime(event.date)}\nStatus: ${event.status}\nEndereço: ${event.location || "-"}\n\nObs:\n${event.note || ""}`;
  location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function openWeeklyScheduleEmail(ref) {
  const [, id] = String(ref).split(":");
  const item = findById("weeklySchedules", id);
  if (!item) return;
  const period = schedulePeriodFromDate(item.date || todayISO());
  const rows = scheduleRowsForExport(period);
  const emails = [...new Set(rows.flatMap(scheduleSellerEmails))];
  const to = emails.length ? emails.join(",") : state.settings.notificationEmail || state.settings.adminEmail || "";
  const subject = `Programação semanal da equipe - ${schedulePeriodLabel(period)}`;
  const body = buildWeeklyScheduleText({ rows, period });
  location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function eventFromRef(ref) {
  const [type, id] = String(ref).includes(":") ? String(ref).split(":") : ["visits", ref];
  if (type === "visits") {
    const visit = findById("visits", id);
    const condo = findById("condos", visit?.condoId);
    if (!visit) return null;
    return { id, type, date: visit.date, condoId: visit.condoId, sellerId: visit.sellerId, title: `${condo?.name || "Visita"} - ${visit.purpose || "Visita"}`, status: visit.status, note: visit.notes || visit.result || "", location: condo?.address || "" };
  }
  if (type === "weeklySchedules") {
    const item = findById("weeklySchedules", id);
    const condo = findById("condos", item?.condoId);
    if (!item) return null;
    const date = item.date ? `${item.date}T${item.startTime || "09:00"}:00` : "";
    const endDate = item.date ? `${item.date}T${item.endTime || "10:00"}:00` : "";
    return { id, type, date, endDate, condoId: item.condoId, sellerId: item.sellerId, sellerIds: item.sellerIds, attendees: scheduleSellerEmails(item), title: `${condo?.name || item.condoName || "Programação"} - ${scheduleSellers(item) || "Equipe"}`, status: item.status, note: item.notes || item.workArea || item.accessMode || "", location: item.address || condo?.address || "" };
  }
  const item = findById("expansions", id);
  if (!item) return null;
  return { id, type, date: item.date || item.expectedDate, condoId: item.condoId, sellerId: item.sellerId, title: `${item.type || "Expansão"} - ${item.condoName || "Condomínio"}`, status: item.status, note: item.notes || `Protocolo IXC: ${item.protocol || "-"}`, location: item.address || "" };
}

function backupData() {
  const content = JSON.stringify(state.data, null, 2);
  navigator.clipboard.writeText(content)
    .then(() => alert("Backup copiado. Você pode colar em um arquivo ou mensagem."))
    .catch(() => download(new Blob([content], { type: "application/json" }), `backup-ws-consultoria-${todayISO()}.json`));
}

function downloadBackup() {
  const content = JSON.stringify(state.data, null, 2);
  download(new Blob([content], { type: "application/json;charset=utf-8" }), `backup-ws-consultoria-${todayISO()}.json`);
}

function downloadReport() {
  download(new Blob([buildReport()], { type: "text/plain;charset=utf-8" }), `relatorio-ws-${todayISO()}.txt`);
}

function printExecutiveReport() {
  const filter = activeReportFilter();
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) return alert("Permita pop-ups para gerar o relatório em PDF.");
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório - ${escapeHtml(reportLabel(filter))}</title>${reportPrintStyles()}</head><body>${reportDocumentHtml(filter)}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 450);
}

function reportPrintStyles() {
  return `<style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef1f4; color: #17201c; font-family: Arial, Helvetica, sans-serif; }
    .report-page { width: 100%; min-height: 190mm; background: white; padding: 16mm; position: relative; overflow: hidden; }
    .report-page::before { content: ""; position: absolute; inset: 0; border-top: 8px solid #c9a227; border-bottom: 8px solid #13251f; pointer-events: none; }
    .report-watermark { position: absolute; right: 18mm; bottom: 16mm; width: 76mm; opacity: .05; }
    .report-head { display: grid; grid-template-columns: 38mm 1fr auto; gap: 12px; align-items: center; border-bottom: 1px solid #d9dedc; padding-bottom: 10px; margin-bottom: 12px; position: relative; z-index: 1; }
    .report-logo { width: 34mm; max-height: 16mm; object-fit: contain; border-radius: 0; background: transparent; }
    h1 { margin: 0; font-size: 20px; color: #13251f; text-transform: uppercase; letter-spacing: .03em; }
    .subtitle { margin-top: 4px; font-size: 11px; color: #66736e; font-weight: 700; }
    .stamp { text-align: right; font-size: 10px; color: #66736e; line-height: 1.5; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; position: relative; z-index: 1; }
    .metric-box { border: 1px solid #d9dedc; border-left: 4px solid #c9a227; border-radius: 8px; padding: 10px; min-height: 58px; }
    .metric-box strong { display: block; font-size: 20px; color: #13251f; }
    .metric-box span { font-size: 10px; color: #66736e; font-weight: 800; text-transform: uppercase; }
    .report-grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 10px; position: relative; z-index: 1; }
    .report-section { border: 1px solid #d9dedc; border-radius: 8px; overflow: hidden; background: rgba(255,255,255,.94); }
    .report-section h2 { margin: 0; padding: 8px 10px; background: #13251f; color: white; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #e7ebe9; text-align: left; vertical-align: top; }
    th { color: #13251f; background: #f4f1e8; font-size: 9px; text-transform: uppercase; }
    .status-lite { display: inline-block; padding: 3px 7px; border-radius: 999px; background: #f4f1e8; font-weight: 700; }
    .notes { margin-top: 10px; color: #66736e; font-size: 10px; position: relative; z-index: 1; }
    @media print { body { background: white; } .report-page { min-height: auto; padding: 0; } }
  </style>`;
}

function reportAreas() {
  return [
    ["geral", "Geral", "Visão executiva com os principais indicadores."],
    ["vendas", "Vendas", "Produção comercial, ranking e vendas recentes."],
    ["visitas", "Relacionamento", "Síndicos, administradoras, cupons e retornos."],
    ["programacao", "Programação", "Roteiros semanais e atuação da equipe."],
    ["expansao", "Expansão", "Vistorias, inspeções e implantações."],
    ["condominios", "Condomínios", "Cadastro mestre, status e prioridades."],
    ["planos", "Planos", "Planos ativos, valores e velocidades."]
  ];
}

function reportAreaButton(area, active) {
  const [id, label, description] = area;
  return `<button class="report-area-btn ${active === id ? "active" : ""}" type="button" data-report-area="${id}">
    <strong>${escapeHtml(label)}</strong>
    <small>${escapeHtml(description)}</small>
  </button>`;
}

function reportOptionList(filter = state.reportFilter) {
  const commonMetrics = { key: "metrics", label: "Indicadores", description: "Cards principais do módulo escolhido." };
  const map = {
    geral: [
      commonMetrics,
      { key: "salesRanking", label: "Ranking comercial", description: "Vendedores com vendas e receita no mês." },
      { key: "relationships", label: "Relacionamento", description: "Condomínios que precisam de retorno." },
      { key: "expansion", label: "Expansão", description: "Demandas abertas e próximas etapas." },
      { key: "plans", label: "Planos", description: "Planos ativos mais relevantes." }
    ],
    vendas: [
      commonMetrics,
      { key: "salesRanking", label: "Ranking comercial", description: "Ranking automático por vendedor." },
      { key: "latestSales", label: "Vendas recentes", description: "Últimos lançamentos com status e valor." },
      { key: "salesStatus", label: "Status das vendas", description: "Resumo por situação comercial." }
    ],
    visitas: [
      commonMetrics,
      { key: "relationships", label: "Relacionamento prioritário", description: "Retornos, status e qualidade da relação." },
      { key: "upcomingVisits", label: "Próximas visitas", description: "Agenda futura de relacionamento." },
      { key: "condoPriorities", label: "Condomínios sem visita", description: "Locais que ficaram muito tempo sem passagem." }
    ],
    programacao: [
      commonMetrics,
      { key: "scheduleByDay", label: "Roteiro por dia", description: "Programações agrupadas por data." },
      { key: "scheduleConsultants", label: "Consultores na rota", description: "Distribuição da equipe por programação." }
    ],
    expansao: [
      commonMetrics,
      { key: "expansion", label: "Demandas abertas", description: "Vistorias, inspeções e implantações pendentes." },
      { key: "expansionStatus", label: "Resumo por status", description: "Quantidade por estágio da demanda." }
    ],
    condominios: [
      commonMetrics,
      { key: "condoMaster", label: "Cadastro mestre", description: "Condomínios com cidade, bairro e status." },
      { key: "condoPriorities", label: "Sem visita recente", description: "Locais que exigem planejamento de retorno." }
    ],
    planos: [
      commonMetrics,
      { key: "plans", label: "Planos ativos", description: "Planos comercializados e valores." },
      { key: "plansByCity", label: "Planos por cidade", description: "Resumo de oferta por localidade." }
    ]
  };
  return map[filter] || map.geral;
}

function selectedReportOptions(filter = state.reportFilter) {
  const list = reportOptionList(filter);
  const defaults = list.map((option) => option.key);
  const hasSaved = Object.prototype.hasOwnProperty.call(state.reportOptions, filter);
  const values = hasSaved && Array.isArray(state.reportOptions[filter]) ? state.reportOptions[filter] : defaults;
  return new Set(values.filter((key) => list.some((option) => option.key === key)));
}

function setReportOption(filter, key, checked) {
  const selected = selectedReportOptions(filter);
  checked ? selected.add(key) : selected.delete(key);
  state.reportOptions = { ...state.reportOptions, [filter]: [...selected] };
}

function reportOptionCard(option, checked) {
  return `<label class="report-option-card">
    <input type="checkbox" data-report-option="${option.key}" ${checked ? "checked" : ""}>
    <span>
      <strong>${escapeHtml(option.label)}</strong>
      <small>${escapeHtml(option.description)}</small>
    </span>
  </label>`;
}

function reportDocumentHtml(filter = state.reportFilter) {
  const logo = reportLogoSrc();
  const selected = selectedReportOptions(filter);
  const sections = reportEssentialSections(filter);
  return `<main class="report-page">
    <header class="report-head">
      <img class="report-logo" src="${escapeHtml(logo)}" alt="Logo">
      <div>
        <h1>${escapeHtml(reportLabel(filter))}</h1>
        <div class="subtitle">${escapeHtml(state.settings.companyName || "WS CONSULTORIA")} | Sistema de Gestão Comercial</div>
      </div>
      <div class="stamp">
        <strong>Relatório executivo</strong><br>
        Gerado em ${fmtDateTime(new Date().toISOString())}<br>
        Responsável: ${escapeHtml(state.user?.name || "-")}
      </div>
    </header>
    ${selected.has("metrics") ? reportEssentialMetrics(filter) : ""}
    <div class="report-grid">${sections || reportSection("Seleção vazia", ["Orientação"], [["Marque ao menos uma informação para compor este relatório."]])}</div>
    <p class="notes">Documento gerado somente com indicadores e registros essenciais para acompanhamento gerencial.</p>
  </main>`;
}

function reportLogoSrc() {
  return `${location.origin}/assets/use-logo.gif`;
}

function reportPreview() {
  return `<div class="report-preview">${reportDocumentHtml(state.reportFilter)}</div>`;
}

function activeReportFilter() {
  if (state.page === "reports") return state.reportFilter;
  return {
    dashboard: "geral",
    sales: "vendas",
    sellers: "vendas",
    visits: "visitas",
    weeklySchedules: "programacao",
    agenda: "visitas",
    expansions: "expansao",
    plans: "planos",
    condos: "condominios",
    coverageMap: "visitas"
  }[state.page] || "geral";
}

function reportMetricRows(filter = state.reportFilter) {
  const month = new Date().toISOString().slice(0, 7);
  const salesMonth = visibleSalesRows().filter((sale) => String(sale.date || "").startsWith(month));
  const revenue = salesMonth.reduce((sum, sale) => sum + Number(sale.value || 0), 0);
  const openVisits = state.data.visits.filter((visit) => !["Finalizado", "Visitado", "Concluida", "Concluída"].includes(visit.status)).length;
  const openExpansions = state.data.expansions.filter((item) => !["Concluído", "Reprovado"].includes(item.status)).length;
  const latest = latestVisitByCondo();
  const stale30 = state.data.condos.filter((condo) => daysSince(latest.get(condo.id)?.date) > 30).length;
  const weekRows = state.data.weeklySchedules.filter((item) => String(item.date || "").slice(0, 10) >= todayISO());
  const weekSellerIds = weekRows.flatMap((item) => Array.isArray(item.sellerIds) && item.sellerIds.length ? item.sellerIds : [item.sellerId].filter(Boolean));
  const activePlans = state.data.plans.filter((plan) => plan.status !== "Inativo");
  const activeCondos = state.data.condos.filter((condo) => condo.status !== "Inativo");
  const metricMap = {
    vendas: [
      ["Vendas no mês", salesMonth.length],
      ["Receita do mês", money(revenue)],
      ["Ticket médio", money(salesMonth.length ? revenue / salesMonth.length : 0)],
      ["Meta de vendas", visibleCommercialSellers().reduce((sum, seller) => sum + Number(seller.goal || 0), 0)]
    ],
    visitas: [
      ["Relacionamentos", state.data.visits.length],
      ["Abertos", openVisits],
      ["Cupons entregues", state.data.visits.filter((visit) => visit.couponDelivered === "Sim" || visit.couponCode).length],
      ["Sem visita > 30 dias", stale30]
    ],
    programacao: [
      ["Rotas futuras", weekRows.length],
      ["Condomínios na rota", new Set(weekRows.map((item) => item.condoId).filter(Boolean)).size],
      ["Consultores envolvidos", new Set(weekSellerIds).size],
      ["Atuações externas", weekRows.filter((item) => item.accessMode === "Ficar externo").length]
    ],
    expansao: [
      ["Demandas", state.data.expansions.length],
      ["Abertas", openExpansions],
      ["Aprovadas", state.data.expansions.filter((item) => item.status === "Aprovado").length],
      ["Concluídas", state.data.expansions.filter((item) => item.status === "Concluído").length]
    ],
    condominios: [
      ["Condomínios", state.data.condos.length],
      ["Ativos", activeCondos.length],
      ["Cidades", new Set(state.data.condos.map((condo) => condo.city).filter(Boolean)).size],
      ["Unidades", state.data.condos.reduce((sum, condo) => sum + Number(condo.capacity || 0), 0)]
    ],
    planos: [
      ["Planos ativos", activePlans.length],
      ["Promocionais", state.data.plans.filter((plan) => plan.status === "Promocional").length],
      ["Valor médio", money(activePlans.length ? activePlans.reduce((sum, plan) => sum + Number(plan.price || 0), 0) / activePlans.length : 0)],
      ["Cidades atendidas", new Set(activePlans.map((plan) => plan.city).filter(Boolean)).size]
    ],
    geral: [
      ["Vendas no mês", salesMonth.length],
      ["Receita do mês", money(revenue)],
      ["Relacionamentos abertos", openVisits],
      ["Expansões abertas", openExpansions]
    ]
  };
  return metricMap[filter] || metricMap.geral;
}

function reportEssentialMetrics(filter = state.reportFilter) {
  const metrics = reportMetricRows(filter);
  return `<section class="metrics">
    ${metrics.map(([label, value]) => reportMetric(label, value)).join("")}
  </section>`;
}

function reportMetric(label, value) {
  return `<div class="metric-box"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function reportEssentialSections(filter = state.reportFilter) {
  const selected = selectedReportOptions(filter);
  const sections = [];
  if (selected.has("salesRanking")) sections.push(reportSalesSection());
  if (selected.has("latestSales")) sections.push(reportLatestSalesSection());
  if (selected.has("salesStatus")) sections.push(reportSalesStatusSection());
  if (selected.has("relationships")) sections.push(reportRelationshipSection());
  if (selected.has("upcomingVisits")) sections.push(reportUpcomingVisitsSection());
  if (selected.has("condoPriorities")) sections.push(reportCondoPrioritySection());
  if (selected.has("scheduleByDay")) sections.push(reportScheduleByDaySection());
  if (selected.has("scheduleConsultants")) sections.push(reportScheduleConsultantsSection());
  if (selected.has("expansion")) sections.push(reportExpansionSection());
  if (selected.has("expansionStatus")) sections.push(reportExpansionStatusSection());
  if (selected.has("condoMaster")) sections.push(reportCondoMasterSection());
  if (selected.has("plans")) sections.push(reportPlansSection());
  if (selected.has("plansByCity")) sections.push(reportPlansByCitySection());
  return sections.join("");
}

function reportSalesSection() {
  const ranking = sellerRanking().slice(0, 8);
  return reportSection("Ranking comercial", ["Vendedor", "Vendas", "Receita", "Conversão"], ranking.map((row) => [row.name, row.count, money(row.value), `${row.conversion}%`]));
}

function reportLatestSalesSection() {
  const rows = [...visibleSalesRows()]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 12)
    .map((sale) => [
      fmtDate(sale.date),
      saleSellerName(sale) || "-",
      saleTypeLabel(sale),
      sale.customer || "-",
      findById("condos", sale.condoId)?.name || sale.condoName || "-",
      findById("plans", sale.planId)?.name || sale.planName || "-",
      money(sale.value),
      saleStatusLabel(sale)
    ]);
  return reportSection("Vendas recentes", ["Data", "Vendedor", "Tipo", "Cliente", "Condomínio", "Plano", "Valor", "Status"], rows);
}

function reportSalesStatusSection() {
  return reportSection("Vendas por status", ["Status", "Quantidade"], counts(visibleSalesRows().map((sale) => ({ status: saleStatusLabel(sale) })), "status").map((row) => [row.label, row.value]));
}

function reportRelationshipSection() {
  const rows = state.data.visits
    .filter((visit) => !["Finalizado", "Visitado"].includes(visit.status))
    .sort((a, b) => String(a.nextVisit || a.date || "").localeCompare(String(b.nextVisit || b.date || "")))
    .slice(0, 10)
    .map((visit) => [findById("condos", visit.condoId)?.name || visit.condoName || "-", visit.status || "-", visit.relationship || "-", fmtDate(visit.nextVisit || visit.date)]);
  return reportSection("Relacionamento prioritário", ["Condomínio", "Status", "Relação", "Próxima visita"], rows);
}

function reportUpcomingVisitsSection() {
  const rows = upcomingEvents()
    .filter((event) => event.type === "visits")
    .slice(0, 12)
    .map((event) => [fmtDateTime(event.date), event.title, event.status || "-", event.location || "-"]);
  return reportSection("Próximas visitas", ["Data", "Atividade", "Status", "Local"], rows);
}

function reportCondoPrioritySection() {
  const latest = latestVisitByCondo();
  const rows = state.data.condos
    .map((condo) => ({ condo, last: latest.get(condo.id), days: daysSince(latest.get(condo.id)?.date) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 12)
    .map(({ condo, last, days }) => [condo.name || "-", condo.city || "-", condo.neighborhood || "-", last ? fmtDate(last.date) : "Nunca", days >= 9999 ? "Sem histórico" : `${days} dia(s)`, condo.status || "Ativo"]);
  return reportSection("Condomínios sem visita recente", ["Condomínio", "Cidade", "Bairro", "Última visita", "Tempo", "Status"], rows);
}

function reportExpansionSection() {
  const rows = state.data.expansions
    .filter((item) => !["Concluído", "Reprovado"].includes(item.status))
    .slice(0, 10)
    .map((item) => [item.condoName || "-", item.type || "-", item.status || "-", fmtDate(item.expectedDate || item.date)]);
  return reportSection("Expansão em acompanhamento", ["Condomínio", "Tipo", "Status", "Previsão"], rows);
}

function reportExpansionStatusSection() {
  return reportSection("Expansão por status", ["Status", "Quantidade"], counts(state.data.expansions, "status").map((row) => [row.label, row.value]));
}

function reportScheduleByDaySection() {
  const rows = weeklyScheduleRowsForReport()
    .slice(0, 14)
    .map((item) => {
      const condo = findById("condos", item.condoId);
      return [fmtDate(item.date), `${item.startTime || "-"} às ${item.endTime || "-"}`, condo?.name || item.condoName || "-", scheduleSellers(item) || "-", item.accessMode || "-", item.status || "Programada"];
    });
  return reportSection("Programação por dia", ["Data", "Horário", "Condomínio", "Consultor(es)", "Atuação", "Status"], rows);
}

function reportScheduleConsultantsSection() {
  const map = new Map();
  weeklyScheduleRowsForReport().forEach((item) => {
    scheduleSellerNames(item).forEach((seller) => {
      const current = map.get(seller) || { routes: 0, condos: new Set() };
      current.routes += 1;
      current.condos.add(findById("condos", item.condoId)?.name || item.condoName || "Sem condomínio");
      map.set(seller, current);
    });
  });
  const rows = [...map.entries()]
    .sort((a, b) => b[1].routes - a[1].routes)
    .map(([seller, info]) => [seller, info.routes, [...info.condos].slice(0, 4).join(", ")]);
  return reportSection("Consultores na programação", ["Consultor", "Rotas", "Condomínios"], rows);
}

function reportCondoMasterSection() {
  const rows = state.data.condos
    .slice(0, 14)
    .map((condo) => [condo.name || "-", condo.city || "-", condo.neighborhood || "-", condo.managerCompany || "-", condo.capacity || "-", condo.status || "Ativo"]);
  return reportSection("Cadastro mestre de condomínios", ["Nome", "Cidade", "Bairro", "Administradora", "Unidades", "Status"], rows);
}

function reportPlansSection() {
  const rows = state.data.plans
    .filter((plan) => plan.status !== "Inativo")
    .slice(0, 10)
    .map((plan) => [plan.city || "-", plan.name || "-", plan.speed || "-", money(plan.price)]);
  return reportSection("Planos ativos", ["Cidade", "Plano", "Velocidade", "Valor"], rows);
}

function reportPlansByCitySection() {
  const map = new Map();
  state.data.plans.filter((plan) => plan.status !== "Inativo").forEach((plan) => {
    const city = plan.city || "Sem cidade";
    const current = map.get(city) || { count: 0, min: Infinity, max: 0 };
    current.count += 1;
    current.min = Math.min(current.min, Number(plan.price || 0));
    current.max = Math.max(current.max, Number(plan.price || 0));
    map.set(city, current);
  });
  const rows = [...map.entries()].map(([city, info]) => [city, info.count, money(info.min === Infinity ? 0 : info.min), money(info.max)]);
  return reportSection("Planos por cidade", ["Cidade", "Planos", "Menor valor", "Maior valor"], rows);
}

function reportSection(title, headers, rows) {
  const body = rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Sem registros essenciais para este relatório.</td></tr>`;
  return `<section class="report-section"><h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function downloadReportExcel() {
  const rows = reportExportRows();
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  download(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), `relatorio-ws-${todayISO()}.csv`);
}

function copyWeeklySchedule() {
  const period = schedulePeriodFromDate(state.scheduleWeekStart || todayISO());
  navigator.clipboard.writeText(buildWeeklyScheduleText({ period }))
    .then(() => alert("Programação copiada para enviar ao grupo."));
}

function downloadWeeklySchedule() {
  openScheduleDownloadModal();
}

function openScheduleDownloadModal() {
  const modal = $("#modalTemplate").content.firstElementChild.cloneNode(true);
  const period = schedulePeriodFromDate(state.scheduleWeekStart || todayISO());
  modal.querySelector("h3").textContent = "Baixar programação";
  modal.querySelector(".modal-body").innerHTML = `
    <div class="form-grid">
      <label>Data inicial<input name="from" type="date" value="${escapeHtml(period.from)}" required></label>
      <label>Data final<input name="to" type="date" value="${escapeHtml(period.to)}" required></label>
      <p class="hint full">Escolha o período que deve sair no PDF. Consultores no mesmo condomínio, horário e endereço serão agrupados em uma rota.</p>
    </div>`;
  modal.querySelector("footer .primary").textContent = "Baixar PDF";
  modal.querySelectorAll(".close").forEach((button) => button.addEventListener("click", () => modal.remove()));
  modal.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = normalizeSchedulePeriod(Object.fromEntries(new FormData(event.currentTarget)));
    if (!selected) return alert("Informe um período válido para baixar a programação.");
    modal.remove();
    printWeeklySchedulePdf(selected);
  });
  document.body.appendChild(modal);
}

function printWeeklySchedulePdf(period = schedulePeriodFromDate(todayISO())) {
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) return alert("Permita pop-ups para gerar a programação em PDF.");
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Programação semanal</title>${schedulePrintStyles()}</head><body>${scheduleDocumentHtml(period)}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 450);
}

function schedulePrintStyles() {
  return `<style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #111820; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .schedule-page { min-height: 190mm; background: white; padding: 7mm 8mm 8mm; border-top: 4mm solid #e6007e; border-bottom: 2.5mm solid #111820; }
    .schedule-head { display: grid; grid-template-columns: 38mm minmax(0, 1fr) 54mm; align-items: center; gap: 10px; border-bottom: 1px solid #cfd5dc; padding: 0 0 6px; margin-bottom: 7px; }
    .use-logo-wrap { height: 18mm; display: flex; align-items: center; overflow: visible; }
    .use-logo { width: 35mm; height: 16mm; object-fit: contain; object-position: left center; display: block; }
    h1 { margin: 0; font-size: 17px; color: #111820; text-transform: uppercase; letter-spacing: .02em; line-height: 1.1; }
    .subtitle, .stamp { color: #4f5963; font-size: 9.5px; font-weight: 800; line-height: 1.35; }
    .stamp { text-align: right; }
    .period-pill { display: inline-flex; margin-top: 4px; padding: 3px 8px; border-radius: 999px; background: #fff0f7; color: #9a0054; font-size: 9px; font-weight: 900; }
    .agenda-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; align-items: start; }
    .agenda-day { border: 1px solid #cfd5dc; border-radius: 7px; overflow: hidden; background: #fbfcfd; break-inside: avoid; page-break-inside: avoid; }
    .agenda-day header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 8px; background: #111820; color: #fff; }
    .agenda-day header strong { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
    .agenda-day header span { font-size: 9px; color: #ffd3ea; font-weight: 900; white-space: nowrap; }
    .agenda-body { display: grid; }
    .agenda-card { display: grid; grid-template-columns: 58px minmax(0, 1fr) 88px; gap: 7px; align-items: start; padding: 6px 7px; border-top: 1px solid #e1e6ec; background: #fff; break-inside: avoid; page-break-inside: avoid; }
    .agenda-card:first-child { border-top: 0; }
    .agenda-time { display: grid; gap: 1px; justify-items: center; padding: 5px 3px; border-radius: 5px; background: #111820; color: #fff; font-size: 8.5px; font-weight: 900; line-height: 1.1; text-align: center; }
    .agenda-time strong { font-size: 10px; }
    .agenda-main { min-width: 0; display: grid; gap: 2px; }
    .agenda-condo { margin: 0; color: #111820; font-size: 10.8px; line-height: 1.18; font-weight: 900; overflow-wrap: anywhere; }
    .agenda-address { margin: 0; color: #58636e; font-size: 8.5px; line-height: 1.22; overflow-wrap: anywhere; }
    .agenda-team { min-width: 0; padding: 5px 6px; border-radius: 5px; background: #fff0f7; color: #9a0054; }
    .agenda-team span { display: block; color: #6e7680; font-size: 6.8px; font-weight: 900; text-transform: uppercase; margin-bottom: 2px; }
    .agenda-team strong { display: block; font-size: 8.4px; line-height: 1.16; font-weight: 900; text-transform: uppercase; overflow-wrap: anywhere; }
    .agenda-meta { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 2px; }
    .agenda-meta span { padding: 2px 5px; border-radius: 999px; background: #eef1f4; color: #303841; font-size: 7.2px; font-weight: 900; }
    .empty-agenda { padding: 9px; color: #68727d; font-size: 9px; font-weight: 800; }
    @media print { body { background: white; } .schedule-page { min-height: auto; } }
  </style>`;
}

function scheduleDocumentHtml(period = schedulePeriodFromDate(todayISO())) {
  const rows = scheduleRowsForExport(period);
  return `<main class="schedule-page">
    <header class="schedule-head">
      <div class="use-logo-wrap"><img class="use-logo" src="${location.origin}/assets/use-logo.gif" alt="USE Telecom"></div>
      <div>
        <h1>Programação semanal da equipe</h1>
        <div class="subtitle">Roteiro operacional para atuação em condomínios</div>
        <div class="period-pill">${escapeHtml(schedulePeriodLabel(period))}</div>
      </div>
      <div class="stamp">
        Gerado em ${fmtDateTime(new Date().toISOString())}<br>
        Sistema de Gestão Comercial<br>
        Responsável: ${escapeHtml(state.user?.name || "-")}
      </div>
    </header>
    ${rows.length ? scheduleAgendaGrid(rows) : `<section class="agenda-day"><header><strong>Sem programação</strong></header><div class="empty-agenda">Nenhuma programação cadastrada para exportar.</div></section>`}
  </main>`;
}

function weeklyScheduleRowsForReport(options = {}) {
  const { from, to, sellerIds = [], respectQuery = true } = options || {};
  const sellerSet = new Set((Array.isArray(sellerIds) ? sellerIds : [sellerIds]).map(String).filter(Boolean));
  return state.data.weeklySchedules
    .filter((item) => !respectQuery || !state.query || JSON.stringify(item).toLowerCase().includes(state.query.toLowerCase()))
    .filter((item) => !from || String(item.date || "") >= from)
    .filter((item) => !to || String(item.date || "") <= to)
    .filter((item) => !sellerSet.size || scheduleSellerIds(item).some((id) => sellerSet.has(String(id))))
    .sort((a, b) => `${a.date || ""}${a.startTime || ""}`.localeCompare(`${b.date || ""}${b.startTime || ""}`));
}

function scheduleRowsForExport(period) {
  return groupWeeklyScheduleRows(weeklyScheduleRowsForReport({ ...period, respectQuery: false }));
}

function groupWeeklyScheduleRows(rows) {
  const groups = new Map();
  rows.forEach((item) => {
    const condo = findById("condos", item.condoId);
    const condoName = condo?.name || item.condoName || "";
    const address = item.address || condo?.address || "";
    const key = [
      item.date || "",
      item.startTime || "",
      item.endTime || "",
      item.condoId || normalizeKey(condoName),
      normalizeKey(address),
      normalizeKey(item.workArea || ""),
      item.accessMode || "",
      item.status || "Programada"
    ].join("|");
    if (!groups.has(key)) {
      groups.set(key, { ...item, condoName, address, sellerIds: [], sellerId: "", notes: "", __notes: new Set() });
    }
    const row = groups.get(key);
    row.sellerIds = [...new Set([...scheduleSellerIds(row), ...scheduleSellerIds(item)])];
    row.sellerId = row.sellerIds[0] || "";
    if (item.notes && !row.__notes.has(item.notes)) row.__notes.add(item.notes);
    row.notes = [...row.__notes].join(" | ");
  });
  return [...groups.values()]
    .map(({ __notes, ...row }) => row)
    .sort((a, b) => `${a.date || ""}${a.startTime || ""}${a.condoName || ""}`.localeCompare(`${b.date || ""}${b.startTime || ""}${b.condoName || ""}`));
}

function scheduleAgendaGrid(rows) {
  const days = new Map();
  rows.forEach((item) => {
    const key = item.date || "Sem data";
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(item);
  });
  return `<section class="agenda-grid">
    ${[...days.entries()].map(([date, items]) => scheduleAgendaDay(date, items)).join("")}
  </section>`;
}

function scheduleAgendaDay(date, items) {
  const label = date === "Sem data" ? "Sem data" : fmtDate(date);
  return `<article class="agenda-day">
    <header><strong>${escapeHtml(label)}</strong><span>${items.length} rota(s)</span></header>
    <div class="agenda-body">
      ${items.length ? items.map(scheduleAgendaCard).join("") : `<div class="empty-agenda">Sem rota</div>`}
    </div>
  </article>`;
}

function scheduleAgendaCard(item) {
  const condo = findById("condos", item.condoId);
  return `<div class="agenda-card">
    <div class="agenda-time">
      <strong>${escapeHtml(item.startTime || "-")}</strong>
      <span>até ${escapeHtml(item.endTime || "-")}</span>
    </div>
    <div class="agenda-main">
      <p class="agenda-condo">${escapeHtml(condo?.name || item.condoName || "-")}</p>
      <p class="agenda-address">${escapeHtml(item.address || condo?.address || "-")}</p>
      <div class="agenda-meta">
        <span>${escapeHtml(item.accessMode || "Atuação")}</span>
        <span>${escapeHtml(item.workArea || "Área geral")}</span>
        <span>${escapeHtml(item.status || "Programada")}</span>
      </div>
    </div>
    <div class="agenda-team">
      <span>Equipe</span>
      <strong>${escapeHtml(scheduleSellers(item) || "Consultores")}</strong>
    </div>
  </div>`;
}

function scheduleDaySections(rows) {
  const days = new Map();
  rows.forEach((item) => {
    const key = item.date || "Sem data";
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(item);
  });
  return [...days.entries()].map(([date, items]) => {
    const bySeller = new Map();
    items.forEach((item) => {
      scheduleSellerNames(item).forEach((seller) => {
        if (!bySeller.has(seller)) bySeller.set(seller, []);
        bySeller.get(seller).push(item);
      });
    });
    return `<section class="day-section">
      <h2 class="day-title">${escapeHtml(fmtDate(date))}</h2>
      ${[...bySeller.entries()].map(([seller, sellerRows]) => scheduleSellerBlock(seller, sellerRows)).join("")}
    </section>`;
  }).join("");
}

function scheduleSellerBlock(seller, rows) {
  return `<div class="seller-block">
    <h3 class="seller-title">${escapeHtml(seller)}</h3>
    <table>
      <colgroup><col style="width:12%"><col style="width:20%"><col style="width:31%"><col style="width:13%"><col style="width:10%"><col style="width:14%"></colgroup>
      <thead><tr><th>Horário</th><th>Condomínio</th><th>Endereço</th><th>Atuação</th><th>Status</th><th>Orientação</th></tr></thead>
      <tbody>${rows.map((item) => scheduleReportRow(item)).join("")}</tbody>
    </table>
  </div>`;
}

function scheduleSellerNames(item) {
  const ids = scheduleSellerIds(item);
  const names = ids.map((id) => findById("sellers", id)?.name).filter(Boolean);
  return names.length ? names : ["Sem consultor definido"];
}

function scheduleSellerEmails(item) {
  const ids = scheduleSellerIds(item);
  return [...new Set(ids
    .map((id) => findById("sellers", id))
    .map((seller) => seller?.email || knownSellerEmail(seller?.name))
    .filter(Boolean))];
}

function scheduleSellerIds(item) {
  return (Array.isArray(item?.sellerIds) && item.sellerIds.length ? item.sellerIds : [item?.sellerId])
    .map(String)
    .filter(Boolean);
}

function knownSellerEmail(name) {
  const map = {
    IVAN: "ivan.carvalho@usetelecom.com.br",
    ISIS: "isis.santos@bahiainternet.com.br",
    "ISIS SILVA": "isis.santos@bahiainternet.com.br",
    BRUNA: "bruna.silva@usetelecom.com.br",
    ADRIELE: "adriele.silva@usetelecom.com.br"
  };
  const key = normalizeKey(name).split(" ").slice(0, 2).join(" ");
  return map[key] || map[key.split(" ")[0]] || "";
}

function scheduleReportRow(item) {
  const condo = findById("condos", item.condoId);
  return `<tr>
    <td>${escapeHtml(item.startTime || "-")} às ${escapeHtml(item.endTime || "-")}</td>
    <td>${escapeHtml(condo?.name || item.condoName || "-")}</td>
    <td>${escapeHtml(item.address || condo?.address || "-")}</td>
    <td>${escapeHtml(item.accessMode || "-")}<br><span class="badge">${escapeHtml(item.workArea || "Área geral")}</span></td>
    <td>${escapeHtml(item.status || "Programada")}</td>
    <td>${escapeHtml(item.notes || "-")}</td>
  </tr>`;
}

function buildWeeklyScheduleText(options = {}) {
  const rows = options.rows || weeklyScheduleRowsForReport(options.period || {});
  const lines = [
    "WS Consultoria - Programação semanal da equipe",
    options.period ? schedulePeriodLabel(options.period) : "",
    `Gerado em: ${fmtDateTime(new Date().toISOString())}`,
    ""
  ];
  if (!rows.length) {
    lines.push("Nenhuma programação cadastrada.");
    return lines.join("\n");
  }
  rows.forEach((item, index) => {
    const condo = findById("condos", item.condoId);
    const info = condoScheduleInfo(item.condoId, item.date);
    lines.push(
      `${index + 1}. ${fmtDate(item.date)} | ${item.startTime || "-"} às ${item.endTime || "-"}`,
      `Responsáveis: ${scheduleSellers(item) || "-"}`,
      `Condomínio: ${condo?.name || item.condoName || "-"}`,
      `Endereço: ${item.address || condo?.address || "-"}`,
      `Atuação: ${item.accessMode || "-"} | Área: ${item.workArea || "-"} | Status: ${item.status || "Programada"}`,
      `Retorno: ${info.title} - ${info.detail}`,
      item.notes ? `Orientação: ${item.notes}` : "",
      ""
    );
  });
  return lines.filter((line, index, arr) => line || arr[index - 1]).join("\n");
}

function copyLogs() {
  const content = filtered("activities").map((item) => `${fmtDateTime(item.date)} | ${item.user || "-"} | ${item.action || "-"} | ${item.details || "-"}`).join("\n");
  navigator.clipboard.writeText(content || "Sem histórico para copiar.");
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildReport() {
  const filter = state.reportFilter;
  const rows = reportExportRows(filter).slice(1);
  const lines = [
    "Sistema de Gestão Comercial - Relatório",
    `Atividade: ${reportLabel(filter)}`,
    `Gerado em: ${fmtDateTime(new Date().toISOString())}`,
    ""
  ];
  if (!rows.length) lines.push("Nenhuma informação selecionada.");
  rows.forEach((row) => lines.push(row.filter((cell) => cell !== undefined && cell !== "").join(" | ")));
  return lines.join("\n");
}

function reportExportRows(filter = state.reportFilter) {
  const selected = selectedReportOptions(filter);
  const rows = [["Área", "Bloco", "Campo 1", "Campo 2", "Campo 3", "Campo 4", "Campo 5", "Campo 6", "Campo 7"]];
  const push = (block, dataRows) => dataRows.forEach((row) => rows.push([reportLabel(filter), block, ...row]));
  const visibleSales = visibleSalesRows();
  if (selected.has("metrics")) push("Indicadores", reportMetricRows(filter));
  if (selected.has("salesRanking")) push("Ranking comercial", sellerRanking().slice(0, 12).map((row) => [row.name, row.count, money(row.value), `${row.conversion}%`]));
  if (selected.has("latestSales")) push("Vendas recentes", [...visibleSales].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 20).map((sale) => [fmtDate(sale.date), saleSellerName(sale) || "-", saleTypeLabel(sale), sale.customer || "-", findById("condos", sale.condoId)?.name || sale.condoName || "-", money(sale.value), saleStatusLabel(sale)]));
  if (selected.has("salesStatus")) push("Status das vendas", counts(visibleSales.map((sale) => ({ status: saleStatusLabel(sale) })), "status").map((row) => [row.label, row.value]));
  if (selected.has("relationships")) push("Relacionamento prioritário", state.data.visits.filter((visit) => !["Finalizado", "Visitado"].includes(visit.status)).slice(0, 20).map((visit) => [findById("condos", visit.condoId)?.name || visit.condoName || "-", visit.status || "-", visit.relationship || "-", fmtDate(visit.nextVisit || visit.date)]));
  if (selected.has("upcomingVisits")) push("Próximas visitas", upcomingEvents().filter((event) => event.type === "visits").slice(0, 20).map((event) => [fmtDateTime(event.date), event.title, event.status || "-", event.location || "-"]));
  if (selected.has("condoPriorities")) {
    const latest = latestVisitByCondo();
    push("Condomínios sem visita", state.data.condos.map((condo) => ({ condo, last: latest.get(condo.id), days: daysSince(latest.get(condo.id)?.date) })).sort((a, b) => b.days - a.days).slice(0, 20).map(({ condo, last, days }) => [condo.name || "-", condo.city || "-", condo.neighborhood || "-", last ? fmtDate(last.date) : "Nunca", days >= 9999 ? "Sem histórico" : `${days} dia(s)`]));
  }
  if (selected.has("scheduleByDay")) push("Programação por dia", weeklyScheduleRowsForReport().slice(0, 24).map((item) => [fmtDate(item.date), `${item.startTime || "-"} às ${item.endTime || "-"}`, findById("condos", item.condoId)?.name || item.condoName || "-", scheduleSellers(item) || "-", item.accessMode || "-", item.status || "Programada"]));
  if (selected.has("scheduleConsultants")) {
    const map = new Map();
    weeklyScheduleRowsForReport().forEach((item) => scheduleSellerNames(item).forEach((seller) => map.set(seller, (map.get(seller) || 0) + 1)));
    push("Consultores na programação", [...map.entries()].sort((a, b) => b[1] - a[1]).map(([seller, routes]) => [seller, routes]));
  }
  if (selected.has("expansion")) push("Expansão em acompanhamento", state.data.expansions.filter((item) => !["Concluído", "Reprovado"].includes(item.status)).slice(0, 20).map((item) => [item.condoName || "-", item.type || "-", item.status || "-", fmtDate(item.expectedDate || item.date)]));
  if (selected.has("expansionStatus")) push("Expansão por status", counts(state.data.expansions, "status").map((row) => [row.label, row.value]));
  if (selected.has("condoMaster")) push("Cadastro mestre", state.data.condos.slice(0, 24).map((condo) => [condo.name || "-", condo.city || "-", condo.neighborhood || "-", condo.managerCompany || "-", condo.capacity || "-", condo.status || "Ativo"]));
  if (selected.has("plans")) push("Planos ativos", state.data.plans.filter((plan) => plan.status !== "Inativo").slice(0, 24).map((plan) => [plan.city || "-", plan.name || "-", plan.speed || "-", money(plan.price)]));
  if (selected.has("plansByCity")) {
    const map = new Map();
    state.data.plans.filter((plan) => plan.status !== "Inativo").forEach((plan) => map.set(plan.city || "Sem cidade", (map.get(plan.city || "Sem cidade") || 0) + 1));
    push("Planos por cidade", [...map.entries()].map(([city, total]) => [city, total]));
  }
  return rows;
}

function reportCards() {
  const sales = visibleSalesRows();
  const visits = state.data.visits;
  const expansions = state.data.expansions;
  return `<div class="grid cols-4">
    ${metric("Vendas", sales.length)}
    ${metric("Receita total", money(sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0)))}
    ${metric("Visitas", visits.length)}
    ${metric("Protocolos", expansions.length)}
  </div>
  <div class="grid cols-2">
    <div class="chart-card">${barChart("Vendas por vendedor", sellerRanking().map((row) => ({ label: row.name, value: row.count })))}</div>
    <div class="chart-card">${barChart("Protocolos por status", counts(expansions, "status"))}</div>
  </div>`;
}

function barChart(title, rows) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  return `<h3>${title}</h3><div class="bars">${rows.length ? rows.map((row) => `<div class="bar-row"><span>${escapeHtml(row.label || "-")}</span><div><i style="width:${Math.max(4, (Number(row.value || 0) / max) * 100)}%"></i></div><strong>${row.value}</strong></div>`).join("") : `<div class="empty">Sem dados para gráfico.</div>`}</div>`;
}

function counts(rows, key) {
  const map = new Map();
  rows.forEach((row) => map.set(row[key] || "Sem status", (map.get(row[key] || "Sem status") || 0) + 1));
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

function filtered(collection) {
  const rows = state.data[collection] || [];
  const q = state.query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
}

function filteredWithPage(page, rows = state.data[page] || []) {
  const q = state.query.trim().toLowerCase();
  const filters = state.filters[page] || {};
  return rows.filter((item) => {
    if (q && !JSON.stringify(item).toLowerCase().includes(q)) return false;
    if (filters.from && String(item.date || item.expectedDate || "").slice(0, 10) < filters.from) return false;
    if (filters.to && String(item.date || item.expectedDate || "").slice(0, 10) > filters.to) return false;
    if (filters.date && String(item.date || "").slice(0, 10) !== filters.date) return false;
    if (filters.status) {
      const value = page === "sales" ? saleStatusLabel(item) : String(item.status || "");
      if (value !== filters.status) return false;
    }
    if (filters.type && String(item.type || "") !== filters.type) return false;
    if (filters.saleType && saleTypeLabel(item) !== filters.saleType) return false;
    if (filters.seller && !matchesSeller(item, filters.seller)) return false;
    if (filters.condo && !matchesCondo(item, filters.condo)) return false;
    if (filters.plan && String(item.planId || "") !== String(filters.plan)) return false;
    if (filters.region && !includesAny([item.workArea, item.region, item.address, findById("condos", item.condoId)?.neighborhood], filters.region)) return false;
    if (filters.city && !includesAny([item.city, condoFor(item)?.city, item.address], filters.city)) return false;
    if (filters.neighborhood && !includesAny([item.neighborhood, condoFor(item)?.neighborhood, item.address], filters.neighborhood)) return false;
    if (filters.administradora && !includesAny([item.managerCompany], filters.administradora)) return false;
    if (filters.sindico && !includesAny([item.contactName, item.syndic], filters.sindico)) return false;
    if (filters.partnership && String(item.partnershipInterest || "") !== filters.partnership) return false;
    if (filters.speed && !includesAny([item.speed, item.name], filters.speed)) return false;
    if (filters.minValue && Number(item.value || 0) < Number(filters.minValue)) return false;
    if (filters.maxValue && Number(item.price || 0) > Number(filters.maxValue)) return false;
    return true;
  });
}

function matchesSeller(item, sellerId) {
  return String(item.sellerId || "") === String(sellerId) || (Array.isArray(item.sellerIds) && item.sellerIds.map(String).includes(String(sellerId)));
}

function matchesCondo(item, condoId) {
  return String(item.condoId || "") === String(condoId) || String(item.id || "") === String(condoId);
}

function condoFor(item) {
  return findById("condos", item.condoId || item.id);
}

function includesAny(values, needle) {
  const q = String(needle || "").toLowerCase();
  return values.some((value) => String(value || "").toLowerCase().includes(q));
}

function upcomingEvents(all = false) {
  const today = todayISO();
  const visitEvents = state.data.visits.map((visit) => eventFromRef(`visits:${visit.id}`)).filter(Boolean);
  const scheduleEvents = state.data.weeklySchedules.map((item) => eventFromRef(`weeklySchedules:${item.id}`)).filter(Boolean);
  const expansionEvents = state.data.expansions.map((item) => eventFromRef(`expansions:${item.id}`)).filter(Boolean).filter((event) => event.date);
  const rows = [...visitEvents, ...scheduleEvents, ...expansionEvents].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return all ? rows : rows.filter((event) => event.date && String(event.date).slice(0, 10) >= today && event.status !== "Concluida" && event.status !== "Concluido");
}

function alertKey(event) {
  return `${event.type}:${event.id}:${String(event.date || "").slice(0, 16)}`;
}

function sellerRanking() {
  const month = new Date().toISOString().slice(0, 7);
  const visibleSales = visibleSalesRows();
  return visibleCommercialSellers().map((seller) => {
    const sales = visibleSales.filter((sale) => sale.sellerId === seller.id && String(sale.date || "").startsWith(month));
    const conversion = seller.goal ? Math.round((sales.length / Number(seller.goal || 1)) * 100) : 0;
    return { id: seller.id, name: seller.name, count: sales.length, value: sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0), conversion };
  }).sort((a, b) => b.count - a.count || b.value - a.value);
}

function moveCalendar(months) {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + months, 1);
  render();
}

let reminderTimer = null;
function startReminders() {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  clearInterval(reminderTimer);
  reminderTimer = setInterval(checkReminders, 60000);
  checkReminders();
}

function checkReminders() {
  const now = Date.now();
  const soon = upcomingEvents(true).filter((event) => {
    const diff = new Date(event.date).getTime() - now;
    return diff > 0 && diff <= 30 * 60 * 1000 && !sessionStorage.getItem(`reminded-${event.type}-${event.id}`);
  });
  soon.forEach((event) => {
    sessionStorage.setItem(`reminded-${event.type}-${event.id}`, "1");
    const key = alertKey(event);
    state.activeToasts.add(key);
    setTimeout(() => {
      state.activeToasts.delete(key);
      renderAlerts();
    }, 9000);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Lembrete WS Consultoria", { body: `${fmtDateTime(event.date)} - ${event.title}` });
    }
  });
  if (soon.length) renderAlerts();
}

function findById(collection, id) {
  return (state.data[collection] || []).find((item) => item.id === id);
}

function labelFor(collection) {
  return { condos: "condomínio", weeklySchedules: "programação", visits: "relacionamento", expansions: "demanda de expansão", sellers: "vendedor", sales: "venda", plans: "plano", users: "acesso" }[collection] || collection;
}

function reportLabel(value) {
  return { geral: "Geral", vendas: "Vendas", visitas: "Relacionamento", programacao: "Programação", expansao: "Expansão", condominios: "Condomínios", planos: "Planos" }[value] || value;
}

function pageLabel(page) {
  return tabs.find(([id]) => id === page)?.[1] || "Painel";
}

function relationshipStatuses() {
  return ["Pendente", "Agendado", "Visitado", "Reagendado", "Sem acesso", "Aguardando retorno", "Finalizado"];
}

function expansionStatuses() {
  return ["Em análise", "Agendado", "Em vistoria", "Em inspeção", "Aguardando aprovação", "Aprovado", "Reprovado", "Em implantação", "Concluído"];
}

function agendaStatuses() {
  return [...new Set([...relationshipStatuses(), ...expansionStatuses(), "Programada", "Confirmada", "Em andamento", "Concluída", "Cancelada"].filter(Boolean))];
}

function gcalDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

boot();
