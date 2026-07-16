const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnv();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_DATA_DIR = fs.existsSync("/var/data") ? "/var/data" : path.join(ROOT, "data");
const DATA_DIR = process.env.DATA_DIR || process.env.RENDER_DISK_MOUNT_PATH || DEFAULT_DATA_DIR;
const STORE_FILE = path.join(DATA_DIR, "store.json");
const SEED_STORE_FILE = path.join(ROOT, "data", "store.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const VERIFIED_CAPACITY_UPDATES_FILE = path.join(ROOT, "data", "verified-capacity-updates.json");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "williansantos.mutti@gmail.com";
const INITIAL_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "8883e3d32b8ea89f7032952b323f6f67:90b10f284da16aa86abd7f59612fb357195f276b6310fd8850907d8b1ff3ffad";
const ITERATIONS = 120000;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024);
const OLD_SALES_SHEET_URL = "https://docs.google.com/spreadsheets/d/1VUVzx5q_emUtQtj0k2IG_6Nv2vwIrPcVRLw74UcWb4Y/edit?gid=161138712#gid=161138712";
const DEFAULT_SALES_SHEET_URL = "https://docs.google.com/spreadsheets/d/1r1oF6e43liRkKVbIP8h-yf_L6K22fdyzu4g816gtAV8/edit?hl=pt-br&gid=1772567492#gid=1772567492";
const SALES_IMPORT_INTERVAL_MS = Number(process.env.SALES_IMPORT_INTERVAL_MS || 600000);
const DISABLE_SALES_AUTO_IMPORT = String(process.env.DISABLE_SALES_AUTO_IMPORT || "").toLowerCase() === "true";
const CAPACITY_RESEARCH_TOKEN = process.env.CAPACITY_RESEARCH_TOKEN || "";
const CAPACITY_RESEARCH_INTERVAL_MS = Number(process.env.CAPACITY_RESEARCH_INTERVAL_MS || 0);
const DISABLE_CAPACITY_AUTO_RESEARCH = String(process.env.DISABLE_CAPACITY_AUTO_RESEARCH || "").toLowerCase() === "true";
const ALLOWED_SALES_SELLERS = new Map([
  ["IVAN", "IVAN"],
  ["LUISE", "LUISE"],
  ["ISIS", "ISIS"],
  ["BRUNA", "BRUNA"],
  ["ADRIELE", "ADRIELE"]
]);
const LOCAL_RESTORE_COLLECTIONS = ["sellers", "condos", "visits", "coupons", "plans", "expansions", "weeklySchedules", "roadAreas", "commercialActions", "actionResults", "materials", "marketingRequests", "internalDemands", "pendingItems", "goals", "deletedRefs"];
const loginAttempts = new Map();
let salesImportRunning = false;
let capacityResearchRunning = false;
let nodemailerModule = null;

const sessions = new Map();

function storageInfo() {
  const usingExplicitPath = Boolean(process.env.DATA_DIR || process.env.RENDER_DISK_MOUNT_PATH);
  const usingRenderDisk = path.resolve(DATA_DIR) === path.resolve("/var/data");
  const persistent = usingExplicitPath || usingRenderDisk;
  return {
    dataDir: DATA_DIR,
    storeFile: STORE_FILE,
    persistent,
    warning: persistent ? "" : "Sem disco persistente configurado. Dados gravados neste arquivo podem voltar ao padrao apos deploy ou reinicio do Render."
  };
}

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
    const seed = path.resolve(SEED_STORE_FILE);
    const target = path.resolve(STORE_FILE);
    if (seed !== target && fs.existsSync(seed)) {
      fs.copyFileSync(seed, STORE_FILE);
    } else {
      writeStore(defaultStore());
    }
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
      calendarAutoInvite: "false",
      smtpHost: "",
      smtpPort: "587",
      smtpSecure: "false",
      smtpUser: "",
      smtpPassword: "",
      smtpFromName: "WS Consultoria",
      smtpFromEmail: "",
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
    roadAreas: [],
    commercialActions: [],
    actionResults: [],
    materials: [],
    marketingRequests: [],
    internalDemands: [],
    pendingItems: [],
    goals: [],
    sales: [],
    activities: [],
    deletedRefs: []
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
  writeDailyBackup(data);
}

