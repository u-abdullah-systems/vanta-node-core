'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
//  VANTA NODE — server-authoritative simulation for sector N-01.
//
//  Solo operators can survey the sector, recover data fragments, calibrate relay
//  blooms, trigger boost pads, activate the sync beacon and recover the data
//  cache. When a second operator links in, cooperative operations become
//  available: Sync Sequence, Signal Transfer, Motion Sync Drill, Data Recovery.
// ═══════════════════════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');

const WORLD = { w: 1800, h: 1100 };
const TICK_MS = 50;
const PLAYER_R = 14;
const INTERACT_R = 62;
const WALK_SPEED = 175;
const SPRINT_MULT = 1.5;
const DASH_SPEED = 620;
const DASH_MS = 170;
const DASH_COOLDOWN_MS = 1100;
const HOP_MS = 520;
const EMOTE_MS = 2200;
const BUBBLE_MS = 6000;
const COIN_MAX = 26;
const COIN_RESPAWN_MS = 3800;
const LEVEL_CAP = 99;

const EMOTES = {
  wave: '[WAVE]', laugh: '[HA]', dance: '[SYNC]', gg: '[GG]',
  heart: '[ACK]', cry: '[ERR]', angry: '[NAK]', sleep: '[IDLE]', sparkle: '[PING]',
};

const COLORS = [
  '#ff8a65', '#4fc3f7', '#b388ff', '#66bb6a', '#ffd54f',
  '#f06292', '#4dd0e1', '#aed581', '#ffb74d', '#9575cd',
];

const HATS = [
  { id: 'none', name: 'None', price: 0, emoji: '' },
  { id: 'cap', name: 'Visor Array', price: 50, emoji: '' },
  { id: 'cone', name: 'Spike Antenna', price: 80, emoji: '' },
  { id: 'flower', name: 'Sensor Bloom', price: 120, emoji: '' },
  { id: 'tophat', name: 'Command Crest', price: 250, emoji: '' },
  { id: 'crown', name: 'Aegis Halo', price: 400, emoji: '' },
  { id: 'halo', name: 'Orbit Ring', price: 650, emoji: '' },
];

const PETS = [
  { id: 'none', name: 'None', price: 0, emoji: '' },
  { id: 'chick', name: 'Scout Drone', price: 120, emoji: '' },
  { id: 'duck', name: 'Relay Drone', price: 220, emoji: '' },
  { id: 'cat', name: 'Guard Drone', price: 360, emoji: '' },
  { id: 'ghost', name: 'Phase Drone', price: 500, emoji: '' },
];

const ACHIEVEMENTS = {
  first_steps: { name: 'Field Certified', desc: 'Travel 500 units in the sector.', icon: '' },
  explorer:    { name: 'Sector Mapped', desc: 'Visit all four sector corners.', icon: '' },
  gardener:    { name: 'Relay Calibrator', desc: 'Calibrate 5 relay blooms.', icon: '' },
  collector:   { name: 'Data Recovery', desc: 'Recover 50 data fragments.', icon: '' },
  bell_ringer: { name: 'Beacon Operator', desc: 'Activate the sync beacon.', icon: '' },
  goal_scorer: { name: 'Containment', desc: 'Score in the test goal.', icon: '' },
  social:      { name: 'Linked', desc: 'Broadcast an emote near another operator.', icon: '' },
  gauntlet:    { name: 'Sync Master', desc: 'Win a Sync Sequence.', icon: '' },
  tagger:      { name: 'Trace Winner', desc: 'Win a Signal Transfer.', icon: '' },
  dancer:      { name: 'Rhythm Sync', desc: 'Win a Motion Sync Drill.', icon: '' },
  night_owl:   { name: 'Night Shift', desc: 'Operate the node at night.', icon: '' },
  rain_dancer: { name: 'Storm Calibration', desc: 'Run a drill during rainfall.', icon: '' },
  legend:      { name: 'Veteran Operator', desc: 'Reach level 5.', icon: '' },
};

const QUEST_POOL = [
  { type: 'coins',    title: 'Fragments Recovered', desc: 'Recover 12 data fragments',     target: 12,   coins: 35, xp: 20 },
  { type: 'flowers',  title: 'Relay Calibration',   desc: 'Calibrate 3 relay blooms',      target: 3,    coins: 30, xp: 18 },
  { type: 'emotes',   title: 'Comms Check',         desc: 'Broadcast 5 emotes',            target: 5,    coins: 25, xp: 15 },
  { type: 'distance', title: 'Sector Survey',       desc: 'Travel 1,200 units',            target: 1200, coins: 30, xp: 18 },
  { type: 'bounce',   title: 'Kinetic Test',        desc: 'Trigger 3 boost pads',          target: 3,    coins: 30, xp: 18 },
  { type: 'bell',     title: 'Beacon Check',        desc: 'Activate the sync beacon',      target: 1,    coins: 25, xp: 15 },
  { type: 'goal',     title: 'Containment Drill',   desc: 'Score in the test goal',        target: 1,    coins: 45, xp: 25 },
  { type: 'challenge',title: 'Cooperative Sync',    desc: 'Complete 1 cooperative activity',target: 1,   coins: 40, xp: 22 },
];

const ACTIVITIES = {
  gauntlet: {
    name: 'Sync Sequence', icon: '', minPlayers: 1, duration: 75_000,
    desc: 'Hold all three sync nodes simultaneously. Cargo mass counts.',
  },
  tag: {
    name: 'Signal Transfer', icon: '', minPlayers: 2, duration: 50_000,
    desc: 'One operator carries the trace. Touch another to transfer it. Most transfers wins.',
  },
  dance: {
    name: 'Motion Sync Drill', icon: '', minPlayers: 1, duration: 25_000,
    desc: 'Broadcast emotes to stabilise the node. Highest sync count wins.',
  },
  treasure: {
    name: 'Data Recovery', icon: '', minPlayers: 1, duration: 50_000,
    desc: 'Recover all six scattered data fragments.',
  },
};

// ── World geometry ────────────────────────────────────────────────────────────

const TREES = [
  { x: 120, y: 140, r: 30, kind: 'oak' },   { x: 240, y: 110, r: 26, kind: 'oak' },
  { x: 360, y: 160, r: 32, kind: 'blossom' },{ x: 150, y: 300, r: 28, kind: 'oak' },
  { x: 300, y: 290, r: 24, kind: 'blossom' },{ x: 560, y: 140, r: 30, kind: 'oak' },
  { x: 660, y: 190, r: 24, kind: 'oak' },    { x: 760, y: 120, r: 28, kind: 'blossom' },
  { x: 1090, y: 140, r: 30, kind: 'oak' },   { x: 1180, y: 110, r: 24, kind: 'oak' },
  { x: 1600, y: 150, r: 30, kind: 'blossom' },{ x: 1720, y: 220, r: 26, kind: 'oak' },
  { x: 120, y: 800, r: 26, kind: 'oak' },    { x: 980, y: 250, r: 28, kind: 'oak' },
  { x: 1340, y: 150, r: 24, kind: 'blossom' },{ x: 1740, y: 500, r: 30, kind: 'oak' },
  { x: 1720, y: 720, r: 26, kind: 'oak' },   { x: 1740, y: 920, r: 32, kind: 'blossom' },
  { x: 700, y: 1040, r: 30, kind: 'oak' },   { x: 900, y: 1060, r: 26, kind: 'oak' },
  { x: 1450, y: 1040, r: 30, kind: 'blossom' },{ x: 1650, y: 1000, r: 26, kind: 'oak' },
  { x: 640, y: 430, r: 24, kind: 'oak' },    { x: 1060, y: 380, r: 26, kind: 'oak' },
  { x: 1380, y: 680, r: 28, kind: 'blossom' },{ x: 1300, y: 920, r: 26, kind: 'oak' },
  { x: 820, y: 320, r: 22, kind: 'oak' },    { x: 900, y: 260, r: 24, kind: 'oak' },
  { x: 300, y: 690, r: 26, kind: 'blossom' },{ x: 60, y: 620, r: 24, kind: 'oak' },
];

