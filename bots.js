// VANTA NODE test operators.
//
// Logs in a few headless operators, deploys them into sector N-01 and lets
// them wander, emote and interact. Useful for testing co-op operations.
//
//   npm start          # in one terminal
//   npm run bots       # in another
//
// Override the server with SERVER_URL=http://localhost:3000.

const WebSocket = require('ws');

const BASE = (process.env.SERVER_URL || 'http://localhost:3000').replace(/\/+$/, '');
const NAMES = ['VECTOR-02', 'CIPHER-04', 'RELAY-07', 'AXIOM-09'];
const EMOTES = ['wave', 'laugh', 'dance', 'heart', 'sparkle'];
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
];

const sessions = new Map();
let shuttingDown = false;

function wsUrl(token) {
  return `${BASE.replace(/^http/, 'ws')}/?token=${encodeURIComponent(token)}`;
}

async function login(username) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, mmr: 1000 }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Login failed for ${username}`);
  return data;
}

function send(session, packet) {
  const ws = session.ws;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(packet));
}

function move(session, dx, dy, sprint = false) {
  send(session, { action: 'PARK_MOVE', dx, dy, sprint });
}

function startLoops(session) {
  if (session.wanderTimer) return;

  session.wanderTimer = setInterval(() => {
    if (!session.inPark) return;
    session.dir = DIRS[Math.floor(Math.random() * DIRS.length)];
    move(session, session.dir[0], session.dir[1], Math.random() < 0.15);
  }, 1400);

  session.emoteTimer = setInterval(() => {
    if (!session.inPark) return;
    send(session, { action: 'PARK_EMOTE', emote: EMOTES[Math.floor(Math.random() * EMOTES.length)] });
  }, 7000 + Math.random() * 5000);

  session.interactTimer = setInterval(() => {
    if (!session.inPark) return;
    send(session, { action: 'PARK_INTERACT' });
  }, 9000 + Math.random() * 6000);

  session.hopTimer = setInterval(() => {
    if (!session.inPark) return;
    send(session, { action: 'PARK_HOP' });
    if (Math.random() < 0.4) send(session, { action: 'PARK_DASH' });
  }, 5000 + Math.random() * 5000);
}

function stopLoops(session) {
  for (const key of ['wanderTimer', 'emoteTimer', 'interactTimer', 'hopTimer']) {
    if (session[key]) clearInterval(session[key]);
    session[key] = null;
  }
}

function connect(session) {
  if (shuttingDown) return;
  const ws = new WebSocket(wsUrl(session.token));
  session.ws = ws;

  ws.on('open', () => {
    session.retries = 0;
    send(session, { action: 'JOIN_PARK' });
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.event === 'PARK_JOINED') {
      session.inPark = true;
      console.log(`[${session.username}] linked into sector N-01`);
      startLoops(session);
    } else if (msg.event === 'PARK_LEFT' || msg.event === 'AUTH_FAIL') {
      session.inPark = false;
      stopLoops(session);
    } else if (msg.event === 'PARK_CHALLENGE' && msg.phase === 'countdown') {
      console.log(`[${session.username}] ${msg.title} starting`);
    } else if (msg.event === 'PARK_EVENT' && msg.kind === 'level') {
      console.log(`[${session.username}] ${msg.message}`);
    }
  });

  ws.on('close', () => {
    session.inPark = false;
    stopLoops(session);
    if (shuttingDown) return;
    session.retries = (session.retries || 0) + 1;
    if (session.retries > 8) {
      console.log(`[${session.username}] giving up after ${session.retries} retries`);
      return;
    }
    const delay = Math.min(8000, 600 * session.retries);
    setTimeout(() => connect(session), delay);
  });

  ws.on('error', () => { /* close handler retries */ });
}

async function startBot(username) {
  try {
    const data = await login(username);
    const session = {
      username,
      token: data.token,
      ws: null,
      inPark: false,
      retries: 0,
    };
    sessions.set(username, session);
    connect(session);
    console.log(`[${username}] logged in`);
  } catch (err) {
    console.error(`[${username}] ${err.message}`);
  }
}

async function main() {
  console.log(`Connecting bots to ${BASE} …`);
  for (const name of NAMES) {
    await startBot(name);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  console.log('Bots are wandering. Press Ctrl+C to stop.');
}

function shutdown() {
  shuttingDown = true;
  console.log('\nStopping bots…');
  for (const session of sessions.values()) {
    stopLoops(session);
    if (session.ws) {
      try {
        if (session.inPark) session.ws.send(JSON.stringify({ action: 'LEAVE_PARK' }));
        session.ws.close();
      } catch { /* ignore */ }
    }
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main();
