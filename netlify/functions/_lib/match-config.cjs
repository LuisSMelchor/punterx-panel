// netlify/functions/_lib/match-config.cjs
'use strict';

/**
 * Config: lee desde env y exporta constantes tipadas.
 * No imprime nada salvo que DEBUG_TRACE==='1'.
 */

const STRICT_MATCH = String(process.env.STRICT_MATCH) === '1';
const SIM_THR      = parseFloat(process.env.AF_MIN_SIM || '0.84');  // similitud mínima
const TIME_PAD_MIN = parseInt(process.env.TIME_PAD_MIN || '15', 10); // minutos para ventana

if (process.env.DEBUG_TRACE === '1') {
  console.log('[MATCH-HELPER] ver', 'mh-2025-08-24-final');
  console.log('[MATCH-HELPER] knobs', { TIME_PAD_MIN, SIM_THR, STRICT_MATCH });
}

module.exports = { STRICT_MATCH, SIM_THR, TIME_PAD_MIN };
