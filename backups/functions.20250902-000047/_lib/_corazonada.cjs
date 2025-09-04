'use strict';

/**
 * Corazonada IA (0..100) + motivo breve
 * -------------------------------------
 * Señales:
 *  - Mercado (drift de cuota, proxy CLV)
 *  - xG/Forma (rolling diff)
 *  - Disponibilidad (lineup/lesiones)
 *  - Contexto (clima/descanso/viaje)
 *
 * Pesos por ENV (con defaults):
 *  CORAZONADA_W_MARKET=0.30
 *  CORAZONADA_W_XG=0.30
 *  CORAZONADA_W_AVAIL=0.25
 *  CORAZONADA_W_CTX=0.15
 *
 * Entrada esperada (parcialmente opcional):
 *  computeCorazonada({
 *    pick: { side: 'home'|'away'|'over'|'under'|'btts_yes'|'btts_no'|'draw'|string, market: 'h2h'|'totals'|'btts'|'double_chance'|'asian_handicap'|string },
 *    oddsNow: { best: Number|null },     // mejor cuota actual del lado elegido
 *    oddsPrev: { best: Number|null },    // mejor cuota anterior (snapshot). Si no hay, neutraliza Mercado
 *    xgStats: {
 *      home: { xg_for: Number, xg_against: Number, n: Number },
 *      away: { xg_for: Number, xg_against: Number, n: Number }
 *    } | null,
 *    availability: {
 *      home: { deltaRating: Number },    // + si mejoró vs baseline; - si empeoró
 *      away: { deltaRating: Number }
 *    } | null,
 *    context: {
 *      tempC: Number|null, humidity: Number|null, windKmh: Number|null, precipitationMm: Number|null,
 *      restDaysHome: Number|null, restDaysAway: Number|null
 *    } | null
 *  })
 */

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clamp(x, lo, hi) {
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function roundInt(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function pctToScore(p) {
  // p en [0..1] → [0..100]
  return Math.round(clamp01(p) * 100);
}

function sigmoid(z) {
  // logística suave
  const x = clamp(z, -10, 10);
  return 1 / (1 + Math.exp(-x));
}

function tanhLike(x, scale = 1) {
  const z = clamp(x / scale, -3, 3);
  const e1 = Math.exp(z);
  const e2 = Math.exp(-z);
  return (e1 - e2) / (e1 + e2); // ~[-1..1]
}

function readEnvFloat(k, def) {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : def;
}

// -----------------------------
// Subscore: Mercado (drift)
// -----------------------------
function scoreMarket(oddsPrevBest, oddsNowBest) {
  if (!Number.isFinite(oddsPrevBest) || !Number.isFinite(oddsNowBest) || oddsPrevBest <= 1.0) {
    return { score: 50, motive: 'sin histórico de mercado' };
  }
  // Drift relativo: positivo si la cuota "baja" a favor del pick (mejor precio más chico)
  const drift = (oddsPrevBest - oddsNowBest) / oddsPrevBest; // ~[-1..1] típico [-0.2..0.2]
  const s = (tanhLike(drift, 0.08) + 1) / 2; // 0.08 ~ 8% de sensibilidad
  const score = pctToScore(s);
  let motive = '';
  if (drift > 0.01) motive = 'mercado a favor (cuota cayendo)';
  else if (drift < -0.01) motive = 'mercado en contra (cuota subiendo)';
  else motive = 'mercado estable';
  return { score, motive };
}

// ---------------------------------
// Subscore: xG/Forma (rolling diff)
// ---------------------------------
function scoreXG(xgStats, side) {
  if (!xgStats || !xgStats.home || !xgStats.away) {
    return { score: 50, motive: 'sin xG reciente' };
  }
  const H = xgStats.home;
  const A = xgStats.away;
  const n = Math.max(1, Math.min(15, Number(H.n || A.n || 5)));
  const homeDiff = (Number(H.xg_for || 0) - Number(H.xg_against || 0)) / n;
  const awayDiff = (Number(A.xg_for || 0) - Number(A.xg_against || 0)) / n;
  const teamBias = (side === 'home') ? (homeDiff - awayDiff)
                   : (side === 'away') ? (awayDiff - homeDiff)
                   : (homeDiff + awayDiff) / 2; // over/btts: promedio
  // Map diff a [0..100] con logística
  const s = sigmoid(teamBias * 3); // 3 ⇒ gana pendiente
  const score = pctToScore(s);
  let motive = '';
  if (side === 'home' || side === 'away') {
    motive = `diferencial xG ${teamBias >= 0 ? 'favorable' : 'desfavorable'}`;
  } else {
    motive = `tendencia xG ${teamBias >= 0 ? 'al alza' : 'a la baja'}`;
  }
  return { score, motive };
}

// --------------------------------------
// Subscore: Disponibilidad (lineup/inj)
// --------------------------------------
function scoreAvailability(availability, side) {
  if (!availability || !availability.home || !availability.away) {
    return { score: 50, motive: 'sin lineup/lesiones' };
  }
  const dh = Number(availability.home.deltaRating || 0); // + mejora vs baseline
  const da = Number(availability.away.deltaRating || 0);
  let delta = 0;
  if (side === 'home') delta = dh - da;
  else if (side === 'away') delta = da - dh;
  else delta = (dh + da) / 2; // over/btts: disponibilidad global
  // Map delta Rating a [0..100]
  const s = (tanhLike(delta, 0.8) + 1) / 2; // 0.8 ≈ 1 jugador top out/in fuerte
  const score = pctToScore(s);
  let motive = '';
  if (Math.abs(delta) < 0.1) motive = 'sin shocks de alineación';
  else motive = delta > 0 ? 'alineaciones favorables' : 'alineaciones adversas';
  return { score, motive };
}

// ----------------------
// Subscore: Contexto
// ----------------------
function scoreContext(ctx, side, market) {
  if (!ctx) return { score: 50, motive: 'contexto neutral' };
  const { tempC, humidity, windKmh, precipitationMm, restDaysHome, restDaysAway } = ctx;

  // Penalizaciones meteorológicas (afectan más a mercados de goles)
  let weatherPenalty = 0; // [-1..1] negativo penaliza
  const t = Number.isFinite(tempC) ? tempC : null;
  const w = Number.isFinite(windKmh) ? windKmh : null;
  const r = Number.isFinite(precipitationMm) ? precipitationMm : null;

  if (t !== null) {
    if (t >= 32) weatherPenalty -= 0.25;
    else if (t >= 28) weatherPenalty -= 0.15;
  }
  if (w !== null && w >= 25) weatherPenalty -= 0.1;
  if (r !== null && r >= 5) weatherPenalty -= 0.15;

  // Descanso relativo (para sides)
  let restBias = 0;
  const rh = Number.isFinite(restDaysHome) ? restDaysHome : null;
  const ra = Number.isFinite(restDaysAway) ? restDaysAway : null;
  if (rh !== null && ra !== null) {
    const d = (side === 'home') ? (rh - ra) : (side === 'away') ? (ra - rh) : (rh + ra) / 2 - 3;
    // si d > 0, más descanso para nuestro lado ⇒ bonus
    restBias += clamp(d / 3, -0.5, 0.5); // ±0.5
  }

  // Ajuste por tipo de mercado: goles sufren más el mal clima
  let adj = 0;
  if (market === 'totals' || market === 'btts') {
    adj += weatherPenalty * 1.2;
  } else {
    adj += weatherPenalty * 0.6;
  }
  adj += restBias;

  const s = clamp01(0.5 + adj * 0.4); // suavizado
  const score = pctToScore(s);
  let motive = [];
  if (weatherPenalty <= -0.2) motive.push('clima exigente');
  if (restBias > 0.15) motive.push('mejor descanso');
  if (restBias < -0.15) motive.push('peor descanso');
  if (!motive.length) motive.push('sin condicionantes fuertes');
  return { score, motive: motive.join(' + ') };
}

// -------------------------------------
// Ensamblado final y motivo compuesto
// -------------------------------------
function pickSideFromMarket(pick) {
  const s = (pick && pick.side || '').toLowerCase();
  if (['home','away','over','under','btts_yes','btts_no','draw'].includes(s)) return s;
  // heurística mínima
  if (/over|más de|mas de|\bover\b/.test(s)) return 'over';
  if (/under|menos de|\bunder\b/.test(s)) return 'under';
  if (/both.*yes|ambos anotan.*si|btts.*yes/.test(s)) return 'btts_yes';
  if (/both.*no|ambos anotan.*no|btts.*no/.test(s)) return 'btts_no';
  return 'home'; // neutral por defecto
}

function pickMarket(pick) {
  const m = (pick && pick.market || '').toLowerCase();
  if (['h2h','totals','btts','double_chance','asian_handicap','handicap'].includes(m)) return m;
  // heurística mínima
  if (/btts|ambos anotan/.test(m)) return 'btts';
  if (/over|under|total/.test(m)) return 'totals';
  if (/handicap|asian/.test(m)) return 'asian_handicap';
  return 'h2h';
}

function topContributors(entries, k = 2) {
  const sorted = entries.slice().sort((a, b) => b.weighted - a.weighted);
  return sorted.slice(0, k);
}

function computeCorazonada(input) {
  try {
    const Wm = readEnvFloat('CORAZONADA_W_MARKET', 0.30);
    const Wx = readEnvFloat('CORAZONADA_W_XG', 0.30);
    const Wa = readEnvFloat('CORAZONADA_W_AVAIL', 0.25);
    const Wc = readEnvFloat('CORAZONADA_W_CTX', 0.15);

    const sumW = Wm + Wx + Wa + Wc || 1.0;

    const side = pickSideFromMarket(input?.pick);
    const market = pickMarket(input?.pick);

    const mkt = scoreMarket(input?.oddsPrev?.best, input?.oddsNow?.best);       // {score, motive}
    const xgs = scoreXG(input?.xgStats || null, side);                          // {score, motive}
    const avl = scoreAvailability(input?.availability || null, side);           // {score, motive}
    const ctx = scoreContext(input?.context || null, side, market);             // {score, motive}

    const ws = [
      { label: 'Mercado', score: mkt.score, w: Wm, motive: mkt.motive },
      { label: 'xG/Forma', score: xgs.score, w: Wx, motive: xgs.motive },
      { label: 'Disponibilidad', score: avl.score, w: Wa, motive: avl.motive },
      { label: 'Contexto', score: ctx.score, w: Wc, motive: ctx.motive }
    ];

    // si falta señal (score ~50 por falta de datos), igual la consideramos, pero el motivo final lo declara
    const weighted = ws.map(s => ({ ...s, weighted: s.score * (s.w / sumW) }));
    const score = roundInt(weighted.reduce((acc, s) => acc + s.weighted, 0));

    const top2 = topContributors(weighted, 2)
      .map(s => `${s.label.toLowerCase()}: ${s.motive}`)
      .filter(Boolean);

    let motivo = '';
    if (top2.length) motivo = top2.join(' | ');
    else motivo = 'señales incompletas';

    return {
      score: clamp(score, 0, 100),
      motivo
    };
  } catch (err) {
    return { score: 50, motivo: 'corazonada fallback (error interno)' };
  }
}

module.exports = {
  computeCorazonada
};
