import { loadNdjson, parseNdjsonToArray, diagWindow } from './_lib/snapshot-loader.mjs'

export default async (req, context) => {
  const WIN_MIN = parseInt(process.env.WIN_MIN || '40', 10)
  const WIN_MAX = parseInt(process.env.WIN_MAX || '55', 10)

  const evMktBlobKey  = process.env.EV_MKT_BLOB_KEY  || 'ev.market.ndjson'
  const evBetsBlobKey = process.env.EV_BETS_BLOB_KEY || 'ev.bets.ndjson'
  const evMktFile     = process.env.EV_MKT_FILE || process.env.EV_MKT || null
  const evBetsFile    = process.env.EV_BETS_FILE || process.env.EV_BETS || null
  const evMktUrl      = process.env.EV_MKT_URL || null
  const evBetsUrl     = process.env.EV_BETS_URL || null

  const [mktTxt, betsTxt] = await Promise.all([
    loadNdjson({ blobKey: evMktBlobKey, filePath: evMktFile, envUrl: evMktUrl }),
    loadNdjson({ blobKey: evBetsBlobKey, filePath: evBetsFile, envUrl: evBetsUrl }),
  ])

  const mkt  = parseNdjsonToArray(mktTxt)
  const bets = parseNdjsonToArray(betsTxt)

  // enriquecer best_price si bets no lo trae
  if (bets.length && mkt.length) {
    const map = new Map(mkt.filter(x=>x?.key && x?.best_price).map(x=>[x.key, x.best_price]))
    for (const x of bets) {
      if (x && x.key && x.best_price == null && map.has(x.key)) {
        x.best_price = map.get(x.key)
      }
    }
  }

  const report = diagWindow({ bets, mkt, winMin: WIN_MIN, winMax: WIN_MAX })

  const url = new URL(req.url)
  const raw = url.searchParams.get('raw')

  if (raw) {
    const out = []
    out.push(`----- [${report.nowISO}] window-log -----`)
    out.push(`[counts] bets=${report.counts.bets} mkt=${report.counts.mkt} matched=${report.counts.matched} coverage=${report.counts.coveragePct}%`)
    out.push(`[window] in[${WIN_MIN}..${WIN_MAX}]=${report.counts.inWindow} (${report.counts.inWindowPct}%) | oddsHas=${report.counts.oddsHas} (${report.counts.oddsPct}%)`)
    out.push(`[status] ${Object.entries(report.byStatus).map(([k,v])=>`${k}=${v}`).join(' ') || '(none)'}`)
    out.push(`[readiness] ~${report.readyPct}%`)
    out.push(`[upcoming<=+30m over max]`)
    if (report.upcoming.length===0) out.push(`  (none)`)
    for (const u of report.upcoming) out.push(`  ${u.key} | T-${u.mins_to_start} | ${u.start_iso || ''} | ${u.sport || ''}`)
    out.push(`[inside window]`)
    if (report.inside.length===0) out.push(`  (none)`)
    for (const w of report.inside) out.push(`  ${w.key} | T-${w.mins_to_start} | pick=${w.pick || ''} | ${w.sport || ''}`)
    return new Response(out.join('\n')+'\n', { headers: { 'content-type': 'text/plain; charset=utf-8' }})
  }

  return Response.json(report, { status: 200 })
}
