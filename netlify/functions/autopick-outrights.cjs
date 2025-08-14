// netlify/functions/autopick-outrights.cjs
// PunterX — Autopicks Outrights (Futuros)
// - Filtra deportes con has_outrights=true (OddsAPI v4 /sports)
// - Pide odds de outrights con markets=outrights por deporte soportado
// - Analiza con GPT-5 -> prob. estimada (5–85%), calcula EV
// - Clasifica (FREE/VIP), envía a Telegram, guarda en Supabase (singleton)
// - Anti-duplicado por torneo (outrights)
// - Respeta MAX_OAI_CALLS_PER_CYCLE, Top-3 bookies, gap de prob. ≤ 15 p.p.
// - Node 20

/* =========================
 *  BLINDAJE DE RUNTIME
 * ========================= */
try {
  if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
  }
} catch (_) {}

try {
  process.on('uncaughtException', (e) => {
    try { console.error('[UNCAUGHT]', e && (e.stack || e.message || e)); } catch {}
  });
  process.on('unhandledRejection', (e) => {
    try { console.error('[UNHANDLED]', e && (e.stack || e.message || e)); } catch {}
  });
} catch (_) {}

/* =========================
 *  IMPORTS & ENV
 * ========================= */
const getSupabase = require('./_supabase-client.cjs');
const { readFileSync } = require('fs');
const path = require('path');

const {
  ODDS_API_KEY,
  ODDS_REGIONS = 'us,uk,eu',
  ODDS_BOOKMAKERS, // opcional: lista csv de bookies permitidos
  OPENAI_API_KEY,
  SUPABASE_URL, SUPABASE_KEY,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TELEGRAM_GROUP_ID,
  TZ = 'America/Toronto',
  MAX_OAI_CALLS_PER_CYCLE = '18', // valor seguro por defecto
  SOFT_TIMEOUT_MS = '70000'       // corte blando de ciclo ~70s
} = process.env;

const MAX_OAI = Math.max(0, Number(MAX_OAI_CALLS_PER_CYCLE) || 0);
const SOFT_TIMEOUT = Math.max(30000, Number(SOFT_TIMEOUT_MS) || 70000);

const OPENAI_MODEL = 'gpt-5'; // placeholder; usa tu alias real si lo tienes mapeado
const PROMPTS_FILE = path.join(process.cwd(), 'prompts_punterx.md');

/* =========================
 *  HELPERS
 * ========================= */
const nowISO = () => new Date().toISOString();
const ms = (t0) => Date.now() - t0;

function impliedProbFromDecimal(decimalOdds) {
  const d = Number(decimalOdds);
  if (!Number.isFinite(d) || d <= 1.0) return null;
  return 100 / d; // en %
}
function evPercent(probEstPct, decimalOdds) {
  const p = Number(probEstPct) / 100;
  const d = Number(decimalOdds);
  if (!Number.isFinite(p) || !Number.isFinite(d) || p <= 0 || p >= 1 || d <= 1) return null;
  // EV% = (p * (d - 1) - (1 - p)) * 100
  return ((p * (d - 1)) - (1 - p)) * 100;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function within(n, lo, hi) { return n >= lo && n <= hi; }

function pickVIPLevel(ev) {
  if (ev >= 40) return '🟣 Ultra Élite';
  if (ev >= 30) return '🎯 Élite Mundial';
  if (ev >= 20) return '🥈 Avanzado';
  if (ev >= 15) return '🥉 Competitivo';
  if (ev >= 10) return 'FREE';
  return 'DESCARTAR';
}

// pequeño fetch con timeout
async function fetchWithTimeout(url, opts = {}) {
  const { timeout = 8000, ...rest } = opts;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const id = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, timeout);
  try {
    const signal = ctrl ? ctrl.signal : undefined;
    return await fetch(url, { ...rest, signal });
  } finally { clearTimeout(id); }
}

// Lee el markdown de prompts (si existe)
function loadPrompts() {
  try { return readFileSync(PROMPTS_FILE, 'utf8'); }
  catch { return ''; }
}

/* =========================
 *  ODDSAPI — V4
 * ========================= */
// Documentación v4: /sports -> has_outrights para filtrar y luego /odds con markets=outrights
// https://the-odds-api.com/liveapi/guides/v4/ (has_outrights, markets=outrights)