function writeDailyBackup(data) {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(BACKUP_DIR, `store-${stamp}.latest.json`), JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn(`Nao foi possivel gerar backup diario: ${error.message}`);
  }
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

function cleanSettings(settings) {
  const safe = { ...settings };
  safe.smtpPassword = safe.smtpPassword ? "" : "";
  safe.smtpConfigured = Boolean(settings.smtpHost && settings.smtpUser && settings.smtpPassword);
  return safe;
}

function settingsFromBody(current, body) {
  const next = { ...current, ...body };
  if (!body.smtpPassword) next.smtpPassword = current.smtpPassword || "";
  next.calendarAutoInvite = String(parseBoolean(body.calendarAutoInvite, parseBoolean(current.calendarAutoInvite, false)));
  next.smtpSecure = String(parseBoolean(body.smtpSecure, parseBoolean(current.smtpSecure, false)));
  return next;
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
  return ["settings", "users", "sellers", "condos", "visits", "coupons", "plans", "expansions", "weeklySchedules", "roadAreas", "commercialActions", "actionResults", "materials", "marketingRequests", "internalDemands", "pendingItems", "goals", "sales", "activities"].includes(name) ? name : null;
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
    calendarAutoInvite: "false",
    smtpHost: "",
    smtpPort: "587",
    smtpSecure: "false",
    smtpUser: "",
    smtpPassword: "",
    smtpFromName: "WS Consultoria",
    smtpFromEmail: "",
    theme: "dark",
    ...db.settings
  };
  if (!db.settings.salesSheetUrl || db.settings.salesSheetUrl === OLD_SALES_SHEET_URL) db.settings.salesSheetUrl = DEFAULT_SALES_SHEET_URL;
  for (const key of ["users", "sellers", "condos", "visits", "coupons", "plans", "expansions", "weeklySchedules", "roadAreas", "commercialActions", "actionResults", "materials", "marketingRequests", "internalDemands", "pendingItems", "goals", "sales", "activities", "deletedRefs"]) {
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

function repairMojibake(value) {
  const text = String(value || "");
  if (!/[ÃÂ�]/.test(text)) return text;
  try {
    return Buffer.from(text, "latin1").toString("utf8");
  } catch {
    return text;
  }
}

function capacitySeedKey(value) {
  return normalizeTextKey(repairMojibake(value));
}

function applyVerifiedCapacityUpdates() {
  if (!fs.existsSync(VERIFIED_CAPACITY_UPDATES_FILE)) return;
  const db = ensureShape(readStore());
  const updates = JSON.parse(fs.readFileSync(VERIFIED_CAPACITY_UPDATES_FILE, "utf8").replace(/^\uFEFF/, ""));
  const byName = new Map();
  for (const condo of db.condos || []) {
    const key = capacitySeedKey(condo.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(condo);
  }
  let applied = 0;
  for (const update of Array.isArray(updates) ? updates : []) {
    const condos = byName.get(capacitySeedKey(update.targetName)) || [];
    if (!Number(update.capacity || 0)) continue;
    for (const condo of condos) {
      if (Number(condo.capacity || 0) > 0) continue;
      condo.capacity = Number(update.capacity);
      condo.capacityStatus = "Verificada";
      condo.capacityConfidence = update.confidence || "Alta";
      condo.capacitySourceTitle = update.sourceTitle || "Relatorio de Condominios - Use Telecom.pdf";
      condo.capacityEvidence = [update.sourceName, update.sourceDetail, update.evidence].filter(Boolean).join(" | ");
      condo.capacityCheckedAt = new Date().toISOString();
      condo.updatedAt = condo.capacityCheckedAt;
      applied += 1;
    }
  }
  if (!applied) return;
  db.settings.capacitySeedAppliedAt = new Date().toISOString();
  db.settings.capacitySeedAppliedCount = Number(db.settings.capacitySeedAppliedCount || 0) + applied;
  addActivity(db, { name: "Sistema" }, "Atualizou capacidade dos condomínios", `${applied} quantidade(s) preenchida(s) com fonte verificada`);
  writeStore(db);
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

function scheduleRouteKey(item) {
  const sellerIds = Array.isArray(item.sellerIds) && item.sellerIds.length ? item.sellerIds : [item.sellerId].filter(Boolean);
  return [
    String(item.date || "").slice(0, 10),
    String(item.condoId || normalizeTextKey(item.condoName || item.condo || "")),
    String(item.startTime || ""),
    String(item.endTime || ""),
    sellerIds.map(String).sort().join(","),
    normalizeTextKey(item.workArea || ""),
    normalizeTextKey(item.accessMode || "")
  ].join("|").toLowerCase();
}

function saleExternalDeletedKey(externalKey) {
  return `sales:external:${String(externalKey || "").toLowerCase()}`;
}

function saleImportKey(item) {
  return String(item.externalKey || [
    String(item.date || "").slice(0, 10),
    sellerFirstKey(item.sellerName || item.seller || ""),
    item.customer || "",
    item.planName || "",
    item.type || ""
  ].join("|")).toLowerCase();
}

function scheduleImportDeletedKey(item) {
  return `weeklySchedules:import:${scheduleRouteKey(item)}`;
}

function isImportedSchedule(item) {
  return /importado do pdf/i.test(String(item.notes || item.source || ""));
}

function deletedRefExists(db, key) {
  return db.deletedRefs.some((ref) => ref.key === key);
}

function addDeletedRef(db, key, collection, item, user) {
  if (!key || deletedRefExists(db, key)) return;
  db.deletedRefs.unshift({
    id: uid(),
    key,
    collection,
    recordId: item?.id || "",
    label: item?.name || item?.title || item?.condoName || item?.customer || item?.code || item?.id || "",
    deletedAt: new Date().toISOString(),
    user: user?.name || "Sistema"
  });
  db.deletedRefs = db.deletedRefs.slice(0, 5000);
}

function getNodemailer() {
  if (!nodemailerModule) nodemailerModule = require("nodemailer");
  return nodemailerModule;
}

function smtpReady(settings) {
  return Boolean(settings.smtpHost && settings.smtpUser && settings.smtpPassword && (settings.smtpFromEmail || settings.notificationEmail || settings.adminEmail));
}

function calendarInviteEnabled(settings) {
  return parseBoolean(settings.calendarAutoInvite, false);
}

function scheduleSellerIdsServer(item) {
  return (Array.isArray(item?.sellerIds) && item.sellerIds.length ? item.sellerIds : [item?.sellerId]).map(String).filter(Boolean);
}

function scheduleSellersServer(db, item) {
  const names = scheduleSellerIdsServer(item).map((id) => db.sellers.find((seller) => seller.id === id)?.name).filter(Boolean);
  return names.length ? names : ["Equipe"];
}

function scheduleSellerEmailsServer(db, item) {
  return [...new Set(scheduleSellerIdsServer(item)
    .map((id) => db.sellers.find((seller) => seller.id === id))
    .map((seller) => seller?.email)
    .filter(Boolean))];
}

function scheduleCondoServer(db, item) {
  return db.condos.find((condo) => condo.id === item.condoId) || {};
}

function icsLocalDate(date, time) {
  return `${String(date || new Date().toISOString().slice(0, 10)).replace(/-/g, "")}T${String(time || "09:00").replace(":", "")}00`;
}

function icsUtcDate(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function buildScheduleIcs(db, item, attendees, settings) {
  const condo = scheduleCondoServer(db, item);
  const title = `${condo.name || item.condoName || "Programacao"} - ${scheduleSellersServer(db, item).join(", ")}`;
  const location = item.address || condo.address || "";
  const fromEmail = settings.smtpFromEmail || settings.notificationEmail || settings.adminEmail;
  const fromName = settings.smtpFromName || settings.companyName || "WS Consultoria";
  const description = [
    `Consultores: ${scheduleSellersServer(db, item).join(", ")}`,
    `Status: ${item.status || "Programada"}`,
    `Atuacao: ${item.accessMode || "-"} | ${item.workArea || "-"}`,
    item.notes ? `Orientacao: ${item.notes}` : ""
  ].filter(Boolean).join("\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WS Consultoria//Programacao//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${item.id}@ws-consultoria`,
    `DTSTAMP:${icsUtcDate(new Date())}`,
    `DTSTART;TZID=America/Sao_Paulo:${icsLocalDate(item.date, item.startTime || "09:00")}`,
    `DTEND;TZID=America/Sao_Paulo:${icsLocalDate(item.date, item.endTime || "10:00")}`,
    `SUMMARY:${icsEscape(title)}`,
    `LOCATION:${icsEscape(location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `ORGANIZER;CN=${icsEscape(fromName)}:MAILTO:${fromEmail}`,
    ...attendees.map((email) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${email}`),
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function buildScheduleInviteText(db, item) {
  const condo = scheduleCondoServer(db, item);
  return [
    "Programacao de equipe",
    "",
    `Condominio: ${condo.name || item.condoName || "-"}`,
    `Endereco: ${item.address || condo.address || "-"}`,
    `Data: ${item.date || "-"}`,
    `Horario: ${item.startTime || "-"} as ${item.endTime || "-"}`,
    `Consultores: ${scheduleSellersServer(db, item).join(", ")}`,
    `Atuacao: ${item.accessMode || "-"} | ${item.workArea || "-"}`,
    "",
    item.notes || ""
  ].join("\n");
}

async function sendScheduleCalendarInvite(db, item, user, forced = false) {
  if (!forced && !calendarInviteEnabled(db.settings)) return { sent: false, skipped: "disabled" };
  const emails = scheduleSellerEmailsServer(db, item);
  if (!emails.length) {
    item.calendarInviteStatus = "Pendente: nenhum email de consultor cadastrado";
    item.calendarInviteUpdatedAt = new Date().toISOString();
    return { sent: false, skipped: "missing-seller-email", status: item.calendarInviteStatus };
  }
  if (!smtpReady(db.settings)) {
    item.calendarInviteStatus = "Pendente: configure SMTP em Empresa";
    item.calendarInviteUpdatedAt = new Date().toISOString();
    return { sent: false, skipped: "missing-smtp", status: item.calendarInviteStatus };
  }
  try {
    const nodemailer = getNodemailer();
    const fromEmail = db.settings.smtpFromEmail || db.settings.notificationEmail || db.settings.adminEmail;
    const fromName = db.settings.smtpFromName || db.settings.companyName || "WS Consultoria";
    const transporter = nodemailer.createTransport({
      host: db.settings.smtpHost,
      port: Number(db.settings.smtpPort || 587),
      secure: parseBoolean(db.settings.smtpSecure, false),
      auth: { user: db.settings.smtpUser, pass: db.settings.smtpPassword }
    });
    const condo = scheduleCondoServer(db, item);
    const subject = `Programacao: ${condo.name || item.condoName || "Condominio"} - ${item.date || ""}`;
    const ics = buildScheduleIcs(db, item, emails, db.settings);
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: emails.join(","),
      subject,
      text: buildScheduleInviteText(db, item),
      icalEvent: { filename: "programacao.ics", method: "REQUEST", content: ics }
    });
    item.calendarInviteSentAt = new Date().toISOString();
    item.calendarInviteUpdatedAt = item.calendarInviteSentAt;
    item.calendarInviteStatus = `Enviado para ${emails.join(", ")}`;
    addActivity(db, user || { name: "Sistema" }, "Enviou Google Agenda", `${condo.name || item.condoName || item.id}: ${emails.join(", ")}`);
    return { sent: true, emails, status: item.calendarInviteStatus };
  } catch (error) {
    item.calendarInviteStatus = `Erro ao enviar agenda: ${error.message}`;
    item.calendarInviteUpdatedAt = new Date().toISOString();
    addActivity(db, user || { name: "Sistema" }, "Falhou Google Agenda", item.calendarInviteStatus);
    return { sent: false, error: error.message, status: item.calendarInviteStatus };
  }
}

function localDeletedKeys(db, incoming) {
  return new Set([...(db.deletedRefs || []), ...((incoming && incoming.deletedRefs) || [])].map((ref) => ref.key).filter(Boolean));
}

function mergeLocalRestore(db, incoming, user) {
  const source = incoming && incoming.data ? incoming.data : incoming || {};
  const deletedKeys = localDeletedKeys(db, source);
  const result = {};
  if (source.settings?.salesSheetUrl && (!db.settings.salesSheetUrl || db.settings.salesSheetUrl === OLD_SALES_SHEET_URL)) {
    db.settings.salesSheetUrl = source.settings.salesSheetUrl;
  }
  for (const collection of LOCAL_RESTORE_COLLECTIONS) {
    const rows = Array.isArray(source[collection]) ? source[collection] : [];
    result[collection] = 0;
    if (collection === "deletedRefs") {
      for (const ref of rows) {
        if (!ref?.key || deletedRefExists(db, ref.key)) continue;
        db.deletedRefs.unshift({ ...ref, id: ref.id || uid() });
        result[collection] += 1;
      }
      db.deletedRefs = db.deletedRefs.slice(0, 5000);
      continue;
    }
    const existingIds = new Set(db[collection].map((item) => item.id).filter(Boolean));
    for (const item of rows) {
      if (!item?.id || existingIds.has(item.id) || deletedKeys.has(`${collection}:id:${item.id}`)) continue;
      if (collection === "weeklySchedules" && isImportedSchedule(item) && deletedKeys.has(scheduleImportDeletedKey(item))) continue;
      db[collection].unshift(item);
      existingIds.add(item.id);
      result[collection] += 1;
    }
  }
  const total = Object.values(result).reduce((sum, value) => sum + value, 0);
  if (total) addActivity(db, user, "Restaurou backup local", `${total} registro(s) recuperado(s) do navegador`);
  return { restored: total, collections: result };
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
    if (deletedRefExists(db, saleExternalDeletedKey(externalKey))) continue;
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

function decodeHtml(value) {
  const text = String(value || "");
  const named = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " "
  };
  return text
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
      const key = entity.toLowerCase();
      if (key[0] === "#") {
        const code = key[1] === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      }
      return named[key] || "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function buildCondoCapacityQuery(condo) {
  return [
    `"${condo.name || condo.condoName || ""}"`,
    condo.city || "",
    condo.neighborhood || "",
    "quantidade de unidades apartamentos casas condomínio"
  ].filter(Boolean).join(" ");
}

async function fetchTextWithTimeout(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 WS-Consultoria-CapacityResearch/1.0",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractDuckDuckGoResults(html) {
  const results = [];
  const blocks = String(html || "").split(/result__body/gi).slice(1, 9);
  for (const block of blocks) {
    const linkMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i) || block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!linkMatch) continue;
    let url = decodeHtml(linkMatch[1]);
    try {
      const parsed = new URL(url, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) url = decodeURIComponent(uddg);
    } catch {
      // keep original URL
    }
    results.push({
      title: stripTags(linkMatch[2]),
      url,
      snippet: stripTags(snippetMatch?.[1] || "")
    });
  }
  return results;
}

function capacityCandidatesFromText(text) {
  const candidates = [];
  const source = String(text || "").replace(/\s+/g, " ");
  const patterns = [
    /(\d{1,4})\s*(?:unidades|apartamentos|apartamento|aptos|apto|casas|resid[eê]ncias|residenciais|lotes)\b/gi,
    /(?:unidades|apartamentos|apartamento|aptos|apto|casas|resid[eê]ncias|lotes)\s*(?:de|com|:)?\s*(\d{1,4})\b/gi,
    /(\d{1,2})\s*torres?.{0,45}?(\d{1,4})\s*(?:unidades|apartamentos|apartamento|aptos|apto)\b/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const numbers = match.slice(1).filter(Boolean).map((item) => Number(item));
      let value = numbers[numbers.length - 1];
      if (numbers.length === 2 && numbers[0] <= 20 && numbers[1] <= 400) value = numbers[0] * numbers[1];
      if (!Number.isFinite(value) || value < 4 || value > 5000) continue;
      const start = Math.max(0, match.index - 90);
      const end = Math.min(source.length, match.index + match[0].length + 90);
      candidates.push({ value, evidence: source.slice(start, end).trim() });
    }
  }
  return candidates;
}

