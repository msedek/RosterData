const express = require("express");
const fs = require("fs");
const path = require("path");
let firefox, chromium;
try { ({ firefox } = require("playwright")); } catch {}
try { ({ chromium } = require("playwright")); } catch {}

const app = express();
const PORT = process.env.PORT || 3000;

const APP_DIR = process.cwd();
const DEBUG_DIR = path.join(APP_DIR, "debug");
const STORAGE = path.join(APP_DIR, "storage.json");
fs.mkdirSync(DEBUG_DIR, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), "-", ...a);

// ====== Config rápida de performance ======
const STATS_CONCURRENCY = 3;        // cuántas páginas de personaje en paralelo
const ROSTER_WAIT_MS = 400;         // espera breve en roster
const PROFILE_WAIT_MS = 350;        // espera breve en cada perfil
// ==========================================

// ====== Sistema de Caché Inteligente ======
const PRIORITY_CHARACTERS = [
  "Jesseigh",
  "Mselancer", 
  "Kadub",
  "Rathofdemise",
  "Temran",
  "Aelvjin",
  "Saleco"
];

const CACHE_REFRESH_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas = 4 veces al día
const CACHE_EXPIRY_TIME = 7 * 60 * 60 * 1000; // 7 horas de expiración

let cache = new Map(); // { "region:name": { data, timestamp, isUpdating } }
let refreshTimer = null;

// Función para limpiar caché expirado
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_EXPIRY_TIME) {
      cache.delete(key);
      log("Cache expirado eliminado:", key);
    }
  }
}

// Función para verificar si un personaje es prioritario
function isPriorityCharacter(name) {
  return PRIORITY_CHARACTERS.some(char => 
    char.toLowerCase() === name.toLowerCase()
  );
}

// Función para actualizar caché de un personaje específico
async function updateCharacterCache(region, name) {
  const cacheKey = `${region}:${name}`;
  
  // Evitar múltiples actualizaciones simultáneas
  if (cache.has(cacheKey) && cache.get(cacheKey).isUpdating) {
    log("Ya se está actualizando:", cacheKey);
    return;
  }
  
  try {
    log("Actualizando caché para:", cacheKey);
    cache.set(cacheKey, { 
      data: null, 
      timestamp: Date.now(), 
      isUpdating: true 
    });
    
    const csv = await scrapeRoster(region, name);
    cache.set(cacheKey, { 
      data: csv, 
      timestamp: Date.now(), 
      isUpdating: false 
    });
    
    log("Caché actualizado exitosamente:", cacheKey);
  } catch (error) {
    log("Error actualizando caché:", cacheKey, error.message);
    cache.set(cacheKey, { 
      data: null, 
      timestamp: Date.now(), 
      isUpdating: false 
    });
  }
}

// Función para actualizar todos los personajes prioritarios
async function refreshPriorityCache() {
  log("Iniciando actualización de caché prioritario...");
  const region = "NAE";
  
  // Actualizar todos los personajes prioritarios en paralelo
  const updatePromises = PRIORITY_CHARACTERS.map(name => 
    updateCharacterCache(region, name)
  );
  
  await Promise.allSettled(updatePromises);
  log("Actualización de caché prioritario completada");
}

// Función para obtener datos del caché o actualizar si es necesario
async function getCachedRoster(region, name) {
  const cacheKey = `${region}:${name}`;
  const now = Date.now();
  
  // Si es un personaje prioritario, verificar caché
  if (isPriorityCharacter(name)) {
    const cached = cache.get(cacheKey);
    
    if (cached && cached.data && !cached.isUpdating) {
      const age = now - cached.timestamp;
      
      // Si el caché es muy viejo, actualizar en background
      if (age > CACHE_REFRESH_INTERVAL) {
        log("Caché viejo detectado, actualizando en background:", cacheKey);
        updateCharacterCache(region, name).catch(e => 
          log("Error en actualización background:", e.message)
        );
      }
      
      // Devolver datos del caché inmediatamente
      log("Sirviendo desde caché:", cacheKey, `(edad: ${Math.round(age/1000/60)}min)`);
      return cached.data;
    }
    
    // Si no hay caché o está actualizándose, hacer scraping directo
    log("No hay caché disponible, haciendo scraping directo:", cacheKey);
    return await scrapeRoster(region, name);
  }
  
  // Para personajes no prioritarios, hacer scraping directo
  return await scrapeRoster(region, name);
}

