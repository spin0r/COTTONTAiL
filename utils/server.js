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
    });
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
        // Send to Telegram log channel
        if (_bot) {
          try {
            const { LOG_GROUP_ID } = require("./helpers");
            if (LOG_GROUP_ID) {
              const { InputFile } = require("grammy");
              await _bot.api.sendDocument(
                LOG_GROUP_ID,
                new InputFile(fileContent, filename),
                {
                  caption: `<code>${filename}</code>`,
                  parse_mode: "HTML",
                },
              );
            }
          } catch (e) {
            console.error("Failed to send to log channel:", e.message);
          }
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

  app.listen(UPLOAD_PORT, "0.0.0.0", () => {
    console.log(`Web server started on port ${UPLOAD_PORT}`);
  });
}

module.exports = { startWebServer, _accountInfo };
