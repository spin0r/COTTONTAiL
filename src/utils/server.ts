import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { InputFile } from "grammy";
import { MagicClient } from "../client";
import * as auth from "./auth";
import { log } from "./logger";
import {
  fetchMagicCookies, getMagicCookies, getAvailableCookieProfiles,
  LOG_GROUP_ID, getActiveProfile, getActiveAccountEmail,
} from "./helpers";
import * as nzbDb from "../nzb/db";
import { extractKeywords } from "../nzb/utils";
import { markDirty } from "../nzb/backup";
import { clearSearchCache } from "../handlers/nzb";
import { userbotDeleteMessage, isUserbotConfigured } from "./userbot";

const UPLOAD_PORT = parseInt(process.env.PORT ?? process.env.UPLOAD_PORT ?? "10000", 10);
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? "nzb_downloads";
const FRONTEND_DIST = path.join(__dirname, "..", "..", "frontend", "dist");
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

let _bot: any = null;
const _accountInfo: Record<string, any> = {};
const _startTime = Date.now();
let _botInfo: any = null;

// ─── Parse provider-prefix thumbnail token from a filename ───────────────────
// Supported formats (prefix is the first space-delimited token):
//
//   DS_<hash>_thumb.jpg  Title.nzb   → https://drunkenslug.com/covers/sample/<hash>_thumb.jpg
//   TR_<hash>_thumb.jpg  Title.nzb   → https://www.tabula-rasa.pw/covers/sample/<hash>_thumb.jpg
//   https://...          Title.nzb   → plain URL (passed through as-is)
//
function resolveThumbPrefix(prefix: string): string | null {
  if (prefix.startsWith("DS_")) return `https://drunkenslug.com/covers/sample/${prefix.slice(3)}`;
  if (prefix.startsWith("TR_")) return `https://www.tabula-rasa.pw/covers/sample/${prefix.slice(3)}`;
  if (/^https?:\/\//i.test(prefix)) return prefix;
  return null;
}

function parseFilenamePrefix(original: string): { thumbUrl: string | null; nzbName: string } {
  const trimmed = original.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx > 0) {
    const prefix = trimmed.slice(0, spaceIdx);
    const rest = trimmed.slice(spaceIdx + 1).trim();
    if (rest.toLowerCase().endsWith(".nzb")) {
      const thumbUrl = resolveThumbPrefix(prefix);
      if (thumbUrl) return { thumbUrl, nzbName: rest };
    }
  }
  return { thumbUrl: null, nzbName: path.basename(trimmed) };
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    cb(null, DOWNLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // Strip any encoded/plain URL prefix — save only the clean .nzb name
    const { nzbName } = parseFilenamePrefix(file.originalname);
    cb(null, nzbName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (_req, file, cb) => {
    // Check the actual .nzb name after stripping any URL prefix
    const { nzbName } = parseFilenamePrefix(file.originalname);
    if (!nzbName.toLowerCase().endsWith(".nzb")) {
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
  catch (e: any) { log.error("WEB", `Failed to fetch bot info — ${e.message}`); }

  await fetchMagicCookies();

  try {
    const client = new MagicClient(getMagicCookies());
    const info = await client.getAccountInfo();
    if (info) Object.assign(_accountInfo, info);
  } catch (e: any) {
    log.error("WEB", `Failed to load account info at startup — ${e.message}`);
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
  // Accepts optional `thumbnail_url` text field alongside the .nzb file.
  // If thumbnail_url starts with https?://, the image is downloaded and stored
  // as a custom thumbnail keyed by the file's future msg_id — but at this stage
  // the file hasn't been indexed yet (that happens in /upload-to-log or
  // /upload-to-magic).  We just persist the URL in a temporary side-map so the
  // subsequent action endpoint can pick it up.
  const _pendingThumbUrls = new Map<string, string>(); // filename → thumbnail URL

  app.post("/upload", (req, res) => {
    upload.single("file")(req, res, async (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large (max 100MB)" });
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      // Grab optional thumbnail_url from the multipart form field,
      // or fall back to decoding it from the original filename prefix
      const bodyThumbUrl = (req.body?.thumbnail_url ?? "").trim();
      const { thumbUrl: nameThumbUrl } = parseFilenamePrefix(req.file.originalname ?? "");
      const thumbUrl = bodyThumbUrl || nameThumbUrl || "";
      if (thumbUrl && thumbUrl.startsWith("http")) {
        _pendingThumbUrls.set(req.file.filename, thumbUrl);
      }

      res.json({
        message: `Uploaded ${req.file.filename} (${req.file.size} bytes)`,
        filename: req.file.filename,
        size: req.file.size,
        thumbnail_url: thumbUrl || null,
      });
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

    // Optional thumbnail URL — can come from request body or pending map
    const bodyThumbUrl = ((req.body as any)?.thumbnail_url ?? "").trim();
    const pendingThumbUrl = _pendingThumbUrls.get(filename) ?? "";
    const thumbUrl = bodyThumbUrl || pendingThumbUrl;

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
          } catch (e: any) { log.error("NZB", `Failed to send to log channel — ${e.message}`); }
        }
        try {
          nzbDb.insertFile({ msg_id: logMsgId, file_name: filename, caption: filename, keywords: extractKeywords(filename, filename), file_type: "nzb" });
          markDirty();
          log.nzb(`Indexed: ${filename} (msg_id=${logMsgId}) via MagicNZB`);
          try { clearSearchCache(); } catch (_) {}
        } catch (dbErr: any) { log.error("NZB", `DB index error — ${dbErr.message}`); }

        // Save thumbnail if provided
        if (thumbUrl && logMsgId > 0) {
          try {
            nzbDb.setCustomThumbnail(logMsgId, thumbUrl);
            markDirty();
            log.thumb(`Saved thumbnail URL for msg_id=${logMsgId}: ${thumbUrl}`);
          } catch (thumbErr: any) {
            log.error("THUMB", `Failed to save thumbnail URL for ${filename} — ${thumbErr.message}`);
          }
          _pendingThumbUrls.delete(filename);
        }

        res.json({ status: "success", message: `Uploaded ${filename} to MagicNZB`, msg_id: logMsgId });
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

    // Optional thumbnail URL — from request body or pending upload map
    const bodyThumbUrl = ((req.body as any)?.thumbnail_url ?? "").trim();
    const pendingThumbUrl = _pendingThumbUrls.get(filename) ?? "";
    const thumbUrl = bodyThumbUrl || pendingThumbUrl;

    try {
      const fileContent = fs.readFileSync(filepath);
      const logMsg = await _bot.api.sendDocument(LOG_GROUP_ID, new InputFile(fileContent, filename), { caption: `<code>${filename}</code>`, parse_mode: "HTML" });
      const logMsgId = logMsg.message_id;
      try {
        nzbDb.insertFile({ msg_id: logMsgId, file_name: filename, caption: filename, keywords: extractKeywords(filename, filename), file_type: "nzb" });
        markDirty();
        try { clearSearchCache(); } catch (_) {}
      } catch (dbErr: any) { log.error("NZB", `DB index error — ${dbErr.message}`); }

      // Save thumbnail if provided
      if (thumbUrl) {
        try {
          nzbDb.setCustomThumbnail(logMsgId, thumbUrl);
          markDirty();
          log.thumb(`Saved thumbnail URL for msg_id=${logMsgId}: ${thumbUrl}`);
        } catch (thumbErr: any) {
          log.error("THUMB", `Failed to save thumbnail URL for ${filename} — ${thumbErr.message}`);
        }
        _pendingThumbUrls.delete(filename);
      }

      res.json({ status: "success", message: `Sent ${filename} to log group`, msg_id: logMsgId });
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
        return {
          msg_id: r.msg_id,
          file_name: r.file_name,
          caption: r.caption,
          uploaded_at: r.uploaded_at,
          link: `https://t.me/c/${stripped}/${r.msg_id}`,
          has_custom_thumbnail: nzbDb.hasCustomThumbnail(r.msg_id),
        };
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
        catch (e: any) { log.error("NZB", `Caption update failed (msg_id=${msgId}) — ${e.message}`); }
      }

      const newKeywords = extractKeywords(newName, newName);
      const result = nzbDb.updateFile(msgId, newName, newKeywords);
      markDirty();
      try { clearSearchCache(); } catch (_) {}
      _thumbCache.delete(msgId); // bust thumbnail cache so new caption is used

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

      let newName = aiData.result.trim().replace(/\.nzb$/i, "") + ".nzb";

      nzbDb.updateFile(msgId, newName, extractKeywords(newName, newName));
      markDirty();
      try { clearSearchCache(); } catch (_) {}
      _thumbCache.delete(msgId); // bust thumbnail cache so new caption is used

      let telegramOk = false;
      if (_bot && LOG_GROUP_ID && msgId > 0) {
        try { await _bot.api.editMessageCaption(LOG_GROUP_ID, msgId, { caption: `<code>${newName}</code>`, parse_mode: "HTML" }); telegramOk = true; }
        catch (e: any) { log.error("NZB", `AI rename caption update failed (msg_id=${msgId}) — ${e.message}`); }
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
      let telegramError = "";
      if (LOG_GROUP_ID && msgId > 0) {
        // 1st try: Bot API deleteMessage
        if (_bot) {
          try { await _bot.api.deleteMessage(LOG_GROUP_ID, msgId); telegramOk = true; }
          catch (e: any) {
            const errCode = e?.error_code ?? e?.status ?? e?.code ?? "?";
            const errDesc = e?.description ?? e?.message ?? String(e);
            telegramError = `[${errCode}] ${errDesc}`;
            log.error("NZB", `Bot API delete failed (msg_id=${msgId}) — ${telegramError}`);
          }
        }
        // 2nd try: MTProto userbot (handles old copyMessage msgs the bot can't delete)
        if (!telegramOk && isUserbotConfigured()) {
          const ok = await userbotDeleteMessage(LOG_GROUP_ID, msgId);
          if (ok) { telegramOk = true; telegramError = ""; }
        }
      }

      const result = nzbDb.deleteByMsgId(msgId);
      markDirty();
      try { clearSearchCache(); } catch (_) {}

      res.json({ success: true, telegram_deleted: telegramOk, db_deleted: result.changes > 0, ...(telegramError ? { telegram_error: telegramError } : {}) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Sample image: store URL (POST) ─────────────────────────────
  app.post("/api/logs/:msg_id/sample", (req, res) => {
    const msgId = parseInt(req.params.msg_id, 10);
    if (isNaN(msgId)) return res.status(400).json({ error: "Invalid ID" });

    const { url } = req.body as { url?: string };
    if (!url || !url.startsWith("http")) return res.status(400).json({ error: "Valid image URL required" });

    const record = nzbDb.getByMsgId(msgId);
    if (!record) return res.status(404).json({ error: "Log entry not found" });

    try {
      nzbDb.setCustomThumbnail(msgId, url);
      markDirty();
      log.thumb(`Saved custom thumbnail URL for msg_id=${msgId} — ${record.file_name}`);
      res.json({ success: true, url });
    } catch (e: any) {
      log.error("THUMB", `Failed to save thumbnail URL for msg_id=${msgId} — ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Sample image: proxy URL (GET) ─────────────────────────
  app.get("/api/logs/:msg_id/sample", async (req, res) => {
    const msgId = parseInt(req.params.msg_id, 10);
    if (isNaN(msgId)) return res.status(400).json({ error: "Invalid ID" });

    const thumbUrl = nzbDb.getCustomThumbnailUrl(msgId);
    if (!thumbUrl) return res.status(404).send("No custom thumbnail");

    try {
      const imgRes = await axios.get(thumbUrl, {
        responseType: "stream",
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      res.set("Content-Type", imgRes.headers["content-type"] || "image/jpeg");
      res.set("Cache-Control", "public, max-age=31536000");
      imgRes.data.pipe(res);
    } catch (e: any) {
      log.error("THUMB", `Proxy failed for ${thumbUrl}, falling back to redirect. ${e.message}`);
      res.redirect(302, thumbUrl);
    }
  });

  // ─── ThePornDB + StashDB thumbnail proxy (REST → GraphQL fallback) ──
  // In-memory cache: msg_id → { url, ts }
  const _thumbCache = new Map<number, { url: string | null; ts: number }>();
  const THUMB_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Helper: try ThePornDB REST API
  async function _tryThePornDB(raw: string, apiToken: string): Promise<string | null> {
    try {
      const apiRes = await axios.get(
        "https://api.theporndb.net/scenes",
        {
          params: { parse: raw, limit: 1 },
          headers: {
            "Authorization": `Bearer ${apiToken}`,
            "Accept": "application/json",
          },
          timeout: 10000,
        }
      );

      const scenes: any[] = apiRes.data?.data ?? [];
      const scene = scenes[0];
      if (!scene) return null;

      return (
        scene.background?.large ??
        scene.background?.full ??
        scene.image ??
        scene.poster ??
        scene.posters?.large ??
        scene.posters?.full ??
        null
      );
    } catch (e: any) {
      log.error("THUMB", `ThePornDB lookup failed — ${e.message}`);
      return null;
    }
  }

  // Helper: clean a scene-release filename for StashDB search
  // "Newsensations.26.05.26.Ellie.Nova.A.Hotwife..." → "Newsensations Ellie Nova A Hotwife..."
  function _cleanForStashSearch(raw: string): string {
    return raw
      .replace(/[._]/g, " ")                              // dots & underscores → spaces
      .replace(/\b\d{2,4}[\s.-]\d{2}[\s.-]\d{2}\b/g, "")  // strip date patterns (YY MM DD / YYYY MM DD)
      .replace(/\b\d{6,}-\d{3}\b/g, "")                   // strip numeric codes like 112323-001
      .replace(/\b(19|20)\d{2}\b/g, "")                    // strip standalone years (2024, 2025, 2026…)
      .replace(/\b\d{3,4}p\b/gi, "")                      // strip resolution tags (1080p, 720p, etc)
      .replace(/\b(x26[45]|hevc|h\.?26[45])\b/gi, "")     // strip codec tags
      .replace(/\b4k\b/gi, "")                             // strip 4k
      .replace(/\s{2,}/g, " ")                             // collapse multiple spaces
      .trim();
  }

  // Helper: try StashDB GraphQL API
  async function _tryStashDB(raw: string, apiKey: string): Promise<string | null> {
    const cleaned = _cleanForStashSearch(raw);
    if (!cleaned) return null;

    const query = `
      query SearchScenes($term: String!) {
        searchScenes(term: $term, limit: 1) {
          count
          scenes {
            id
            title
            images {
              id
              url
            }
          }
        }
      }
    `;
    try {
      const gqlRes = await axios.post(
        "https://stashdb.org/graphql",
        {
          query,
          variables: { term: cleaned },
        },
        {
          headers: {
            "ApiKey": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          timeout: 10000,
        }
      );

      const scenes: any[] = gqlRes.data?.data?.searchScenes?.scenes ?? [];
      const scene = scenes[0];
      if (!scene) return null;

      // Pick the first image URL from the scene
      const images: any[] = scene.images ?? [];
      return images[0]?.url ?? null;
    } catch (e: any) {
      log.error("THUMB", `StashDB lookup failed — ${e.message}`);
      return null;
    }
  }

  app.get("/api/logs/:msg_id/thumbnail", async (req, res) => {
    const msgId = parseInt(req.params.msg_id, 10);
    if (isNaN(msgId)) return res.status(400).json({ error: "Invalid ID" });

    const porndbToken = process.env.THEPORNDB_API_TOKEN;
    const stashdbKey = process.env.STASHDB_API_KEY;
    if (!porndbToken && !stashdbKey) return res.status(503).json({ error: "No thumbnail API tokens configured" });

    // Serve from cache
    const cached = _thumbCache.get(msgId);
    if (cached && Date.now() - cached.ts < THUMB_CACHE_TTL) {
      if (!cached.url) return res.status(404).send("No thumbnail");
      return res.redirect(302, cached.url);
    }

    const record = nzbDb.getByMsgId(msgId);
    if (!record) return res.status(404).json({ error: "Record not found" });

    // Always use caption for the parse / search endpoint
    const raw = (record.caption || "").replace(/\.nzb$/i, "");
    if (!raw) return res.status(404).send("No filename");

    let posterUrl: string | null = null;

    // 1️⃣ Try ThePornDB first
    if (porndbToken) {
      posterUrl = await _tryThePornDB(raw, porndbToken);
    }

    // 2️⃣ Fallback to StashDB if ThePornDB had nothing
    if (!posterUrl && stashdbKey) {
      posterUrl = await _tryStashDB(raw, stashdbKey);
      if (posterUrl) log.thumb(`StashDB fallback matched for msg_id=${msgId}`);
    }

    _thumbCache.set(msgId, { url: posterUrl, ts: Date.now() });

    if (!posterUrl) return res.status(404).send("No thumbnail");
    res.redirect(302, posterUrl);
  });

  app.listen(UPLOAD_PORT, "0.0.0.0", () => {
    log.web(`Listening on port ${UPLOAD_PORT}`);
  });
}

export { _accountInfo };
