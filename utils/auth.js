const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_FILE = path.join(__dirname, '..', 'auth.json');

// Default is 'admin'
const DEFAULT_PASSWORD = 'admin';

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function loadAuth() {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
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
    sessionToken: null
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
  
  // Invalidate old sessions when password changes
  auth.sessionToken = generateToken();
  saveAuth(auth);
  
  return auth.sessionToken;
}

function createSession() {
  const auth = loadAuth();
  auth.sessionToken = generateToken();
  saveAuth(auth);
  return auth.sessionToken;
}

function verifySession(token) {
  if (!token) return false;
  const auth = loadAuth();
  return auth.sessionToken === token;
}

function clearSession() {
  const auth = loadAuth();
  auth.sessionToken = null;
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