function scoreCapacityCandidate(condo, result, candidate) {
  const haystack = normalizeTextKey([result.title, result.snippet, candidate.evidence].join(" "));
  const condoName = normalizeTextKey(condo.name || condo.condoName || "");
  const city = normalizeTextKey(condo.city || "");
  const neighborhood = normalizeTextKey(condo.neighborhood || "");
  let score = 0;
  if (condoName && haystack.includes(condoName)) score += 5;
  for (const part of condoName.split(" ").filter((part) => part.length > 3)) {
    if (haystack.includes(part)) score += 1;
  }
  if (city && haystack.includes(city)) score += 2;
  if (neighborhood && haystack.includes(neighborhood)) score += 1;
  if (/unidades|apartamentos|aptos|casas|residencias|residências/i.test(candidate.evidence)) score += 3;
  if (/zapimoveis|vivareal|imovelweb|chavesnamao|lopes|olx|quintoandar|wimoveis|sub100|condominio/i.test(String(result.url))) score += 1;
  return score;
}

function confidenceFromScore(score) {
  if (score >= 9) return "Alta";
  if (score >= 6) return "Média";
  return "Baixa";
}

function bestCapacityEvidence(condo, results) {
  let best = null;
  for (const result of results) {
    const candidates = capacityCandidatesFromText([result.title, result.snippet].join(" "));
    for (const candidate of candidates) {
      const score = scoreCapacityCandidate(condo, result, candidate);
      if (!best || score > best.score) {
        best = {
          capacity: candidate.value,
          confidence: confidenceFromScore(score),
          sourceUrl: result.url,
          sourceTitle: result.title,
          evidence: candidate.evidence,
          score
        };
      }
    }
  }
  return best;
}

