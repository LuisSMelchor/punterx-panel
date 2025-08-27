'use strict';

const _fetchPony = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({default: f}) => f(...args)));
const { callOpenAIOnce } = require('./ai.cjs');
const https = require('https');
/**
 * Stub de enriquecimiento con OddsAPI (one-shot).
 * No realiza requests; opera sobre `oddsRaw` ya provisto.
 * Normaliza:
 *  - top3 bookies por mercado (ordenado por cuota)
 *  - liga con país (si viene en `fixture`)
 *  - hora relativa "Comienza en X minutos aprox"
 */

function minutesUntil(iso) {
  const t = new Date(iso);
  if (Number.isNaN(+t)) return null;
  const diffMs = t - new Date();
  return Math.round(diffMs / 60000);
}

function pickTop3(offers = []) {
  // offers: [{bookmaker, price, last_update, market, outcome}]
  const sorted = [...offers].sort((a,b) => (b?.price ?? 0) - (a?.price ?? 0));
  return sorted.slice(0, 3);
}

function normalizeMarkets(oddsRaw = {}) {
  // Espera estructura estilo OddsAPI normalizada antes:
  // { markets: { '1x2': [offers...], 'btts': [...], 'over_2_5': [...], ... } }
  const markets = oddsRaw?.markets || {};
  const out = {
}


function attachLeagueCountry(fx = {}) {
  const league = fx?.league_name || fx?.league || null;
  const country = fx?.country || fx?.league_country || fx?.country_name || null;
  return league && country ? `${league} (${country})` : (league || null);
}



async function enrichFixtureUsingOdds({ fixture, oddsRaw }) {
  const _fixture = fixture || {};
  let _odds = oddsRaw;

  // Si no viene oddsRaw y hay clave, intenta traer desde OddsAPI
  if (!_odds && process.env.ODDS_API_KEY) {
    try {
      _odds = await fetchOddsForFixture(_fixture);
    } catch (e) {
      if (Number(process.env.DEBUG_TRACE)) console.log('[ENRICH] fetch odds fail', e?.message || e);
    }
  }

  // Normalización flexible a markets {} y top3
  const marketsFlex = normalizeMarketsFlexible(_odds);
  const markets_top3 = toTop3ByMarket(marketsFlex);

  const mins = minutesUntil(_fixture?.kickoff);
  const when_text = Number.isFinite(mins)
    ? (mins >= 0 ? `Comienza en ${mins} minutos aprox` : `Comenzó hace ${Math.abs(mins)} minutos aprox`)
    : null;

  const league_text = attachLeagueCountry(_fixture);

  // Si no viene oddsRaw y hay clave, intenta traer desde OddsAPI
  if (!_odds && process.env.ODDS_API_KEY) {
    try {
      _odds = await fetchOddsForFixture(_fixture);
    } catch (e) {
      if (Number(process.env.DEBUG_TRACE)) console.log('[ENRICH] fetch odds fail', e?.message || e);
    }
  }

  // fixture esperado (ejemplo):
  // { fixture_id, kickoff, league_id, league_name, country, home_id, away_id, ... }
  const topMarkets = normalizeMarkets(oddsRaw);

  const whenTxt = Number.isFinite(mins) ? (mins >= 0 ? `Comienza en ${mins} minutos aprox`
                                                   : `Comenzó hace ${Math.abs(mins)} minutos aprox`)
                                        : null;

  
  return {
    fixture_id: _fixture?.fixture_id ?? null,
    kickoff: _fixture?.kickoff ?? null,
    when_text,
    league: league_text,
    home_id: _fixture?.home_id ?? null,
    away_id: _fixture?.away_id ?? null,
    markets_top3,
  };
}

module.exports = { enrichFixtureUsingOdds, fetchOddsForFixture, marketKeyCanonical, preferredCanonMarkets, normalizeFromOddsAPIv4, toTop3ByMarket, buildOneShotPayload, oneShotPayload, formatMarketsTop3, composeOneShotPrompt, runOneShotAI, getTop3BookiesForEvent };

function _fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, timeout: Number(process.env.HTTP_TIMEOUT_MS || 6500) },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function _retry(fn, { tries = 3, delayMs = 300 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs)); }
  }
  throw lastErr;
}


