// netlify/functions/_lib/match-config.cjs
'use strict';
const __PX_DEBUG = !!(process.env.AF_DEBUG || process.env.DEBUG || process.env.PX_DEBUG);
const dlog = (...args) => {
  if (!__PX_DEBUG) return;
  try { (console.debug || console.log)('[match-config]', ...args); } catch(_) {}



// [AF_SENTINEL_DBG_V1]
const __AF_DBG__ = !!process.env.AF_DEBUG;
/* dlog removed (match-config var) */
};
/**
 * Config: lee desde env y exporta constantes tipadas.
 * No imprime nada salvo que DEBUG_TRACE==='1'.
 */

const STRICT_MATCH = String(process.env.STRICT_MATCH) === '1';
const SIM_THR      = parseFloat(process.env.AF_MIN_SIM || '0.84');  // similitud mínima
const TIME_PAD_MIN = parseInt(process.env.TIME_PAD_MIN || '15', 10); // minutos para ventana

if (process.env.DEBUG_TRACE === '1') {
  dlog('[MATCH-HELPER] ver', 'mh-2025-08-24-final');
  dlog('[MATCH-HELPER] knobs', { TIME_PAD_MIN, SIM_THR, STRICT_MATCH });
}

module.exports = { STRICT_MATCH, SIM_THR, TIME_PAD_MIN };
