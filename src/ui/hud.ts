import { BUILD_ORDER, ORDERS, UNIT_TYPES } from '../sim/constants';
import * as C from '../sim/constants';
import { incomeFor } from '../sim/step';
import type { GameState, OrderId, PlayerId, UnitTypeId } from '../sim/types';
import { worldHeight, worldWidth } from '../sim/world';
import { PAL, teamOf } from '../render/palette';
import type { Controls } from '../input/controls';
import { CSS } from './styles';

export interface HudCallbacks {
  onBuy(unit: UnitTypeId, order: OrderId): void;
  onRewriteOrder(order: OrderId): void;
  onRestart(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, html?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

export class Hud {
  private root: HTMLElement;
  private moneyEl!: HTMLElement;
  private incomeEl!: HTMLElement;
  private clockEl!: HTMLElement;
  private hqFill: HTMLElement[] = [];
  private statusFill: Record<string, HTMLElement> = {};
  private minimap!: HTMLCanvasElement;
  private mctx!: CanvasRenderingContext2D;
  private carryEl!: HTMLElement;
  private buildBtn!: HTMLElement;
  private modeBtn!: HTMLElement;
  private toasts!: HTMLElement;
  private sheet: HTMLElement | null = null;
  private endEl: HTMLElement | null = null;

  /** Remembered so the second and later builds are one tap, not three. */
  private lastBuy: { unit: UnitTypeId; order: OrderId } | null = null;

  constructor(
    root: HTMLElement,
    private controls: Controls,
    private cb: HudCallbacks,
  ) {
    this.root = root;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.buildChrome();
  }

  private buildChrome(): void {
    const top = el('div', 'topbar');
    const money = el('div', 'money');
    this.moneyEl = el('b', undefined, '0');
    this.incomeEl = el('span', undefined, '+0 /s');
    money.append(this.moneyEl, this.incomeEl);

    const hqs = el('div', 'hqs');
    for (const p of [0, 1] as PlayerId[]) {
      const row = el('div', 'hqrow');
      row.append(el('span', undefined, p === 0 ? 'YOU' : 'FOE'));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.background = teamOf(p).main;
      fill.style.width = '100%';
      bar.appendChild(fill);
      this.hqFill.push(fill);
      row.appendChild(bar);
      hqs.appendChild(row);
    }
    this.clockEl = el('div', 'clock', '0:00');
    top.append(money, hqs, this.clockEl);
    this.root.appendChild(top);

    this.minimap = el('canvas', 'minimap');
    this.minimap.width = 264; this.minimap.height = 166;
    this.mctx = this.minimap.getContext('2d')!;
    this.root.appendChild(this.minimap);

    // Commander vitals.
    const status = el('div', 'status');
    for (const [key, label, color] of [
      ['hp', 'HULL', PAL.hpGood], ['fuel', 'FUEL', PAL.fuel], ['ammo', 'AMMO', PAL.ammo],
    ] as const) {
      const row = el('div', 'row');
      row.append(el('span', undefined, label));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.background = color;
      bar.appendChild(fill);
      this.statusFill[key] = fill;
      row.appendChild(bar);
      status.appendChild(row);
    }
    this.root.appendChild(status);

    // Action cluster.
    const fire = el('div', 'btn fire', 'FIRE');
    const mode = el('div', 'btn mode', 'JET<span class="sub">morph</span>');
    const grab = el('div', 'btn grab', 'LIFT<span class="sub">carry</span>');
    const build = el('div', 'btn build ready', 'BUILD<span class="sub">tap</span>');
    this.modeBtn = mode;
    this.buildBtn = build;
    this.root.append(fire, mode, grab, build);
    this.controls.bindButton(fire, 'fire', true);
    this.controls.bindButton(mode, 'transform');
    this.controls.bindButton(grab, 'grab');
    this.controls.bindButton(build, 'build');

    this.carryEl = el('div', 'carry');
    this.carryEl.style.display = 'none';
    this.root.appendChild(this.carryEl);

    this.toasts = el('div', 'toasts');
    this.root.appendChild(this.toasts);
  }

  toast(msg: string, ms = 1600): void {
    const t = el('div', 'toast', msg);
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  get sheetOpen(): boolean { return this.sheet !== null; }

  closeSheet(): void { this.sheet?.remove(); this.sheet = null; }

  // ------------------------------------------------------------- build UI ---
  openBuild(state: GameState, me: PlayerId, atBase: boolean): void {
    this.closeSheet();
    const sheet = el('div', 'sheet');
    const head = el('h2');
    head.append(el('span', undefined, atBase ? 'DEPLOY UNIT' : 'LAND ON A BASE TO DEPLOY'));
    const close = el('button', undefined, 'CLOSE');
    close.onclick = () => this.closeSheet();
    head.appendChild(close);
    sheet.appendChild(head);

    const grid = el('div', 'grid');
    if (this.lastBuy && atBase) {
      const d = UNIT_TYPES[this.lastBuy.unit];
      const o = ORDERS.find((x) => x.id === this.lastBuy!.order)!;
      const again = el('button', 'card');
      again.innerHTML =
        `<div class="t"><span>REPEAT</span><span class="c">${d.cost}</span></div>` +
        `<div class="stats">${d.name} &middot; ${o.name}</div>` +
        `<div class="b">Same order as last time. One tap.</div>`;
      (again as HTMLButtonElement).disabled = state.players[me].money < d.cost;
      again.onclick = () => { this.cb.onBuy(this.lastBuy!.unit, this.lastBuy!.order); this.closeSheet(); };
      grid.appendChild(again);
    }

    for (const id of BUILD_ORDER) {
      const d = UNIT_TYPES[id];
      const card = el('button', 'card');
      const targets = [d.canHitGround ? 'GND' : null, d.canHitAir ? 'AIR' : null]
        .filter(Boolean).join('/') || 'SUPPORT';
      card.innerHTML =
        `<div class="t"><span>${d.name}</span><span class="c">${d.cost}</span></div>` +
        `<div class="stats"><span>HP ${d.hp}</span><span>RNG ${d.range}</span><span>${targets}</span>` +
        `${d.canCapture ? '<span>CAPTURES</span>' : ''}</div>` +
        `<div class="b">${d.blurb}</div>`;
      (card as HTMLButtonElement).disabled = !atBase || state.players[me].money < d.cost;
      card.onclick = () => this.openOrderPicker(id);
      grid.appendChild(card);
    }
    sheet.appendChild(grid);
    this.root.appendChild(sheet);
    this.sheet = sheet;
  }

  private openOrderPicker(unit: UnitTypeId): void {
    this.closeSheet();
    const sheet = el('div', 'sheet');
    const head = el('h2');
    head.append(el('span', undefined, `${UNIT_TYPES[unit].name.toUpperCase()} — STANDING ORDER`));
    const back = el('button', undefined, 'BACK');
    back.onclick = () => this.closeSheet();
    head.appendChild(back);
    sheet.appendChild(head);

    const grid = el('div', 'grid');
    for (const o of ORDERS) {
      const card = el('button', 'card');
      card.innerHTML =
        `<div class="t"><span>${o.name}</span><span class="c">${o.short}</span></div>` +
        `<div class="b">${o.blurb}</div>`;
      card.onclick = () => {
        this.lastBuy = { unit, order: o.id };
        this.cb.onBuy(unit, o.id);
        this.closeSheet();
      };
      grid.appendChild(card);
    }
    sheet.appendChild(grid);
    this.root.appendChild(sheet);
    this.sheet = sheet;
  }

  private openRewrite(current: OrderId): void {
    this.closeSheet();
    const sheet = el('div', 'sheet');
    const head = el('h2');
    head.append(el('span', undefined, `REWRITE ORDERS — ${C.ORDER_REWRITE_COST} CR`));
    const back = el('button', undefined, 'BACK');
    back.onclick = () => this.closeSheet();
    head.appendChild(back);
    sheet.appendChild(head);

    const grid = el('div', 'grid');
    for (const o of ORDERS) {
      const card = el('button', 'card');
      if (o.id === current) card.classList.add('down');
      card.innerHTML =
        `<div class="t"><span>${o.name}</span><span class="c">${o.short}</span></div>` +
        `<div class="b">${o.blurb}</div>`;
      card.onclick = () => { this.cb.onRewriteOrder(o.id); this.closeSheet(); };
      grid.appendChild(card);
    }
    sheet.appendChild(grid);
    this.root.appendChild(sheet);
    this.sheet = sheet;
  }

  // -------------------------------------------------------------- updates ---
  update(state: GameState, me: PlayerId, atBase: boolean): void {
    const p = state.players[me];
    const m = state.mechs[me];

    this.moneyEl.textContent = String(Math.floor(p.money));
    this.incomeEl.textContent = `+${incomeFor(state, me)} /s  ·  ${
      state.bases.filter((b) => b.owner === me).length}/${state.bases.length} bases`;

    const secs = Math.floor(state.tick / C.TICK_HZ);
    this.clockEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

    for (const q of [0, 1] as PlayerId[]) {
      const hq = state.bases.find((b) => b.isHQ && b.owner === q);
      const f = hq ? hq.hp / hq.maxHp : 0;
      this.hqFill[q].style.width = `${Math.max(0, f) * 100}%`;
      this.hqFill[q].style.background = f > 0.4 ? teamOf(q).main : PAL.hpBad;
    }

    this.statusFill.hp.style.width = `${(m.hp / C.MECH_HP) * 100}%`;
    this.statusFill.fuel.style.width = `${(m.fuel / C.MECH_FUEL) * 100}%`;
    this.statusFill.ammo.style.width = `${(m.ammo / C.MECH_AMMO) * 100}%`;
    this.statusFill.fuel.style.background = m.fuel < C.MECH_FUEL * 0.2 ? PAL.hpBad : PAL.fuel;

    this.modeBtn.innerHTML = m.mode === 'JET'
      ? 'WALK<span class="sub">morph</span>'
      : 'JET<span class="sub">morph</span>';
    this.buildBtn.classList.toggle('ready', atBase && p.money >= 60);

    // Carried-unit chip: shows the order you are about to deliver and lets you
    // change your mind in flight, which is the whole strategic hinge.
    if (m.carryingUnitId >= 0) {
      const u = state.units.find((x) => x.id === m.carryingUnitId);
      if (u) {
        const o = ORDERS.find((x) => x.id === u.order)!;
        if (this.carryEl.dataset.for !== `${u.id}:${u.order}`) {
          this.carryEl.dataset.for = `${u.id}:${u.order}`;
          this.carryEl.innerHTML =
            `<span class="name">${UNIT_TYPES[u.type].name}</span>` +
            `<span class="ord">${o.name}</span>`;
          const b = el('button', undefined, 'REORDER');
          b.onclick = (e) => { e.stopPropagation(); this.openRewrite(u.order); };
          this.carryEl.appendChild(b);
        }
        this.carryEl.style.display = 'flex';
      }
    } else {
      this.carryEl.style.display = 'none';
      this.carryEl.dataset.for = '';
    }

    this.drawMinimap(state, me);
  }

  private drawMinimap(state: GameState, me: PlayerId): void {
    const ctx = this.mctx;
    const W = this.minimap.width, H = this.minimap.height;
    const ww = worldWidth(state.map), wh = worldHeight(state.map);
    const sx = W / ww, sy = H / wh;

    ctx.fillStyle = '#060b14';
    ctx.fillRect(0, 0, W, H);

    // Water only — enough shape to orient by without redrawing the world.
    ctx.fillStyle = 'rgba(30,70,130,.55)';
    const t = state.map.tile;
    for (let y = 0; y < state.map.h; y++) {
      for (let x = 0; x < state.map.w; x++) {
        if (state.map.terrain[y * state.map.w + x] !== 2) continue;
        ctx.fillRect(x * t * sx, y * t * sy, t * sx + 1, t * sy + 1);
      }
    }

    for (const b of state.bases) {
      ctx.fillStyle = b.owner === -1 ? PAL.neutralDim : teamOf(b.owner).main;
      const r = b.isHQ ? 5 : 3.2;
      ctx.beginPath();
      ctx.arc(b.x * sx, b.y * sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const u of state.units) {
      if (u.carried) continue;
      ctx.fillStyle = teamOf(u.owner).main;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(u.x * sx - 1, u.y * sy - 1, 2.2, 2.2);
    }
    ctx.globalAlpha = 1;
    for (const m of state.mechs) {
      if (!m.alive) continue;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = teamOf(m.owner).main;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x * sx, m.y * sy, 3, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    void me;
  }

  // ------------------------------------------------------------- end card ---
  showEnd(state: GameState, me: PlayerId): void {
    if (this.endEl) return;
    this.closeSheet();
    const won = state.winner === me;
    const draw = state.winner === -1;
    const box = el('div', 'center');
    const p = state.players[me];
    const secs = Math.floor(state.tick / C.TICK_HZ);
    box.innerHTML =
      `<div class="tag">MATCH COMPLETE</div>` +
      `<h1 class="${won ? 'win' : 'lose'}">${draw ? 'STALEMATE' : won ? 'VICTORY' : 'DEFEAT'}</h1>` +
      `<div class="stats"><span>TIME ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</span>` +
      `<span>BUILT ${p.unitsBuilt}</span><span>KILLS ${p.kills}</span><span>LOST ${p.unitsLost}</span></div>`;
    const again = el('button', undefined, 'FIGHT AGAIN');
    again.onclick = () => { this.endEl?.remove(); this.endEl = null; this.cb.onRestart(); };
    box.appendChild(again);
    this.root.appendChild(box);
    this.endEl = box;
  }

  clearEnd(): void { this.endEl?.remove(); this.endEl = null; }
}
