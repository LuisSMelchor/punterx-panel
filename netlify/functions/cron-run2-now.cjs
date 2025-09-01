'use strict';

const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const json = (code,obj)=>({statusCode:code,headers:{'content-type':'application/json'},body:JSON.stringify(obj)});

exports.handler = async () => {
  const site = process.env.URL || process.env.DEPLOY_URL || "https://punterx-panel-vip.netlify.app";
  const auth = process.env.AUTH_CODE || "";
  const url  = `${site}/.netlify/functions/autopick-vip-run2?manual=1&debug=1`;

  const res  = await fetch(url, { headers: { 'x-auth-code': auth }});
  const body = await res.text();
  let parsed = null; try { parsed = JSON.parse(body) } catch {}
  return json(200, { ok:true, proxied:true, status:res.status, body: parsed ?? body.slice(0,600) });
};
