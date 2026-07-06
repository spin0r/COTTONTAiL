import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { InputFile } from "grammy";
import { MagicClient } from "../client";
import * as auth from "./auth";
import {
  fetchMagicCookies, getMagicCookies, getAvailableCookieProfiles,
  LOG_GROUP_ID, getActiveProfile, getActiveAccountEmail,
} from "./helpers";
import * as nzbDb from "../nzb/db";
import { extractKeywords } from "../nzb/utils";
import { markDirty } from "../nzb/backup";
import { clearSearchCache } from "../handlers/nzb";

const UPLOAD_PORT = parseInt(process.env.PORT ?? process.env.UPLOAD_PORT ?? "10000", 10);
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? "nzb_downloads";
const FRONTEND_DIST = path.join(__dirname, "..", "..", "frontend", "dist");
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

let _bot: any = null;
const _accountInfo: Record<string, any> = {};
const _startTime = Date.now();
let _botInfo: any = null;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    cb(null, DOWNLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    cb(null, path.basename(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".nzb")) {
      return cb(new Error("Only .nzb files are allowed"));
    }
    cb(null, true);
  },
});

// Simple cookie parser middleware
function cookieParser(req: Request, _res: Response, next: NextFunction): void {
  const cookieHeader = req.headers.cookie;
  (req as any).cookies = {};
  if (cookieHeader) {
    cookieHeader.split(";").forEach((cookie) => {
      const parts = cookie.split("=");
      if (parts.length >= 2) {
        (req as any).cookies[parts.shift()!.trim()] = decodeURIComponent(parts.join("="));
      }
    });
  }
  next();
}

const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.path.startsWith("/static/") || req.path.startsWith("/assets/")) return next();
  const isApi = req.path.startsWith("/api/") || req.path === "/upload";

  if (auth.mustChange()) {
    if (isApi) { res.status(403).json({ error: "Password change required" }); return; }
    res.redirect("/login?change=true");
    return;
  }

  const token = (req as any).cookies?.session;
  if (!auth.verifySession(token)) {
    if (isApi) { res.status(401).json({ error: "Unauthorized" }); return; }
    res.redirect("/login");
    return;
  }
  next();
};

