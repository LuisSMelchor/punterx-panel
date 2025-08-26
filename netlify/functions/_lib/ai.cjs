'use strict';
const https = require('https');

// --- Caller de OpenAI (una sola llamada). Si no hay OPENAI_API_KEY, devuelve null.
async function callOneShotOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // ajustable
  if (!key) return null;

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: 'Responde exclusivamente con un JSON. Sin texto adicional.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 500
  });

  return await _retryAI(() => _postOpenAI(body, key));
}

function _postOpenAI(body, key) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: Number(process.env.HTTP_TIMEOUT_MS || 6500)
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const txt = j?.choices?.[0]?.message?.content?.trim() || '';
          resolve(txt || null);
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- Parse + validación mínima de forma ---
function safeJson(str) {
  try {
    const j = typeof str === 'string' ? JSON.parse(str) : (str || {});
    if (!j || typeof j !== 'object') return null;
    // Chequeos mínimos de campos esperados
    if (!('apuesta_sugerida' in j)) return null;
    if (!('probabilidad_estim' in j)) return null;
    if (!('ev_estimado' in j)) j.ev_estimado = null; // lo recalculamos nosotros
    if (!('apuestas_extra' in j)) j.apuestas_extra = [];
    return j;
  } catch { return null; }
}

// --- EV: (p*odds - 1) * 100 ---
function computeEV(apuesta, probPct) {
  const cuota = Number(apuesta?.cuota);
  const p = Number(probPct);
  if (!Number.isFinite(cuota) || !Number.isFinite(p)) return null;
  return (p/100 * cuota - 1) * 100;
}

// --- Clasificación por niveles ---
function classifyEV(evPct) {
  if (!Number.isFinite(evPct)) return 'descartado';
  if (evPct >= 15) return 'vip';
  if (evPct >= 10) return 'free';
  return 'descartado';
}

module.exports = {
  callOneShotOpenAI,
  safeJson,
  computeEV,
  classifyEV
};

async function _retryAI(fn) {
  let last;
  for (let i=0;i<2;i++){ // 1 reintento
    try { return await fn(); }
    catch(e){ last = e; await new Promise(r=>setTimeout(r, 400)); }
  }
  throw last;
}
