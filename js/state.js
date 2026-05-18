// Shared client-side state cache. Modules subscribe via ui.on().

export const state = {
  user: null,
  profile: null,
  today: null, // ISO date string for "today" anchor
  blocks: [],
  pomodoros: [],
  mits: [],
  reflection: null,
  // Calendar-month cache (keyed by 'YYYY-MM')
  monthCache: new Map(),
  streak: 0,
};

export function setUser(u) { state.user = u; }
export function setProfile(p) { state.profile = p; }
export function setToday(iso) { state.today = iso; }

export function invalidateMonth(ym) {
  if (ym) state.monthCache.delete(ym);
  else state.monthCache.clear();
}
