// Today view: MITs (3 important tasks), time blocks, daily reflection.
import { state } from './state.js';
import * as repo from './repo.js';
import { notify, toMins, fromMins, fmtDur, koDateLabel, isoDate, debounce, el, clear, on, emit } from './ui.js';

const HOUR_H = 44, START_H = 6, END_H = 24;
const CAT_COLORS = { work: '#4f8ef7', personal: '#3ecf8e', rest: '#f5a623', etc: '#a78bfa' };
const CAT_BG = { work: 'rgba(79,142,247,0.12)', personal: 'rgba(62,207,142,0.12)', rest: 'rgba(245,166,35,0.12)', etc: 'rgba(167,139,250,0.12)' };

let editingId = null;
let nowTimer = null;

export async function initPlanner() {
  buildAxis();
  document.getElementById('plannerDate').textContent = koDateLabel(new Date());

  document.getElementById('addBtn').addEventListener('click', addOrUpdateBlock);
  document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);
  document.getElementById('blockTask').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addOrUpdateBlock(); }
  });

  // MITs
  const mitList = document.getElementById('mitList');
  for (let i = 1; i <= 3; i++) mitList.appendChild(renderMitRow(i));

  // Reflection
  const note = document.getElementById('reflectNote');
  const debouncedSaveNote = debounce(() => saveReflection({ note: note.value }), 600);
  note.addEventListener('input', () => {
    document.getElementById('reflectStatus').textContent = '저장 중...';
    debouncedSaveNote();
  });
  document.querySelectorAll('.mood-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.mood);
      document.querySelectorAll('.mood-btn').forEach((x) => x.classList.toggle('selected', x === b));
      saveReflection({ mood: v });
    });
  });

  on('user:ready', () => loadAllForToday());

  if (nowTimer) clearInterval(nowTimer);
  nowTimer = setInterval(drawNow, 60_000);
  drawNow();
}

function buildAxis() {
  const axis = document.getElementById('timeAxis');
  const lines = document.getElementById('hourLines');
  clear(axis); clear(lines);
  for (let h = START_H; h <= END_H; h++) {
    const t = el('div', { class: 't-tick' });
    t.textContent = h < END_H ? (h < 10 ? '0' + h + ':00' : h + ':00') : '';
    axis.appendChild(t);
    if (h < END_H) lines.appendChild(el('div', { class: 'hour-line' }));
  }
}

async function loadAllForToday() {
  const userId = state.user?.id;
  if (!userId) return;
  const date = isoDate();
  try {
    const [blocks, mits, refl] = await Promise.all([
      repo.fetchBlocksForDate(userId, date),
      repo.fetchMits(userId, date),
      repo.fetchReflection(userId, date),
    ]);
    state.blocks = blocks;
    state.mits = mits;
    state.reflection = refl;
    renderBlocks();
    renderMits();
    renderReflection();
    await loadCarryover();
  } catch (e) { console.error(e); notify('오늘 데이터를 불러오지 못했어요'); }
}

// ===== Blocks =====
function renderBlocks() {
  const layer = document.getElementById('blockLayer');
  clear(layer);
  const blocks = state.blocks.slice().sort((a, b) => a.start_min - b.start_min);
  const lanes = layoutLanes(blocks);
  blocks.forEach((b) => {
    const top = toTop(b.start_min);
    const h = ((b.end_min - b.start_min) / 60) * HOUR_H;
    const lane = lanes.get(b.id);
    const widthPct = 100 / lane.total;
    const leftPct = widthPct * lane.idx;
    const div = el('div', {
      class: 'block-item' + (editingId === b.id ? ' selected' : ''),
      style: {
        top: top + 'px',
        height: Math.max(h - 3, 18) + 'px',
        left: `calc(${leftPct}% + 6px)`,
        width: `calc(${widthPct}% - 12px)`,
        background: CAT_BG[b.cat],
        borderLeftColor: CAT_COLORS[b.cat],
        color: CAT_COLORS[b.cat],
      },
      dataset: { id: b.id },
    });
    const lbl = el('span', { class: 'block-label' });
    lbl.textContent = fromMins(b.start_min) + ' ' + b.name;
    const del = el('button', { class: 'block-del', 'aria-label': '블록 삭제' });
    del.textContent = '×';
    del.style.color = CAT_COLORS[b.cat];
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteBlock(b.id); });
    div.append(lbl, del);
    div.addEventListener('click', (e) => { if (e.target !== del) startEdit(b.id); });
    layer.appendChild(div);
  });
  updateSummary();
}