async function researchSingleCondoCapacity(condo) {
  const query = buildCondoCapacityQuery(condo);
  if (!String(condo.name || condo.condoName || "").trim()) return null;
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchTextWithTimeout(url);
  const results = extractDuckDuckGoResults(html);
  return bestCapacityEvidence(condo, results);
}

function shouldReplaceCapacity(condo, evidence) {
  if (!evidence) return false;
  if (!condo.capacity) return true;
  if (String(condo.capacityStatus || "").toLowerCase() !== "verificada") return true;
  return evidence.confidence === "Alta" && String(condo.capacityConfidence || "") !== "Alta";
}

async function researchCondoCapacities(db, user, options = {}) {
  const manageLock = options.manageLock !== false;
  if (manageLock && capacityResearchRunning) return { running: true, checked: 0, updated: 0, pending: 0, skipped: 0, errors: 0, items: [] };
  if (manageLock) capacityResearchRunning = true;
  const now = new Date().toISOString();
  const limit = Math.max(1, Math.min(Number(options.limit || 300), 300));
  const force = parseBoolean(options.force, false);
  const candidates = db.condos
    .filter((condo) => !condo.deleted)
    .filter((condo) => force || !condo.capacity || String(condo.capacityStatus || "").toLowerCase() !== "verificada")
    .slice(0, limit);
  const result = { checked: 0, updated: 0, pending: 0, skipped: 0, errors: 0, totalEligible: candidates.length, remaining: 0, items: [] };
  try {
    for (const condo of candidates) {
      result.checked += 1;
      try {
        const evidence = await researchSingleCondoCapacity(condo);
        if (evidence && shouldReplaceCapacity(condo, evidence)) {
          condo.capacity = evidence.capacity;
          condo.capacityStatus = "Verificada";
          condo.capacityConfidence = evidence.confidence;
          condo.capacitySource = evidence.sourceUrl;
          condo.capacitySourceTitle = evidence.sourceTitle;
          condo.capacityEvidence = evidence.evidence;
          condo.capacityCheckedAt = now;
          condo.updatedAt = now;
          result.updated += 1;
          result.items.push({ id: condo.id, name: condo.name, capacity: evidence.capacity, confidence: evidence.confidence, source: evidence.sourceUrl });
        } else if (evidence) {
          condo.capacityStatus = condo.capacityStatus || "Verificada";
          condo.capacityConfidence = condo.capacityConfidence || evidence.confidence;
          condo.capacitySource = condo.capacitySource || evidence.sourceUrl;
          condo.capacityEvidence = condo.capacityEvidence || evidence.evidence;
          condo.capacityCheckedAt = now;
          result.skipped += 1;
        } else {
          condo.capacityStatus = condo.capacity ? (condo.capacityStatus || "Não verificada") : "Pendente validação";
          condo.capacityCheckedAt = now;
          result.pending += 1;
        }
      } catch (error) {
        condo.capacityStatus = condo.capacity ? (condo.capacityStatus || "Não verificada") : "Erro na pesquisa";
        condo.capacityCheckedAt = now;
        condo.capacityResearchError = error.message;
        result.errors += 1;
      }
    }
    result.remaining = db.condos.filter((condo) => !condo.capacity || String(condo.capacityStatus || "").toLowerCase() !== "verificada").length;
    db.settings.capacityResearchAt = now;
    db.settings.capacityResearchStatus = `${result.updated} atualizado(s), ${result.pending} pendente(s), ${result.errors} erro(s)`;
    addActivity(db, user || { name: "Sistema" }, "Pesquisou capacidade dos condomínios", db.settings.capacityResearchStatus);
    return result;
  } finally {
    if (manageLock) capacityResearchRunning = false;
  }
}

