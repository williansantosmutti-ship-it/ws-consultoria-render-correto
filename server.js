const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnv();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "williansantos.mutti@gmail.com";
const INITIAL_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "8883e3d32b8ea89f7032952b323f6f67:90b10f284da16aa86abd7f59612fb357195f276b6310fd8850907d8b1ff3ffad";
const ITERATIONS = 120000;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const DEFAULT_SALES_SHEET_URL = "https://docs.google.com/spreadsheets/d/1VUVzx5q_emUtQtj0k2IG_6Nv2vwIrPcVRLw74UcWb4Y/edit?gid=161138712#gid=161138712";
const SALES_IMPORT_INTERVAL_MS = Number(process.env.SALES_IMPORT_INTERVAL_MS || 60000);
const DISABLE_SALES_AUTO_IMPORT = String(process.env.DISABLE_SALES_AUTO_IMPORT || "").toLowerCase() === "true";
const ALLOWED_SALES_SELLERS = new Map([
  ["IVAN", "IVAN"],
  ["LUISE", "LUISE"],
  ["ISIS", "ISIS"],
  ["BRUNA", "BRUNA"],
  ["ADRIELE", "ADRIELE"]
]);
const loginAttempts = new Map();
let salesImportRunning = false;

const sessions = new Map();

function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    writeStore(defaultStore());
  }
}

function defaultStore() {
  const now = new Date().toISOString();
  return {
    settings: {
      companyName: "WS CONSULTORIA",
      adminEmail: ADMIN_EMAIL,
      notificationEmail: ADMIN_EMAIL,
      logoUrl: "",
      primaryColor: "#13251f",
      accentColor: "#c9a227",
      salesSheetUrl: DEFAULT_SALES_SHEET_URL,
      theme: "dark"
    },
    users: [
      {
        id: uid(),
        name: "Willian Santos",
        email: ADMIN_EMAIL,
        role: "Administrador",
        permissions: ["total"],
        passwordHash: INITIAL_PASSWORD_HASH,
        active: true,
        createdAt: now
      }
    ],
    sellers: [
      seller("Ivan Carvalho"),
      seller("Luise Cristina"),
      seller("Bruna Marcela"),
      seller("Isis Silva"),
      seller("Adriele Santos")
    ],
    condos: [],
    visits: [],
    coupons: [],
    plans: [],
    expansions: [],
    weeklySchedules: [],
    sales: [],
    activities: []
  };
}

function seller(name) {
  const emails = {
    "Ivan Carvalho": "ivan.carvalho@usetelecom.com.br",
    IVAN: "ivan.carvalho@usetelecom.com.br",
    "Isis Silva": "isis.santos@bahiainternet.com.br",
    ISIS: "isis.santos@bahiainternet.com.br",
    "Bruna Marcela": "bruna.silva@usetelecom.com.br",
    BRUNA: "bruna.silva@usetelecom.com.br",
    ADRIELE: "adriele.silva@usetelecom.com.br",
    "Adriele Santos": "adriele.silva@usetelecom.com.br"
  };
  return {
    id: uid(),
    name,
    phone: "",
    email: emails[name] || "",
    status: "Ativo",
    goal: 0,
    createdAt: new Date().toISOString()
  };
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8").replace(/^\uFEFF/, ""));
}

function writeStore(data) {
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function uid() {
  return crypto.randomBytes(10).toString("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), ITERATIONS, 32, "sha1").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), ITERATIONS, 32, "sha1");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), candidate);
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

function currentUser(req) {
  const sid = parseCookies(req).ws_session;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sid);
    return null;
  }
  session.lastSeen = Date.now();
  const db = readStore();
  return db.users.find((user) => user.id === session.userId && user.active) || null;
}

function securityHeaders(type) {
  const headers = {
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https://*.google.com https://*.googleusercontent.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:; frame-src https://www.google.com https://maps.google.com; form-action 'self'; base-uri 'self'; frame-ancestors 'none'"
  };
  if (process.env.NODE_ENV === "production") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, securityHeaders(type));
  const jsonBody = type === "application/json" && typeof body !== "string" && !Buffer.isBuffer(body);
  res.end(jsonBody ? JSON.stringify(body) : body);
}

