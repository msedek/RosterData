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
  let m = String(t).match(/Combat\s*Power[:\s]*([\d.,]+)/i);
  if (m) return m[1];
  m = String(t).match(/\bCP[:\s]*([\d.,]+)\b/i);
  if (m) return m[1];
  const m2 = String(t).match(/\b(\d{3,4}\.\d{2})\b/);
  return m2 ? m2[1] : "";
}


function parseClass(t) {
  const text = squash(t).toLowerCase();
  
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
  
  // Buscar dinámicamente cualquier clase que aparezca en el texto
  // Lista de clases conocidas de Lost Ark
  const knownClasses = [
    'berserker', 'paladin', 'gunlancer', 'destroyer', 'slayer', 'warlord', 'breaker',
    'bard', 'sorceress', 'arcanist', 'summoner', 'artist', 'aeromancer', 'painter',
    'wardancer', 'scrapper', 'soulfist', 'glaivier', 'striker',
    'deathblade', 'shadowhunter', 'reaper', 'souleeter',
    'sharpshooter', 'deadeye', 'gunslinger', 'machinist', 'scouter'
  ];
  
  // Buscar cada clase en el texto
  for (const className of knownClasses) {
    if (text.includes(className)) {
      return className.charAt(0).toUpperCase() + className.slice(1);
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
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      if (await maybeChallenge(page)) await waitAndReloadAfterChallenge(page);
      await page.waitForTimeout(PROFILE_WAIT_MS);
      const text = await page.evaluate(() => document.body && (document.body.innerText || ""));
      const ilvl = parseIlvl(text);
      const cp = parseCP(text);
      const klass = parseClass(text);
      
      
      await page.close().catch(()=>{});
      
      if (ilvl && cp) return { name: charName, class: klass, ilvl, cp };
    } catch (e) {
      log("WARN char page:", url, e.message);
      try { await page.close(); } catch {}
    }
  }
  return { name: charName, ilvl: "", cp: "" };
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
      if (r.name && r.ilvl && r.cp) rows.push(r);
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

app.get("/:name/roster", async (req, res) => {
  const region = "NAE";
  const { name } = req.params;
  try {
    const csv = await withLock(() => scrapeRoster(region, name));
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
    const csv = await withLock(() => scrapeRoster(region, name));
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
    const csv = await withLock(() => scrapeRoster(region, name));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(csv);
  } catch (e) {
    log("ERROR /:name/raw", e?.message || e);
    res.status(504).type("text/plain").send("No se pudo obtener el roster (timeout o sin datos)");
  }
});

app.get("/:region/:name/raw", async (req, res) => {
  const { region, name } = req.params;
  try {
    const csv = await withLock(() => scrapeRoster(region, name));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
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

