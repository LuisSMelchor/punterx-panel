'use strict';

// Usa fetch nativo (Node 18+). No expongas la KEY.
const OPENAI_URL = process.env.OPENAI_URL || 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-thinking'; // ajustable
const TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 20000);

/** Llama a OpenAI con un prompt one-shot y espera SOLO JSON en content */
async function callOpenAIOneShot({ prompt }) {
  if (!process.env.OPENAI_API_KEY || !prompt) return null;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort('timeout'), TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Responde SOLO con un JSON válido. Sin texto extra.' },
          { role: 'user', content: prompt }
        ]
      }),
      signal: ctrl.signal
    });
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // Intento de reparación mínima si vino con código o backticks
      const fixed = raw.replace(/^```json\s*|\s*```$/g, '');
      return JSON.parse(fixed);
    }
  } catch (e) {
    if (Number(process.env.DEBUG_TRACE)) console.log('[AI] error', e?.message || e);
    return null;
  } finally {
    clearTimeout(to);
  }
}

/** Valida forma mínima del JSON de la IA */
function validateAIJson(o = {}) {
  const okNum = (x) => x === null || typeof x === 'number';
  const okStr = (x) => typeof x === 'string' && x.length > 0;
  const main = o?.apuesta_sugerida;
  if (!main || !okStr(main.mercado) || !okStr(main.seleccion) || !okNum(main.cuota)) return false;
  if (o.apuestas_extra && !Array.isArray(o.apuestas_extra)) return false;
  return true;
}

/** EV % = (p*odds - 1)*100, con p en [0,1] */
function computeEV(probPct, odds) {
  if (typeof probPct !== 'number' || typeof odds !== 'number') return null;
  const p = Math.max(0, Math.min(1, probPct / 100));
  const ev = (p * odds - 1) * 100;
  return Math.round(ev * 100) / 100;
}

/** Clasificación por niveles según tus umbrales */
function classifyByEV(ev) {
  if (ev == null) return 'Informativo';
  if (ev >= 40) return 'Ultra Elite';
  if (ev >= 30) return 'Élite Mundial';
  if (ev >= 20) return 'Avanzado';
  if (ev >= 15) return 'Competitivo';
  if (ev >= 10) return 'Informativo';
  return 'Descartar';
}

module.exports = {
  callOpenAIOneShot,
  validateAIJson,
  computeEV,
  classifyByEV
};
