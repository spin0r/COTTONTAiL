import fs from "fs";
import path from "path";
import axios from "axios";
import Database from "better-sqlite3";
import "dotenv/config";
import * as db from "./db";
import type { BackupInfo } from "../types";
import { log } from "../utils/logger";

const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN ?? "";
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY ?? "";
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET ?? "";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const BACKUP_FILE = path.join(__dirname, "..", "..", "nzb_index_backup.db");
const DROPBOX_PATH = "/cottontail/nzb_index.db";
const DIRTY_DEBOUNCE_MS = 30_000;
const MIN_BACKUP_INTERVAL = 2 * 60_000;

let backupTimer: ReturnType<typeof setInterval> | null = null;
let dirtyTimer: ReturnType<typeof setTimeout> | null = null;
let isBackingUp = false;
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;
let lastBackupAt = 0;
let lastDbHash: string | null = null;

function getDbFingerprint(): string | null {
  try {
    const count = db.getCount();
    const dbPath = db.getDbPath();
    const stat = fs.statSync(dbPath);
    return `${count}:${stat.size}`;
  } catch (_) { return null; }
}

function hasDbChanged(): boolean {
  const current = getDbFingerprint();
  if (!current) return false;
  if (lastDbHash === null) { lastDbHash = current; return true; }
  return current !== lastDbHash;
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 300_000) return cachedAccessToken;

  const { data } = await axios.post(
    "https://api.dropbox.com/oauth2/token",
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: DROPBOX_REFRESH_TOKEN }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username: DROPBOX_APP_KEY, password: DROPBOX_APP_SECRET },
    }
  );

  cachedAccessToken = data.access_token as string;
  tokenExpiresAt = Date.now() + ((data.expires_in as number) || 14400) * 1000;
  log.backup(`Dropbox token refreshed (expires in ${data.expires_in || 14400}s)`);
  return cachedAccessToken;
}

async function createBackup(): Promise<string> {
  const source = db.getDb();
  if (!source) throw new Error("Database not initialized");
  await source.backup(BACKUP_FILE);
  const size = fs.statSync(BACKUP_FILE).size;
  log.backup(`DB snapshot created — ${(size / 1048576).toFixed(2)} MB`);
  return BACKUP_FILE;
}

async function pushToDropbox(filePath: string): Promise<void> {
  const token = await getAccessToken();
  const fileContent = fs.readFileSync(filePath);
  const apiArg = JSON.stringify({ path: DROPBOX_PATH, mode: "overwrite", autorename: false, mute: true });

  const { data } = await axios.post("https://content.dropboxapi.com/2/files/upload", fileContent, {
    headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": apiArg, "Content-Type": "application/octet-stream" },
    maxBodyLength: 150 * 1024 * 1024,
  });

  const sizeMB = ((data.size || 0) / 1048576).toFixed(2);
  log.backup(`Pushed to Dropbox — ${data.path_display} (${sizeMB} MB, rev: ${data.rev})`);
}

export async function restoreFromDropbox(): Promise<string | null> {
  const token = await getAccessToken();
  try {
    const { data } = await axios.post(
      "https://content.dropboxapi.com/2/files/download",
      null,
      {
        headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": JSON.stringify({ path: DROPBOX_PATH }), "Content-Type": "application/octet-stream" },
        responseType: "arraybuffer",
        maxContentLength: 150 * 1024 * 1024,
      }
    );
    const restorePath = db.getDbPath();
    for (const suffix of ["-wal", "-shm"]) { try { fs.unlinkSync(restorePath + suffix); } catch (_) {} }
    fs.writeFileSync(restorePath, Buffer.from(data as ArrayBuffer));
    const sizeMB = ((data as ArrayBuffer).byteLength / 1048576).toFixed(2);
    log.backup(`Restored from Dropbox → ${restorePath} (${sizeMB} MB)`);
    return restorePath;
  } catch (e: any) {
    if (e.response?.status === 409) { log.warn("BACKUP", "No backup found on Dropbox"); return null; }
    throw e;
  }
}

export async function getBackupInfo(): Promise<BackupInfo | null> {
  const token = await getAccessToken();
  try {
    const { data } = await axios.post(
      "https://api.dropboxapi.com/2/files/get_metadata",
      { path: DROPBOX_PATH },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );
    return {
      path: data.path_display,
      size: data.size,
      sizeMB: (data.size / 1048576).toFixed(2),
      modified: data.server_modified,
      rev: data.rev,
    };
  } catch (e: any) {
    if (e.response?.status === 409) return null;
    throw e;
  }
}

export async function runBackup(force = false): Promise<void> {
  if (isBackingUp) { log.warn("BACKUP", "Backup already in progress — skipping"); return; }
  if (!force) {
    const elapsed = Date.now() - lastBackupAt;
    if (elapsed < MIN_BACKUP_INTERVAL) {
      log.warn("BACKUP", `Cooldown active — next backup in ${Math.ceil((MIN_BACKUP_INTERVAL - elapsed) / 1000)}s`);
      return;
    }
  }
  isBackingUp = true;
  try {
    const backupPath = await createBackup();
    await pushToDropbox(backupPath);
    lastDbHash = getDbFingerprint();
    lastBackupAt = Date.now();
    try { fs.unlinkSync(backupPath); } catch (_) {}
    log.success("BACKUP", "Cycle complete ✓");
  } catch (e: any) {
    const detail = e.response?.data ? (typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data)) : e.message;
    log.error("BACKUP", `Failed — ${detail}`);
  } finally {
    isBackingUp = false;
  }
}

