import axios from "axios";
import type { Context } from "grammy";
import { restricted, LOG_GROUP_ID, getClient } from "../utils/helpers";
import { StatusManager } from "../statusManager";
import * as db from "../nzb/db";
import { extractKeywords, normalizeQuery } from "../nzb/utils";
import { markDirty } from "../nzb/backup";
import type { BotSession, NzbRecord } from "../types";

const AI_RENAME_URL = "https://v2-vl42.onrender.com/api/ai-rename";

type Ctx = Context & { session: BotSession };

// ─── Search Cache ─────────────────────────────────────────────────────────────

const SEARCH_CACHE = new Map<string, { data: NzbRecord[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 200;

function getCached(key: string): NzbRecord[] | null {
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { SEARCH_CACHE.delete(key); return null; }
  return entry.data;
}

function setCache(key: string, data: NzbRecord[]): void {
  if (SEARCH_CACHE.size >= CACHE_MAX) { const firstKey = SEARCH_CACHE.keys().next().value!; SEARCH_CACHE.delete(firstKey); }
  SEARCH_CACHE.set(key, { data, ts: Date.now() });
}

export function clearSearchCache(): void { SEARCH_CACHE.clear(); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildMsgLink(channelId: number, msgId: number): string {
  const stripped = String(Math.abs(channelId)).replace(/^100/, "");
  return `https://t.me/c/${stripped}/${msgId}`;
}

function generateLogsMessage(results: NzbRecord[], page = 1, header: string | null = null): [string, any | null] {
  if (!results?.length) return ["No results found.", null];
  if (!header) header = `<b>Search Results (${results.length}):</b>\n\n`;
  const MAX_CHARS = 3800 - header.length;
  const pages: string[] = [];
  let currentPageItems: string[] = [];
  let currentChars = 0;

  for (const r of results) {
    const name = escapeHtml((r.caption?.trim() || r.file_name || "untitled"));
    const link = buildMsgLink(LOG_GROUP_ID!, r.msg_id);
    const itemText = `<b>${name}</b>\n${link} | /grab_${r.msg_id} | /rename_${r.msg_id}\n\n`;
    if (currentChars > 0 && currentChars + itemText.length > MAX_CHARS) {
      pages.push(header + currentPageItems.join(""));
      currentPageItems = [itemText];
      currentChars = itemText.length;
    } else {
      currentPageItems.push(itemText);
      currentChars += itemText.length;
    }
  }
  if (currentPageItems.length) pages.push(header + currentPageItems.join(""));

  const totalPages = pages.length;
  if (!totalPages) return ["No results found.", null];
  page = Math.max(1, Math.min(page, totalPages));
  let msg = pages[page - 1];
  msg += `<b>Page: ${page} / ${totalPages}</b>`;

  const navRow: any[] = [];
  if (page > 1) navRow.push({ text: "<<", callback_data: `logs_prev_${page - 1}` });
  navRow.push({ text: "⟳", callback_data: `logs_refresh_${page}` });
  if (page < totalPages) navRow.push({ text: ">>", callback_data: `logs_next_${page + 1}` });

  return [msg, { inline_keyboard: [navRow] }];
}

// ─── NZB Upload Handler ───────────────────────────────────────────────────────

// ─── Caption / filename parser ────────────────────────────────────────────────
// Supported prefix formats (first space-delimited token before the .nzb title):
//
//   DS_<hash>_thumb.jpg  Title.nzb   → https://drunkenslug.com/covers/sample/<hash>_thumb.jpg
//   TR_<hash>_thumb.jpg  Title.nzb   → https://www.tabula-rasa.pw/covers/sample/<hash>_thumb.jpg
//   https://...          Title.nzb   → plain URL passed through as-is
//
// Returns { thumbnailUrl, displayName } — displayName has .nzb stripped.

function resolveThumbPrefix(prefix: string): string | null {
  if (prefix.startsWith("DS_")) return `https://drunkenslug.com/covers/sample/${prefix.slice(3)}`;
  if (prefix.startsWith("TR_")) return `https://www.tabula-rasa.pw/covers/sample/${prefix.slice(3)}`;
  if (/^https?:\/\//i.test(prefix)) return prefix;
  return null;
}

function parseCaptionWithUrl(caption: string, fallbackName: string): { thumbnailUrl: string | null; displayName: string } {
  const trimmed = caption.trim();

  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx > 0) {
    const prefix = trimmed.slice(0, spaceIdx);
    const rest = trimmed.slice(spaceIdx + 1).trim();
    const thumbnailUrl = resolveThumbPrefix(prefix);
    if (thumbnailUrl) {
      // Keep .nzb in display name — ensure it ends with .nzb
      const displayName = rest.toLowerCase().endsWith(".nzb") ? rest : rest + ".nzb";
      return { thumbnailUrl, displayName };
    }
  }

  // No recognised prefix — treat whole caption as display name, ensure .nzb
  if (trimmed) {
    const displayName = trimmed.toLowerCase().endsWith(".nzb") ? trimmed : trimmed + ".nzb";
    return { thumbnailUrl: null, displayName };
  }

  // No caption — fall back to actual filename (already has .nzb)
  return { thumbnailUrl: null, displayName: fallbackName };
}

export const handleNzbUpload = async (ctx: Context): Promise<boolean> => {
  const document = (ctx.message as any)?.document;
  if (!document) return false;
  const fileName: string = document.file_name ?? "";
  if (!fileName.toLowerCase().endsWith(".nzb")) return false;
  if (!LOG_GROUP_ID) return false;

  const rawCaption: string = (ctx.message as any).caption ?? "";
  const { thumbnailUrl, displayName } = parseCaptionWithUrl(rawCaption, fileName);
  // displayName already has .nzb — used for both caption and file_name in DB
  const fileNameWithExt = displayName;

  try {
    const logMsg = await ctx.api.copyMessage(LOG_GROUP_ID, ctx.chat!.id, ctx.message!.message_id, {
      caption: `<code>${escapeHtml(displayName)}</code>`,
      parse_mode: "HTML",
    });
    const logMsgId = logMsg.message_id;
    const keywords = extractKeywords(fileNameWithExt, displayName);
    db.insertFile({ msg_id: logMsgId, file_name: fileNameWithExt, caption: displayName, keywords, file_type: "nzb" });
    markDirty();
    SEARCH_CACHE.clear();

    const total = db.getCount();
    const statusMsg = await ctx.reply(
      `Indexed: <code>${escapeHtml(displayName)}</code>\nTotal files: <b>${total}</b>\n\nUploading to MagicNZB...`,
      { parse_mode: "HTML" }
    );

    // Save thumbnail if a URL was found in the caption
    if (thumbnailUrl) {
      try {
        db.setCustomThumbnail(logMsgId, thumbnailUrl);
        markDirty();
        console.log(`[NZB] Saved thumbnail URL for msg_id=${logMsgId}: ${thumbnailUrl}`);
      } catch (thumbErr: any) {
        console.error("[NZB] Thumbnail URL save failed:", thumbErr.message);
      }
    }

    try {
      const fileObj = await ctx.api.getFile(document.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileObj.file_path}`;
      const res = await axios.get(fileUrl, { responseType: "arraybuffer", timeout: 60000 });
      const fileContent = Buffer.from(res.data as ArrayBuffer);
      const userId = ctx.from!.id;
      const client = getClient(userId);
      const result = await client.uploadNzb(fileContent, fileNameWithExt);

      if (result?.status === "success") {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
          `Indexed: <code>${escapeHtml(displayName)}</code>\nTotal files: <b>${total}</b>\n\n✅ Uploaded to MagicNZB`,
          { parse_mode: "HTML" });
      } else {
        const error = result?.error ?? "Unknown";
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
          `Indexed: <code>${escapeHtml(displayName)}</code>\nTotal files: <b>${total}</b>\n\n❌ MagicNZB: ${escapeHtml(error)}`,
          { parse_mode: "HTML" });
      }
    } catch (uploadErr: any) {
      console.error("[NZB] MagicNZB upload error:", uploadErr.message);
      try {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id,
          `Indexed: <code>${escapeHtml(displayName)}</code>\nTotal files: <b>${total}</b>\n\n❌ MagicNZB upload failed: ${escapeHtml(uploadErr.message.slice(0, 80))}`,
          { parse_mode: "HTML" });
      } catch (_) {}
    }
  } catch (e: any) {
    console.error("[NZB] Index error:", e.message);
    await ctx.reply(`Failed to index: ${e.message.slice(0, 80)}`);
  }

  return true;
};

// ─── Search Command ───────────────────────────────────────────────────────────

export const nzbSearchCommand = restricted(async (ctx: Ctx) => {
  const rawQuery = ((ctx as any).match?.trim() ?? "") || (ctx.message?.text ?? "").split(/\s+/).slice(1).join(" ").trim();
  if (!rawQuery || rawQuery.length < 2) {
    await ctx.reply("<b>Log Search</b>\n\nUsage: <code>/logs movie name</code>\nExample: <code>/logs breaking bad s01</code>", { parse_mode: "HTML" });
    return;
  }

  ctx.session.lastLogSearch = rawQuery;
  const ftsQuery = normalizeQuery(rawQuery);
  if (!ftsQuery) { await ctx.reply("Query too short or invalid."); return; }

  const statusMsg = await ctx.reply(`Searching for '${rawQuery}'...`);
  let results = getCached(ftsQuery);
  if (!results) {
    results = db.search(ftsQuery, 200);
    if (results.length) setCache(ftsQuery, results);
  }

  if (!results.length) {
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `No results found for '${escapeHtml(rawQuery)}'.`);
    return;
  }

  const header = `<b>Results for '${escapeHtml(rawQuery)}' (${results.length}):</b>\n\n`;
  const [msg, markup] = generateLogsMessage(results, 1, header);
  await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, msg, {
    parse_mode: "HTML",
    reply_markup: markup ?? undefined,
  } as any);
});

// ─── Pagination ───────────────────────────────────────────────────────────────

export const logsButtonHandler = restricted(async (ctx: Ctx) => {
  await ctx.answerCallbackQuery();
  const data = (ctx.callbackQuery as any).data as string;
  const parts = data.split("_");
  const page = parseInt(parts[parts.length - 1], 10) || 1;
  const searchQuery = ctx.session?.lastLogSearch ?? "";
  if (!searchQuery) { await ctx.editMessageText("Search session expired. Please search again."); return; }

  const ftsQuery = normalizeQuery(searchQuery);
  let results = getCached(ftsQuery);
  if (!results) {
    results = db.search(ftsQuery, 200);
    if (results.length) setCache(ftsQuery, results);
  }
  if (!results.length) { try { await ctx.editMessageText(`No results found for '${searchQuery}'.`); } catch (_) {} return; }

  const header = `<b>Results for '${escapeHtml(searchQuery)}' (${results.length}):</b>\n\n`;
  const [msg, markup] = generateLogsMessage(results, page, header);
  try { await ctx.editMessageText(msg, { reply_markup: markup ?? undefined, parse_mode: "HTML" } as any); } catch (_) {}
});

// ─── AI Rename ────────────────────────────────────────────────────────────────

export const aiRenameCommand = restricted(async (ctx: Ctx) => {
  const text = ctx.message?.text ?? "";
  const match = text.match(/^\/rename_(\d+)$/);
  if (!match) return;
  const msgId = parseInt(match[1], 10);
  const chatId = ctx.chat!.id;

  const record = db.getByMsgId(msgId);
  if (!record) { await ctx.reply(`No indexed file found for message ID ${msgId}.`); return; }

  const currentName = record.caption?.trim() || record.file_name || "";
  if (!currentName) { await ctx.reply("Cannot rename — no filename found in DB."); return; }

  const inputName = currentName.replace(/\.nzb$/i, "");
  const statusMsg = await ctx.reply(`🤖 AI Renaming:\n<code>${escapeHtml(currentName)}</code>\n\nCalling AI...`, { parse_mode: "HTML" });

  try {
    const aiRes = await axios.post(AI_RENAME_URL, { text: inputName }, { headers: { "Content-Type": "application/json" }, timeout: 30000 });
    const aiData = aiRes.data as { ok: boolean; result?: string; error?: string };
    if (!aiData?.ok || !aiData.result) throw new Error(aiData?.error ?? "AI rename failed");

    let newName = aiData.result.trim().replace(/\.nzb$/i, "") + ".nzb";

    const keywords = extractKeywords(newName, newName);
    db.updateFile(msgId, newName, keywords);
    markDirty();
    clearSearchCache();

    try {
      await ctx.api.editMessageCaption(LOG_GROUP_ID!, msgId, { caption: `<code>${escapeHtml(newName)}</code>`, parse_mode: "HTML" });
    } catch (captionErr: any) {
      console.error(`[AI-RENAME] Caption update failed for msg ${msgId}:`, captionErr.message);
    }

    await ctx.api.editMessageText(chatId, statusMsg.message_id,
      `🤖 AI Renamed:\n\n<b>Before:</b>\n<code>${escapeHtml(currentName)}</code>\n\n<b>After:</b>\n<code>${escapeHtml(newName)}</code>`,
      { parse_mode: "HTML" });
  } catch (e: any) {
    console.error("[AI-RENAME] Error:", e.message);
    try { await ctx.api.editMessageText(chatId, statusMsg.message_id, `❌ AI Rename failed: ${escapeHtml(e.message.slice(0, 120))}`, { parse_mode: "HTML" }); } catch (_) {}
  }
});

// ─── Grab Command ─────────────────────────────────────────────────────────────

export const grabNzbCommand = restricted(async (ctx: Ctx) => {
  const text = ctx.message?.text ?? "";
  const match = text.match(/^\/grab_(\d+)$/);
  if (!match) return;
  const msgId = parseInt(match[1], 10);
  const userId = ctx.from!.id;
  const chatId = ctx.chat!.id;

  const record = db.getByMsgId(msgId);
  const uploadName = (record?.caption?.trim()) || record?.file_name || `nzb_${msgId}.nzb`;
  const displayName = uploadName.toLowerCase().endsWith(".nzb") ? uploadName : uploadName + ".nzb";

  const statusMsg = await ctx.reply(`Grabbing: <code>${escapeHtml(displayName)}</code>`, { parse_mode: "HTML" });

  try {
    const forwarded = await ctx.api.forwardMessage(chatId, LOG_GROUP_ID!, msgId);
    const doc = (forwarded as any).document;
    if (!doc) {
      await ctx.api.editMessageText(chatId, statusMsg.message_id, `Failed: Message ${msgId} has no document attached.`);
      try { await ctx.api.deleteMessage(chatId, forwarded.message_id); } catch (_) {}
      return;
    }
    try { await ctx.api.deleteMessage(chatId, forwarded.message_id); } catch (_) {}

    const fileObj = await ctx.api.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileObj.file_path}`;
    const res = await axios.get(fileUrl, { responseType: "arraybuffer", timeout: 60000 });
    const fileContent = Buffer.from(res.data as ArrayBuffer);

    await ctx.api.editMessageText(chatId, statusMsg.message_id, `Uploading: <code>${escapeHtml(displayName)}</code>`, { parse_mode: "HTML" });
    await StatusManager.setHeader(userId, `grab_${msgId}`, `Uploading: ${displayName}`);

    const client = getClient(userId);
    const result = await client.uploadNzb(fileContent, displayName);

    if (result?.status === "success") {
      await ctx.api.editMessageText(chatId, statusMsg.message_id, `Uploaded: <code>${escapeHtml(displayName)}</code>`, { parse_mode: "HTML" });
      await StatusManager.setHeader(userId, `grab_${msgId}`, null);
      await StatusManager.startOrUpdate(ctx as any, userId, chatId);
    } else {
      const error = result?.error ?? "Unknown";
      await ctx.api.editMessageText(chatId, statusMsg.message_id, `Failed: <code>${escapeHtml(displayName)}</code> - ${escapeHtml(error)}`, { parse_mode: "HTML" });
      await StatusManager.setHeader(userId, `grab_${msgId}`, null);
    }
  } catch (e: any) {
    console.error("[NZB] Grab error:", e.message);
    try { await ctx.api.editMessageText(chatId, statusMsg.message_id, `Error: ${e.message.slice(0, 100)}`); } catch (_) {}
    await StatusManager.setHeader(userId, `grab_${msgId}`, null);
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────

export const nzbStatsCommand = restricted(async (ctx: Ctx) => {
  const total = db.getCount();
  await ctx.reply(
    `<b>NZB Index Stats</b>\n\nIndexed files: <b>${total.toLocaleString()}</b>\nCached queries: <b>${SEARCH_CACHE.size}</b>`,
    { parse_mode: "HTML" }
  );
});
