/**
 * Game entrypoint (devvit.json `game`, expanded view). Single-canvas state
 * machine: DROP → death/score BEAT → (repeat until marbles spent) → PLACE →
 * "returns at dawn". The morning GRUDGE REPORT modal fires on open when
 * unseen; the leaderboard sheet is a pull-up. All state changes go through the
 * server; client physics is authoritative only for feel (COMPLEXITY.md §3).
 */
import './styles.css';
import { connectRealtime, showToast } from '@devvit/web/client';
import { MARBLES_PER_DAY, NAME_MAX_LEN } from '../shared/constants';
import { legalCells } from '../shared/grid';
import { tomorrow } from '../shared/day';
import { CATEGORY_OF, OBJECT_TYPES } from '../shared/types';
import type { BoardView, Cell, LeaderboardTab, LiveMessage, ObjectType, Rot } from '../shared/types';
import { api } from './lib/api';
import { isDemoActive } from './lib/demo';
import { drawBoard, fitCanvas, glyphFor, pxToCell, pxToCol } from './lib/board-render';
import { simulateDrop } from './lib/sim';
import type { SimResult } from './lib/sim';
import * as audio from './lib/audio';

type Mode = 'drop' | 'animating' | 'place' | 'done';

const el = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

const canvas = el<HTMLCanvasElement>('board');
const ctx = canvas !== null ? fitCanvas(canvas) : null;

const dom = {
  day: el('day'),
  traps: el('traps'),
  cruelty: el('cruelty'),
  pips: el('pips'),
  controls: el('controls'),
  hint: el('hint'),
  placebar: el('placebar'),
  beat: el('beat'),
  beatCard: el('beat-card'),
  report: el('report'),
  reportCard: el('report-card'),
  lb: el('lb'),
  lbCard: el('lb-card'),
};

const state = {
  view: null as BoardView | null,
  /** Board rendered while placing (tomorrow's preview). */
  placeView: null as BoardView | null,
  mode: 'drop' as Mode,
  aimCol: 4,
  marblesLeft: MARBLES_PER_DAY,
  placed: false,
  legal: new Set<string>(),
  selected: null as Cell | null,
  placeType: 'spike' as ObjectType,
  placeRot: 0 as Rot,
  lastSim: null as SimResult | null,
};

function scene(view: BoardView): { objects: BoardView['objects']; terrain: Cell[]; gates: Cell[]; trails: number[][] } {
  return { objects: view.objects, terrain: view.terrain, gates: view.gates, trails: view.trails };
}

function render(marble?: { x: number; y: number } | null): void {
  if (ctx === null) return;
  const placing = state.mode === 'place';
  const view = placing ? state.placeView : state.view;
  if (view === null) return;
  drawBoard(ctx, scene(view), {
    aimCol: state.mode === 'drop' ? state.aimCol : null,
    marble: marble ?? null,
    dim: placing,
    highlightCells: placing ? state.legal : null,
    selected: placing ? state.selected : null,
  });
}

function renderHud(): void {
  const v = state.view;
  if (v === null) return;
  if (dom.day !== null) dom.day.textContent = `DAY ${v.dayNumber}${isDemoActive() ? ' · demo' : ''}`;
  if (dom.traps !== null) dom.traps.textContent = `${v.activeTrapCount} TRAPS`;
  if (dom.cruelty !== null) dom.cruelty.textContent = `×${v.cruelty.toFixed(1)}`;
  if (dom.pips !== null) {
    dom.pips.innerHTML = '';
    for (let i = 0; i < MARBLES_PER_DAY; i++) {
      const pip = document.createElement('span');
      pip.className = i < state.marblesLeft ? 'pip' : 'pip spent';
      dom.pips.appendChild(pip);
    }
  }
}

function setHint(text: string): void {
  if (dom.hint !== null) dom.hint.textContent = text;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls !== '') b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

