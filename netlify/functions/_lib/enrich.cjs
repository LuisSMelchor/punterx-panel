'use strict';
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



}


/* ===== ensure exports (idempotent) ===== */
try {
  if (typeof module !== 'undefined') {
    module.exports = module.exports || {};
    if (typeof fetchOddsForFixture === 'function' && !module.exports.fetchOddsForFixture) module.exports.fetchOddsForFixture = fetchOddsForFixture;
    if (typeof enrichFixtureUsingOdds === 'function' && !module.exports.enrichFixtureUsingOdds) module.exports.enrichFixtureUsingOdds = enrichFixtureUsingOdds;
    if (typeof buildOneShotPayload === 'function' && !module.exports.buildOneShotPayload) module.exports.buildOneShotPayload = buildOneShotPayload;
    if (typeof oneShotPayload === 'function' && !module.exports.oneShotPayload) module.exports.oneShotPayload = oneShotPayload;
    if (typeof formatMarketsTop3 === 'function' && !module.exports.formatMarketsTop3) module.exports.formatMarketsTop3 = formatMarketsTop3;
    if (typeof composeOneShotPrompt === 'function' && !module.exports.composeOneShotPrompt) module.exports.composeOneShotPrompt = composeOneShotPrompt;
  }
} catch {}
/* ===== end ensure exports ===== */



console.log('[ENRICH_LOAD_OK]');
/* ===== unified exports (idempotent) ===== */
try {
  if (typeof module !== 'undefined') {
    module.exports = module.exports || {};
    if (typeof fetchOddsForFixture === 'function') module.exports.fetchOddsForFixture = fetchOddsForFixture;
    if (typeof enrichFixtureUsingOdds === 'function') module.exports.enrichFixtureUsingOdds = enrichFixtureUsingOdds;
    if (typeof buildOneShotPayload === 'function') module.exports.buildOneShotPayload = buildOneShotPayload;
    if (typeof oneShotPayload === 'function') module.exports.oneShotPayload = oneShotPayload;
    if (typeof formatMarketsTop3 === 'function') module.exports.formatMarketsTop3 = formatMarketsTop3;
    if (typeof composeOneShotPrompt === 'function') module.exports.composeOneShotPrompt = composeOneShotPrompt;
  }
} catch {}
/* ===== end unified exports ===== */

