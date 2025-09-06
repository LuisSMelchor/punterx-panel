'use strict';
const path = require('path');

function getHeaders(event){
  const raw = (event && event.headers) || {};
  const h = {}; for (const k in raw) h[k.toLowerCase()] = raw[k];
  return h;
}
function isDebug(event){
  const q = (event && event.queryStringParameters) || {};
  const h = getHeaders(event);
  // Solo detecta modo debug (no valida token aquí)
  return (q.debug === '1') || (h['x-debug'] === '1');
}
function isAllowed(event){
  // Gating seguro: requiere debug activo + coincidencia exacta de token
  const h = getHeaders(event);
  const token = process.env.DEBUG_TOKEN || "";
  if (!token) return false;
  return isDebug(event) && (h['x-debug-token'] === token);
}

function respond(body, code = 200){
  let b;
  try { b = (typeof body === 'string') ? body : JSON.stringify(body ?? { ok:true }); }
  catch { b = JSON.stringify({ ok:false, stage:'serialize', error:'non-serializable result' }); }
  return { statusCode: code, headers: { 'content-type': 'application/json; charset=utf-8' }, body: b };
}

function resolveImpl(){
  const candidates = [
    path.join(__dirname, '_lib', 'autopick-vip-nuevo-impl.cjs'),
    path.join(process.cwd(), 'netlify', 'functions', '_lib', 'autopick-vip-nuevo-impl.cjs'),
  ];
  const tried = [];
  let mod = null, resolved = null;
  for (const c of candidates) {
    try { const m = require(c); if (m) { mod = m; resolved = c; break; } }
    catch (e) { tried.push({ path: c, error: String(e) }); }
  }
  return { mod, resolved, candidates, tried };
}

async function callImpl(event, context){
  const { mod, resolved, candidates, tried } = resolveImpl();
  if (!mod || typeof mod !== 'object' || typeof mod.handler !== 'function') {
    return respond({ ok:false, fatal:true, stage:'impl', error:'impl.handler no encontrado', resolved, tried }, 500);
  }

  try {
    const res = await mod.handler(event, context);

    // Netlify-style { statusCode, body, headers? }
    if (res && typeof res === 'object' && 'statusCode' in res && 'body' in res) {
      let status = Number(res.statusCode) || 200;
      const headers = Object.assign({ 'content-type':'application/json; charset=utf-8' }, res.headers || {});

      if (typeof res.body === 'string') {
        const text = res.body;
        // ¿ya es JSON?
        try {
          const parsed = JSON.parse(text);
          return { statusCode: status, headers, body: JSON.stringify(parsed) };
        } catch {
          // Mapea "Forbidden" textual a 403
          if (/^forbidden$/i.test(text.trim())) status = 403;
          const payload = { ok: status < 400, raw: text };
          return { statusCode: status, headers, body: JSON.stringify(payload) };
        }
      }
      // body objeto -> devuélvelo tal cual (JSON) con normalización robusta forbidden/auth -> 403
const obj = (res.body == null) ? { ok:true } : res.body;
let outStatus = status;
try {
  const err   = String(obj && (obj.error ?? obj.raw ?? '')).toLowerCase();
  const stage = String(obj && (obj.stage ?? '')).toLowerCase();
  const reas  = String(obj && (obj.reason ?? '')).toLowerCase();
  const isForbidden =
    err === 'forbidden' || err === 'forbidden' ||
    (obj && obj.ok === false && stage === 'auth') ||
    reas.includes('auth') || reas.includes('forbidden');
  if (isForbidden) outStatus = 403;
} catch (_) {}
return { statusCode: outStatus, headers, body: JSON.stringify(obj) };
    }

    // No es Netlify-style: si es objeto, pásalo; si es primitivo, booleanízalo
const payload = (res && typeof res === 'object') ? res : { ok: !!res };
// Normalización robusta forbidden/auth -> 403
let codeNL = 200;
try {
  const err   = String(payload && (payload.error ?? payload.raw ?? '')).toLowerCase();
  const stage = String(payload && (payload.stage ?? '')).toLowerCase();
  const reas  = String(payload && (payload.reason ?? '')).toLowerCase();
  const isForbidden =
    err === 'forbidden' ||
    (payload && payload.ok === false && stage === 'auth') ||
    reas.includes('auth') || reas.includes('forbidden');
  if (isForbidden) codeNL = 403;
} catch (_) {}
return respond(payload, codeNL);
} catch (e) {
    return respond({ ok:false, stage:'impl.call', error: (e && e.message) || String(e) }, 500);
  }
}

exports.handler = async function(event, context){
  const q = (event && event.queryStringParameters) || {};
  const allowed = isAllowed(event);

  // 1) ping
  if (isDebug(event) && (q.ping === '1' || ('ping' in q))) {
    return respond({ ok:true, stage:'early-ping', who:'autopick-vip-run3' });
  }

  // 2) inspect
  if (("inspect" in q) && allowed) {
    const info = resolveImpl();
    return respond({
      ok: true,
      __dirname,
      cwd: process.cwd(),
      resolved: info.resolved,
      candidates: info.candidates,
      tried: info.tried,
      type: typeof info.mod,
      keys: info.mod ? Object.keys(info.mod) : [],
      hasHandler: !!(info.mod && info.mod.handler),
    });
  }

  // 3) bypass (passthrough normalizado SIEMPRE JSON)
  if (("bypass" in q) && allowed) {
    return await callImpl(event, context);
  }

  // 4) default -> 403 JSON
  return respond({ ok:false, error:'forbidden' }, 403);
};
