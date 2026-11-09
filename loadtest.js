'use strict';

// VANTA NODE load test.
//
// Spins up N headless operators against a running server: each one authenticates
// over REST, opens the WebSocket, joins sector N-01, then streams movement intent
// at a fixed rate while measuring snapshot throughput and round-trip latency.
//
//   npm start          # terminal 1
//   npm run loadtest   # terminal 2 (25 clients, 15 s steady state)
//
// Options (both `--key value` and `--key=value` work):
//   --clients 25        concurrent operators
//   --duration 15       measurement window in seconds
//   --ramp 5000         stagger the connections over this many ms
//   --rate 10           movement packets per second per operator
//   --url http://localhost:3000
//   --prefix LOAD       username prefix (must be 2-32 chars, [A-Za-z0-9_-])
//   --max-errors 0      allowed server errors before the verdict fails
//   --json              print only the machine-readable summary
//
// Requires Node 18+ (built-in fetch) and the `ws` dependency from the project.

const WebSocket = require('ws');

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [rawKey, rawValue] = arg.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (rawValue !== undefined) {
      out[key] = rawValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      out[key] = argv[++i];
    } else {
      out[key] = true;
    }
  }
  return out;
}

function toInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const args = parseArgs(process.argv.slice(2));
const BASE = String(args.url || process.env.SERVER_URL || 'http://localhost:3000').replace(/\/+$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const CLIENTS = toInt(args.clients, 25, 1, 500);
const DURATION_MS = toInt(args.duration, 15, 3, 600) * 1000;
const RAMP_MS = toInt(args.ramp, 5000, 0, 120000);
const INPUT_HZ = toInt(args.rate, 10, 1, 40);
const PREFIX = String(args.prefix || 'LOAD').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'LOAD';
const MAX_ERRORS = toInt(args.maxErrors, 0, 0, 1e9);
const JSON_ONLY = Boolean(args.json);
const IS_TTY = process.stdout.isTTY && !JSON_ONLY;

// ── Shared collectors ────────────────────────────────────────────────────────

const stats = {
  connected: 0,
  failedLogins: 0,
  failedJoins: 0,
  stateMessages: 0,
  stateBytes: 0,
  eventMessages: 0,
  eventBytes: 0,
  pongs: [],
  joinLatencies: [],
  serverErrors: [],
  wsErrors: [],
  closeCodes: [],
  measuring: false,
  measureStart: 0,
  measureEnd: 0,
};

const sessions = new Set();
let progressTimer = null;
let finished = false;

function recordServerError(username, message) {
  if (stats.serverErrors.length < 25) stats.serverErrors.push({ username, message });
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function fmtMs(value) {
  return `${Math.round(value)} ms`;
}

function fmtBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function fetchHealth() {
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Simulated operator ───────────────────────────────────────────────────────

class LoadClient {
  constructor(index) {
    this.index = index;
    this.username = `${PREFIX}-${String(index + 1).padStart(3, '0')}`;
    this.ws = null;
    this.inputTimer = null;
    this.pingTimer = null;
    this.joined = false;
    this.closed = false;
    this.angle = Math.random() * Math.PI * 2;
    this.tick = 0;
    this.sprintUntil = 0;
    this.loginMs = 0;
    this.joinMs = 0;
    this.joinStartedAt = 0;
  }

  async start() {
    const loginStart = Date.now();
    let payload;
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.username, mmr: 1000 }),
      });
      payload = await res.json();
      if (!res.ok || !payload.ok) {
        throw new Error(payload && payload.error ? payload.error : `HTTP ${res.status}`);
      }
    } catch (err) {
      stats.failedLogins++;
      stats.wsErrors.push({ username: this.username, message: `login: ${err.message}` });
      return;
    }
    this.loginMs = Date.now() - loginStart;
    await this.connect(payload.token);
  }

  connect(token) {
    return new Promise((resolve) => {
      this.joinStartedAt = Date.now();
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        stats.failedJoins++;
        stats.wsErrors.push({ username: this.username, message: 'join timeout' });
        try { this.ws && this.ws.terminate(); } catch {}
        done();
      }, 15000);

      const ws = new WebSocket(`${WS_BASE}/?token=${encodeURIComponent(token)}`);
      this.ws = ws;
      sessions.add(this);

      ws.on('open', () => {
        ws.send(JSON.stringify({ action: 'JOIN_PARK' }));
      });

      ws.on('message', (raw) => {
        const bytes = Buffer.isBuffer(raw) ? raw.length : Buffer.byteLength(raw);
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!msg || typeof msg.event !== 'string') return;

        if (msg.event === 'PARK_JOINED') {
          if (this.joined) return;
          this.joined = true;
          this.joinMs = Date.now() - this.joinStartedAt;
          stats.connected++;
          stats.joinLatencies.push(this.joinMs);
          this.beginInput();
          done();
          return;
        }

        if (msg.event === 'PARK_STATE') {
          if (stats.measuring) {
            stats.stateMessages++;
            stats.stateBytes += bytes;
          }
          return;
        }

        if (msg.event === 'PARK_PONG') {
          const rtt = Date.now() - Number(msg.t);
          if (stats.measuring && rtt >= 0 && rtt < 60000) stats.pongs.push(rtt);
          return;
        }

        if (msg.event === 'ERROR') {
          recordServerError(this.username, msg.message || 'unknown error');
        }

        if (stats.measuring) {
          stats.eventMessages++;
          stats.eventBytes += bytes;
        }
      });

      ws.on('error', (err) => {
        if (stats.wsErrors.length < 25) {
          stats.wsErrors.push({ username: this.username, message: err.message });
        }
      });

      ws.on('close', (code) => {
        this.closed = true;
        this.stopTimers();
        if (code !== 1000 && code !== 1001) stats.closeCodes.push({ username: this.username, code });
        done();
      });
    });
  }

  beginInput() {
    const intervalMs = Math.max(25, Math.round(1000 / INPUT_HZ));
    this.inputTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.tick++;
      if (this.tick % 8 === 0) this.angle += (Math.random() - 0.5) * 1.8;
      if (this.tick % 55 === 0) this.sprintUntil = Date.now() + 1500;
      const sprint = Date.now() < this.sprintUntil;
      const speed = sprint ? 1 : 0.75;
      this.ws.send(JSON.stringify({
        action: 'PARK_MOVE',
        dx: Math.cos(this.angle) * speed,
        dy: Math.sin(this.angle) * speed,
        sprint,
      }));
    }, intervalMs);

    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ action: 'PARK_PING', t: Date.now() }));
    }, 1000);
  }

  stopTimers() {
    if (this.inputTimer) clearInterval(this.inputTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.inputTimer = null;
    this.pingTimer = null;
  }

  async stop() {
    this.stopTimers();
    if (!this.ws) return;
    const ws = this.ws;
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ action: 'LEAVE_PARK' })); } catch {}
    }
    try { ws.close(1000); } catch {}
    await new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      const timer = setTimeout(() => {
        try { ws.terminate(); } catch {}
        resolve();
      }, 500);
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

