import type { PlayerId } from '../sim/types';
import {
  CHECKSUM_PERIOD, INPUT_DELAY, NEUTRAL_INPUT, REDUNDANCY,
  type PeerMsg, type SignalMsg, type TickInput,
} from './protocol';

export type NetPhase =
  | 'idle' | 'signalling' | 'waiting' | 'connecting' | 'ready' | 'closed' | 'error';

/** Public STUN only. Same-room play connects on host candidates without it;
 *  it is here so two phones on different networks can still hole-punch. A TURN
 *  relay for the ~10-15% that cannot is a deployment concern, not a code one. */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

function signalUrl(): string {
  const override = new URLSearchParams(location.search).get('signal');
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.hostname}:8787`;
}

/**
 * Deterministic-lockstep session over a WebRTC data channel.
 *
 * Peers exchange *inputs*, never entity state, so a 50-unit battle costs the
 * same bandwidth as an empty map. The channel is deliberately unreliable and
 * unordered — for lockstep, a retransmitted packet that arrives late is worse
 * than one that never arrives, because the missing tick has already been
 * covered by the redundancy window in the next packet.
 */
export class NetSession {
  phase: NetPhase = 'idle';
  code = '';
  slot: PlayerId = 0;
  seed = 0;
  desyncTick: number | null = null;
  lastError = '';

  onPhase: ((p: NetPhase, detail: string) => void) | null = null;
  onReady: ((seed: number, slot: PlayerId) => void) | null = null;

  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private isHost = false;
  private remoteDescSet = false;
  private pendingIce: RTCIceCandidateInit[] = [];

  private local = new Map<number, TickInput>();
  private remote = new Map<number, TickInput>();
  private myHashes = new Map<number, number>();
  private highestLocal = -1;
  /** Highest tick we have heard about from the peer — drives the stall UI. */
  highestRemote = -1;

  host(): void { this.isHost = true; this.connectSignal({ k: 'host' }); }
  join(code: string): void {
    this.isHost = false;
    this.code = code.toUpperCase();
    this.connectSignal({ k: 'join', code: this.code });
  }

  private setPhase(p: NetPhase, detail = ''): void {
    this.phase = p;
    this.onPhase?.(p, detail);
  }

  // ------------------------------------------------------------ signalling ---
  private connectSignal(first: SignalMsg): void {
    this.setPhase('signalling', 'contacting lobby');
    let ws: WebSocket;
    try { ws = new WebSocket(signalUrl()); }
    catch { this.fail('cannot reach the lobby server'); return; }
    this.ws = ws;

    ws.onopen = () => ws.send(JSON.stringify(first));
    ws.onerror = () => this.fail('cannot reach the lobby server');
    ws.onclose = () => { if (this.phase !== 'ready' && this.phase !== 'closed') this.fail('lobby connection lost'); };
    ws.onmessage = (ev) => {
      let msg: SignalMsg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      void this.onSignal(msg);
    };
  }

  private async onSignal(msg: SignalMsg): Promise<void> {
    switch (msg.k) {
      case 'hosted':
        this.code = msg.code;
        this.setPhase('waiting', msg.code);
        break;
      case 'ready':
        this.seed = msg.seed;
        this.slot = msg.slot;
        this.setPhase('connecting', 'opening channel');
        await this.startPeer();
        break;
      case 'sdp':
        await this.onRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
        break;
      case 'ice':
        await this.onRemoteIce(msg.ice as RTCIceCandidateInit);
        break;
      case 'peerleft':
        if (this.phase === 'ready') this.setPhase('closed', 'opponent left');
        else this.fail('opponent left');
        break;
      case 'err':
        this.fail(msg.msg);
        break;
    }
  }

  private send(msg: SignalMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // ------------------------------------------------------------------ peer ---
  private async startPeer(): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.onicecandidate = (e) => { if (e.candidate) this.send({ k: 'ice', ice: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fail('could not connect to the other player');
    };

    if (this.isHost) {
      // Unreliable + unordered: stale ticks are useless, so never wait for them.
      const dc = pc.createDataChannel('lockstep', {
        ordered: false, maxRetransmits: 0,
      });
      this.bindChannel(dc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send({ k: 'sdp', sdp: offer });
    } else {
      pc.ondatachannel = (e) => this.bindChannel(e.channel);
    }
  }

  private bindChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => {
      // Prime the first few ticks so neither peer stalls on tick zero waiting
      // for inputs that, by construction, nobody could have produced yet.
      for (let t = 0; t < INPUT_DELAY; t++) this.submitLocal(NEUTRAL_INPUT(t));
      this.setPhase('ready', 'connected');
      this.onReady?.(this.seed, this.slot);
    };
    dc.onclose = () => { if (this.phase === 'ready') this.setPhase('closed', 'opponent disconnected'); };
    dc.onmessage = (ev) => this.onPeerMsg(String(ev.data));
  }

  private async onRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    await pc.setRemoteDescription(desc);
    this.remoteDescSet = true;
    for (const c of this.pendingIce) await pc.addIceCandidate(c).catch(() => {});
    this.pendingIce = [];
    if (desc.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ k: 'sdp', sdp: answer });
    }
  }

  private async onRemoteIce(ice: RTCIceCandidateInit): Promise<void> {
    // Candidates routinely beat the description they belong to.
    if (!this.pc || !this.remoteDescSet) { this.pendingIce.push(ice); return; }
    await this.pc.addIceCandidate(ice).catch(() => {});
  }

  private onPeerMsg(raw: string): void {
    let msg: PeerMsg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.k === 'in') {
      for (const f of msg.f) {
        if (!this.remote.has(f.t)) this.remote.set(f.t, f);
        if (f.t > this.highestRemote) this.highestRemote = f.t;
      }
    } else if (msg.k === 'sum') {
      const mine = this.myHashes.get(msg.t);
      if (mine !== undefined && mine !== msg.h && this.desyncTick === null) {
        this.desyncTick = msg.t;
      }
    } else if (msg.k === 'bye') {
      this.setPhase('closed', 'opponent left');
    }
  }

  // ----------------------------------------------------------- lockstep io ---
  /** Record and broadcast this peer's intent for one future tick. */
  submitLocal(input: TickInput): void {
    if (this.local.has(input.t)) return;
    this.local.set(input.t, input);
    if (input.t > this.highestLocal) this.highestLocal = input.t;

    // Resend a sliding window rather than retransmitting individually.
    const frames: TickInput[] = [];
    for (let t = Math.max(0, input.t - REDUNDANCY + 1); t <= input.t; t++) {
      const f = this.local.get(t);
      if (f) frames.push(f);
    }
    this.sendPeer({ k: 'in', f: frames });
  }

  hasLocal(tick: number): boolean { return this.local.has(tick); }

  /**
   * Rebroadcast the most recent window without producing a new input.
   *
   * Without this, a simultaneous loss on both sides deadlocks: each peer stalls
   * waiting for a tick the other already produced, and because neither advances,
   * neither ever sends another packet to carry the missing frame. A heartbeat
   * while stalled breaks the tie.
   */
  resend(): void {
    if (this.highestLocal < 0) return;
    const frames: TickInput[] = [];
    for (let t = Math.max(0, this.highestLocal - REDUNDANCY + 1); t <= this.highestLocal; t++) {
      const f = this.local.get(t);
      if (f) frames.push(f);
    }
    if (frames.length) this.sendPeer({ k: 'in', f: frames });
  }

  /** Both players' inputs for a tick, or null if the peer's has not arrived —
   *  in which case the simulation must not advance. */
  inputsFor(tick: number): [TickInput, TickInput] | null {
    const mine = this.local.get(tick);
    const theirs = this.remote.get(tick);
    if (!mine || !theirs) return null;
    return this.slot === 0 ? [mine, theirs] : [theirs, mine];
  }

  /** Publish a state hash so the peer can detect divergence early. */
  offerChecksum(tick: number, hash: number): void {
    if (tick % CHECKSUM_PERIOD !== 0) return;
    this.myHashes.set(tick, hash);
    this.sendPeer({ k: 'sum', t: tick, h: hash });
    // Only the recent window is ever compared; do not grow forever.
    for (const t of this.myHashes.keys()) {
      if (t < tick - CHECKSUM_PERIOD * 8) this.myHashes.delete(t);
    }
  }

  /** Drop inputs the simulation can never need again. */
  prune(executedTick: number): void {
    const keep = executedTick - REDUNDANCY * 2;
    if (keep < 0) return;
    for (const t of this.local.keys()) if (t < keep) this.local.delete(t);
    for (const t of this.remote.keys()) if (t < keep) this.remote.delete(t);
  }

  private sendPeer(msg: PeerMsg): void {
    if (this.dc?.readyState === 'open') {
      try { this.dc.send(JSON.stringify(msg)); } catch { /* channel closing */ }
    }
  }

  private fail(msg: string): void {
    this.lastError = msg;
    this.setPhase('error', msg);
    this.close();
  }

  close(): void {
    this.sendPeer({ k: 'bye' });
    try { this.dc?.close(); } catch { /* already gone */ }
    try { this.pc?.close(); } catch { /* already gone */ }
    try { this.ws?.close(); } catch { /* already gone */ }
    this.dc = null; this.pc = null; this.ws = null;
  }
}
