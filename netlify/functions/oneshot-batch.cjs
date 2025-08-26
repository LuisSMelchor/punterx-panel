const { handler: publish } = require('./oneshot-publish.cjs');

/**
 * Orquestador batch:
 * - ?fixtures=home1,away1,league1,iso1|home2,away2,league2,iso2|...
 * - Si no se pasa, usa un set mínimo demo.
 */
exports.handler = async (event) => {
  if (process.env.FEATURE_ONESHOT !== '1') {
    return { statusCode: 200, body: JSON.stringify({ status: 'feature_off' }) };
  }
  const q = event?.queryStringParameters || {};
  const items = [];

  if (q.fixtures) {
    for (const part of q.fixtures.split('|')) {
      const [home, away, league, commence] = part.split(',');
      items.push({ home, away, league, commence });
    }
  } else {
    // Demo mínima (ajústalo a tu “script maestro” real)
    items.push({ home: 'Charlotte FC', away: 'New York Red Bulls', league: 'Major League Soccer', commence: '2025-08-24T23:00:00Z' });
  }

  const results = [];
  for (const evt of items) {
    const subEvent = { queryStringParameters: evt };
    try {
      const resp = await publish(subEvent);
      const body = JSON.parse(resp.body || '{}');
      results.push({ evt, ...body });
    } catch (e) {
      results.push({ evt, error: e?.message || String(e) });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ status: 'ok', count: results.length, results }, null, 2) };
};
