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
  scheduleView: "week",
  calendarDate: new Date(),
  remindersOpen: false,
  activeToasts: new Set(),
  dismissedAlerts: new Set(JSON.parse(localStorage.getItem("ws-dismissed-alerts") || "[]"))
};

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
      ["logs", "Histórico"],
      ["users", "Acessos"],
      ["settings", "Empresa"]
    ]
  }
];

const tabs = menu.flatMap((group) => group.page ? [[group.page, group.label]] : group.items);

const $ = (selector) => document.querySelector(selector);
const fmtDate = (value) => value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-";
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
  $("#exportBtn").addEventListener("click", backupData);
  $("#printBtn").addEventListener("click", printExecutiveReport);
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
  const views = { dashboard, agenda, condos, weeklySchedules, coverageMap, visits, expansions, sellers, sales, plans, reports, logs, users, settings };
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
  $("#themeBtn").textContent = theme === "dark" ? "Modo claro" : "Modo escuro";
}

function toggleTheme() {
  const next = (document.body.dataset.theme || "dark") === "dark" ? "light" : "dark";
  localStorage.setItem("ws-theme", next);
  document.body.dataset.theme = next;
  $("#themeBtn").textContent = next === "dark" ? "Modo claro" : "Modo escuro";
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
      <button class="secondary" data-calendar="${event.type}:${event.id}">Google Agenda</button>
      <button class="ghost" data-dismiss-alert="${alertKey(event)}">Fechar</button>
    </div>
  </div>`;
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
  const salesMonth = state.data.sales.filter((sale) => String(sale.date || "").startsWith(month));
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
  const sales = state.data.sales.filter((sale) => String(sale.date || "").startsWith(month));
  return `
    <div class="grid cols-3">
      ${metric("Vendas no mês", sales.length)}
      ${metric("Receita apurada", money(sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0)))}
      ${metric("Ticket médio", money(sales.length ? sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0) / sales.length : 0))}
    </div>
    <section class="card">${barChart("Vendas por vendedor", sellerRanking().map((row) => ({ label: row.name, value: row.count })))}</section>
    <section class="card">${table(["Data", "Vendedor", "Cliente", "Valor"], sales.slice(0, 12).map((sale) => [fmtDate(sale.date), findById("sellers", sale.sellerId)?.name || "-", sale.customer || "-", money(sale.value)]))}</section>`;
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
    ${listView("Cadastro mestre de condomínios", "condos", ["Nome", "Cidade/Bairro", "Endereço", "Síndico / Administradora", "Unidades", "Status", "Ações"], rows.map((item) => [
    item.name,
    [item.city, item.neighborhood].filter(Boolean).join(" / ") || "-",
    item.address || "-",
    [item.contactName, item.managerCompany, item.phone].filter(Boolean).join(" | ") || "-",
    item.capacity || "-",
    status(item.status || "Ativo"),
    actions("condos", item.id)
  ]))}`;
}

