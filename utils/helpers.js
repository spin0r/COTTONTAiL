require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const MagicClient = require("../client");

// ─── Constants ────────────────────────────────────────────────────────────────

let BOT_VERSION = "v7.1: Cotton";
let VERSION_IMAGE_URL = "";

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "nzb_downloads";

const AUTHORIZED_USERS_STR = process.env.AUTHORIZED_USERS || "";
const AUTHORIZED_USERS = AUTHORIZED_USERS_STR.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

const LOG_GROUP_ID_STR = process.env.LOG_GROUP_ID || "-1003638429252";
let LOG_GROUP_ID = null;
try {
  LOG_GROUP_ID = parseInt(LOG_GROUP_ID_STR, 10);
} catch (_) {}

// ─── State ────────────────────────────────────────────────────────────────────

let MAGIC_COOKIES = "";
let ACTIVE_PROFILE = "";
let ACTIVE_ACCOUNT_EMAIL = "";
let ACTIVE_ACCOUNT_EXPIRY = "";
let ACTIVE_ACCOUNT_TRAFFIC = "";
const USER_CLIENTS = {};

// ─── Approved Users ───────────────────────────────────────────────────────────

const APPROVED_USERS_FILE = path.join(__dirname, "..", "approved_users.json");
let APPROVED_USERS = new Set();

function loadApprovedUsers() {
  try {
    if (fs.existsSync(APPROVED_USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(APPROVED_USERS_FILE, "utf8"));
      APPROVED_USERS = new Set(data.approved_users || []);
    }
  } catch (e) {
    console.error("Failed to load approved users:", e.message);
    APPROVED_USERS = new Set();
  }
}

function saveApprovedUsers() {
  try {
    fs.writeFileSync(
      APPROVED_USERS_FILE,
      JSON.stringify({ approved_users: [...APPROVED_USERS] }, null, 2),
    );
  } catch (e) {
    console.error("Failed to save approved users:", e.message);
  }
}

function approveUser(userId) {
  if (APPROVED_USERS.has(userId)) return false;
  APPROVED_USERS.add(userId);
  saveApprovedUsers();
  return true;
}

function disapproveUser(userId) {
  if (!APPROVED_USERS.has(userId)) return false;
  APPROVED_USERS.delete(userId);
  saveApprovedUsers();
  return true;
}

function getApprovedUsers() {
  return [...APPROVED_USERS].sort((a, b) => a - b);
}

loadApprovedUsers();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setVersionInfo(versionName = null, imageUrl = null) {
  if (versionName !== null) BOT_VERSION = versionName.trim();
  if (imageUrl !== null) VERSION_IMAGE_URL = imageUrl.trim();
}

