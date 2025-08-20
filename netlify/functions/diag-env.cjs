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
      now: new Date().toISOString(),
      env: envDump
    }, null, 2)
  };
};
