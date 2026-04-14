/**
 * NZB Database Backup → Dropbox
 *
 * Monitors the SQLite database for changes every 5 minutes and pushes
 * to Dropbox only when the DB has actually changed (size or mtime diff).
 *
 * On startup, if the local DB is missing or empty, automatically restores
 * from Dropbox.
 *
 * Uses a long-lived refresh token to obtain short-lived access tokens
 * automatically — no manual token rotation needed.
 *
 * Required env vars:
 *   DROPBOX_REFRESH_TOKEN  — from offline OAuth2 flow
 *   DROPBOX_APP_KEY        — app key from Dropbox developer console
 *   DROPBOX_APP_SECRET     — app secret from Dropbox developer console
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
require("dotenv").config();

const db = require("./db");

// ─── Config ───────────────────────────────────────────────────────────────────

const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || "";
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY || "";
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET || "";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BACKUP_FILE = path.join(__dirname, "..", "nzb_index_backup.db");
const DROPBOX_PATH = "/cottontail/nzb_index.db"; // path inside Dropbox

let backupTimer = null;
let isBackingUp = false;
let cachedAccessToken = null;
let tokenExpiresAt = 0;

// Track last known DB state for change detection
let lastDbHash = null;

// ─── Change Detection ─────────────────────────────────────────────────────────

/**
 * Compute a fast fingerprint of the DB file (size + mtime).
 * This avoids reading the entire file just to check for changes.
 *
 * @returns {string|null} - Fingerprint string, or null if file doesn't exist
 */
function getDbFingerprint() {
  const dbPath = db.getDbPath();
  try {
    const stat = fs.statSync(dbPath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch (_) {
    return null;
  }
}

/**
 * Check if the database has changed since the last backup.
 *
 * @returns {boolean}
 */
function hasDbChanged() {
  const current = getDbFingerprint();
  if (!current) return false;
  if (lastDbHash === null) {
    // First run — record fingerprint and consider it changed
    lastDbHash = current;
    return true;
  }
  return current !== lastDbHash;
}

// ─── Dropbox Auth ─────────────────────────────────────────────────────────────

/**
 * Obtain a short-lived access token using the refresh token.
 * Caches the token and auto-refreshes when it expires.
 *
 * @returns {Promise<string>} - Valid access token
 */
async function getAccessToken() {
  // Return cached token if still valid (with 5-min buffer)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 300_000) {
    return cachedAccessToken;
  }

  const { data } = await axios.post(
    "https://api.dropbox.com/oauth2/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: DROPBOX_REFRESH_TOKEN,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: {
        username: DROPBOX_APP_KEY,
        password: DROPBOX_APP_SECRET,
      },
    },
  );

  cachedAccessToken = data.access_token;
  // Dropbox tokens usually expire in 14400s (4h)
  tokenExpiresAt = Date.now() + (data.expires_in || 14400) * 1000;
  console.log(
    `[NZB-BACKUP] Dropbox token refreshed, expires in ${data.expires_in || 14400}s`,
  );
  return cachedAccessToken;
}

// ─── Backup Operations ───────────────────────────────────────────────────────

/**
 * Create a safe database backup using SQLite's backup API.
 * Works safely even while the main DB is being written to.
 *
 * @returns {Promise<string>} - Path to backup file
 */
async function createBackup() {
  const source = db.getDb();
  if (!source) throw new Error("Database not initialized");

  await source.backup(BACKUP_FILE);
  const size = fs.statSync(BACKUP_FILE).size;
  const sizeMB = (size / (1024 * 1024)).toFixed(2);
  console.log(`[NZB-BACKUP] DB backed up to ${BACKUP_FILE} (${sizeMB} MB)`);
  return BACKUP_FILE;
}

/**
 * Upload a file to Dropbox using the /files/upload endpoint.
 * Overwrites the existing file at the target path.
 *
 * @param {string} filePath - Local file to upload
 */
async function pushToDropbox(filePath) {
  const token = await getAccessToken();
  const fileContent = fs.readFileSync(filePath);

  const apiArg = JSON.stringify({
    path: DROPBOX_PATH,
    mode: "overwrite",
    autorename: false,
    mute: true,
  });

  const { data } = await axios.post(
    "https://content.dropboxapi.com/2/files/upload",
    fileContent,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": apiArg,
        "Content-Type": "application/octet-stream",
      },
      maxBodyLength: 150 * 1024 * 1024,
    },
  );

  const sizeMB = ((data.size || 0) / (1024 * 1024)).toFixed(2);
  console.log(
    `[NZB-BACKUP] Pushed to Dropbox: ${data.path_display} (${sizeMB} MB, rev: ${data.rev})`,
  );
}

/**
 * Download the backup from Dropbox and restore it to the local DB path.
 * Useful for bootstrapping a fresh deployment.
 *
 * @returns {Promise<string|null>} - Path to restored file, or null on failure
 */
