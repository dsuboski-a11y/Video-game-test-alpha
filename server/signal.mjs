/**
 * Room-code lobby for EISENKRIEG.
 *
 * It introduces two players and relays their WebRTC handshake, then gets out of
 * the way -- once the data channel is open the match runs peer to peer and this
 * process sees none of it. That is why a single small instance can carry a lot
 * of concurrent games: it is a switchboard, not a game server.
 *
 *   node server/signal.mjs            # port 8787
 *   PORT=9000 node server/signal.mjs
 */
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
// No O/0/I/1: these codes get read aloud across a room.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, {host: any, guest: any, created: number}>} */
const rooms = new Map();

function makeCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

function partnerOf(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return null;
  return ws.isHost ? room.guest : room.host;
}

function closeRoom(code, except) {
  const room = rooms.get(code);
  if (!room) return;
  for (const peer of [room.host, room.guest]) {
    if (peer && peer !== except) send(peer, { k: 'peerleft' });
  }
  rooms.delete(code);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.isHost = false;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }

    switch (msg.k) {
      case 'host': {
        if (ws.roomCode) return;
        const code = makeCode();
        if (!code) { send(ws, { k: 'err', msg: 'lobby is full, try again' }); return; }
        rooms.set(code, { host: ws, guest: null, created: Date.now() });
        ws.roomCode = code;
        ws.isHost = true;
        send(ws, { k: 'hosted', code });
        break;
      }

      case 'join': {
        if (ws.roomCode) return;
        const code = String(msg.code ?? '').toUpperCase();
        const room = rooms.get(code);
        if (!room) { send(ws, { k: 'err', msg: `no game with code ${code}` }); return; }
        if (room.guest) { send(ws, { k: 'err', msg: 'that game is already full' }); return; }
        room.guest = ws;
        ws.roomCode = code;
        ws.isHost = false;

        // The server picks the seed so both peers generate the same map from
        // the same integer -- the only piece of shared world state there is.
        const seed = (Math.random() * 0xffffffff) >>> 0;
        send(room.host, { k: 'ready', seed, slot: 0 });
        send(room.guest, { k: 'ready', seed, slot: 1 });
        break;
      }

      case 'sdp':
      case 'ice': {
        const peer = partnerOf(ws);
        if (peer) send(peer, msg);
        break;
      }
    }
  });

  ws.on('close', () => { if (ws.roomCode) closeRoom(ws.roomCode, ws); });
  ws.on('error', () => { if (ws.roomCode) closeRoom(ws.roomCode, ws); });
});

// Abandoned rooms would otherwise hold their codes forever.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.guest && now - room.created > ROOM_TTL_MS) closeRoom(code);
  }
}, 60_000).unref?.();

console.log(`EISENKRIEG lobby listening on :${PORT}`);
