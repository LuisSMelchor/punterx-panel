'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID,
  OPENAI_MODEL,
  OPENAI_MODEL_FALLBACK,
  COUNTRY_FLAG,
  ODDS_API_KEY,
  API_FOOTBALL_KEY
} = process.env;

function assertEnv() {
  const required = [
    'SUPABASE_URL','SUPABASE_KEY','OPENAI_API_KEY','TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHANNEL_ID','TELEGRAM_GROUP_ID','ODDS_API_KEY','API_FOOTBALL_KEY'
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ ENV faltantes:', missing.join(', '));
    throw new Error('Variables de entorno faltantes');
  }
}

const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '');
const openai = new OpenAI({ apiKey: OPENAI_API_KEY || '' });

exports.handler = async (event, context) => {
  assertEnv();
  // Lógica del handler aquí
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
