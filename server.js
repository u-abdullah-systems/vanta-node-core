'use strict';

const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const { createDb } = require('./db');
const { createToken, verifyToken } = require('./auth');
const { createPark, ACTIVITIES, ACHIEVEMENTS, COLORS, HATS, PETS, EMOTES } = require('./park');

const db = createDb();
const PORT = Number(process.env.PORT) || 3000;

const sockets = new Map(); // playerId -> ws

function sendPacket(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function sendToPlayer(playerId, payload) {
  const ws = sockets.get(playerId);
  if (ws) sendPacket(ws, payload);
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toJSON(obj) {
  try { return JSON.stringify(obj); } catch { return '{}'; }
}

function fromJSON(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseFinite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const app = express();
app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const rawUsername = (req.body.username ?? '').toString().trim();
    const rawMmr = req.body.mmr;

    if (rawUsername.length < 2 || rawUsername.length > 32) {
      return res.status(400).json({ ok: false, error: 'Username must be 2–32 characters.' });
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(rawUsername)) {
      return res.status(400).json({ ok: false, error: 'Username contains invalid characters.' });
    }

    const mmr = Number.isFinite(Number(rawMmr)) ? Number(rawMmr) : 1000;
    const player = await db.findOrCreate(rawUsername, mmr);
    db.setStatusAtomic(player.id, player.status, 'lobby');
    const token = createToken(player);

    return res.status(200).json({
      ok: true,
      token,
      player: db.publicPlayer(player),
    });
  } catch (err) {
    console.error('[AUTH]  Login handler error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error.' });
  }
});

app.get('/api/players/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const raw = await db.leaderboard(limit);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.write('[');
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      res.write(toJSON({
        rank: i + 1,
        id: p.id,
        username: p.username,
        level: p.level,
        xp: p.xp,
        coins: p.coins,
        status: p.status,
      }));
      if (i < raw.length - 1) res.write(',');
      await _delay(2);
    }
    res.write(']');
    res.end();
  } catch (err) {
    console.error('[LEADERBOARD]  Error:', err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'Internal server error.' });
  }
});

app.get('/api/park/leaderboard', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const rows = (await db.leaderboard(limit)).map((p, i) => ({
    rank: i + 1,
    username: p.username,
    level: p.level,
    xp: p.xp,
    coins: p.coins,
    achievements: p.achievements.length,
  }));
  res.json({ ok: true, rows });
});

app.get('/api/park', (_req, res) => {
  res.json({ ok: true, ...park.stats() });
});

app.get('/api/park/cosmetics', (_req, res) => {
  res.json({ ok: true, colors: COLORS, hats: HATS, pets: PETS });
});

app.get('/api/profile/:username', (req, res) => {
  const p = db.getByUsername(String(req.params.username));
  if (!p) return res.status(404).json({ ok: false, error: 'Player not found.' });
  res.json({ ok: true, player: db.publicPlayer(p), stats: p.stats });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    players: db.playerCount(),
    parkOnline: park.stats().online,
    activeSockets: wss ? wss.clients.size : 0,
    chatMessages: db.getChatLogs(500).length,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

app.get('/api/chat/logs', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  res.json({ ok: true, logs: db.getChatLogs(limit) });
});

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  verifyClient: (info, cb) => {
    let url;
    try {
      url = new URL(info.req.url, 'http://localhost');
    } catch {
      cb(false, 400, 'Bad request');
      return;
    }
    const token = url.searchParams.get('token');
    if (!token) {
      cb(false, 401, 'Unauthorized: token required');
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      cb(false, 401, 'Unauthorized: invalid or expired token');
      return;
    }
    const player = db.resolveSession(payload.sub);
    if (!player) {
      cb(false, 401, 'Unauthorized: player not found');
      return;
    }
    info.req._player = player;
    info.req._token = token;
    cb(true);
  },
});

const park = createPark(db, sendToPlayer);

const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_MISSED_PINGS = 2;

