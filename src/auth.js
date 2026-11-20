// Passwords: salted scrypt hashes. Credentials live in state.credentials, which is never
// sent to the browser.
'use strict';
const crypto = require('crypto');

const STARTER_PASSWORD = process.env.DEMO_PASSWORD || 'Board@360';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { salt, hash };
}
function checkPassword(cred, password) {
  if (!cred || !cred.hash) return false;
  const h = crypto.scryptSync(String(password || ''), cred.salt, 32);
  const want = Buffer.from(cred.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
function validatePassword(p) {
  p = String(p || '');
  if (p.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Use letters and at least one number.';
  return null;
}
function suggestUsername(name, taken) {
  const base = String(name).replace(/^(Dr|Mr|Ms|Mrs|Prof)\.?\s+/i, '').toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).join('.') || 'user';
  let u = base, i = 2;
  while (taken.has(u)) u = `${base}${i++}`;
  return u;
}
// Give every user without credentials a username and the starter password.
function ensureCredentials(state) {
  state.credentials = state.credentials || {};
  let changed = false;
  const taken = new Set(Object.values(state.credentials).map((c) => c.username));
  state.users.forEach((u) => {
    if (u.active === undefined) { u.active = true; changed = true; }
    if (!state.credentials[u.id]) {
      const username = suggestUsername(u.name, taken);
      taken.add(username);
      state.credentials[u.id] = { username, ...hashPassword(STARTER_PASSWORD), mustChange: false };
      changed = true;
    }
  });
  return changed;
}

module.exports = { hashPassword, checkPassword, validatePassword, suggestUsername, ensureCredentials, STARTER_PASSWORD };
