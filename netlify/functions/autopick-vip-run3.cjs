'use strict';
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'content-type':'application/json' },
  body: JSON.stringify({ ok:true, stage:'run3.smoke' })
});
