// snapshot-loader.mjs (tolerante a blobs/archivo/url)
let getStoreOpt = null
try {
  const mod = await import('@netlify/blobs')
  getStoreOpt = mod?.getStore || null
} catch { /* opcional en local */ }

export async function loadNdjson({ blobKey, filePath, envUrl }) {
  // 1) Netlify Blobs (si existe lib y store)
  if (getStoreOpt && blobKey) {
    try {
      const store = getStoreOpt('punterx-store')
      const blob = await store.get(blobKey, { type: 'text' })
      if (blob && blob.trim()) return blob
    } catch { /* sigue */ }
  }
  // 2) Archivo local (netlify dev)
  if (filePath) {
    try {
      const fs = await import('node:fs/promises')
      const txt = await fs.readFile(filePath, 'utf8')
      if (txt && txt.trim()) return txt
    } catch { /* sigue */ }
  }
  // 3) URL externa (si la config la provee)
  if (envUrl) {
    try {
      const res = await fetch(envUrl, { timeout: 5000 })
      if (res.ok) {
        const txt = await res.text()
        if (txt && txt.trim()) return txt
      }
    } catch { /* sigue */ }
  }
  return null
}

export function parseNdjsonToArray(ndtxt) {
  if (!ndtxt) return []
  return ndtxt.split(/\r?\n/)
    .map(l => l.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

export function diagWindow({ bets, mkt, winMin=40, winMax=55 }) {
  const nowISO = new Date().toISOString()

  const keySet = new Set(bets.filter(x=>x?.key).map(x=>x.key))
  const mktKey = new Set(mkt.filter(x=>x?.key).map(x=>x.key))
  const matched = [...keySet].filter(k=>mktKey.has(k))
  const coverage = keySet.size ? Math.round(100*matched.length/keySet.size) : 0

  const minsRows = bets.filter(x=>Number.isFinite(x?.mins_to_start))
  const inWin = minsRows.filter(x=>x.mins_to_start>=winMin && x.mins_to_start<=winMax)
  const inPct = minsRows.length ? Math.round(100*inWin.length/minsRows.length) : 0

  const oddsHas = bets.filter(x=>x && x.best_price!=null).length
  const oddsPct = bets.length ? Math.round(100*oddsHas/bets.length) : 0

  const upcoming = bets.filter(x=>{
    const t = x?.mins_to_start
    return Number.isFinite(t) && t > winMax && t <= (winMax+30)
  })

  const inside = bets.filter(x=>{
    const t = x?.mins_to_start
    return Number.isFinite(t) && t >= winMin && t <= winMax
  })

  const byStatus = bets.reduce((acc,x)=>{
    const s = x?.status || 'unknown'
    acc[s] = (acc[s]||0)+1
    return acc
  },{})

  // readiness orientativo para matching+picks
  const readyPct = Math.round(0.45*coverage + 0.35*oddsPct + 0.20*inPct)

  return {
    nowISO, winMin, winMax,
    counts: {
      bets: bets.length, mkt: mkt.length,
      matched: matched.length, coveragePct: coverage,
      inWindow: inWin.length, inWindowPct: inPct,
      oddsHas, oddsPct
    },
    byStatus,
    upcoming: upcoming.slice(0,40).map(x=>({
      key:x.key, mins_to_start:x.mins_to_start, start_iso:x.start_iso, sport:x.sport
    })),
    inside: inside.slice(0,80).map(x=>({
      key:x.key, mins_to_start:x.mins_to_start, pick:x?.pick?.outcome, sport:x.sport
    })),
    readyPct
  }
}
