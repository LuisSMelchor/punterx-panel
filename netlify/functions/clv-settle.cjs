'use strict';

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// util segura
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchClosePrice(row) {
  // row contiene: league, teams, snapshot_odds { market, selection, bookmaker_best, price_sent, ts_sent }
  const snap = row.snapshot_odds || {};
  if (!snap.market || !snap.selection) return null;

  // Llama a OddsAPI para el MISMO mercado/selección del evento
  // *** Ajusta el endpoint según tu implementación actual de odds ***
  // Aquí un ejemplo genérico para obtener el mejor precio actual (cierre aprox):
  const url = `https://api.the-odds-api.com/v4/sports/${row.sport_key || 'soccer'}/odds/?regions=eu&markets=${encodeURIComponent(snap.market)}&apiKey=${ODDS_API_KEY}`;
  try {
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) return null;
    const data = await res.json();

    // Busca el evento por id/teams y el mercado por key
    const evt = Array.isArray(data) ? data.find(e =>
      (e.id && row.oddsapi_event_id && e.id === row.oddsapi_event_id) ||
      ((e.home_team === row.home_team && e.away_team === row.away_team) ||
       (e.home_team === row.away_team && e.away_team === row.home_team))
    ) : null;
    if (!evt) return null;

    const mkt = (evt.bookmakers || [])
      .flatMap(bm => (bm.markets || []).map(m => ({ bm, m })))
      .find(x => x.m.key === snap.market);
    if (!mkt) return null;

    // Mejor precio actual para la selección
    const outcome = (mkt.m.outcomes || []).find(o =>
      (o.name || '').toLowerCase() === (snap.selection || '').toLowerCase()
    );
    if (!outcome || !outcome.price) return null;

    return Number(outcome.price) || null;
  } catch (e) {
    console.error('[clv-settle] fetchClosePrice error', e?.message || e);
    return null;
  }
}

exports.handler = async () => {
  const started = Date.now();
  const resumen = { toCheck: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    // Buscar picks recientes SIN cerrar (sin price_close)
    const { data, error } = await sb
      .from('picks_historicos')
      .select('id, sport_key, oddsapi_event_id, home_team, away_team, snapshot_odds, hora_inicio')
      .is('price_close', null)
      .gte('hora_inicio', new Date(Date.now() - 8 * 3600 * 1000).toISOString())  // últimas 8h
      .lte('hora_inicio', new Date(Date.now() + 1 * 3600 * 1000).toISOString())  // hasta +1h
      .limit(1000);

    if (error) {
      console.error('[clv-settle] supabase select error', error);
      return { statusCode: 200, body: JSON.stringify({ send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
ok: false, stage: 'select', error: String(error) }) };
    }

    const rows = Array.isArray(data) ? data : [];
    resumen.toCheck = rows.length;

    for (const row of rows) {
      const priceClose = await fetchClosePrice(row);
      if (!priceClose) { resumen.skipped++; continue; }

      const priceSent = Number(row.snapshot_odds?.price_sent || 0) || 0;
      const clv = priceClose > 0 && priceSent > 0 ? (priceSent / priceClose) : null;
      const beat = clv != null ? clv > 1 : null;

      const { error: upErr } = await sb
        .from('picks_historicos')
        .update({
          price_close: priceClose,
          clv,
          beat_close: beat,
          settled_at: new Date().toISOString()
        })
        .eq('id', row.id);

      if (upErr) { resumen.errors++; console.error('[clv-settle] update error', upErr); }
      else { resumen.updated++; }

      await sleep(300); // backoff leve
    }

    console.log('[clv-settle] resumen', resumen, 'ms=', Date.now() - started);
    return { statusCode: 200, body: JSON.stringify({ send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
ok: true, resumen }) };
  } catch (e) {
    console.error('[clv-settle] fatal', e?.message || e);
    return { statusCode: 200, body: JSON.stringify({ send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
ok: false, stage: 'fatal', error: String(e) }) };
  }
};
