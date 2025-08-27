'use strict';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function callOpenAIOnce({ prompt }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok:false, reason:'missing-openai-key', raw:null };
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':`Bearer ${key}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Responde SOLO con un JSON válido. Nada de texto extra.' },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>null);
    return { ok:false, reason:'openai-http-error', raw:text };
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content || '';
  return { ok:true, reason:'ok', raw:content };
}

module.exports = { callOpenAIOnce };