async function restoreFromDropbox() {
  const token = await getAccessToken();

  const apiArg = JSON.stringify({ path: DROPBOX_PATH });

  try {
    const { data } = await axios.post(
      "https://content.dropboxapi.com/2/files/download",
      null,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": apiArg,
          "Content-Type": "application/octet-stream",
        },
        responseType: "arraybuffer",
        maxContentLength: 150 * 1024 * 1024,
      },
    );

    const restorePath = db.getDbPath();
    fs.writeFileSync(restorePath, Buffer.from(data));
    const sizeMB = (data.byteLength / (1024 * 1024)).toFixed(2);
    console.log(
      `[NZB-BACKUP] Restored from Dropbox → ${restorePath} (${sizeMB} MB)`,
    );
    return restorePath;
  } catch (e) {
    if (e.response?.status === 409) {
      // path/not_found — no backup exists yet
      console.log("[NZB-BACKUP] No backup found on Dropbox.");
      return null;
    }
    throw e;
  }
}

/**
 * Get metadata about the current backup on Dropbox.
 *
 * @returns {Promise<object|null>} - File metadata or null
 */
async function getBackupInfo() {
  const token = await getAccessToken();

  try {
    const { data } = await axios.post(
      "https://api.dropboxapi.com/2/files/get_metadata",
      { path: DROPBOX_PATH },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    return {
      path: data.path_display,
      size: data.size,
      sizeMB: (data.size / (1024 * 1024)).toFixed(2),
      modified: data.server_modified,
      rev: data.rev,
    };
  } catch (e) {
    if (e.response?.status === 409) return null;
    throw e;
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Run the full backup cycle: create local backup → push to Dropbox.
 * Called manually via /backup command — always forces upload.
 */
async function runBackup() {
  if (isBackingUp) {
    console.log("[NZB-BACKUP] Backup already in progress, skipping.");
    return;
  }

  isBackingUp = true;
  try {
    const backupPath = await createBackup();
    await pushToDropbox(backupPath);

    // Update fingerprint after successful push
    lastDbHash = getDbFingerprint();

    // Clean up local backup file after successful push
    try {
      fs.unlinkSync(backupPath);
    } catch (_) {}

    console.log("[NZB-BACKUP] Backup cycle complete.");
  } catch (e) {
    const detail = e.response?.data
      ? (typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data))
      : e.message;
    console.error("[NZB-BACKUP] Backup failed:", detail);
  } finally {
    isBackingUp = false;
  }
}

/**
 * Check for DB changes and back up only if something changed.
 * Called by the 5-minute interval timer.
 */
async function checkAndBackup() {
  if (!hasDbChanged()) return;
  console.log("[NZB-BACKUP] DB change detected, starting backup...");
  await runBackup();
}

/**
 * Check if Dropbox backup is properly configured.
 *
 * @returns {boolean}
 */
function isConfigured() {
  return !!(DROPBOX_REFRESH_TOKEN && DROPBOX_APP_KEY && DROPBOX_APP_SECRET);
}

/**
 * Auto-restore: if local DB is missing or empty, pull from Dropbox.
 * Called once at startup before the bot starts.
 */
async function autoRestore() {
  if (!isConfigured()) return;

  const dbPath = db.getDbPath();
  let needsRestore = false;

  try {
    const stat = fs.statSync(dbPath);
    // Consider empty if under 4KB (SQLite header is ~100 bytes, empty schema is ~4KB)
    if (stat.size < 4096) {
      console.log(`[NZB-BACKUP] Local DB is empty (${stat.size} bytes), will restore from Dropbox.`);
      needsRestore = true;
    }
  } catch (e) {
    if (e.code === "ENOENT") {
      console.log("[NZB-BACKUP] Local DB not found, will restore from Dropbox.");
      needsRestore = true;
    }
  }

  if (!needsRestore) return;

  try {
    const result = await restoreFromDropbox();
    if (result) {
      console.log("[NZB-BACKUP] Auto-restore complete.");
    } else {
      console.log("[NZB-BACKUP] No remote backup to restore — starting fresh.");
    }
  } catch (e) {
    const detail = e.response?.data
      ? (typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data))
      : e.message;
    console.error("[NZB-BACKUP] Auto-restore failed:", detail);
  }
}

/**
 * Start the periodic backup scheduler.
 * Call once at bot startup.
 */
function startBackupScheduler() {
  if (!isConfigured()) {
    console.log(
      "[NZB-BACKUP] Backup disabled — set DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, and DROPBOX_APP_SECRET in .env",
    );
    return;
  }

  console.log("[NZB-BACKUP] Scheduler started (Dropbox) — checking every 5 min");

  // Record initial DB fingerprint
  lastDbHash = getDbFingerprint();

  // Run first backup after 30s (let bot fully initialize)
  setTimeout(() => {
    runBackup();
  }, 30_000);

  // Check for changes every 5 minutes
  backupTimer = setInterval(checkAndBackup, CHECK_INTERVAL_MS);
}

/**
 * Stop the backup scheduler.
 */
function stopBackupScheduler() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
    console.log("[NZB-BACKUP] Scheduler stopped.");
  }
}

module.exports = {
  startBackupScheduler,
  stopBackupScheduler,
  runBackup,
  restoreFromDropbox,
  getBackupInfo,
  isConfigured,
  autoRestore,
};
