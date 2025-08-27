const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');
const const { oneShotPayload, composeOneShotPrompt } = require('./_lib/oneshot-adapter.cjs');
const { callOneShotOpenAI, safeJson, computeEV, classifyEV } = require('./_lib/ai.cjs');

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home:   q.home   || 'Charlotte FC',
      away:   q.away   || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || '2025-08-24T23:00:00Z'
    };
    const match = await resolveTeamsAndLeague(evt, {});
    const fixture = {
      fixture_id: match?.fixture_id,
      kickoff:    evt.commence,
      league_id:  match?.league_id,
      league_name: match?.league_name,
      country:    match?.country,
      home_id:    match?.home_id,
      away_id:    match?.away_id
    };
    // 1) Construir payload y prompt
    const payload = await oneShotPayload({ evt, match, fixture });
    const prompt = composeOneShotPrompt(payload);
    // 2) Llamada a OpenAI (si no hay clave, retorna null)
    const raw = await callOneShotOpenAI(prompt);
    // 3) Validación JSON + EV + clasificación
    const parsed = safeJson(raw);
    let result = {
      raw,      // respuesta bruta de IA (string o null)
      parsed: null,     // JSON parseado válido (o null)
      ev_calculado: null,
      nivel: 'descartado',
      reason: null
    };
    if (!parsed) {
      result.reason = 'json_invalido';
    } else {
      // Recalcular EV con nuestra fórmula
      const prob = parsed.probabilidad_estim;
      const apuesta = parsed.apuesta_sugerida;
      const ev = computeEV(apuesta, prob);
      result.parsed = parsed;
      result.ev_calculado = Number.isFinite(ev) ? Number(ev.toFixed(2)) : null;
      const nivel = classifyEV(result.ev_calculado);
      result.nivel = nivel;
      result.reason = (nivel === 'descartado' ? 'ev_insuficiente' : 'ok');
    }
    // 4) Respuesta diagnóstica
    return {
      statusCode: 200,
      body: JSON.stringify({
        input: { evt, match },
        payload,
        prompt_preview: prompt.slice(0, 600), // para inspección rápida
        result
      }, null, 2)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
