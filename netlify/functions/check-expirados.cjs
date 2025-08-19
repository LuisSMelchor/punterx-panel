// netlify/functions/check-expirados.cjs
// v2.0 — Recordatorios (3 días y 0 días), expiración, DM y expulsión del VIP (reutiliza helpers de send.js)

'use strict';

const VERSION = 'check-expirados v2.0';

// Polyfill defensivo por si corres local en un Node sin fetch
try { if (typeof fetch === 'undefined') global.fetch = require('node-fetch'); } catch (_) {}

// === Supabase (ESM dynamic import) ===
async function getSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) throw new Error('SUPABASE env missing');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

// === Reutilizamos helpers de Telegram desde send.js ===
let tgHelpers = null;
function getTG() {
  if (!tgHelpers) {
    // send.js exporta tgSendDM y expulsarUsuarioVIP
    tgHelpers = require('./send.js');
  }
  return tgHelpers;
}

// === Utilidades de fecha (UTC) ===
function startOfUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  return d;
}
function endOfUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return d;
}
function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// === Idempotencia opcional con tabla usuarios_notifs (si existe) ===
// Estructura sugerida (no obligatoria):
// create table usuarios_notifs (
//   id bigserial primary key,
//   id_telegram bigint not null,
//   tipo text not null,          -- 'reminder_3d' | 'reminder_0d' | 'expired_dm'
//   fecha_key date not null,     -- fecha UTC para evitar duplicados diarios
//   created_at timestamptz default now(),
//   unique(id_telegram, tipo, fecha_key)
// );
async function tryInsertNotif(supabase, id_telegram, tipo, fechaKeyDate) {
  try {
    const fechaKey = startOfUTC(fechaKeyDate).toISOString().slice(0, 10);
    const { error } = await supabase
      .from('usuarios_notifs')
      .upsert({ id_telegram, tipo, fecha_key: fechaKey }, { onConflict: 'id_telegram,tipo,fecha_key' });
    if (error) {
      // Si la tabla no existe u otro error, lo registramos y continuamos
      console.warn('[usuarios_notifs] upsert warn:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[usuarios_notifs] upsert ex:', e?.message || e);
    return false;
  }
}

// === Mensajes ===
function msgReminder3d(nombrePlan = 'Premium') {
  return [
    '⏳ <b>Tu prueba VIP termina en 3 días</b>',
    '',
    'Nuestro radar de <b>IA Avanzada</b> sigue monitoreando todas las ligas en tiempo real para cazar picks con <b>EV+</b>.',
    '',
    'Si el servicio te está aportando valor, considera continuar con <b>' + nombrePlan + '</b> para no perderte los mejores picks.',
    '',
    '👉 Responde a este mensaje para más opciones de pago.',
    '<i>Apuesta con responsabilidad.</i>'
  ].join('\n');
}

function msgReminder0d(nombrePlan = 'Premium') {
  return [
    '⏰ <b>Hoy termina tu prueba VIP</b>',
    '',
    'Si quieres seguir recibiendo picks con <b>EV≥15%</b>, datos avanzados y el análisis completo, puedes suscribirte a <b>' + nombrePlan + '</b>.',
    '',
    '👉 Responde a este mensaje para completar tu suscripción.',
    '<i>Apuesta con responsabilidad.</i>'
  ].join('\n');
}

function msgExpired() {
  return [
    '🔴 <b>Tu prueba VIP ha finalizado</b>',
    '',
    'Gracias por probar PunterX. Te mantendremos en el <b>canal gratuito</b> con el radar y avisos.',
    '',
    'Si más adelante deseas regresar al VIP, escríbenos y te ayudamos.',
    '<i>Apuesta con responsabilidad.</i>'
  ].join('\n');
}

// === Core ===
exports.handler = async () => {
  console.log(`[${VERSION}] start`);
  try {
    const supabase = await getSupabase();
    const now = new Date();

    // ---------- 1) Recordatorio "3 días antes" ----------
    const threeDaysDate = addDays(now, 3);
    const day3Start = startOfUTC(threeDaysDate).toISOString();
    const day3End = endOfUTC(threeDaysDate).toISOString();

    // usuarios en trial que expiran en exactamente 3 días (UTC window)
    const { data: trials3d, error: q3err } = await supabase
      .from('usuarios')
      .select('id_telegram')
      .eq('estado', 'trial')
      .gte('fecha_expira', day3Start)
      .lte('fecha_expira', day3End);

    if (q3err) console.warn('[query 3d] warn:', q3err.message);

    if (Array.isArray(trials3d) && trials3d.length) {
      const { tgSendDM } = getTG();
      for (const row of trials3d) {
        const id = row.id_telegram;
        // Idempotencia opcional por día
        const logged = await tryInsertNotif(supabase, id, 'reminder_3d', threeDaysDate);
        // Si no hay tabla de notifs, aún así enviamos (el scheduler idealmente corre 1 vez al día)
        if (!logged) console.log('[3d reminder] sending without notif guard for', id);
        try {
          await tgSendDM(id, msgReminder3d('Premium'));
        } catch (e) {
          console.warn('[3d reminder] DM fail', id, e?.message || e);
        }
      }
      console.log(`[${VERSION}] 3d reminders sent=${trials3d.length}`);
    } else {
      console.log(`[${VERSION}] 3d reminders sent=0`);
    }

    // ---------- 2) Recordatorio "mismo día" ----------
    const todayStart = startOfUTC(now).toISOString();
    const todayEnd = endOfUTC(now).toISOString();

    const { data: trials0d, error: q0err } = await supabase
      .from('usuarios')
      .select('id_telegram')
      .eq('estado', 'trial')
      .gte('fecha_expira', todayStart)
      .lte('fecha_expira', todayEnd);

    if (q0err) console.warn('[query 0d] warn:', q0err.message);

    if (Array.isArray(trials0d) && trials0d.length) {
      const { tgSendDM } = getTG();
      for (const row of trials0d) {
        const id = row.id_telegram;
        const logged = await tryInsertNotif(supabase, id, 'reminder_0d', now);
        if (!logged) console.log('[0d reminder] sending without notif guard for', id);
        try {
          await tgSendDM(id, msgReminder0d('Premium'));
        } catch (e) {
          console.warn('[0d reminder] DM fail', id, e?.message || e);
        }
      }
      console.log(`[${VERSION}] 0d reminders sent=${trials0d.length}`);
    } else {
      console.log(`[${VERSION}] 0d reminders sent=0`);
    }

    // ---------- 3) Marcar expirados y notificar/expulsar ----------
    const nowIso = now.toISOString();
    const { data: expiredRows, error: upErr } = await supabase
      .from('usuarios')
      .update({ estado: 'expired' })
      .lte('fecha_expira', nowIso)
      .eq('estado', 'trial')
      .select('id_telegram');

    if (upErr) {
      console.error('update expired error', upErr);
      return { statusCode: 200, body: 'error' };
    }

    const expiredCount = Array.isArray(expiredRows) ? expiredRows.length : 0;
    console.log(`[${VERSION}] expirados=${expiredCount}`);

    if (expiredCount > 0) {
      const { tgSendDM, expulsarUsuarioVIP } = getTG();
      for (const row of expiredRows) {
        const id = row.id_telegram;

        // DM de expiración (idempotencia diaria, por si el cron corre varias veces)
        const logged = await tryInsertNotif(supabase, id, 'expired_dm', now);
        if (!logged) console.log('[expired dm] sending without notif guard for', id);
        try {
          await tgSendDM(id, msgExpired());
        } catch (e) {
          console.warn('[expired dm] DM fail', id, e?.message || e);
        }

        // Expulsión del grupo VIP (ban + unban para limpiar estado)
        try {
          await expulsarUsuarioVIP(id);
        } catch (e) {
          console.warn('[expulsarUsuarioVIP] fail', id, e?.message || e);
        }
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error(`[${VERSION}] fail`, e);
    return { statusCode: 200, body: 'error' };
  }
};
