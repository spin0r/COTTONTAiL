/**
 * NZB Upload Logging, Search & Grab Handler
 *
 * Handles:
 *   - Intercepting .nzb document uploads → forward to log channel + index in DB
 *   - /logs <query> command → FTS5 full-text search with paginated results
 *   - /grab_<msg_id> command → download NZB from log channel + upload to MagicNZB
 *   - Pagination via inline buttons (same pattern as /transfers)
 */

const axios = require("axios");
const {
  restricted,
  LOG_GROUP_ID,
  getClient,
} = require("../utils/helpers");
const { StatusManager } = require("../statusManager");

const db = require("../nzb/db");
const { extractKeywords, normalizeQuery } = require("../nzb/utils");
const { markDirty } = require("../nzb/backup");

// ─── Search Result Cache ──────────────────────────────────────────────────────
const SEARCH_CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 200;

function getCached(key) {
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  if (SEARCH_CACHE.size >= CACHE_MAX) {
    const firstKey = SEARCH_CACHE.keys().next().value;
    SEARCH_CACHE.delete(firstKey);
  }
  SEARCH_CACHE.set(key, { data, ts: Date.now() });
}

function clearSearchCache() {
  SEARCH_CACHE.clear();
}

// ─── Channel Link Helper ─────────────────────────────────────────────────────

function buildMsgLink(channelId, msgId) {
  const stripped = String(Math.abs(channelId)).replace(/^100/, "");
  return `https://t.me/c/${stripped}/${msgId}`;
}

// ─── Paginated Message Generator ──────────────────────────────────────────────

