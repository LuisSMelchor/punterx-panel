"use strict";

/**
 * checkEnv(required, opts)
 * required: string[] de nombres de ENV
 * opts: { prefix?: string, strict?: boolean }
 * - Lanza Error si falta una ENV (strict=true por defecto)
 * - Retorna { ok, missing[] } si strict=false
 * - Nunca imprime valores; solo nombres.
 */
function checkEnv(required, opts = {}) {
  const strict = opts.strict !== false;
  const prefix = opts.prefix || "[ENV]";
  const missing = [];

  for (const name of required) {
    const v = process.env[name];
    if (!v || String(v).trim() === "") missing.push(name);
  }

  if (missing.length > 0) {
    const msg = `${prefix} faltan variables: ${missing.join(", ")}`;
    if (strict) {
      const err = new Error(msg);
      err.code = "ENV_MISSING";
      err.missing = missing;
      throw err;
    }
    return { ok: false, missing };
  }
  return { ok: true, missing: [] };
}

module.exports = { checkEnv };
