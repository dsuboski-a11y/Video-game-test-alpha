import { Bot, type Difficulty } from './ai/bot';
import { Rng } from './core/rng';
import { dist } from './core/vec';
import { Audio } from './audio/audio';
import { Controls } from './input/controls';
import { Camera } from './render/camera';
import { Renderer } from './render/renderer';
import * as C from './sim/constants';
import { createContext, step, type SimContext } from './sim/step';
import type { Command, GameState, OrderId, PlayerId, UnitTypeId } from './sim/types';
import { createGame, worldHeight, worldWidth } from './sim/world';
import { Hud } from './ui/hud';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

export class Game {
  state!: GameState;
  private sim!: SimContext;
  private bot!: Bot;
  private cam = new Camera();
  private renderer = new Renderer(canvas, this.cam);
  private controls = new Controls(uiRoot);
  private audio = new Audio();
  private hud: Hud;
  private fxRng = new Rng(7);

  private readonly me: PlayerId = 0;
  private queued: Command[] = [];
  private acc = 0;
  private last = 0;
  private running = false;
  private difficulty: Difficulty = 'OFFICER';

  constructor() {
    this.hud = new Hud(uiRoot, this.controls, {
      onBuy: (unit: UnitTypeId, order: OrderId) => {
        this.queued.push({ c: 'BUY', p: this.me, unit, order });
      },
      onRewriteOrder: (order: OrderId) => {
        this.queued.push({ c: 'ORDER', p: this.me, order });
      },
      onRestart: () => this.newMatch(),
    });

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this.last = performance.now(); this.audio.resume(); }
    });
    this.renderer.resize();
    this.showTitle();
  }

  // -------------------------------------------------------------- lifecycle ---
  private showTitle(): void {
    const box = document.createElement('div');
    box.className = 'center';
    box.innerHTML =
      `<div class="tag">CARRY &middot; COMMAND &middot; CONQUER</div>` +
      `<h1>EISENKRIEG</h1>` +
      `<p>You are the commander, and you are also a unit on the field. Buy troops at a base, ` +
      `<b>lift</b> them, fly them to the front, and set them down with a standing order. ` +
      `Morph to <b>walker</b> to fight the ground war, to <b>jet</b> to move and duel the sky. ` +
      `Fuel runs out. Take outposts to pay for it all. Kill the enemy HQ to win.</p>`;

    const diffWrap = document.createElement('div');
    diffWrap.className = 'stats';
    const mk = (label: string, d: Difficulty) => {
      const b = document.createElement('button');
      b.className = 'ghost';
      b.style.minWidth = '110px';
      b.style.padding = '10px 14px';
      b.textContent = label;
      b.onclick = () => {
        this.difficulty = d;
        [...diffWrap.children].forEach((c) => c.classList.add('ghost'));
        b.classList.remove('ghost');
      };
      if (d === this.difficulty) b.classList.remove('ghost');
      return b;
    };
    diffWrap.append(mk('CADET', 'CADET'), mk('OFFICER', 'OFFICER'), mk('MARSHAL', 'MARSHAL'));
    box.appendChild(diffWrap);

    const start = document.createElement('button');
    start.textContent = 'DEPLOY';
    start.onclick = () => {
      this.audio.unlock();           // must happen inside the tap, for iOS
      box.remove();
      this.newMatch();
    };
    box.appendChild(start);

    const help = document.createElement('p');
    help.style.fontSize = '10px';
    help.innerHTML =
      `Left thumb steers &middot; FIRE holds &middot; JET/WALK morphs &middot; LIFT picks up and puts down &middot; BUILD deploys<br>` +
      `Desktop: WASD move &middot; J fire &middot; K morph &middot; L lift &middot; B build`;
    box.appendChild(help);
    uiRoot.appendChild(box);
  }

  private newMatch(): void {
    this.hud.clearEnd();
    this.hud.closeSheet();
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.state = createGame(seed);
    this.sim = createContext(this.state);
    this.bot = new Bot(1, this.difficulty, seed ^ 0x5bf03635);
    this.queued = [];
    const m = this.state.mechs[this.me];
    this.cam.follow(m.x, m.y, worldWidth(this.state.map), worldHeight(this.state.map), true);
    this.hud.toast('TAKE OUTPOSTS. THEY PAY FOR THE WAR.', 3200);

    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }
  }

  // ------------------------------------------------------------------- loop ---
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    let dt = now - this.last;
    this.last = now;
    // A backgrounded tab must not fast-forward the war when it comes back.
    if (dt > 250) dt = 250;
    this.acc += dt;

    let guard = 0;
    while (this.acc >= C.TICK_MS && guard++ < 6) {
      this.acc -= C.TICK_MS;
      this.tick();
    }

    const intensity = Math.min(1, this.state.projectiles.length / 26);
    this.audio.tickMusic(dt, intensity);
    this.cam.tickShake(() => this.fxRng.next());
    const m = this.state.mechs[this.me];
    if (m.alive) {
      this.cam.follow(m.x, m.y, worldWidth(this.state.map), worldHeight(this.state.map));
    }
    this.renderer.draw(this.state, this.me, now);
  };

  private tick(): void {
    const cmds: Command[] = [];

    // Edge-triggered UI actions read before the sim so they land this tick.
    if (this.controls.takeEdge('build')) {
      if (this.hud.sheetOpen) this.hud.closeSheet();
      else this.hud.openBuild(this.state, this.me, this.atFriendlyBase());
    }
    if (this.controls.takeEdge('cancel')) this.hud.closeSheet();

    const raw = this.controls.read();
    const frozen = this.hud.sheetOpen;
    cmds.push({
      c: 'INPUT',
      p: this.me,
      in: {
        mx: frozen ? 0 : raw.mx,
        my: frozen ? 0 : raw.my,
        fire: !frozen && raw.fire,
        transform: !frozen && raw.transformEdge,
        grab: !frozen && raw.grabEdge,
      },
    });

    cmds.push(...this.queued);
    this.queued = [];
    cmds.push(...this.bot.think(this.state));

    step(this.state, cmds, this.sim);
    this.consumeEvents();
    this.hud.update(this.state, this.me, this.atFriendlyBase());

    if (this.state.winner !== null) {
      this.hud.showEnd(this.state, this.me);
      this.audio.fanfare(this.state.winner === this.me);
    }
  }

  private atFriendlyBase(): boolean {
    const m = this.state.mechs[this.me];
    return this.state.bases.some(
      (b) => b.owner === this.me && dist(m.x, m.y, b.x, b.y) <= b.radius + C.MECH_RADIUS,
    );
  }

  /** Presentation only: the sim never knows the camera exists. */
  private consumeEvents(): void {
    const cx = this.cam.x, cy = this.cam.y;
    const audible = 900;
    for (const e of this.state.events) {
      switch (e.t) {
        case 'shot': {
          const d = dist(cx, cy, e.x, e.y);
          this.audio.shot(e.kind, Math.max(0, 1 - d / audible) ** 2);
          break;
        }
        case 'explode': {
          const d = dist(cx, cy, e.x, e.y);
          const near = Math.max(0, 1 - d / audible) ** 2;
          this.audio.explode(e.big, near);
          if (e.big && near > 0.25) this.cam.addShake(near * (e.big ? 7 : 3));
          break;
        }
        case 'pickup': this.audio.pickup(); break;
        case 'drop': this.audio.drop(); break;
        case 'build': if (e.owner === this.me) this.audio.build(); break;
        case 'denied': if (e.owner === this.me) { this.audio.denied(); this.hud.toast('NOT ENOUGH CREDITS — OR NOT ON A BASE'); } break;
        case 'capture':
          this.audio.capture(e.owner === this.me);
          this.hud.toast(e.owner === this.me ? 'OUTPOST SECURED' : 'OUTPOST LOST');
          break;
        case 'hqhit':
          if (e.owner === this.me && this.state.tick % 30 === 0) this.hud.toast('HQ UNDER FIRE', 1000);
          break;
      }
    }
  }
}

const game = new Game();

// Test/debug hook: lets the smoke test assert on real simulation state rather
// than inferring it from pixels. Read-only, and costs nothing at runtime.
(window as unknown as { __EK: unknown }).__EK = game;

// Register the offline cache only in a real build; the dev server has no sw.js.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline is a bonus, not a requirement */ });
  });
}