export async function startWebServer(bot: any): Promise<void> {
  _bot = bot;

  try { _botInfo = await bot.api.getMe(); }
  catch (e: any) { console.error("Failed to fetch bot info:", e.message); }

  await fetchMagicCookies();

  try {
    const client = new MagicClient(getMagicCookies());
    const info = await client.getAccountInfo();
    if (info) Object.assign(_accountInfo, info);
  } catch (e: any) {
    console.error("Failed to load account info at startup:", e.message);
  }

  const app = express();
  app.use(express.json());
  app.use(cookieParser);

  // Health check (public)
  app.get("/health", (_req, res) => {
    const totalSecs = Math.floor((Date.now() - _startTime) / 1000);
    const d = Math.floor(totalSecs / 86400);
    const h = Math.floor((totalSecs % 86400) / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    res.json({
      status: "ok",
      bot: _botInfo?.username ?? _botInfo?.first_name ?? "unknown",
      connected: !!_botInfo,
      profile: getActiveProfile() || "none",
      email: getActiveAccountEmail() || null,
      uptime: `${d}d ${h}h ${m}m ${s}s`,
      uptimeSec: totalSecs,
    });
  });

  // Login page (public)
  app.get("/login", (_req, res) => {
    if (fs.existsSync(FRONTEND_DIST)) {
      res.sendFile(path.join(FRONTEND_DIST, "index.html"));
    } else {
      res.status(404).send("Login page not found");
    }
  });

  // Auth endpoints (public)
  app.post("/api/login", (req, res) => {
    const { password } = req.body as { password: string };
    if (auth.verifyPassword(password)) {
      if (auth.mustChange()) {
        res.json({ success: true, mustChange: true });
      } else {
        const token = auth.createSession();
        res.cookie("session", token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.json({ success: true, mustChange: false });
      }
    } else {
      res.status(401).json({ error: "Invalid password" });
    }
  });

  app.post("/api/change-password", (req, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    if (!auth.verifyPassword(currentPassword)) { res.status(401).json({ error: "Current password incorrect" }); return; }
    if (!newPassword || newPassword.length < 1) { res.status(400).json({ error: "New password too short" }); return; }
    const token = auth.changePassword(newPassword);
    res.cookie("session", token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true });
  });

  app.post("/api/logout", (req, res) => {
    auth.clearSession((req as any).cookies?.session);
    res.clearCookie("session");
    res.json({ success: true });
  });

  app.use(requireAuth);

  // Auth check — returns 200 if session is valid, 401 otherwise (handled by requireAuth above)
  app.get("/api/auth-check", (_req, res) => res.json({ ok: true }));

  // Serve Vite frontend dist (SPA fallback)
  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    app.get("/", (_req, res) => res.sendFile(path.join(FRONTEND_DIST, "index.html")));
    app.get(["/transfers", "/list", "/log", "/account"], (_req, res) =>
      res.sendFile(path.join(FRONTEND_DIST, "index.html"))
    );
  }

  // Profiles
  app.get("/api/profiles", async (_req, res) => {
    try {
      const profiles = await getAvailableCookieProfiles();
      res.json({ profiles, active: getActiveProfile() || "none" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/profiles/switch", async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) { res.status(400).json({ error: "Profile name required" }); return; }
    try {
      const ok = await fetchMagicCookies(name);
      if (!ok) { res.status(502).json({ error: "Failed to fetch cookies for " + name }); return; }
      res.json({ success: true, profile: getActiveProfile(), email: getActiveAccountEmail() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // File upload
  app.post("/upload", (req, res) => {
    upload.single("file")(req, res, async (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large (max 100MB)" });
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      res.json({ message: `Uploaded ${req.file.filename} (${req.file.size} bytes)`, filename: req.file.filename, size: req.file.size });
    });
  });

  // File list
  app.get("/files", (_req, res) => {
    if (!fs.existsSync(DOWNLOAD_DIR)) return res.json([]);
    const files = fs.readdirSync(DOWNLOAD_DIR)
      .filter((f) => f.toLowerCase().endsWith(".nzb"))
      .map((f) => {
        const fpath = path.join(DOWNLOAD_DIR, f);
        try { const stat = fs.statSync(fpath); return { name: f, size: stat.size, mtime: stat.mtimeMs / 1000 }; }
        catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.mtime - a.mtime);
    res.json(files);
  });

  app.delete("/files/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(DOWNLOAD_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: "File not found" });
    try { fs.unlinkSync(filepath); res.json({ message: `Deleted ${filename}` }); }
    catch (e: any) { res.status(500).json({ error: `Failed to delete: ${e.message}` }); }
  });

  app.put("/files/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    let newName = (req.body as any)?.new_name as string | undefined;
    if (!newName) return res.status(400).json({ error: "New name required in JSON body" });
    newName = path.basename(newName);
    if (!newName.toLowerCase().endsWith(".nzb")) newName += ".nzb";
    const oldPath = path.join(DOWNLOAD_DIR, filename);
    const newPath = path.join(DOWNLOAD_DIR, newName);
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: "File not found" });
    if (fs.existsSync(newPath) && oldPath.toLowerCase() !== newPath.toLowerCase()) {
      return res.status(409).json({ error: "File with new name already exists" });
    }
    try { fs.renameSync(oldPath, newPath); res.json({ message: `Renamed to ${newName}`, new_name: newName }); }
    catch (e: any) { res.status(500).json({ error: `Failed to rename: ${e.message}` }); }
  });

  app.delete("/files", (_req, res) => {
    if (!fs.existsSync(DOWNLOAD_DIR)) return res.json({ message: "Directory empty" });
    let count = 0, errors = 0;
    for (const f of fs.readdirSync(DOWNLOAD_DIR)) {
      if (f.toLowerCase().endsWith(".nzb")) {
        try { fs.unlinkSync(path.join(DOWNLOAD_DIR, f)); count++; } catch (_) { errors++; }
      }
    }
    if (errors > 0) return res.status(207).json({ message: `Deleted ${count} files, failed to delete ${errors} files` });
    res.json({ message: `Cleared ${count} files` });
  });

  // Upload to MagicNZB
  app.post("/upload-to-magic/:filename", async (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(DOWNLOAD_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: "File not found" });

    try {
      const fileContent = fs.readFileSync(filepath);
      const client = new MagicClient(getMagicCookies());
      const result = await client.uploadNzb(fileContent, filename);

      if (result?.status === "success") {
        let logMsgId = 0;
        if (_bot && LOG_GROUP_ID) {
          try {
            const logMsg = await _bot.api.sendDocument(LOG_GROUP_ID, new InputFile(fileContent, filename), { caption: `<code>${filename}</code>`, parse_mode: "HTML" });
            logMsgId = logMsg.message_id;
          } catch (e: any) { console.error("[NZB] Failed to send to log channel:", e.message); }
        }
        try {
          nzbDb.insertFile({ msg_id: logMsgId, file_name: filename, caption: filename, keywords: extractKeywords(filename, filename), file_type: "nzb" });
          markDirty();
          try { clearSearchCache(); } catch (_) {}
        } catch (dbErr: any) { console.error("[NZB] DB index error (web):", dbErr.message); }
        res.json({ status: "success", message: `Uploaded ${filename} to MagicNZB` });
      } else {
        res.status(502).json({ error: result?.error ?? "Unknown error" });
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Upload to log group only
  app.post("/upload-to-log/:filename", async (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(DOWNLOAD_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: "File not found" });
    if (!_bot || !LOG_GROUP_ID) return res.status(503).json({ error: "Bot or log channel not configured" });

    try {
      const fileContent = fs.readFileSync(filepath);
      const logMsg = await _bot.api.sendDocument(LOG_GROUP_ID, new InputFile(fileContent, filename), { caption: `<code>${filename}</code>`, parse_mode: "HTML" });
      const logMsgId = logMsg.message_id;
      try {
        nzbDb.insertFile({ msg_id: logMsgId, file_name: filename, caption: filename, keywords: extractKeywords(filename, filename), file_type: "nzb" });
        markDirty();
        try { clearSearchCache(); } catch (_) {}
      } catch (dbErr: any) { console.error("[NZB] DB index error (direct log):", dbErr.message); }
      res.json({ status: "success", message: `Sent ${filename} to log group` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Account
  app.get("/api/account", async (_req, res) => {
    try {
      const client = new MagicClient(getMagicCookies());
      const info = await client.getAccountInfo();
      if (info) { Object.assign(_accountInfo, info); res.json(info); }
      else { res.status(503).json({ error: "Could not fetch account info" }); }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/account/renew", async (_req, res) => {
    try {
      const client = new MagicClient(getMagicCookies());
      const result = await client.renewFreeTrial();
      if ((result as any)?.error) { res.status(502).json({ error: (result as any).error }); return; }
      const info = await client.getAccountInfo();
      if (info) Object.assign(_accountInfo, info);
      res.json({ success: true, result, account: info || _accountInfo });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Transfers API
  app.get("/api/transfers", async (_req, res) => {
    try {
      const client = new MagicClient(getMagicCookies());
      const data = await client.fetchTransfers();
      if ((data as any)?.error && typeof (data as any).error === "string") return res.status(502).json({ error: (data as any).error });
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/transfers/:id", async (req, res) => {
    try {
      const client = new MagicClient(getMagicCookies());
      const success = await client.deleteTransfer(req.params.id);
      if (success) res.json({ message: "Deleted" });
      else res.status(500).json({ error: "Failed to delete" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/transfers/:id/contents", async (req, res) => {
    try {
      const client = new MagicClient(getMagicCookies());

      // First fetch the transfer list to find the folder_id for this transfer
      const transfers = await client.fetchTransfers();
      const allTransfers = [
        ...((transfers as any).running || []),
        ...((transfers as any).queued || []),
        ...((transfers as any).finished || []),
        ...((transfers as any).error || []),
      ];
      const transfer = allTransfers.find((t: any) => t.id === req.params.id);
      const folderId = transfer?.folder_id || req.params.id;

      const data = await client.getFolderContents(folderId);
      if (!data) return res.status(404).json({ error: "Could not fetch contents" });
      let files: any[] = [];
      if (typeof data === "object") {
        if ((data as any).content) files = (data as any).content;
        else if ((data as any).files) {
          files = Array.isArray((data as any).files) ? (data as any).files : (data as any).files.content ?? [];
        }
      }
      const allFiles = files.map((f: any) => {
        const name = (typeof f === "string" ? f : f.name ?? "").trim();
        const link = typeof f === "object" ? (f.link ?? f.directlink ?? f.url ?? "") : "";
        const size = typeof f === "object" ? (f.size ?? f.fileSize ?? f.file_size ?? null) : null;
        if (!name) return null;
        return { name, size, link };
      }).filter(Boolean);
      res.json({ files: allFiles, total: allFiles.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Logs API
  app.get("/api/logs", (req, res) => {
    const rawQuery = ((req.query.q as string) ?? "").trim();
    try {
      let results: any[];
      if (!rawQuery || rawQuery.length < 2) {
        results = nzbDb.getRecent(50);
      } else {
        const { normalizeQuery } = require("../nzb/utils");
        const ftsQuery = normalizeQuery(rawQuery);
        if (!ftsQuery) return res.status(400).json({ error: "Invalid query" });
        results = nzbDb.search(ftsQuery, 1000);
      }
      const enriched = results.map((r: any) => {
        const stripped = String(Math.abs(LOG_GROUP_ID ?? 0)).replace(/^100/, "");
        return { msg_id: r.msg_id, file_name: r.file_name, caption: r.caption, uploaded_at: r.uploaded_at, link: `https://t.me/c/${stripped}/${r.msg_id}` };
      });
      res.json({ results: enriched, total: enriched.length, query: rawQuery });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/logs/stats", (_req, res) => {
    try { res.json({ total: nzbDb.getCount() }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/grab/:msg_id", async (req, res) => {
    const msgId = parseInt(req.params.msg_id, 10);
    if (isNaN(msgId)) return res.status(400).json({ error: "Invalid message ID" });
    if (!_bot || !LOG_GROUP_ID) return res.status(503).json({ error: "Bot or log channel not configured" });

    try {
      const record = nzbDb.getByMsgId(msgId);
      const uploadName = (record?.caption?.trim()) || record?.file_name || `nzb_${msgId}.nzb`;
      const displayName = uploadName.toLowerCase().endsWith(".nzb") ? uploadName : uploadName + ".nzb";

      const fwd = await _bot.api.forwardMessage(LOG_GROUP_ID, LOG_GROUP_ID, msgId);
      const doc = fwd.document;
      const fwdMsgId = fwd.message_id;
      if (fwdMsgId) { try { await _bot.api.deleteMessage(LOG_GROUP_ID, fwdMsgId); } catch (_) {} }
      if (!doc) return res.status(404).json({ error: "Message has no document attached" });

      const fileObj = await _bot.api.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileObj.file_path}`;
      const dlRes = await axios.get(fileUrl, { responseType: "arraybuffer", timeout: 60000 });
      const fileContent = Buffer.from(dlRes.data as ArrayBuffer);

      const client = new MagicClient(getMagicCookies());
      const result = await client.uploadNzb(fileContent, displayName);
      if (result?.status === "success") res.json({ status: "success", message: `Uploaded ${displayName}` });
      else res.status(502).json({ error: result?.error ?? "Unknown error" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/logs/:msg_id/rename", async (req, res) => {
    const msgId = parseInt(req.params.msg_id, 10);
    if (isNaN(msgId)) return res.status(400).json({ error: "Invalid message ID" });
    let newName = ((req.body as any)?.new_name ?? "").trim();
    if (!newName) return res.status(400).json({ error: "New name is required" });
    if (!newName.toLowerCase().endsWith(".nzb")) newName += ".nzb";

    try {
      const record = nzbDb.getByMsgId(msgId);
      if (!record) return res.status(404).json({ error: "Log entry not found" });

      let telegramOk = false;
      if (_bot && LOG_GROUP_ID && msgId > 0) {
        try { await _bot.api.editMessageCaption(LOG_GROUP_ID, msgId, { caption: `<code>${newName}</code>`, parse_mode: "HTML" }); telegramOk = true; }
        catch (e: any) { console.error(`[NZB] Caption update failed (msg_id=${msgId}):`, e.message); }
      }

      const newKeywords = extractKeywords(newName, newName);
      const result = nzbDb.updateFile(msgId, newName, newKeywords);
      markDirty();
      try { clearSearchCache(); } catch (_) {}

      res.json({ success: true, new_name: newName, telegram_updated: telegramOk, db_updated: result.changes > 0 });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/logs/:msg_id/ai-rename", async (req, res) => {
    const msgId = parseInt(req.params.msg_id, 10);
    if (isNaN(msgId)) return res.status(400).json({ error: "Invalid message ID" });

    try {
      const record = nzbDb.getByMsgId(msgId);
      if (!record) return res.status(404).json({ error: "Log entry not found" });

      const currentName = (record.caption?.trim()) || record.file_name || "";
      if (!currentName) return res.status(400).json({ error: "No filename found for this entry" });

      const inputName = currentName.replace(/\.nzb$/i, "");
      const aiRes = await axios.post("https://v2-vl42.onrender.com/api/ai-rename", { text: inputName }, { headers: { "Content-Type": "application/json" }, timeout: 30000 });
      const aiData = aiRes.data as { ok: boolean; result?: string; error?: string };
      if (!aiData?.ok || !aiData.result) return res.status(502).json({ error: aiData?.error ?? "AI rename failed" });

      let newName = aiData.result.trim();
      if (!newName.toLowerCase().endsWith(".nzb")) newName += ".nzb";

      nzbDb.updateFile(msgId, newName, extractKeywords(newName, newName));
      markDirty();
      try { clearSearchCache(); } catch (_) {}

      let telegramOk = false;
      if (_bot && LOG_GROUP_ID && msgId > 0) {
        try { await _bot.api.editMessageCaption(LOG_GROUP_ID, msgId, { caption: `<code>${newName}</code>`, parse_mode: "HTML" }); telegramOk = true; }
        catch (e: any) { console.error(`[AI-RENAME] Caption update failed (msg_id=${msgId}):`, e.message); }
      }

      res.json({ success: true, old_name: currentName, new_name: newName, telegram_updated: telegramOk });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/logs/:msg_id", async (req, res) => {
    const msgId = parseInt(req.params.msg_id, 10);
    if (isNaN(msgId)) return res.status(400).json({ error: "Invalid message ID" });

    try {
      const record = nzbDb.getByMsgId(msgId);
      if (!record) return res.status(404).json({ error: "Log entry not found" });

      let telegramOk = false;
      if (_bot && LOG_GROUP_ID && msgId > 0) {
        try { await _bot.api.deleteMessage(LOG_GROUP_ID, msgId); telegramOk = true; }
        catch (e: any) { console.error(`[NZB] Failed to delete from log channel (msg_id=${msgId}):`, e.message); }
      }

      const result = nzbDb.deleteByMsgId(msgId);
      markDirty();
      try { clearSearchCache(); } catch (_) {}

      res.json({ success: true, telegram_deleted: telegramOk, db_deleted: result.changes > 0 });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.listen(UPLOAD_PORT, "0.0.0.0", () => {
    console.log(`Web server started on port ${UPLOAD_PORT}`);
  });
}

export { _accountInfo };
