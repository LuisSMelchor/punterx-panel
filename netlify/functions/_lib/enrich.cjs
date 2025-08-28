'use strict';

// Carga condicional: si no existe odds-helpers.cjs, usamos fallback local
let guessSportKeyFromLeague = null;
try {
  ({ guessSportKeyFromLeague } = require('./odds-helpers.cjs'));
} catch (_) {
  guessSportKeyFromLeague = (leagueName) => {
    const s = String(leagueName || '').toLowerCase();
    // fallback simple para fútbol europeo
    if (s.includes('premier') || s.includes('la liga') || s.includes('serie') || s.includes('bundes')) return 'soccer';
    return process.env.ODDS_SPORT_KEY || 'soccer';
  };
}

/**
 * One-shot: obtiene cuotas para un fixture usando OddsAPI.
 * Espera { home_name, away_name, league_name }.
 * Devuelve objeto oddsData (v4 /events/:id/odds) o null.
 * Nunca lanza: atrapa errores y retorna null para no romper el flujo.
 */
async function fetchOddsForFixture(fixture = {}) {
  try {
    if (!process.env.ODDS_API_KEY) return null;

    const home = String(fixture.home_name || '').trim().toLowerCase();
    const away = String(fixture.away_name || '').trim().toLowerCase();
    if (!home || !away) return null;

    const sportKey =
      (guessSportKeyFromLeague && guessSportKeyFromLeague(fixture.league_name)) ||
      process.env.ODDS_SPORT_KEY ||
      'soccer';

    const regions = encodeURIComponent(process.env.ODDS_REGIONS || 'us,uk,eu,au');
    const apiKey  = encodeURIComponent(process.env.ODDS_API_KEY);

    // 1) obtener eventos próximos
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events?apiKey=${apiKey}&regions=${regions}`;
    const eventsRes = await fetch(eventsUrl);
    if (!eventsRes.ok) return null;
    const events = await eventsRes.json();
    if (!Array.isArray(events) || events.length === 0) return null;

    // 2) matching sencillo por home/away (case-insensitive, substring)
    const ev = events.find(ev =>
      String(ev?.home_team || '').toLowerCase().includes(home) &&
      String(ev?.away_team || '').toLowerCase().includes(away)
    );
    if (!ev?.id) return null;

    // 3) obtener cuotas del evento
    const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${ev.id}/odds?apiKey=${apiKey}&regions=${regions}&markets=h2h,spreads,totals`;
    const oddsRes = await fetch(oddsUrl);
    if (!oddsRes.ok) return null;
    const oddsData = await oddsRes.json();
    return oddsData || null;
  } catch (_e) {
    return null;
  }
}

module.exports = {
  fetchOddsForFixture,
};
