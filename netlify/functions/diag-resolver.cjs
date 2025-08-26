exports.handler = async () => {
  const { AF_DEBUG=0, AF_METRICS=0, MATCH_RESOLVE_CONFIDENCE=0.80, SIM_THR=0.60, TIME_PAD_MIN=90 } = process.env;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      name: 'diag-resolver',
      ok: true,
      env: {
        AF_DEBUG: Number(AF_DEBUG),
        AF_METRICS: Number(AF_METRICS),
        MATCH_RESOLVE_CONFIDENCE: Number(MATCH_RESOLVE_CONFIDENCE),
        SIM_THR: Number(SIM_THR),
        TIME_PAD_MIN: Number(TIME_PAD_MIN),
      },
      ts: new Date().toISOString(),
    })
  };
};
