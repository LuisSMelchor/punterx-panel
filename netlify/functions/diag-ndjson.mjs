import { loadWindowNdjson, parseNdjsonToArray } from "./_lib/snapshot-loader.mjs";

export default async (req) => {
  const k = new URL(req.url).searchParams.get('k') || 'mkt'; // mkt|bets
  const txt = await loadWindowNdjson(k);
  const head = String(txt || '').split(/\r?\n/).slice(0, 5);
  const arr = parseNdjsonToArray(txt);
  return Response.json({
    ok: true,
    kind: k,
    text_len: typeof txt === 'string' ? txt.length : null,
    head_lines: head,
    parsed_len: Array.isArray(arr) ? arr.length : null,
    sample_first: arr && arr[0] || null
  }, { status: 200 });
};
