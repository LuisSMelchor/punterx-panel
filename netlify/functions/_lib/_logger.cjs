// netlify/functions/_logger.cjs
'use strict';

function nowIso() { return new Date().toISOString(); }
function pad(n){return (n<10?'0':'')+n;}

function ms(start) { return Date.now() - start; }

function fmtSecs(ms) {
  if (ms < 1000) return ms + ' ms';
  const s = Math.floor(ms/1000); const r = ms % 1000;
  return s + 's ' + r + 'ms';
}

function createLogger(traceId) {
  const id = traceId || ('trace-' + Math.random().toString(36).slice(2,8));
  const base = (lvl, args) => {
    const ts = nowIso();
    // eslint-disable-next-line no-console
    console[lvl](`[${ts}] ${id} ${lvl.toUpperCase()}:`, ...args);
  };
  return {
    id,
    time: () => Date.now(),
    timeEnd: (start, label) => base('log', [`⏱️ ${label}:`, fmtSecs(ms(start))]),
    info: (...args) => base('log', args),
    warn: (...args) => base('warn', args),
    error: (...args) => base('error', args),
    section: (title) => base('log', [`\n=== ${title} ===`]),
    fmtSecs
  };
}

module.exports = { createLogger, fmtSecs };
