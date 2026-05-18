// Pomodoro timer with wall-clock accuracy and auto-cycle.
import { state } from './state.js';
import * as repo from './repo.js';
import { notify, fmtClock, pad, isoDate, emit, on } from './ui.js';

const CIRCUM = 2 * Math.PI * 68;
const COLORS = { focus: '#4f8ef7', short: '#3ecf8e', long: '#f5a623' };
const MODE_LBL = { focus: '집중', short: '휴식', long: '긴 휴식' };

let mode = 'focus';
let durationSec = 1500;
let startedAt = null; // ms
let pausedRemaining = null; // sec; null when running
let tickHandle = null;
let cyclePos = 0; // 0..7 — focus,short,focus,short,focus,short,focus,long
let currentTask = '';
let pomosCount = 0;
let totalFocusSec = 0;
let totalBreakSec = 0;
let autoStartNext = true;
let soundEnabled = true;

function modes() {
  const p = state.profile || {};
  return {
    focus: p.pomo_focus_sec || 1500,
    short: p.pomo_short_sec || 300,
    long: p.pomo_long_sec || 900,
  };
}

function remainingSec() {
  if (pausedRemaining != null) return pausedRemaining;
  if (startedAt == null) return durationSec;
  const elapsed = (Date.now() - startedAt) / 1000;
  return Math.max(0, durationSec - elapsed);
}

function running() {
  return startedAt != null && pausedRemaining == null;
}

function render() {
  const left = remainingSec();
  document.getElementById('timerDigits').textContent = fmtClock(left);
  document.getElementById('timerModeLbl').textContent = MODE_LBL[mode];
  const frac = durationSec > 0 ? left / durationSec : 0;
  const c = document.getElementById('progCircle');
  c.style.strokeDashoffset = String(CIRCUM * (1 - frac));
  c.style.stroke = COLORS[mode];
  const btn = document.getElementById('startBtn');
  btn.textContent = running() ? '일시정지' : (left < durationSec && left > 0 ? '재개' : '시작');
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.classList.remove('mode-short', 'mode-long');
    if (b.dataset.mode === mode && mode !== 'focus') b.classList.add('mode-' + mode);
  });
  renderDots();
}

function renderDots() {
  const row = document.getElementById('dotsRow');
  row.replaceChildren();
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('div');
    d.className = 'dot' + (i < pomosCount % 4 ? ' done' : '');
    row.appendChild(d);
  }
}

function loop() {
  render();
  const left = remainingSec();
  if (running() && left <= 0) finishSession();
}

function startLoop() {
  stopLoop();
  tickHandle = setInterval(loop, 500);
}
function stopLoop() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}

function switchMode(m, { reset = true } = {}) {
  if (running()) return;
  mode = m;
  durationSec = modes()[m];
  pausedRemaining = null;
  startedAt = null;
  if (reset) render();
  else render();
}

function toggleTimer() {
  if (running()) {
    pausedRemaining = remainingSec();
    startedAt = null;
    render();
    return;
  }
  // start or resume
  const baseRemaining = pausedRemaining != null ? pausedRemaining : durationSec;
  startedAt = Date.now() - (durationSec - baseRemaining) * 1000;
  pausedRemaining = null;
  startLoop();
  render();
}

function resetTimer() {
  startedAt = null;
  pausedRemaining = null;
  durationSec = modes()[mode];
  stopLoop();
  render();
}

async function finishSession() {
  stopLoop();
  const finishedMode = mode;
  const userId = state.user?.id;
  const startISO = new Date(startedAt || Date.now() - durationSec * 1000).toISOString();
  const endISO = new Date().toISOString();
  startedAt = null;
  pausedRemaining = 0;

  if (finishedMode === 'focus') {
    pomosCount++;
    totalFocusSec += modes().focus;
  } else {
    totalBreakSec += modes()[finishedMode];
  }

  beep();
  if (finishedMode === 'focus') {
    notify('🍅 집중 완료! 잠깐 쉬어가세요.');
    addLog('집중', currentTask || '(할 일 없음)');
  } else {
    notify('✅ 휴식 끝! 다시 집중해볼까요?');
    addLog('휴식', finishedMode === 'short' ? '짧은 휴식' : '긴 휴식');
  }
  webNotify(finishedMode === 'focus' ? '집중 완료' : '휴식 완료', currentTask || '');

  updateStats();
  emit('pomo:completed', { mode: finishedMode });

  // Persist
  if (userId) {
    try {
      await repo.insertPomodoro(userId, {
        date: isoDate(),
        started_at: startISO,
        ended_at: endISO,
        mode: finishedMode,
        duration_sec: modes()[finishedMode],
        task: finishedMode === 'focus' ? currentTask : null,
      });
    } catch (e) { console.error('save pomo', e); }
  }

  // Auto-cycle
  cyclePos++;
  const nextMode = pickNext(cyclePos);
  switchMode(nextMode);
  if (autoStartNext) {
    // small delay so user sees the transition
    setTimeout(() => toggleTimer(), 800);
  }
}

