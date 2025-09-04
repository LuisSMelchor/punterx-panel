function parseWeights(qs = {}, env = {}) {
  const f = (k, d) => {
    const v = qs[k] ?? env['PICK_' + k.toUpperCase()] ?? d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const w1 = f('w1', 0.70), w2 = f('w2', 0.15), w3 = f('w3', 0.10), w4 = f('w4', 0.05);
  const sum = w1 + w2 + w3 + w4;
  // Normaliza si no suman ~1
  return (sum > 0.0001) ? { w1: w1/sum, w2: w2/sum, w3: w3/sum, w4: w4/sum } : { w1:0.7, w2:0.15, w3:0.10, w4:0.05 };
}

function addClientScore(results = [], weights) {
  const w = weights;
  return results.map(r => {
    const s1x2 = Number(r.score_1x2) || 0;
    const sbtts= Number(r.score_btts) || 0;
    const sou25= Number(r.score_ou25) || 0;
    const sdnb = Number(r.score_dnb ) || 0;
    const score_client = (w.w1*s1x2) + (w.w2*sbtts) + (w.w3*sou25) + (w.w4*sdnb);
    return { ...r, score_client };
  }).sort((a,b) => (b.score_client||0) - (a.score_client||0));
}

module.exports = { parseWeights, addClientScore };