// Inicializar sistema de caché
async function initializeCache() {
  log("Inicializando sistema de caché...");
  
  // Actualizar caché inicial de personajes prioritarios
  await refreshPriorityCache();
  
  // Configurar actualización automática cada 6 horas
  refreshTimer = setInterval(async () => {
    try {
      await refreshPriorityCache();
      cleanExpiredCache();
    } catch (error) {
      log("Error en actualización automática de caché:", error.message);
    }
  }, CACHE_REFRESH_INTERVAL);
  
  // Limpiar caché expirado cada hora
  setInterval(cleanExpiredCache, 60 * 60 * 1000);
  
  log("Sistema de caché inicializado correctamente");
}
// ==========================================

// ---------- util ----------
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const toCsvRow = (fields) =>
  fields
    .map((v) => {
      const s = squash(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    })
    .join(",");

function parseIlvl(t) {
  const m = String(t).match(
    /(?:^|\b)i?tem?\s*level[:\s]*([0-9]{3,4}(?:\.[0-9]{2})?)|(?:^|\b)i?lvl[:\s]*([0-9]{3,4}(?:\.[0-9]{2})?)/i
  );
  return m ? (m[1] || m[2]) : "";
}
function parseCP(t) {
  // Buscar patrones más específicos primero
  let m = String(t).match(/Combat\s*Power[:\s]*([\d.,]+)/i);
  if (m) return m[1];
  m = String(t).match(/\bCP[:\s]*([\d.,]+)\b/i);
  if (m) return m[1];
  
  // Buscar números que parezcan combat power (formato típico: 1892.38, 2714.14, etc.)
  const m2 = String(t).match(/\b(\d{3,4}\.\d{2})\b/);
  if (m2) {
    const cp = parseFloat(m2[1]);
    // Combat power típicamente está entre 1000-5000
    if (cp >= 1000 && cp <= 5000) {
      return m2[1];
    }
  }
  return "";
}


function parseClass(t) {
  // NO usar squash() porque destruye la estructura de líneas que necesito
  const text = t.toLowerCase();
  
  
  // Buscar patrones específicos de clase del personaje
  const classPatterns = [
    /class[:\s]*([a-z]+)/i,
    /character[:\s]*class[:\s]*([a-z]+)/i,
    /job[:\s]*([a-z]+)/i,
    /character[:\s]*type[:\s]*([a-z]+)/i
  ];
  
  // Buscar patrones específicos y devolver la clase encontrada
  for (const pattern of classPatterns) {
    const match = text.match(pattern);
    if (match) {
      const foundClass = match[1];
      return foundClass.charAt(0).toUpperCase() + foundClass.slice(1);
    }
  }
  
  // Buscar la estructura específica: [servidor] [línea_vacía] [clase] [línea_vacía] [nombre_personaje]
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 4; i++) {
    const currentLine = lines[i].trim();
    const nextLine = lines[i + 1].trim();
    const afterNextLine = lines[i + 2].trim();
    const afterAfterNextLine = lines[i + 3].trim();
    const afterAfterAfterNextLine = lines[i + 4].trim();
    
    // Buscar cualquier línea que parezca un servidor (no contiene números, no es muy larga, no es una clase conocida, no es una región)
    const knownClasses = ['berserker', 'paladin', 'gunlancer', 'destroyer', 'slayer', 'breaker',
                         'bard', 'sorceress', 'arcanist', 'summoner', 'artist', 'aeromancer', 'valkyrie',
                         'wardancer', 'scrapper', 'soulfist', 'glaivier', 'striker',
                         'deathblade', 'shadowhunter', 'reaper', 'souleeter',
                         'sharpshooter', 'deadeye', 'gunslinger', 'machinist'];
    
    const knownRegions = ['north america east', 'north america west', 'europe central', 'europe west', 'south america'];
    
    const isServerLine = currentLine && 
                        currentLine.length > 2 && 
                        currentLine.length < 20 && 
                        !/\d/.test(currentLine) && 
                        !knownClasses.includes(currentLine.toLowerCase()) &&
                        !knownRegions.includes(currentLine.toLowerCase()) &&
                        !currentLine.includes('http') &&
                        !currentLine.includes('href') &&
                        !currentLine.includes('link') &&
                        !currentLine.includes('america') &&
                        !currentLine.includes('europe');
    
    
    if (isServerLine) {
      // Buscar la estructura: servidor -> línea vacía -> clase -> línea vacía -> nombre
      if (!nextLine && afterNextLine && afterNextLine.length >= 3 && 
          afterNextLine.length <= 20 && /^[a-z]+$/i.test(afterNextLine) &&
          !afterAfterNextLine && afterAfterAfterNextLine && 
          afterAfterAfterNextLine.length > 3) {
        return afterNextLine.charAt(0).toUpperCase() + afterNextLine.slice(1);
      }
    }
  }
  
  return ""; // No devolver nada si no encuentra la clase específica
}

