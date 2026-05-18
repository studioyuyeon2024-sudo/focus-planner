// Supabase repository — CRUD for blocks, pomodoros, MITs, reflections, profile.
import { supabase } from './supabase.js';
import { isoDate } from './ui.js';

// ===== profile =====
export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, patch) {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===== blocks =====
export async function fetchBlocksForDate(userId, date) {
  const { data, error } = await supabase
    .from('blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .order('start_min');
  if (error) throw error;
  return data || [];
}

export async function fetchBlocksForRange(userId, fromIso, toIso) {
  const { data, error } = await supabase
    .from('blocks')
    .select('*')
    .eq('user_id', userId)
    .gte('date', fromIso)
    .lte('date', toIso)
    .order('date')
    .order('start_min');
  if (error) throw error;
  return data || [];
}

export async function insertBlock(userId, b) {
  const { data, error } = await supabase
    .from('blocks')
    .insert({ ...b, user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBlock(id, patch) {
  const { data, error } = await supabase
    .from('blocks')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBlock(id) {
  const { error } = await supabase.from('blocks').delete().eq('id', id);
  if (error) throw error;
}

// ===== pomodoros =====
export async function insertPomodoro(userId, p) {
  const { data, error } = await supabase
    .from('pomodoros')
    .insert({ ...p, user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchPomodorosForDate(userId, date) {
  const { data, error } = await supabase
    .from('pomodoros')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .order('started_at');
  if (error) throw error;
  return data || [];
}

export async function fetchPomodorosForRange(userId, fromIso, toIso) {
  const { data, error } = await supabase
    .from('pomodoros')
    .select('*')
    .eq('user_id', userId)
    .gte('date', fromIso)
    .lte('date', toIso);
  if (error) throw error;
  return data || [];
}

// ===== MITs =====
export async function fetchMits(userId, date) {
  const { data, error } = await supabase
    .from('mits')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .order('position');
  if (error) throw error;
  return data || [];
}

export async function fetchMitsForRange(userId, fromIso, toIso) {
  const { data, error } = await supabase
    .from('mits')
    .select('*')
    .eq('user_id', userId)
    .gte('date', fromIso)
    .lte('date', toIso);
  if (error) throw error;
  return data || [];
}

export async function upsertMit(userId, date, position, text, done = false) {
  const { data, error } = await supabase
    .from('mits')
    .upsert(
      { user_id: userId, date, position, text, done },
      { onConflict: 'user_id,date,position' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMit(userId, date, position) {
  const { error } = await supabase
    .from('mits')
    .delete()
    .eq('user_id', userId)
    .eq('date', date)
    .eq('position', position);
  if (error) throw error;
}

export async function setMitDone(id, done) {
  const { data, error } = await supabase
    .from('mits')
    .update({ done })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===== reflections =====
export async function fetchReflection(userId, date) {
  const { data, error } = await supabase
    .from('reflections')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchReflectionsForRange(userId, fromIso, toIso) {
  const { data, error } = await supabase
    .from('reflections')
    .select('*')
    .eq('user_id', userId)
    .gte('date', fromIso)
    .lte('date', toIso);
  if (error) throw error;
  return data || [];
}

export async function upsertReflection(userId, date, patch) {
  const row = { user_id: userId, date, updated_at: new Date().toISOString(), ...patch };
  const { data, error } = await supabase
    .from('reflections')
    .upsert(row, { onConflict: 'user_id,date' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===== streak =====
export async function fetchStreakInputs(userId, daysBack = 90) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - daysBack);
  const fromIso = isoDate(from);
  const toIso = isoDate(today);
  const [{ data: pomos, error: e1 }, { data: mits, error: e2 }] = await Promise.all([
    supabase.from('pomodoros').select('date').eq('user_id', userId).eq('mode', 'focus').gte('date', fromIso).lte('date', toIso),
    supabase.from('mits').select('date').eq('user_id', userId).eq('done', true).gte('date', fromIso).lte('date', toIso),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const set = new Set();
  (pomos || []).forEach((r) => set.add(r.date));
  (mits || []).forEach((r) => set.add(r.date));
  return set;
}

export function computeStreak(daySet, today = new Date()) {
  let count = 0;
  const cursor = new Date(today);
  while (true) {
    const iso = isoDate(cursor);
    if (daySet.has(iso)) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    } else if (count === 0 && isoDate(cursor) === isoDate(today)) {
      // today not yet earned; skip to yesterday but don't break the streak
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return count;
}
