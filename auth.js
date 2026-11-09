'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function buildSecret() {
  const raw = process.env.JWT_SECRET;
  if (!raw) {
    console.warn('[AUTH]  JWT_SECRET not set — generating an ephemeral key (tokens die on restart).');
    return crypto.randomBytes(64);
  }
  // Accept either a 128-char hex string (64 bytes) or any passphrase.
  if (/^[0-9a-fA-F]{128}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length >= 64) return Buffer.from(raw, 'hex');
  return Buffer.from(raw, 'utf8');
}

const SECRET = buildSecret();
const TOKEN_EXPIRY = '24h';

function createToken(player) {
  return jwt.sign(
    {
      sub: player.id,
      username: player.username,
      iat: Math.floor(Date.now() / 1000),
    },
    SECRET,
    { expiresIn: TOKEN_EXPIRY, algorithm: 'HS512' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET, { algorithms: ['HS512'] });
  } catch {
    return null;
  }
}

module.exports = { createToken, verifyToken };
