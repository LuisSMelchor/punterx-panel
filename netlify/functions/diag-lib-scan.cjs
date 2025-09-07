// netlify/functions/diag-lib-scan.cjs
// Lista archivos del bundle (LAMBDA_TASK_ROOT o __dirname) con filtro glob básico.
'use strict';

const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

function toRegexFromGlob(glob) {
  if (!glob) return null;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // normaliza separadores y convierte * -> .*
  const pat = '^' + esc(String(glob).replace(/\\/g, '/')).replace(/\\\*/g, '.*') + '$';
  return new RegExp(pat);
}

function walk(dir, maxDepth = 5, prefix = '', acc = []) {
  const fs = require('fs');
  const path = require('path');
  if (maxDepth < 0) return acc;

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const rel  = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (['node_modules', '.netlify', '.git'].includes(ent.name)) continue;
      walk(full, maxDepth - 1, rel, acc);
    } else {
      acc.push(rel);
    }
  }
  return acc;
}

exports.handler = async (event) => {
  const path = require('path');
  const qs = (event && event.queryStringParameters) || {};

  const base = process.env.LAMBDA_TASK_ROOT || __dirname;
  const root = qs.dir ? path.resolve(base, qs.dir) : base;
  const depth = Number(qs.depth || 5);

  const all = walk(root, depth);
  const regex = toRegexFromGlob(qs.glob && String(qs.glob).replace(/^\.?\//,''));
  const matches = regex ? all.filter(p => regex.test(p.replace(/\\/g, '/'))) : all;

  return __json(200, {
    ok: true,
    dir: root,
    __dirname,
    LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT || null,
    total: all.length,
    filtered: matches.length,
    matches,
  });
};
