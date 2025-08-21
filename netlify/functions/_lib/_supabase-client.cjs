// netlify/functions/_supabase-client.cjs
'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  // Importante: fallar temprano para ver el error en logs
  throw new Error('Falta SUPABASE_URL o SUPABASE_KEY en variables de entorno');
}

// No persistimos sesión en Lambdas
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  global: { headers: { 'x-px-runtime': 'netlify-fn' } },
});

module.exports = { supabase };
