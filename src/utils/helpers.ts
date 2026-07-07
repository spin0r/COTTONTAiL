import "dotenv/config";
import { log } from "./logger";
import fs from "fs";
import path from "path";
import axios from "axios";
import { MagicClient } from "../client";
import type { Context } from "grammy";

// ─── Constants ────────────────────────────────────────────────────────────────

let _BOT_VERSION = "v7.1: Cotton";
let _VERSION_IMAGE_URL = "";

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export const DOWNLOAD_DIR: string = process.env.DOWNLOAD_DIR ?? "nzb_downloads";

const AUTHORIZED_USERS_STR = process.env.AUTHORIZED_USERS ?? "";
export const AUTHORIZED_USERS: number[] = AUTHORIZED_USERS_STR.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

const LOG_GROUP_ID_STR = process.env.LOG_GROUP_ID ?? "-1003638429252";
export let LOG_GROUP_ID: number | null = null;
try {
  LOG_GROUP_ID = parseInt(LOG_GROUP_ID_STR, 10);
} catch (_) {}

// ─── State ────────────────────────────────────────────────────────────────────

let MAGIC_COOKIES = "";
let ACTIVE_PROFILE = "";
let ACTIVE_ACCOUNT_EMAIL = "";
let ACTIVE_ACCOUNT_EXPIRY = "";
let ACTIVE_ACCOUNT_TRAFFIC = "";
export const USER_CLIENTS: Record<number, MagicClient> = {};

// ─── Approved Users ───────────────────────────────────────────────────────────

const APPROVED_USERS_FILE = path.join(__dirname, "..", "..", "approved_users.json");
export let APPROVED_USERS = new Set<number>();

function loadApprovedUsers(): void {
  try {
    if (fs.existsSync(APPROVED_USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(APPROVED_USERS_FILE, "utf8")) as {
        approved_users?: number[];
      };
      APPROVED_USERS = new Set(data.approved_users ?? []);
    }
  } catch (e: any) {
    log.error("AUTH", `Failed to load approved users — ${e.message}`);
    APPROVED_USERS = new Set();
  }
}

function saveApprovedUsers(): void {
  try {
    fs.writeFileSync(
      APPROVED_USERS_FILE,
      JSON.stringify({ approved_users: [...APPROVED_USERS] }, null, 2)
    );
  } catch (e: any) {
    log.error("AUTH", `Failed to save approved users — ${e.message}`);
  }
}

export function approveUser(userId: number): boolean {
  if (APPROVED_USERS.has(userId)) return false;
  APPROVED_USERS.add(userId);
  saveApprovedUsers();
  return true;
}

export function disapproveUser(userId: number): boolean {
  if (!APPROVED_USERS.has(userId)) return false;
  APPROVED_USERS.delete(userId);
  saveApprovedUsers();
  return true;
}

export function getApprovedUsers(): number[] {
  return [...APPROVED_USERS].sort((a, b) => a - b);
}

loadApprovedUsers();

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function setVersionInfo(versionName: string | null = null, imageUrl: string | null = null): void {
  if (versionName !== null) _BOT_VERSION = versionName.trim();
  if (imageUrl !== null) _VERSION_IMAGE_URL = imageUrl.trim();
}

export const BOT_VERSION = (): string => _BOT_VERSION;
export const VERSION_IMAGE_URL = (): string => _VERSION_IMAGE_URL;