function normalizeFromOddsAPIv4(oddsApiArray = []) {
  const out = { markets: {} };
  for (const evt of (Array.isArray(oddsApiArray) ? oddsApiArray : [])) {
    const bms = Array.isArray(evt.bookmakers) ? evt.bookmakers : [];
    for (const bm of bms) {
      const bk = bm?.title || bm?.key || 'Unknown';
      const mkts = Array.isArray(bm.markets) ? bm.markets : [];
      for (const mkt of mkts) {
        const rawKey = mkt?.key || '';
        const canon = marketKeyCanonical(rawKey);
        const outs = Array.isArray(mkt?.outcomes) ? mkt.outcomes : [];
        // 1) Mercado directo (h2h, btts, doublechance)
        if (canon !== 'totals') {
          if (!out.markets[canon]) out.markets[canon] = [];
          for (const o of outs) {
            const price = typeof o?.price === 'number' ? o.price : Number(o?.price);
            if (!Number.isFinite(price)) continue;
            out.markets[canon].push({
              bookmaker: bk,
              price,
              last_update: bm?.last_update || evt?.last_update || null,
              outcome: o?.name || null
            });
          }
        } else {
          // 2) totals → derivar over_2_5 cuando point=2.5 y outcome "Over"
          const point = (typeof mkt?.point === 'number' ? mkt.point : Number(mkt?.point));
          if (Number.isFinite(point) && Math.abs(point - 2.5) < 1e-6) {
            if (!out.markets['over_2_5']) out.markets['over_2_5'] = [];
            for (const o of outs) {
              const name = String(o?.name || '').toLowerCase().trim();
              if (name === 'over') {
                const price = typeof o?.price === 'number' ? o.price : Number(o?.price);
                if (!Number.isFinite(price)) continue;
                out.markets['over_2_5'].push({
                  bookmaker: bk,
                  price,
                  last_update: bm?.last_update || evt?.last_update || null,
                  outcome: 'Over 2.5'
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
}


function normalizeMarketsFlexible(oddsRaw) {
  if (!oddsRaw) return {};
  if (Array.isArray(oddsRaw)) {
    return normalizeFromOddsAPIv4(oddsRaw).markets || {};
  }
  return oddsRaw?.markets || {};
}


function toTop3ByMarket(markets = {}) {
  const allow = new Set(preferredCanonMarkets());
  const out = {
}

;
  for (const [mkt, offers] of Object.entries(markets)) {
    out[mkt] = pickTop3(offers).map(o => ({
      bookie: o.bookmaker,
      price: o.price,
      last_update: o.last_update
    }));
  }
  return out;
}

function marketKeyCanonical(key='') {
  const k = String(key || '').toLowerCase().trim();
  if (k === 'h2h') return '1x2';
  if (k === 'both_teams_to_score' || k === 'btts') return 'btts';
  if (k === 'doublechance' || k === 'double_chance') return 'doublechance';
  if (k === 'totals') return 'totals';
  return k; // por defecto, conserva
}

function preferredCanonMarkets() {
  const raw = process.env.ODDS_MARKETS_CANON || '1x2,btts,over_2_5,doublechance';
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}

function buildOneShotPayload({ evt = {}, match = {}, enriched = {} } = {}) {
  const fx = {
    fixture_id: enriched?.fixture_id ?? match?.fixture_id ?? null,
    league: enriched?.league ?? match?.league_name ?? null,
    kickoff: evt?.commence ?? null,
    when_text: enriched?.when_text ?? null,
    league_id: match?.league_id ?? null,
    home_id: match?.home_id ?? null,
    away_id: match?.away_id ?? null
  };

  // markets_top3 ya normalizados en enriched
  const markets = enriched?.markets_top3 || {};

  // Paquete canónico y compacto
  return {
    fixture: fx,
    markets,
    meta: {
      method: match?.method || 'unknown',
      confidence: match?.confidence ?? null,
      source: 'OddsAPI+AF',
      ts: new Date().toISOString()
    }
  };
}

async function oneShotPayload({ evt, match, fixture }) {
  // Si ya viene enriched desde fuera, respétalo:
  let enriched;
  if (fixture && typeof fixture === 'object') {
    // Asegura que pase por enrichFixtureUsingOdds para obtener markets_top3
    enriched = await enrichFixtureUsingOdds({ fixture });
  } else {
    // fallback minimal: sin fixture no armamos enriched
    enriched = {};
  }
  return buildOneShotPayload({ evt, match, enriched });
}

function formatMarketsTop3(markets = {}) {
  const order = (process.env.ODDS_MARKETS_CANON || '1x2,btts,over_2_5,doublechance')
    .split(',').map(function(x){ return x.trim(); }).filter(Boolean);
  const lines = [];
  for (var idx = 0; idx < order.length; idx++) {
    var key = order[idx];
    var arr = Array.isArray(markets[key]) ? markets[key] : [];
    if (!arr.length) continue;
    var head = (key === '1x2') ? '1X2'
             : (key === 'btts') ? 'Ambos anotan'
             : (key === 'over_2_5') ? 'Más de 2.5 goles'
             : (key === 'doublechance') ? 'Doble oportunidad'
             : key;
    var items = arr.map(function(o){
      var b = (o && o.bookie != null) ? String(o.bookie) : '';
      var p = (o && o.price  != null) ? String(o.price)  : '';
      return b + ': ' + p;
    }).join(' | ');
    lines.push('- ' + head + ': ' + items);
  }
  return lines.join('\n');
}

// --- fin formatMarketsTop3 ---
function composeOneShotPrompt(payload) {
  var fx = (payload && payload.fixture) ? payload.fixture : {};
  var mk = (payload && payload.markets) ? payload.markets : {};
  var meta = (payload && payload.meta) ? payload.meta : {};
  var marketText = formatMarketsTop3(mk) || '- (sin mercados disponibles)';

  var title = '🎯 Genera un único JSON con la recomendación de apuesta';
  var instr = 'Eres un analista de fútbol. Con los datos estructurados y las cuotas disponibles,\n' +
              'genera UNA respuesta en formato JSON. Sé conciso, técnico y claro. No inventes datos.';
  var guard = [
    'Reglas:',
    '- Usa SOLO mercados disponibles en el bloque de "Top 3 por mercado".',
    '- Si no hay datos suficientes, fija "probabilidad_estim" y "ev_estimado" en null y deja "apuestas_extra" [].',
    '- Prioriza mercados con mejor cuota (desempata con robustez de señal: convergencia de bookies/top3).',
    '- "datos_avanzados": máximo 3 oraciones, enfocadas en forma reciente, localía, goles esperados (si inferible por cuotas) y riesgos.',
    '- No agregues notas fuera del JSON. No incluyas disclaimers.'
  ].join('\n');

  var ctx = [
    'Contexto del evento:',
    '- Liga: ' + (fx.league || '(desconocida)'),
    '- Inicio: ' + (fx.when_text || '(desconocido)'),
    '- IDs: fixture=' + (fx.fixture_id != null ? fx.fixture_id : 'n/a') + ', league=' + (fx.league_id != null ? fx.league_id : 'n/a') + ', home=' + (fx.home_id != null ? fx.home_id : 'n/a') + ', away=' + (fx.away_id != null ? fx.away_id : 'n/a'),
    '- Método de match: ' + (meta.method || 'n/a') + ' (conf=' + (meta.confidence != null ? meta.confidence : 'n/a') + ')',
    '',
    'Top 3 por mercado (mejores cuotas):',
    marketText
  ].join('\n');

  var prompt = [title, '', instr, '', guard, '', ctx, '', 'Devuelve SOLO un JSON: { apuesta_sugerida, probabilidad_estim, ev_estimado, apuestas_extra, datos_avanzados }'].join('\n');
  return prompt;
}

module.exports = { enrichFixtureUsingOdds, buildOneShotPayload, oneShotPayload, formatMarketsTop3, composeOneShotPrompt };

}

async function runOneShotAI({ prompt, payload }) {
  // Llama a OpenAI (si hay KEY), valida y calcula EV/clase.
  const out = await callOpenAIOnce({ prompt });
  if (!out || !validateAIJson(out)) {
  // Fallback odds por nombres si no hay markets y tenemos clave
  try {
    const apiKey = process.env.ODDS_API_KEY;
    if (apiKey && (!payload.markets || !Object.keys(payload.markets||{}).length)) {
      const sport = process.env.SPORT_KEY || 'soccer_epl';
      const regions = process.env.ODDS_REGIONS || 'us,eu,uk,au';
      const markets = process.env.ODDS_MARKETS || 'h2h,totals,btts';
      const fb = await oddsFallbackByNames({ sport, regions, markets, apiKey, home: evt.home, away: evt.away, ap_sugerida: null });
      if (fb?.ok && fb.markets) {
        payload.markets = fb.markets;
        payload.meta = payload.meta || {};
        payload.meta.odds_source = 'oddsapi:fallback-names';
        payload.meta.odds_event = fb.event;
      }
    }
  } catch (e) {
    payload.meta = payload.meta || {};
    payload.meta.odds_fallback_error = e?.message || String(e);
  }

    return { ok:false, reason:'invalid-ai-json', raw: out || null };
  }
  // EV principal
  const odds = Number(out?.apuesta_sugerida?.cuota);
  const prob = Number(out?.probabilidad_estim);
  const ev = computeEV(prob, odds);

  // Enriquecer respuesta IA con EV y nivel
  const nivel = classifyByEV(ev);

  // Asegura campos mínimos
  return {
    ok: true,
    result: {
      ...out,
      ev_estimado: (typeof out.ev_estimado === 'number') ? out.ev_estimado : ev,
      nivel
    }
  };
}


/* __EXPORT_FIX_ONESHOT__ */
try {
  // Asegura que existen referencias (no falla si ya están)
  if (typeof oneShotPayload !== 'function') { global.oneShotPayload = oneShotPayload; }
  if (typeof composeOneShotPrompt !== 'function') { global.composeOneShotPrompt = composeOneShotPrompt; }
  if (typeof runOneShotAI !== 'function') { global.runOneShotAI = runOneShotAI; }
  module.exports = {
    ...(module.exports || {}),
    oneShotPayload: (typeof oneShotPayload === 'function') ? oneShotPayload : global.oneShotPayload,
    composeOneShotPrompt: (typeof composeOneShotPrompt === 'function') ? composeOneShotPrompt : global.composeOneShotPrompt,
    runOneShotAI: (typeof runOneShotAI === 'function') ? runOneShotAI : global.runOneShotAI
  };
} catch(_) {}


/* __EXPORTS_CANONICAL__ */
try {
  const __m = (typeof module !== 'undefined' && module.exports) ? module.exports : {};
  module.exports = Object.assign({}, __m, {
    oneShotPayload: (typeof oneShotPayload === 'function') ? oneShotPayload : undefined,
    composeOneShotPrompt: (typeof composeOneShotPrompt === 'function') ? composeOneShotPrompt : undefined,
    runOneShotAI: (typeof runOneShotAI === 'function') ? runOneShotAI : undefined
  });
} catch(_e) {}


/* __ONESHOT_IMPL_V2__ */
function __oneShotPayload2({ evt = {}, match = {}, fixture = {} }) {
  const kickoff = fixture.kickoff || evt.commence || null;
  function minutesUntil(iso){ try{ return Math.round((new Date(iso).getTime() - Date.now())/60000);}catch{return null;} }
  return {
    liga: match.league_name || evt.league || 'N/D',
    pais: match.country || fixture.country || null,
    equipos: {
      local: evt.home || match.home_name || 'Local',
      visita: evt.away || match.away_name || 'Visita',
      home_id: match.home_id || fixture.home_id || null,
      away_id: match.away_id || fixture.away_id || null
    },
    kickoff_iso: kickoff,
    comienza_en_min: kickoff ? minutesUntil(kickoff) : null,
    // Se llenará en pasos siguientes con OddsAPI/API-FOOTBALL
    odds_top3: [],
    markets_raw: null
  };
}

function __composeOneShotPrompt2(payload) {
  const meta = {
    liga: payload.liga,
    pais: payload.pais,
    local: payload.equipos?.local,
    visita: payload.equipos?.visita,
    kickoff_iso: payload.kickoff_iso,
    comienza_en_min: payload.comienza_en_min
  };
  return [
    "Eres un asistente de análisis de fútbol para picks de alto valor.",
    "RESPONDE SOLO con un JSON válido, sin texto extra.",
    "Formato estrictamente requerido:",
    "{",
    '  "apuesta_sugerida": { "mercado": "string", "seleccion": "string", "cuota": number },',
    '  "apuestas_extra": [ { "mercado": "string", "seleccion": "string", "cuota": number } ],',
    '  "probabilidad_estim": number,',
    '  "ev_estimado": number',
    "}",
    "Notas:",
    "- La probabilidad y EV pueden ser estimados con criterio razonable.",
    "- Si no hay valor evidente, sugiere cuota/probabilidad coherentes, nada extremo.",
    "Contexto del partido (solo referencia, no lo repitas):",
    JSON.stringify(meta)
  ].join("\n");
}

// Reasignamos exports canónicamente a nuestras nuevas impls sin romper otros exports
try {
  const __m = (typeof module !== 'undefined' && module.exports) ? module.exports : {};
  module.exports = Object.assign({}, __m, {
    oneShotPayload: __oneShotPayload2,
    composeOneShotPrompt: __composeOneShotPrompt2
    // runOneShotAI se mantiene el existente si ya estaba
  });
} catch(_e) {}



/* __ODDS_TOP3_UTILS__ */
function __norm(x){ return String(x||'').trim().toLowerCase(); }
function __similar(a,b){ a=__norm(a); b=__norm(b); return a && b && (a===b || a.includes(b) || b.includes(a)); }
function __pickGameFromOdds(evt, list=[]) {
  // Busca por nombres y/o fallback por cercanía de fecha si viene commence_time
  const h = __norm(evt.home), a = __norm(evt.away);
  let best = null, bestScore = -1;
  for (const g of list) {
    const th = __norm(g?.home_team), ta = __norm(g?.away_team);
    let score = 0;
    if (__similar(th, h)) score += 1;
    if (__similar(ta, a)) score += 1;
    // bonus por fecha si coincide dia
    try {
      const gd = new Date(g.commence_time).toISOString().slice(0,10);
      const ed = new Date(evt.commence).toISOString().slice(0,10);
      if (gd === ed) score += 0.5;
    } catch {}
    if (score > bestScore) { best = g; bestScore = score; }
  }
  return best;
}

function __extractTop3H2H(game) {
  // Toma mercado 'h2h' y calcula el mejor precio por bookie (home/away/draw), luego ordena desc y toma top3
  const out = [];
  const books = game?.bookmakers || [];
  for (const b of books) {
    const m = (b?.markets || []).find(m => m?.key === 'h2h');
    if (!m || !Array.isArray(m.outcomes)) continue;
    const best = m.outcomes.reduce((mx, o) => (typeof o.price === 'number' && o.price > mx ? o.price : mx), -Infinity);
    if (best > 0 && Number.isFinite(best)) out.push({ name: b.title || b.key || 'book', odds: best });
  }
  out.sort((x,y)=> y.odds - x.odds);
  return out.slice(0,3);
}




/* __GET_TOP3_PUBLIC__ */
async function getTop3BookiesForEvent(evt = {}) {
  try {
    if (!process.env.ODDS_API_KEY) return [];
    const list = await fetchOddsForFixture(evt); // usa helper existente
    if (!Array.isArray(list) || !list.length) return [];
    const game = __pickGameFromOdds(evt, list);
    if (!game) return [];
    return __extractTop3H2H(game);
  } catch (e) {
    if (Number(process.env.DEBUG_TRACE)) console.log('[ODDS][top3] error', e?.message || e);
    return [];
  }
}



async function oddsFallbackByNames({ sport, regions, markets, apiKey, home, away, ap_sugerida }) {
  // filtra mercados bulk a soportados por /odds
  const supportedBulk = ['h2h','totals','spreads'];
  const bulkMarkets = String(markets||'h2h,totals')
    .split(',')
    .map(x=>x.trim())
    .filter(x => supportedBulk.includes(x))
    .join(',');

  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?regions=${regions}&markets=${bulkMarkets}&oddsFormat=decimal&dateFormat=iso&apiKey=${apiKey}`;
  const r = await _fetchPony(url);
  if (!r.ok) return { ok:false, status:r.status, text: await r.text().catch(()=>null) };
  const arr = await r.json().catch(()=>null);
  if (!Array.isArray(arr) || !arr.length) return { ok:false, reason:'no-events' };

  const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const H = norm(home), A = norm(away);

  // scoring simple por nombres
  function score(ev) {
    const h = norm(ev.home_team), a = norm(ev.away_team);
    let sc = 0;
    if (h && H && h.includes(H)) sc += 2;
    if (a && A && a.includes(A)) sc += 2;
    // bonus por orden home/away
    if (h && H && h.startsWith(H)) sc += 1;
    if (a && A && a.startsWith(A)) sc += 1;
    return sc;
  }

  let best = null, bestScore = -1;
  for (const ev of arr) {
    const sc = score(ev);
    if (sc > bestScore) { best = ev; bestScore = sc; }
  }
  if (!best) return { ok:false, reason:'no-best-match' };

  // Agregamos marketsMap (enfocado en H2H para la selección sugerida)
  const marketsMap = {};
  const apSel = ap_sugerida?.seleccion ? norm(ap_sugerida.seleccion) : null;

  // Recorre bookmakers/markets del evento elegido
  for (const bm of (best.bookmakers || [])) {
    const book = bm.title || bm.key || 'book';
    for (const mk of (bm.markets || [])) {
      const key = (mk.key || '').toLowerCase(); // h2h/totals/spreads
      if (!['h2h','totals','spreads'].includes(key)) continue;

      // outcomes: lista con { name, price, point? }
      for (const out of (mk.outcomes || [])) {
        const label = norm(out.name || '');
        const price = Number(out.price);
        if (!Number.isFinite(price)) continue;

        // Para h2h, si hay selección, preferimos outcomes que matcheen la selección (Chelsea / Arsenal)
        if (key === 'h2h' && apSel) {
          // si la selección menciona explícitamente al home o al away, intenta matchear
          const matchSel =
              (H && apSel.includes(H) && label.includes(norm(best.home_team))) ||
              (A && apSel.includes(A) && label.includes(norm(best.away_team))) ||
              // fallback: si la selección contiene el label textual del outcome
              apSel.includes(label);

          if (!matchSel) continue;
        }

        marketsMap[key] = marketsMap[key] || [];
        marketsMap[key].push({ book, price, label: out.name || null });
      }
    }
  }

  // ordena cada mercado por mejor cuota descendente y deja topN recorte para no inflar
  for (const k of Object.keys(marketsMap)) {
    marketsMap[k] = marketsMap[k]
      .sort((a,b)=> (b.price||0) - (a.price||0))
      .slice(0, 20);
  }

  return { ok:true, event: { id: best.id, commence: best.commence_time }, markets: marketsMap };
}




async function _oddsFindEventByNames({ sport, apiKey, home, away }) {
  const url = 'https://api.the-odds-api.com/v4/sports/' + sport + '/events?apiKey=' + apiKey;
  const r = await _fetchPony(url);
  if (!r.ok) return { ok:false, status:r.status, text: await r.text().catch(()=>null) };
  const arr = await r.json().catch(()=>[]);
  if (!Array.isArray(arr) || !arr.length) return { ok:false, reason:'no-events' };

  const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const H = norm(home), A = norm(away);

  // solo aceptamos eventos que contengan AMBOS equipos (en cualquier orden)
  let exact = null;
  for (const ev of arr) {
    const h = norm(ev.home_team), a = norm(ev.away_team);
    const dir1 = h.includes(H) && a.includes(A);
    const dir2 = h.includes(A) && a.includes(H);
    if (dir1 || dir2) {
      exact = ev;
      break; // primer match exacto
    }
  }
  if (!exact) return { ok:false, reason:'no-exact-both-names' };

  return {
    ok: true,
    event: {
      id: exact.id,
      home: exact.home_team,
      away: exact.away_team,
      commence: exact.commence_time
    }
  };
}


async function _oddsEventOdds({ sport, eventId, regions, markets, apiKey }) {
  const supported = ['h2h','totals','spreads'];
  const bulk = String(markets||'h2h,totals').split(',').map(x=>x.trim()).filter(x=>supported.includes(x)).join(',');
  const url = 'https://api.the-odds-api.com/v4/sports/' + sport + '/events/' + eventId +
              '/odds?regions=' + encodeURIComponent(regions) +
              '&markets=' + encodeURIComponent(bulk) +
              '&oddsFormat=decimal&apiKey=' + apiKey;
  const r = await _fetchPony(url);
  if (!r.ok) return { ok:false, status:r.status, text: await r.text().catch(()=>null) };
  const obj = await r.json().catch(()=>null);
  if (!obj || !Array.isArray(obj.bookmakers)) return { ok:false, reason:'no-bookmakers' };

  const agg = {};
  for (const bm of obj.bookmakers||[]) {
    for (const m of bm.markets||[]) {
      if (!agg[m.key]) agg[m.key] = [];
      for (const out of m.outcomes||[]) {
        if (m.key === 'h2h') {
          agg[m.key].push({ book: bm.title || bm.key || 'book', price: out.price, label: out.name });
        } else if (m.key === 'totals') {
          const lbl = (out.name ? out.name : '') + ' ' + (out.point != null ? out.point : '');
          agg[m.key].push({ book: bm.title || bm.key || 'book', price: out.price, label: lbl.trim() });
        } else {
          agg[m.key].push({ book: bm.title || bm.key || 'book', price: out.price });
        }
      }
    }
  }
  return { ok:true, markets: agg, event: { id: obj.id } };
}
