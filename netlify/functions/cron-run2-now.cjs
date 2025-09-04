'use strict';

const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const json = (code,obj)=>({statusCode:code,headers:{'content-type':'application/json'},body:JSON.stringify(obj)});

exports.handler = async () => {
  const __send_report = (() => { const en=(String(process.env.SEND_ENABLED)==='1'); const base={ enabled: en, results:(typeof send_report!=='undefined'&&send_report&&Array.isArray(send_report.results))?send_report.results:[] }; if(en&&typeof message_vip!=='undefined'&&message_vip&&!process.env.TG_VIP_CHAT_ID) base.missing_vip_id=true; if(en&&typeof message_free!=='undefined'&&message_free&&!process.env.TG_FREE_CHAT_ID) base.missing_free_id=true; return base; })();
const site = process.env.URL || process.env.DEPLOY_URL || "https://punterx-panel-vip.netlify.app";
  const auth = process.env.AUTH_CODE || "";
  const url  = `${site}/.netlify/functions/autopick-vip-run2?manual=1&debug=1`;

  const res  = await fetch(url, { headers: { 'x-auth-code': auth }});
  const body = await res.text();
  let parsed = null; try { parsed = JSON.parse(body) } catch(e) {}
  return json(200, { ok:true, proxied:true, status:res.status, body: parsed ?? body.slice(0,600) });
};
