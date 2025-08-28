'use strict';

const { oneShotPayload, composeOneShotPrompt, ensureMarketsWithOddsAPI } = require('./_lib/enrich.cjs');
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');
const { callOpenAIOnce } = require('./_lib/ai.cjs');
let sendTelegramText = null;
try {
  // opcional: solo si existe el helper
  ({ sendTelegramText } = require('./_lib/tx.cjs'));
} catch {}

function safeExtractFirstJson(text='') {
  try { return JSON.parse(text); } catch {}
  const s = String(text);
  let depth = 0, start = -1;
  for (let i=0;i<s.length;i++){
    const ch = s[i];
    if (ch === '{') { if (depth===0) start=i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth===0 && start>=0) {
        const cand = s.slice(start,i+1);
        try { return JSON.parse(cand); } catch {}
        start = -1;
      }
    }
  }
  return null;
}

function isFiniteNum(n){ return typeof n==='number' && Number.isFinite(n); }

// EV% = ((prob/100) * odds - 1) * 100
function calcEV(probPct, odds) {
  if (!isFiniteNum(probPct) || !isFiniteNum(odds) || odds <= 1) return null;
  const ev = ((probPct/100)*odds - 1) * 100;
  return Math.round(ev * 10) / 10; // 1 decimal
}

function minutesFromNow(iso) {
  const t = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.round(t/60000));
}
function fmtComienzaEn(iso) {
  const m = minutesFromNow(iso);
  return `Comienza en ${m} minutos aprox`;
}

