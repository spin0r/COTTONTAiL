/**
 * NZB SQLite FTS5 Database Layer
 *
 * Uses better-sqlite3 for synchronous, high-performance access.
 * WAL mode enabled for concurrent reads during bot operation.
 */

const Database = require("better-sqlite3");
const path = require("path");
require("dotenv").config();

const DB_PATH = process.env.NZB_DB_PATH || path.join(__dirname, "..", "nzb_index.db");

let db = null;

/**
 * Open / create the database and set up tables + FTS5.
 * Called once at startup.
 */
function init() {
  if (db) return db;

  db = new Database(DB_PATH);

  // Performance pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64 MB
  db.pragma("temp_store = MEMORY");

  // Content table — stores all metadata, msg_id is PK
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

  // FTS5 virtual table backed by nzb_meta
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS nzb_fts USING fts5(
      file_name,
      caption,
      keywords,
      file_type,
      content='nzb_meta',
      content_rowid='msg_id',
      tokenize='unicode61 remove_diacritics 2'
    )
  `);

  // Triggers to keep FTS5 in sync with nzb_meta
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

  console.log(`[NZB-DB] Initialized at ${DB_PATH}`);
  return db;
}

// ─── Prepared Statements (lazy-init) ──────────────────────────────────────────

let _insertStmt = null;
let _searchStmt = null;
let _isIndexedStmt = null;
let _countStmt = null;
let _getByMsgIdStmt = null;

function getInsertStmt() {
  if (!_insertStmt) {
    _insertStmt = db.prepare(`
      INSERT OR IGNORE INTO nzb_meta (msg_id, file_name, caption, keywords, file_type, uploaded_at)
      VALUES (@msg_id, @file_name, @caption, @keywords, @file_type, @uploaded_at)
    `);
  }
  return _insertStmt;
}

function getSearchStmt() {
  if (!_searchStmt) {
    _searchStmt = db.prepare(`
      SELECT
        m.msg_id,
        m.file_name,
        m.caption,
        m.uploaded_at,
        rank
      FROM nzb_fts f
      JOIN nzb_meta m ON m.msg_id = f.rowid
      WHERE nzb_fts MATCH @query
      ORDER BY rank
      LIMIT @limit
    `);
  }
  return _searchStmt;
}

function getIsIndexedStmt() {
  if (!_isIndexedStmt) {
    _isIndexedStmt = db.prepare(`SELECT 1 FROM nzb_meta WHERE msg_id = ?`);
  }
  return _isIndexedStmt;
}

function getCountStmt() {
  if (!_countStmt) {
    _countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM nzb_meta`);
  }
  return _countStmt;
}

function getByMsgIdStmt() {
  if (!_getByMsgIdStmt) {
    _getByMsgIdStmt = db.prepare(
      `SELECT msg_id, file_name, caption, keywords, file_type, uploaded_at FROM nzb_meta WHERE msg_id = ?`
    );
  }
  return _getByMsgIdStmt;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Insert or skip an NZB file record.
 *
 * @param {object} meta
 * @param {number} meta.msg_id      - Telegram message ID in the log channel
 * @param {string} meta.file_name   - Cleaned filename
 * @param {string} meta.caption     - Original caption text
 * @param {string} meta.keywords    - Extracted keyword string
 * @param {string} [meta.file_type] - Always "nzb"
 * @param {string} [meta.uploaded_at] - ISO timestamp (defaults to now)
 * @returns {{ changes: number }}    - 1 if inserted, 0 if duplicate
 */
function insertFile(meta) {
  init();
  const stmt = getInsertStmt();
  return stmt.run({
    msg_id: meta.msg_id,
    file_name: meta.file_name || "",
    caption: meta.caption || "",
    keywords: meta.keywords || "",
    file_type: meta.file_type || "nzb",
    uploaded_at: meta.uploaded_at || new Date().toISOString(),
  });
}

/**
 * Bulk insert — wraps in a single transaction for speed.
 * Used by the backfill indexer.
 *
 * @param {Array<object>} records - Array of meta objects
 * @returns {number} - Number of records actually inserted
 */
function bulkInsert(records) {
  init();
  const stmt = getInsertStmt();
  let inserted = 0;
  const transaction = db.transaction((rows) => {
    for (const row of rows) {
      const result = stmt.run({
        msg_id: row.msg_id,
        file_name: row.file_name || "",
        caption: row.caption || "",
        keywords: row.keywords || "",
        file_type: row.file_type || "nzb",
        uploaded_at: row.uploaded_at || new Date().toISOString(),
      });
      inserted += result.changes;
    }
  });
  transaction(records);
  return inserted;
}

/**
 * Full-text search across indexed NZB files.
 *
 * @param {string} query - FTS5 MATCH expression (use normalizeQuery first)
 * @param {number} [limit=15] - Max results
 * @returns {Array<{msg_id: number, file_name: string, caption: string, uploaded_at: string}>}
 */
function search(query, limit = 15) {
  init();
  if (!query || !query.trim()) return [];
  try {
    const stmt = getSearchStmt();
    return stmt.all({ query, limit });
  } catch (e) {
    // FTS5 can throw on malformed expressions — fall back to empty
    console.error("[NZB-DB] Search error:", e.message);
    return [];
  }
}

/**
 * Check if a message ID is already indexed.
 *
 * @param {number} msgId
 * @returns {boolean}
 */
function isIndexed(msgId) {
  init();
  const row = getIsIndexedStmt().get(msgId);
  return !!row;
}

/**
 * Get total number of indexed files.
 *
 * @returns {number}
 */
function getCount() {
  init();
  return getCountStmt().get().cnt;
}

/**
 * Get the raw database instance (for backup).
 *
 * @returns {Database}
 */
function getDb() {
  init();
  return db;
}

/**
 * Get the database file path.
 *
 * @returns {string}
 */
function getDbPath() {
  return DB_PATH;
}

/**
 * Safely close the database.
 */
/**
 * Get a single NZB record by its log channel message ID.
 *
 * @param {number} msgId
 * @returns {object|undefined}
 */
function getByMsgId(msgId) {
  init();
  return getByMsgIdStmt().get(msgId);
}

function close() {
  if (db) {
    db.close();
    db = null;
    _insertStmt = null;
    _searchStmt = null;
    _isIndexedStmt = null;
    _countStmt = null;
    _getByMsgIdStmt = null;
    console.log("[NZB-DB] Closed.");
  }
}

module.exports = {
  init,
  insertFile,
  bulkInsert,
  search,
  isIndexed,
  getCount,
  getByMsgId,
  getDb,
  getDbPath,
  close,
};
