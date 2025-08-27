'use strict';

const { oneShotPayload, composeOneShotPrompt } = require('./_lib/enrich.cjs');
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');
const { callOpenAIOnce } = require('./_lib/ai.cjs');

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

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        reason: 'ok',
        fixture: payload.fixture,
        markets_top3: payload.markets,
        ai_json: parsed,
        ev_estimado: ev,
        nivel,
        meta: payload.meta,
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok:false, reason:'server-error', error: e?.message || String(e) }) };
  }
};
