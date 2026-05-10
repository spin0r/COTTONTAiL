const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_FILE = path.join(__dirname, '..', 'auth.json');

// Default is 'admin'
const DEFAULT_PASSWORD = 'admin';

// Session lifetime — matches the cookie maxAge (30 days)
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Remove expired sessions from the array.
 * Each session is { token, createdAt } with a 30-day TTL.
 */
function pruneExpired(sessions) {
  const now = Date.now();
  return sessions.filter(s => (now - s.createdAt) < SESSION_MAX_AGE_MS);
}

function loadAuth() {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));

      // Migrate legacy formats to timestamped session objects
      if (!Array.isArray(data.sessionTokens)) {
        // Very old format: single sessionToken string
        const legacy = data.sessionToken;
        data.sessionTokens = legacy
          ? [{ token: legacy, createdAt: Date.now() }]
          : [];
        delete data.sessionToken;
        saveAuth(data);
      } else if (data.sessionTokens.length > 0 && typeof data.sessionTokens[0] === 'string') {
        // Previous fix format: plain string array — migrate to objects
        data.sessionTokens = data.sessionTokens.map(t => ({
          token: t,
          createdAt: Date.now()
        }));
        saveAuth(data);
      }

      return data;
    } catch (e) {
      console.error('Error reading auth.json', e);
    }
  }
  
  // Create default auth config
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = hashPassword(DEFAULT_PASSWORD, salt);
  const authData = {
    salt,
    hash: hashed,
    mustChange: true,
    sessionTokens: []
  };
  saveAuth(authData);
  return authData;
}

function saveAuth(data) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function verifyPassword(password) {
  const auth = loadAuth();
  const hashed = hashPassword(password, auth.salt);
  return hashed === auth.hash;
}

function mustChange() {
  const auth = loadAuth();
  return auth.mustChange === true;
}

function changePassword(newPassword) {
  const auth = loadAuth();
  const salt = crypto.randomBytes(16).toString('hex');
  auth.salt = salt;
  auth.hash = hashPassword(newPassword, salt);
  auth.mustChange = false;
  
  // Invalidate ALL sessions when password changes, start a fresh one
  const token = generateToken();
  auth.sessionTokens = [{ token, createdAt: Date.now() }];
  saveAuth(auth);
  
  return token;
}

function createSession() {
  const auth = loadAuth();
  const token = generateToken();

  // Prune expired sessions on every login (cleans up dead incognito tokens)
  auth.sessionTokens = pruneExpired(auth.sessionTokens);
  auth.sessionTokens.push({ token, createdAt: Date.now() });

  saveAuth(auth);
  return token;
}

function verifySession(token) {
  if (!token) return false;
  const auth = loadAuth();
  const now = Date.now();
  return auth.sessionTokens.some(
    s => s.token === token && (now - s.createdAt) < SESSION_MAX_AGE_MS
  );
}

function clearSession(token) {
  const auth = loadAuth();
  if (token) {
    // Remove only the specific session (single-browser logout)
    auth.sessionTokens = auth.sessionTokens.filter(s => s.token !== token);
  } else {
    // No token provided — clear all sessions (full logout)
    auth.sessionTokens = [];
  }
  saveAuth(auth);
}

module.exports = {
  verifyPassword,
  mustChange,
  changePassword,
  createSession,
  verifySession,
  clearSession
};