const heartbeatTimer = setInterval(async () => {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;

    if (!ws._isAlive) {
      ws._missedPings = (ws._missedPings ?? 0) + 1;
      if (ws._missedPings >= MAX_MISSED_PINGS) {
        await _handleDisconnect(ws);
        ws.terminate();
        continue;
      }
    }

    ws._isAlive = false;
    ws._missedPings = ws._missedPings ?? 0;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

heartbeatTimer.unref();

wss.on('connection', (ws, req) => {
  const player = req._player;

  ws._playerId = player.id;
  ws._username = player.username;
  ws._isAlive = true;
  ws._missedPings = 0;
  ws._msgTimes = [];
  ws._joinedPark = false;

  // One live socket per player; the newest connection wins.
  const previous = sockets.get(player.id);
  if (previous && previous !== ws) {
    if (park.has(player.id)) park.leave(player.id);
    try { previous.close(4001, 'Connected from another tab'); } catch { /* ignore */ }
  }
  sockets.set(player.id, ws);
  db.touch(player.id);

  if (player.status === 'park') db.setStatusAtomic(player.id, 'park', 'lobby');
  else if (player.status === 'offline') db.setStatusAtomic(player.id, 'offline', 'lobby');

  sendPacket(ws, {
    event: 'LOBBY_JOINED',
    message: `Link established. Welcome, ${player.username}.`,
    player: db.publicPlayer(player),
    profile: {
      coins: player.coins,
      xp: player.xp,
      level: player.level,
      achievements: player.achievements,
      cosmetics: player.cosmetics,
    },
    shop: { colors: COLORS, hats: HATS, pets: PETS },
    activities: ACTIVITIES,
    achievements: ACHIEVEMENTS,
    emotes: EMOTES,
  });

  ws.on('pong', () => {
    ws._isAlive = true;
    ws._missedPings = 0;
  });

  ws.on('message', async (rawData) => {
    // ── flood protection ────────────────────────────────────────────────
    const now = Date.now();
    ws._msgTimes = ws._msgTimes.filter(t => now - t < 1000);
    ws._msgTimes.push(now);
    if (ws._msgTimes.length > 45) {
      sendPacket(ws, { event: 'ERROR', message: 'Slow down — too many packets.' });
      return;
    }

    const packet = fromJSON(rawData.toString());
    if (!packet || typeof packet.action !== 'string') {
      sendPacket(ws, { event: 'ERROR', message: 'Malformed packet.' });
      return;
    }
    if (packet.action.length > 40) {
      sendPacket(ws, { event: 'ERROR', message: 'Unknown action.' });
      return;
    }

    const { action } = packet;
    const playerId = ws._playerId;
    const player = db.getById(playerId);
    if (!player) {
      sendPacket(ws, { event: 'AUTH_FAIL', message: 'Session no longer valid.' });
      return;
    }

    switch (action) {

      // ── Park ──────────────────────────────────────────────────────────
      case 'JOIN_PARK': {
        if (park.has(playerId)) {
          sendPacket(ws, { event: 'NOTICE', message: 'Session already linked to sector N-01.' });
          return;
        }
        park.join(playerId, player);
        ws._joinedPark = true;
        break;
      }

      case 'LEAVE_PARK': {
        if (!park.has(playerId)) {
          sendPacket(ws, { event: 'NOTICE', message: 'Session is not linked to sector N-01.' });
          return;
        }
        park.leave(playerId);
        ws._joinedPark = false;
        break;
      }

      case 'PARK_MOVE': {
        if (!park.has(playerId)) return;
        park.setInput(playerId, parseFinite(packet.dx), parseFinite(packet.dy), Boolean(packet.sprint));
        break;
      }

      case 'PARK_DASH': {
        if (!park.has(playerId)) return;
        park.dash(playerId);
        break;
      }

      case 'PARK_HOP': {
        if (!park.has(playerId)) return;
        park.hop(playerId);
        break;
      }

      case 'PARK_EMOTE': {
        if (!park.has(playerId)) return;
        if (typeof packet.emote !== 'string' || !EMOTES[packet.emote]) {
          sendPacket(ws, { event: 'ERROR', message: 'Unknown emote.' });
          return;
        }
        park.emote(playerId, packet.emote);
        break;
      }

      case 'PARK_INTERACT': {
        if (!park.has(playerId)) return;
        park.interact(playerId);
        break;
      }

      case 'PARK_ACTIVITY_MENU': {
        if (!park.has(playerId)) return;
        park.activityMenu(playerId);
        break;
      }

      case 'PARK_ACTIVITY': {
        if (!park.has(playerId)) return;
        if (typeof packet.activity !== 'string' || !ACTIVITIES[packet.activity]) {
          sendPacket(ws, { event: 'ERROR', message: 'Unknown activity.' });
          return;
        }
        park.startActivityFor(playerId, packet.activity);
        break;
      }

      case 'PARK_COSMETIC': {
        if (!park.has(playerId)) return;
        const kind = String(packet.kind || '');
        if (!['color', 'hat', 'pet'].includes(kind)) {
          sendPacket(ws, { event: 'ERROR', message: 'Unknown cosmetic slot.' });
          return;
        }
        park.setCosmetic(playerId, kind, String(packet.value ?? ''));
        break;
      }

      case 'PARK_PING': {
        sendPacket(ws, { event: 'PARK_PONG', t: packet.t, serverTime: Date.now() });
        break;
      }

      // ── Lobby chat (also appears as a park bubble) ─────────────────────
      case 'SEND_MESSAGE': {
        const rawMessage = (packet.message ?? '').toString().trim();

        if (rawMessage.length === 0) {
          sendPacket(ws, { event: 'ERROR', message: 'Message cannot be empty.' });
          return;
        }
        if (rawMessage.length > 300) {
          sendPacket(ws, { event: 'ERROR', message: 'Message exceeds 300-character limit.' });
          return;
        }
        if (player.status === 'restricted' || player.status === 'banned') {
          sendPacket(ws, {
            event: 'SYSTEM_WARNING',
            message: 'You are restricted from sending chat messages due to prior violations.',
          });
          return;
        }

        const analysis = await _analyzeMessage(rawMessage);

        const logEntry = {
          id: uuidv4(),
          playerId: player.id,
          username: player.username,
          message: rawMessage,
          violationScore: analysis.violationScore,
          flagged: analysis.flagged,
          triggeredTerms: analysis.triggeredTerms,
          timestamp: Date.now(),
        };
        db.appendChatLog(logEntry);

        if (analysis.flagged) {
          const p = db.recordViolation(player.id, analysis.violationScore);
          const newStatus = p.violationCount >= 3 ? 'banned' : 'restricted';

          db.setStatusAtomic(player.id, player.status, newStatus);

          sendPacket(ws, {
            event: 'SYSTEM_WARNING',
            message: 'Chat violation detected. Your chat access is restricted.',
            violationScore: analysis.violationScore,
            triggeredTerms: analysis.triggeredTerms,
            categories: analysis.categories,
            newStatus,
            processingMs: analysis.processingMs,
          });

          _broadcastAll({
            event: 'MODERATION_ACTION',
            message: `[SYSTEM] Operator "${player.username}" has been ${newStatus} for chat violations.`,
            username: player.username,
            newStatus,
          }, ws);

          return;
        }

        if (park.has(player.id)) park.say(player.id, rawMessage);

        const chatPayload = {
          event: 'LOBBY_CHAT',
          messageId: logEntry.id,
          username: player.username,
          message: rawMessage,
          timestamp: logEntry.timestamp,
          processingMs: analysis.processingMs,
        };

        sendPacket(ws, chatPayload);
        _broadcastAll(chatPayload, ws);
        break;
      }

      // ── Lobby presence ────────────────────────────────────────────────
      case 'PARK_LIST': {
        sendPacket(ws, { event: 'PARK_LIST', ...park.stats() });
        break;
      }

      default: {
        sendPacket(ws, { event: 'ERROR', message: `Unknown action: "${action}".` });
      }
    }
  });

  ws.on('close', async () => {
    await _handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error(`[WS]  ERROR   player="${ws._username ?? 'unknown'}"  ${err.message}`);
  });
});

async function _handleDisconnect(ws) {
  const playerId = ws._playerId;
  if (!playerId) return;

  // Stale socket: a newer connection already owns this player.
  if (sockets.get(playerId) !== ws) return;

  sockets.delete(playerId);
  if (park.has(playerId)) park.leave(playerId);

  const player = db.getById(playerId);
  if (!player) return;

  if (player.status === 'park' || player.status === 'lobby') {
    db.setStatusAtomic(playerId, player.status, 'offline');
  } else {
    db.touch(playerId);
  }
}

function _broadcastAll(payload, excludeWs = null) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      client.send(data);
    }
  }
}

