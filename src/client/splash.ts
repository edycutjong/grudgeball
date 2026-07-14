/**
 * Splash entrypoint — the fast, inline feed card (devvit.json `default`,
 * `inline: true`). Shows a live board snapshot + one CTA that expands into the
 * `game` entrypoint. Heavy interaction is deferred to game.ts.
 */
import './styles.css';
import { requestExpandedMode } from '@devvit/web/client';
import { api } from './lib/api';
import { isDemoActive } from './lib/demo';
import { drawSnapshot, fitCanvas } from './lib/board-render';

const canvas = document.getElementById('snapshot') as HTMLCanvasElement | null;
const stat = document.getElementById('stat');
const tag = document.getElementById('tag');
const enter = document.getElementById('enter') as HTMLButtonElement | null;

enter?.addEventListener('click', (event) => {
  // requestExpandedMode requires a trusted gesture; a click qualifies.
  try {
    requestExpandedMode(event, 'game');
  } catch {
    // Already expanded, or running outside a webview host — no-op.
  }
});

async function load(): Promise<void> {
  if (canvas === null) return;
  const ctx = fitCanvas(canvas);
  if (ctx === null) return;
  try {
    const res = await api.board();
    if (res.status !== 'ok') {
      if (stat !== null) stat.textContent = 'board unavailable';
      return;
    }
    const b = res.board;
    drawSnapshot(ctx, { objects: b.objects, terrain: b.terrain, gates: b.gates, trails: b.trails });
    if (stat !== null) {
      const demoTag = isDemoActive() ? ' · demo' : '';
      stat.innerHTML = `DAY ${b.dayNumber} · <span class="c">${b.activeTrapCount} TRAPS</span> · CRUELTY ×${b.cruelty.toFixed(1)}${demoTag}`;
    }
    if (tag !== null && b.objects.length === 0) {
      tag.textContent = 'Fresh board. Be the first to drop — and the first to plant a grudge.';
    }
  } catch {
    if (stat !== null) stat.textContent = 'board unavailable';
  }
}

void load();