// Normaliza string: minúsculas, sin tildes, solo [a-z0-9 ]
function _normStr(x) {
  return String(x||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}

// Mapea nombres ES/variantes → claves oddsapi
function marketKeyFromName(name) {
  const n = _normStr(name);
  if (!n) return null;

  // H2H / Resultado Final / 1X2 / Moneyline
  if (/(^| )resultado( final)?($| )|(^| )1x2($| )|(^| )moneyline($| )|(^| )ganador($| )|(^| )h ?2 ?h($| )/.test(n)) return 'h2h';

  // Totales / Más-Menos / Over-Under / Goles
  if (/(^| )(total(es)?|mas\/?menos|mas menos|over|under|o\/u|goles)($| )/.test(n)) return 'totals';

  // Ambos marcan / BTTS
  if (/(^| )(ambos equipos marcan|ambos marcan|btts)($| )/.test(n)) return 'btts';

  return null;
}

function top3FromMarkets(markets, chosen, apS) {
  if (!markets || typeof markets !== "object") return null;

  // 1) Resolver clave de mercado: chosen (mapeado) -> h2h -> totals -> spreads -> primer key
  let mkey = null;
  if (chosen) {
    try {
      const cand = marketKeyFromName(chosen);
      if (cand && Array.isArray(markets[cand]) && markets[cand].length) mkey = cand;
    } catch {}
  }
  if (!mkey) {
    for (const k of ["h2h","totals","spreads"]) {
      if (Array.isArray(markets[k]) && markets[k].length) { mkey = k; break; }
    }
  }
  if (!mkey) {
    const keys = Object.keys(markets||{});
    if (keys.length && Array.isArray(markets[keys[0]]) && markets[keys[0]].length) mkey = keys[0];
  }
  if (!mkey) return null;

  // 2) Copia y, si hay labels + selección IA, prioriza outcomes que machéan la selección
  let arr = (markets[mkey] || []).slice();
  const norm = (x) => String(x||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const sel = apS && apS.seleccion ? norm(apS.seleccion) : null;
  if (sel && arr.length && Object.prototype.hasOwnProperty.call(arr[0]||{}, "label")) {
    const withSel = arr.filter(x => sel.includes(norm(x.label)));
    const withoutSel = arr.filter(x => !sel.includes(norm(x.label)));
    arr = withSel.concat(withoutSel);
  }

  // 3) Ordenar por mejor cuota y tomar Top 3
  arr = arr.sort((a,b)=>(Number(b.price)||0)-(Number(a.price)||0)).slice(0,3);
  if (!arr.length) return null;

  const lines = arr.map((x,i)=>{
    const label = x && x.label ? " (" + x.label + ")" : "";
    return (i+1) + ". " + (x.book||"book") + " — " + (x.price||"-") + label;
  }).join("\n");
  return lines;
}

function classifyByEV(ev) {
  if (!isFiniteNum(ev)) return 'N/A';
  if (ev >= 40) return 'Ultra Elite';
  if (ev >= 30) return 'Élite Mundial';
  if (ev >= 20) return 'Avanzado';
  if (ev >= 15) return 'Competitivo';
  if (ev >= 10) return 'Informativo';
  return 'Descartado';
}

function buildMessages({liga, pais, home, away, kickoff_iso, ev, prob, nivel, markets, ap_sugerida, apuestas_extra, includeBookiesInFree=false}) {
  const ligaStr = pais ? `${liga} (${pais})` : liga;
  const horaStr = fmtComienzaEn(kickoff_iso);
  const bookies = top3FromMarkets(markets, ap_sugerida?.mercado, ap_sugerida);

  // Frase IA breve
  const sel = ap_sugerida?.seleccion ? String(ap_sugerida.seleccion) : '';
  const cuo = (ap_sugerida?.cuota != null) ? `${ap_sugerida.cuota}` : '—';
  const evStrBrief = (Number.isFinite(ev) ? `${ev}%` : '—');
  const probStrBrief = (Number.isFinite(prob) ? `${prob}%` : '—');
  const iaTagline = sel ? `${sel} @ ${cuo} | EV ${evStrBrief} | P(${probStrBrief})` : 'Valor detectado por IA';

  const datosBasicos =
`Liga: ${ligaStr}
Partido: ${home} vs ${away}
Hora estimada: ${horaStr}`;

  const apuestaSug = ap_sugerida
    ? `Apuesta sugerida: ${ap_sugerida.mercado} — ${ap_sugerida.seleccion} (cuota ${ap_sugerida.cuota ?? '—'})`
    : 'Apuesta sugerida: —';

  const extras = Array.isArray(apuestas_extra) && apuestas_extra.length
    ? apuestas_extra.map(x=>`• ${x.mercado}: ${x.seleccion} (cuota ${x.cuota ?? '—'})`).join('\n')
    : '—';

  const probStr = Number.isFinite(prob) ? `${prob}%` : '—';
  const evStr = Number.isFinite(ev) ? `${ev}%` : '—';
  const bookiesStr = bookies ? `Top 3 bookies:\n${bookies}` : '';

  const vipBookiesSection = bookies ? `Top 3 bookies:\n${bookies}\n` : '';
const bookiesStrFree = (includeBookiesInFree && bookies) ? bookiesStr : '';

  // Canal (Informativo)
  const canalHeader = '📡 RADAR DE VALOR';
  const canalCta = '👉 Únete al grupo VIP y prueba 15 días gratis.';
  const canalMsg =
`${canalHeader}
${datosBasicos}

Análisis de los expertos (IA):
${iaTagline}

${bookiesStrFree}

${canalCta}`;

  // VIP (>=15%)
  const vipHeader = `🎯 PICK NIVEL: ${nivel}`;
  const vipDisclaimer = '⚠️ Apuesta con responsabilidad. Esto no es consejo financiero.';
  const vipMsg =
`${vipHeader}
${datosBasicos}

EV estimado: ${evStr}
Probabilidad estimada: ${probStr}

${apuestaSug}

Apuestas extra:
${extras}

Datos avanzados (IA):
- Diagnóstico IA en base a datos
- Tendencias y contexto del partido

${bookiesStr}

${vipDisclaimer}`;

  return { canalMsg, vipMsg };
}

exports.handler = async (event) => {
  // S1.2-TDZ: mensajes ruteo (declaración única al inicio del handler)
  let message_free = null;
  let message_vip = null;
  try {
    const qs = event?.queryStringParameters || {};
    const evt = {
      home: qs.home || '',
      away: qs.away || '',
      league: qs.league || '',
      commence: qs.commence || new Date(Date.now() + 60*60*1000).toISOString()
    };

    // Resolver (puede no encontrar IDs; enrich.cjs ya tiene fallback de odds por nombres)
    const match = await resolveTeamsAndLeague(evt, {});
    const fixture = {
      fixture_id: match?.fixture_id || null,
      kickoff: evt.commence,
      league_id: match?.league_id || null,
      league_name: match?.league_name || evt.league || null,
      country: match?.country || null,
      home_id: match?.home_id || null,
      away_id: match?.away_id || null
};

    let payload = await oneShotPayload({ evt, match, fixture });
  // Enriquecimiento OddsAPI sólo si está habilitado explícitamente
    if (String(process.env.ODDS_ENRICH_ONESHOT) === '1') {
      try {
        payload = await ensureMarketsWithOddsAPI(payload, evt);
      } catch (e) {
        if (Number(process.env.DEBUG_TRACE) === 1) {
          console.log('[ENRICH] ensureMarketsWithOddsAPI error:', e?.message || String(e));
        }
      }
    }
if (Number(process.env.DEBUG_TRACE)) {
  try {
    const keys = Object.keys(payload.markets || {});
    console.log('[DEBUG] odds_source:', payload.meta && payload.meta.odds_source);
    console.log('[DEBUG] markets keys:', keys);
    for (const k of keys) {
      console.log('[DEBUG] sample', k, (payload.markets[k]||[]).slice(0,3));
    }
  } catch (e) { console.log('[DEBUG] markets print error:', e && e.message); }
}
// Prompt IA y llamada
    const prompt = composeOneShotPrompt(payload);
    const ai = await callOpenAIOnce({ prompt });

    if (!ai.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED)==='1');
  const base = { enabled, results: (typeof send_report!=='undefined' && send_report && Array.isArray(send_report.results)) ? send_report.results : [] };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
ok:false,
          reason: ai.reason,
          status: ai.status,
          statusText: ai.statusText,
          raw: ai.raw,
          payload,
          prompt
        })
      };
    }

    const parsed = safeExtractFirstJson(ai.raw || '');
    if (!parsed) {
      return { statusCode: 200, body: JSON.stringify({
   send_report: (() => {
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
})(), ok:false, reason:'invalid-ai-json', payload, prompt }) };
    }

    // Normalización
    let prob = Number(parsed.probabilidad_estim);
    let ev = Number(parsed.ev_estimado);
    if (isFiniteNum(prob) && prob <= 1) prob = prob * 100; // 0–1 → %
    if (isFiniteNum(ev) && Math.abs(ev) <= 1) ev = Math.round(ev * 1000) / 10; // fracción → %

    const ap_sugerida = parsed.apuesta_sugerida || null;
    const apuestas_extra = Array.isArray(parsed.apuestas_extra) ? parsed.apuestas_extra : [];

    // Recalcular EV si falta
    if (!isFiniteNum(ev)) {
      let oddsToUse = isFiniteNum(Number(ap_sugerida?.cuota)) ? Number(ap_sugerida.cuota) : null;

      if (!isFiniteNum(oddsToUse) && ap_sugerida?.mercado && payload?.markets) {
        const mk = marketKeyFromName(ap_sugerida.mercado);
        const arr = payload.markets?.[mk] || [];
        if (arr.length) oddsToUse = Number(arr[0]?.price);
      }

      if (!isFiniteNum(oddsToUse)) {
        const k0 = Object.keys(payload.markets||{})[0];
        if (k0 && payload.markets[k0]?.length) oddsToUse = Number(payload.markets[k0][0]?.price);
      }

      if (isFiniteNum(prob) && isFiniteNum(oddsToUse)) {
        ev = calcEV(prob, oddsToUse);
      }
    }

    const evOut = isFiniteNum(ev) ? ev : null;
    const nivel = classifyByEV(evOut);

    const liga = payload.league_name || payload.fixture?.league_name || evt.league || '';
    const pais = payload.country || payload.fixture?.country || null;
    const kickoff_iso = evt.commence || payload.fixture?.kickoff;

    const includeBookiesInFree = String(process.env.FREE_INCLUDE_BOOKIES) === '1';
