import Database from "better-sqlite3";
import path from "path";
import "dotenv/config";
import type { NzbMeta, NzbRecord } from "../types";
import { log } from "../utils/logger";

const DB_PATH: string = process.env.NZB_DB_PATH ?? path.join(__dirname, "..", "..", "nzb_index.db");

let db: Database.Database | null = null;

let _insertStmt: Database.Statement | null = null;
let _searchStmt: Database.Statement | null = null;
let _isIndexedStmt: Database.Statement | null = null;
let _countStmt: Database.Statement | null = null;
let _getByMsgIdStmt: Database.Statement | null = null;
let _getRecentStmt: Database.Statement | null = null;
let _updateFileStmt: Database.Statement | null = null;
let _deleteByMsgIdStmt: Database.Statement | null = null;
let _setCustomThumbStmt: Database.Statement | null = null;
let _getCustomThumbStmt: Database.Statement | null = null;
let _hasCustomThumbStmt: Database.Statement | null = null;

export function init(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000");
  db.pragma("temp_store = MEMORY");

  db.exec(`
    CREATE TABLE IF NOT EXISTS nzb_meta (
      msg_id      INTEGER PRIMARY KEY,
      file_name   TEXT NOT NULL DEFAULT '',
      caption     TEXT NOT NULL DEFAULT '',
      keywords    TEXT NOT NULL DEFAULT '',
      file_type   TEXT NOT NULL DEFAULT 'nzb',
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS nzb_fts USING fts5(
      file_name, caption, keywords, file_type,
      content='nzb_meta', content_rowid='msg_id',
      tokenize='unicode61 remove_diacritics 2'
    )
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS nzb_fts_ai AFTER INSERT ON nzb_meta BEGIN
      INSERT INTO nzb_fts(rowid, file_name, caption, keywords, file_type)
      VALUES (new.msg_id, new.file_name, new.caption, new.keywords, new.file_type);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS nzb_fts_ad AFTER DELETE ON nzb_meta BEGIN
      INSERT INTO nzb_fts(nzb_fts, rowid, file_name, caption, keywords, file_type)
      VALUES ('delete', old.msg_id, old.file_name, old.caption, old.keywords, old.file_type);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS nzb_fts_au AFTER UPDATE ON nzb_meta BEGIN
      INSERT INTO nzb_fts(nzb_fts, rowid, file_name, caption, keywords, file_type)
      VALUES ('delete', old.msg_id, old.file_name, old.caption, old.keywords, old.file_type);
      INSERT INTO nzb_fts(rowid, file_name, caption, keywords, file_type)
      VALUES (new.msg_id, new.file_name, new.caption, new.keywords, new.file_type);
    END
  `);

  // Migration: add custom thumbnail columns if not present
  const cols = (db.prepare("PRAGMA table_info(nzb_meta)").all() as any[]).map((c: any) => c.name);
  if (!cols.includes("custom_thumbnail")) {
    db.exec(`ALTER TABLE nzb_meta ADD COLUMN custom_thumbnail BLOB DEFAULT NULL`);
    log.db("Migration: added custom_thumbnail column");
  }
  if (!cols.includes("custom_thumbnail_mime")) {
    db.exec(`ALTER TABLE nzb_meta ADD COLUMN custom_thumbnail_mime TEXT DEFAULT NULL`);
    log.db("Migration: added custom_thumbnail_mime column");
  }

  log.db(`Initialized at ${DB_PATH}`);
  return db;
}

function ensureDb(): Database.Database {
  if (!db) init();
  return db!;
}

export function insertFile(meta: NzbMeta): Database.RunResult {
  const d = ensureDb();
  if (!_insertStmt) {
    _insertStmt = d.prepare(`
      INSERT OR IGNORE INTO nzb_meta (msg_id, file_name, caption, keywords, file_type, uploaded_at)
      VALUES (@msg_id, @file_name, @caption, @keywords, @file_type, @uploaded_at)
    `);
  }
  return _insertStmt.run({
    msg_id: meta.msg_id,
    file_name: meta.file_name ?? "",
    caption: meta.caption ?? "",
    keywords: meta.keywords ?? "",
    file_type: meta.file_type ?? "nzb",
    uploaded_at: meta.uploaded_at ?? new Date().toISOString(),
  });
}

export function bulkInsert(records: NzbMeta[]): number {
  const d = ensureDb();
  if (!_insertStmt) {
    _insertStmt = d.prepare(`
      INSERT OR IGNORE INTO nzb_meta (msg_id, file_name, caption, keywords, file_type, uploaded_at)
      VALUES (@msg_id, @file_name, @caption, @keywords, @file_type, @uploaded_at)
    `);
  }
  let inserted = 0;
  const transaction = d.transaction((rows: NzbMeta[]) => {
    for (const row of rows) {
      const result = _insertStmt!.run({
        msg_id: row.msg_id,
        file_name: row.file_name ?? "",
        caption: row.caption ?? "",
        keywords: row.keywords ?? "",
        file_type: row.file_type ?? "nzb",
        uploaded_at: row.uploaded_at ?? new Date().toISOString(),
      });
      inserted += result.changes;
    }
  });
  transaction(records);
  return inserted;
}

