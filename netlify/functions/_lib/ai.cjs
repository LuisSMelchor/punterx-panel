'use strict';

// Ponyfill de fetch por si el runtime no lo trae
const fetchPony = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({default: f}) => f(...args)));

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Llama a OpenAI una sola vez, forzando JSON.
 * Devuelve { ok, reason, raw } donde raw es el texto (JSON) de la IA.
 */
async function callOpenAIOnce({ prompt }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok:false, reason:'missing-openai-key', raw:null };
  }
  const res = await fetchPony('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':`Bearer ${key}`,
    },
    body: JSON.stringify((() => {
    const base = {
      model: DEFAULT_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Responde SOLO con un JSON válido. Nada de texto extra.' },
        { role: 'user', content: prompt }
      ]
    };
    if (!process.env.AI_NO_JSON_FORMAT) {
      base.response_format = { type: 'json_object' };
    }
    return base;
  })())
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>null);
    return { ok:false, reason:'openai-http-error', status: res.status, statusText: res.statusText, raw:text };
  }
  const json = await res.json().catch(()=>null);
  const content = json?.choices?.[0]?.message?.content ?? '';
  return { ok:true, reason:'ok', raw:content };
}

module.exports = { callOpenAIOnce };