function generateLogsMessage(results, page = 1, header = null) {
  if (!results || !results.length) {
    return ["No results found.", null];
  }

  if (!header) {
    header = `<b>Search Results (${results.length}):</b>\n\n`;
  }

  const MAX_CHARS = 3800 - header.length;
  const pages = [];
  let currentPageItems = [];
  let currentChars = 0;

  for (const r of results) {
    const name = escapeHtml(r.caption?.trim() || r.file_name || "untitled");
    const link = buildMsgLink(LOG_GROUP_ID, r.msg_id);

    const itemText = `<b>${name}</b>\n${link} | /grab_${r.msg_id}\n\n`;

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

  const navRow = [];
  if (page > 1)
    navRow.push({
      text: "<<",
      callback_data: `logs_prev_${page - 1}`,
    });
  navRow.push({
    text: "⟳",
    callback_data: `logs_refresh_${page}`,
  });
  if (page < totalPages)
    navRow.push({
      text: ">>",
      callback_data: `logs_next_${page + 1}`,
    });

  return [msg, { inline_keyboard: [navRow] }];
}

// ─── NZB Document Handler ─────────────────────────────────────────────────────

const handleNzbUpload = async (ctx) => {
  const document = ctx.message?.document;
  if (!document) return false;

  const fileName = document.file_name || "";
  if (!fileName.toLowerCase().endsWith(".nzb")) return false;

  if (!LOG_GROUP_ID) return false;

  const caption = ctx.message.caption || "";
  let displayName = caption.trim() || fileName;
  if (caption && !displayName.toLowerCase().endsWith(".nzb")) {
    displayName += ".nzb";
  }

  try {
    // 1. Copy to log group
    const logMsg = await ctx.api.copyMessage(
      LOG_GROUP_ID,
      ctx.chat.id,
      ctx.message.message_id,
      {
        caption: `<code>${displayName}</code>`,
        parse_mode: "HTML",
      }
    );

    const logMsgId = logMsg.message_id;
    const keywords = extractKeywords(displayName, caption);

    // 2. Index in DB
    db.insertFile({
      msg_id: logMsgId,
      file_name: displayName,
      caption: caption,
      keywords: keywords,
      file_type: "nzb",
    });
    markDirty();
    SEARCH_CACHE.clear();

    const total = db.getCount();
    const statusMsg = await ctx.reply(
      `Indexed: <code>${escapeHtml(displayName)}</code>\nTotal files: <b>${total}</b>\n\nUploading to MagicNZB...`,
      { parse_mode: "HTML" }
    );

    // 3. Download file content and upload to MagicNZB
    try {
      const fileObj = await ctx.api.getFile(document.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileObj.file_path}`;
      const res = await axios.get(fileUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
      });
      const fileContent = Buffer.from(res.data);

      const userId = ctx.from.id;
      const client = getClient(userId);
      const result = await client.uploadNzb(fileContent, displayName);

      if (result?.status === "success") {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `Indexed: <code>${escapeHtml(displayName)}</code>\nTotal files: <b>${total}</b>\n\n✅ Uploaded to MagicNZB`,
          { parse_mode: "HTML" }
        );
      } else {
        const error = result?.error || "Unknown";
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `Indexed: <code>${escapeHtml(displayName)}</code>\nTotal files: <b>${total}</b>\n\n❌ MagicNZB: ${escapeHtml(error)}`,
          { parse_mode: "HTML" }
        );
      }
    } catch (uploadErr) {
      console.error("[NZB] MagicNZB upload error:", uploadErr.message);
      try {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `Indexed: <code>${escapeHtml(displayName)}</code>\nTotal files: <b>${total}</b>\n\n❌ MagicNZB upload failed: ${escapeHtml(uploadErr.message.slice(0, 80))}`,
          { parse_mode: "HTML" }
        );
      } catch (_) {}
    }
  } catch (e) {
    console.error("[NZB] Index error:", e.message);
    await ctx.reply(`Failed to index: ${e.message.slice(0, 80)}`);
  }

  return true;
};

// ─── Search Command ───────────────────────────────────────────────────────────

const nzbSearchCommand = restricted(async (ctx) => {
  const rawQuery =
    ctx.match?.trim() ||
    (ctx.message?.text || "").split(/\s+/).slice(1).join(" ").trim();

  if (!rawQuery || rawQuery.length < 2) {
    await ctx.reply(
      "<b>Log Search</b>\n\n" +
        "Usage: <code>/logs movie name</code>\n" +
        "Example: <code>/logs breaking bad s01</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  if (!ctx.session) ctx.session = {};
  ctx.session.lastLogSearch = rawQuery;

  const ftsQuery = normalizeQuery(rawQuery);
  if (!ftsQuery) {
    await ctx.reply("Query too short or invalid.");
    return;
  }

  const statusMsg = await ctx.reply(`Searching for '${rawQuery}'...`);

  let results = getCached(ftsQuery);
  if (!results) {
    results = db.search(ftsQuery, 200);
    if (results.length) setCache(ftsQuery, results);
  }

  if (!results.length) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `No results found for '${escapeHtml(rawQuery)}'.`
    );
    return;
  }

  const header = `<b>Results for '${escapeHtml(rawQuery)}' (${results.length}):</b>\n\n`;
  const [msg, markup] = generateLogsMessage(results, 1, header);

  await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, msg, {
    parse_mode: "HTML",
    reply_markup: markup,
    disable_web_page_preview: true,
  });
});

// ─── Pagination Callback Handler ──────────────────────────────────────────────

const logsButtonHandler = restricted(async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery.data;
  const parts = data.split("_");
  const page = parseInt(parts[parts.length - 1], 10) || 1;

  const searchQuery = ctx.session?.lastLogSearch || "";
  if (!searchQuery) {
    await ctx.editMessageText("Search session expired. Please search again.");
    return;
  }

  const ftsQuery = normalizeQuery(searchQuery);
  let results = getCached(ftsQuery);
  if (!results) {
    results = db.search(ftsQuery, 200);
    if (results.length) setCache(ftsQuery, results);
  }

  if (!results.length) {
    try {
      await ctx.editMessageText(`No results found for '${searchQuery}'.`);
    } catch (_) {}
    return;
  }

  const header = `<b>Results for '${escapeHtml(searchQuery)}' (${results.length}):</b>\n\n`;
  const [msg, markup] = generateLogsMessage(results, page, header);
  try {
    await ctx.editMessageText(msg, {
      reply_markup: markup,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (_) {}
});

// ─── Grab Command ─────────────────────────────────────────────────────────────
// /grab_<msg_id> — downloads NZB from log channel and uploads to MagicNZB

const grabNzbCommand = restricted(async (ctx) => {
  const text = ctx.message?.text || "";
  const match = text.match(/^\/grab_(\d+)$/);
  if (!match) return;

  const msgId = parseInt(match[1], 10);
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  // Look up the file in the DB to get the upload name
  const record = db.getByMsgId(msgId);
  // Use caption first, fall back to file_name from DB, then generic name
  const uploadName = (record?.caption?.trim()) || record?.file_name || `nzb_${msgId}.nzb`;
  const displayName = uploadName.toLowerCase().endsWith(".nzb")
    ? uploadName
    : uploadName + ".nzb";

  const statusMsg = await ctx.reply(
    `Grabbing: <code>${escapeHtml(displayName)}</code>`,
    { parse_mode: "HTML" }
  );

  try {
    // Forward the message from log channel to user's chat to get the document
    const forwarded = await ctx.api.forwardMessage(chatId, LOG_GROUP_ID, msgId);

    const doc = forwarded.document;
    if (!doc) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Failed: Message ${msgId} has no document attached.`
      );
      // Clean up forwarded message
      try { await ctx.api.deleteMessage(chatId, forwarded.message_id); } catch (_) {}
      return;
    }

    // Delete the forwarded message immediately (user doesn't need to see it)
    try { await ctx.api.deleteMessage(chatId, forwarded.message_id); } catch (_) {}

    // Download the file via Bot API
    const fileObj = await ctx.api.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileObj.file_path}`;
    const res = await axios.get(fileUrl, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
    const fileContent = Buffer.from(res.data);

    // Upload to MagicNZB
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `Uploading: <code>${escapeHtml(displayName)}</code>`,
      { parse_mode: "HTML" }
    );

    await StatusManager.setHeader(
      userId,
      `grab_${msgId}`,
      `Uploading: ${displayName}`
    );

    const client = getClient(userId);
    const result = await client.uploadNzb(fileContent, displayName);

    if (result?.status === "success") {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Uploaded: <code>${escapeHtml(displayName)}</code>`,
        { parse_mode: "HTML" }
      );
      await StatusManager.setHeader(userId, `grab_${msgId}`, null);
      await StatusManager.startOrUpdate(ctx, userId, chatId);
    } else {
      const error = result?.error || "Unknown";
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Failed: <code>${escapeHtml(displayName)}</code> - ${escapeHtml(error)}`,
        { parse_mode: "HTML" }
      );
      await StatusManager.setHeader(userId, `grab_${msgId}`, null);
    }
  } catch (e) {
    console.error("[NZB] Grab error:", e.message);
    try {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Error: ${e.message.slice(0, 100)}`
      );
    } catch (_) {}
    await StatusManager.setHeader(userId, `grab_${msgId}`, null);
  }
});

// ─── Stats Command ────────────────────────────────────────────────────────────

const nzbStatsCommand = restricted(async (ctx) => {
  const total = db.getCount();
  const cacheSize = SEARCH_CACHE.size;
  await ctx.reply(
    `<b>NZB Index Stats</b>\n\n` +
      `Indexed files: <b>${total.toLocaleString()}</b>\n` +
      `Cached queries: <b>${cacheSize}</b>`,
    { parse_mode: "HTML" }
  );
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = {
  handleNzbUpload,
  nzbSearchCommand,
  nzbStatsCommand,
  logsButtonHandler,
  grabNzbCommand,
  clearSearchCache,
};
