import { Bot, type Difficulty } from './ai/bot';
import { Rng } from './core/rng';
import { dist } from './core/vec';
import { Audio } from './audio/audio';
import { Controls } from './input/controls';
import { NetSession, type NetPhase } from './net/session';
import { encodeInput, INPUT_DELAY, toCommands } from './net/protocol';
import { Camera } from './render/camera';
import { projectedBounds, screenDirToWorld, toScreen } from './render/iso';
import { Renderer } from './render/renderer';
import { checksum } from './sim/checksum';
import * as C from './sim/constants';
import { createContext, step, type SimContext } from './sim/step';
import type { Command, GameState, MechInput, OrderId, PlayerId, UnitTypeId } from './sim/types';
import { createGame } from './sim/world';
import { Hud } from './ui/hud';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

type Mode = 'SOLO' | 'NET';

const el = (tag: string, cls?: string, html?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

export class Game {
  state!: GameState;
  private sim!: SimContext;
  private bot!: Bot;
  private cam = new Camera();
  readonly renderer = new Renderer(canvas, this.cam);
  private controls = new Controls(uiRoot);
  private audio = new Audio();
  private hud: Hud;
  private fxRng = new Rng(7);

  me: PlayerId = 0;
  mode: Mode = 'SOLO';
  net: NetSession | null = null;
  stallTicks = 0;

  private pendingBuy: { unit: UnitTypeId; order: OrderId } | null = null;
  private pendingOrder: OrderId | null = null;
  private acc = 0;
  private last = 0;
  private running = false;
  private difficulty: Difficulty = 'OFFICER';
  private lobby: HTMLElement | null = null;

  constructor() {
    this.hud = new Hud(uiRoot, this.controls, {
      onBuy: (unit, order) => { this.pendingBuy = { unit, order }; },
      onRewriteOrder: (order) => { this.pendingOrder = order; },
      onRestart: () => this.leaveToTitle(),
    });

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this.last = performance.now(); this.audio.resume(); }
    });
    this.renderer.resize();
    this.showTitle();
  }

  // -------------------------------------------------------------- title ----
  private showTitle(): void {
    const box = el('div', 'center');
    box.innerHTML =
      `<div class="tag">CARRY &middot; COMMAND &middot; CONQUER</div>` +
      `<h1>EISENKRIEG</h1>` +
      `<p>You are the commander, and you are also a unit on the field. Buy troops at a base, ` +
      `<b>lift</b> them, fly them to the front, and set them down with a standing order. ` +
      `Morph to <b>walker</b> to fight the ground war, to <b>jet</b> to move and duel the sky. ` +
      `Fuel runs out. Take outposts to pay for it all. Kill the enemy HQ to win.</p>`;

    const diffWrap = el('div', 'stats');
    const mk = (label: string, d: Difficulty) => {
      const b = el('button', 'ghost', label) as HTMLButtonElement;
      b.style.minWidth = '104px';
      b.style.padding = '10px 12px';
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

    const solo = el('button', undefined, 'SKIRMISH vs AI') as HTMLButtonElement;
    solo.onclick = () => { this.audio.unlock(); box.remove(); this.startSolo(); };

    const row = el('div', 'stats');
    const host = el('button', 'ghost', 'HOST A GAME') as HTMLButtonElement;
    host.style.minWidth = '150px';
    host.onclick = () => { this.audio.unlock(); box.remove(); this.startNet('host'); };
    const join = el('button', 'ghost', 'JOIN WITH CODE') as HTMLButtonElement;
    join.style.minWidth = '150px';
    join.onclick = () => { this.audio.unlock(); box.remove(); this.startNet('join'); };
    row.append(host, join);
    box.append(solo, row);

    const help = el('p');
    help.style.fontSize = '10px';
    help.innerHTML =
      `Left thumb steers &middot; FIRE holds &middot; JET/WALK morphs &middot; LIFT picks up and puts down &middot; BUILD deploys<br>` +
      `Desktop: WASD move &middot; J fire &middot; K morph &middot; L lift &middot; B build`;
    box.appendChild(help);
    uiRoot.appendChild(box);
  }

  private leaveToTitle(): void {
    this.net?.close();
    this.net = null;
    this.hud.clearEnd();
    this.hud.closeSheet();
    this.showTitle();
  }

  // -------------------------------------------------------------- lobby ----
  private startNet(intent: 'host' | 'join'): void {
    const net = new NetSession();
    this.net = net;
    const box = el('div', 'center');
    this.lobby = box;
    uiRoot.appendChild(box);

    const render = (phase: NetPhase, detail: string) => {
      box.innerHTML = '';
      const tag = el('div', 'tag', intent === 'host' ? 'HOSTING' : 'JOINING');
      box.appendChild(tag);
      if (phase === 'waiting') {
        box.appendChild(el('h1', undefined, net.code));
        box.appendChild(el('p', undefined,
          'Read this code to the other player, or send it to them. ' +
          'The match starts the moment they join.'));
      } else if (phase === 'error') {
        box.appendChild(el('h1', 'lose', 'NO LINK'));
        box.appendChild(el('p', undefined, detail));
      } else {
        box.appendChild(el('h1', undefined, phase === 'connecting' ? 'LINKING' : 'CONNECTING'));
        box.appendChild(el('p', undefined, detail || 'Contacting the lobby…'));
      }
      const back = el('button', 'ghost', 'BACK') as HTMLButtonElement;
      back.onclick = () => { net.close(); box.remove(); this.lobby = null; this.showTitle(); };
      box.appendChild(back);
    };

    net.onPhase = (p, d) => { if (this.lobby) render(p, d); };
    net.onReady = (seed, slot) => {
      this.lobby?.remove();
      this.lobby = null;
      this.startMatch(seed, 'NET', slot);
    };

    if (intent === 'host') { render('signalling', ''); net.host(); }
    else this.askCode(box, net, render);
  }

  private askCode(
    box: HTMLElement, net: NetSession,
    render: (p: NetPhase, d: string) => void,
  ): void {
    box.innerHTML = '';
    box.appendChild(el('div', 'tag', 'JOIN A GAME'));
    box.appendChild(el('h1', undefined, 'CODE'));
    const input = document.createElement('input');
    input.maxLength = 4;
    input.autocapitalize = 'characters';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '####';
    Object.assign(input.style, {
      font: '700 34px ui-monospace, monospace', letterSpacing: '.3em',
      textAlign: 'center', width: '210px', padding: '12px',
      background: 'rgba(255,255,255,.06)', color: '#cfe3ff',
      border: '1px solid rgba(120,180,255,.3)', borderRadius: '12px',
    } as Partial<CSSStyleDeclaration>);
    box.appendChild(input);

    const go = el('button', undefined, 'CONNECT') as HTMLButtonElement;
    go.onclick = () => {
      const code = input.value.trim().toUpperCase();
      if (code.length !== 4) { input.focus(); return; }
      render('signalling', `looking for ${code}`);
      net.join(code);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    box.appendChild(go);

    const back = el('button', 'ghost', 'BACK') as HTMLButtonElement;
    back.onclick = () => { net.close(); box.remove(); this.lobby = null; this.showTitle(); };
    box.appendChild(back);
    setTimeout(() => input.focus(), 50);
  }

  // ------------------------------------------------------------- matches ---
  private startSolo(): void {
    this.startMatch((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0, 'SOLO', 0);
  }

  private startMatch(seed: number, mode: Mode, slot: PlayerId): void {
    this.hud.clearEnd();
    this.hud.closeSheet();
    this.mode = mode;
    this.me = slot;
    this.stallTicks = 0;
    this.pendingBuy = null;
    this.pendingOrder = null;
    this.state = createGame(seed);
    this.sim = createContext(this.state);
    this.bot = new Bot(1, this.difficulty, seed ^ 0x5bf03635);

    const m = this.state.mechs[this.me];
    const p = toScreen(m.x, m.y);
    this.cam.follow(p.x, p.y, projectedBounds(this.state.map), true);
    this.hud.toast(mode === 'NET'
      ? `LINK ESTABLISHED — YOU ARE ${slot === 0 ? 'TEAL' : 'AMBER'}`
      : 'TAKE OUTPOSTS. THEY PAY FOR THE WAR.', 3200);

    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }
  }

  // ---------------------------------------------------------------- loop ---
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    let dt = now - this.last;
    this.last = now;
    if (dt > 250) dt = 250;
    this.acc += dt;

    let guard = 0;
    while (this.acc >= C.TICK_MS && guard++ < 6) {
      this.acc -= C.TICK_MS;
      this.tick();
    }

    if (!this.state) return;
    const intensity = Math.min(1, this.state.projectiles.length / 26);
    this.audio.tickMusic(dt, intensity);
    this.cam.tickShake(() => this.fxRng.next());
    const m = this.state.mechs[this.me];
    if (m.alive) {
      const p = toScreen(m.x, m.y);
      this.cam.follow(p.x, p.y, projectedBounds(this.state.map));
    }
    this.renderer.draw(this.state, this.me, now);
  };

  /** Read the player's intent for this tick. Edges are consumed here, so it
   *  must not be called on a tick whose input is already committed. */
  private readIntent(): MechInput {
    if (this.controls.takeEdge('build')) {
      if (this.hud.sheetOpen) this.hud.closeSheet();
      else this.hud.openBuild(this.state, this.me, this.atFriendlyBase());
    }
    if (this.controls.takeEdge('cancel')) this.hud.closeSheet();

    const raw = this.controls.read();
    const frozen = this.hud.sheetOpen;
    // The stick pushes in screen space, because that is where the thumb lives.
    // The mech moves in world space. The camera angle lives entirely here.
    const w = screenDirToWorld(raw.mx, raw.my);
    const wl = Math.hypot(w.x, w.y);
    const push = Math.min(1, Math.hypot(raw.mx, raw.my));
    return {
      mx: frozen || wl < 1e-4 ? 0 : (w.x / wl) * push,
      my: frozen || wl < 1e-4 ? 0 : (w.y / wl) * push,
      fire: !frozen && raw.fire,
      transform: !frozen && raw.transformEdge,
      grab: !frozen && raw.grabEdge,
    };
  }

  private tick(): void {
    if (this.mode === 'NET') { this.tickNet(); return; }

    const cmds: Command[] = [{ c: 'INPUT', p: this.me, in: this.readIntent() }];
    if (this.pendingBuy) {
      cmds.push({ c: 'BUY', p: this.me, unit: this.pendingBuy.unit, order: this.pendingBuy.order });
      this.pendingBuy = null;
    }
    if (this.pendingOrder) {
      cmds.push({ c: 'ORDER', p: this.me, order: this.pendingOrder });
      this.pendingOrder = null;
    }
    cmds.push(...this.bot.think(this.state));
    this.afterStep(cmds);
  }

  private tickNet(): void {
    const net = this.net;
    if (!net) return;

    // Produce this peer's intent for a tick INPUT_DELAY in the future.
    const target = this.state.tick + INPUT_DELAY;
    if (!net.hasLocal(target)) {
      const mech = this.readIntent();
      const buy = this.pendingBuy; this.pendingBuy = null;
      const rw = this.pendingOrder; this.pendingOrder = null;
      net.submitLocal(encodeInput(target, mech, buy, rw));
    }

    const pair = net.inputsFor(this.state.tick);
    if (!pair) {
      // The peer's input for this tick has not arrived. Do not advance — a
      // lockstep simulation that guesses is a lockstep simulation that desyncs.
      this.stallTicks++;
      if (this.stallTicks % 6 === 0) net.resend();
      if (this.stallTicks === C.TICK_HZ) this.hud.toast('WAITING FOR OPPONENT…', 1500);
      return;
    }
    if (this.stallTicks > 0) this.stallTicks = 0;

    this.afterStep(toCommands(pair));
    net.offerChecksum(this.state.tick, checksum(this.state));
    net.prune(this.state.tick);

    if (net.desyncTick !== null && this.state.winner === null) {
      this.hud.toast(`DESYNC AT TICK ${net.desyncTick} — MATCH VOID`, 6000);
      this.state.winner = -1;
    }
  }

  private afterStep(cmds: Command[]): void {
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
    const audible = 700;
    for (const e of this.state.events) {
      switch (e.t) {
        case 'shot': {
          const p = toScreen(e.x, e.y);
          this.audio.shot(e.kind, Math.max(0, 1 - dist(cx, cy, p.x, p.y) / audible) ** 2);
          break;
        }
        case 'explode': {
          const p = toScreen(e.x, e.y);
          const near = Math.max(0, 1 - dist(cx, cy, p.x, p.y) / audible) ** 2;
          this.audio.explode(e.big, near);
          if (e.big && near > 0.25) this.cam.addShake(near * 7);
          break;
        }
        case 'pickup': this.audio.pickup(); break;
        case 'drop': this.audio.drop(); break;
        case 'build': if (e.owner === this.me) this.audio.build(); break;
        case 'denied':
          if (e.owner === this.me) {
            this.audio.denied();
            this.hud.toast('NOT ENOUGH CREDITS — OR NOT ON A BASE');
          }
          break;
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

// Test/debug hook: lets the smoke and netcode tests assert on real simulation
// state rather than inferring it from pixels. Read-only, and costs nothing.
(window as unknown as { __EK: unknown }).__EK = game;

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline is a bonus */ });
  });
}