async function checkAndBackup(): Promise<void> {
  if (dirtyTimer) return;
  if (!hasDbChanged()) return;
  log.backup("DB change detected — syncing...");
  await runBackup();
}

export function isConfigured(): boolean {
  return !!(DROPBOX_REFRESH_TOKEN && DROPBOX_APP_KEY && DROPBOX_APP_SECRET);
}

export async function autoRestore(): Promise<void> {
  if (!isConfigured()) return;
  const dbPath = db.getDbPath();
  let localExists = false;
  let localSize = 0;
  let localCount = 0;

  try {
    const stat = fs.statSync(dbPath);
    localSize = stat.size;
    localExists = localSize >= 4096;
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }

  if (localExists) {
    try {
      db.init();
      localCount = db.getCount();
    } catch (_) {
      localExists = false;
      localCount = 0;
      log.warn("BACKUP", "Local DB appears corrupt — restoring from Dropbox");
    }
  }

  if (!localExists) {
    log.warn("BACKUP", "Local DB missing — restoring from Dropbox");
    try {
      const result = await restoreFromDropbox();
      if (result) { log.success("BACKUP", "Auto-restore complete ✓"); }
      else { log.warn("BACKUP", "No remote backup found — starting fresh"); }
    } catch (e: any) {
      log.error("BACKUP", `Auto-restore failed — ${e.message}`);
    }
    return;
  }

  const tempDbPath = path.join(__dirname, "..", "..", "nzb_index_remote_tmp.db");
  try {
    const remoteInfo = await getBackupInfo();
    if (!remoteInfo) { log.warn("BACKUP", "No remote backup on Dropbox — keeping local DB"); return; }

    log.backup(`Comparing — local: ${localCount} rows (${(localSize / 1048576).toFixed(2)} MB) | Dropbox: ${remoteInfo.sizeMB} MB, modified ${remoteInfo.modified}`);

    const token = await getAccessToken();
    const { data: remoteData } = await axios.post(
      "https://content.dropboxapi.com/2/files/download",
      null,
      {
        headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": JSON.stringify({ path: DROPBOX_PATH }), "Content-Type": "application/octet-stream" },
        responseType: "arraybuffer",
        maxContentLength: 150 * 1024 * 1024,
      }
    );

    fs.writeFileSync(tempDbPath, Buffer.from(remoteData as ArrayBuffer));

    let remoteCount = 0;
    try {
      const tempDb = new Database(tempDbPath, { readonly: true });
      const row = tempDb.prepare("SELECT COUNT(*) as cnt FROM nzb_meta").get() as { cnt: number };
      remoteCount = row ? row.cnt : 0;
      tempDb.close();
    } catch (dbErr: any) {
      log.error("BACKUP", `Failed to read remote DB — ${dbErr.message}`);
      try { fs.unlinkSync(tempDbPath); } catch (_) {}
      return;
    }

    log.backup(`Rows — local: ${localCount}, remote: ${remoteCount}`);

    if (remoteCount > localCount) {
      log.warn("BACKUP", `Dropbox is ahead (${remoteCount} vs ${localCount}) — restoring`);
      db.close();
      const restorePath = db.getDbPath();
      for (const suffix of ["-wal", "-shm"]) { try { fs.unlinkSync(restorePath + suffix); } catch (_) {} }
      fs.renameSync(tempDbPath, restorePath);
      const sizeMB = ((remoteData as ArrayBuffer).byteLength / 1048576).toFixed(2);
      db.init();
      log.success("BACKUP", `Restored from Dropbox — ${db.getCount()} rows, ${sizeMB} MB ✓`);
    } else {
      log.success("BACKUP", "Local DB is up to date — no restore needed ✓");
      try { fs.unlinkSync(tempDbPath); } catch (_) {}
    }
  } catch (e: any) {
    log.error("BACKUP", `Dropbox comparison failed — ${e.message}`);
    try { fs.unlinkSync(tempDbPath); } catch (_) {}
  }
}

export function startBackupScheduler(): void {
  if (!isConfigured()) {
    log.warn("BACKUP", "Disabled — set DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET in .env");
    return;
  }
  log.backup("Scheduler started — checking every 5 min");
  lastDbHash = getDbFingerprint();
  setTimeout(() => { runBackup(); }, 30_000);
  backupTimer = setInterval(checkAndBackup, CHECK_INTERVAL_MS);
}

export function stopBackupScheduler(): void {
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; log.backup("Scheduler stopped"); }
  if (dirtyTimer) { clearTimeout(dirtyTimer); dirtyTimer = null; }
}

export function markDirty(): void {
  if (!isConfigured()) return;
  if (dirtyTimer) clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(async () => {
    dirtyTimer = null;
    log.backup("Dirty flag — syncing to Dropbox...");
    await runBackup();
  }, DIRTY_DEBOUNCE_MS);
}
