// netlify/functions/_users.cjs
'use strict';

const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_KEY
} = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('[USERS] Falta SUPABASE_URL/SUPABASE_KEY');
}

const sb = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// ===== Helpers =====
function toInt(v) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; }

async function upsertTelegramUser({ tg_id, username, first_name, last_name, lang_code, source }) {
  if (!sb) return null;
  const idNum = toInt(tg_id);
  if (!idNum) return null;

  // 1) ¿existe?
  const { data: exists } = await sb.from('px_users').select('id').eq('tg_id', idNum).maybeSingle();

  if (exists && exists.id) {
    const { data, error } = await sb.from('px_users').update({
      tg_username: username || null,
      tg_first_name: first_name || null,
      tg_last_name: last_name || null,
      lang_code: lang_code || null,
      source: source || null
    }).eq('id', exists.id).select('id').maybeSingle();
    if (error) { console.warn('[USERS] update user error:', error.message); return null; }
    return data?.id || exists.id;
  }

  // 2) insert
  const { data: ins, error: e2 } = await sb.from('px_users').insert([{
    tg_id: idNum,
    tg_username: username || null,
    tg_first_name: first_name || null,
    tg_last_name: last_name || null,
    lang_code: lang_code || null,
    source: source || 'manual'
  }]).select('id').maybeSingle();
  if (e2) { console.warn('[USERS] insert user error:', e2.message); return null; }
  return ins?.id || null;
}

async function isBannedByTgId(tg_id) {
  if (!sb) return false;
  const idNum = toInt(tg_id); if (!idNum) return false;
  const { data: row } = await sb.from('v_px_user_status').select('is_banned').eq('tg_id', idNum).maybeSingle();
  return !!row?.is_banned;
}

async function isVipByTgId(tg_id) {
  if (!sb) return false;
  const idNum = toInt(tg_id); if (!idNum) return false;
  const { data: row } = await sb.from('v_px_user_status').select('is_vip').eq('tg_id', idNum).maybeSingle();
  return !!row?.is_vip;
}

async function getUserIdByTgId(tg_id) {
  if (!sb) return null;
  const idNum = toInt(tg_id); if (!idNum) return null;
  const { data: u } = await sb.from('px_users').select('id').eq('tg_id', idNum).maybeSingle();
  return u?.id || null;
}

async function grantVipByTgId(tg_id, { plan_code='VIP', days=30 } = {}) {
  if (!sb) return false;
  const userId = await getUserIdByTgId(tg_id);
  if (!userId) return false;

  // desactivar membresías activas previas
  await sb.from('px_memberships').update({ active: false }).eq('user_id', userId).eq('active', true);

  const ends_at = (days && Number(days) > 0)
    ? new Date(Date.now() + Number(days) * 86400000).toISOString()
    : null;

  const { error } = await sb.from('px_memberships').insert([{
    user_id: userId,
    plan_code,
    starts_at: new Date().toISOString(),
    ends_at,
    active: true
  }]);
  if (error) { console.warn('[USERS] grantVip error:', error.message); return false; }

  await logUserEvent(userId, 'join_vip', { plan_code, days });
  return true;
}

async function revokeVipByTgId(tg_id, reason='manual_revoke') {
  if (!sb) return false;
  const userId = await getUserIdByTgId(tg_id);
  if (!userId) return false;

  const { error } = await sb.from('px_memberships').update({
    active: false, ends_at: new Date().toISOString()
  }).eq('user_id', userId).eq('active', true);
  if (error) { console.warn('[USERS] revokeVip error:', error.message); return false; }

  await logUserEvent(userId, 'leave_vip', { reason });
  return true;
}

async function banByTgId(tg_id, reason='manual_ban', expires_at=null) {
  if (!sb) return false;
  const userId = await getUserIdByTgId(tg_id) || await upsertTelegramUser({ tg_id });
  if (!userId) return false;

  const { error } = await sb.from('px_bans').insert([{
    user_id: userId, reason, expires_at
  }]);
  if (error) { console.warn('[USERS] ban error:', error.message); return false; }

  await logUserEvent(userId, 'ban', { reason, expires_at });
  return true;
}

async function unbanByTgId(tg_id) {
  if (!sb) return false;
  const userId = await getUserIdByTgId(tg_id);
  if (!userId) return false;

  const { error } = await sb.from('px_bans').delete().eq('user_id', userId);
  if (error) { console.warn('[USERS] unban error:', error.message); return false; }

  await logUserEvent(userId, 'unban', {});
  return true;
}

async function logUserEvent(user_id, event_type, payload) {
  if (!sb || !user_id) return;
  await sb.from('px_user_events').insert([{ user_id, event_type, payload }]);
}

module.exports = {
  upsertTelegramUser,
  isBannedByTgId,
  isVipByTgId,
  grantVipByTgId,
  revokeVipByTgId,
  banByTgId,
  unbanByTgId,
  logUserEvent,
  getUserIdByTgId,
};
