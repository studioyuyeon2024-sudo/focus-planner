// App entry: auth gate, tab routing, profile load, streak.
import { supabase } from './supabase.js';
import { state, setUser, setProfile } from './state.js';
import * as repo from './repo.js';
import { mountAuth, signOut } from './auth.js';
import { initPomodoro, setSoundEnabled, setAutoStart } from './pomodoro.js';
import { initPlanner } from './planner.js';
import { initCalendar } from './calendar.js';
import { emit, on, notify, haptic, withTransition } from './ui.js';
import { isIOS, shortcutSettings } from './integrations.js';

const TABS = ['today', 'calendar', 'settings'];

// Service worker (PWA install + offline shell)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Install prompt (Android/Chrome). iOS uses Share → Add to Home Screen.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.classList.add('show');
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  const btn = document.getElementById('installBtn');
  if (btn) btn.classList.remove('show');
  notify('홈 화면에 추가되었어요');
});

async function boot() {
  // Tab switching — both top tabs (desktop) and bottom nav (mobile)
  document.querySelectorAll('.tab, .bnav-btn').forEach((t) => {
    t.addEventListener('click', () => {
      haptic(6);
      switchTab(t.dataset.tab);
    });
  });

  // Install button
  const installBtn = document.getElementById('installBtn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch {}
      deferredInstall = null;
      installBtn.classList.remove('show');
    });
  }

  // Auth check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    mountAuth(afterAuth);
    return;
  }
  await afterAuth();
}

async function afterAuth() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { mountAuth(afterAuth); return; }
  setUser(user);

  // Hide auth overlay, reveal shell
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('shell').classList.add('ready');

  // Topbar user info
  document.getElementById('userEmail').textContent = user.email || '';

  // Logout button
  document.getElementById('logoutBtn').addEventListener('click', () => signOut());

  // Settings handlers (load defaults later after profile fetch)
  wireSettings();

  // Init feature modules
  initPomodoro();
  initPlanner();
  initCalendar();

  // Fetch profile (may not exist if trigger missed — fallback create)
  try {
    let profile = await repo.fetchProfile(user.id);
    if (!profile) {
      // create blank via upsert through update path (RLS allows insert via policy)
      const { data, error } = await supabase
        .from('profiles')
        .insert({ id: user.id })
        .select()
        .single();
      if (!error) profile = data;
    }
    setProfile(profile);
    emit('profile:loaded', profile);
    applyProfileToSettings();
  } catch (e) { console.error('profile', e); }

  // Now that user + profile are ready, let modules load their data
  emit('user:ready');

  // Streak chip
  refreshStreak();

  // Default tab
  switchTab(getInitialTab());

  // Listen for streak changes
  on('pomo:completed', () => refreshStreak());
  on('mits:changed', () => refreshStreak());
}

async function refreshStreak() {
  const uid = state.user?.id;
  if (!uid) return;
  try {
    const set = await repo.fetchStreakInputs(uid);
    const streak = repo.computeStreak(set);
    state.streak = streak;
    const chip = document.getElementById('streakChip');
    if (streak > 0) {
      chip.textContent = `🔥 ${streak}일 연속`;
      chip.style.display = '';
    } else {
      chip.style.display = 'none';
    }
  } catch (e) { console.error(e); }
}

