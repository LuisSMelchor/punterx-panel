'use strict';

// Espera markets_top3 con shape general: [{market, outcomes:[{name, price, bookmaker?}], best?, avg?}, ...]
function formatMarketsTop3(marketsTop3 = []) {
  try {
    if (!Array.isArray(marketsTop3) || marketsTop3.length === 0) {
      return '⚠️ Sin cuotas disponibles por ahora.';
    }

    const lines = [];
    for (const m of marketsTop3.slice(0,3)) {
      const market = norm(m?.market);
      if (!market) continue;

      // h2h → "Local/Empate/Visitante"
      if (isH2H(market)) {
        const picks = (m?.outcomes || []).slice(0,3).map(o => fmtPick(o));
        if (picks.length) {
          lines.push(`*H2H:* ${picks.join(' | ')}`);
        }
        continue;
      }

      // BTTS
      if (isBTTS(market)) {
        const yes = findOutcome(m?.outcomes, /yes|si/i);
        const no  = findOutcome(m?.outcomes, /no/i);
        const parts = [];
        if (yes) parts.push(`Sí ${fmtPrice(yes)}`);
        if (no)  parts.push(`No ${fmtPrice(no)}`);
        if (parts.length) lines.push(`*BTTS:* ${parts.join(' | ')}`);
        continue;
      }

      // Totals / Over-Under (Total Goals)
      if (isTotals(market)) {
        const over = findOutcome(m?.outcomes, /^over|^más|^mas/i);
        const under= findOutcome(m?.outcomes, /^under|^menos/i);
        const parts = [];
        if (over) parts.push(`Over ${fmtHandicap(over)} ${fmtPrice(over)}`);
        if (under)parts.push(`Under ${fmtHandicap(under)} ${fmtPrice(under)}`);
        if (parts.length) lines.push(`*Totales:* ${parts.join(' | ')}`);
        continue;
      }

      // fallback genérico
      const first = (m?.outcomes || [])[0];
      if (first?.name && first?.price) {
        lines.push(`*${cap(market)}:* ${first.name} ${fmtPrice(first)}`);
      }
    }

    return lines.length ? lines.join('\n') : '⚠️ Sin cuotas relevantes.';
  } catch {
    return '⚠️ Sin cuotas disponibles por ahora.';
  }
}

// ——— helpers ———
function norm(v){ return String(v||'').normalize('NFKD').toLowerCase().trim(); }
function cap(v){ v=String(v||''); return v.charAt(0).toUpperCase()+v.slice(1); }
function isH2H(m){ return /\b(h2h|1x2|moneyline|match\s*winner)\b/i.test(m); }
function isBTTS(m){ return /(btts|both\s*teams\s*to\s*score|ambos\s*anotan)/i.test(m); }
function isTotals(m){ return /(totals?|total\s*goals|over\/under|o\/u)/i.test(m); }

function fmtPick(o){ return `${safe(o?.name)} ${fmtPrice(o)}`.trim(); }
function fmtPrice(o){
  const p = Number(o?.price);
  if (!Number.isFinite(p)) return '';
  return `(@${p.toFixed(2)})`;
}
function fmtHandicap(o){
  const h = (o && (o.point ?? o.handicap ?? o.total)) ?? null;
  return (h!=null ? h : '').toString();
}
function findOutcome(arr, rx){ return (arr||[]).find(x => rx.test(String(x?.name||''))); }
function safe(v){ return (String(v||'').replace(/[*_`]/g, '')); }

module.exports = { formatMarketsTop3 };
