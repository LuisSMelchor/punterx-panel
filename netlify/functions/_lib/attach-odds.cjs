'use strict';

// Adjunta bookmakers a results haciendo llamado in-process a diag-odds-events.cjs
// Uso: await attachOddsForResults(results, { max: 20, concurrency: 4, timeoutMs: 8000 })

async function attachOddsForResults(results = [], opts = {}) {
  const max = Number(opts.max) || 20;
  const concurrency = Math.max(1, Number(opts.concurrency) || 4);
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || 8000);

  const diag = require('../diag-odds-events.cjs');
  const slice = results.slice(0, max);

  // pequeña cola con concurrencia fija
  const queue = [...slice];
  const runners = new Array(concurrency).fill(null).map(() => worker());
  await Promise.all(runners);
  return results;

  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      if (!r || !r.evt) continue;
      try {
        const qs = {
          home: r.evt.home,
          away: r.evt.away,
          league: r.evt.league,
          commence: r.evt.commence
        };
        const ev = { queryStringParameters: qs };
        const p = withTimeout(diag.handler(ev), timeoutMs);
        const res = await p;
        let body;
        try { body = JSON.parse(res && res.body || '{}'); } catch { body = {}; }

        // buscamos array de bookmakers en respuestas típicas
        const bak = (
          body?.bookmakers ||
          body?.event?.bookmakers ||
          body?.data?.bookmakers ||
          null
        );

        if (Array.isArray(bak) && bak.length) {
          // adjunta sin romper estructura
          r.bookmakers = bak;
          // nota: no pisamos r.oddsapi/r.raw si existen
        }
      } catch (e) {
        // silencioso; seguimos con el resto
      }
    }
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('attachOdds timeout')), ms);
      promise.then(v => { clearTimeout(t); resolve(v); },
                   e => { clearTimeout(t); reject(e); });
    });
  }
}

module.exports = { attachOddsForResults };
