'use strict';

// Stub determinista y robusto para desarrollo local.
// Entrega tanto `json` (objeto) como `content` (string JSON) para que cualquier caller funcione.
async function callOpenAIOnce({ prompt } = {}) {
  const text = String(prompt || '').slice(0, 4000);

  // Construye mensajes demo (sin conectarse a OpenAI)
  const json = {
    message_free: `[FREE] Predicción preliminar basada en contexto: ${text.slice(0, 120)}...`,
    message_vip: `[VIP] Ticket sugerido (beta). Contexto: ${text.slice(0, 120)}...`,
    rationale: {
      pick: 'h2h',                // mercado genérico
      selection: 'home',          // home/away/over/under
      confidence: 0.62,           // 0..1
      notes: 'Salida generada por stub local; para producción usar OPENAI_API_KEY.'
    },
    model: 'stub-local/1.0',
    ts: new Date().toISOString()
  };

  return {
    ok: true,
    json,                         // camino A: el caller puede leer .json
    content: JSON.stringify(json) // camino B: el caller puede parsear .content
  };
}

// Parser tolerante para respuestas de IA (objeto o string JSON; ignora envolturas/código)
function safeJson(input) {
  try {
    if (!input) return null;
    if (typeof input === 'object') return input;
    let s = String(input).trim();
    // Quitar backticks/etiquetas si vinieran de modelos que añaden ```json
    if (s.startsWith('```')) {
      s = s.replace(/^```(?:json)?\s*/i, '');
      s = s.replace(/```$/, '');
    }
    s = s.trim();
    try { return JSON.parse(s); } catch (e) {
      // Heurística: extraer primer bloque JSON entre llaves si hay ruido
      const m = s.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      return null;
    }
  } catch (_) { return null; }
}

module.exports = { callOpenAIOnce, safeJson };
