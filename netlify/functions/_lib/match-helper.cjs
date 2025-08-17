// netlify/functions/_lib/match-helper.cjs
// PunterX · Match Helper — Emparejador OddsAPI ↔ API-FOOTBALL
// Objetivo: dado un evento de OddsAPI y una lista de fixtures de API-FOOTBALL,
// elegir la mejor coincidencia confiable (score 0–1). Umbral configurable por ENV.

// Reglas:
// - CommonJS (require/module.exports)
// - Sin dependencias externas
// - Cero efectos colaterales: solo utilidades puras

const MIN_SCORE = Math.max(
  0,
  Math.min(1, Number(process.env.APP_MATCH_HELPER_MIN_SCORE || 0.75))
);

// ---------- Normalización y utilidades ----------
function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeTeamName(s) {
  // Normaliza nombres de equipos a un token estable
  // Elimina artículos/abreviaturas comunes sin hardcodear clubes específicos
  return stripAccents(s)
    .toLowerCase()
    // abreviaturas muy frecuentes en múltiples idiomas
    .replace(/\b(f\.?c\.?|c\.?f\.?|s\.?c\.?|a\.?c\.?|u\.?d\.?|d\.?e\.?|u\.?n\.?|c\.?d\.?|r\.?c\.?|a\.?d\.?)\b/g, "")
    .replace(/\b(afc|cf|sc|ac|ud|cd|rc|ad)\b/g, "")
    // palabras comodín
    .replace(/\b(club|deportivo|sporting|football|futbol|fútbol|the)\b/g, "")
    // conectores y basura
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLeagueName(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function jaccard(tokensA, tokensB) {
  if (!tokensA.length && !tokensB.length) return 1;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const uni = setA.size + setB.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function tokenize(s) {
  return String(s || "")
    .split(/\s+/)
    .filter(Boolean);
}

function timeProximityScore(tsA, tsB, maxHours = 48) {
  const a = Date.parse(tsA || "");
  const b = Date.parse(tsB || "");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0.5; // neutral si falta fecha
  const diffH = Math.abs(a - b) / 36e5;
  if (diffH >= maxHours) return 0;
  // lineal decreciente: 0h => 1, maxHours => 0
  return +(1 - diffH / maxHours).toFixed(6);
}

function leagueAffinityScore(oddsLeague, afLeague) {
  const a = normalizeLeagueName(oddsLeague || "");
  const b = normalizeLeagueName(afLeague || "");
  if (!a || !b) return 0.5;
  if (a === b) return 1;
  // Jaccard de tokens por si hay sufijos (Clausura, Apertura, etc.)
  return jaccard(tokenize(a), tokenize(b));
}

// ---------- Scoring principal ----------
function scoreOddsEventVsAFFixture(oddsEv, afFx, opts = {}) {
  // Señales:
  // 1) Similitud home/away (Jaccard sobre tokens normalizados)
  // 2) Simetría home<->away (por si OddsAPI invirtió)
  // 3) Proximidad temporal (kickoff)
  // 4) Afinidad de liga
  // 5) Bonus país (si lo tenemos de AF y de Odds)

  const w = Object.assign(
    {
      wNames: 0.55,   // peso nombres (home/away)
      wTime: 0.20,    // peso proximidad temporal
      wLeague: 0.20,  // peso liga
      wCountry: 0.05, // peso país (si disponible)
    },
    opts.weights || {}
  );

  const homeOdds = normalizeTeamName(oddsEv.home);
  const awayOdds = normalizeTeamName(oddsEv.away);
  const homeAF = normalizeTeamName(afFx?.teams?.home?.name || "");
  const awayAF = normalizeTeamName(afFx?.teams?.away?.name || "");

  const jHomeHome = jaccard(tokenize(homeOdds), tokenize(homeAF));
  const jAwayAway = jaccard(tokenize(awayOdds), tokenize(awayAF));
  const directNames = (jHomeHome + jAwayAway) / 2;

  const jHomeAway = jaccard(tokenize(homeOdds), tokenize(awayAF));
  const jAwayHome = jaccard(tokenize(awayOdds), tokenize(homeAF));
  const swappedNames = (jHomeAway + jAwayHome) / 2;

  const namesScore = Math.max(directNames, swappedNames);

  const timeScore = timeProximityScore(oddsEv.commence_time, afFx?.fixture?.date, 48);
  const leagueScore = leagueAffinityScore(oddsEv.liga || oddsEv.sport_title, afFx?.league?.name);

  let countryScore = 0.5; // neutral si no tenemos país en ambos lados
  const countryAF = (afFx?.league?.country || "").toLowerCase().trim();
  const countryOdds = (oddsEv?.pais || "").toLowerCase().trim();
  if (countryAF && countryOdds) countryScore = countryAF === countryOdds ? 1 : 0;

  const finalScore =
    w.wNames * namesScore +
    w.wTime * timeScore +
    w.wLeague * leagueScore +
    w.wCountry * countryScore;

  return {
    score: +finalScore.toFixed(6),
    breakdown: {
      namesScore: +namesScore.toFixed(6),
      directNames: +directNames.toFixed(6),
      swappedNames: +swappedNames.toFixed(6),
      timeScore: +timeScore.toFixed(6),
      leagueScore: +leagueScore.toFixed(6),
      countryScore: +countryScore.toFixed(6),
    },
  };
}

// ---------- Selección del mejor candidato ----------
function chooseBestCandidate(oddsEv, afCandidates, opts = {}) {
  const threshold = typeof opts.minScore === "number" ? opts.minScore : MIN_SCORE;
  if (!Array.isArray(afCandidates) || afCandidates.length === 0) {
    return { best: null, score: 0, reason: "no_candidates" };
  }

  // Calcular score para cada candidato
  const scored = afCandidates.map((fx) => {
    const r = scoreOddsEventVsAFFixture(oddsEv, fx, opts);
    return { fx, score: r.score, breakdown: r.breakdown };
  });

  // Ordenar descendente por score; si empatan, preferir fecha más cercana
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ka = Math.abs(Date.parse(oddsEv.commence_time || 0) - Date.parse(a.fx?.fixture?.date || 0));
    const kb = Math.abs(Date.parse(oddsEv.commence_time || 0) - Date.parse(b.fx?.fixture?.date || 0));
    return ka - kb;
  });

  const top = scored[0];
  if (!top || top.score < threshold) {
    return { best: null, score: top ? top.score : 0, reason: "below_threshold", debug: scored.slice(0, 3) };
  }
  return { best: top.fx, score: top.score, debug: scored.slice(0, 3) };
}

// ---------- Índices opcionales (si tienes listas grandes) ----------
function buildAFIndex(afFixtures) {
  // Índice simple por primer token de home y away normalizados para cortar el espacio de búsqueda
  const idx = Object.create(null);
  const push = (key, item) => {
    if (!key) return;
    if (!idx[key]) idx[key] = [];
    idx[key].push(item);
  };
  for (const fx of afFixtures || []) {
    const h = normalizeTeamName(fx?.teams?.home?.name || "").split(" ")[0] || "";
    const a = normalizeTeamName(fx?.teams?.away?.name || "").split(" ")[0] || "";
    push(h, fx);
    push(a, fx);
  }
  return idx;
}

function findCandidatesFromIndex(idx, oddsEv) {
  if (!idx) return [];
  const keys = [];
  const h = (normalizeTeamName(oddsEv.home).split(" ")[0] || "").trim();
  const a = (normalizeTeamName(oddsEv.away).split(" ")[0] || "").trim();
  if (h) keys.push(h);
  if (a && a !== h) keys.push(a);
  const set = new Set();
  for (const k of keys) {
    for (const fx of idx[k] || []) set.add(fx);
  }
  return Array.from(set);
}

// ---------- API pública ----------
module.exports = {
  // utilidades
  normalizeTeamName,
  jaccard,
  tokenize,
  // scoring y elección
  scoreOddsEventVsAFFixture,
  chooseBestCandidate,
  // indexación opcional
  buildAFIndex,
  findCandidatesFromIndex,
  // export del umbral (por si se quiere loguear)
  MIN_SCORE,
};