function pickNext(pos) {
  // 0 focus, 1 short, 2 focus, 3 short, 4 focus, 5 short, 6 focus, 7 long → repeat
  const seq = ['focus', 'short', 'focus', 'short', 'focus', 'short', 'focus', 'long'];
  return seq[pos % 8];
}

function addLog(type, label) {
  const ul = document.getElementById('logList');
  const empty = ul.querySelector('.log-empty');
  if (empty) empty.remove();
  const now = new Date();
  const li = document.createElement('li');
  li.className = 'log-item';
  const badge = document.createElement('span');
  badge.className = 'log-badge ' + (type === '집중' ? 'badge-focus' : 'badge-break');
  badge.textContent = type;
  const name = document.createElement('span');
  name.className = 'log-name';
  name.textContent = label;
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  li.append(badge, name, time);
  ul.insertBefore(li, ul.firstChild);
}

function updateStats() {
  document.getElementById('sPomos').textContent = String(pomosCount);
  document.getElementById('sFocus').textContent = Math.round(totalFocusSec / 60) + '분';
  document.getElementById('sBreak').textContent = Math.round(totalBreakSec / 60) + '분';
}

function setTask() {
  const v = document.getElementById('pomoTaskInput').value.trim();
  if (!v) return;
  currentTask = v;
  document.getElementById('pomoTaskLabel').textContent = '▸ ' + v;
}

function beep() {
  if (!soundEnabled) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.02);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close(), 600);
  } catch (e) { /* ignore */ }
}

function webNotify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, silent: true }); } catch (e) {}
  }
}

async function loadTodaySummary() {
  const userId = state.user?.id;
  if (!userId) return;
  const date = isoDate();
  try {
    const pomos = await repo.fetchPomodorosForDate(userId, date);
    pomosCount = pomos.filter((p) => p.mode === 'focus').length;
    totalFocusSec = pomos.filter((p) => p.mode === 'focus').reduce((s, p) => s + (p.duration_sec || 0), 0);
    totalBreakSec = pomos.filter((p) => p.mode !== 'focus').reduce((s, p) => s + (p.duration_sec || 0), 0);
    const ul = document.getElementById('logList');
    ul.replaceChildren();
    if (pomos.length === 0) {
      const li = document.createElement('li');
      li.className = 'log-empty';
      li.textContent = '타이머를 시작해 보세요';
      ul.appendChild(li);
    } else {
      pomos.slice().reverse().forEach((p) => {
        const d = new Date(p.started_at);
        const li = document.createElement('li');
        li.className = 'log-item';
        const badge = document.createElement('span');
        badge.className = 'log-badge ' + (p.mode === 'focus' ? 'badge-focus' : 'badge-break');
        badge.textContent = p.mode === 'focus' ? '집중' : '휴식';
        const name = document.createElement('span');
        name.className = 'log-name';
        name.textContent = p.mode === 'focus' ? (p.task || '(할 일 없음)') : (p.mode === 'short' ? '짧은 휴식' : '긴 휴식');
        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        li.append(badge, name, time);
        ul.appendChild(li);
      });
    }
    updateStats();
    renderDots();
  } catch (e) { console.error(e); }
}

export function initPomodoro() {
  const root = document.getElementById('pomoRoot');
  if (!root) return;

  // Wire buttons (no inline onclick)
  document.getElementById('pomoSetBtn').addEventListener('click', setTask);
  document.getElementById('pomoTaskInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); setTask(); }
  });
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => switchMode(b.dataset.mode));
  });
  document.getElementById('startBtn').addEventListener('click', toggleTimer);
  document.getElementById('resetBtn').addEventListener('click', resetTimer);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea'].includes(tag)) return;
    if (e.code === 'Space') { e.preventDefault(); toggleTimer(); }
    else if (e.key === 'r' || e.key === 'R') resetTimer();
  });

  // Permission for notifications (silently request once on first interaction)
  document.getElementById('startBtn').addEventListener('click', () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, { once: true });

  // Apply profile durations once profile arrives
  on('profile:loaded', () => {
    if (!running()) {
      durationSec = modes()[mode];
      pausedRemaining = null;
      render();
    }
  });

  on('user:ready', () => {
    loadTodaySummary();
  });

  render();
}

export function getPomoSnapshot() {
  return { pomosCount, totalFocusSec, totalBreakSec };
}

export function setSoundEnabled(v) { soundEnabled = !!v; }
export function setAutoStart(v) { autoStartNext = !!v; }