function getReadableFileSize(sizeInBytes) {
  if (!sizeInBytes) return "0B";
  let size = parseFloat(sizeInBytes);
  if (isNaN(size)) return "0B";
  let index = 0;
  while (size >= 1024 && index < SIZE_UNITS.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(2)}${SIZE_UNITS[index]}`;
}

function getProgressBarString(pct) {
  try {
    let p = typeof pct === "string" ? parseFloat(pct.replace("%", "")) : pct;
    p = Math.min(Math.max(p, 0), 100);
    const cFull = Math.floor(p / 4);
    return "[" + "■".repeat(cFull) + "□".repeat(25 - cFull) + "]";
  } catch (_) {
    return "[□□□□□□□□□□□□□□□□□□□□□□□□□]";
  }
}

// ─── Access Control ───────────────────────────────────────────────────────────

function isAuthorized(userId) {
  if (!AUTHORIZED_USERS.length) return true;
  return AUTHORIZED_USERS.includes(userId) || APPROVED_USERS.has(userId);
}

// Middleware-style wrapper for grammy handlers
function restricted(handler) {
  return async (ctx, ...args) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    if (!isAuthorized(userId)) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({
          text: "Unauthorized access.",
          show_alert: true,
        });
      } else {
        await ctx.reply("Unauthorized access.");
      }
      return;
    }
    return handler(ctx, ...args);
  };
}

// ─── Client Management ────────────────────────────────────────────────────────

function getClient(userId) {
  if (!USER_CLIENTS[userId]) {
    USER_CLIENTS[userId] = new MagicClient(MAGIC_COOKIES);
  }
  return USER_CLIENTS[userId];
}

// ─── Cookie Fetching ──────────────────────────────────────────────────────────

const COOKIE_API_BASE =
  process.env.COOKIE_API_BASE || "https://seikooc.vercel.app";
const COOKIE_API_SECRET = process.env.COOKIE_API_SECRET || "";

function _apiHeaders() {
  return COOKIE_API_SECRET ? { "x-api-key": COOKIE_API_SECRET } : {};
}

async function fetchMagicCookies(name = null) {
  const profileName = name || "randm";
  const targetUrl = `${COOKIE_API_BASE}/?name=${profileName}`;
  try {
    const res = await axios.get(targetUrl, {
      headers: _apiHeaders(),
      timeout: 15000,
    });

    // Handle both old (raw array) and new ({ cookies, email }) format
    let cookiesData = res.data;
    let apiEmail = null;
    if (
      cookiesData &&
      typeof cookiesData === "object" &&
      !Array.isArray(cookiesData)
    ) {
      apiEmail = cookiesData.email || null;
      cookiesData = cookiesData.cookies || cookiesData;
    }
    MAGIC_COOKIES = (
      typeof cookiesData === "string"
        ? cookiesData
        : JSON.stringify(cookiesData)
    ).trim();

    ACTIVE_PROFILE = profileName;
    ACTIVE_ACCOUNT_EMAIL = apiEmail || "";
    ACTIVE_ACCOUNT_EXPIRY = "";
    ACTIVE_ACCOUNT_TRAFFIC = "";

    // Fetch account info from MagicNZB /account page
    if (!ACTIVE_ACCOUNT_EMAIL) {
      try {
        const tempClient = new MagicClient(MAGIC_COOKIES);
        const info = await tempClient.getAccountInfo();
        if (info?.username) ACTIVE_ACCOUNT_EMAIL = info.username;
        if (info?.days_left) ACTIVE_ACCOUNT_EXPIRY = info.days_left;
        if (info?.status) ACTIVE_ACCOUNT_TRAFFIC = info.status;
      } catch (_) {}
    }

    for (const client of Object.values(USER_CLIENTS)) {
      client.updateCookies(MAGIC_COOKIES);
    }
    Object.keys(USER_CLIENTS).forEach((k) => delete USER_CLIENTS[k]);
    console.log(`Fetched MagicNZB cookies (profile: ${profileName})`);
    return true;
  } catch (e) {
    console.error("Error fetching cookies:", e.message);
    return false;
  }
}

async function fetchProfileCookies(name) {
  const targetUrl = `${COOKIE_API_BASE}/?name=${name}`;
  try {
    const res = await axios.get(targetUrl, {
      headers: _apiHeaders(),
      timeout: 15000,
    });
    return (
      typeof res.data === "string" ? res.data : JSON.stringify(res.data)
    ).trim();
  } catch (e) {
    console.error(`Error fetching cookies for ${name}:`, e.message);
    return null;
  }
}

async function getAvailableCookieProfiles() {
  try {
    const res = await axios.get(`${COOKIE_API_BASE}/`, {
      headers: _apiHeaders(),
      timeout: 15000,
    });
    // New API returns { profiles: [...] }
    if (res.data?.profiles) {
      return res.data.profiles;
    }
    return [];
  } catch (e) {
    console.error("Error fetching profiles:", e.message);
    return [];
  }
}

// ─── Log Group Helpers ────────────────────────────────────────────────────────

const LOG_LOCK = { locked: false, queue: [] };

async function withLogLock(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      LOG_LOCK.locked = true;
      try {
        await new Promise((r) => setTimeout(r, 1000)); // proactive delay
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        LOG_LOCK.locked = false;
        if (LOG_LOCK.queue.length > 0) {
          const next = LOG_LOCK.queue.shift();
          next();
        }
      }
    };
    if (LOG_LOCK.locked) {
      LOG_LOCK.queue.push(run);
    } else {
      run();
    }
  });
}

async function sendToLogGroupSafe(bot, document, filename, caption = null) {
  if (!LOG_GROUP_ID) return;
  await withLogLock(async () => {
    try {
      await bot.api.sendDocument(LOG_GROUP_ID, document, {
        caption,
        parse_mode: "HTML",
      });
    } catch (e) {
      if (e.description?.includes("retry")) {
        const wait = parseInt(e.description.match(/\d+/)?.[0] || "5", 10);
        await new Promise((r) => setTimeout(r, wait * 1000));
        try {
          await bot.api.sendDocument(LOG_GROUP_ID, document, {
            caption,
            parse_mode: "HTML",
          });
        } catch (e2) {
          console.error("Failed to retry log group upload:", e2.message);
        }
      } else {
        console.error("Log group upload failed:", e.message);
      }
    }
  });
}

async function forwardToLogGroup(bot, fromChatId, messageId, fileName = null) {
  if (!LOG_GROUP_ID) return;
  const caption = fileName ? `<code>${fileName}</code>` : null;
  await withLogLock(async () => {
    try {
      await bot.api.copyMessage(LOG_GROUP_ID, fromChatId, messageId, {
        caption,
        parse_mode: "HTML",
      });
    } catch (e) {
      console.error("Log group copy failed:", e.message);
    }
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  BOT_VERSION: () => BOT_VERSION,
  VERSION_IMAGE_URL: () => VERSION_IMAGE_URL,
  setVersionInfo,
  getReadableFileSize,
  getProgressBarString,
  DOWNLOAD_DIR,
  AUTHORIZED_USERS,
  LOG_GROUP_ID,
  MAGIC_COOKIES: () => MAGIC_COOKIES,
  ACTIVE_PROFILE: () => ACTIVE_PROFILE,
  ACTIVE_ACCOUNT_EMAIL: () => ACTIVE_ACCOUNT_EMAIL,
  ACTIVE_ACCOUNT_EXPIRY: () => ACTIVE_ACCOUNT_EXPIRY,
  ACTIVE_ACCOUNT_TRAFFIC: () => ACTIVE_ACCOUNT_TRAFFIC,
  setMagicCookies: (v) => {
    MAGIC_COOKIES = v;
  },
  USER_CLIENTS,
  getClient,
  fetchMagicCookies,
  fetchProfileCookies,
  getAvailableCookieProfiles,
  sendToLogGroupSafe,
  forwardToLogGroup,
  restricted,
  isAuthorized,
  approveUser,
  disapproveUser,
  getApprovedUsers,
  APPROVED_USERS,
};
