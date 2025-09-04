'use strict';

// ---- tolerante a dependencias opcionales
let ensureMarketsWithOddsAPI;
try {
  const __odds = require('./_lib/oddsapi.cjs');
  ensureMarketsWithOddsAPI = (typeof __odds?.ensureMarketsWithOddsAPI === 'function')
    ? __odds.ensureMarketsWithOddsAPI
    : async () => ({ ok: true, markets_top3: {}, markets: {}, source: 'shim' });
} catch {
  ensureMarketsWithOddsAPI = async () => ({ ok: true, markets_top3: {}, markets: {}, source: 'shim' });
}

// ---- stub seguro para callOpenAIOnce (evita romper si no existe)
(function __wireAI(){
  try {
    const mod = (() => { try { return require('./_lib/ai.cjs'); } catch { return null; } })();
    const impl =
      (mod && typeof mod.callOpenAIOnce === 'function' && mod.callOpenAIOnce) ||
      (mod && typeof mod.callOneShotOpenAI === 'function' && mod.callOneShotOpenAI) ||
      (mod && typeof mod.default === 'function' && mod.default) || null;
    if (typeof global.callOpenAIOnce !== 'function') {
      global.callOpenAIOnce = impl || (async ({ prompt } = {}) => ({
        ok: true,
        content: `[dev-stub] ${String(prompt||'').slice(0,160)}...`
      }));
    }
  } catch {}
})();

// ---- helper de reporte (sin IIFE inline)
function __send_report_base(payload = {}) {
  try {
    const enabled = (String(process.env.SEND_ENABLED) === '1');
    const base = {
      enabled,
      results: Array.isArray(payload?.results) ? payload.results : []
    };
    if (enabled && typeof message_vip  !== 'undefined' && message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id  = true;
    if (enabled && typeof message_free !== 'undefined' && message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
    return base;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

exports.handler = async (event) => {
  // hoist explícito (esbuild-friendly)
  const __send_report = __send_report_base({});

  try {
    const q = (event && event.queryStringParameters) || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || new Date(Date.now() + 60*60*1000).toISOString(),
    };

    // (placeholder) ejemplo mínimo de uso
    const enriched = await ensureMarketsWithOddsAPI({ evt });

    const payload = {
      ok: true,
      msg: 'oneshot-publish stub listo',
      evt,
      enriched
    };

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        send_report: __send_report,
        published: false,
        preview: true,
        payload
      }, null, 2),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        send_report: __send_report,
        published: false,
        preview: false,
        error: String(e && e.message || e)
      }, null, 2),
    };
  }
};
