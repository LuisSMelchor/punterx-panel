'use strict';

const { oneShotPayload, composeOneShotPrompt } = require('./_lib/enrich.cjs');
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');
const { callOpenAIOnce } = require('./_lib/ai.cjs');
const { sendTelegramText } = require('./_lib/tx.cjs');

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

function calcEV(probPct, odds) {
  if (!isFiniteNum(probPct) || !isFiniteNum(odds) || odds<=1) return null;
  const p = probPct/100;
  return Math.round(((p*odds - 1) * 100) * 10)/10;
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

// Helpers S2.7
function minutesFromNow(iso) {
  const t = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.round(t/60000));
}
function fmtComienzaEn(iso) {
  const m = minutesFromNow(iso);
  return `Comienza en ${m} minutos aprox`;
}
function top3FromMarkets(markets, chosen) {
  // markets: { [mercado]: [ {book, price}, ... ] }
  // chosen: string (mercado) o null
  const mkey = chosen && markets?.[chosen]?.length ? chosen
             : Object.keys(markets||{})[0];
  const arr = (markets?.[mkey]||[]).slice(0,3);
  return arr.map((x,i)=>`${i+1}. ${x?.book||'N/A'} — ${x?.price ?? '—'}`).join('\n');
}
function buildMessages({liga, pais, home, away, kickoff_iso, ev, prob, nivel, markets, ap_sugerida, apuestas_extra}) {
  const ligaStr = pais ? `${liga} (${pais})` : liga;
  const horaStr = fmtComienzaEn(kickoff_iso);
  const bookies = top3FromMarkets(markets, ap_sugerida?.mercado);

  // Bloques base
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

  const probStr = isFiniteNum(prob) ? `${prob}%` : '—';
  const evStr = isFiniteNum(ev) ? `${ev}%` : '—';

  const bookiesStr = bookies ? `Top 3 bookies:\n${bookies}` : 'Top 3 bookies: —';

  // Mensaje Canal (10–14.9% = Informativo)
  const canalHeader = '📡 RADAR DE VALOR';
  const canalCta = '👉 Únete al grupo VIP y prueba 15 días gratis.';
  const canalMsg =
`${canalHeader}
${datosBasicos}

Análisis de los expertos: (IA)
Frase IA: (generada automáticamente)

${canalCta}`;

  // Mensaje VIP (>=15%)
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
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home,
      away: q.away,
      league: q.league,
      commence: q.commence
    };

    // 1) Resolver con AF (si no resuelve, seguimos igual; no es bloqueante para IA)
    const match = await resolveTeamsAndLeague(evt, {});
    const fixture = {
      fixture_id: match?.fixture_id,
      kickoff: evt.commence,
      league_id: match?.league_id,
      league_name: match?.league_name,
      country: match?.country,
      home_id: match?.home_id,
      away_id: match?.away_id,
    };

    // 2) Payload + prompt one-shot
    const payload = await oneShotPayload({ evt, match, fixture });
    const prompt = composeOneShotPrompt(payload);

    // 3) IA (si falla, devolvemos razón y diagnostic)
    const ai = await callOpenAIOnce({ prompt });
    if (!ai.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok:false, reason: ai.reason, status: ai.status, statusText: ai.statusText, raw: ai.raw,
          payload, prompt
        })
      };
    }

    // 4) Parseo duro del JSON
    const parsed = safeExtractFirstJson(ai.raw);
    if (!parsed || typeof parsed !== 'object') {
      return { statusCode: 200, body: JSON.stringify({ ok:false, reason:'invalid-ai-json', payload, prompt }) };
    }

    // 5) Validación mínima + normalización + EV + clasificación
    const ap = parsed.apuesta_sugerida || {};
    const mercado = ap.mercado || null;
    const cuota = Number(ap.cuota);
    let prob = Number(parsed.probabilidad_estim);
    let ev = Number(parsed.ev_estimado);

    // Normalización: prob (0-1 -> %) y EV fraccional (-> %)
    if (isFiniteNum(prob) && prob <= 1) prob = prob * 100;
    if (isFiniteNum(ev) && Math.abs(ev) <= 1) {
      ev = Math.round(ev * 1000) / 10; // *100 y redondeo a 0.1
    }

    // Recalcular EV si falta
    if (!isFiniteNum(ev)) {
      let oddsToUse = isFiniteNum(cuota) ? cuota : null;
      if (!isFiniteNum(oddsToUse) && mercado && payload?.markets?.[mercado]?.length) {
        oddsToUse = payload.markets[mercado][0]?.price; // mejor cuota
      }
      if (isFiniteNum(prob) && isFiniteNum(oddsToUse)) {
        ev = calcEV(prob, oddsToUse);
      }
    }

    const nivel = classifyByEV(ev);

    // Construcción de mensajes finales (S2.7)
const liga = payload?.fixture?.league_name || payload?.liga || '';
const pais = payload?.fixture?.country || payload?.pais || null;
const home = payload?.fixture?.home_name || payload?.local || (payload?.equipos?.local) || 'Local';
const away = payload?.fixture?.away_name || payload?.visita || (payload?.equipos?.visita) || 'Visita';
const kickoff_iso = payload?.fixture?.kickoff || payload?.kickoff_iso || new Date().toISOString();
const ap_sugerida = parsed?.apuesta_sugerida || null;
const apuestas_extra = parsed?.apuestas_extra || [];
const probOut = Number.isFinite(prob) ? Math.round(prob*10)/10 : prob;   // ej: 63.2%
const evOut = Number.isFinite(ev) ? Math.round(ev*10)/10 : ev;           // ej: 18.7%

const { canalMsg, vipMsg } = buildMessages({
  liga, pais, home, away, kickoff_iso,
  ev: evOut, prob: probOut, nivel,
  markets: payload?.markets || {},
  ap_sugerida, apuestas_extra
});

// Reglas: VIP si EV >= 15; Canal si 10 <= EV < 15; si <10 no se envía mensaje final.
let message_vip = null, message_free = null;
if (Number.isFinite(evOut) && evOut >= 15) {
  message_vip = vipMsg;
} else if (Number.isFinite(evOut) && evOut >= 10) {
  message_free = canalMsg;
}

// Envío automático a Telegram (solo si está habilitado por env)
let send_report = null;
if (String(process.env.SEND_ENABLED) === '1') {
  const vipId = process.env.TG_VIP_CHAT_ID || null;
  const freeId = process.env.TG_FREE_CHAT_ID || null;

  send_report = { enabled: true, results: [] };

  if (message_vip && vipId) {
    const r = await sendTelegramText({ chatId: vipId, text: message_vip });
    send_report.results.push({ target: 'VIP', ok: r.ok, parts: r.parts, errors: r.errors });
  } else if (message_vip && !vipId) {
    send_report = send_report || {};
    send_report.missing_vip_id = true;
  }

  if (message_free && freeId) {
    const r = await sendTelegramText({ chatId: freeId, text: message_free });
    send_report.results.push({ target: 'FREE', ok: r.ok, parts: r.parts, errors: r.errors });
  } else if (message_free && !freeId) {
    send_report = send_report || {};
    send_report.missing_free_id = true;
  }
} else {
  send_report = { enabled: false };
}

return {
  statusCode: 200,
  body: JSON.stringify({
    ok: true,
    reason: 'ok',
    fixture: payload.fixture,
    markets_top3: payload.markets,
    ai_json: parsed,
    ev_estimado: evOut,
    nivel,
    meta: payload.meta,
    message_vip,
    message_free,
    send_report
  })
};
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok:false, reason:'server-error', error: e?.message || String(e) }) };
  }
};