export function getReadableFileSize(sizeInBytes: number | string | undefined): string {
  if (!sizeInBytes) return "0B";
  let size = parseFloat(String(sizeInBytes));
  if (isNaN(size)) return "0B";
  let index = 0;
  while (size >= 1024 && index < SIZE_UNITS.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(2)}${SIZE_UNITS[index]}`;
}

export function getProgressBarString(pct: number | string): string {
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

export function isAuthorized(userId: number): boolean {
  if (!AUTHORIZED_USERS.length) return true;
  return AUTHORIZED_USERS.includes(userId) || APPROVED_USERS.has(userId);
}

export function restricted<C extends Context>(handler: (ctx: C, ...args: any[]) => Promise<void>) {
  return async (ctx: C, ...args: any[]): Promise<void> => {
    const userId = ctx.from?.id;
    if (!userId) return;
    if (!isAuthorized(userId)) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: "Unauthorized access.", show_alert: true });
      } else {
        await ctx.reply("Unauthorized access.");
      }
      return;
    }
    return handler(ctx, ...args);
  };
}

// ─── Client Management ────────────────────────────────────────────────────────

export function getClient(userId: number): MagicClient {
  if (!USER_CLIENTS[userId]) {
    USER_CLIENTS[userId] = new MagicClient(MAGIC_COOKIES);
  }
  return USER_CLIENTS[userId];
}

// ─── Cookie Fetching ──────────────────────────────────────────────────────────

const COOKIE_API_BASE = process.env.COOKIE_API_BASE ?? "https://seikooc.vercel.app";
const COOKIE_API_SECRET = process.env.COOKIE_API_SECRET ?? "";

function _apiHeaders(): Record<string, string> {
  return COOKIE_API_SECRET ? { "x-api-key": COOKIE_API_SECRET } : {};
}

export async function fetchMagicCookies(name: string | null = null): Promise<boolean> {
  const profileName = name ?? "randm";
  const targetUrl = `${COOKIE_API_BASE}/?name=${profileName}`;
  try {
    const res = await axios.get(targetUrl, { headers: _apiHeaders(), timeout: 15000 });
    let cookiesData = res.data as any;
    let apiEmail: string | null = null;
    if (cookiesData && typeof cookiesData === "object" && !Array.isArray(cookiesData)) {
      apiEmail = cookiesData.email ?? null;
      cookiesData = cookiesData.cookies ?? cookiesData;
    }
    MAGIC_COOKIES = (
      typeof cookiesData === "string" ? cookiesData : JSON.stringify(cookiesData)
    ).trim();

    ACTIVE_PROFILE = profileName;
    ACTIVE_ACCOUNT_EMAIL = apiEmail ?? "";
    ACTIVE_ACCOUNT_EXPIRY = "";
    ACTIVE_ACCOUNT_TRAFFIC = "";

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
    (Object.keys(USER_CLIENTS) as unknown as number[]).forEach((k) => delete USER_CLIENTS[k as number]);
    log.success("COOKIES", `Fetched profile: ${profileName}`);
    return true;
  } catch (e: any) {
    log.error("COOKIES", `Fetch failed — ${e.message}`);
    return false;
  }
}

export async function fetchProfileCookies(name: string): Promise<string | null> {
  const targetUrl = `${COOKIE_API_BASE}/?name=${name}`;
  try {
    const res = await axios.get(targetUrl, { headers: _apiHeaders(), timeout: 15000 });
    return (typeof res.data === "string" ? res.data : JSON.stringify(res.data)).trim();
  } catch (e: any) {
    log.error("COOKIES", `Fetch failed for ${name} — ${e.message}`);
    return null;
  }
}

export async function getAvailableCookieProfiles(): Promise<string[]> {
  try {
    const res = await axios.get(`${COOKIE_API_BASE}/`, {
      headers: _apiHeaders(),
      timeout: 15000,
    });
    const data = res.data as { profiles?: string[] };
    if (data?.profiles) return data.profiles;
    return [];
  } catch (e: any) {
    console.error("Error fetching profiles:", e.message);
    return [];
  }
}

// ─── Log Group Helpers ────────────────────────────────────────────────────────

interface LogLock {
  locked: boolean;
  queue: Array<() => void>;
}

const LOG_LOCK: LogLock = { locked: false, queue: [] };

async function withLogLock<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      LOG_LOCK.locked = true;
      try {
        await new Promise((r) => setTimeout(r, 1000));
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        LOG_LOCK.locked = false;
        if (LOG_LOCK.queue.length > 0) {
          const next = LOG_LOCK.queue.shift()!;
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

export async function sendToLogGroupSafe(
  bot: { api: any },
  document: any,
  filename: string,
  caption: string | null = null
): Promise<void> {
  if (!LOG_GROUP_ID) return;
  await withLogLock(async () => {
    try {
      await bot.api.sendDocument(LOG_GROUP_ID, document, { caption, parse_mode: "HTML" });
    } catch (e: any) {
      if (e.description?.includes("retry")) {
        const wait = parseInt(e.description.match(/\d+/)?.[0] ?? "5", 10);
        await new Promise((r) => setTimeout(r, wait * 1000));
        try {
          await bot.api.sendDocument(LOG_GROUP_ID, document, { caption, parse_mode: "HTML" });
        } catch (e2: any) {
          console.error("Failed to retry log group upload:", e2.message);
        }
      } else {
        console.error("Log group upload failed:", e.message);
      }
    }
  });
}

export async function forwardToLogGroup(
  bot: { api: any },
  fromChatId: number,
  messageId: number,
  fileName: string | null = null
): Promise<void> {
  if (!LOG_GROUP_ID) return;
  const caption = fileName ? `<code>${fileName}</code>` : null;
  await withLogLock(async () => {
    try {
      await bot.api.copyMessage(LOG_GROUP_ID, fromChatId, messageId, {
        caption,
        parse_mode: "HTML",
      });
    } catch (e: any) {
      console.error("Log group copy failed:", e.message);
    }
  });
}

// ─── Accessor Functions ───────────────────────────────────────────────────────

export const getMagicCookies = (): string => MAGIC_COOKIES;
export const getActiveProfile = (): string => ACTIVE_PROFILE;
export const getActiveAccountEmail = (): string => ACTIVE_ACCOUNT_EMAIL;
export const getActiveAccountExpiry = (): string => ACTIVE_ACCOUNT_EXPIRY;
export const getActiveAccountTraffic = (): string => ACTIVE_ACCOUNT_TRAFFIC;
export const setMagicCookies = (v: string): void => { MAGIC_COOKIES = v; };

