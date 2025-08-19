// netlify/functions/admin-grant-vip.cjs
'use strict';

const { grantVipByTgId, revokeVipByTgId } = require('./_users.cjs');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    const { AUTH_CODE } = process.env;
    const body = JSON.parse(event.body || '{}');
    if (!AUTH_CODE || body.auth !== AUTH_CODE) {
      return { statusCode: 401, body: 'Unauthorized' };
    }
    const { tg_id, action, plan_code='VIP', days=30 } = body;
    if (!tg_id || !action) return { statusCode: 400, body: 'tg_id y action requeridos' };

    if (action === 'grant') {
      const ok = await grantVipByTgId(tg_id, { plan_code, days });
      return { statusCode: 200, body: JSON.stringify({ ok }) };
    }
    if (action === 'revoke') {
      const ok = await revokeVipByTgId(tg_id);
      return { statusCode: 200, body: JSON.stringify({ ok }) };
    }
    return { statusCode: 400, body: 'action inválida' };
  } catch (e) {
    return { statusCode: 500, body: e?.message || 'error' };
  }
};