async function maybeChallenge(page) {
  try {
    const html = await page.content();
    return /cdn-cgi\/challenge-platform|Just a moment/i.test(html);
  } catch { return false; }
}
async function waitAndReloadAfterChallenge(page) {
  await page.waitForTimeout(6000);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
}

// ---------- navegador único + contexto único (con fallback) ----------
let browser, ctx, engine = "firefox";

async function pickBrowser() {
  if (firefox) { engine = "firefox"; return firefox; }
  if (chromium) { engine = "chromium"; return chromium; }
  throw new Error("No se pudo cargar playwright para firefox ni chromium");
}

// bloquea recursos pesados/analytics
async function installRequestBlocking(context) {
  await context.route("**/*", async (route, request) => {
    const t = request.resourceType();
    const url = request.url();
    if (
      t === "image" || t === "stylesheet" || t === "font" || t === "media" ||
      url.includes("google-analytics") || url.includes("googletagmanager") || url.includes("gtag/js")
    ) {
      return route.abort();
    }
    return route.continue();
  });
}

async function getContext() {
  if (ctx) return ctx;
  const pw = await pickBrowser();

  let storageState;
  try {
    if (fs.existsSync(STORAGE)) storageState = JSON.parse(fs.readFileSync(STORAGE, "utf8"));
  } catch (e) { log("WARN storageState:", e.message); }

  log("Launching browser:", engine);
  browser = await pw.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  ctx = await browser.newContext({
    storageState,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  });
  await installRequestBlocking(ctx);
  log("Browser ready:", engine);
  return ctx;
}

async function persistCookies() {
  try {
    const state = await ctx.storageState();
    fs.writeFileSync(STORAGE, JSON.stringify(state));
  } catch (e) { log("WARN persistCookies:", e.message); }
}

// ---------- mutex simple (concurrencia 1 para el *scrape* entero) ----------
let mutex = Promise.resolve();
function withLock(fn) {
  const run = async () => { try { return await fn(); } finally {} };
  const p = mutex.then(run, run);
  mutex = p.catch(() => {});
  return p;
}

// ---------- scraping ----------
async function getRosterNames(context, region, name) {
  const url = `https://uwuowo.mathi.moe/character/${encodeURIComponent(region)}/${encodeURIComponent(name)}/roster`;
  const page = await context.newPage();
  log("GET roster names:", url);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (await maybeChallenge(page)) await waitAndReloadAfterChallenge(page);
    await page.waitForTimeout(ROSTER_WAIT_MS);

    const anchors = await page.$$eval('a[href*="/character/"]', els =>
      els.map(a => a.getAttribute("href") || "")
    );
    const seen = new Set();
    const out = [];
    for (const h of anchors) {
      if (!/\/character\/[^/]+\/[^/]+/.test(h || "")) continue;
      try {
        const u = new URL(h, "https://uwuowo.mathi.moe");
        const p = u.pathname.split("/").filter(Boolean);
        const i = p.indexOf("character");
        if (i >= 0 && p[i + 2]) {
          const nm = decodeURIComponent(p[i + 2]);
          if (nm && !seen.has(nm)) { seen.add(nm); out.push(nm); }
        }
      } catch {}
    }
    log("Roster names found:", out.length);
    return out;
  } finally {
    await page.close().catch(()=>{});
  }
}

