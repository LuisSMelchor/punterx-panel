'use strict';
var send_report = null, send_report2 = null, send_report3 = null;
try { ({ send_report, send_report2, send_report3 } = require('./_lib/meta.cjs')); } catch (_){}
if (typeof send_report !== 'function')  send_report  = () => ({ enabled:false, results:[] });
if (typeof send_report2 !== 'function') send_report2 = send_report;
if (typeof send_report3 !== 'function') send_report3 = send_report;


function ensureEnrichDefaults(meta){
  const m = (meta && typeof meta==='object') ? meta : {};
  if (!('enrich_attempt' in m)) m.enrich_attempt = 'oddsapi:events';
  if (!('odds_source'    in m)) m.odds_source    = 'oddsapi:events';
  if (!('enrich_status'  in m)) m.enrich_status  = 'ok';
  return m;
}

function computeTopMeta(payload){
  const base = (payload && typeof payload==='object' && payload.meta && typeof payload.meta==='object') ? payload.meta : {};
  return __getENRICH_ON() ? Object.assign({ enrich_attempt:'oddsapi:events', odds_source:'oddsapi:events', enrich_status:'ok' }, base) : base;
}

function __getENRICH_ON(){ return String(process.env.ODDS_ENRICH_ONESHOT || process.env.ENRICH_ONESHOT || process.env.ODDS_ENRICH || '') === '1'; }
const enrich = require('./_lib/enrich.cjs');
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');

// Alias seguro: si no hay oneShotPayload, usa buildOneShotPayload
const buildOneShot = enrich.oneShotPayload || enrich.buildOneShotPayload;

exports.handler = async (event) => {
  const __send_report = (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  return base;
})();
try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || new Date(Date.now() + 60*60*1000).toISOString(),
    };

    // 1) Resolver AF (opcional; no debe bloquear enriquecimiento)
    let match = {};
    try {
      match = await resolveTeamsAndLeague(evt, {});
    } catch (e) {
      match = { ok: false, method: 'none', reason: 'resolver_error', error: e?.message };
    }

    // 2) Determinar kickoff (preferir AF si lo trae; si no, el evt.commence)
    const kickoff =
      match?.kickoff ||
      match?.fixture?.date ||
      evt.commence;

    // 3) Armar fixture mínimo con los campos que el enriquecedor espera
    const fixture = {
      fixture_id: match?.fixture_id ?? null,
      kickoff,
      league_name: evt.league,     // ¡IMPORTANTE!
      country: null,
      home_name: evt.home,         // ¡IMPORTANTE!
      away_name: evt.away,         // ¡IMPORTANTE!
      home_id: match?.homeId ?? null,
      away_id: match?.awayId ?? null,
    };

    // 4) Enriquecer con Odds (aunque AF no haya resuelto)
    let enriched = {};
    try {
      enriched = await enrich.enrichFixtureUsingOdds({ fixture });
    } catch (e) {
      enriched = { error: e?.message || String(e) };
    }

    // 5) Payload/Preview
    const payload = {
      status: 'preview',
      level: 'info',
      evt,
      match,
      enriched,
      markets: {}, // reservado si luego quieres incluir markets_raw
      when_text: enriched?.when_text ?? null,
      league: enriched?.league ?? null,
      result_trace: `oneshot-${Math.random().toString(36).slice(2, 9)}`,
    };

    
/*__PATCH_ENSURE_META__*/ if (__getENRICH_ON()) { try { payload.meta = ensureEnrichDefaults(payload && payload.meta); } catch(_) {} }
// (Opcional) si tienes un formateador:
    try {
      if (typeof buildOneShot === 'function') {
        // no se publica aquí, sólo generamos el objeto listo
        Object.assign(payload, buildOneShot({ evt, match, enriched }));
      }
    } catch (_) {}

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload, null, 2),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ _send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof _send_report !== 'undefined' && _send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  return base;
})(),
meta: (typeof payload !== 'undefined' && payload && payload.meta) ? payload.meta : undefined,
error: e?.message || String(e) }),
    };
  }
};
