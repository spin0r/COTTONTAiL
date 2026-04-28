const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const UPLOAD_PORT = parseInt(
  process.env.PORT || process.env.UPLOAD_PORT || "10000",
  10,
);
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "nzb_downloads";
const STATIC_DIR = path.join(__dirname, "..", "static");
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB

let _bot = null;
const _accountInfo = {};
const _startTime = Date.now();
let _botInfo = null;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    cb(null, DOWNLOAD_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, path.basename(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".nzb")) {
      return cb(new Error("Only .nzb files are allowed"));
    }
    cb(null, true);
  },
});

async function startWebServer(bot) {
  _bot = bot;

  // Fetch bot info from Telegram
  try {
    _botInfo = await bot.api.getMe();
  } catch (e) {
    console.error("Failed to fetch bot info:", e.message);
  }

  // Fetch cookies and account info at startup
  const { fetchMagicCookies, MAGIC_COOKIES } = require("./helpers");
  await fetchMagicCookies();

  try {
    const MagicClient = require("../client");
    const { MAGIC_COOKIES: getCookies } = require("./helpers");
    const client = new MagicClient(getCookies());
    const info = await client.getAccountInfo();
    if (info) Object.assign(_accountInfo, info);
  } catch (e) {
    console.error("Failed to load account info at startup:", e.message);
  }

  const app = express();
  app.use(express.json());

  // Simple cookie parser
  app.use((req, res, next) => {
    const cookieHeader = req.headers.cookie;
    req.cookies = {};
    if (cookieHeader) {
      cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        if (parts.length >= 2) {
          req.cookies[parts.shift().trim()] = decodeURIComponent(parts.join('='));
        }
      });
    }
    next();
  });

  const auth = require('./auth');

  // Login page
  app.get("/login", (req, res) => {
    const htmlPath = path.join(STATIC_DIR, "login.html");
    if (!fs.existsSync(htmlPath)) return res.status(404).send("Login page not found");
    res.sendFile(htmlPath);
  });

  // Auth Endpoints
  app.post("/api/login", (req, res) => {
    const { password } = req.body;
    if (auth.verifyPassword(password)) {
      if (auth.mustChange()) {
        res.json({ success: true, mustChange: true });
      } else {
        const token = auth.createSession();
        res.cookie('session', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days
        res.json({ success: true, mustChange: false });
      }
    } else {
      res.status(401).json({ error: "Invalid password" });
    }
  });

  app.post("/api/change-password", (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!auth.verifyPassword(currentPassword)) {
      return res.status(401).json({ error: "Current password incorrect" });
    }
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: "New password too short" });
    }
    const token = auth.changePassword(newPassword);
    res.cookie('session', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true });
  });

  app.post("/api/logout", (req, res) => {
    auth.clearSession();
    res.clearCookie('session');
    res.json({ success: true });
  });

  // Auth Middleware for protected routes
  const requireAuth = (req, res, next) => {
    // Exempt static files
    if (req.path.startsWith('/static/')) return next();
    
    const isApi = req.path.startsWith('/api/') || req.path === '/upload' || req.path === '/health';

    if (auth.mustChange()) {
      // If they haven't changed the default password, force them to login page
      if (isApi) return res.status(403).json({ error: "Password change required" });
      return res.redirect('/login?change=true');
    }

    const token = req.cookies.session;
    if (!auth.verifySession(token)) {
      if (isApi) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return res.redirect('/login');
    }
    next();
  };

  app.use(requireAuth);

  // Health
  app.get("/health", (req, res) => {
    const uptimeMs = Date.now() - _startTime;
    const totalSecs = Math.floor(uptimeMs / 1000);
    const d = Math.floor(totalSecs / 86400);
    const h = Math.floor((totalSecs % 86400) / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const { ACTIVE_PROFILE, ACTIVE_ACCOUNT_EMAIL } = require("./helpers");
    res.json({
      status: "ok",
      bot: _botInfo?.username || _botInfo?.first_name || "unknown",
      connected: !!_botInfo,
      profile:
        (typeof ACTIVE_PROFILE === "function"
          ? ACTIVE_PROFILE()
          : ACTIVE_PROFILE) || "none",
      email:
        (typeof ACTIVE_ACCOUNT_EMAIL === "function"
          ? ACTIVE_ACCOUNT_EMAIL()
          : ACTIVE_ACCOUNT_EMAIL) || null,
      uptime: `${d}d ${h}h ${m}m ${s}s`,
      uptimeSec: totalSecs,
    });
  });

  // GET /api/profiles — list available cookie profiles
  app.get("/api/profiles", async (req, res) => {
    try {
      const { getAvailableCookieProfiles, ACTIVE_PROFILE } = require("./helpers");
      const profiles = await getAvailableCookieProfiles();
      const active = typeof ACTIVE_PROFILE === "function" ? ACTIVE_PROFILE() : ACTIVE_PROFILE;
      res.json({ profiles, active: active || "none" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/profiles/switch — switch active cookie profile
  app.post("/api/profiles/switch", async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Profile name required" });
    try {
      const { fetchMagicCookies, ACTIVE_PROFILE, ACTIVE_ACCOUNT_EMAIL } = require("./helpers");
      const ok = await fetchMagicCookies(name);
      if (!ok) return res.status(502).json({ error: "Failed to fetch cookies for " + name });
      const profile = typeof ACTIVE_PROFILE === "function" ? ACTIVE_PROFILE() : ACTIVE_PROFILE;
      const email = typeof ACTIVE_ACCOUNT_EMAIL === "function" ? ACTIVE_ACCOUNT_EMAIL() : ACTIVE_ACCOUNT_EMAIL;
      res.json({ success: true, profile, email });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Upload page
  app.get("/", (req, res) => {
    const htmlPath = path.join(STATIC_DIR, "upload.html");
    if (!fs.existsSync(htmlPath))
      return res.status(404).send("Upload page not found");
    res.sendFile(htmlPath);
  });

  // Static files
  app.get("/static/:filename", (req, res) => {
    const filePath = path.join(STATIC_DIR, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
    res.sendFile(filePath);
  });

  // Upload NZB
  app.post("/upload", (req, res) => {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE")
          return res.status(413).json({ error: "File too large (max 100MB)" });
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const filename = req.file.filename;
      const size = req.file.size;

      // Send to Telegram log channel logic moved to MagicNZB upload per user request

      res.json({
        message: `Uploaded ${filename} (${size} bytes)`,
        filename,
        size,
      });
    });
  });

  // List files
  app.get("/files", (req, res) => {
    if (!fs.existsSync(DOWNLOAD_DIR)) return res.json([]);
    const files = fs
      .readdirSync(DOWNLOAD_DIR)
      .filter((f) => f.toLowerCase().endsWith(".nzb"))
      .map((f) => {
        const fpath = path.join(DOWNLOAD_DIR, f);
        try {
          const stat = fs.statSync(fpath);
          return { name: f, size: stat.size, mtime: stat.mtimeMs / 1000 };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  });

  // Delete file
  app.delete("/files/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(DOWNLOAD_DIR, filename);
    if (!fs.existsSync(filepath))
      return res.status(404).json({ error: "File not found" });
    try {
      fs.unlinkSync(filepath);
      res.json({ message: `Deleted ${filename}` });
    } catch (e) {
      res.status(500).json({ error: `Failed to delete: ${e.message}` });
    }
  });

  // Rename file
  app.put("/files/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    let newName = req.body?.new_name;
    if (!newName)
      return res.status(400).json({ error: "New name required in JSON body" });
    newName = path.basename(newName);
    if (!newName.toLowerCase().endsWith(".nzb")) newName += ".nzb";

    const oldPath = path.join(DOWNLOAD_DIR, filename);
    const newPath = path.join(DOWNLOAD_DIR, newName);

    if (!fs.existsSync(oldPath))
      return res.status(404).json({ error: "File not found" });
    if (
      fs.existsSync(newPath) &&
      oldPath.toLowerCase() !== newPath.toLowerCase()
    ) {
      return res
        .status(409)
        .json({ error: "File with new name already exists" });
    }

    try {
      fs.renameSync(oldPath, newPath);
      res.json({ message: `Renamed to ${newName}`, new_name: newName });
    } catch (e) {
      res.status(500).json({ error: `Failed to rename: ${e.message}` });
    }
  });

  // Smart rename
  app.post("/smart-rename/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    const oldPath = path.join(DOWNLOAD_DIR, filename);
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: "File not found" });

    const baseName = filename.replace(/\.nzb$/i, "");
    
    let newName = baseName
      .replace(/[\.\-\s]?\b(XXX|1080p?|2160p?|720p?|480p?|360p?|4K|8K|HD|FHD|UHD|MP4|MKV|AVI|WRB|WEBRip|WEB-DL|WEB|HDRip|BluRay|BRRip|BDRip|xVid|DivX|H\.?264|H\.?265|x\.?264|x\.?265|HEVC)\b/gi, "")
      .replace(/\.{2,}/g, ".")
      .replace(/[\.\-\s]+$/, "")
      .trim();
    
    newName = newName + ".nzb";
    
    if (newName === filename) {
       return res.json({ message: "No tags found to strip", new_name: filename });
    }

    const newPath = path.join(DOWNLOAD_DIR, newName);
    if (fs.existsSync(newPath) && newPath.toLowerCase() !== oldPath.toLowerCase()) {
      return res.status(409).json({ error: "File with the cleaned name already exists" });
    }

    try {
      fs.renameSync(oldPath, newPath);
      res.json({ message: `Smart renamed to ${newName}`, new_name: newName });
    } catch (e) {
      res.status(500).json({ error: `Failed to smart rename: ${e.message}` });
    }
  });

  // Clear all files
  app.delete("/files", (req, res) => {
    if (!fs.existsSync(DOWNLOAD_DIR))
      return res.json({ message: "Directory empty" });
    let count = 0,
      errors = 0;
    for (const f of fs.readdirSync(DOWNLOAD_DIR)) {
      if (f.toLowerCase().endsWith(".nzb")) {
        try {
          fs.unlinkSync(path.join(DOWNLOAD_DIR, f));
          count++;
        } catch (_) {
          errors++;
        }
      }
    }
    if (errors > 0)
      return res.status(207).json({
        message: `Deleted ${count} files, failed to delete ${errors} files`,
      });
    res.json({ message: `Cleared ${count} files` });
  });

  // Upload to MagicNZB
  app.post("/upload-to-magic/:filename", async (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(DOWNLOAD_DIR, filename);
    if (!fs.existsSync(filepath))
      return res.status(404).json({ error: "File not found" });

    try {
      const { MAGIC_COOKIES: getCookies } = require("./helpers");
      const MagicClient = require("../client");
      const fileContent = fs.readFileSync(filepath);
      const client = new MagicClient(getCookies());
      const result = await client.uploadNzb(fileContent, filename);

      if (result?.status === "success") {
        // Send to Telegram log channel + index in DB (independent steps)
        let logMsgId = 0;
        const { LOG_GROUP_ID } = require("./helpers");

        if (_bot && LOG_GROUP_ID) {
          try {
            const { InputFile } = require("grammy");
            const logMsg = await _bot.api.sendDocument(
              LOG_GROUP_ID,
              new InputFile(fileContent, filename),
              {
                caption: `<code>${filename}</code>`,
                parse_mode: "HTML",
              },
            );
            logMsgId = logMsg.message_id;
            console.log(`[NZB] Sent to log channel: ${filename} (msg_id: ${logMsgId})`);
          } catch (e) {
            console.error("[NZB] Failed to send to log channel:", e.message);
          }
        } else {
          console.warn(`[NZB] Skipping log channel (bot: ${!!_bot}, LOG_GROUP_ID: ${LOG_GROUP_ID})`);
        }

        // Always index in DB regardless of log channel result
        try {
          const nzbDb = require("../nzb/db");
          const { extractKeywords } = require("../nzb/utils");
          const { markDirty } = require("../nzb/backup");
          nzbDb.insertFile({
            msg_id: logMsgId,
            file_name: filename,
            caption: filename,
            keywords: extractKeywords(filename, filename),
            file_type: "nzb",
          });
          markDirty();
          try { require("../handlers/nzb").clearSearchCache(); } catch (_) {}
          console.log(`[NZB] Indexed (web): ${filename}`);
        } catch (dbErr) {
          console.error("[NZB] DB index error (web):", dbErr.message);
        }

        res.json({
          status: "success",
          message: `Uploaded ${filename} to MagicNZB`,
        });
      } else {
        const err = result?.error || "Unknown error";
        res.status(502).json({ error: err });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Account info
  app.get("/account-info", (req, res) => {
    if (Object.keys(_accountInfo).length) return res.json(_accountInfo);
    res.status(503).json({ error: "Account info not available" });
  });

  // ─── Transfers API ────────────────────────────────────────────────────────────

  // GET /api/transfers — fetch all transfers (running, queued, finished, error)
  app.get("/api/transfers", async (req, res) => {
    try {
      const { MAGIC_COOKIES: getCookies } = require("./helpers");
      const MagicClient = require("../client");
      const client = new MagicClient(getCookies());
      const data = await client.fetchTransfers();
      if (data?.error && typeof data.error === "string") {
        return res.status(502).json({ error: data.error });
      }
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/transfers/:id — delete a single transfer
  app.delete("/api/transfers/:id", async (req, res) => {
    try {
      const { MAGIC_COOKIES: getCookies } = require("./helpers");
      const MagicClient = require("../client");
      const client = new MagicClient(getCookies());
      const success = await client.deleteTransfer(req.params.id);
      if (success) {
        res.json({ message: "Deleted" });
      } else {
        res.status(500).json({ error: "Failed to delete" });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/transfers/:id/contents — get folder contents for a finished transfer
  app.get("/api/transfers/:id/contents", async (req, res) => {
    try {
      const { MAGIC_COOKIES: getCookies } = require("./helpers");
      const MagicClient = require("../client");
      const client = new MagicClient(getCookies());
      const data = await client.getFolderContents(req.params.id);
      if (!data) {
        return res.status(404).json({ error: "Could not fetch contents" });
      }

      // Normalize file list
      let files = [];
      if (typeof data === "object") {
        if (data.content) files = data.content;
        else if (data.files) {
          files = Array.isArray(data.files)
            ? data.files
            : data.files.content || [];
        }
      }

      // Filter to video files, exclude samples
      const filtered = [];
      for (const f of files) {
        const name = (typeof f === "string" ? f : f.name || "").trim();
        const link =
          typeof f === "object" ? f.link || f.directlink || f.url || "" : "";
        const size =
          typeof f === "object" ? f.size || f.fileSize || f.file_size : null;

        if (!name.match(/\.(mp4|mkv)$/i)) continue;
        if (/sample/i.test(name)) continue;
        if (link && /sample/i.test(link)) continue;

        filtered.push({ name, size, link });
      }

      res.json({ files: filtered, total: filtered.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Log Search API ───────────────────────────────────────────────────────────

  // GET /api/logs?q=<query> — full-text search the NZB index
  app.get("/api/logs", (req, res) => {
    const rawQuery = (req.query.q || "").trim();

    try {
      const nzbDb = require("../nzb/db");
      const { LOG_GROUP_ID: logGroupId } = require("./helpers");
      let results = [];

      if (!rawQuery || rawQuery.length < 2) {
        // Return recent logs if no query
        results = nzbDb.getRecent(50);
      } else {
        const { normalizeQuery } = require("../nzb/utils");
        const ftsQuery = normalizeQuery(rawQuery);
        if (!ftsQuery) {
          return res.status(400).json({ error: "Invalid query" });
        }
        results = nzbDb.search(ftsQuery, 1000);
      }

      // Build message links
      const enriched = results.map((r) => {
        const stripped = String(Math.abs(logGroupId)).replace(/^100/, "");
        return {
          msg_id: r.msg_id,
          file_name: r.file_name,
          caption: r.caption,
          uploaded_at: r.uploaded_at,
          link: `https://t.me/c/${stripped}/${r.msg_id}`,
        };
      });

      res.json({ results: enriched, total: enriched.length, query: rawQuery });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/logs/stats — NZB index stats
  app.get("/api/logs/stats", (req, res) => {
    try {
      const nzbDb = require("../nzb/db");
      const total = nzbDb.getCount();
      res.json({ total });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/grab/:msg_id — grab an NZB from the log channel and upload to MagicNZB
  app.post("/api/grab/:msg_id", async (req, res) => {
    const msgId = parseInt(req.params.msg_id, 10);
    if (isNaN(msgId)) {
      return res.status(400).json({ error: "Invalid message ID" });
    }

    try {
      const nzbDb = require("../nzb/db");
      const { LOG_GROUP_ID: logGroupId, MAGIC_COOKIES: getCookies } = require("./helpers");
      const MagicClient = require("../client");
      const axios = require("axios");

      // Look up the file in the DB
      const record = nzbDb.getByMsgId(msgId);
      const uploadName = (record?.caption?.trim()) || record?.file_name || `nzb_${msgId}.nzb`;
      const displayName = uploadName.toLowerCase().endsWith(".nzb")
        ? uploadName
        : uploadName + ".nzb";

      if (!_bot || !logGroupId) {
        return res.status(503).json({ error: "Bot or log channel not configured" });
      }

      // Forward from log channel to get the document (we'll use a temp chat approach)
      // Since we can't forward to a web request, we download via Bot API
      // First, we need to get the file from the log channel message
      let doc = null;
      let fwdMsgId = null;

      try {
        // Copy to a temp destination (the log channel itself) to get file_id
        // Actually, we can just use getChat + getMessage approach
        // The simplest: forward to the same log channel, grab file, delete
        const fwd = await _bot.api.forwardMessage(logGroupId, logGroupId, msgId);
        doc = fwd.document;
        fwdMsgId = fwd.message_id;

        // Clean up forwarded message
        if (fwdMsgId) {
          try { await _bot.api.deleteMessage(logGroupId, fwdMsgId); } catch (_) {}
        }
      } catch (e) {
        return res.status(500).json({ error: `Failed to retrieve file: ${e.message}` });
      }

      if (!doc) {
        return res.status(404).json({ error: "Message has no document attached" });
      }

      // Download the file content
      const fileObj = await _bot.api.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileObj.file_path}`;
      const dlRes = await axios.get(fileUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
      });
      const fileContent = Buffer.from(dlRes.data);

      // Upload to MagicNZB
      const client = new MagicClient(getCookies());
      const result = await client.uploadNzb(fileContent, displayName);

      if (result?.status === "success") {
        res.json({ status: "success", message: `Uploaded ${displayName}` });
      } else {
        const error = result?.error || "Unknown error";
        res.status(502).json({ error });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/logs/:msg_id/rename — rename a log entry in DB + Telegram caption
  app.put("/api/logs/:msg_id/rename", async (req, res) => {
    const msgId = parseInt(req.params.msg_id, 10);
    if (isNaN(msgId)) {
      return res.status(400).json({ error: "Invalid message ID" });
    }

    let newName = (req.body?.new_name || "").trim();
    if (!newName) {
      return res.status(400).json({ error: "New name is required" });
    }
    if (!newName.toLowerCase().endsWith(".nzb")) newName += ".nzb";

    try {
      const nzbDb = require("../nzb/db");
      const { extractKeywords } = require("../nzb/utils");
      const { LOG_GROUP_ID: logGroupId } = require("./helpers");
      const { markDirty } = require("../nzb/backup");

      const record = nzbDb.getByMsgId(msgId);
      if (!record) {
        return res.status(404).json({ error: "Log entry not found" });
      }

      // 1. Try to update the Telegram log channel caption
      let telegramOk = false;
      if (_bot && logGroupId && msgId > 0) {
        try {
          await _bot.api.editMessageCaption(logGroupId, msgId, {
            caption: `<code>${newName}</code>`,
            parse_mode: "HTML",
          });
          telegramOk = true;
          console.log(`[NZB] Renamed in log channel: msg_id=${msgId} → ${newName}`);
        } catch (e) {
          console.error(`[NZB] Failed to edit log channel caption (msg_id=${msgId}):`, e.message);
        }
      }

      // 2. Always update local DB
      const newKeywords = extractKeywords(newName, newName);
      const result = nzbDb.updateFile(msgId, newName, newKeywords);
      markDirty();
      try { require("../handlers/nzb").clearSearchCache(); } catch (_) {}

      res.json({
        success: true,
        new_name: newName,
        telegram_updated: telegramOk,
        db_updated: result.changes > 0,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Frontend Route Aliases (SPA) ─────────────────────────────────────────────

  app.get(["/transfers", "/list", "/log"], (req, res) => {
    const htmlPath = path.join(STATIC_DIR, "upload.html");
    if (!fs.existsSync(htmlPath))
      return res.status(404).send("Page not found");
    res.sendFile(htmlPath);
  });

  app.listen(UPLOAD_PORT, "0.0.0.0", () => {
    console.log(`Web server started on port ${UPLOAD_PORT}`);
  });
}

module.exports = { startWebServer, _accountInfo };
