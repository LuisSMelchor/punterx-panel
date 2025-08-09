// netlify/functions/verificador-aciertos.js
// Verifica resultados de picks, registra win/lose/push y actualiza memoria_resumen.
// Nota: Evaluador simple para H2H y Totals; puedes ampliarlo según tus mercados.

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL, SUPABASE_KEY,
  API_FOOTBALL_KEY
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchWithRetry(url, opt={}, retries=2) {
  try {
    const res = await fetch(url, opt);
    if (!res.ok && retries > 0 && (res.status === 429 || (res.status >= 500 && res.status <= 599))) {
      const ra = Number(res.headers.get('retry-after') || 0);
      const d = ra > 0 ? ra*1000 : 800;
      await sleep(d);
      return fetchWithRetry(url, opt, retries-1);
    }
    return res;
  } catch (e) {
    if (retries > 0) { await sleep(600); return fetchWithRetry(url, opt, retries-1); }
    throw e;
  }
}

// ===== Supabase I/O =====
async function registrarResultadoPartido({ pick_id, evento, mercado, cuota, probabilidad, ev, resultado }) {
  try {
    await supabase.from('resultados_partidos').insert({
      pick_id, evento, mercado, cuota, probabilidad, ev, resultado
    });
  } catch (e) {
    console.error('[verificador] insert resultado error:', e?.message || e);
  }
}

async function actualizarMemoriaResumen(liga, windowDias = 30) {
  try {
    const desde = new Date(Date.now() - windowDias*24*60*60*1000).toISOString();

    const { data: picks } = await supabase
      .from('picks_historicos')
      .select('id, liga')
      .gte('timestamp', desde);

    const ids = (picks || []).filter(r => r.liga === liga).map(r => r.id);
    if (!ids.length) return;

    const { data: res } = await supabase
      .from('resultados_partidos')
      .select('pick_id, resultado, ev, mercado')
      .in('pick_id', ids);

    if (!res || !res.length) return;

    const samples = res.length;
    const wins = res.filter(r => r.resultado === 'win').length;
    const hit_rate = +(wins * 100 / samples).toFixed(2);
    const ev_prom = +((res.reduce((a,b)=>a+(b.ev||0),0) / samples) || 0).toFixed(2);

    const cnt = {};
    res.forEach(r => { cnt[r.mercado||'s/d'] = (cnt[r.mercado||'s/d']||0)+1; });
    const mercados_top = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);

    await supabase.from('memoria_resumen').upsert({
      liga, window_dias: windowDias, samples, hit_rate, ev_prom, mercados_top
    }, { onConflict: 'liga,window_dias' });
  } catch (e) {
    console.error('[verificador] memoria_resumen error:', e?.message || e);
  }
}

// ===== API-Football util =====
async function buscarFixturePorEquiposFecha(equiposTxt, fechaIso) {
  // Estrategia simple: search por equipos; si trae varios, elegimos el más cercano a fecha objetivo.
  const q = encodeURIComponent(equiposTxt.replace(' vs ', ' '));
  const url = `https://v3.football.api-sports.io/fixtures?search=${q}`;
  const res = await fetchWithRetry(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }, 2);
  if (!res?.ok) return null;
  const data = await res.json().catch(()=>null);
  const arr = data?.response || [];
  if (!Array.isArray(arr) || !arr.length) return null;

  if (!fechaIso) return arr[0];

  const target = new Date(fechaIso).getTime();
  let best = arr[0], bestDiff = Infinity;
  for (const it of arr) {
    const ts = new Date(it?.fixture?.date || it?.fixture?.timestamp*1000 || 0).getTime();
    const diff = Math.abs(ts - target);
    if (Number.isFinite(diff) && diff < bestDiff) { best = it; bestDiff = diff; }
  }
  return best;
}

