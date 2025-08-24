'use strict';

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

const qb = v => v === '1' || v === 'true' || v === 'yes';

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const scheduled = !!((event && event.headers) || {})['x-nf-scheduled'];

  if (qb(qs.ping)) return json(200, { ok:true, ping:'autopick-vip-run2 (pong)', scheduled });
  if (qb(qs.manual)) return json(200, { ok:true, stub:true, note:'stub run2 responding (no impl)' });
  return json(200, { ok:true, msg:'stub run2 ready' });
};
