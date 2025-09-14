export default async () => {
  const E = process.env || {};
  const mask = (v) => !!v;
  const len  = (v) => (typeof v === 'string' ? v.length : null);
  const out = {
    ok: true,
    now: new Date().toISOString(),
    EV_MKT_URL_SET:      mask(E.EV_MKT_URL),
    EV_BETS_URL_SET:     mask(E.EV_BETS_URL),
    EV_MKT_BLOB_KEY_SET: mask(E.EV_MKT_BLOB_KEY),
    EV_BETS_BLOB_KEY_SET:mask(E.EV_BETS_BLOB_KEY),
    _lens: {
      EV_MKT_URL:       len(E.EV_MKT_URL),
      EV_BETS_URL:      len(E.EV_BETS_URL),
      EV_MKT_BLOB_KEY:  len(E.EV_MKT_BLOB_KEY),
      EV_BETS_BLOB_KEY: len(E.EV_BETS_BLOB_KEY),
    }
  };
  return Response.json(out, { status: 200 });
};
