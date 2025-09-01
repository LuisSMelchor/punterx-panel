'use strict';

exports.handler = async (event) => {
  const method = (event && event.httpMethod || '').toUpperCase();
  let body = null;
  if (method === 'POST' && event && event.body) {
    try { body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body; } catch (_) {}
  }
  return {
    statusCode: 200,
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ ok:true, method, echo: body })
  };
};