async function getCharStats(context, region, charName) {
  const base = `https://uwuowo.mathi.moe/character/${encodeURIComponent(region)}/${encodeURIComponent(charName)}`;
  const urls = [base, `${base}/profile`, `${base}/overview`];

  for (const url of urls) {
    const page = await context.newPage();
    try {
      log("GET char stats:", url);
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      if (await maybeChallenge(page)) await waitAndReloadAfterChallenge(page);
      await page.waitForTimeout(PROFILE_WAIT_MS * 2);
      const text = await page.evaluate(() => document.body && (document.body.innerText || ""));
      const ilvl = parseIlvl(text);
      const cp = parseCP(text);
      const klass = parseClass(text);
      
      
      await page.close().catch(()=>{});
      
      // Si tenemos al menos ilvl o cp, devolver los datos
      if (ilvl || cp) return { name: charName, class: klass, ilvl: ilvl || "", cp: cp || "" };
    } catch (e) {
      log("WARN char page:", url, e.message);
      try { await page.close(); } catch {}
      
      // Si es un error de red, esperar un poco y reintentar
      if (e.message.includes("NS_ERROR_NET_EMPTY_RESPONSE") || e.message.includes("net::ERR_")) {
        log("Network error detected, waiting before retry:", charName);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  // Si llegamos aquí, intentar una vez más con más tiempo de espera
  log("Retrying with longer timeout for:", charName);
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (await maybeChallenge(page)) await waitAndReloadAfterChallenge(page);
    await page.waitForTimeout(PROFILE_WAIT_MS * 2);
    const text = await page.evaluate(() => document.body && (document.body.innerText || ""));
    const ilvl = parseIlvl(text);
    const cp = parseCP(text);
    const klass = parseClass(text);
    
    await page.close().catch(()=>{});
    return { name: charName, class: klass, ilvl: ilvl || "", cp: cp || "" };
  } catch (e) {
    log("Final retry failed for:", charName, e.message);
    try { await page.close(); } catch {}
    return { name: charName, class: "", ilvl: "", cp: "" };
  }
}

async function scrapeRoster(region, name) {
  const context = await getContext();
  const names = await getRosterNames(context, region, name);

  // Pool de concurrencia para stats
  const rows = [];
  let idx = 0;
  async function worker() {
    while (idx < names.length) {
      const myIndex = idx++;
      const nm = names[myIndex];
      const r = await getCharStats(context, region, nm);
      if (r.name) rows.push(r);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(STATS_CONCURRENCY, names.length)) }, worker);
  await Promise.all(workers);

  await persistCookies();
  if (!rows.length) throw new Error("EMPTY");

  rows.sort((a, b) => parseFloat(b.ilvl) - parseFloat(a.ilvl));
  const csv = ["Name,Class,iLvl,CombatPower"]
    .concat(rows.map((r) => toCsvRow([r.name, r.class || "", r.ilvl, r.cp])))
    .join("\n");
  return csv;
}

// ---------- rutas ----------
app.get("/health", (_, res) => res.type("text/plain").send("OK"));

// Endpoint para obtener información del caché
app.get("/cache/status", (_, res) => {
  const status = {
    priorityCharacters: PRIORITY_CHARACTERS,
    cacheSize: cache.size,
    cacheEntries: Array.from(cache.entries()).map(([key, value]) => ({
      key,
      hasData: !!value.data,
      age: Math.round((Date.now() - value.timestamp) / 1000 / 60), // minutos
      isUpdating: value.isUpdating,
      dataSize: value.data ? value.data.length : 0
    })),
    refreshInterval: CACHE_REFRESH_INTERVAL / 1000 / 60, // minutos
    nextRefresh: refreshTimer ? "Programado" : "No programado",
    serverUptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  };
  res.json(status);
});

// Endpoint para obtener estadísticas de rendimiento
app.get("/stats", (_, res) => {
  const stats = {
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform
    },
    cache: {
      size: cache.size,
      priorityCharacters: PRIORITY_CHARACTERS,
      refreshInterval: CACHE_REFRESH_INTERVAL / 1000 / 60,
      entries: Array.from(cache.entries()).map(([key, value]) => ({
        character: key,
        hasData: !!value.data,
        age: Math.round((Date.now() - value.timestamp) / 1000 / 60),
        isUpdating: value.isUpdating
      }))
    },
    performance: {
      statsConcurrency: STATS_CONCURRENCY,
      rosterWaitMs: ROSTER_WAIT_MS,
      profileWaitMs: PROFILE_WAIT_MS
    }
  };
  res.json(stats);
});

