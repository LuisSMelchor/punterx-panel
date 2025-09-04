'use strict';

function minutesToText(mins) {
  if (mins == null) return 'Hora no disponible';
  if (mins <= 0) return 'Ya comenzó o terminó';
  return `Comienza en ${mins} minutos aprox`;
}

function formatTop3Bookies(top3 = []) {
  // Espera [{name, odds}] ya ordenado desc por cuota
  if (!Array.isArray(top3) || top3.length === 0) return '—';
  return top3.map((b, i) => `${i+1}. ${b.name}: ${b.odds}`).join(' | ');
}

function formatVipMessage({ payload, ai }) {
  const liga = payload.liga + (payload.pais ? ` (${payload.pais})` : '');
  const equipos = `${payload.equipos?.local} vs ${payload.equipos?.visita}`;
  const horaTxt = minutesToText(payload.comienza_en_min);
  const r = ai?.result || {};
  const ap = r.apuesta_sugerida || {};
  const ev = (typeof r.ev_estimado === 'number') ? `${r.ev_estimado}%` : '—';
  const prob = (typeof r.probabilidad_estim === 'number') ? `${r.probabilidad_estim}%` : '—';
  const top3 = formatTop3Bookies(payload.odds_top3 || []);

  const apuestasExtra = Array.isArray(r.apuestas_extra) && r.apuestas_extra.length
    ? r.apuestas_extra.map(x => `• ${x.mercado}: ${x.seleccion} @ ${x.cuota}`).join('\n')
    : '• —';

  return [
    '🎯 PICK NIVEL: ' + (r.nivel || '—'),
    `📍 Liga: ${liga}`,
    `🏟️ Equipos: ${equipos}`,
    `⏱️ ${horaTxt}`,
    `📈 EV: ${ev} | Prob: ${prob}`,
    `💡 Apuesta sugerida: ${ap.mercado} — ${ap.seleccion} @ ${ap.cuota}`,
    `🧩 Apuestas extra:\n${apuestasExtra}`,
    `🏦 Mejores casas: ${top3}`,
    '',
    '🧠 Diagnóstico IA avanzada: datos y contexto integrados.',
    '⚠️ Apuesta con responsabilidad. Esto no es asesoría financiera.'
  ].join('\n');
}

function formatFreeMessage({ payload, ai }) {
  const liga = payload.liga + (payload.pais ? ` (${payload.pais})` : '');
  const equipos = `${payload.equipos?.local} vs ${payload.equipos?.visita}`;
  const horaTxt = minutesToText(payload.comienza_en_min);
  const r = ai?.result || {};

  return [
    '📡 RADAR DE VALOR',
    `📍 Liga: ${liga}`,
    `🏟️ Equipos: ${equipos}`,
    `⏱️ ${horaTxt}`,
    '🧠 Análisis automatizado (resumen):',
    '- Oportunidad detectada por IA.',
    '',
    '👉 Únete al grupo VIP por 15 días gratis para ver la apuesta sugerida completa y más picks.'
  ].join('\n');
}

module.exports = {
  formatVipMessage,
  formatFreeMessage,
  minutesToText,
  formatTop3Bookies,
};
