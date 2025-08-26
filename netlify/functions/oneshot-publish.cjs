const enrich = require('./_lib/enrich.cjs');
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');

const buildOneShot = enrich.oneShotPayload || enrich.buildOneShotPayload;

async function publishToTelegram(payload) {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_VIP_ID || process.env.TELEGRAM_CHANNEL_ID;
  if (!bot || !chatId) return { ok: false, reason: 'missing_telegram_env' };

  const text = [
    '🎯 *One-Shot Preview*',
    `*Liga:* ${payload?.league || payload?.enriched?.league || '-'}`,
    `*Partido:* ${payload?.evt?.home || '-'} vs ${payload?.evt?.away || '-'}`,
    `*Kickoff:* ${payload?.evt?.commence || payload?.enriched?.kickoff || '-'}`,
    payload?.when_text ? `*Cuando:* ${payload.when_text}` : null,
  ].filter(Boolean).join('\n');

  const url = `https://api.telegram.org/bot${bot}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const json = await res.json().catch(() => ({}));
  return { ok: Boolean(json?.ok), response: json };
}

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || new Date(Date.now() + 60*60*1000).toISOString(),
    };

    let match = {};
    try { match = await resolveTeamsAndLeague(evt, {}); }
    catch (e) { match = { ok: false, method: 'none', reason: 'resolver_error', error: e?.message }; }

    const fixture = {
      fixture_id: match?.fixture_id ?? null,
      kickoff: evt.commence,
      league_id: match?.league_id ?? null,
      league_name: match?.league_name ?? evt.league,
      country: match?.country ?? null,
      home_id: match?.home_id ?? null,
      away_id: match?.away_id ?? null,
    };

    const enriched = await enrich.enrichFixtureUsingOdds({ fixture });
    const payload = await buildOneShot({ evt, match, enriched });

    // Si no hay credenciales de Telegram, no publicamos (preview)
    const canPublish = !!(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_VIP_ID || process.env.TELEGRAM_CHANNEL_ID));
    if (!canPublish) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ published: false, preview: true, reason: 'missing_telegram_env', payload }, null, 2),
      };
    }

    const pub = await publishToTelegram(payload);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published: pub.ok, preview: false, payload, publish_result: pub }, null, 2),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: e?.message || String(e) }),
    };
  }
};
