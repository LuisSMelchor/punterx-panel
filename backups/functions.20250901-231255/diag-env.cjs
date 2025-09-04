'use strict';


/*__SEND_REPORT_HOIST_V2__*/
function __send_report_base(payload = {}) {
  try {
    if (typeof global.send_report === 'function') {
      return global.send_report(payload);
    }
    return { ok: true, results: [] };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
if (typeof global.send_report !== 'function') {
  function send_report(payload = {}) { return __send_report_base(payload); }
  try { global.send_report = send_report; } catch(e) {}
}
function send_report2(base = {}, extra = {}) { return __send_report_base({ ...(base||{}), ...(extra||{}) }); }
function send_report3(base = {}, extra = {}) { return __send_report_base({ ...(base||{}), ...(extra||{}) }); }
try { global.send_report2 = send_report2; global.send_report3 = send_report3; } catch(e) {}

/*__AI_ALIAS_TOLERANT__*/
let __ai = {};
try { __ai = require('./_lib/ai.cjs'); } catch (_) {}


try { if (typeof global.callOpenAIOnce === 'undefined') global.callOpenAIOnce = callOpenAIOnce; } catch(e) {}

exports.handler = async () => {
  const __send_report = (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!null  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!null && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})();
const keys = [
    "LOG_VERBOSE",
    "DEBUG_TRACE",
    "STRICT_MATCH",
    "SPORT_KEY",
    "ODDS_API_KEY",
    "ODDS_REGIONS",
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "OPENAI_API_KEY"
  ];

  const envDump = {};
  keys.forEach(k => {
    envDump[k] = process.env[k] ? "(set)" : "(MISSING)";
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      send_report: __send_report,
now: new Date().toISOString(),
      env: envDump
    }, null, 2)
  };
};