// ── Progress ─────────────────────────────────────────────────────────────────

function startProgress() {
  if (!IS_TTY || progressTimer) return;
  progressTimer = setInterval(() => {
    const elapsed = (Date.now() - stats.measureStart) / 1000;
    const hz = stats.stateMessages / Math.max(1, stats.connected) / Math.max(0.001, elapsed);
    const p95 = percentile(stats.pongs, 95);
    process.stdout.write(
      `\r  sampling… ${elapsed.toFixed(1)}s / ${(DURATION_MS / 1000).toFixed(0)}s` +
      `   state ${hz.toFixed(1)} Hz/client   rtt p95 ${Math.round(p95)} ms   ` +
      `errors ${stats.serverErrors.length + stats.wsErrors.length}   `
    );
  }, 1000);
  progressTimer.unref();
}

function stopProgress() {
  if (!progressTimer) return;
  clearInterval(progressTimer);
  progressTimer = null;
  if (IS_TTY) process.stdout.write('\r' + ' '.repeat(96) + '\r');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!JSON_ONLY) {
    console.log('');
    console.log('VANTA NODE // LOAD TEST');
    console.log(`  target     ${BASE}`);
    console.log(`  operators  ${CLIENTS}`);
    console.log(`  input      ${INPUT_HZ} Hz/client (${CLIENTS * INPUT_HZ} packets/s)`);
    console.log(`  ramp       ${RAMP_MS} ms`);
    console.log(`  duration   ${DURATION_MS / 1000} s steady state`);
    console.log('');
  }

  const healthBefore = await fetchHealth();
  if (!healthBefore) {
    console.error(`Cannot reach ${BASE}/api/health — is the server running? (npm start)`);
    process.exit(1);
  }

  const clients = Array.from({ length: CLIENTS }, (_, i) => new LoadClient(i));
  const rampStart = Date.now();

  // Ramp the connections so the server's accept path is exercised, not just its tick.
  for (let i = 0; i < clients.length; i++) {
    const targetAt = RAMP_MS === 0 ? 0 : (RAMP_MS * i) / Math.max(1, clients.length - 1);
    const wait = targetAt - (Date.now() - rampStart);
    if (wait > 0) await sleep(wait);
    clients[i].start();
  }

  // Wait for every handshake to settle, with a hard ceiling.
  const joinDeadline = Date.now() + 20000;
  while (stats.connected + stats.failedLogins + stats.failedJoins < CLIENTS && Date.now() < joinDeadline) {
    await sleep(100);
  }
  const rampMs = Date.now() - rampStart;

  if (!JSON_ONLY && stats.connected < CLIENTS) {
    console.log(`  joined     ${stats.connected}/${CLIENTS} after ${(rampMs / 1000).toFixed(1)} s`);
  } else if (!JSON_ONLY) {
    console.log(`  joined     ${stats.connected}/${CLIENTS} in ${(rampMs / 1000).toFixed(1)} s`);
  }

  // Settle, then measure the steady state.
  await sleep(1500);
  stats.measureStart = Date.now();
  stats.measuring = true;
  startProgress();

  await sleep(DURATION_MS);

  stats.measuring = false;
  stats.measureEnd = Date.now();
  stopProgress();
  const measuredMs = stats.measureEnd - stats.measureStart;
  const healthDuring = await fetchHealth();

  await Promise.allSettled(clients.map((c) => c.stop()));
  await sleep(300);
  const healthAfter = await fetchHealth();

  const joins = stats.connected;
  const stateHz = stats.stateMessages / Math.max(1, joins) / (measuredMs / 1000);
  const msgPerSec = stats.stateMessages / (measuredMs / 1000);
  const snapshotBytes = stats.stateMessages ? stats.stateBytes / stats.stateMessages : 0;
  const bandwidth = stats.stateBytes / (measuredMs / 1000);
  const perClientBandwidth = bandwidth / Math.max(1, joins);
  const rtt = {
    p50: percentile(stats.pongs, 50),
    p95: percentile(stats.pongs, 95),
    p99: percentile(stats.pongs, 99),
    max: stats.pongs.length ? Math.max(...stats.pongs) : 0,
  };
  const joinStats = {
    p50: percentile(stats.joinLatencies, 50),
    p95: percentile(stats.joinLatencies, 95),
  };
  const errorCount = stats.serverErrors.length + stats.wsErrors.length + stats.failedLogins + stats.failedJoins + stats.closeCodes.length;
  const heapDelta = healthBefore && healthAfter
    ? `${healthBefore.memoryMB} MB → ${healthAfter.memoryMB} MB`
    : 'n/a';

  const summary = {
    target: BASE,
    clients: CLIENTS,
    connected: stats.connected,
    failedLogins: stats.failedLogins,
    failedJoins: stats.failedJoins,
    inputHz: INPUT_HZ,
    durationSeconds: Number((measuredMs / 1000).toFixed(2)),
    rampMs,
    stateHzPerClient: Number(stateHz.toFixed(2)),
    stateMessagesPerSecond: Number(msgPerSec.toFixed(1)),
    snapshotBytes: Math.round(snapshotBytes),
    bandwidthKBps: Number((bandwidth / 1024).toFixed(1)),
    perClientKBps: Number((perClientBandwidth / 1024).toFixed(1)),
    rttMs: { ...rtt, samples: stats.pongs.length },
    joinMs: { ...joinStats, samples: stats.joinLatencies.length },
    events: stats.eventMessages,
    errors: errorCount,
    serverErrors: stats.serverErrors,
    wsErrors: stats.wsErrors,
    closeCodes: stats.closeCodes,
    healthBefore,
    healthDuring,
    healthAfter,
    verdict: errorCount <= MAX_ERRORS && stats.connected === CLIENTS ? 'PASS' : 'FAIL',
  };

  if (JSON_ONLY) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('');
    console.log('RESULTS');
    console.log(`  state      ${stateHz.toFixed(1)} Hz/client   (${stats.stateMessages} snapshots, ${msgPerSec.toFixed(0)}/s aggregate)`);
    console.log(`  payload    ${fmtBytes(snapshotBytes)}/snapshot   ${(bandwidth / 1024).toFixed(1)} KB/s aggregate   ${(perClientBandwidth / 1024).toFixed(1)} KB/s per client`);
    console.log(`  rtt        p50 ${fmtMs(rtt.p50)}   p95 ${fmtMs(rtt.p95)}   p99 ${fmtMs(rtt.p99)}   max ${fmtMs(rtt.max)}   (${stats.pongs.length} samples)`);
    console.log(`  join       p50 ${fmtMs(joinStats.p50)}   p95 ${fmtMs(joinStats.p95)}   (${stats.joinLatencies.length} samples)`);
    console.log(`  events     ${stats.eventMessages} discrete events during the window`);
    console.log(`  errors     ${errorCount}`);
    if (stats.serverErrors.length) {
      for (const e of stats.serverErrors.slice(0, 5)) console.log(`             ${e.username}: ${e.message}`);
    }
    if (stats.wsErrors.length) {
      for (const e of stats.wsErrors.slice(0, 5)) console.log(`             ${e.username}: ${e.message}`);
    }
    console.log(`  server     heap ${heapDelta}   sockets ${healthDuring ? healthDuring.activeSockets : 'n/a'}   park ${healthDuring ? healthDuring.parkOnline : 'n/a'}`);
    console.log(`  note       STATE counts change-gated snapshots; the simulation tick is nominally 20 Hz.`);
    console.log('');
    console.log(`  verdict    ${summary.verdict}${summary.verdict === 'FAIL' ? ` (allowed errors: ${MAX_ERRORS})` : ''}`);
    console.log('');
  }

  process.exit(summary.verdict === 'PASS' ? 0 : 1);
}

process.on('SIGINT', async () => {
  if (finished) process.exit(130);
  finished = true;
  stopProgress();
  await Promise.allSettled([...sessions].map((c) => c.stop()));
  console.log('\n[loadtest] interrupted');
  process.exit(130);
});

main().catch(async (err) => {
  stopProgress();
  console.error('[loadtest] fatal:', err && err.stack ? err.stack : err);
  await Promise.allSettled([...sessions].map((c) => c.stop()));
  process.exit(1);
});