async function getBody(req) {
  let body = "";
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Requisicao muito grande.");
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

function isBlockedLogin(req) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (entry.lockUntil && entry.lockUntil > now) return true;
  if (entry.lockUntil && entry.lockUntil <= now) loginAttempts.delete(key);
  return false;
}

function recordLoginFailure(req) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, firstAt: now, lockUntil: 0 };
  if (now - entry.firstAt > 15 * 60 * 1000) {
    entry.count = 0;
    entry.firstAt = now;
  }
  entry.count += 1;
  if (entry.count >= 6) entry.lockUntil = now + 15 * 60 * 1000;
  loginAttempts.set(key, entry);
}

function clearLoginFailures(req) {
  loginAttempts.delete(clientIp(req));
}

function cookieOptions(req) {
  const secure = process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";
  return `HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}`;
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Acesso negado", "text/plain");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, "Nao encontrado", "text/plain");
  const ext = path.extname(filePath).toLowerCase();
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
  send(res, 200, fs.readFileSync(filePath), types[ext] || "application/octet-stream");
}

function cleanUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

function parseBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) send(res, 401, { error: "Sessao expirada. Entre novamente." });
  return user;
}

function addActivity(db, user, action, details) {
  db.activities.unshift({
    id: uid(),
    date: new Date().toISOString(),
    user: user.name,
    action,
    details
  });
  db.activities = db.activities.slice(0, 500);
}

function collectionName(pathname) {
  const name = pathname.split("/")[2];
  return ["settings", "users", "sellers", "condos", "visits", "coupons", "plans", "expansions", "weeklySchedules", "sales", "activities"].includes(name) ? name : null;
}

function ensureShape(db) {
  db.settings = {
    companyName: "WS CONSULTORIA",
    adminEmail: ADMIN_EMAIL,
    notificationEmail: ADMIN_EMAIL,
    logoUrl: "",
    primaryColor: "#13251f",
    accentColor: "#c9a227",
    salesSheetUrl: DEFAULT_SALES_SHEET_URL,
    theme: "dark",
    ...db.settings
  };
  for (const key of ["users", "sellers", "condos", "visits", "coupons", "plans", "expansions", "weeklySchedules", "sales", "activities"]) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  return db;
}

function googleSheetCsvUrl(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!url.hostname.includes("docs.google.com") || !url.pathname.includes("/spreadsheets/d/")) return value;
    const id = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
    if (!id) return value;
    const hashGid = url.hash.match(/gid=([0-9]+)/)?.[1];
    const gid = url.searchParams.get("gid") || hashGid || "0";
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  } catch {
    return value;
  }
}

function detectDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim()) || "";
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  if (tabs > commas && tabs >= semicolons) return "\t";
  return semicolons > commas ? ";" : ",";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const delimiter = detectDelimiter(text);
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeSheetDate(value) {
  const text = String(value || "").trim();
  if (!text) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const br = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (br) {
    const day = br[1].padStart(2, "0");
    const month = br[2].padStart(2, "0");
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function normalizeMoney(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (cleaned.includes(",")) return Number(cleaned.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(cleaned) || 0;
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function rowValue(row, map, names) {
  for (const name of names) {
    const index = map[normalizeHeader(name)];
    if (index !== undefined) return row[index] || "";
  }
  return "";
}

function findOrCreateSeller(db, name) {
  if (!name) return "";
  const found = db.sellers.find((seller) => seller.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const created = seller(name);
  db.sellers.unshift(created);
  return created.id;
}

function findPlanId(db, name) {
  return db.plans.find((plan) => plan.name.toLowerCase() === String(name || "").toLowerCase())?.id || "";
}

function normalizeTextKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .toUpperCase();
}

function sellerFirstKey(name) {
  return normalizeTextKey(name).split(" ")[0] || "";
}

function isAllowedSalesSeller(name) {
  return ALLOWED_SALES_SELLERS.has(sellerFirstKey(name));
}

function findAllowedSellerId(db, name) {
  const key = sellerFirstKey(name);
  if (!ALLOWED_SALES_SELLERS.has(key)) return "";
  const found = db.sellers.find((item) => sellerFirstKey(item.name) === key);
  if (found) return found.id;
  const created = seller(ALLOWED_SALES_SELLERS.get(key));
  db.sellers.unshift(created);
  return created.id;
}

function classifySale(row, map) {
  const text = normalizeTextKey([
    rowValue(row, map, ["tipo", "tipo venda", "tipo da venda", "categoria", "modalidade"]),
    rowValue(row, map, ["produto", "servico", "serviço", "plano"]),
    rowValue(row, map, ["status", "situacao", "situação", "motivo"]),
    rowValue(row, map, ["obs", "observacao", "observação", "observacoes", "observações"])
  ].join(" "));
  if (text.includes("CANCEL")) return "Cancelamento";
  if (text.includes("REPETIDOR")) return "Repetidor de sinal";
  if (text.includes("DOWNGRADE") || text.includes("DOWGRAD")) return "Downgrade";
  if (text.includes("UPGRADE")) return "Upgrade";
  return "Venda nova";
}

function normalizeSaleStatus(rawStatus, type) {
  const text = normalizeTextKey(`${rawStatus || ""} ${type || ""}`);
  if (text.includes("CANCEL")) return "Cancelada";
  if (text.includes("AGUARD") || text.includes("PENDENTE") || text.includes("OBSTRU")) return "Pendente";
  return "Confirmada";
}

function importSalesRows(db, rows) {
  if (rows.length < 2) return 0;
  const header = rows.shift();
  const map = Object.fromEntries(header.map((cell, index) => [normalizeHeader(cell), index]));
  let imported = 0;
  for (const row of rows) {
    const sellerName = rowValue(row, map, ["vendedor", "consultor", "consultora", "nome do vendedor", "colaborador", "responsavel", "responsável", "vendedor responsavel", "vendedor responsável"]);
    if (!isAllowedSalesSeller(sellerName)) continue;
    const customer = rowValue(row, map, ["cliente", "assinante", "nome", "nome cliente"]);
    const planName = rowValue(row, map, ["plano", "produto", "servico", "serviço", "plano contratado"]);
    const date = normalizeSheetDate(rowValue(row, map, ["data", "data da venda", "criado em", "dt venda"]));
    const value = normalizeMoney(rowValue(row, map, ["valor", "preco", "preço", "mensalidade", "total", "valor plano"]));
    const type = classifySale(row, map);
    const rawStatus = rowValue(row, map, ["status", "situacao", "situação"]);
    if (!customer && !planName) continue;
    const externalKey = [date, sellerFirstKey(sellerName), customer, planName, type].join("|").toLowerCase();
    if (db.sales.some((sale) => sale.externalKey === externalKey)) continue;
    db.sales.unshift({
      id: uid(),
      date,
      sellerId: findAllowedSellerId(db, sellerName),
      sellerName: ALLOWED_SALES_SELLERS.get(sellerFirstKey(sellerName)),
      planId: findPlanId(db, planName),
      planName,
      type,
      customer,
      condoName: rowValue(row, map, ["condominio", "condomínio", "edificio", "edifício", "bairro", "endereco", "endereço"]),
      value,
      status: normalizeSaleStatus(rawStatus, type),
      rawStatus,
      notes: rowValue(row, map, ["obs", "observacao", "observação", "observacoes", "observações"]),
      source: "Planilha online",
      externalKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    imported += 1;
  }
  return imported;
}

async function fetchSalesRows(url) {
  const sourceUrl = googleSheetCsvUrl(url || DEFAULT_SALES_SHEET_URL);
  if (!sourceUrl) throw new Error("Informe o link da planilha do Google Sheets.");
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error("Nao foi possivel ler a planilha. Confira se ela esta publicada/compartilhada para leitura.");
  const rows = parseCsv(await response.text());
  if (rows.length < 2) throw new Error("A planilha nao tem linhas para importar.");
  return { rows, sourceUrl };
}

async function importSalesFromUrl(db, url) {
  const { rows } = await fetchSalesRows(url || db.settings.salesSheetUrl || DEFAULT_SALES_SHEET_URL);
  const imported = importSalesRows(db, rows);
  db.settings.salesSheetUrl = url || db.settings.salesSheetUrl || DEFAULT_SALES_SHEET_URL;
  db.settings.salesImportAt = new Date().toISOString();
  db.settings.salesImportStatus = imported ? `${imported} venda(s) nova(s) importada(s)` : "Sem novas vendas";
  return imported;
}

async function runAutomaticSalesImport() {
  if (salesImportRunning) return 0;
  salesImportRunning = true;
  try {
    const snapshot = ensureShape(readStore());
    const source = snapshot.settings.salesSheetUrl || DEFAULT_SALES_SHEET_URL;
    const { rows } = await fetchSalesRows(source);
    const latest = ensureShape(readStore());
    const imported = importSalesRows(latest, rows);
    latest.settings.salesSheetUrl = source;
    latest.settings.salesImportAt = new Date().toISOString();
    latest.settings.salesImportStatus = imported ? `${imported} venda(s) nova(s) importada(s)` : "Sem novas vendas";
    if (imported) addActivity(latest, { name: "Sistema" }, "Importou vendas automaticamente", `${imported} venda(s) pela planilha online`);
    writeStore(latest);
    return imported;
  } catch (error) {
    const db = ensureShape(readStore());
    db.settings.salesImportAt = new Date().toISOString();
    db.settings.salesImportStatus = `Erro: ${error.message}`;
    writeStore(db);
    return 0;
  } finally {
    salesImportRunning = false;
  }
}

async function api(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  if (url.pathname === "/api/health") {
    return send(res, 200, { ok: true, name: "WS CONSULTORIA", time: new Date().toISOString() });
  }

  if (url.pathname === "/api/login" && method === "POST") {
    if (isBlockedLogin(req)) {
      return send(res, 429, { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
    }
    const body = await getBody(req);
    const db = readStore();
    const user = db.users.find((item) => item.email.toLowerCase() === String(body.email || "").toLowerCase() && item.active);
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      recordLoginFailure(req);
      return send(res, 401, { error: "Email ou senha invalidos." });
    }
    clearLoginFailures(req);
    const sid = uid();
    sessions.set(sid, { userId: user.id, createdAt: Date.now() });
    res.writeHead(200, {
      ...securityHeaders("application/json"),
      "Set-Cookie": `ws_session=${encodeURIComponent(sid)}; ${cookieOptions(req)}`
    });
    return res.end(JSON.stringify({ user: cleanUser(user), settings: db.settings }));
  }

  if (url.pathname === "/api/logout" && method === "POST") {
    const sid = parseCookies(req).ws_session;
    sessions.delete(sid);
    res.writeHead(200, {
      ...securityHeaders("application/json"),
      "Set-Cookie": `ws_session=; ${cookieOptions(req)}; Max-Age=0`
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (url.pathname === "/api/me") {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = readStore();
    return send(res, 200, { user: cleanUser(user), settings: db.settings });
  }

  if (url.pathname === "/api/all") {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = ensureShape(readStore());
    return send(res, 200, { ...db, users: db.users.map(cleanUser) });
  }

  if (url.pathname === "/api/sales/import" && method === "POST") {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await getBody(req);
    const db = ensureShape(readStore());
    if (body.csvText) {
      const rows = parseCsv(body.csvText);
      if (rows.length < 2) return send(res, 400, { error: "Cole os dados com cabecalho e pelo menos uma venda." });
      const imported = importSalesRows(db, rows);
      if (imported || !body.silent) addActivity(db, user, "Importou vendas", `${imported} venda(s) colada(s) da planilha`);
      writeStore(db);
      return send(res, 200, { imported });
    }
    let imported = 0;
    try {
      imported = await importSalesFromUrl(db, body.url || db.settings.salesSheetUrl || DEFAULT_SALES_SHEET_URL);
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
    if (imported || !body.silent) addActivity(db, user, "Importou vendas", `${imported} venda(s) pela planilha online`);
    writeStore(db);
    return send(res, 200, { imported });
  }

  const name = collectionName(url.pathname);
  if (!name) return send(res, 404, { error: "Rota nao encontrada." });
  const user = requireAuth(req, res);
  if (!user) return;
  const db = ensureShape(readStore());

  if (method === "GET") {
    return send(res, 200, name === "users" ? db.users.map(cleanUser) : db[name]);
  }

  if (name === "activities") return send(res, 403, { error: "Historico nao pode ser alterado diretamente." });

  if (method === "POST") {
    const body = await getBody(req);
    if (name === "settings") {
      db.settings = { ...db.settings, ...body };
      addActivity(db, user, "Atualizou configurações", "Dados da empresa e notificações");
      writeStore(db);
      return send(res, 200, db.settings);
    }
    const item = { ...body, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (name === "users") {
      item.passwordHash = hashPassword(body.password || "123456");
      delete item.password;
      item.permissions = Array.isArray(item.permissions) ? item.permissions : [];
      item.active = parseBoolean(body.active, true);
    }
    db[name].unshift(item);
    addActivity(db, user, `Criou ${name}`, item.name || item.title || item.code || item.id);
    writeStore(db);
    return send(res, 201, name === "users" ? cleanUser(item) : item);
  }

  if (method === "PUT") {
    const id = url.pathname.split("/")[3];
    const body = await getBody(req);
    const index = db[name].findIndex((item) => item.id === id);
    if (index < 0) return send(res, 404, { error: "Registro nao encontrado." });
    const next = { ...db[name][index], ...body, id, updatedAt: new Date().toISOString() };
    if (name === "users") {
      if (body.password) next.passwordHash = hashPassword(body.password);
      if (Object.prototype.hasOwnProperty.call(body, "active")) next.active = parseBoolean(body.active, next.active);
      delete next.password;
    }
    db[name][index] = next;
    addActivity(db, user, `Atualizou ${name}`, next.name || next.title || next.code || id);
    writeStore(db);
    return send(res, 200, name === "users" ? cleanUser(next) : next);
  }

  if (method === "DELETE") {
    const id = url.pathname.split("/")[3];
    const before = db[name].length;
    db[name] = db[name].filter((item) => item.id !== id);
    if (db[name].length === before) return send(res, 404, { error: "Registro nao encontrado." });
    addActivity(db, user, `Removeu ${name}`, id);
    writeStore(db);
    return send(res, 200, { ok: true });
  }

  send(res, 405, { error: "Metodo nao permitido." });
}

ensureStore();
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(sid);
  }
}, 10 * 60 * 1000).unref();

if (!DISABLE_SALES_AUTO_IMPORT) {
  setInterval(runAutomaticSalesImport, SALES_IMPORT_INTERVAL_MS).unref();
  setTimeout(runAutomaticSalesImport, 5000).unref();
}

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    api(req, res).catch((error) => send(res, 500, { error: error.message }));
  } else {
    serveStatic(req, res);
  }
}).listen(PORT, HOST, () => {
  console.log(`WS Consultoria rodando em http://${HOST}:${PORT}`);
});