export function search(query: string, limit = 15): NzbRecord[] {
  const d = ensureDb();
  if (!query?.trim()) return [];
  if (!_searchStmt) {
    _searchStmt = d.prepare(`
      SELECT m.msg_id, m.file_name, m.caption, m.uploaded_at, rank
      FROM nzb_fts f
      JOIN nzb_meta m ON m.msg_id = f.rowid
      WHERE nzb_fts MATCH @query
      ORDER BY m.uploaded_at DESC
      LIMIT @limit
    `);
  }
  try {
    return _searchStmt.all({ query, limit }) as NzbRecord[];
  } catch (e: any) {
    console.error("[NZB-DB] Search error:", e.message);
    return [];
  }
}

export function getRecent(limit = 50): NzbRecord[] {
  const d = ensureDb();
  if (!_getRecentStmt) {
    _getRecentStmt = d.prepare(`
      SELECT msg_id, file_name, caption, uploaded_at
      FROM nzb_meta ORDER BY msg_id DESC LIMIT @limit
    `);
  }
  return _getRecentStmt.all({ limit }) as NzbRecord[];
}

export function isIndexed(msgId: number): boolean {
  const d = ensureDb();
  if (!_isIndexedStmt) {
    _isIndexedStmt = d.prepare(`SELECT 1 FROM nzb_meta WHERE msg_id = ?`);
  }
  return !!_isIndexedStmt.get(msgId);
}

export function getCount(): number {
  const d = ensureDb();
  if (!_countStmt) {
    _countStmt = d.prepare(`SELECT COUNT(*) as cnt FROM nzb_meta`);
  }
  return (_countStmt.get() as { cnt: number }).cnt;
}

export function getByMsgId(msgId: number): NzbRecord | undefined {
  const d = ensureDb();
  if (!_getByMsgIdStmt) {
    _getByMsgIdStmt = d.prepare(
      `SELECT msg_id, file_name, caption, keywords, file_type, uploaded_at FROM nzb_meta WHERE msg_id = ?`
    );
  }
  return _getByMsgIdStmt.get(msgId) as NzbRecord | undefined;
}

export function updateFile(msgId: number, newFileName: string, newKeywords: string): Database.RunResult {
  const d = ensureDb();
  if (!_updateFileStmt) {
    _updateFileStmt = d.prepare(`
      UPDATE nzb_meta SET file_name = @file_name, caption = @caption, keywords = @keywords
      WHERE msg_id = @msg_id
    `);
  }
  return _updateFileStmt.run({ msg_id: msgId, file_name: newFileName, caption: newFileName, keywords: newKeywords });
}

export function deleteByMsgId(msgId: number): Database.RunResult {
  const d = ensureDb();
  if (!_deleteByMsgIdStmt) {
    _deleteByMsgIdStmt = d.prepare(`DELETE FROM nzb_meta WHERE msg_id = ?`);
  }
  return _deleteByMsgIdStmt.run(msgId);
}

export function setCustomThumbnail(msgId: number, data: Buffer, mime: string): void {
  const d = ensureDb();
  if (!_setCustomThumbStmt) {
    _setCustomThumbStmt = d.prepare(`
      UPDATE nzb_meta SET custom_thumbnail = @data, custom_thumbnail_mime = @mime WHERE msg_id = @msg_id
    `);
  }
  _setCustomThumbStmt.run({ msg_id: msgId, data, mime });
}

export function getCustomThumbnail(msgId: number): { data: Buffer; mime: string } | null {
  const d = ensureDb();
  if (!_getCustomThumbStmt) {
    _getCustomThumbStmt = d.prepare(`
      SELECT custom_thumbnail, custom_thumbnail_mime FROM nzb_meta WHERE msg_id = ?
    `);
  }
  const row = _getCustomThumbStmt.get(msgId) as { custom_thumbnail: Buffer | null; custom_thumbnail_mime: string | null } | undefined;
  if (!row?.custom_thumbnail) return null;
  return { data: row.custom_thumbnail, mime: row.custom_thumbnail_mime || "image/jpeg" };
}

export function hasCustomThumbnail(msgId: number): boolean {
  const d = ensureDb();
  if (!_hasCustomThumbStmt) {
    _hasCustomThumbStmt = d.prepare(`
      SELECT 1 FROM nzb_meta WHERE msg_id = ? AND custom_thumbnail IS NOT NULL
    `);
  }
  return !!_hasCustomThumbStmt.get(msgId);
}

export function getDb(): Database.Database {
  return ensureDb();
}

export function getDbPath(): string {
  return DB_PATH;
}

export function close(): void {
  if (db) {
    db.close();
    db = null;
    _insertStmt = null;
    _searchStmt = null;
    _isIndexedStmt = null;
    _countStmt = null;
    _getByMsgIdStmt = null;
    _getRecentStmt = null;
    _updateFileStmt = null;
    _deleteByMsgIdStmt = null;
    _setCustomThumbStmt = null;
    _getCustomThumbStmt = null;
    _hasCustomThumbStmt = null;
    log.db("Closed.");
  }
}
