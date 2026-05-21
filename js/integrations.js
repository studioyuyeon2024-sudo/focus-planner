// Platform integrations — iOS Shortcuts URL scheme, etc.

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Trigger an iOS Shortcut by name. Optional numeric input gets passed as text.
// Silently no-ops on non-iOS platforms. Requires a real user gesture upstream.
export function runShortcut(name, input) {
  if (!isIOS() || !name) return false;
  const params = new URLSearchParams({ name });
  if (input != null && input !== '') {
    params.set('input', 'text');
    params.set('text', String(input));
  }
  const url = `shortcuts://run-shortcut?${params.toString()}`;
  // Use a synthetic anchor click — works inside iOS user-gesture handlers.
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}

// Local settings for Shortcuts integration (per-device, so localStorage).
const KEYS = {
  enabled: 'fp_shortcut_enabled',
  focusName: 'fp_shortcut_focus_name',
  breakName: 'fp_shortcut_break_name',
  breakEnabled: 'fp_shortcut_break_enabled',
};

export const shortcutSettings = {
  get enabled() { return localStorage.getItem(KEYS.enabled) === '1'; },
  set enabled(v) { localStorage.setItem(KEYS.enabled, v ? '1' : '0'); },
  get focusName() { return localStorage.getItem(KEYS.focusName) || 'Focus Start'; },
  set focusName(v) { localStorage.setItem(KEYS.focusName, v || 'Focus Start'); },
  get breakEnabled() { return localStorage.getItem(KEYS.breakEnabled) === '1'; },
  set breakEnabled(v) { localStorage.setItem(KEYS.breakEnabled, v ? '1' : '0'); },
  get breakName() { return localStorage.getItem(KEYS.breakName) || 'Break Start'; },
  set breakName(v) { localStorage.setItem(KEYS.breakName, v || 'Break Start'); },
};

// Called when a pomodoro session starts. Picks the right shortcut by mode.
export function triggerStartShortcut(mode, durationSec) {
  if (!shortcutSettings.enabled) return;
  const minutes = Math.max(1, Math.round(durationSec / 60));
  if (mode === 'focus') {
    runShortcut(shortcutSettings.focusName, minutes);
  } else if (shortcutSettings.breakEnabled) {
    runShortcut(shortcutSettings.breakName, minutes);
  }
}
