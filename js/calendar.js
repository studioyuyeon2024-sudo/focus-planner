// Calendar view: month grid + per-day detail panel.
import { state } from './state.js';
import * as repo from './repo.js';
import { notify, isoDate, parseIsoDate, koDateLabel, fmtDur, debounce, el, clear, on, pad, fromMins, haptic } from './ui.js';

const CAT_COLORS = { work: '#4f8ef7', personal: '#3ecf8e', rest: '#f5a623', etc: '#a78bfa' };
const CAT_BG = { work: 'rgba(79,142,247,0.18)', personal: 'rgba(62,207,142,0.18)', rest: 'rgba(245,166,35,0.18)', etc: 'rgba(167,139,250,0.18)' };

let viewYear, viewMonth; // viewMonth 0-indexed
let selectedDate = null; // ISO string
let monthData = { blocks: [], pomos: [], mits: [], refls: [] };

export function initCalendar() {
  const root = document.getElementById('calRoot');
  if (!root) return;
  const today = new Date();
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();

  document.getElementById('calPrev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('calNext').addEventListener('click', () => shiftMonth(1));
  document.getElementById('calToday').addEventListener('click', () => goToday());

  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('viewCalendar').classList.contains('active')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea'].includes(tag)) return;
    if (e.key === 'ArrowLeft') shiftMonth(-1);
    else if (e.key === 'ArrowRight') shiftMonth(1);
    else if (e.key === 't' || e.key === 'T') goToday();
  });

  on('user:ready', () => loadAndRender());
  on('blocks:changed', () => { invalidate(); maybeReload(); });
  on('mits:changed', () => { invalidate(); maybeReload(); });
  on('pomo:completed', () => { invalidate(); maybeReload(); });

  selectedDate = isoDate(today);
}

function maybeReload() {
  if (document.getElementById('viewCalendar').classList.contains('active')) loadAndRender();
}

function invalidate() {
  state.monthCache.clear();
}

function shiftMonth(d) {
  viewMonth += d;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  else if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  loadAndRender();
}

function goToday() {
  const t = new Date();
  viewYear = t.getFullYear();
  viewMonth = t.getMonth();
  selectedDate = isoDate(t);
  loadAndRender();
}

export async function loadAndRender() {
  const userId = state.user?.id;
  if (!userId) return;
  const first = new Date(viewYear, viewMonth, 1);
  const last = new Date(viewYear, viewMonth + 1, 0);
  // Pad to start-of-week (Sunday) and end-of-week (Saturday)
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay()));
  const fromIso = isoDate(gridStart);
  const toIso = isoDate(gridEnd);

  const ym = `${viewYear}-${pad(viewMonth + 1)}`;
  if (state.monthCache.has(ym)) {
    monthData = state.monthCache.get(ym);
  } else {
    try {
      const [blocks, pomos, mits, refls] = await Promise.all([
        repo.fetchBlocksForRange(userId, fromIso, toIso),
        repo.fetchPomodorosForRange(userId, fromIso, toIso),
        repo.fetchMitsForRange(userId, fromIso, toIso),
        repo.fetchReflectionsForRange(userId, fromIso, toIso),
      ]);
      monthData = { blocks, pomos, mits, refls };
      state.monthCache.set(ym, monthData);
    } catch (e) { console.error(e); notify('달력 데이터를 불러오지 못했어요'); return; }
  }

  renderTitle();
  renderGrid(gridStart, gridEnd);
  renderDetail();
}

function renderTitle() {
  document.getElementById('calTitle').textContent = `${viewYear}년 ${viewMonth + 1}월`;
}