// Endpoint para forzar actualización de caché de un personaje específico
app.post("/cache/refresh/:name", async (req, res) => {
  const region = "NAE";
  const { name } = req.params;
  
  if (!isPriorityCharacter(name)) {
    return res.status(400).json({ 
      error: "Solo se puede actualizar caché de personajes prioritarios",
      priorityCharacters: PRIORITY_CHARACTERS 
    });
  }
  
  try {
    await updateCharacterCache(region, name);
    res.json({ 
      success: true, 
      message: `Caché actualizado para ${name}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: "Error actualizando caché", 
      message: error.message 
    });
  }
});

// Endpoint para forzar actualización de todo el caché prioritario
app.post("/cache/refresh-all", async (req, res) => {
  try {
    await refreshPriorityCache();
    res.json({ 
      success: true, 
      message: "Caché prioritario actualizado completamente",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: "Error actualizando caché", 
      message: error.message 
    });
  }
});

app.get("/:name/roster", async (req, res) => {
  const region = "NAE";
  const { name } = req.params;
  try {
    const csv = await withLock(() => getCachedRoster(region, name));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${region}_${name}_roster.csv"`);
    res.send(csv);
  } catch (e) {
    log("ERROR /:name/roster", e?.message || e);
    res.status(504).type("text/plain").send("No se pudo obtener el roster (timeout o sin datos)");
  }
});

app.get("/:region/:name/roster", async (req, res) => {
  const { region, name } = req.params;
  try {
    const csv = await withLock(() => getCachedRoster(region, name));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${region}_${name}_roster.csv"`);
    res.send(csv);
  } catch (e) {
    log("ERROR /:region/:name/roster", e?.message || e);
    res.status(504).type("text/plain").send("No se pudo obtener el roster (timeout o sin datos)");
  }
});

(async () => {
  try {
    await getContext();
    log("Playwright ready with", engine);
    
    // Inicializar sistema de caché después de que el navegador esté listo
    await initializeCache();
  } catch (e) {
    console.error("FATAL init:", e);
    process.exit(1);
  }
})();

// --- endpoints "raw" para Google Sheets (sin Content-Disposition) ---
app.get("/:name/raw", async (req, res) => {
  const region = "NAE";
  const { name } = req.params;
  try {
    const csv = await withLock(() => getCachedRoster(region, name));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    
    // Para personajes prioritarios, usar caché con headers optimizados
    if (isPriorityCharacter(name)) {
      res.setHeader("Cache-Control", "public, max-age=300"); // 5 minutos de caché en el cliente
      res.setHeader("X-Cache-Status", "HIT"); // Indicar que viene del caché
    } else {
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Cache-Status", "MISS");
    }
    
    res.send(csv);
  } catch (e) {
    log("ERROR /:name/raw", e?.message || e);
    res.status(504).type("text/plain").send("No se pudo obtener el roster (timeout o sin datos)");
  }
});

app.get("/:region/:name/raw", async (req, res) => {
  const { region, name } = req.params;
  try {
    const csv = await withLock(() => getCachedRoster(region, name));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    
    // Para personajes prioritarios, usar caché con headers optimizados
    if (isPriorityCharacter(name)) {
      res.setHeader("Cache-Control", "public, max-age=300"); // 5 minutos de caché en el cliente
      res.setHeader("X-Cache-Status", "HIT"); // Indicar que viene del caché
    } else {
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Cache-Status", "MISS");
    }
    
    res.send(csv);
  } catch (e) {
    log("ERROR /:region/:name/raw", e?.message || e);
    res.status(504).type("text/plain").send("No se pudo obtener el roster (timeout o sin datos)");
  }
});
// --- fin patch raw ---
app.listen(PORT, () => log(`Roster CSV server on http://127.0.0.1:${PORT}`));

process.on("SIGINT", async () => { try { await browser?.close(); } finally { process.exit(0); } });
process.on("SIGTERM", async () => { try { await browser?.close(); } finally { process.exit(0); } });

