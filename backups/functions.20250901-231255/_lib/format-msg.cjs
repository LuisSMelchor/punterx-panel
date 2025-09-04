'use strict';

function fmtTop3(markets = {}) {
  const order = (process.env.ODDS_MARKETS_CANON || '1x2,btts,over_2_5,doublechance')
    .split(',').map(s=>s.trim()).filter(Boolean);
  const lines = [];
  for (const k of order) {
    const arr = Array.isArray(markets[k]) ? markets[k] : [];
    if (!arr.length) continue;
    const head =
      k === '1x2' ? '1X2' :
      k === 'btts' ? 'Ambos anotan' :
      k === 'over_2_5' ? 'Más de 2.5 goles' :
      k === 'doublechance' ? 'Doble oportunidad' : k;
    const row = arr.map(o => `${o.bookie}: ${o.price}`).join(' | ');
    lines.push(`• ${head}: ${row}`);
  }
  return lines.join('\n');
}

function fmtVIP({ fixture, ia, ev, markets }) {
  const head = '🎯 PICK NIVEL: ' + (ev >= 30 ? 'Élite Mundial' : ev >= 20 ? 'Avanzado' : ev >= 15 ? 'Competitivo' : '—');
  const liga = fixture.league || '(liga desconocida)';
  const when = fixture.when_text || '(hora desconocida)';

  const sug = ia?.apuesta_sugerida;
  const extras = Array.isArray(ia?.apuestas_extra) ? ia.apuestas_extra : [];
  const datos = ia?.datos_avanzados || '';

  const top3 = fmtTop3(markets);

  let out = `${head}\n`;
  out += `Liga: ${liga}\n`;
  out += `Horario: ${when}\n`;
  out += `\nApuesta sugerida: ${sug?.mercado || '-'} — ${sug?.seleccion || '-'} @ ${sug?.cuota ?? '-'} (${sug?.bookie || '-'})\n`;
  if (extras.length) {
    out += `Apuestas extra:\n`;
    for (const e of extras) {
      out += `• ${e.mercado}: ${e.seleccion} @ ${e.cuota} (${e.bookie})\n`;
    }
  }
  out += `\nEV estimado: ${ev?.toFixed?.(2)}%\n`;
  out += `Probabilidad IA: ${ia?.probabilidad_estim ?? '-'}%\n`;
  out += `\nTop 3 por mercado:\n${top3 || '• (sin datos)'}\n`;
  out += `\nDatos avanzados: ${datos}\n`;
  out += `\n⚠️ Apuesta responsable.`;
  return out;
}

function fmtFREE({ fixture, markets }) {
  const head = '📡 RADAR DE VALOR';
  const liga = fixture.league || '(liga desconocida)';
  const when = fixture.when_text || '(hora desconocida)';
  const top3 = fmtTop3(markets);

  let out = `${head}\nLiga: ${liga}\nHorario: ${when}\n`;
  out += `\nTop 3 por mercado:\n${top3 || '• (sin datos)'}\n`;
  out += `\n🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.\n`;
  out += `Únete al VIP por 15 días gratis.`;
  return out;
}

module.exports = { fmtVIP, fmtFREE };