const ROCKS = [
  { x: 520, y: 760, r: 22 }, { x: 1240, y: 880, r: 24 }, { x: 860, y: 700, r: 18 },
  { x: 1680, y: 720, r: 20 },{ x: 280, y: 600, r: 16 },  { x: 1120, y: 980, r: 18 },
];

const POND = { x: 1450, y: 330, r: 110 };
const HEDGES = [
  { x: 1200, y: 200, w: 24, h: 250 },
  { x: 1200, y: 580, w: 24, h: 250 },
];
const GATE_DEFS = [
  { id: 'gate_1', x: 1196, y: 450, w: 32, h: 130, plates: ['plate_1', 'plate_2'] },
];
const PLATE_DEFS = [
  { id: 'plate_1', x: 1010, y: 610, r: 44, color: '#4fc3f7' },
  { id: 'plate_2', x: 1100, y: 730, r: 44, color: '#ff8a65' },
  { id: 'plate_3', x: 900, y: 720, r: 44, color: '#ffd54f' },
];
const MUSHROOMS = [
  { id: 'mush_1', x: 560, y: 520, r: 26 },
  { id: 'mush_2', x: 1500, y: 820, r: 26 },
  { id: 'mush_3', x: 1050, y: 960, r: 26 },
];
const LAMPS = [
  { x: 700, y: 700 }, { x: 1260, y: 720 }, { x: 520, y: 920 }, { x: 1580, y: 480 },
];
const BENCHES = [
  { x: 600, y: 500, w: 74, h: 18 }, { x: 1500, y: 750, w: 74, h: 18 },
];
const FLOWER_DEFS = [
  { x: 300, y: 480, color: '#f06292' }, { x: 350, y: 520, color: '#ffd54f' },
  { x: 280, y: 560, color: '#ba68c8' }, { x: 370, y: 610, color: '#4fc3f7' },
  { x: 240, y: 640, color: '#ff8a65' }, { x: 420, y: 670, color: '#f06292' },
  { x: 540, y: 400, color: '#ffd54f' }, { x: 470, y: 460, color: '#4fc3f7' },
  { x: 620, y: 700, color: '#ba68c8' }, { x: 160, y: 760, color: '#ff8a65' },
  { x: 760, y: 880, color: '#f06292' }, { x: 990, y: 900, color: '#4fc3f7' },
  { x: 1600, y: 860, color: '#ffd54f' }, { x: 1480, y: 560, color: '#ba68c8' },
  { x: 1680, y: 620, color: '#f06292' },
];
const BELL = { x: 760, y: 400 };
const NOTICEBOARD = { x: 840, y: 620 };
const CHEST = { x: 1610, y: 660 };
const GOAL = { x: 70, y: 860, w: 110, h: 170 };
const BALL_START = { x: 430, y: 945 };
const BALL_R = 14;

const PATHS = [
  { x: 180, y: 565, w: 1010, h: 92 },
  { x: 780, y: 220, w: 92, h: 500 },
  { x: 1180, y: 560, w: 300, h: 90 },
  { x: 1180, y: 470, w: 60, h: 90 },
  { x: 300, y: 880, w: 130, h: 90 },
  { x: 600, y: 560, w: 90, h: 300 },
  { x: 1330, y: 370, w: 120, h: 90 },
];

function colorFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function _hash(n) {
  let h = 2166136261;
  const s = String(n);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function _dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function _circleRect(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return Math.hypot(cx - nx, cy - ny) < r;
}

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function _env(now = Date.now()) {
  const dayMs = 8 * 60 * 1000;
  const p = (now % dayMs) / dayMs;
  const sun = _clamp(Math.sin(p * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5, 0, 1);
  const phase = sun < 0.15 ? 'night' : sun < 0.4 ? (p < 0.5 ? 'dawn' : 'dusk') : 'day';
  const month = new Date(now).getMonth();
  const season = month <= 1 || month === 11 ? 'winter'
    : month <= 4 ? 'spring'
      : month <= 7 ? 'summer' : 'autumn';
  const bucket = Math.floor(now / 180_000);
  const wRoll = _hash(`w${bucket}`) % 100;
  let weather = wRoll < 18 ? 'rain' : wRoll < 34 ? 'wind' : 'clear';
  if (season === 'winter' && wRoll >= 34 && wRoll < 52) weather = 'snow';
  return { phase, sun: Math.round(sun * 100) / 100, weather, season, dayP: Math.round(p * 1000) / 1000 };
}

function createPark(db, send) {
  const members = new Map();     // playerId -> member
  const ghosts = new Map();      // playerId -> { x, y, at } (reconnect position)
  const coins = new Map();       // coinId -> coin
  const crates = [];
  const plates = PLATE_DEFS.map(p => ({ ...p, active: false, weight: 0 }));
  const gates = GATE_DEFS.map(g => ({ ...g, open: false }));
  const flowers = FLOWER_DEFS.map((f, i) => ({
    id: `flower_${i}`, x: f.x, y: f.y, color: f.color, watered: false, bloomUntil: 0,
  }));

  let timer = null;
  let timerRunning = false;
  let coinTimer = 0;
  let lastType = null;
  let idleSince = Date.now();

  const bell = { x: BELL.x, y: BELL.y, cooldownUntil: 0, lastRingAt: 0 };
  const chest = { x: CHEST.x, y: CHEST.y, openedUntil: 0 };
  const ball = {
    x: BALL_START.x, y: BALL_START.y, vx: 0, vy: 0,
    lastKicker: null, lastKickAt: 0, resetAt: 0,
  };

  const challenge = {
    active: false, phase: 'idle', type: null, title: '', desc: '',
    startsAt: 0, endsAt: 0, countdownUntil: 0, cooldownUntil: 0,
    data: null, participants: new Set(),
  };

  const STATIC = {
    world: WORLD,
    trees: TREES,
    rocks: ROCKS,
    pond: POND,
    hedges: HEDGES,
    gates: GATE_DEFS.map(g => ({ id: g.id, x: g.x, y: g.y, w: g.w, h: g.h })),
    plates: PLATE_DEFS.map(p => ({ id: p.id, x: p.x, y: p.y, r: p.r, color: p.color })),
    mushrooms: MUSHROOMS,
    lamps: LAMPS,
    benches: BENCHES,
    bell: { x: BELL.x, y: BELL.y },
    noticeboard: { x: NOTICEBOARD.x, y: NOTICEBOARD.y },
    chest: { x: CHEST.x, y: CHEST.y },
    goal: GOAL,
    ballStart: BALL_START,
    paths: PATHS,
    flowers: FLOWER_DEFS.map((f, i) => ({ id: `flower_${i}`, x: f.x, y: f.y, color: f.color })),
  };

  const SHOP = {
    colors: COLORS,
    hats: HATS,
    pets: PETS,
  };

  // ── Collision ───────────────────────────────────────────────────────────────

  function _collides(x, y, r) {
    if (x - r < 10 || y - r < 10 || x + r > WORLD.w - 10 || y + r > WORLD.h - 10) return true;
    for (const t of TREES) if (_dist(x, y, t.x, t.y) < r + t.r) return true;
    for (const k of ROCKS) if (_dist(x, y, k.x, k.y) < r + k.r) return true;
    if (_dist(x, y, POND.x, POND.y) < r + POND.r) return true;
    for (const h of HEDGES) if (_circleRect(x, y, r, h)) return true;
    for (const g of gates) if (!g.open && _circleRect(x, y, r, g)) return true;
    return false;
  }

  function _spawn() {
    const cx = 820, cy = 640;
    for (let i = 0; i < 200; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 45 + Math.random() * 130;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      if (!_collides(x, y, PLAYER_R + 4)) return { x, y };
    }
    return { x: cx, y: cy };
  }

  // ── Profile / progress ──────────────────────────────────────────────────────

  function _profile(m) {
    const p = m.player;
    return {
      id: p.id,
      username: p.username,
      coins: p.coins,
      xp: p.xp,
      level: p.level,
      levelXp: db.xpForLevel(p.level),
      nextXp: db.xpForLevel(p.level + 1),
      achievements: p.achievements,
      quests: p.quests,
      cosmetics: p.cosmetics,
      stats: p.stats,
      playMs: (p.stats.playMs || 0) + (Date.now() - m.joinedAt),
    };
  }

  function _sendProfile(m) {
    if (!members.has(m.id)) return;
    send(m.id, { event: 'PARK_PROFILE', profile: _profile(m) });
  }

  function _toast(m, kind, message, extra = {}) {
    send(m.id, { event: 'PARK_EVENT', kind, message, ...extra });
  }

  function _grant(m, coinsAmount = 0, xpAmount = 0) {
    const p = m.player;
    if (coinsAmount) db.grantCoins(p, coinsAmount);
    const res = db.grantXp(p, xpAmount);
    if (res.leveledUp) {
      _toast(m, 'level', `Level ${res.level} reached — clearance updated.`, { level: res.level });
      if (res.level >= 5) _unlock(m, 'legend');
    }
    _sendProfile(m);
    return res;
  }

  function _unlock(m, id) {
    const p = m.player;
    const a = ACHIEVEMENTS[id];
    if (!a || p.achievements.includes(id)) return;
    p.achievements.push(id);
    _toast(m, 'achievement', `Achievement logged — ${a.name}`, {
      achievement: id, name: a.name, desc: a.desc, icon: a.icon,
    });
    db.grantCoins(p, 20);
    db.grantXp(p, 25);
    _sendProfile(m);
  }

  function _newQuest(p) {
    const used = new Set(p.quests.filter(q => !q.done).map(q => q.type));
    const options = QUEST_POOL.filter(q => !used.has(q.type));
    const def = (options.length ? options : QUEST_POOL)[Math.floor(Math.random() * (options.length || QUEST_POOL.length))];
    const id = uuidv4().slice(0, 8);
    return {
      id, type: def.type, title: def.title, desc: def.desc,
      target: def.target, progress: 0, rewardCoins: def.coins, rewardXp: def.xp, done: false,
    };
  }

  function _ensureQuests(p) {
    p.quests = p.quests.filter(q => q && !q.done).slice(0, 3);
    while (p.quests.length < 3) p.quests.push(_newQuest(p));
  }

  function _quest(m, type, amount = 1) {
    const p = m.player;
    let completed = null;
    for (const q of p.quests) {
      if (q.done || q.type !== type) continue;
      q.progress = Math.min(q.target, q.progress + amount);
      if (q.progress >= q.target) {
        q.done = true;
        completed = q;
        break;
      }
    }
    if (!completed) return;
    db.grantCoins(p, completed.rewardCoins);
    db.grantXp(p, completed.rewardXp);
    _toast(m, 'quest', `Directive complete — ${completed.title} (+${completed.rewardCoins} CRED)`, {
      quest: completed.title, coins: completed.rewardCoins,
    });
    p.quests = p.quests.filter(q => q !== completed);
    p.quests.push(_newQuest(p));
    _sendProfile(m);
  }

  // ── Members ─────────────────────────────────────────────────────────────────

  function _publicMember(m, now) {
    const p = m.player;
    return {
      id: m.id,
      username: p.username,
      x: Math.round(m.x * 10) / 10,
      y: Math.round(m.y * 10) / 10,
      facingX: Math.round(m.facingX * 100) / 100,
      facingY: Math.round(m.facingY * 100) / 100,
      moving: m.moving,
      sprinting: m.sprinting,
      dashing: now < m.dashUntil,
      hopping: now < m.hopUntil,
      emote: now < m.emoteUntil ? m.emote : null,
      carrying: m.carrying,
      hat: p.cosmetics.hat || 'none',
      pet: p.cosmetics.pet || 'none',
      color: p.cosmetics.color || colorFor(m.id),
      level: p.level,
      stamina: Math.round(m.stamina),
      bubble: now < m.bubbleUntil ? m.bubble : null,
      bubbleAt: m.bubbleAt,
      sitting: false,
    };
  }

  function _playersSnapshot(now) {
    return [...members.values()].map(m => _publicMember(m, now));
  }

  function join(playerId, player) {
    const existing = members.get(playerId);
    if (existing) {
      existing.player = player;
      return false;
    }

    const ghost = ghosts.get(playerId);
    let pos;
    if (ghost && Date.now() - ghost.at < 30_000 && !_collides(ghost.x, ghost.y, PLAYER_R + 2)) {
      pos = { x: ghost.x, y: ghost.y };
    } else {
      pos = _spawn();
    }
    ghosts.delete(playerId);

    const m = {
      id: playerId,
      player,
      x: pos.x,
      y: pos.y,
      input: { x: 0, y: 0, sprint: false },
      facingX: 0,
      facingY: 1,
      moving: false,
      sprinting: false,
      stamina: 100,
      dashUntil: 0,
      dashDirX: 0,
      dashDirY: 0,
      dashReadyAt: 0,
      hopUntil: 0,
      boostUntil: 0,
      emote: null,
      emoteUntil: 0,
      bubble: null,
      bubbleAt: 0,
      bubbleUntil: 0,
      carrying: null,
      joinedAt: Date.now(),
      lastDanceAt: 0,
      mushroomReadyAt: 0,
      kickReadyAt: 0,
      visited: new Set(),
      lastCoinAt: 0,
    };

    _ensureQuests(player);
    db.setStatusAtomic(playerId, player.status, 'park');
    player.stats.visits = (player.stats.visits || 0) + 1;

    members.set(playerId, m);

    const env = _env();
    if (env.phase === 'night') _unlock(m, 'night_owl');

    send(playerId, {
      event: 'PARK_JOINED',
      you: playerId,
      world: WORLD,
      static: STATIC,
      shop: SHOP,
      achievements: ACHIEVEMENTS,
      activities: ACTIVITIES,
      env,
      profile: _profile(m),
      players: _playersSnapshot(Date.now()),
      challenge: _challengePublic(Date.now()),
    });

    _broadcast({
      event: 'PARK_EVENT',
      kind: 'join',
      message: `${player.username} linked into sector N-01.`,
      username: player.username,
    }, playerId);

    _startLoop();
    console.log(`[PARK]  + ${player.username} (${members.size} online)`);
    return true;
  }

  function leave(playerId) {
    const m = members.get(playerId);
    if (!m) return false;

    if (m.carrying) _dropCrate(m);
    ghosts.set(playerId, { x: m.x, y: m.y, at: Date.now() });
    members.delete(playerId);

    m.player.stats.playMs = (m.player.stats.playMs || 0) + (Date.now() - m.joinedAt);
    db.setStatusAtomic(playerId, 'park', 'lobby');

    send(playerId, { event: 'PARK_LEFT' });
    _broadcast({
      event: 'PARK_EVENT',
      kind: 'leave',
      message: `${m.player.username} disconnected from sector N-01.`,
      username: m.player.username,
    }, playerId);

    if (challenge.active) {
      challenge.participants.delete(playerId);
      if (challenge.type === 'tag' && challenge.data && challenge.data.it === playerId) {
        _assignIt();
      }
      if (members.size === 0) _endChallenge('empty');
    }
    if (members.size === 0) { _stopLoop(); idleSince = Date.now(); }
    console.log(`[PARK]  - ${m.player.username} (${members.size} online)`);
    return true;
  }

  function has(playerId) {
    return members.has(playerId);
  }

  function _broadcast(payload, exceptId = null) {
    for (const id of members.keys()) {
      if (id !== exceptId) send(id, payload);
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  function setInput(playerId, dx, dy, sprint) {
    const m = members.get(playerId);
    if (!m) return;
    m.input.x = _clamp(Number(dx) || 0, -1, 1);
    m.input.y = _clamp(Number(dy) || 0, -1, 1);
    const len = Math.hypot(m.input.x, m.input.y);
    if (len > 1) { m.input.x /= len; m.input.y /= len; }
    m.input.sprint = Boolean(sprint);
  }

  function dash(playerId) {
    const m = members.get(playerId);
    if (!m) return false;
    const now = Date.now();
    if (now < m.dashReadyAt) return false;
    if (m.stamina < 15) {
      _toast(m, 'notice', 'Stamina depleted — recharge before dashing.');
      return false;
    }
    let dx = m.input.x, dy = m.input.y;
    if (!dx && !dy) { dx = m.facingX; dy = m.facingY; }
    const len = Math.hypot(dx, dy) || 1;
    m.dashDirX = dx / len;
    m.dashDirY = dy / len;
    m.dashUntil = now + DASH_MS;
    m.dashReadyAt = now + DASH_COOLDOWN_MS;
    m.stamina = Math.max(0, m.stamina - 15);
    return true;
  }

  function hop(playerId) {
    const m = members.get(playerId);
    if (!m) return;
    m.hopUntil = Math.max(m.hopUntil, Date.now() + HOP_MS);
  }

  function emote(playerId, name) {
    const m = members.get(playerId);
    if (!m || !EMOTES[name]) return;
    const now = Date.now();
    m.emote = name;
    m.emoteUntil = now + EMOTE_MS;
    m.player.stats.emotes = (m.player.stats.emotes || 0) + 1;
    _quest(m, 'emotes', 1);

    for (const other of members.values()) {
      if (other.id === playerId) continue;
      if (_dist(m.x, m.y, other.x, other.y) < 150) {
        _unlock(m, 'social');
        break;
      }
    }

    const env = _env(now);
    if (name === 'dance' && env.weather === 'rain') _unlock(m, 'rain_dancer');

    if (challenge.active && challenge.phase === 'active' && challenge.type === 'dance') {
      if (now - m.lastDanceAt > 220) {
        m.lastDanceAt = now;
        challenge.data.scores[playerId] = (challenge.data.scores[playerId] || 0) + 1;
      }
    }
    _sendProfile(m);
  }

  function say(playerId, text) {
    const m = members.get(playerId);
    if (!m) return;
    const clean = String(text || '').slice(0, 120);
    if (!clean) return;
    m.bubble = clean;
    m.bubbleAt = Date.now();
    m.bubbleUntil = Date.now() + BUBBLE_MS;
  }

  // ── Crates ──────────────────────────────────────────────────────────────────

  function _spawnCrates() {
    const spots = [
      { x: 830, y: 790 }, { x: 950, y: 830 }, { x: 1070, y: 540 },
    ];
    for (const s of spots) {
      crates.push({ id: `crate_${uuidv4().slice(0, 6)}`, x: s.x, y: s.y, carriedBy: null });
    }
  }
  _spawnCrates();

  function _dropCrate(m) {
    const crate = crates.find(c => c.id === m.carrying);
    if (crate) {
      let drop = { x: m.x, y: m.y + 26 };
      if (_collides(drop.x, drop.y, 16)) {
        const dirs = [[26, 0], [-26, 0], [0, -26], [0, 26], [34, 34], [-34, 34]];
        for (const [ox, oy] of dirs) {
          if (!_collides(m.x + ox, m.y + oy, 16)) { drop = { x: m.x + ox, y: m.y + oy }; break; }
        }
      }
      crate.x = drop.x;
      crate.y = drop.y;
      crate.carriedBy = null;
    }
    m.carrying = null;
  }

  function _pickCrate(m, crate) {
    crate.carriedBy = m.id;
    m.carrying = crate.id;
  }

  // ── World tick ──────────────────────────────────────────────────────────────

  function _moveMember(m, dt, now) {
    let ix = m.input.x, iy = m.input.y;
    const len = Math.hypot(ix, iy);
    m.moving = len > 0.02 && now >= m.dashUntil;

    if (len > 0.02) {
      m.facingX = ix / len;
      m.facingY = iy / len;
    }

    const wantsSprint = m.input.sprint && m.moving && m.stamina > 1;
    m.sprinting = wantsSprint;
    if (wantsSprint) m.stamina = Math.max(0, m.stamina - 26 * dt);
    else m.stamina = Math.min(100, m.stamina + 17 * dt);

    let speed;
    let dx;
    let dy;
    if (now < m.dashUntil) {
      speed = DASH_SPEED;
      dx = m.dashDirX;
      dy = m.dashDirY;
    } else {
      speed = WALK_SPEED;
      if (wantsSprint) speed *= SPRINT_MULT;
      if (m.carrying) speed *= 0.82;
      if (now < m.boostUntil) speed *= 1.35;
      dx = ix;
      dy = iy;
      speed *= Math.min(1, len);
    }

    const step = speed * dt;
    const oldX = m.x, oldY = m.y;

    const nx = m.x + dx * step;
    if (!_collides(nx, m.y, PLAYER_R)) m.x = nx;
    const ny = m.y + dy * step;
    if (!_collides(m.x, ny, PLAYER_R)) m.y = ny;

    m.x = _clamp(m.x, PLAYER_R + 10, WORLD.w - PLAYER_R - 10);
    m.y = _clamp(m.y, PLAYER_R + 10, WORLD.h - PLAYER_R - 10);

    const moved = Math.hypot(m.x - oldX, m.y - oldY);
    if (moved > 0) {
      m.player.stats.distance = (m.player.stats.distance || 0) + moved;
      if (m.player.stats.distance >= 500) _unlock(m, 'first_steps');

      // Exploration quadrants.
      const qx = m.x < WORLD.w / 2 ? 0 : 1;
      const qy = m.y < WORLD.h / 2 ? 0 : 2;
      m.visited.add(qx + qy);
      if (m.visited.size >= 4) _unlock(m, 'explorer');

      _quest(m, 'distance', moved);
    }
  }

  function _updateBall(dt, now) {
    if (ball.resetAt && now >= ball.resetAt) {
      ball.x = BALL_START.x;
      ball.y = BALL_START.y;
      ball.vx = 0;
      ball.vy = 0;
      ball.lastKicker = null;
      ball.resetAt = 0;
    }

    // Player kicks.
    for (const m of members.values()) {
      if (now < m.kickReadyAt) continue;
      if (_dist(m.x, m.y, ball.x, ball.y) < PLAYER_R + BALL_R + 8) {
        const dx = ball.x - m.x;
        const dy = ball.y - m.y;
        const len = Math.hypot(dx, dy) || 1;
        const power = now < m.dashUntil ? 760 : 430;
        ball.vx = (dx / len) * power + m.input.x * 80;
        ball.vy = (dy / len) * power + m.input.y * 80;
        ball.lastKicker = m.id;
        ball.lastKickAt = now;
        m.kickReadyAt = now + 260;
        m.player.stats.kicks = (m.player.stats.kicks || 0) + 1;
      }
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vx *= 0.988;
    ball.vy *= 0.988;
    if (Math.hypot(ball.vx, ball.vy) < 6) { ball.vx = 0; ball.vy = 0; }

    if (ball.x - BALL_R < 12) { ball.x = 12 + BALL_R; ball.vx = Math.abs(ball.vx) * 0.75; }
    if (ball.x + BALL_R > WORLD.w - 12) { ball.x = WORLD.w - 12 - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.75; }
    if (ball.y - BALL_R < 12) { ball.y = 12 + BALL_R; ball.vy = Math.abs(ball.vy) * 0.75; }
    if (ball.y + BALL_R > WORLD.h - 12) { ball.y = WORLD.h - 12 - BALL_R; ball.vy = -Math.abs(ball.vy) * 0.75; }

    for (const t of TREES) {
      if (_dist(ball.x, ball.y, t.x, t.y) < BALL_R + t.r) {
        const nx = (ball.x - t.x) / (BALL_R + t.r);
        const ny = (ball.y - t.y) / (BALL_R + t.r);
        const dot = ball.vx * nx + ball.vy * ny;
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;
        ball.x = t.x + nx * (BALL_R + t.r + 1);
        ball.y = t.y + ny * (BALL_R + t.r + 1);
      }
    }
    if (_dist(ball.x, ball.y, POND.x, POND.y) < BALL_R + POND.r) {
      // The pond swallows the ball and spits it back out at the pitch.
      _resetBall(now, 900);
    }

    // Goal!
    if (!ball.resetAt &&
      ball.x > GOAL.x && ball.x < GOAL.x + GOAL.w &&
      ball.y > GOAL.y && ball.y < GOAL.y + GOAL.h) {
      _scoreGoal(now);
    }
  }

  function _resetBall(now, delay) {
    ball.resetAt = now + delay;
    ball.vx = 0;
    ball.vy = 0;
  }

  function _scoreGoal(now) {
    const kicker = ball.lastKicker ? members.get(ball.lastKicker) : null;
    const scorer = kicker || [...members.values()][0] || null;
    _resetBall(now, 1600);
    if (!scorer) return;
    scorer.player.stats.goals = (scorer.player.stats.goals || 0) + 1;
    _grant(scorer, 15, 25);
    _quest(scorer, 'goal', 1);
    _unlock(scorer, 'goal_scorer');
    _toast(scorer, 'goal', 'CONTAINMENT +15 CRED', { x: GOAL.x + GOAL.w, y: GOAL.y + GOAL.h / 2 });
    _broadcast({
      event: 'PARK_EVENT', kind: 'goal',
      message: `CONTAINMENT // ${scorer.player.username} scored.`,
      x: GOAL.x + GOAL.w, y: GOAL.y + GOAL.h / 2,
    });
  }

  function _updateSocialItems(now) {
    // Bell cooldown indicator is client-side; nothing to mutate here.

    // Mushroom bounce.
    for (const m of members.values()) {
      if (now < m.mushroomReadyAt) continue;
      for (const shroom of MUSHROOMS) {
        if (_dist(m.x, m.y, shroom.x, shroom.y) < PLAYER_R + shroom.r) {
          m.hopUntil = now + 720;
          m.boostUntil = now + 550;
          m.mushroomReadyAt = now + 1400;
          m.player.stats.mushrooms = (m.player.stats.mushrooms || 0) + 1;
          _quest(m, 'bounce', 1);
          _toast(m, 'bounce', 'Kinetic boost engaged.');
          break;
        }
      }
    }

    // Plates.
    for (const plate of plates) {
      let weight = 0;
      for (const m of members.values()) {
        if (_dist(m.x, m.y, plate.x, plate.y) < plate.r + PLAYER_R) weight += 2;
      }
      for (const c of crates) {
        if (!c.carriedBy && _dist(c.x, c.y, plate.x, plate.y) < plate.r + 18) weight += 1;
      }
      plate.weight = weight;
      plate.active = weight >= 2;
    }

    // Gates.
    for (const g of gates) {
      g.open = g.plates.every(id => plates.find(p => p.id === id)?.active);
    }
  }

  function _spawnCoin(now) {
    if (coins.size >= COIN_MAX) return;
    for (let i = 0; i < 50; i++) {
      const x = 70 + Math.random() * (WORLD.w - 140);
      const y = 70 + Math.random() * (WORLD.h - 140);
      if (_collides(x, y, 22)) continue;
      if (members.size && Math.random() < 0.35) {
        // Avoid dropping coins directly on top of a player.
        let near = false;
        for (const m of members.values()) {
          if (_dist(x, y, m.x, m.y) < 80) { near = true; break; }
        }
        if (near) continue;
      }
      const gold = Math.random() < 0.16;
      const id = `coin_${uuidv4().slice(0, 6)}`;
      coins.set(id, {
        id, x, y,
        value: gold ? 3 : 1,
        kind: gold ? 'gold' : 'coin',
        challengeId: null,
        spawnedAt: now,
      });
      return;
    }
  }

  function _collectCoins(now) {
    for (const m of members.values()) {
      for (const [id, c] of coins) {
        if (_dist(m.x, m.y, c.x, c.y) > 30) continue;
        if (c.challengeId === 'treasure') {
          if (!challenge.active || !challenge.data?.stars?.has(id)) continue;
          challenge.data.stars.delete(id);
          challenge.data.collected[m.id] = (challenge.data.collected[m.id] || 0) + 1;
        }
        coins.delete(id);
        db.grantCoins(m.player, c.value);
        db.grantXp(m.player, c.value * 2);
        m.player.stats.coins = (m.player.stats.coins || 0) + c.value;
        if (m.player.stats.coins >= 50) _unlock(m, 'collector');
        _quest(m, 'coins', c.value);
        _toast(m, 'coin', `+${c.value} CRED`, {
          coin: c.value, x: Math.round(c.x), y: Math.round(c.y), gold: c.kind === 'gold',
        });
        _sendProfile(m);
      }
    }
  }

  // ── Challenges ──────────────────────────────────────────────────────────────

  function _challengePublic(now) {
    const remaining = challenge.active ? Math.max(0, challenge.endsAt - now) : 0;
    const data = challenge.data || {};
    let scores = [];
    let it = null;
    let itName = null;
    let hold = 0;
    let starsLeft = 0;

    if (challenge.type === 'tag') {
      scores = Object.entries(data.scores || {}).map(([id, value]) => ({
        id, username: members.get(id)?.player.username ?? '—', value,
      })).sort((a, b) => b.value - a.value);
      it = data.it ?? null;
      itName = it ? (members.get(it)?.player.username ?? null) : null;
    } else if (challenge.type === 'dance') {
      scores = Object.entries(data.scores || {}).map(([id, value]) => ({
        id, username: members.get(id)?.player.username ?? '—', value,
      })).sort((a, b) => b.value - a.value);
    } else if (challenge.type === 'gauntlet') {
      hold = data.holdSince ? Math.max(0, now - data.holdSince) : 0;
      scores = plates.map(p => ({ id: p.id, username: p.id.replace('_', ' '), value: p.active ? 1 : 0 }));
    } else if (challenge.type === 'treasure') {
      starsLeft = data.stars ? data.stars.size : 0;
    }

    return {
      active: challenge.active,
      phase: challenge.phase,
      type: challenge.type,
      title: challenge.title,
      desc: challenge.desc,
      startsAt: challenge.startsAt,
      endsAt: challenge.endsAt,
      remaining,
      cooldownUntil: challenge.cooldownUntil,
      it,
      itName,
      holdMs: hold,
      starsLeft,
      scores,
    };
  }

  function _pickActivity() {
    const types = Object.keys(ACTIVITIES).filter(t => t !== lastType);
    return types[Math.floor(Math.random() * types.length)];
  }

  function startActivity(type, initiatorId = null) {
    const now = Date.now();
    if (challenge.active || challenge.phase === 'countdown') {
      if (initiatorId) {
        const m = members.get(initiatorId);
        if (m) _toast(m, 'notice', 'Activity already in progress.');
      }
      return false;
    }
    if (now < challenge.cooldownUntil) {
      if (initiatorId) {
        const m = members.get(initiatorId);
        if (m) _toast(m, 'notice', 'Activity bus cooling down — retry shortly.');
      }
      return false;
    }
    const def = ACTIVITIES[type];
    if (!def) return false;
    if (members.size < def.minPlayers) {
      if (initiatorId) {
        const m = members.get(initiatorId);
        if (m) _toast(m, 'notice', `${def.name} requires ${def.minPlayers} operators.`);
      }
      return false;
    }

    lastType = type;
    challenge.active = true;
    challenge.phase = 'countdown';
    challenge.type = type;
    challenge.title = def.name;
    challenge.desc = def.desc;
    challenge.startsAt = now;
    challenge.endsAt = now + def.duration + 3000;
    challenge.countdownUntil = now + 3000;
    challenge.cooldownUntil = 0;
    challenge.participants = new Set(members.keys());
    challenge.data = _challengeData(type);

    console.log(`[PARK]  activity queued: ${def.name} (${members.size} players)`);
    _broadcast({
      event: 'PARK_CHALLENGE', phase: 'countdown', type,
      title: def.name, desc: def.desc, startsAt: now, endsAt: challenge.endsAt,
      message: `${def.name} // INITIATING IN 3…`,
    });
    return true;
  }

  function _challengeData(type) {
    if (type === 'tag') return { it: null, scores: {}, lastTagAt: 0, duration: ACTIVITIES.tag.duration };
    if (type === 'dance') return { scores: {} };
    if (type === 'gauntlet') return { holdSince: 0 };
    if (type === 'treasure') return { stars: new Set(), collected: {} };
    return {};
  }

  function _beginChallenge(now) {
    challenge.phase = 'active';
    challenge.startsAt = now;
    challenge.endsAt = now + ACTIVITIES[challenge.type].duration;
    const def = ACTIVITIES[challenge.type];

    if (challenge.type === 'tag') _assignIt();
    if (challenge.type === 'gauntlet') challenge.data.holdSince = 0;
    if (challenge.type === 'treasure') _scatterStars(now);
    if (challenge.type === 'dance') challenge.data.scores = {};

    for (const m of members.values()) {
      m.player.stats.challenges = (m.player.stats.challenges || 0) + 1;
      _quest(m, 'challenge', 1);
    }

    _broadcast({
      event: 'PARK_CHALLENGE', phase: 'active', type: challenge.type,
      title: def.name, desc: def.desc, startsAt: now, endsAt: challenge.endsAt,
      message: `${def.name} // GO`,
    });
    _broadcast({
      event: 'PARK_EVENT', kind: 'challenge_start',
      message: `${def.name} is live.`,
    });
  }

  function _assignIt() {
    const pool = [...members.keys()];
    if (!pool.length) return;
    let id = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && challenge.data?.it) {
      const others = pool.filter(x => x !== challenge.data.it);
      id = others[Math.floor(Math.random() * others.length)];
    }
    challenge.data.it = id;
    challenge.data.lastTagAt = 0;
    _broadcast({
      event: 'PARK_EVENT', kind: 'tag_assigned',
      message: `TRACE // ${members.get(id)?.player.username ?? 'Unknown operator'} is carrying the signal.`,
      id,
    });
  }

  function _scatterStars(now) {
    const data = challenge.data;
    data.stars = new Set();
    for (let i = 0; i < 6; i++) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = 90 + Math.random() * (WORLD.w - 180);
        const y = 90 + Math.random() * (WORLD.h - 180);
        if (_collides(x, y, 24)) continue;
        let tooClose = false;
        for (const m of members.values()) {
          if (_dist(x, y, m.x, m.y) < 160) { tooClose = true; break; }
        }
        if (tooClose) continue;
        const id = `star_${uuidv4().slice(0, 6)}`;
        coins.set(id, {
          id, x, y, value: 3, kind: 'star', challengeId: 'treasure', spawnedAt: now,
        });
        data.stars.add(id);
        break;
      }
    }
  }

  function _endChallenge(reason) {
    if (!challenge.active) return;
    const now = Date.now();
    const type = challenge.type;
    const data = challenge.data || {};
    let message = 'Activity complete.';
    const winners = [];

    if (type === 'gauntlet') {
      if (reason === 'success') {
        message = 'SYNC SEQUENCE // complete. All operators awarded 30 CRED.';
        for (const id of challenge.participants) {
          const m = members.get(id);
          if (!m) continue;
          m.player.stats.gauntlets = (m.player.stats.gauntlets || 0) + 1;
          _grant(m, 30, 40);
          _unlock(m, 'gauntlet');
          winners.push(m.player.username);
        }
      } else {
        message = 'SYNC SEQUENCE // failed. Nodes lost sync.';
      }
    } else if (type === 'tag') {
      const sorted = Object.entries(data.scores || {}).sort((a, b) => b[1] - a[1]);
      const top = sorted.length ? sorted[0][1] : 0;
      const winnerIds = top > 0 ? sorted.filter(([, v]) => v === top).map(([id]) => id) : [];
      for (const id of challenge.participants) {
        const m = members.get(id);
        if (!m) continue;
        const isWinner = winnerIds.includes(id);
        if (isWinner) {
          m.player.stats.tagWins = (m.player.stats.tagWins || 0) + 1;
          _grant(m, 35, 35);
          _unlock(m, 'tagger');
        } else {
          _grant(m, 8, 10);
        }
      }
      const names = winnerIds.map(id => members.get(id)?.player.username).filter(Boolean);
      winners.push(...names);
      message = names.length ? `SIGNAL TRANSFER // ${names.join(' & ')} won.` : 'SIGNAL TRANSFER // no transfers recorded.';
    } else if (type === 'dance') {
      const sorted = Object.entries(data.scores || {}).sort((a, b) => b[1] - a[1]);
      const top = sorted.length ? sorted[0][1] : 0;
      const winnerIds = top > 0 ? sorted.filter(([, v]) => v === top).map(([id]) => id) : [];
      for (const id of challenge.participants) {
        const m = members.get(id);
        if (!m) continue;
        if (winnerIds.includes(id)) {
          m.player.stats.danceWins = (m.player.stats.danceWins || 0) + 1;
          _grant(m, 30, 30);
          _unlock(m, 'dancer');
        } else {
          _grant(m, 6, 8);
        }
      }
      const names = winnerIds.map(id => members.get(id)?.player.username).filter(Boolean);
      winners.push(...names);
      message = names.length ? `MOTION SYNC // ${names.join(' & ')} led the drill.` : 'MOTION SYNC // drill ended.';
    } else if (type === 'treasure') {
      for (const id of challenge.participants) {
        const m = members.get(id);
        if (!m) continue;
        _grant(m, 10, 15);
      }
      message = reason === 'success' ? 'DATA RECOVERY // complete. All fragments recovered.' : 'DATA RECOVERY // ended. Fragments lost.';
    }

    _broadcast({
      event: 'PARK_CHALLENGE', phase: 'ended', type,
      title: challenge.title, message, winners,
    });
    _broadcast({ event: 'PARK_EVENT', kind: 'challenge_end', message, winners });

    // Clean up leftover treasure stars.
    for (const [id, c] of coins) {
      if (c.challengeId === 'treasure') coins.delete(id);
    }

    challenge.active = false;
    challenge.phase = 'idle';
    challenge.type = null;
    challenge.data = null;
    challenge.participants = new Set();
    challenge.cooldownUntil = now + 12_000;
    idleSince = now;
  }

  function _updateChallenge(now) {
    if (!challenge.active) {
      if (members.size >= 2 && now > challenge.cooldownUntil && now - idleSince > 45_000) {
        startActivity(_pickActivity(), null);
      }
      return;
    }

    if (challenge.phase === 'countdown') {
      if (now >= challenge.countdownUntil) _beginChallenge(now);
      return;
    }

    if (now >= challenge.endsAt) {
      _endChallenge('timeout');
      return;
    }

    if (challenge.type === 'gauntlet') {
      const all = plates.every(p => p.active);
      if (all) {
        if (!challenge.data.holdSince) challenge.data.holdSince = now;
        if (now - challenge.data.holdSince >= 2500) _endChallenge('success');
      } else {
        challenge.data.holdSince = 0;
      }
    } else if (challenge.type === 'tag') {
      const data = challenge.data;
      if (!data.it || !members.has(data.it)) { _assignIt(); return; }
      if (now - data.lastTagAt < 900) return;
      const it = members.get(data.it);
      if (!it) return;
      for (const other of members.values()) {
        if (other.id === it.id) continue;
        if (_dist(it.x, it.y, other.x, other.y) < 38) {
          data.scores[it.id] = (data.scores[it.id] || 0) + 1;
          data.lastTagAt = now;
          data.it = other.id;
          _broadcast({
            event: 'PARK_EVENT', kind: 'tag',
            message: `TRACE // ${it.player.username} transferred to ${other.player.username}.`,
          });
          break;
        }
      }
    } else if (challenge.type === 'treasure') {
      const data = challenge.data;
      if (!data.stars || data.stars.size === 0) {
        _endChallenge('success');
        return;
      }
      // Stars may have been removed by collection; drop stale ids.
      for (const id of [...data.stars]) if (!coins.has(id)) data.stars.delete(id);
      if (data.stars.size === 0) _endChallenge('success');
    }
  }

  // ── Interactions ────────────────────────────────────────────────────────────

  function _nearestInteractable(m, now) {
    const candidates = [];
    for (const f of flowers) {
      if (f.bloomUntil > now) continue;
      candidates.push({ kind: 'flower', x: f.x, y: f.y, data: f, label: 'Water flower' });
    }
    for (const c of crates) {
      if (!c.carriedBy) candidates.push({ kind: 'crate', x: c.x, y: c.y, data: c, label: 'Pick up crate' });
    }
    candidates.push({ kind: 'bell', x: bell.x, y: bell.y, label: 'Ring the bell' });
    candidates.push({ kind: 'board', x: NOTICEBOARD.x, y: NOTICEBOARD.y, label: 'Read the noticeboard' });
    candidates.push({ kind: 'chest', x: chest.x, y: chest.y, label: 'Open the chest' });

    let best = null;
    let bestD = INTERACT_R;
    for (const c of candidates) {
      const d = _dist(m.x, m.y, c.x, c.y);
      if (d <= bestD) { best = c; bestD = d; }
    }
    return best;
  }

  function interact(playerId) {
    const m = members.get(playerId);
    if (!m) return false;
    const now = Date.now();

    if (m.carrying) {
      _dropCrate(m);
      _toast(m, 'crate', 'Cargo released.');
      return true;
    }

    const target = _nearestInteractable(m, now);
    if (!target) {
      _toast(m, 'notice', 'No interactable in range.');
      return false;
    }

    if (target.kind === 'flower') {
      const f = target.data;
      if (f.bloomUntil > now) {
        _toast(m, 'notice', 'Relay bloom already active.');
        return false;
      }
      f.watered = true;
      f.bloomUntil = now + 120_000;
      m.player.stats.flowers = (m.player.stats.flowers || 0) + 1;
      _grant(m, 2, 6);
      _quest(m, 'flowers', 1);
      if (m.player.stats.flowers >= 5) _unlock(m, 'gardener');
      _toast(m, 'flower', 'Relay bloom calibrated.');
      _broadcast({ event: 'PARK_EVENT', kind: 'flower', x: f.x, y: f.y, color: f.color, username: m.player.username });
      return true;
    }

    if (target.kind === 'crate') {
      _pickCrate(m, target.data);
      _toast(m, 'crate', 'Cargo secured — deliver to a sync node.');
      return true;
    }

    if (target.kind === 'bell') {
      if (now < bell.cooldownUntil) {
        _toast(m, 'notice', 'Sync beacon still cooling down.');
        return false;
      }
      bell.cooldownUntil = now + 15_000;
      bell.lastRingAt = now;
      m.player.stats.bellRings = (m.player.stats.bellRings || 0) + 1;
      _quest(m, 'bell', 1);
      _unlock(m, 'bell_ringer');
      for (const other of members.values()) _grant(other, 3, 8);
      _broadcast({ event: 'PARK_EVENT', kind: 'bell', x: bell.x, y: bell.y, username: m.player.username, message: `BEACON // ${m.player.username} activated the sync beacon.` });
      return true;
    }

    if (target.kind === 'board') {
      send(m.id, {
        event: 'PARK_ACTIVITY_MENU',
        activities: ACTIVITIES,
        challenge: _challengePublic(now),
      });
      return true;
    }

    if (target.kind === 'chest') {
      if (now < chest.openedUntil) {
        _toast(m, 'notice', 'Cache depleted — recharging.');
        return false;
      }
      chest.openedUntil = now + 120_000;
      _grant(m, 25, 35);
      m.player.stats.chestOpens = (m.player.stats.chestOpens || 0) + 1;
      _toast(m, 'chest', 'CACHE // +25 CRED recovered.');
      _broadcast({ event: 'PARK_EVENT', kind: 'chest', x: chest.x, y: chest.y, username: m.player.username });
      return true;
    }

    return false;
  }

  function interactHint(playerId) {
    const m = members.get(playerId);
    if (!m) return null;
    if (m.carrying) return 'Drop crate';
    const t = _nearestInteractable(m, Date.now());
    return t ? t.label : null;
  }

  function activityMenu(playerId) {
    const m = members.get(playerId);
    if (!m) return;
    send(m.id, {
      event: 'PARK_ACTIVITY_MENU',
      activities: ACTIVITIES,
      challenge: _challengePublic(Date.now()),
    });
  }

  function startActivityFor(playerId, type) {
    const m = members.get(playerId);
    if (!m) return false;
    return startActivity(type, playerId);
  }

  // ── Cosmetics ───────────────────────────────────────────────────────────────

  function setCosmetic(playerId, kind, value) {
    const m = members.get(playerId);
    if (!m) return false;
    const p = m.player;

    if (kind === 'color') {
      if (!COLORS.includes(value)) return false;
      p.cosmetics.color = value;
    } else if (kind === 'hat' || kind === 'pet') {
      const list = kind === 'hat' ? HATS : PETS;
      const item = list.find(i => i.id === value);
      if (!item) return false;
      const key = `${kind}:${value}`;
      if (value !== 'none' && !p.cosmetics.unlocked.includes(key)) {
        if (p.coins < item.price) {
          _toast(m, 'notice', `Insufficient CRED — ${item.price - p.coins} more required for ${item.name}.`);
          return false;
        }
        p.coins -= item.price;
        p.cosmetics.unlocked.push(key);
        _toast(m, 'shop', `Module installed — ${item.name}.`);
      }
      p.cosmetics[kind] = value;
    } else {
      return false;
    }

    _sendProfile(m);
    _toast(m, 'cosmetic', 'Loadout updated.');
    return true;
  }

  // ── Loop & snapshots ────────────────────────────────────────────────────────

  function _snapshot(now) {
    return {
      event: 'PARK_STATE',
      serverTime: now,
      env: _env(now),
      players: _playersSnapshot(now),
      ball: {
        x: Math.round(ball.x), y: Math.round(ball.y),
        vx: Math.round(ball.vx), vy: Math.round(ball.vy),
        resetIn: ball.resetAt ? Math.max(0, ball.resetAt - now) : 0,
      },
      crates: crates.map(c => {
        const carrier = c.carriedBy ? members.get(c.carriedBy) : null;
        return {
          id: c.id,
          x: Math.round(carrier ? carrier.x : c.x),
          y: Math.round(carrier ? carrier.y : c.y),
          carriedBy: c.carriedBy,
        };
      }),
      plates: plates.map(p => ({ id: p.id, active: p.active, weight: p.weight })),
      gates: gates.map(g => ({ id: g.id, open: g.open })),
      flowers: flowers.map(f => ({ id: f.id, bloom: f.bloomUntil > now })),
      coins: [...coins.values()].map(c => ({
        id: c.id, x: Math.round(c.x), y: Math.round(c.y), kind: c.kind,
      })),
      bell: { cooldown: Math.max(0, bell.cooldownUntil - now), ringAt: bell.lastRingAt },
      chest: { opened: chest.openedUntil > now },
      challenge: _challengePublic(now),
      interactHint: null,
    };
  }

  let lastSnapshotString = '';

  function _tick() {
    const now = Date.now();
    const dt = TICK_MS / 1000;
    if (members.size === 0) return;

    for (const m of members.values()) _moveMember(m, dt, now);
    _updateBall(dt, now);
    _updateSocialItems(now);

    coinTimer += TICK_MS;
    if (coinTimer >= COIN_RESPAWN_MS) {
      coinTimer = 0;
      _spawnCoin(now);
    }
    _collectCoins(now);
    _updateChallenge(now);

    for (const [id, ghost] of ghosts) {
      if (now - ghost.at > 60_000) ghosts.delete(id);
    }

    const snap = _snapshot(now);
    const json = JSON.stringify(snap);
    if (json !== lastSnapshotString) {
      lastSnapshotString = json;
      for (const id of members.keys()) send(id, snap);
    }
  }

  function _startLoop() {
    if (timerRunning) return;
    timerRunning = true;
    timer = setInterval(_tick, TICK_MS);
    timer.unref();
  }

  function _stopLoop() {
    if (!timerRunning) return;
    timerRunning = false;
    clearInterval(timer);
    timer = null;
    lastSnapshotString = '';
  }

  function stop() {
    _stopLoop();
    members.clear();
  }

  function stats() {
    const now = Date.now();
    return {
      online: members.size,
      players: _playersSnapshot(now).map(p => ({
        id: p.id, username: p.username, level: p.level, x: Math.round(p.x), y: Math.round(p.y),
      })),
      challenge: _challengePublic(now),
      env: _env(now),
    };
  }

  return {
    join,
    leave,
    has,
    setInput,
    dash,
    hop,
    emote,
    say,
    interact,
    interactHint,
    activityMenu,
    startActivityFor,
    startActivity,
    setCosmetic,
    stats,
    start: _startLoop,
    stop,
  };
}

module.exports = {
  createPark,
  WORLD,
  EMOTES,
  ACTIVITIES,
  ACHIEVEMENTS,
  COLORS,
  HATS,
  PETS,
};