async function runAutomaticCapacityResearch() {
  const db = ensureShape(readStore());
  const result = await researchCondoCapacities(db, { name: "Sistema" }, { limit: 300 });
  if (!result.running) writeStore(db);
  return result;
}

function queueCapacityResearch(user, options = {}) {
  if (capacityResearchRunning) return { running: true, started: false };
  capacityResearchRunning = true;
  const db = ensureShape(readStore());
  db.settings.capacityResearchAt = new Date().toISOString();
  db.settings.capacityResearchStatus = "Pesquisa de capacidade iniciada em segundo plano";
  writeStore(db);
  setTimeout(async () => {
    try {
      const latest = ensureShape(readStore());
      const result = await researchCondoCapacities(latest, user || { name: "Sistema" }, { ...options, limit: 300, manageLock: false });
      latest.settings.capacityResearchAt = new Date().toISOString();
      latest.settings.capacityResearchStatus = `${result.updated} atualizado(s), ${result.pending} pendente(s), ${result.errors} erro(s)`;
      writeStore(latest);
    } catch (error) {
      const latest = ensureShape(readStore());
      latest.settings.capacityResearchAt = new Date().toISOString();
      latest.settings.capacityResearchStatus = `Erro na pesquisa: ${error.message}`;
      writeStore(latest);
    } finally {
      capacityResearchRunning = false;
    }
  }, 20).unref?.();
  return { running: false, started: true };
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
    return res.end(JSON.stringify({ user: cleanUser(user), settings: cleanSettings(db.settings) }));
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
    return send(res, 200, { user: cleanUser(user), settings: cleanSettings(db.settings) });
  }

  if (url.pathname === "/api/all") {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = ensureShape(readStore());
    return send(res, 200, { ...db, settings: cleanSettings(db.settings), users: db.users.map(cleanUser), system: { storage: storageInfo() } });
  }

  if (url.pathname === "/api/local-restore" && method === "POST") {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await getBody(req);
    const db = ensureShape(readStore());
    const result = mergeLocalRestore(db, body, user);
    if (result.restored) writeStore(db);
    return send(res, 200, result);
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

  if (url.pathname === "/api/condos/research-capacity" && method === "POST") {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await getBody(req);
    if (body?.background) return send(res, 202, queueCapacityResearch(user, body));
    const db = ensureShape(readStore());
    const result = await researchCondoCapacities(db, user, body || {});
    if (!result.running) writeStore(db);
    return send(res, 200, result);
  }

  if (url.pathname === "/api/automation/condo-capacity" && method === "POST") {
    const token = req.headers["x-automation-token"] || url.searchParams.get("token");
    if (!CAPACITY_RESEARCH_TOKEN || token !== CAPACITY_RESEARCH_TOKEN) return send(res, 403, { error: "Token da automacao invalido ou nao configurado." });
    const body = await getBody(req);
    if (body?.background) return send(res, 202, queueCapacityResearch({ name: "Automacao" }, body));
    const db = ensureShape(readStore());
    const result = await researchCondoCapacities(db, { name: "Automacao" }, body || {});
    if (!result.running) writeStore(db);
    return send(res, 200, result);
  }

  const calendarInviteMatch = url.pathname.match(/^\/api\/weeklySchedules\/([^/]+)\/calendar-invite$/);
  if (calendarInviteMatch && method === "POST") {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = ensureShape(readStore());
    const item = db.weeklySchedules.find((schedule) => schedule.id === calendarInviteMatch[1]);
    if (!item) return send(res, 404, { error: "Programacao nao encontrada." });
    const result = await sendScheduleCalendarInvite(db, item, user, true);
    writeStore(db);
    return send(res, 200, result);
  }

  const name = collectionName(url.pathname);
  if (!name) return send(res, 404, { error: "Rota nao encontrada." });
  const user = requireAuth(req, res);
  if (!user) return;
  const db = ensureShape(readStore());

  if (method === "GET") {
    if (name === "settings") return send(res, 200, cleanSettings(db.settings));
    return send(res, 200, name === "users" ? db.users.map(cleanUser) : db[name]);
  }

  if (name === "activities") return send(res, 403, { error: "Historico nao pode ser alterado diretamente." });

  if (method === "POST") {
    const body = await getBody(req);
    if (name === "settings") {
      db.settings = settingsFromBody(db.settings, body);
      addActivity(db, user, "Atualizou configurações", "Dados da empresa e notificações");
      writeStore(db);
      return send(res, 200, cleanSettings(db.settings));
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
    if (name === "weeklySchedules") {
      await sendScheduleCalendarInvite(db, item, user, false);
      writeStore(db);
    }
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
    const removed = db[name].find((item) => item.id === id);
    if (!removed) return send(res, 404, { error: "Registro nao encontrado." });
    db[name] = db[name].filter((item) => item.id !== id);
    addDeletedRef(db, `${name}:id:${id}`, name, removed, user);
    if (name === "sales") addDeletedRef(db, saleExternalDeletedKey(saleImportKey(removed)), name, removed, user);
    if (name === "weeklySchedules" && isImportedSchedule(removed)) addDeletedRef(db, scheduleImportDeletedKey(removed), name, removed, user);
    addActivity(db, user, `Removeu ${name}`, removed.name || removed.title || removed.condoName || removed.customer || id);
    writeStore(db);
    return send(res, 200, { ok: true });
  }

  send(res, 405, { error: "Metodo nao permitido." });
}

ensureStore();
applyVerifiedCapacityUpdates();
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

if (!DISABLE_CAPACITY_AUTO_RESEARCH && CAPACITY_RESEARCH_INTERVAL_MS > 0) {
  setInterval(runAutomaticCapacityResearch, CAPACITY_RESEARCH_INTERVAL_MS).unref();
  setTimeout(runAutomaticCapacityResearch, 15000).unref();
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