function resolverResultado(mercado, apuestaTxt, fixture) {
  try {
    const goalsHome = fixture?.goals?.home ?? fixture?.score?.fulltime?.home ?? null;
    const goalsAway = fixture?.goals?.away ?? fixture?.score?.fulltime?.away ?? null;
    if (goalsHome == null || goalsAway == null) return 'push'; // desconocido

    const total = Number(goalsHome) + Number(goalsAway);
    const t = String(apuestaTxt || '').toLowerCase();

    // H2H simple
    if (t.includes('local') || t.includes('home') || t.includes('ganador') || t.includes('h2h')) {
      if (goalsHome > goalsAway) return 'win';
      if (goalsHome < goalsAway) return 'lose';
      return 'push';
    }
    if (t.includes('visitante') || t.includes('away')) {
      if (goalsAway > goalsHome) return 'win';
      if (goalsAway < goalsHome) return 'lose';
      return 'push';
    }
    if (t.includes('empate') || t.includes('draw')) {
      return (goalsHome === goalsAway) ? 'win' : 'lose';
    }

    // Totals
    const mOver = t.match(/(over|más de)\s*([0-9]+(\.[0-9]+)?)/);
    const mUnder = t.match(/(under|menos de)\s*([0-9]+(\.[0-9]+)?)/);
    if (mOver) {
      const line = parseFloat(mOver[2]);
      if (total > line) return 'win';
      if (total < line) return 'lose';
      return 'push';
    }
    if (mUnder) {
      const line = parseFloat(mUnder[2]);
      if (total < line) return 'win';
      if (total > line) return 'lose';
      return 'push';
    }

    // Spread/hándicap: simplificado — marcar push si no podemos evaluar fiablemente
    if (t.includes('hándicap') || t.includes('handicap') || t.includes('spread')) {
      return 'push';
    }

    return 'push';
  } catch { return 'push'; }
}

exports.handler = async () => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY || !API_FOOTBALL_KEY) {
      return json(500, { error: 'Config incompleta' });
    }

    // 1) Traer picks recientes (últimas 36h) que aún no tengan resultado
    const desde = new Date(Date.now() - 36*60*60*1000).toISOString();
    const { data: picks } = await supabase
      .from('picks_historicos')
      .select('id, evento, liga, equipos, apuesta, ev, probabilidad, timestamp')
      .gte('timestamp', desde)
      .order('timestamp', { ascending: false })
      .limit(80);

    const procesados = [];
    if (!Array.isArray(picks) || !picks.length) {
      return json(200, { ok: true, procesados });
    }

    for (const p of picks) {
      try {
        // Evitar duplicar si ya existe resultado
        const { data: ya } = await supabase
          .from('resultados_partidos')
          .select('id')
          .eq('pick_id', p.id)
          .limit(1);
        if (Array.isArray(ya) && ya.length) continue;

        const equiposTxt = p.equipos || (p.evento || '').split('|').pop()?.trim() || '';
        const fx = await buscarFixturePorEquiposFecha(equiposTxt, p.timestamp);
        if (!fx) continue;

        // Resolver resultado
        const resultado = resolverResultado(p.apuesta || '', p.apuesta || '', fx);
        await registrarResultadoPartido({
          pick_id: p.id,
          evento: p.evento || '',
          mercado: (p.apuesta || '').toLowerCase().includes('over') || (p.apuesta || '').toLowerCase().includes('under') ? 'totals' : 'h2h',
          cuota: null, // opcional, si la tenías guardada en otro campo
          probabilidad: p.probabilidad || null,
          ev: p.ev || null,
          resultado
        });

        // Actualiza resúmenes 7/30
        if (p.liga) {
          await actualizarMemoriaResumen(p.liga, 7);
          await actualizarMemoriaResumen(p.liga, 30);
        }

        procesados.push({ id: p.id, resultado });
        // pequeño respiro para no saturar
        await sleep(120);
      } catch (e) {
        console.error('[verificador] item error:', e?.message || e);
      }
    }

    return json(200, { ok: true, procesados });
  } catch (e) {
    console.error('[verificador] error:', e?.message || e);
    return json(500, { error: 'internal' });
  }
};