function renderControls(): void {
  if (dom.controls === null) return;
  dom.controls.innerHTML = '';
  if (dom.placebar !== null) dom.placebar.classList.add('hidden');

  if (state.mode === 'drop') {
    const drop = button('DROP', 'red', () => void doDrop());
    drop.disabled = state.marblesLeft <= 0;
    dom.controls.appendChild(drop);
    dom.controls.appendChild(button('LEADERBOARD', 'ghost', () => void showLeaderboard('depth')));
    setHint(state.marblesLeft > 0 ? 'Tap a column to aim, then DROP.' : 'Marbles spent — plant your grudge.');
    if (state.marblesLeft <= 0) enterPlace();
  } else if (state.mode === 'place') {
    renderPlacebar();
    dom.controls.appendChild(button('LEADERBOARD', 'ghost', () => void showLeaderboard('menace')));
  } else if (state.mode === 'done') {
    dom.controls.appendChild(button('LEADERBOARD', 'ghost', () => void showLeaderboard('depth')));
    setHint('That is all for today. New board at midnight UTC.');
  }
}

// ── DROP ────────────────────────────────────────────────────────────────────

async function doDrop(): Promise<void> {
  if (state.view === null || state.mode !== 'drop' || state.marblesLeft <= 0) return;
  state.mode = 'animating';
  renderControls();
  const runId = `r_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const sim = simulateDrop(
    { aimCol: state.aimCol, objects: state.view.objects, terrain: state.view.terrain },
    runId
  );
  state.lastSim = sim;
  await animateMarble(sim);
  let res;
  try {
    res = await api.drop(sim.run);
  } catch {
    showToast('Drop failed — try again.');
    state.mode = 'drop';
    renderControls();
    render();
    return;
  }
  handleDropResponse(res, sim);
}

function animateMarble(sim: SimResult): Promise<void> {
  return new Promise((resolve) => {
    const pts = sim.run.polyline;
    if (pts.length < 4) {
      resolve();
      return;
    }
    const durationMs = 250 + Math.min(1100, sim.run.depth * 55);
    const start = performance.now();
    const step = (t: number): void => {
      const f = Math.min(1, (t - start) / durationMs);
      const seg = f * (pts.length / 2 - 1);
      const i = Math.min(pts.length / 2 - 2, Math.floor(seg));
      const local = seg - i;
      const x0 = pts[i * 2] ?? 0;
      const y0 = pts[i * 2 + 1] ?? 0;
      const x1 = pts[i * 2 + 2] ?? x0;
      const y1 = pts[i * 2 + 3] ?? y0;
      render({ x: x0 + (x1 - x0) * local, y: y0 + (y1 - y0) * local });
      if (f < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function handleDropResponse(res: Awaited<ReturnType<typeof api.drop>>, sim: SimResult): void {
  if (res.status === 'anonymous') {
    showBeat('<h2>LOG IN TO PLAY</h2><p class="hint">Grudgeball needs your Reddit identity so your grudges have a name.</p>');
    state.mode = 'drop';
    renderControls();
    return;
  }
  if (res.status === 'closed') {
    showBeat('<h2>BOARD NOT OPEN YET</h2><p class="hint">Today’s board compiles at midnight UTC. A mod can run <b>Seed Demo Day</b> to open it now.</p>');
    state.mode = 'drop';
    renderControls();
    return;
  }
  if (res.status === 'duplicate' || res.status === 'out-of-marbles') {
    state.marblesLeft = 0;
    renderHud();
    enterPlace();
    return;
  }
  // ok
  state.marblesLeft = res.marblesLeft;
  renderHud();
  const killer = sim.killer;
  // The grudge's accumulated body count BEFORE your marble, and after: this is
  // the "oh" — you are victim N+1 of a trap a stranger named, and they profit.
  const bodiesBefore = killer !== null ? killer.kills : 0;
  const bodiesAfter = bodiesBefore + 1;
  const body =
    killer !== null
      ? `<h2>KILLED BY</h2><div class="killer-name">${escapeHtml(killer.name)}</div>` +
        `<div class="tick"><span class="tick-num" id="bodycount">${bodiesBefore}</span>` +
        `<span class="tick-label">bodies claimed</span></div>` +
        `<p class="credit">u/${escapeHtml(killer.author)} banks <b>+1 ${CATEGORY_OF[killer.type]}</b></p>` +
        statRow('You were victim', `#${bodiesAfter}`) +
        statRow('Cruelty', `×${res.cruelty.toFixed(1)}`) +
        statRow('Score', String(res.score))
      : `<h2>${sim.run.reachedGoal ? 'YOU SURVIVED' : 'CAME TO REST'}</h2>` +
        statRow('Depth', `row ${sim.run.depth}`) +
        statRow('Coins', String(sim.run.coins)) +
        statRow('Score', String(res.score));
  if (killer !== null) audio.kill();
  else audio.survive();
  showBeat(body, () => {
    if (res.status === 'ok' && res.canPlace) {
      enterPlace();
    } else {
      state.mode = 'drop';
      renderControls();
      render();
    }
  });
  // Tick the body count up to your kill — the builder's credit, made visible.
  if (killer !== null) animateCount(el('bodycount'), bodiesBefore, bodiesAfter);
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count `node` from → to over ~900ms, with a pop on the final increment. */
function animateCount(node: HTMLElement | null, from: number, to: number): void {
  if (node === null) return;
  if (prefersReducedMotion() || to - from > 400) {
    node.textContent = String(to);
    node.classList.add('bump');
    return;
  }
  const durationMs = 900;
  const start = performance.now();
  const step = (t: number): void => {
    const f = Math.min(1, (t - start) / durationMs);
    const eased = 1 - (1 - f) * (1 - f);
    node.textContent = String(Math.round(from + (to - from) * eased));
    if (f < 1) requestAnimationFrame(step);
    else node.classList.add('bump');
  };
  requestAnimationFrame(step);
}

// ── PLACE ────────────────────────────────────────────────────────────────────

function enterPlace(): void {
  state.mode = 'place';
  setHint('Loading tomorrow’s board…');
  renderControls();
  void loadPreview();
}

async function loadPreview(): Promise<void> {
  const today = state.view?.day;
  if (today === undefined) return;
  try {
    const res = await api.board(tomorrow(today));
    if (res.status !== 'ok') return;
    state.placeView = res.board;
    const occupied = res.board.objects.map((o) => o.cell);
    state.legal = new Set(
      legalCells(
        new Set(res.board.terrain.map((c) => `${c.c},${c.r}`)),
        new Set(res.board.gates.map((c) => `${c.c},${c.r}`)),
        new Set(occupied.map((c) => `${c.c},${c.r}`))
      ).map((c) => `${c.c},${c.r}`)
    );
    if (state.placed || res.board.me?.placed === true) {
      state.placed = true;
      state.mode = 'done';
      showBeat('<h2>ALREADY PLANTED</h2><p class="hint">Your grudge is queued for tomorrow. Come back at dawn for your report.</p>');
      renderControls();
      return;
    }
    setHint('Pick an object, tap a glowing cell, name it, then PLANT.');
    renderControls();
    render();
  } catch {
    setHint('Could not load the placement board.');
  }
}

function renderPlacebar(): void {
  const bar = dom.placebar;
  if (bar === null) return;
  bar.classList.remove('hidden');
  bar.innerHTML = '';

  const palette = document.createElement('div');
  palette.className = 'palette';
  for (const type of OBJECT_TYPES) {
    const cat = CATEGORY_OF[type];
    const sw = document.createElement('div');
    sw.className = `swatch ${cat}${type === state.placeType ? ' on' : ''}`;
    sw.innerHTML = `<span class="g">${glyphFor(type)}</span>${type}`;
    sw.addEventListener('click', () => {
      state.placeType = type;
      renderPlacebar();
    });
    palette.appendChild(sw);
  }
  bar.appendChild(palette);

  const name = document.createElement('input');
  name.type = 'text';
  name.id = 'grudge-name';
  name.maxLength = NAME_MAX_LEN;
  name.placeholder = 'name your grudge (e.g. Greg’s Regret)';
  bar.appendChild(name);

  const row = document.createElement('div');
  row.className = 'controls';
  row.appendChild(
    button('ROTATE', 'ghost', () => {
      state.placeRot = ((state.placeRot + 1) % 4) as Rot;
      showToast(`rotation ${state.placeRot}`);
    })
  );
  const plant = button('PLANT — returns at dawn', 'green', () => void doPlace());
  row.appendChild(plant);
  bar.appendChild(row);
}

async function doPlace(): Promise<void> {
  if (state.selected === null) {
    showToast('Tap a glowing cell first.');
    return;
  }
  const nameInput = el<HTMLInputElement>('grudge-name');
  const name = (nameInput?.value ?? '').trim();
  if (name === '') {
    showToast('Name your grudge.');
    return;
  }
  let res;
  try {
    res = await api.place({ type: state.placeType, cell: state.selected, rot: state.placeRot, name });
  } catch {
    showToast('Placement failed — try again.');
    return;
  }
  if (res.status === 'ok') {
    audio.plant();
    state.placed = true;
    state.mode = 'done';
    showBeat(
      `<h2>PLANTED</h2><div class="killer-name">${escapeHtml(name)}</div>` +
        `<p class="hint">Returns tomorrow around hour ${res.releasePreviewHour} UTC. ` +
        `Every stranger it ${CATEGORY_OF[state.placeType] === 'menace' ? 'kills' : 'saves'} earns you credit overnight.</p>`
    );
    renderControls();
  } else {
    showToast(res.message);
  }
}

// ── REPORT + LEADERBOARD ─────────────────────────────────────────────────────

async function maybeShowReport(): Promise<void> {
  try {
    const res = await api.report();
    if (res.status !== 'ok' || !res.unseen) return;
    const r = res.report;
    const verb = r.kills >= r.saves ? 'claimed' : 'saved';
    const n = Math.max(r.kills, r.saves);
    const rank =
      r.menaceRank !== null
        ? `#${r.menaceRank} Menace`
        : r.angelRank !== null
          ? `#${r.angelRank} Angel`
          : r.depthRank !== null
            ? `#${r.depthRank} Depth`
            : 'unranked';
    audio.reveal();
    showModal(
      dom.report,
      dom.reportCard,
      `<h2>YESTERDAY’S GRUDGE</h2>` +
        (r.objectName !== ''
          ? `<div class="killer-name">${escapeHtml(r.objectName)}</div><p class="hint">${verb} ${n} marbles overnight</p>`
          : `<p class="hint">You didn’t plant yesterday.</p>`) +
        statRow('Kills', String(r.kills)) +
        statRow('Saves', String(r.saves)) +
        statRow('Your rank', rank) +
        statRow('Board deadliest', `${escapeHtml(r.deadliestName)} (${r.deadliestKills})`) +
        statRow('Built by', `${r.builders} redditors`),
      'TO TODAY’S BOARD'
    );
  } catch {
    /* report is best-effort */
  }
}

async function showLeaderboard(tab: LeaderboardTab): Promise<void> {
  const tabs: LeaderboardTab[] = ['depth', 'menace', 'angel', 'streak'];
  let body = '<h2>LEADERBOARD</h2><div class="tabs">';
  for (const t of tabs) body += `<div class="tab${t === tab ? ' on' : ''}" data-tab="${t}">${t}</div>`;
  body += '</div><div id="lb-rows">loading…</div>';
  showModal(dom.lb, dom.lbCard, body, 'CLOSE');
  const rowsEl = el('lb-rows');
  if (dom.lbCard !== null) {
    for (const tabEl of Array.from(dom.lbCard.querySelectorAll<HTMLElement>('.tab'))) {
      tabEl.addEventListener('click', () => {
        const t = tabEl.getAttribute('data-tab') as LeaderboardTab | null;
        if (t !== null) void showLeaderboard(t);
      });
    }
  }
  try {
    const res = await api.leaderboards(tab);
    if (rowsEl === null) return;
    if (res.status !== 'ok' || res.view.top.length === 0) {
      rowsEl.innerHTML = '<p class="hint">No entries yet. Be the first.</p>';
      return;
    }
    const meName = state.view?.me?.username ?? '';
    rowsEl.innerHTML = res.view.top
      .map(
        (row) =>
          `<div class="lb-row${row.member === meName ? ' me' : ''}"><span>#${row.rank} ${escapeHtml(row.member)}</span><span>${row.score}</span></div>`
      )
      .join('');
  } catch {
    if (rowsEl !== null) rowsEl.innerHTML = '<p class="hint">Leaderboard unavailable.</p>';
  }
}

// ── modal / beat helpers ─────────────────────────────────────────────────────

function statRow(k: string, v: string): string {
  return `<div class="stat-row"><span class="k">${k}</span><span>${escapeHtml(v)}</span></div>`;
}

function showBeat(html: string, onClose?: () => void): void {
  if (dom.beat === null || dom.beatCard === null) return;
  dom.beatCard.innerHTML = html;
  const b = button('CONTINUE', '', () => {
    dom.beat?.classList.add('hidden');
    onClose?.();
  });
  dom.beatCard.appendChild(b);
  dom.beat.classList.remove('hidden');
}

function showModal(
  overlay: HTMLElement | null,
  card: HTMLElement | null,
  html: string,
  closeLabel: string
): void {
  if (overlay === null || card === null) return;
  card.innerHTML = html;
  card.appendChild(button(closeLabel, '', () => overlay.classList.add('hidden')));
  overlay.classList.remove('hidden');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

// ── input ────────────────────────────────────────────────────────────────────

canvas?.addEventListener('pointerdown', (e: PointerEvent) => {
  if (canvas === null) return;
  const rect = canvas.getBoundingClientRect();
  if (state.mode === 'drop') {
    state.aimCol = pxToCol(e.clientX, rect);
    render();
  } else if (state.mode === 'place') {
    const cell = pxToCell(e.clientX, e.clientY, rect);
    if (state.legal.has(`${cell.c},${cell.r}`)) {
      state.selected = cell;
      render();
    } else {
      showToast('That cell is reserved or taken.');
    }
  }
});

// ── boot ─────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  audio.mountMuteButton(document.querySelector('.hud'));
  const unlockOnce = (): void => audio.unlock();
  document.addEventListener('pointerdown', unlockOnce, { once: true });
  document.addEventListener('keydown', unlockOnce, { once: true });
  if (ctx === null) {
    setHint('Canvas unavailable in this view.');
    return;
  }
  try {
    const res = await api.board();
    if (res.status !== 'ok') {
      setHint('Board unavailable.');
      return;
    }
    state.view = res.board;
    const used = res.board.me?.marblesUsed ?? 0;
    state.marblesLeft = Math.max(0, MARBLES_PER_DAY - used);
    state.placed = res.board.me?.placed === true;
    renderHud();
    render();
    renderControls();
    await maybeShowReport();
    subscribeLive();
  } catch {
    setHint('Board unavailable.');
  }
}

function subscribeLive(): void {
  const day = state.view?.day;
  if (day === undefined) return;
  try {
    connectRealtime<LiveMessage>({
      channel: 'board_live',
      onMessage: (msg) => {
        if (msg.t === 'placement' && msg.day === day) showToast(`u/${msg.author} planted "${msg.name}"`);
        if (msg.t === 'accrete' && msg.day === day && state.view !== null) {
          state.view.cruelty = msg.cruelty;
          renderHud();
        }
      },
    });
  } catch {
    /* realtime is garnish */
  }
}

void boot();