let { canalMsg, vipMsg } = buildMessages({

liga, pais,
  home: evt.home, away: evt.away,
  kickoff_iso,
  ev: evOut,
  prob: isFiniteNum(prob) ? Math.round(prob*10)/10 : null,
  nivel,
  markets: payload.markets || {},
  ap_sugerida,
  apuestas_extra,
  includeBookiesInFree
});

    // Envío automático a Telegram (si habilitado)
    let send_report = { enabled: false };
const minVipEv = Number.isFinite(Number(process.env.MIN_VIP_EV)) ? Number(process.env.MIN_VIP_EV) : 15;
const sendToVip = (evOut != null && evOut >= minVipEv);
if (String(process.env.SEND_ENABLED) === '1' && typeof sendTelegramText === 'function') {
      const vipId = process.env.TG_VIP_CHAT_ID || null;
      const freeId = process.env.TG_FREE_CHAT_ID || null;
      send_report = { enabled:true, results: [] };

      if (sendToVip) {
  if (vipId && message_vip) {
    const r = await 
sendTelegramText({ chatId: vipId, text: vipMsg });
    send_report.results.push({ target: 'VIP', ok: r.ok, parts: r.parts, errors: r.errors });
  } else {
    send_report.missing_vip_id = (String(process.env.SEND_ENABLED)==='1') && !!message_vip  && !process.env.TG_VIP_CHAT_ID;
  }
} else {
  if (freeId && message_free) {
    const r = await sendTelegramText({ chatId: freeId, text: canalMsg });
    send_report.results.push({ target: 'FREE', ok: r.ok, parts: r.parts, errors: r.errors });
  } else {
    send_report.missing_free_id = (String(process.env.SEND_ENABLED)==='1') && !!message_free && !process.env.TG_FREE_CHAT_ID;
  }
}
    }

    message_vip = sendToVip ? vipMsg : null;