async function listSportsWithOutrights() {
  if (!ODDS_API_KEY) return { ok: false, error: 'ODDS_API_KEY ausente' };
  const url = `https://api.the-odds-api.com/v4/sports?apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
  const res = await fetchWithTimeout(url, { timeout: 8000 });
  if (!res.ok) {
    const text = await res.text().catch(()=>String(res.status));
    return { ok: false, error: `HTTP ${res.status} /sports — ${text}` };
  }
  const js = await res.json().catch(()=>null);
  if (!Array.isArray(js)) return { ok: false, error: 'Respuesta /sports inesperada' };
  const supported = js.filter(s => s && s.active && s.has_outrights === true);
  return { ok: true, sports: supported };
}

// Pide odds markets=outrights por sport.key filtrando opcionalmente bookies
async function fetchOutrightsForSport(sportKey) {
  const q = new URLSearchParams();
  q.set('apiKey', ODDS_API_KEY);
  q.set('regions', ODDS_REGIONS);
  q.set('markets', 'outrights'); // clave correcta de mercado
  q.set('oddsFormat', 'decimal');
  if (ODDS_BOOKMAKERS) q.set('bookmakers', ODDS_BOOKMAKERS);

  const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds/?${q.toString()}`;
  const res = await fetchWithTimeout(url, { timeout: 9000 });
  // La API devuelve 422 cuando se usa mercado no soportado para el deporte
  if (res.status === 422) {
    const text = await res.text().catch(()=> '422');
    return { ok: true, events: [], warn: `422 INVALID_MARKET_COMBO para ${sportKey}: ${text}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(()=>String(res.status));
    return { ok: false, error: `HTTP ${res.status} /odds — ${text}` };
  }
  const js = await res.json().catch(()=>null);
  if (!Array.isArray(js)) return { ok: false, error: 'Respuesta /odds inesperada' };
  return { ok: true, events: js };
}

/* =========================
 *  GPT-5 — Análisis probabilístico
 * ========================= */
async function analyzeOutrightWithGPT({ sport_key, sport_title, outright_title, outcomes, contextExtras }) {
  if (!OPENAI_API_KEY) return { ok: false, error: 'OPENAI_API_KEY ausente' };

  const { OpenAI } = require('openai');
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  const promptMD = loadPrompts();
  const system = `Eres un analista experto en apuestas de outrights (futuros). 
Devuelve un JSON compacto con: 
{ "no_pick": boolean, "motivo"?: string, "probabilidades": [{ "nombre": string, "p": number(%) }], "comentario_breve": string }
- Las probabilidades deben estar entre 5 y 85%.
- Elige como máximo 1-2 favoritos con racional breve.
- Si no hay edge o la info es pobre, establece "no_pick": true.`;

  const user = [
    `Deporte: ${sport_title || sport_key}`,
    `Mercado: OUTRIGHTS (futuro)`,
    `Título/Torneo: ${outright_title}`,
    `Candidatos (top precios por bookie):`,
    ...outcomes.map(o => `- ${o.name}: mejor cuota ${o.best_decimal} en ${o.best_bookie}`),
    contextExtras ? `Contexto extra: ${contextExtras}` : ''
  ].filter(Boolean).join('\n');

  try {
    const resp = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system + '\n\n' + (promptMD || '') },
        { role: 'user', content: user }
      ]
    });
    const txt = resp.choices?.[0]?.message?.content?.trim() || '';
    let js = null;
    try { js = JSON.parse(txt); } catch {
      // tolera JSON en bloque: intenta extraer
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { try { js = JSON.parse(m[0]); } catch {} }
    }
    if (!js || typeof js !== 'object') return { ok: false, error: 'JSON IA inválido', raw: txt };
    return { ok: true, data: js };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/* =========================
 *  SELECCIÓN & EV
 * ========================= */
function top3BookiesForOutcomes(bookmakers) {
  // bookmakers[] -> markets[] (key="outrights") -> outcomes[{name, price}]
  // Elegimos mejores cuotas por outcome y armamos Top 3 por orden descendente de cuota
  const map = new Map(); // name -> { best_decimal, best_bookie, bookies: [{bk, price}] }
  for (const bk of (bookmakers || [])) {
    const m = (bk.markets || []).find(m => m && m.key === 'outrights');
    if (!m) continue;
    for (const oc of (m.outcomes || [])) {
      const dec = Number(oc.price);
      if (!Number.isFinite(dec) || dec <= 1) continue;
      const name = String(oc.name || '').trim();
      const curr = map.get(name) || { name, best_decimal: dec, best_bookie: bk.title || bk.key, bookies: [] };
      curr.bookies.push({ bookie: bk.title || bk.key, decimal: dec });
      if (dec > curr.best_decimal) {
        curr.best_decimal = dec;
        curr.best_bookie = bk.title || bk.key;
      }
      map.set(name, curr);
    }
  }
  // arma Top-3 global por mejor precio
  const arr = Array.from(map.values()).sort((a,b) => b.best_decimal - a.best_decimal);
  // top3 "globales" cambia por outcome, pero para el mensaje VIP pedimos top3 del outcome elegido
  return arr;
}

function computeEVAndValidate({ probIA_pct, best_decimal, implied_pct }) {
  if (!within(probIA_pct, 5, 85)) return { ok: false, reason: 'prob IA fuera de 5–85%' };
  const ev = evPercent(probIA_pct, best_decimal);
  if (ev == null) return { ok: false, reason: 'EV inválido' };
  if (ev < 10) return { ok: false, reason: 'EV < 10%' };
  const gap = Math.abs(probIA_pct - implied_pct);
  if (gap > 15) return { ok: false, reason: 'gap > 15 p.p.' };
  return { ok: true, ev };
}

/* =========================
 *  SUPABASE & PERSISTENCIA
 * ========================= */
async function supa() {
  try { return await getSupabase(); }
  catch (e) { console.error('[SUPABASE] shim error:', e?.message || e); return null; }
}

async function existsOutrightKey(key) {
  const sb = await supa();
  if (!sb) return false;
  const { data, error } = await sb
    .from('picks_historicos')
    .select('id')
    .eq('tipo', 'outright')
    .eq('evento_key', key)
    .limit(1);
  if (error) { console.error('[Supa existsOutrightKey]', error.message); return false; }
  return Array.isArray(data) && data.length > 0;
}

async function savePick(row) {
  const sb = await supa();
  if (!sb) return { ok: false, error: 'Supabase no disponible' };
  const { data, error } = await sb.from('picks_historicos').insert([row]).select('id').limit(1);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.[0]?.id };
}

/* =========================
 *  TELEGRAM (opcional / hook)
 * ========================= */
async function sendTelegram({ tipo, text }) {
  try {
    if (!TELEGRAM_BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN ausente' };
    const chatId = (tipo === 'vip') ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
    if (!chatId) return { ok: false, error: 'Chat ID ausente' };
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    const res = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 7000
    });
    const js = await res.json().catch(()=>null);
    if (!js?.ok) return { ok: false, error: (js?.description || `HTTP ${res.status}`) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/* =========================
 *  MENSAJES (Canal / VIP)
 * ========================= */
function renderFreeMsg({ pais, liga, titulo, comentario, mins }) {
  return [
    '📡 <b>RADAR DE VALOR</b>',
    `${pais ? pais+' • ' : ''}${liga || 'Outrights'}`,
    `⏱️ Comienza en ~${mins} min`,
    '',
    comentario || 'Oportunidad de valor detectada.',
    '',
    '💬 Únete al VIP para picks premium con datos pro.'
  ].join('\n');
}

function renderVIPMsg({ nivel, pais, liga, titulo, ev, prob, apuesta, extras, top3, clima, arbitro, lesiones, historial, xg }) {
  const top3txt = (top3 || []).map((t,i)=>`${i+1}. ${t.bookie}: ${t.decimal}`).join('\n');
  return [
    `🎯 <b>PICK ${nivel}</b>`,
    `${pais ? pais+' • ' : ''}${liga || 'Outrights'}`,
    `🎯 Mercado: <b>${titulo}</b>`,
    '',
    `EV: <b>${ev.toFixed(2)}%</b> · Prob. IA: <b>${prob.toFixed(1)}%</b>`,
    `Apuesta sugerida: <b>${apuesta}</b>`,
    '',
    'Apuestas extra:',
    ...(extras && extras.length ? extras : ['—']),
    '',
    'Top 3 bookies:',
    top3txt || '—',
    '',
    'Datos avanzados:',
    `• Clima: ${clima || 'n/a'}`,
    `• Árbitro: ${arbitro || 'n/a'}`,
    `• Lesiones: ${lesiones || 'n/a'}`,
    `• Historial: ${historial || 'n/a'}`,
    `• xG: ${xg || 'n/a'}`,
    '',
    '⚠️ Juego responsable.'
  ].join('\n');
}

/* =========================
 *  CICLO OUTRIGHTS
 * ========================= */
async function runOutrightsCycle() {
  const t0 = Date.now();
  const resumen = {
    recibidos: 0, candidatos: 0, procesados: 0,
    descartados_ev: 0, enviados_vip: 0, enviados_free: 0,
    guardados_ok: 0, guardados_fail: 0, oai_calls: 0, warns: []
  };

  // 1) Lista de deportes con has_outrights=true
  const sports = await listSportsWithOutrights();
  if (!sports.ok) throw new Error(sports.error || 'No sports');
  const list = sports.sports || [];
  if (!list.length) return { ok: true, resumen, took_ms: ms(t0), note: 'sin deportes con outrights' };

  // 2) Recorre deportes y pide odds markets=outrights
  for (const s of list) {
    if (Date.now() - t0 > SOFT_TIMEOUT) { resumen.warns.push('soft-timeout'); break; }

    const got = await fetchOutrightsForSport(s.key);
    if (!got.ok) {
      resumen.warns.push(got.error);
      continue;
    }
    if (got.warn) resumen.warns.push(got.warn);

    for (const ev of (got.events || [])) {
      resumen.recibidos++;
      const bookmakers = ev.bookmakers || [];
      if (!bookmakers.length) continue;

      // Construye ranking de outcomes por mejor cuota
      const outcomesRank = top3BookiesForOutcomes(bookmakers);
      if (!outcomesRank.length) continue;

      // Tomamos TOP-N candidatos con mejor precio (ej. 3)
      const candidates = outcomesRank.slice(0, 3);
      resumen.candidatos += candidates.length;

      // Arma título/tournament a partir del evento (outrights no siempre traen home/away)
      const sport_key = ev.sport_key || s.key;
      const sport_title = ev.sport_title || s.title || s.group || 'Outrights';
      const outright_title = ev.sport_title || s.title || 'Ganador del torneo';
      const commence = ev.commence_time ? new Date(ev.commence_time) : null;
      const mins = commence ? Math.max(0, Math.floor((commence.getTime() - Date.now())/60000)) : '—';

      // 3) Analiza con GPT (máximo MAX_OAI por ciclo)
      if (MAX_OAI && resumen.oai_calls >= MAX_OAI) break;

      const ia = await analyzeOutrightWithGPT({
        sport_key, sport_title,
        outright_title,
        outcomes: candidates,
        contextExtras: null
      });

      if (!ia.ok) {
        resumen.warns.push(`IA: ${ia.error || 'fail'}`);
        continue;
      }
      resumen.oai_calls++;

      const data = ia.data || {};
      if (data.no_pick === true) {
        // Corta flujo para este evento si la IA no ve edge
        continue;
      }

      // Esperamos probabilidades [{nombre, p}]
      const probs = Array.isArray(data.probabilidades) ? data.probabilidades : [];
      if (!probs.length) continue;

      // Empareja outcome elegido (el mayor EV) con prob IA
      let mejor = null;
      for (const pr of probs) {
        const name = String(pr.nombre || '').trim();
        const match = candidates.find(c => c.name === name);
        if (!match) continue;

        const implied = impliedProbFromDecimal(match.best_decimal);
        if (implied == null) continue;

        const check = computeEVAndValidate({ probIA_pct: Number(pr.p), best_decimal: match.best_decimal, implied_pct: implied });
        if (!check.ok) { resumen.descartados_ev++; continue; }

        const evpct = check.ev;
        if (!mejor || evpct > mejor.evpct) {
          // Prepara Top-3 del outcome específico
          const top3 = (match.bookies || []).sort((a,b)=> b.decimal - a.decimal).slice(0,3);
          mejor = {
            name,
            best_decimal: match.best_decimal,
            best_bookie: match.best_bookie,
            implied_pct: implied,
            probIA_pct: clamp(Number(pr.p), 5, 85),
            evpct,
            top3
          };
        }
      }

      if (!mejor) continue;

      // 4) Clasificación y anti-duplicado por torneo
      const nivel = pickVIPLevel(mejor.evpct);
      if (nivel === 'DESCARTAR') { resumen.descartados_ev++; continue; }

      const evento_key = `${sport_key}::${outright_title}`; // clave de torneo
      if (await existsOutrightKey(evento_key)) {
        // ya guardado — skip
        continue;
      }

      // 5) Persistencia
      const row = {
        created_at: nowISO(),
        timestamp: nowISO(),
        tipo: 'outright',
        pais: s.group || null,
        liga: outright_title || sport_title || s.title || null,
        evento_key,
        apuesta: `${mejor.name} ganador`,
        probabilidad_estim: Number(mejor.probIA_pct.toFixed(2)),
        prob_implicita: Number(mejor.implied_pct.toFixed(2)),
        ev: Number(mejor.evpct.toFixed(2)),
        nivel: nivel,
        canal: (nivel === 'FREE' ? 'free' : 'vip'),
        top_bookies: (mejor.top3 || []).map(t => ({ bookie: t.bookie, decimal: t.decimal })),
        mejor_cuota: { bookie: mejor.best_bookie, decimal: mejor.best_decimal },
        comentario_ia: String(data.comentario_breve || '').slice(0, 280),
        resultado: 'pendiente',
      };

      const saved = await savePick(row);
      if (saved.ok) resumen.guardados_ok++; else resumen.guardados_fail++;

      // 6) Envío a Telegram
      try {
        const baseMsg = (nivel === 'FREE')
          ? renderFreeMsg({ pais: s.group, liga: outright_title, titulo: outright_title, comentario: row.comentario_ia, mins })
          : renderVIPMsg({
              nivel,
              pais: s.group,
              liga: outright_title,
              titulo: outright_title,
              ev: row.ev,
              prob: row.probabilidad_estim,
              apuesta: row.apuesta,
              extras: ['Doble oportunidad (n/a en outrights)', 'Marcador exacto (no aplica)'],
              top3: row.top_bookies
            });

        const tipo = (nivel === 'FREE') ? 'free' : 'vip';
        const sent = await sendTelegram({ tipo, text: baseMsg });
        if (sent.ok) {
          if (tipo === 'free') resumen.enviados_free++; else resumen.enviados_vip++;
        }
      } catch (e) {
        resumen.warns.push(`TG ${e?.message || e}`);
      }

      resumen.procesados++;
      if (MAX_OAI && resumen.oai_calls >= MAX_OAI) break;
      if (Date.now() - t0 > SOFT_TIMEOUT) { resumen.warns.push('soft-timeout'); break; }
    }
  }

  return { ok: true, took_ms: ms(t0), resumen };
}

/* =========================
 *  HANDLER
 * ========================= */
exports.handler = async (event) => {
  try {
    // Ping / JSON / limit debug
    const asJSON = !!((event.queryStringParameters || {}).json);
    const t0 = Date.now();

    // Validaciones de entorno mínimas
    if (!ODDS_API_KEY) throw new Error('ODDS_API_KEY ausente');
    if (!SUPABASE_URL || !SUPABASE_KEY) console.warn('[WARN] SUPABASE_URL/KEY faltan — no se podrá guardar.');

    const out = await runOutrightsCycle();
    const body = {
      ok: out.ok,
      at: nowISO(),
      took_ms: out.took_ms,
      resumen: out.resumen
    };

    if (asJSON) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: out.ok
        ? `Outrights OK — recibidos=${out.resumen.recibidos}, candidatos=${out.resumen.candidatos}, proc=${out.resumen.procesados}, VIP=${out.resumen.enviados_vip}, FREE=${out.resumen.enviados_free}, oai_calls=${out.resumen.oai_calls}, ms=${out.took_ms}${out.resumen.warns.length ? ' | warns: ' + out.resumen.warns.join(' ; ') : ''}`
        : `Outrights ERROR`
    };
  } catch (e) {
    const msg = e?.message || String(e);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error: msg }) };
  }
};