// ── Simulated moderation pipeline ────────────────────────────────────────────

const TOXIC_REGISTRY = [
  { pattern: /\bcheat(s|ing|er|ers)?\b/i, score: 100, category: 'CHEAT_ACCUSATION' },
  { pattern: /\bhack(s|ing|er|ers)?\b/i, score: 100, category: 'HACK_ACCUSATION' },
  { pattern: /\baimbot(s)?\b/i, score: 100, category: 'CHEAT_TOOL' },
  { pattern: /\bexploit(s|ing|ed)?\b/i, score: 100, category: 'EXPLOIT_ABUSE' },
  { pattern: /\bwallhack(s)?\b/i, score: 100, category: 'CHEAT_TOOL' },
  { pattern: /\bspeedhack(s)?\b/i, score: 100, category: 'CHEAT_TOOL' },
  { pattern: /\btriggerbot(s)?\b/i, score: 100, category: 'CHEAT_TOOL' },
  { pattern: /\bduplication glitch\b/i, score: 100, category: 'EXPLOIT_ABUSE' },
  { pattern: /\bddos(ing)?\b/i, score: 100, category: 'ATTACK_THREAT' },
  { pattern: /\bip.?grab(ber)?\b/i, score: 100, category: 'ATTACK_THREAT' },
  { pattern: /\btoxic\b/i, score: 80, category: 'TOXIC_BEHAVIOUR' },
  { pattern: /\bragehack\b/i, score: 80, category: 'TOXIC_BEHAVIOUR' },
  { pattern: /\bintentional.?feed(ing)?\b/i, score: 80, category: 'GRIEFING' },
  { pattern: /\bgrief(ing|er|ers)?\b/i, score: 80, category: 'GRIEFING' },
  { pattern: /\btroll(ing|er|ers)?\b/i, score: 60, category: 'DISRUPTIVE' },
  { pattern: /\bscript.?kiddi(e|es)?\b/i, score: 60, category: 'CHEAT_REFERENCE' },
  { pattern: /\bmod.?menu\b/i, score: 60, category: 'CHEAT_REFERENCE' },
  { pattern: /\bno.?recoil\b/i, score: 60, category: 'CHEAT_REFERENCE' },
  { pattern: /\bauto.?aim\b/i, score: 60, category: 'CHEAT_REFERENCE' },
  { pattern: /\bstompk(ing)?\b/i, score: 40, category: 'POOR_SPORTSMANSHIP' },
  { pattern: /\bnoob.?stomp(ing)?\b/i, score: 40, category: 'POOR_SPORTSMANSHIP' },
];