message_free = sendToVip ? null : canalMsg;

  // === FINAL_GATE_START ===
(() => {
  const vipMin = Number(process.env.MIN_VIP_EV || '15');

  // 0) EV robusto (acepta evOut, ev, ev_estimado %, ai_json.ev_estimado fracción)
  let evNum = 0;
  try {
    if (typeof evOut !== 'undefined') evNum = Number(evOut);
    else if (typeof ev !== 'undefined') evNum = Number(ev);
    else if (typeof ev_estimado !== 'undefined') evNum = Number(ev_estimado);
    else if (typeof ai_json !== 'undefined' && ai_json && ai_json.ev_estimado != null) {
      const v = Number(ai_json.ev_estimado);
      evNum = (v <= 1 ? v * 100 : v);
    }
  } catch (_) {}

  // 1) ¿hay bookies?
  // hasOdds: verdadero si existe al menos un mercado con elementos
  const hasOdds = (() => {
    try {
      const src = (typeof markets !== 'undefined' && markets && typeof markets === 'object') ? markets
                : (typeof markets_top3 !== 'undefined' && markets_top3 && typeof markets_top3 === 'object') ? markets_top3
                : null;
      if (!src) return false;
      const keys = Object.keys(src);
      if (!keys.length) return false;
      for (const k of keys) {
        const v = src[k];
        if (Array.isArray(v) && v.length) return true;
      }
      return false;
    } catch { return false; }
  })();

  // 2) Determinar destino
  let target = 'none';
  if (!hasOdds) {
    // Sin odds: nunca VIP. FREE sólo si nivel == Informativo.
    target = (nivel === 'Informativo') ? 'free' : 'none';
  } else {
    if (nivel === 'Informativo')      target = 'free';
    else if (evNum >= vipMin)         target = 'vip';
    else                              target = 'none';
  }

  // 3) Limpieza y FREE sin bookies
  const clean = (txt) => String(txt || '')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n')
    .trimEnd();
  const stripBookiesForFree = (txt) => {
    if (!txt) return txt;
    return txt
      .replace(/(?:\n+)?Top\s*3\s*bookies[\s\S]*$/i, '')
      .replace(/\n{3,}/g, '\n\n').trimEnd();
  };

  // 4) Asignación final (sin redeclarar)
  if (target === 'free') {
    message_free = clean(stripBookiesForFree(canalMsg));
    message_vip  = null;
  } else if (target === 'vip') {
    message_vip  = clean(vipMsg);
    message_free = null;
  } else {
    message_free = null;
    message_vip  = null;
  }
})();
 // === FINAL_GATE_END ===
return {
      statusCode: 200,
      body: JSON.stringify({

          send_report: (() => {
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
})(),        ok: true,
        reason: 'ok',
        fixture: payload.fixture,
        markets_top3: payload.markets,
        ai_json: parsed,
        ev_estimado: evOut,
        nivel,
        meta: payload.meta,
        message_vip,
        message_free
})
    };
  } catch (e) {
return { 

statusCode: 500, body: JSON.stringify({
   send_report: (() => {
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
})(), ok:false, reason:'server-error', error: e?.message || String(e) }) };
  }
};

module.exports.marketKeyFromName = marketKeyFromName;
