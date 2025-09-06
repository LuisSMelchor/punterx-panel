'use strict';

function getHeaders(event){
  const raw = (event && event.headers) || {};
  const h = {};
  for (const k in raw) h[k.toLowerCase()] = raw[k];
  return h;
}
function isDebug(event){
  const q = (event && event.queryStringParameters) || {};
  const h = getHeaders(event);
  return q.debug === '1' || h['x-debug'] === '1';
}

exports.handler = async function(event, context){
  const q = (event && event.queryStringParameters) || {};

  // Early ping para debug
  if (isDebug(event) && (q.ping === '1' || ('ping' in q))) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok:true, stage:'early-ping', who: 'diag-impl-call' })
    };
  }

  // Carga del impl
  let impl;
  try {
    impl = require('./_lib/autopick-vip-nuevo-impl.cjs');
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok:false, fatal:true, stage:'require', error: (e && e.message) || String(e) })
    };
  }

  if (!impl || typeof impl.handler !== 'function') {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok:false, fatal:true, stage:'impl', error: 'impl.handler no encontrado' })
    };
  }

  try {
    const res = await impl.handler(event, context);
    if (res && typeof res === 'object' && 'statusCode' in res && 'body' in res) return res;
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(res ?? { ok:true })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok:false, stage:'impl.call', error: (e && e.message) || String(e) })
    };
  }
};
