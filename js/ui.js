// Small UI utilities shared across modules.

let notifyTimer = null;
export function notify(msg) {
  const el = document.getElementById('notify');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

export function pad(n) { return String(n).padStart(2, '0'); }

export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
}

export function fmtDur(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), mn = m % 60;
  if (!h) return mn + 'm';
  if (!mn) return h + 'h';
  return h + 'h ' + mn + 'm';
}

export function toMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function fromMins(m) {
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}

export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function koDateLabel(d) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

export function debounce(fn, wait = 400) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') node.textContent = v;
    else if (v === false || v == null) continue;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Simple in-memory event bus for cross-module communication.
const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}
export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(e); }
  });
}

// Haptic feedback (no-op on desktop / unsupported). Patterns in ms.
export function haptic(pattern = 8) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch {}
}

// View Transitions API helper (graceful fallback).
export function withTransition(fn) {
  if (document.startViewTransition) {
    return document.startViewTransition(fn);
  }
  fn();
  return null;
}

// Wake Lock manager — keeps screen on during focus sessions.
let wakeLock = null;
let wantWakeLock = false;
export async function acquireWakeLock() {
  wantWakeLock = true;
  if (!('wakeLock' in navigator)) return;
  if (wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {}
}
export async function releaseWakeLock() {
  wantWakeLock = false;
  if (wakeLock) {
    try { await wakeLock.release(); } catch {}
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantWakeLock && !wakeLock) acquireWakeLock();
});
