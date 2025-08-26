'use strict';
const https = require('https');

function hasCreds() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE);
}

function _postJson(url, headers, bodyObj) {
  const payload = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: j });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Inserta un registro en la tabla picks_historicos.
 * No-op si faltan credenciales, o si ev<10, o si campos críticos están incompletos.
 */
async function savePickIfValid(row) {
  // Validaciones mínimas:
  if (!row) return { ok: false, reason: 'row_null' };
  const ev = Number(row.ev);
  const prob = Number(row.probabilidad);
  const crit =
    row.evento && row.analisis && row.apuesta && row.tipo_pick &&
    row.liga && row.equipos && Number.isFinite(ev) && Number.isFinite(prob);

  if (!crit) return { ok: false, reason: 'incomplete_fields' };
  if (ev < 10) return { ok: false, reason: 'ev_below_threshold' };
  if (!hasCreds()) return { ok: false, reason: 'no_creds' };

  const url = `${process.env.SUPABASE_URL}/rest/v1/${process.env.SUPABASE_TABLE || 'picks_historicos'}`;
  const headers = {
    'apikey': process.env.SUPABASE_SERVICE_ROLE,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
    'Prefer': 'return=representation'
  };
  const { status, data } = await _postJson(url, headers, [row]);
  const ok = status >= 200 && status < 300;
  return { ok, status, data };
}

module.exports = { savePickIfValid };
