'use strict';
let send_report = null, send_report2 = null, send_report3 = null;
try { ({ send_report, send_report2, send_report3 } = require('./_lib/meta.cjs')); } catch (_) {}
if (typeof send_report !== 'function')  { send_report  = () => ({ enabled:false, results:[] }); }
if (typeof send_report2 !== 'function') { send_report2 = send_report; }
if (typeof send_report3 !== 'function') { send_report3 = send_report; }

let ensureEnrichDefaults, setEnrichStatus;
try { ({ ensureEnrichDefaults, setEnrichStatus } = require('./_lib/meta.cjs')); } catch (_) { /* no-op en dev */ }






/*__AI_DEV_STUB__*/
/*__AI_CALL_GETTER__*/
function __getCallAI(){
  try { if (typeof callOpenAIOnce === 'function') return callOpenAIOnce; } catch {}
  try { if (typeof global.callOpenAIOnce === 'function') return global.callOpenAIOnce; } catch {}
  // fallback ultra-seguro (no cae en ai_unavailable)
  return async ({ prompt } = {}) => ({ ok: true, content: `[fallback] ${String(prompt||'').slice(0,160)}...` });
}

(function __wireAI(){ 
  try {
    // intenta cargar implementación local si existe
    const mod = (()=>{ try { return require('./_lib/ai.cjs'); } catch(_) { return null; }})();
    const impl =
      (mod && typeof mod.callOpenAIOnce === 'function' && mod.callOpenAIOnce) ||
      (mod && typeof mod.callOneShotOpenAI === 'function' && mod.callOneShotOpenAI) ||
      (mod && typeof mod.default === 'function' && mod.default) || null;

    if (typeof global.callOpenAIOnce !== 'function') {
      if (impl) {
        global.callOpenAIOnce = impl;
      } else {
        // stub dev para no romper el flujo
        global.callOpenAIOnce = async ({ prompt } = {}) => ({
          ok: true,
          content: `[dev-stub] ${String(prompt||'').slice(0,160)}...`,
        });
      }
    }
  } catch {}
})();

/*__ENSURE_MARKETS_GETTER__*/
function __getEnsureMarkets() {
  try { if (typeof global.ensureMarketsWithOddsAPI === 'function') return global.ensureMarketsWithOddsAPI; } catch {}
  try { if (typeof ensureMarketsWithOddsAPI === 'function') return ensureMarketsWithOddsAPI; } catch {}
  return async (_args = {}) => ({ ok: true, markets_top3: {}, markets: {}, source: 'shim-fallback' });
}

/*__ODDSAPI_TOLERANT__*/
let __odds = {};
try { __odds = require('./_lib/oddsapi.cjs'); } catch (_) {}

// Preferir implementación real si existe; si no, no-op que permite continuar:
const ensureMarketsWithOddsAPI =
  (typeof (__odds && __odds.ensureMarketsWithOddsAPI) === 'function' && __odds.ensureMarketsWithOddsAPI) ||
  (async (_args = {}) => ({ ok: true, markets_top3: {}, markets: {}, source: 'shim' }));

try { if (typeof global.ensureMarketsWithOddsAPI !== 'function') global.ensureMarketsWithOddsAPI = ensureMarketsWithOddsAPI; } catch {}

/*__SEND_REPORT_HOIST_V2__*/
function __send_report_base(payload = {}) {
  try {
    if (typeof global.send_report === 'function') {
      return global.send_report(payload);
    }
    return { ok: true, results: [] };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
if (typeof global.send_report !== 'function') {
  function send_report(payload = {}) { return __send_report_base(payload); }
  try { global.send_report = send_report; } catch {}
}
/* removed: send_report2 local dup */
/* removed: send_report3 local dup */
try { global.send_report2 = send_report2; global.send_report3 = send_report3; } catch {}

/*__AI_ALIAS_TOLERANT__*/
let __ai = {};
try { __ai = require('./_lib/ai.cjs'); } catch (_) {}


try { if (typeof global.callOpenAIOnce === 'undefined') global.callOpenAIOnce = callOpenAIOnce; } catch {}

const enrich = require('./_lib/enrich.cjs');
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');

const buildOneShot = enrich.oneShotPayload || enrich.buildOneShotPayload;

async function publishToTelegram(payload) {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_VIP_ID || process.env.TELEGRAM_CHANNEL_ID;
  if (!bot || !chatId) return { ok: false, reason: 'missing_telegram_env' };

  const liga = payload?.league || payload?.enriched?.league || '-';
  const kickoff = payload?.evt?.commence || payload?.enriched?.kickoff || '-';
  const home = payload?.evt?.home || '-';
  const away = payload?.evt?.away || '-';
  const when = payload?.when_text || payload?.enriched?.when_text || null;

  const text = [
    '🎯 *One-Shot Preview*',
    `*Liga:* ${liga}`,
    `*Partido:* ${home} vs ${away}`,
    `*Kickoff:* ${kickoff}`,
    when ? `*Cuando:* ${when}` : null,
  ].filter(Boolean).join('\n');

  const url = `https://api.telegram.org/bot${bot}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const json = await res.json().catch(() => ({}));
  return { ok: Boolean(json?.ok), response: json };
}

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || new Date(Date.now() + 60*60*1000).toISOString(),
    };

    let match = {};
    try { match = await resolveTeamsAndLeague(evt, {}); }
    catch (e) { match = { ok: false, method: 'none', reason: 'resolver_error', error: e?.message }; }

    const fixture = {
      fixture_id: match?.fixture_id ?? null,
      kickoff: evt.commence,
      league_id: match?.league_id ?? null,
      league_name: match?.league_name ?? evt.league,
      country: match?.country ?? null,
      home_id: match?.home_id ?? null,
      away_id: match?.away_id ?? null,
    };

    const enriched = await enrich.enrichFixtureUsingOdds({ fixture });
    const payload = await buildOneShot({ evt, match, enriched });

    // No publicar si no hay datos mínimos
    const hasMinData = Boolean((payload?.league || payload?.enriched?.league) && (payload?.evt?.commence || payload?.enriched?.kickoff));
    const canPublish = !!(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_VIP_ID || process.env.TELEGRAM_CHANNEL_ID));
    if (!hasMinData || !canPublish || match?.ok === false) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        const __send_report = (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})();
      body: JSON.stringify({ send_report: __send_report, published: false,
          preview: true,
          reason: !canPublish ? 'missing_telegram_env' : (!hasMinData ? 'insufficient_payload' : (match?.ok === false ? 'match_not_resolved' : 'preview')),
          payload
         }, null, 2),
      };
    }

    const pub = await publishToTelegram(payload);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
published: pub.ok, preview: false, payload, publish_result: pub }, null, 2),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
error: e?.message || String(e) }),
    };
  }
};
