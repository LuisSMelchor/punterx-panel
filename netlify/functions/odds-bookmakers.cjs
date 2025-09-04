'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
// Handler mínimo para evitar 404 en prod; reemplázalo por la lógica real.
// Lee ?evt=... (URL-encoded JSON) y responde estructura esperada.
module.exports.handler = async (event) => {
  const __send_report = (() => { const en=(String(process.env.SEND_ENABLED)==='1'); const base={ enabled: en, results:(typeof send_report!=='undefined'&&send_report&&Array.isArray(send_report.results))?send_report.results:[] }; if(en&&typeof message_vip!=='undefined'&&message_vip&&!process.env.TG_VIP_CHAT_ID) base.missing_vip_id=true; if(en&&typeof message_free!=='undefined'&&message_free&&!process.env.TG_FREE_CHAT_ID) base.missing_free_id=true; return base; })();
const qs = (event && event.queryStringParameters) || {};
  const evtRaw = qs.evt || '';
  let evt = null;
  try { evt = evtRaw ? JSON.parse(decodeURIComponent(evtRaw)) : null; } catch (_) {}

  // Estructura base de respuesta (vacía): { bookmakers: [] }
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ok: true, evt, bookmakers: [] }),
  };
};