function layoutLanes(blocks) {
  // For overlapping blocks, assign lane index so they sit side-by-side.
  const map = new Map();
  const active = []; // [{ end, lane }]
  blocks.forEach((b) => {
    // remove finished
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= b.start_min) active.splice(i, 1);
    const used = new Set(active.map((a) => a.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    active.push({ end: b.end_min, lane });
    map.set(b.id, { idx: lane, total: 1 });
  });
  // second pass: determine total lanes overlapping for each block group
  blocks.forEach((b) => {
    const overlapping = blocks.filter((o) => !(o.end_min <= b.start_min || o.start_min >= b.end_min));
    const maxLane = Math.max(...overlapping.map((o) => map.get(o.id).idx));
    overlapping.forEach((o) => {
      const cur = map.get(o.id);
      if (maxLane + 1 > cur.total) map.set(o.id, { idx: cur.idx, total: maxLane + 1 });
    });
  });
  return map;
}

function toTop(m) { return ((m - START_H * 60) / 60) * HOUR_H; }

async function addOrUpdateBlock() {
  const s = document.getElementById('blockStart').value;
  const e = document.getElementById('blockEnd').value;
  const n = document.getElementById('blockTask').value.trim();
  const c = document.getElementById('blockCat').value;
  if (!n) { notify('할 일을 입력해 주세요'); return; }
  if (!s || !e) { notify('시작과 종료 시간을 입력해주세요'); return; }
  if (toMins(s) >= toMins(e)) { notify('종료 시간이 시작보다 늦어야 해요'); return; }
  const userId = state.user?.id;
  if (!userId) return;

  try {
    if (editingId !== null) {
      const updated = await repo.updateBlock(editingId, {
        start_min: toMins(s), end_min: toMins(e), name: n, cat: c,
      });
      const idx = state.blocks.findIndex((b) => b.id === editingId);
      if (idx >= 0) state.blocks[idx] = updated;
      cancelEdit();
      notify('일정이 수정되었습니다');
    } else {
      const created = await repo.insertBlock(userId, {
        date: isoDate(), start_min: toMins(s), end_min: toMins(e), name: n, cat: c,
      });
      state.blocks.push(created);
      document.getElementById('blockTask').value = '';
      document.getElementById('blockCat').value = 'work';
      notify('일정이 추가되었습니다');
    }
    renderBlocks();
    emit('blocks:changed');
  } catch (err) { console.error(err); notify('저장에 실패했어요'); }
}

function startEdit(id) {
  const b = state.blocks.find((x) => x.id === id);
  if (!b) return;
  editingId = id;
  document.getElementById('blockStart').value = fromMins(b.start_min);
  document.getElementById('blockEnd').value = fromMins(b.end_min);
  document.getElementById('blockTask').value = b.name;
  document.getElementById('blockCat').value = b.cat;
  const btn = document.getElementById('addBtn');
  btn.textContent = '수정 완료';
  btn.classList.add('editing');
  document.getElementById('cancelEditBtn').style.display = '';
  document.getElementById('blockTask').focus();
  renderBlocks();
}

function cancelEdit() {
  editingId = null;
  document.getElementById('blockTask').value = '';
  const btn = document.getElementById('addBtn');
  btn.textContent = '+ 추가';
  btn.classList.remove('editing');
  document.getElementById('cancelEditBtn').style.display = 'none';
  renderBlocks();
}

async function deleteBlock(id) {
  if (editingId === id) cancelEdit();
  try {
    await repo.deleteBlock(id);
    state.blocks = state.blocks.filter((b) => b.id !== id);
    renderBlocks();
    emit('blocks:changed');
  } catch (e) { console.error(e); notify('삭제에 실패했어요'); }
}

function drawNow() {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  const el2 = document.getElementById('nowLineEl');
  if (!el2) return;
  clear(el2);
  if (m < START_H * 60 || m > END_H * 60) return;
  const line = el('div', { class: 'now-line', style: { top: toTop(m) + 'px' } });
  line.appendChild(el('div', { class: 'now-dot' }));
  el2.appendChild(line);
}

function updateSummary() {
  const t = { work: 0, personal: 0, rest: 0, etc: 0 };
  state.blocks.forEach((b) => { t[b.cat] += (b.end_min - b.start_min); });
  document.getElementById('sumWork').textContent = fmtDur(t.work);
  document.getElementById('sumPersonal').textContent = fmtDur(t.personal);
  document.getElementById('sumRest').textContent = fmtDur(t.rest);
  document.getElementById('sumEtc').textContent = fmtDur(t.etc);
}

// ===== MITs =====
function renderMitRow(pos) {
  const row = el('div', { class: 'mit-row', dataset: { pos: String(pos) } });
  const num = el('span', { class: 'mit-num' }, '#' + pos);
  const check = el('button', { class: 'mit-check', 'aria-label': 'MIT 완료' });
  check.addEventListener('click', () => toggleMitDone(pos));
  const input = el('input', { class: 'mit-input', type: 'text', placeholder: pos === 1 ? '오늘 꼭 끝낼 일 1' : '꼭 끝낼 일 ' + pos, maxlength: 120 });
  const debouncedSave = debounce(() => saveMit(pos, input.value), 500);
  input.addEventListener('input', debouncedSave);
  row.append(num, check, input);
  return row;
}

function renderMits() {
  for (let pos = 1; pos <= 3; pos++) {
    const row = document.querySelector(`.mit-row[data-pos="${pos}"]`);
    if (!row) continue;
    const m = state.mits.find((x) => x.position === pos);
    const input = row.querySelector('.mit-input');
    const check = row.querySelector('.mit-check');
    input.value = m?.text || '';
    check.classList.toggle('done', !!(m && m.done));
    input.classList.toggle('done', !!(m && m.done));
  }
}

async function saveMit(pos, text) {
  const userId = state.user?.id;
  if (!userId) return;
  const date = isoDate();
  const trimmed = (text || '').trim();
  const existing = state.mits.find((m) => m.position === pos);
  try {
    if (!trimmed) {
      if (existing) {
        await repo.deleteMit(userId, date, pos);
        state.mits = state.mits.filter((m) => m.position !== pos);
      }
      return;
    }
    const saved = await repo.upsertMit(userId, date, pos, trimmed, existing?.done || false);
    const idx = state.mits.findIndex((m) => m.position === pos);
    if (idx >= 0) state.mits[idx] = saved; else state.mits.push(saved);
    emit('mits:changed');
  } catch (e) { console.error(e); }
}

async function toggleMitDone(pos) {
  const userId = state.user?.id;
  if (!userId) return;
  const m = state.mits.find((x) => x.position === pos);
  if (!m) { notify('먼저 할 일을 적어주세요'); return; }
  try {
    const saved = await repo.setMitDone(m.id, !m.done);
    const idx = state.mits.findIndex((x) => x.position === pos);
    state.mits[idx] = saved;
    renderMits();
    emit('mits:changed');
  } catch (e) { console.error(e); }
}

async function loadCarryover() {
  const userId = state.user?.id;
  if (!userId) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yIso = isoDate(yesterday);
  try {
    const ymits = await repo.fetchMits(userId, yIso);
    const carry = ymits.filter((m) => !m.done && m.text);
    const box = document.getElementById('mitCarryover');
    clear(box);
    if (!carry.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    const hint = el('span', { class: 'mit-hint' }, '어제 못 끝낸 일 (눌러서 오늘로 가져오기)');
    box.appendChild(hint);
    carry.forEach((m) => {
      const row = el('div', { class: 'mit-carryover-item', title: '오늘로 가져오기' });
      row.textContent = '↪ ' + m.text;
      row.addEventListener('click', () => copyCarry(m.text));
      box.appendChild(row);
    });
  } catch (e) { console.error(e); }
}

async function copyCarry(text) {
  // find first empty MIT slot
  for (let pos = 1; pos <= 3; pos++) {
    const cur = state.mits.find((m) => m.position === pos);
    if (!cur || !cur.text) {
      const userId = state.user?.id;
      const saved = await repo.upsertMit(userId, isoDate(), pos, text, false);
      const idx = state.mits.findIndex((m) => m.position === pos);
      if (idx >= 0) state.mits[idx] = saved; else state.mits.push(saved);
      renderMits();
      notify('오늘 MIT에 추가했어요');
      emit('mits:changed');
      return;
    }
  }
  notify('오늘 MIT 3칸이 이미 차있어요');
}

// ===== Reflection =====
function renderReflection() {
  const note = document.getElementById('reflectNote');
  note.value = state.reflection?.note || '';
  document.querySelectorAll('.mood-btn').forEach((b) => {
    b.classList.toggle('selected', Number(b.dataset.mood) === state.reflection?.mood);
  });
  document.getElementById('reflectStatus').textContent = state.reflection ? '저장됨' : '';
}

async function saveReflection(patch) {
  const userId = state.user?.id;
  if (!userId) return;
  try {
    const saved = await repo.upsertReflection(userId, isoDate(), patch);
    state.reflection = saved;
    document.getElementById('reflectStatus').textContent = '저장됨';
  } catch (e) {
    console.error(e);
    document.getElementById('reflectStatus').textContent = '저장 실패';
  }
}
