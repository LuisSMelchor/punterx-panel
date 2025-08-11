// netlify/functions/_telemetry.cjs
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_PRICE_PROMPT_PER_1K,
  OPENAI_PRICE_COMP_PER_1K,
} = process.env;

// Re-usa cliente si ya existe (por si el bundler lo agrupa)
let _client;
function getClient() {
  if (_client) return _client;
  try {
    _client = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (_) {
    // no rompas la app por telemetría
  }
  return _client;
}

// 1) Heartbeat (marca "sigue vivo")
async function beat(functionName, ok = true) {
  try {
    const supabase = getClient();
    if (!supabase) return;
    await supabase.from('heartbeats').upsert({
      function_name: functionName,
      last_seen: new Date().toISOString(),
      ok
    });
  } catch (_) {}
}

// 2) Costo estimado (si OpenAI devolvió usage)
function computeOpenAICost(usage, model = '') {
  if (!usage) return { usd: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const prompt_tokens = Number(usage.prompt_tokens || 0);
  const completion_tokens = Number(usage.completion_tokens || 0);
  const total_tokens = Number(usage.total_tokens || (prompt_tokens + completion_tokens));

  // USD por 1K tokens (ajustables por ENV)
  const defPromptUSDper1k = Number(OPENAI_PRICE_PROMPT_PER_1K || 0.15);
  const defCompUSDper1k   = Number(OPENAI_PRICE_COMP_PER_1K   || 0.60);

  // si quieres por modelo, mapea aquí (opcional)
  const prices = { prompt: defPromptUSDper1k, completion: defCompUSDper1k };

  const usd =
    (prompt_tokens / 1000) * prices.prompt +
    (completion_tokens / 1000) * prices.completion;

  return {
    usd: Number(usd.toFixed(6)),
    prompt_tokens,
    completion_tokens,
    total_tokens,
    model
  };
}

// 3) Registrar costo en tabla
async function logCost(provider, usd) {
  try {
    if (!usd || !(usd > 0)) return;
    const supabase = getClient();
    if (!supabase) return;
    await supabase.from('cost_telemetry').insert({
      provider,
      usd: Number(usd)
    });
  } catch (_) {}
}

module.exports = { beat, computeOpenAICost, logCost };
