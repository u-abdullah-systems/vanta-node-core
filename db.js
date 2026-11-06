'use strict';

const { v4: uuidv4 } = require('uuid');

const OFFLINE_TTL_MS = 60 * 60 * 1000;
const CHAT_LOG_MAX = 500;

// Presence states used by the lobby/park. `park` means the player is inside
// the shared world; the park engine owns the actual membership set.
const ALLOWED_TRANSITIONS = Object.freeze({
  offline:     ['lobby'],
  lobby:       ['offline', 'park', 'restricted', 'banned'],
  park:        ['lobby', 'offline', 'restricted', 'banned'],
  restricted:  ['lobby', 'park', 'offline'],
  banned:      ['offline'],
});

function _isValidTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultStats() {
  return {
    coins: 0,
    flowers: 0,
    emotes: 0,
    challenges: 0,
    gauntlets: 0,
    tagWins: 0,
    danceWins: 0,
    bellRings: 0,
    goals: 0,
    distance: 0,
    visits: 0,
    playMs: 0,
    mushrooms: 0,
  };
}

function defaultCosmetics() {
  return {
    color: null,                       // null => derive from player id
    hat: 'none',
    pet: 'none',
    unlocked: ['hat:none', 'pet:none'],
  };
}

function ensureProfile(player) {
  if (!player.stats) player.stats = defaultStats();
  if (!player.cosmetics) player.cosmetics = defaultCosmetics();
  if (!Array.isArray(player.achievements)) player.achievements = [];
  if (!Array.isArray(player.quests)) player.quests = [];
  if (typeof player.coins !== 'number') player.coins = 0;
  if (typeof player.xp !== 'number') player.xp = 0;
  if (typeof player.level !== 'number') player.level = levelForXp(player.xp);
  return player;
}

function levelForXp(xp) {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1);
}

function xpForLevel(level) {
  return Math.pow(Math.max(0, level - 1), 2) * 60;
}

function createDb() {
  const byUsername = new Map();
  const byId = new Map();
  const chatLogs = [];

  let cleanupTimer = null;

  function _insert(username, mmr) {
    const player = ensureProfile({
      id: uuidv4(),
      username,
      mmr: Math.max(0, Math.min(9999, Math.round(mmr))),
      status: 'offline',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      violationScore: 0,
      violationCount: 0,
      coins: 0,
      xp: 0,
      level: 1,
      achievements: [],
      quests: [],
      stats: defaultStats(),
      cosmetics: defaultCosmetics(),
    });
    byUsername.set(username, player);
    byId.set(player.id, player);
    return player;
  }

  function seed() {
    const fixtures = [
      { username: 'ArenaKing',   mmr: 2850, xp: 2400, coins: 640 },
      { username: 'NightBlade',  mmr: 2640, xp: 1450, coins: 420 },
      { username: 'StormWarden', mmr: 2510, xp: 980,  coins: 290 },
      { username: 'IronClad',    mmr: 2390, xp: 640,  coins: 180 },
      { username: 'VoidHunter',  mmr: 2200, xp: 380,  coins: 120 },
      { username: 'CryptoMage',  mmr: 2100, xp: 240,  coins: 90 },
      { username: 'LancerX',     mmr: 1980, xp: 120,  coins: 60 },
      { username: 'PhoenixRise', mmr: 1850, xp: 60,   coins: 40 },
      { username: 'ShadowStep',  mmr: 1720, xp: 20,   coins: 25 },
      { username: 'FrostEdge',   mmr: 1600, xp: 0,    coins: 10 },
    ];
    for (const f of fixtures) {
      const p = _insert(f.username, f.mmr);
      p.xp = f.xp;
      p.coins = f.coins;
      p.level = levelForXp(f.xp);
      p.achievements = f.xp > 500 ? ['first_steps', 'collector'] : ['first_steps'];
    }
  }

  async function findOrCreate(username, mmr = 1000) {
    await _delay(15);
    if (byUsername.has(username)) return ensureProfile(byUsername.get(username));
    return _insert(username, mmr);
  }

  function getById(id) {
    return byId.get(id) ?? null;
  }

  function getByUsername(username) {
    return byUsername.get(username) ?? null;
  }

  function playerCount() {
    return byUsername.size;
  }

  function allPlayers() {
    return [...byUsername.values()];
  }

  function setStatusAtomic(playerId, expectedCurrent, newStatus) {
    const player = byId.get(playerId);
    if (!player) return false;
    if (expectedCurrent && player.status !== expectedCurrent) return false;
    if (!_isValidTransition(player.status, newStatus)) return false;
    player.status = newStatus;
    player.lastActivity = Date.now();
    return true;
  }

  function touch(playerId) {
    const player = byId.get(playerId);
    if (player) player.lastActivity = Date.now();
  }

  async function leaderboard(limit = 20) {
    await _delay(10);
    return [...byUsername.values()]
      .sort((a, b) => (b.xp - a.xp) || (b.coins - a.coins) || (b.mmr - a.mmr))
      .slice(0, Math.min(limit, 100));
  }

  function resolveSession(playerId) {
    const player = byId.get(playerId);
    return player ? ensureProfile(player) : null;
  }

  function recordViolation(playerId, score) {
    const p = byId.get(playerId);
    if (!p) return null;
    p.violationScore += score;
    p.violationCount += 1;
    return p;
  }

  function appendChatLog(entry) {
    chatLogs.push(entry);
    if (chatLogs.length > CHAT_LOG_MAX) chatLogs.shift();
  }

  function getChatLogs(limit = 50) {
    return chatLogs.slice(-Math.min(limit, CHAT_LOG_MAX));
  }

  function grantCoins(player, amount) {
    player.coins = Math.max(0, Math.round(player.coins + amount));
    if (amount > 0 && player.stats) player.stats.coins += amount;
    return player.coins;
  }

  function grantXp(player, amount) {
    const before = player.level;
    player.xp = Math.max(0, player.xp + Math.round(amount));
    player.level = levelForXp(player.xp);
    return { leveledUp: player.level > before, level: player.level, xp: player.xp };
  }

  function publicPlayer(player) {
    return {
      id: player.id,
      username: player.username,
      mmr: player.mmr,
      status: player.status,
      coins: player.coins,
      xp: player.xp,
      level: player.level,
      achievements: player.achievements,
      cosmetics: player.cosmetics,
    };
  }

  function _pruneOnce() {
    const now = Date.now();
    const toRemove = [];
    for (const [id, player] of byId) {
      if (player.status !== 'offline') continue;
      if (now - player.lastActivity < OFFLINE_TTL_MS) continue;
      toRemove.push({ id, username: player.username });
    }
    for (const { id, username } of toRemove) {
      byId.delete(id);
      byUsername.delete(username);
    }
    if (toRemove.length > 0) {
      console.log(`[DB]  Pruned ${toRemove.length} stale offline player(s)`);
    }
  }

  function startCleanupLoop() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(_pruneOnce, 60_000);
    cleanupTimer.unref();
  }

  function stopCleanupLoop() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  function cleanupNow() {
    _pruneOnce();
  }

  return {
    seed,
    findOrCreate,
    setStatusAtomic,
    leaderboard,
    getById,
    getByUsername,
    playerCount,
    allPlayers,
    resolveSession,
    touch,
    recordViolation,
    appendChatLog,
    getChatLogs,
    grantCoins,
    grantXp,
    publicPlayer,
    levelForXp,
    xpForLevel,
    startCleanupLoop,
    stopCleanupLoop,
    cleanupNow,
  };
}

module.exports = { createDb, levelForXp, xpForLevel };