function switchTab(name) {
  if (!TABS.includes(name)) name = 'today';
  withTransition(() => {
    document.querySelectorAll('.tab, .bnav-btn').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view' + cap(name)));
  });
  history.replaceState(null, '', '#' + name);
  // Scroll to top of new view on mobile
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getInitialTab() {
  const h = (location.hash || '').replace('#', '');
  return TABS.includes(h) ? h : 'today';
}

function cap(s) { return s[0].toUpperCase() + s.slice(1); }

// ===== Settings =====
function wireSettings() {
  document.getElementById('focusMin').addEventListener('change', saveProfileFromSettings);
  document.getElementById('shortMin').addEventListener('change', saveProfileFromSettings);
  document.getElementById('longMin').addEventListener('change', saveProfileFromSettings);
  document.getElementById('soundToggle').addEventListener('change', (e) => {
    setSoundEnabled(e.target.checked);
    localStorage.setItem('fp_sound', e.target.checked ? '1' : '0');
  });
  document.getElementById('autoStartToggle').addEventListener('change', (e) => {
    setAutoStart(e.target.checked);
    localStorage.setItem('fp_autostart', e.target.checked ? '1' : '0');
  });
  document.getElementById('exportBtn').addEventListener('click', () => exportData());

  // iOS Shortcuts integration
  wireShortcutSettings();

  // Restore local prefs
  const s = localStorage.getItem('fp_sound');
  const a = localStorage.getItem('fp_autostart');
  if (s !== null) {
    document.getElementById('soundToggle').checked = s === '1';
    setSoundEnabled(s === '1');
  }
  if (a !== null) {
    document.getElementById('autoStartToggle').checked = a === '1';
    setAutoStart(a === '1');
  }
}

function wireShortcutSettings() {
  const section = document.getElementById('iosShortcutSection');
  const enabledEl = document.getElementById('shortcutEnabled');
  const focusNameEl = document.getElementById('shortcutFocusName');
  const breakEnabledEl = document.getElementById('shortcutBreakEnabled');
  const breakNameEl = document.getElementById('shortcutBreakName');

  // Hide entire section on non-iOS — feature is iOS-only.
  if (!isIOS()) {
    section.style.opacity = '0.55';
    section.title = 'iOS 기기에서만 동작합니다';
  }

  // Load
  enabledEl.checked = shortcutSettings.enabled;
  focusNameEl.value = shortcutSettings.focusName;
  breakEnabledEl.checked = shortcutSettings.breakEnabled;
  breakNameEl.value = shortcutSettings.breakName;

  // Save on change
  enabledEl.addEventListener('change', () => {
    shortcutSettings.enabled = enabledEl.checked;
    if (enabledEl.checked && !isIOS()) notify('이 기능은 iOS에서만 동작해요');
  });
  focusNameEl.addEventListener('change', () => { shortcutSettings.focusName = focusNameEl.value.trim(); });
  breakEnabledEl.addEventListener('change', () => { shortcutSettings.breakEnabled = breakEnabledEl.checked; });
  breakNameEl.addEventListener('change', () => { shortcutSettings.breakName = breakNameEl.value.trim(); });
}

function applyProfileToSettings() {
  const p = state.profile;
  if (!p) return;
  document.getElementById('focusMin').value = Math.round((p.pomo_focus_sec || 1500) / 60);
  document.getElementById('shortMin').value = Math.round((p.pomo_short_sec || 300) / 60);
  document.getElementById('longMin').value = Math.round((p.pomo_long_sec || 900) / 60);
}

async function saveProfileFromSettings() {
  const uid = state.user?.id;
  if (!uid) return;
  const focusMin = Math.max(1, Math.min(180, Number(document.getElementById('focusMin').value) || 25));
  const shortMin = Math.max(1, Math.min(60, Number(document.getElementById('shortMin').value) || 5));
  const longMin = Math.max(1, Math.min(120, Number(document.getElementById('longMin').value) || 15));
  try {
    const updated = await repo.updateProfile(uid, {
      pomo_focus_sec: focusMin * 60,
      pomo_short_sec: shortMin * 60,
      pomo_long_sec: longMin * 60,
    });
    setProfile(updated);
    emit('profile:loaded', updated);
    notify('설정이 저장되었습니다');
  } catch (e) { console.error(e); notify('저장 실패'); }
}

async function exportData() {
  const uid = state.user?.id;
  if (!uid) return;
  notify('데이터를 불러오는 중...');
  try {
    const today = new Date();
    const long_ago = new Date(today); long_ago.setFullYear(today.getFullYear() - 10);
    const fromIso = `${long_ago.getFullYear()}-01-01`;
    const toIso = `${today.getFullYear() + 1}-12-31`;
    const [blocks, pomos, mits, refls] = await Promise.all([
      repo.fetchBlocksForRange(uid, fromIso, toIso),
      repo.fetchPomodorosForRange(uid, fromIso, toIso),
      repo.fetchMitsForRange(uid, fromIso, toIso),
      repo.fetchReflectionsForRange(uid, fromIso, toIso),
    ]);
    const payload = { exported_at: new Date().toISOString(), profile: state.profile, blocks, pomodoros: pomos, mits, reflections: refls };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-planner-${today.toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('내보내기 완료');
  } catch (e) { console.error(e); notify('내보내기 실패'); }
}

// Tab shortcut: 1/2/3
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea'].includes(tag)) return;
  if (e.key === '1') switchTab('today');
  else if (e.key === '2') switchTab('calendar');
  else if (e.key === '3') switchTab('settings');
});

boot().catch((e) => { console.error(e); notify('초기화 실패'); });