function weeklySchedules() {
  const rows = filteredWithPage("weeklySchedules").sort((a, b) => `${a.date || ""}${a.startTime || ""}`.localeCompare(`${b.date || ""}${b.startTime || ""}`));
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
    <section class="card">
      <div class="section-head">
        <h3>Programação</h3>
        <div class="toolbar">
          <div class="segmented">
            ${scheduleSegment("week", "Semana operacional")}
            ${scheduleSegment("history", "Histórico de visitas")}
          </div>
          <button class="secondary" data-copy-schedule>Copiar programação</button>
          <button class="secondary" data-download-schedule>Baixar PDF</button>
          <button class="primary" data-new="weeklySchedules">Adicionar rota</button>
        </div>
      </div>
      ${state.scheduleView === "history" ? scheduleHistoryView() : weeklyBoard(rows)}
    </section>`;
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
  const monthSales = state.data.sales.filter((sale) => String(sale.date || "").startsWith(new Date().toISOString().slice(0, 7)));
  return `
    <div class="seller-grid">
      ${state.data.sellers.map((seller) => sellerPanel(seller, monthSales)).join("")}
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
    ${listView("Equipe de vendedores", "sellers", ["Nome", "Contato", "Meta mensal", "Status", "Vendas mês", "Ações"], filtered("sellers").map((seller) => [
    seller.name,
    [seller.phone, seller.email].filter(Boolean).join(" | ") || "-",
    seller.goal || 0,
    status(seller.status || "Ativo"),
    sellerRanking().find((row) => row.id === seller.id)?.count || 0,
    actions("sellers", seller.id)
  ]))}`;
}

function sales() {
  const rows = filteredWithPage("sales");
  return `
    ${salesMetrics(rows)}
    ${filterPanel("sales", [
      filterInput("from", "Início", "date"),
      filterInput("to", "Fim", "date"),
      filterSelect("seller", "Vendedor", options("sellers").slice(1)),
      filterSelect("condo", "Condomínio", options("condos").slice(1)),
      filterSelect("plan", "Plano", options("plans").slice(1)),
      filterSelect("status", "Status", ["Confirmada", "Pendente", "Cancelada"]),
      filterInput("minValue", "Valor mínimo", "number")
    ])}
    <section class="card">
      <div class="section-head">
        <h3>Planilha online em tempo real</h3>
        <button class="primary" data-import-sales>Atualizar vendas da planilha</button>
      </div>
      <form id="salesSheetForm" class="form-grid">
        ${input("salesSheetUrl", "Link CSV publicado da planilha online", state.settings.salesSheetUrl || "", "url", "full")}
        <p class="hint full">Pode colar o link normal do Google Sheets. A planilha precisa estar com acesso "qualquer pessoa com o link pode visualizar" ou publicada na web. Cabeçalhos aceitos: vendedor, consultor, cliente, plano, valor, data, condomínio, status e obs.</p>
        <label class="full">Ou cole aqui os dados copiados da planilha<textarea name="csvText" placeholder="Cole as colunas com cabeçalho: vendedor, cliente, plano, valor, data..."></textarea></label>
        <button class="secondary" type="button" data-import-sales-text>Importar dados colados</button>
      </form>
    </section>
    ${listView("Vendas e apuração", "sales", ["Data", "Vendedor", "Plano", "Cliente", "Condomínio", "Valor", "Status", "Ações"], rows.map((sale) => [
      fmtDate(sale.date),
      findById("sellers", sale.sellerId)?.name || "-",
      findById("plans", sale.planId)?.name || sale.planName || "-",
      sale.customer || "-",
      sale.condoName || findById("condos", sale.condoId)?.name || "-",
      money(sale.value),
      status(sale.status || "Confirmada"),
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
  return `
    <section class="card">
      <div class="section-head">
        <h3>Relatórios por atividade</h3>
        <div class="toolbar">
          <select data-report-filter>
            ${["geral", "vendas", "visitas", "expansao", "planos"].map((item) => `<option value="${item}" ${state.reportFilter === item ? "selected" : ""}>${reportLabel(item)}</option>`).join("")}
          </select>
          <button class="secondary" data-copy-report>Copiar resumo</button>
          <button class="secondary" data-download-report>Baixar TXT</button>
          <button class="secondary" data-download-report-excel>Excel</button>
          <button class="secondary" data-download-report-pdf>PDF / Imprimir</button>
        </div>
      </div>
      ${reportCards()}
      ${reportPreview()}
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
        ${input("salesSheetUrl", "Link CSV da planilha de vendas", state.settings.salesSheetUrl || "", "url", "full")}
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

function salesMetrics(rows) {
  const today = todayISO();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekIso = weekAgo.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const confirmed = rows.filter((sale) => sale.status !== "Cancelada");
  const goal = state.data.sellers.reduce((sum, seller) => sum + Number(seller.goal || 0), 0);
  return `<div class="grid cols-5">
    ${metric("Vendas do dia", rows.filter((sale) => String(sale.date || "").slice(0, 10) === today).length)}
    ${metric("Semana", rows.filter((sale) => String(sale.date || "").slice(0, 10) >= weekIso).length)}
    ${metric("Mês", rows.filter((sale) => String(sale.date || "").startsWith(month)).length)}
    ${metric("Meta", goal)}
    ${metric("Conversão", `${confirmed.length}/${rows.length || 0}`)}
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
  $("[data-report-filter]")?.addEventListener("change", (event) => {
    state.reportFilter = event.target.value;
    render();
  });
  $("[data-copy-report]")?.addEventListener("click", () => navigator.clipboard.writeText(buildReport()));
  $("[data-download-report]")?.addEventListener("click", downloadReport);
  $("[data-download-report-pdf]")?.addEventListener("click", printExecutiveReport);
  $("[data-download-report-excel]")?.addEventListener("click", downloadReportExcel);
  $("[data-copy-logs]")?.addEventListener("click", copyLogs);
  $("[data-copy-schedule]")?.addEventListener("click", copyWeeklySchedule);
  $("[data-download-schedule]")?.addEventListener("click", downloadWeeklySchedule);
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
    await request(item.id ? `/api/${collection}/${item.id}` : `/api/${collection}`, {
      method: item.id ? "PUT" : "POST",
      body
    });
    modal.remove();
    await loadAll();
    render();
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

function weekDays() {
  const base = new Date();
  const start = new Date(base);
  start.setDate(base.getDate() - base.getDay() + 1);
  return Array.from({ length: 5 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function weeklyBoard(rows) {
  const byDate = new Map();
  rows.forEach((item) => {
    const key = item.date || "";
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(item);
  });
  return `<div class="weekly-board">
    ${weekDays().map((day) => {
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
      <button class="secondary" data-map="${escapeHtml(item.address || condo?.address || "")}">Mapa</button>
      <button class="danger" data-delete="weeklySchedules:${item.id}">Excluir</button>
    </div>
  </article>`;
}

function scheduleHistoryView() {
  const rows = scheduleHistoryRows();
  return `
    <div class="history-toolbar">
      <input data-search placeholder="Buscar condomínio, endereço ou responsável..." value="${escapeHtml(state.query)}">
      <p class="hint">Histórico gerado pelas programações salvas e visitas registradas. Use o status Concluída para consolidar a passagem realizada.</p>
    </div>
    ${table(["Condomínio / endereço", "Última ida", "Quem visitou", "Área", "Próxima ida", "Histórico"], rows.map((row) => [
      `${escapeHtml(row.condoName)}<small>${escapeHtml(row.address || "")}</small>`,
      row.lastDate ? fmtDate(row.lastDate) : "-",
      row.sellers || "-",
      row.workArea || "-",
      row.nextDate ? `${fmtDate(row.nextDate)}<small>${row.overdue ? "Retorno vencido" : "Retorno programado"}</small>` : "Programar primeira ida",
      row.count
    ]))}
  `;
}

function scheduleHistoryRows() {
  const byCondo = new Map();
  state.data.condos.forEach((condo) => {
    byCondo.set(condo.id, {
      condoId: condo.id,
      condoName: condo.name,
      address: condo.address,
      lastDate: "",
      nextDate: "",
      sellers: "",
      workArea: "",
      overdue: false,
      count: 0
    });
  });
  state.data.weeklySchedules.forEach((item) => {
    if (!item.condoId) return;
    const condo = findById("condos", item.condoId);
    const row = byCondo.get(item.condoId) || {
      condoId: item.condoId,
      condoName: item.condoName || "Condomínio",
      address: item.address || condo?.address || "",
      lastDate: "",
      nextDate: "",
      sellers: "",
      workArea: "",
      overdue: false,
      count: 0
    };
    row.count += 1;
    const itemDate = item.date ? `${item.date}T12:00:00` : "";
    if (itemDate && (!row.lastDate || new Date(itemDate) > new Date(row.lastDate))) {
      const next = new Date(itemDate);
      next.setDate(next.getDate() + Number(item.followUpDays || 30));
      row.lastDate = itemDate;
      row.nextDate = next.toISOString();
      row.sellers = scheduleSellers(item);
      row.workArea = item.workArea || item.accessMode || "";
      row.overdue = next < new Date();
    }
    byCondo.set(item.condoId, row);
  });
  state.data.visits.forEach((visit) => {
    if (!visit.condoId || !visit.date) return;
    const condo = findById("condos", visit.condoId);
    const row = byCondo.get(visit.condoId) || {
      condoId: visit.condoId,
      condoName: condo?.name || "Condomínio",
      address: condo?.address || "",
      lastDate: "",
      nextDate: "",
      sellers: "",
      workArea: "",
      overdue: false,
      count: 0
    };
    row.count += 1;
    if (!row.lastDate || new Date(visit.date) > new Date(row.lastDate)) {
      const next = new Date(visit.date);
      next.setDate(next.getDate() + 30);
      row.lastDate = visit.date;
      row.nextDate = next.toISOString();
      row.sellers = "Visita registrada";
      row.workArea = visit.purpose || "";
      row.overdue = next < new Date();
    }
    byCondo.set(visit.condoId, row);
  });
  const q = state.query.trim().toLowerCase();
  return [...byCondo.values()]
    .filter((row) => !q || JSON.stringify(row).toLowerCase().includes(q))
    .sort((a, b) => {
      if (!a.lastDate && b.lastDate) return 1;
      if (a.lastDate && !b.lastDate) return -1;
      return String(a.nextDate || "9999").localeCompare(String(b.nextDate || "9999"));
    });
}

function scheduleActions(item) {
  const condo = findById("condos", item.condoId);
  const address = item.address || condo?.address || "";
  return address ? `<div class="row-actions"><button class="secondary" data-map="${escapeHtml(address)}">Mapa</button></div>` : "";
}

function scheduleSellers(item) {
  const ids = Array.isArray(item.sellerIds) && item.sellerIds.length ? item.sellerIds : [item.sellerId].filter(Boolean);
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

async function importSales() {
  const url = $("#salesSheetForm input[name='salesSheetUrl']")?.value || state.settings.salesSheetUrl;
  try {
    const result = await request("/api/sales/import", { method: "POST", body: { url } });
    alert(`${result.imported} venda(s) importada(s).`);
    await loadAll();
    render();
  } catch (error) {
    alert(error.message);
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
  const event = eventFromRef(ref);
  if (!event) return;
  const start = new Date(event.date || Date.now());
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", `WS Consultoria - ${event.title}`);
  url.searchParams.set("dates", `${gcalDate(start)}/${gcalDate(end)}`);
  url.searchParams.set("details", event.note || "");
  url.searchParams.set("location", event.location || "");
  window.open(url.toString(), "_blank");
}

function openEmail(ref) {
  const event = eventFromRef(ref);
  if (!event) return;
  const to = state.settings.notificationEmail || state.settings.adminEmail || "";
  const subject = `Confirmação - ${event.title}`;
  const body = `WS Consultoria\n\nAtividade: ${event.title}\nData: ${fmtDateTime(event.date)}\nStatus: ${event.status}\nEndereço: ${event.location || "-"}\n\nObs:\n${event.note || ""}`;
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
    return { id, type, date, condoId: item.condoId, sellerId: item.sellerId, sellerIds: item.sellerIds, title: `${condo?.name || item.condoName || "Programação"} - ${scheduleSellers(item) || "Equipe"}`, status: item.status, note: item.notes || item.workArea || item.accessMode || "", location: item.address || condo?.address || "" };
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

function reportDocumentHtml(filter = state.reportFilter) {
  const logo = reportLogoSrc();
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
    ${reportEssentialMetrics()}
    <div class="report-grid">${reportEssentialSections(filter)}</div>
    <p class="notes">Documento gerado somente com indicadores e registros essenciais para acompanhamento gerencial.</p>
  </main>`;
}

function reportLogoSrc() {
  return `${location.origin}/assets/use-logo.gif`;
}

function reportPreview() {
  return `<div class="report-preview">${reportDocumentHtml()}</div>`;
}

function activeReportFilter() {
  if (state.page === "reports") return state.reportFilter;
  return {
    dashboard: "geral",
    sales: "vendas",
    sellers: "vendas",
    visits: "visitas",
    weeklySchedules: "visitas",
    agenda: "visitas",
    expansions: "expansao",
    plans: "planos",
    condos: "visitas",
    coverageMap: "visitas"
  }[state.page] || "geral";
}

function reportEssentialMetrics() {
  const month = new Date().toISOString().slice(0, 7);
  const salesMonth = state.data.sales.filter((sale) => String(sale.date || "").startsWith(month));
  const revenue = salesMonth.reduce((sum, sale) => sum + Number(sale.value || 0), 0);
  const openVisits = state.data.visits.filter((visit) => !["Finalizado", "Visitado", "Concluida", "Concluída"].includes(visit.status)).length;
  const openExpansions = state.data.expansions.filter((item) => !["Concluído", "Reprovado"].includes(item.status)).length;
  return `<section class="metrics">
    ${reportMetric("Vendas no mês", salesMonth.length)}
    ${reportMetric("Receita do mês", money(revenue))}
    ${reportMetric("Relacionamentos abertos", openVisits)}
    ${reportMetric("Expansões abertas", openExpansions)}
  </section>`;
}

function reportMetric(label, value) {
  return `<div class="metric-box"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function reportEssentialSections(filter = state.reportFilter) {
  const sections = [];
  if (filter === "geral" || filter === "vendas") sections.push(reportSalesSection());
  if (filter === "geral" || filter === "visitas") sections.push(reportRelationshipSection());
  if (filter === "geral" || filter === "expansao") sections.push(reportExpansionSection());
  if (filter === "geral" || filter === "planos") sections.push(reportPlansSection());
  return sections.slice(0, filter === "geral" ? 4 : 2).join("");
}

function reportSalesSection() {
  const ranking = sellerRanking().slice(0, 8);
  return reportSection("Ranking comercial", ["Vendedor", "Vendas", "Receita", "Conversão"], ranking.map((row) => [row.name, row.count, money(row.value), `${row.conversion}%`]));
}

function reportRelationshipSection() {
  const rows = state.data.visits
    .filter((visit) => !["Finalizado", "Visitado"].includes(visit.status))
    .sort((a, b) => String(a.nextVisit || a.date || "").localeCompare(String(b.nextVisit || b.date || "")))
    .slice(0, 10)
    .map((visit) => [findById("condos", visit.condoId)?.name || visit.condoName || "-", visit.status || "-", visit.relationship || "-", fmtDate(visit.nextVisit || visit.date)]);
  return reportSection("Relacionamento prioritário", ["Condomínio", "Status", "Relação", "Próxima visita"], rows);
}

function reportExpansionSection() {
  const rows = state.data.expansions
    .filter((item) => !["Concluído", "Reprovado"].includes(item.status))
    .slice(0, 10)
    .map((item) => [item.condoName || "-", item.type || "-", item.status || "-", fmtDate(item.expectedDate || item.date)]);
  return reportSection("Expansão em acompanhamento", ["Condomínio", "Tipo", "Status", "Previsão"], rows);
}

function reportPlansSection() {
  const rows = state.data.plans
    .filter((plan) => plan.status !== "Inativo")
    .slice(0, 10)
    .map((plan) => [plan.city || "-", plan.name || "-", plan.speed || "-", money(plan.price)]);
  return reportSection("Planos ativos", ["Cidade", "Plano", "Velocidade", "Valor"], rows);
}

function reportSection(title, headers, rows) {
  const body = rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Sem registros essenciais para este relatório.</td></tr>`;
  return `<section class="report-section"><h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function downloadReportExcel() {
  const rows = [
    ["Módulo", "Indicador", "Valor"],
    ["Vendas", "Total", state.data.sales.length],
    ["Vendas", "Receita", state.data.sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0)],
    ["Relacionamento", "Registros", state.data.visits.length],
    ["Expansão", "Demandas", state.data.expansions.length],
    ["Condomínios", "Cadastro mestre", state.data.condos.length],
    ...sellerRanking().map((row) => ["Ranking", row.name, row.count])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  download(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), `relatorio-ws-${todayISO()}.csv`);
}

function copyWeeklySchedule() {
  navigator.clipboard.writeText(buildWeeklyScheduleText())
    .then(() => alert("Programação copiada para enviar ao grupo."));
}

function downloadWeeklySchedule() {
  printWeeklySchedulePdf();
}

function printWeeklySchedulePdf() {
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) return alert("Permita pop-ups para gerar a programação em PDF.");
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Programação semanal</title>${schedulePrintStyles()}</head><body>${scheduleDocumentHtml()}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 450);
}

function schedulePrintStyles() {
  return `<style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f5f7; color: #191d22; font-family: Arial, Helvetica, sans-serif; }
    .schedule-page { min-height: 190mm; background: white; padding: 12mm 14mm 13mm; position: relative; overflow: visible; }
    .schedule-page::before { content: ""; position: absolute; inset: 0; border-top: 9px solid #e6007e; border-bottom: 9px solid #111820; pointer-events: none; }
    .schedule-head { display: grid; grid-template-columns: 34mm 1fr auto; align-items: center; gap: 12px; border-bottom: 1px solid #d9dde2; padding: 4mm 0 8px; margin-bottom: 10px; position: relative; z-index: 1; }
    .use-logo { width: 30mm; max-height: 14mm; object-fit: contain; display: block; }
    h1 { margin: 0; font-size: 19px; color: #111820; text-transform: uppercase; letter-spacing: .03em; }
    .subtitle, .stamp, .note { color: #68727d; font-size: 10px; font-weight: 700; line-height: 1.5; }
    .stamp { text-align: right; }
    .day-section { break-inside: avoid; margin: 0 0 10px; position: relative; z-index: 1; border: 1px solid #d9dde2; border-radius: 8px; overflow: hidden; }
    .day-title { margin: 0; padding: 9px 11px; background: #000; color: white; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
    .seller-block { padding: 8px 10px 10px; break-inside: avoid; border-top: 1px solid #e6e9ed; }
    .seller-title { margin: 0 0 6px; color: #e6007e; font-size: 12px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; position: relative; z-index: 1; font-size: 9.5px; table-layout: fixed; }
    th { background: #f0f2f5; color: #111820; padding: 6px; text-align: left; text-transform: uppercase; font-size: 8.5px; }
    td { padding: 6px; border-bottom: 1px solid #e6e9ed; vertical-align: top; word-break: break-word; }
    tr:nth-child(even) td { background: #fafbfc; }
    .badge { display: inline-block; padding: 3px 7px; border-radius: 999px; background: #ffe1f0; color: #9a0054; font-weight: 800; }
    .note { margin-top: 10px; position: relative; z-index: 1; }
    @media print { body { background: white; } .schedule-page { min-height: auto; } }
  </style>`;
}

function scheduleDocumentHtml() {
  const rows = weeklyScheduleRowsForReport();
  return `<main class="schedule-page">
    <header class="schedule-head">
      <img class="use-logo" src="${location.origin}/assets/use-logo.gif" alt="USE Telecom">
      <div>
        <h1>Programação semanal da equipe</h1>
        <div class="subtitle">Roteiro operacional para atuação em condomínios</div>
      </div>
      <div class="stamp">
        Gerado em ${fmtDateTime(new Date().toISOString())}<br>
        Sistema de Gestão Comercial<br>
        Responsável: ${escapeHtml(state.user?.name || "-")}
      </div>
    </header>
    ${rows.length ? scheduleDaySections(rows) : `<section class="day-section"><h2 class="day-title">Sem programação</h2><div class="seller-block">Nenhuma programação cadastrada para exportar.</div></section>`}
    <p class="note">Relatório exclusivo da programação operacional. Logo USE aplicada somente neste documento.</p>
  </main>`;
}

function weeklyScheduleRowsForReport() {
  return state.data.weeklySchedules
    .filter((item) => !state.query || JSON.stringify(item).toLowerCase().includes(state.query.toLowerCase()))
    .sort((a, b) => `${a.date || ""}${a.startTime || ""}`.localeCompare(`${b.date || ""}${b.startTime || ""}`));
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
  const ids = Array.isArray(item.sellerIds) && item.sellerIds.length ? item.sellerIds : [item.sellerId].filter(Boolean);
  const names = ids.map((id) => findById("sellers", id)?.name).filter(Boolean);
  return names.length ? names : ["Sem consultor definido"];
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

function buildWeeklyScheduleText() {
  const rows = weeklyScheduleRowsForReport();
  const lines = [
    "WS Consultoria - Programação semanal da equipe",
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
  const month = new Date().toISOString().slice(0, 7);
  const salesMonth = state.data.sales.filter((sale) => String(sale.date || "").startsWith(month));
  const lines = [
    "WS Consultoria - Relatório",
    `Atividade: ${reportLabel(filter)}`,
    `Gerado em: ${fmtDateTime(new Date().toISOString())}`,
    ""
  ];
  if (filter === "geral" || filter === "vendas") {
    lines.push("Vendas", `Total do mês: ${salesMonth.length}`, `Receita: ${money(salesMonth.reduce((sum, sale) => sum + Number(sale.value || 0), 0))}`, "Ranking:");
    lines.push(...sellerRanking().map((row, index) => `${index + 1}. ${row.name}: ${row.count} venda(s), ${money(row.value)}`), "");
  }
  if (filter === "geral" || filter === "visitas") {
    lines.push("Visitas", `Abertas: ${state.data.visits.filter((visit) => visit.status !== "Concluida").length}`, `Concluídas: ${state.data.visits.filter((visit) => visit.status === "Concluida").length}`);
    lines.push(...upcomingEvents().filter((event) => event.type === "visits").slice(0, 10).map((event) => `- ${fmtDateTime(event.date)} | ${event.title} | ${event.status}`), "");
  }
  if (filter === "geral" || filter === "expansao") {
    lines.push("Expansão / Vistoria", `Protocolos: ${state.data.expansions.length}`);
    lines.push(...counts(state.data.expansions, "status").map((row) => `${row.label}: ${row.value}`), "");
  }
  if (filter === "geral" || filter === "planos") {
    lines.push("Planos", `Tabelas cadastradas: ${state.data.plans.length}`);
    lines.push(...state.data.plans.slice(0, 20).map((plan) => `- ${plan.city || "-"} | ${plan.serviceType || "-"} | ${plan.name || "-"} | ${money(plan.price)}`));
  }
  return lines.join("\n");
}

function reportCards() {
  const sales = state.data.sales;
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
    if (filters.status && String(item.status || "") !== filters.status) return false;
    if (filters.type && String(item.type || "") !== filters.type) return false;
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
  return state.data.sellers.map((seller) => {
    const sales = state.data.sales.filter((sale) => sale.sellerId === seller.id && String(sale.date || "").startsWith(month));
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
  return { geral: "Geral", vendas: "Vendas", visitas: "Visitas", expansao: "Expansão", planos: "Planos" }[value] || value;
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

boot();
