import { dist } from '../core/vec';
import type { GameState, PlayerId } from '../sim/types';

/**
 * First-run coach.
 *
 * One instruction at a time, each cleared by actually doing the thing. It reads
 * the simulation to decide when a step is complete and never blocks input — a
 * tutorial you can ignore is a tutorial people finish.
 *
 * The order is the game's actual loop, in the order it has to be learned:
 * move, buy, lift, fly, set down with an order, and watch an outpost pay you.
 */
interface Step {
  text: string;
  done: (c: Ctx) => boolean;
  hold?: number;    // extra ticks to linger after completion, for readability
}

interface Ctx {
  state: GameState;
  me: PlayerId;
  movedFrom: { x: number; y: number };
  everCarried: boolean;
}

const nearestOpenOutpost = (s: GameState, me: PlayerId) => {
  let best = null as null | { x: number; y: number };
  let bd = Infinity;
  const m = s.mechs[me];
  for (const b of s.bases) {
    if (b.isHQ || b.owner === me) continue;
    const d = dist(m.x, m.y, b.x, b.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
};

const STEPS: Step[] = [
  {
    text: 'Drag your left thumb anywhere on the left half of the screen to walk.',
    done: (c) => dist(c.state.mechs[c.me].x, c.state.mechs[c.me].y,
      c.movedFrom.x, c.movedFrom.y) > 70,
  },
  {
    text: 'Stand on your base and tap BUILD. Buy Infantry, and give it TAKE OUTPOST.',
    done: (c) => c.state.players[c.me].unitsBuilt >= 1,
    hold: 40,
  },
  {
    text: 'Walk onto your new infantry and tap LIFT to pick it up.',
    done: (c) => c.state.mechs[c.me].carryingUnitId >= 0,
  },
  {
    text: 'Tap JET and fly it to the pulsing outpost. Carrying costs extra fuel.',
    done: (c) => {
      const t = nearestOpenOutpost(c.state, c.me);
      const m = c.state.mechs[c.me];
      return !!t && dist(m.x, m.y, t.x, t.y) < 260;
    },
  },
  {
    text: 'Tap WALK to land, then LIFT again to set the infantry down.',
    done: (c) => c.everCarried && c.state.mechs[c.me].carryingUnitId < 0,
    hold: 40,
  },
  {
    text: 'Only infantry can take an outpost. Hold the ring and wait.',
    done: (c) => c.state.bases.some((b) => !b.isHQ && b.owner === c.me),
    hold: 70,
  },
  {
    text: 'Outposts pay you every second. Take more, build an army, kill the enemy HQ.',
    done: () => false,
    hold: 260,
  },
];

export class Coach {
  private index = 0;
  private holdLeft = 0;
  private ctx: Ctx | null = null;
  private el: HTMLElement;
  private textEl: HTMLElement;
  private stepEl: HTMLElement;
  active = false;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'coach';
    this.stepEl = document.createElement('span');
    this.stepEl.className = 'n';
    this.textEl = document.createElement('span');
    this.textEl.className = 't';
    const skip = document.createElement('button');
    skip.textContent = 'SKIP';
    skip.onclick = (e) => { e.stopPropagation(); this.stop(); };
    this.el.append(this.stepEl, this.textEl, skip);
    this.el.style.display = 'none';
    root.appendChild(this.el);
  }

  start(state: GameState, me: PlayerId): void {
    const m = state.mechs[me];
    this.ctx = { state, me, movedFrom: { x: m.x, y: m.y }, everCarried: false };
    this.index = 0;
    this.holdLeft = 0;
    this.active = true;
    this.el.style.display = 'flex';
    this.render();
  }

  stop(): void {
    this.active = false;
    this.el.style.display = 'none';
  }

  /** Called once per simulated tick. Cheap: a couple of distance checks. */
  tick(state: GameState): void {
    if (!this.active || !this.ctx) return;
    this.ctx.state = state;
    if (state.mechs[this.ctx.me].carryingUnitId >= 0) this.ctx.everCarried = true;

    if (this.holdLeft > 0) {
      if (--this.holdLeft === 0) this.advance();
      return;
    }
    const step = STEPS[this.index];
    if (!step) { this.stop(); return; }
    if (step.done(this.ctx)) {
      this.holdLeft = step.hold ?? 1;
      this.el.classList.add('ok');
    }
  }

  private advance(): void {
    this.el.classList.remove('ok');
    this.index++;
    if (this.index >= STEPS.length) { this.stop(); return; }
    // The last card is advice, not a task; it times out on its own.
    if (!STEPS[this.index].done(this.ctx!) || this.index === STEPS.length - 1) this.render();
    else this.holdLeft = 1;
  }

  private render(): void {
    const step = STEPS[this.index];
    if (!step) return;
    this.stepEl.textContent = `${this.index + 1}/${STEPS.length}`;
    this.textEl.textContent = step.text;
  }
}
