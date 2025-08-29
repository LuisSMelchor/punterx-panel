exports.handler = async () => {
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
      send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
now: new Date().toISOString(),
      env: envDump
    }, null, 2)
  };
};