function renderGrid(start, end) {
  const grid = document.getElementById('calGrid');
  clear(grid);
  const dows = ['일', '월', '화', '수', '목', '금', '토'];
  dows.forEach((d, i) => {
    const cell = el('div', { class: 'cal-dow' + (i === 0 ? ' sun' : '') }, d);
    grid.appendChild(cell);
  });

  const todayIso = isoDate();
  const cursor = new Date(start);
  while (cursor <= end) {
    const iso = isoDate(cursor);
    const inMonth = cursor.getMonth() === viewMonth;
    const isSun = cursor.getDay() === 0;
    const summary = summarizeDay(iso);
    const isToday = iso === todayIso;

    const cell = el('div', {
      class: 'cal-cell'
        + (!inMonth ? ' outside' : '')
        + (isToday ? ' today' : '')
        + (selectedDate === iso ? ' selected' : ''),
      dataset: { date: iso },
    });
    cell.addEventListener('click', () => selectDate(iso));

    const dateLine = el('div', { class: 'cal-cell-date' + (isSun ? ' sun' : '') });
    dateLine.appendChild(document.createTextNode(String(cursor.getDate())));
    if (summary.streak) {
      const fire = el('span', { class: 'cal-cell-streak', title: '집중·MIT 달성일' }, '🔥');
      dateLine.appendChild(fire);
    }
    cell.appendChild(dateLine);

    if (summary.totalMin > 0) {
      const dots = el('div', { class: 'cal-cell-dots' });
      ['work', 'personal', 'rest', 'etc'].forEach((cat) => {
        if (summary.byCat[cat] > 0) {
          dots.appendChild(el('span', { class: 'cal-cell-dot', style: { background: CAT_COLORS[cat] }, title: cat }));
        }
      });
      cell.appendChild(dots);
    }
    if (summary.focusMin > 0) {
      cell.appendChild(el('div', { class: 'cal-cell-focus' }, `🎯 ${fmtDur(summary.focusMin)}`));
    }

    grid.appendChild(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function summarizeDay(iso) {
  const blocks = monthData.blocks.filter((b) => b.date === iso);
  const pomos = monthData.pomos.filter((p) => p.date === iso);
  const mits = monthData.mits.filter((m) => m.date === iso);
  const byCat = { work: 0, personal: 0, rest: 0, etc: 0 };
  let totalMin = 0;
  blocks.forEach((b) => {
    const d = b.end_min - b.start_min;
    byCat[b.cat] += d;
    totalMin += d;
  });
  const focusSec = pomos.filter((p) => p.mode === 'focus').reduce((s, p) => s + (p.duration_sec || 0), 0);
  const focusMin = Math.round(focusSec / 60);
  const mitsDone = mits.filter((m) => m.done).length;
  const streak = focusMin > 0 || mitsDone > 0;
  return { byCat, totalMin, focusMin, mitsDone, mitsTotal: mits.filter((m) => m.text).length, streak };
}

function selectDate(iso) {
  selectedDate = iso;
  haptic(6);
  // re-render selection without refetch
  document.querySelectorAll('.cal-cell').forEach((c) => {
    c.classList.toggle('selected', c.dataset.date === iso);
  });
  renderDetail();
  // On mobile (single-column layout), bring the detail panel into view
  if (window.matchMedia('(max-width: 880px)').matches) {
    const detail = document.getElementById('calDetail');
    if (detail) setTimeout(() => detail.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
}

function renderDetail() {
  const detail = document.getElementById('calDetail');
  clear(detail);
  if (!selectedDate) {
    detail.appendChild(el('div', { class: 'cal-detail-empty' }, '날짜를 선택해주세요'));
    return;
  }
  const d = parseIsoDate(selectedDate);
  const summary = summarizeDay(selectedDate);
  const blocks = monthData.blocks.filter((b) => b.date === selectedDate).slice().sort((a, b) => a.start_min - b.start_min);
  const mits = monthData.mits.filter((m) => m.date === selectedDate).sort((a, b) => a.position - b.position);
  const refl = monthData.refls.find((r) => r.date === selectedDate);

  // Header
  const head = el('div', { class: 'cal-detail-date' });
  head.appendChild(document.createTextNode(koDateLabel(d)));
  if (summary.streak) head.appendChild(el('span', { title: '집중일' }, ' 🔥'));
  detail.appendChild(head);

  // Stats grid
  const stats = el('div', { class: 'cal-detail-stats' });
  stats.append(
    statCell(fmtDur(summary.focusMin), '집중 시간'),
    statCell(`${summary.mitsDone}/${summary.mitsTotal || 0}`, 'MIT 완료'),
    statCell(fmtDur(summary.byCat.work), '업무·집중'),
    statCell(fmtDur(summary.byCat.personal + summary.byCat.rest + summary.byCat.etc), '그외'),
  );
  detail.appendChild(stats);

  // MIT list
  if (mits.length) {
    const mitWrap = el('div', { class: 'cal-mit-list' });
    mitWrap.appendChild(el('div', { class: 'mit-title', style: { fontSize: '11px' } }, '오늘의 핵심 3가지'));
    mits.forEach((m) => {
      const row = el('div', { class: 'cal-mit-item' + (m.done ? ' done' : '') });
      row.textContent = (m.done ? '✓ ' : '○ ') + m.text;
      mitWrap.appendChild(row);
    });
    detail.appendChild(mitWrap);
  }

  // Mini schedule grid
  if (blocks.length) {
    detail.appendChild(buildMini(blocks));
  } else {
    detail.appendChild(el('div', { class: 'cal-detail-empty', style: { padding: '20px 0' } }, '기록된 일정이 없어요'));
  }

  // Reflection note (editable for past or today)
  const noteHead = el('div', { class: 'reflect-head' },
    el('span', { class: 'reflect-title' }, '하루 회고'),
    refl?.mood ? el('span', { style: { fontSize: '16px' } }, ['😞', '😕', '😐', '🙂', '😄'][refl.mood - 1]) : null,
  );
  detail.appendChild(noteHead);
  const noteIn = el('textarea', { class: 'cal-detail-note', placeholder: '한 줄 메모...' });
  noteIn.value = refl?.note || '';
  const debSave = debounce(async () => {
    const userId = state.user?.id;
    try {
      const saved = await repo.upsertReflection(userId, selectedDate, { note: noteIn.value });
      // update local cache
      const idx = monthData.refls.findIndex((r) => r.date === selectedDate);
      if (idx >= 0) monthData.refls[idx] = saved; else monthData.refls.push(saved);
    } catch (e) { console.error(e); notify('메모 저장 실패'); }
  }, 600);
  noteIn.addEventListener('input', debSave);
  detail.appendChild(noteIn);
}

function statCell(val, lbl) {
  return el('div', { class: 'cal-stat' },
    el('div', { class: 'cal-stat-val' }, val),
    el('div', { class: 'cal-stat-lbl' }, lbl),
  );
}

function buildMini(blocks) {
  const START_H = 6, END_H = 24, ROW = 16;
  const wrap = el('div', { class: 'mini-grid' });
  const axis = el('div', { class: 'mini-axis' });
  for (let h = START_H; h <= END_H; h++) {
    const t = el('div', { class: 'mini-tick' });
    t.textContent = h < END_H ? pad(h) : '';
    axis.appendChild(t);
  }
  const area = el('div', { class: 'mini-blocks' });
  for (let h = START_H; h < END_H; h++) area.appendChild(el('div', { class: 'mini-hour-line' }));
  blocks.forEach((b) => {
    const top = ((b.start_min - START_H * 60) / 60) * ROW;
    const height = ((b.end_min - b.start_min) / 60) * ROW;
    const div = el('div', {
      class: 'mini-block',
      style: {
        top: top + 'px',
        height: Math.max(height - 1, 10) + 'px',
        background: CAT_BG[b.cat],
        borderLeftColor: CAT_COLORS[b.cat],
        color: CAT_COLORS[b.cat],
      },
      title: `${fromMins(b.start_min)}–${fromMins(b.end_min)} ${b.name}`,
    });
    div.textContent = fromMins(b.start_min) + ' ' + b.name;
    area.appendChild(div);
  });
  wrap.append(axis, area);
  return wrap;
}