const VIOLATION_THRESHOLD = 40;

async function _analyzeMessage(message) {
  const pipelineStart = Date.now();

  const normalised = message
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  await _delay(10 + Math.random() * 15);

  let maxScore = 0;
  const matchedTerms = [];
  const categories = [];

  for (const entry of TOXIC_REGISTRY) {
    const match = normalised.match(entry.pattern);
    if (match) {
      matchedTerms.push(match[0]);
      if (!categories.includes(entry.category)) categories.push(entry.category);
      if (entry.score > maxScore) maxScore = entry.score;
    }
  }

  await _delay(8 + Math.random() * 12);

  let finalScore = maxScore;
  if (categories.length > 1 && finalScore < 100) {
    finalScore = Math.min(100, finalScore + categories.length * 5);
  }

  await _delay(12 + Math.random() * 20);

  const flagged = finalScore >= VIOLATION_THRESHOLD;
  const processingMs = Date.now() - pipelineStart;

  return { flagged, violationScore: finalScore, triggeredTerms: matchedTerms, categories, processingMs };
}

// ── Boot ─────────────────────────────────────────────────────────────────────

db.seed();
db.startCleanupLoop();

server.listen(PORT, () => {
  console.log(`\n  VANTA NODE  — http://localhost:${PORT}`);
  console.log(`  HEALTH      — http://localhost:${PORT}/api/health`);
  console.log(`  SNAPSHOT    — http://localhost:${PORT}/api/park`);
  console.log(`  WEBSOCKET   — ws://localhost:${PORT}?token=<jwt>\n`);
});

async function shutdown(signal) {
  console.log(`\n[SERVER]  ${signal} received — shutting down gracefully…`);
  clearInterval(heartbeatTimer);
  park.stop();
  db.stopCleanupLoop();
  for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
  wss.close(() => {
    server.close(() => {
      console.log('[SERVER]  HTTP server closed. Goodbye.');
      process.exit(0);
    });
  });
  setTimeout(() => { console.error('[SERVER]  Forced exit after timeout.'); process.exit(1); }, 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', err => console.error('[UNCAUGHT]', err));
process.on('unhandledRejection', (r) => console.error('[UNHANDLED]', r));
