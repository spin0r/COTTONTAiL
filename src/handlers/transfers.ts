import type { Context } from "grammy";
import { restricted, getClient, LOG_GROUP_ID } from "../utils/helpers";
import {
  StatusManager,
  generateListMessage,
  generateHistoryMessage,
  resolveId,
  getShortId,
} from "../statusManager";
import { TelegraphClient } from "../telegraphClient";
import type { BotSession, TransfersDict, Transfer, FolderFile } from "../types";

type Ctx = Context & { session: BotSession };

function formatSize(sizeBytes: number | string | null | undefined): string {
  if (!sizeBytes) return "?";
  const n = parseInt(String(sizeBytes), 10);
  if (isNaN(n)) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const listTransfers = restricted(async (ctx: Ctx) => {
  const userId = ctx.from!.id;
  const client = getClient(userId);
  const statusMsg = await ctx.reply("Fetching transfers...");
  try {
    const data = await client.fetchTransfers();
    if ((data as any)?.error && typeof (data as any).error === "string") {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `Error: ${(data as any).error}`);
      return;
    }
    const [msg, markup] = generateListMessage(data as TransfersDict, 1);
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, msg, {
      parse_mode: "HTML",
      reply_markup: markup ?? undefined,
    });
  } catch (e: any) {
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `Error fetching: ${e.message}`);
  }
});

export const transfersCommand = restricted(async (ctx: Ctx) => {
  const userId = ctx.from!.id;
  const client = getClient(userId);
  const statusMsg = await ctx.reply("Fetching history...");
  try {
    const data = await client.fetchTransfers();
    if ((data as any)?.error && typeof (data as any).error === "string") {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `Error: ${(data as any).error}`);
      return;
    }
    const [msg, markup] = generateHistoryMessage(data as TransfersDict, 1);
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, msg, {
      parse_mode: "HTML",
      reply_markup: markup ?? undefined,
    });
  } catch (e: any) {
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `Error fetching: ${e.message}`);
  }
});

export const searchCommand = restricted(async (ctx: Ctx) => {
  const text = ctx.message?.text ?? "";
  const query = text.split(" ").slice(1).join(" ").toLowerCase().trim();
  if (!query) { await ctx.reply("Usage: /search <query>"); return; }

  const userId = ctx.from!.id;
  const client = getClient(userId);
  ctx.session.lastSearch = query;
  const msg = await ctx.reply(`Searching for '${query}'...`);

  try {
    const data = await client.fetchTransfers();
    if ((data as any)?.error && typeof (data as any).error === "string") {
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `Error: ${(data as any).error}`);
      return;
    }
    const allItems: Transfer[] = [];
    if (data && typeof data === "object") {
      for (const key of ["running", "queued", "finished", "error"] as const) {
        allItems.push(...((data as TransfersDict)[key] ?? []));
      }
    }
    const results = allItems.filter((item) =>
      (item.name ?? "").toLowerCase().replace(/[._\-]/g, " ").includes(query)
    );
    if (!results.length) {
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `No transfers found matching '${query}'.`);
      return;
    }
    const headerText = `🔍 <b>Search Results (${results.length}):</b>\n\n`;
    const [outMsg, markup] = generateHistoryMessage(results, 1, "search", headerText);
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, outMsg, {
      parse_mode: "HTML",
      reply_markup: markup ?? undefined,
    });
  } catch (e: any) {
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `Error fetching: ${e.message}`);
  }
});

export const deleteCommand = restricted(async (ctx: Ctx) => {
  const userId = ctx.from!.id;
  const client = getClient(userId);
  const text = ctx.message?.text ?? "";
  const args = text.split(" ").slice(1).filter(Boolean);
  if (!args.length) { await ctx.reply("Usage: /delete <id1,id2> or /delete all"); return; }
  const target = args[0];

  if (target.toLowerCase() === "all") {
    await ctx.reply("Fetching list to delete ALL...");
    const data = await client.fetchTransfers();
    if ((data as any)?.error) { await ctx.reply("Failed to fetch list."); return; }
    const allIds: string[] = [];
    if (data && typeof data === "object") {
      for (const key of ["running", "queued", "finished", "error"] as const) {
        for (const t of (data as TransfersDict)[key] ?? []) {
          if (t.id) allIds.push(t.id);
        }
      }
    }
    if (!allIds.length) { await ctx.reply("No transfers to delete."); return; }
    let count = 0;
    for (const tid of allIds) { if (await client.deleteTransfer(tid)) count++; }
    await ctx.reply(`Deleted ${count}/${allIds.length} transfers.`);
  } else {
    const ids = target.split(",");
    let count = 0;
    for (const tid of ids) { if (await client.deleteTransfer(tid.trim())) count++; }
    await ctx.reply(`Deleted ${count}/${ids.length} transfers.`);
  }
});

export const handleViewCommand = restricted(async (ctx: Ctx) => {
  const text = ctx.message?.text ?? "";
  const match = text.match(/^\/view_(\w+)$/);
  if (!match) return;

  const shortId = match[1];
  const folderId = resolveId(shortId);
  if (!folderId) { await ctx.reply("Invalid or expired link. Please refresh /transfers list."); return; }

  const userId = ctx.from!.id;
  const client = getClient(userId);
  const msg = await ctx.reply("Fetching contents...");

  try {
    const data = await client.getFolderContents(folderId);
    if (!data) {
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `Failed to fetch contents (ID: ${folderId})`);
      return;
    }

    let files: FolderFile[] = [];
    if (typeof data === "object") {
      if (data.content) files = data.content;
      else if (data.files) {
        files = Array.isArray(data.files) ? data.files : (data.files as any).content ?? [];
      }
    }

    if (!files || !Array.isArray(files)) {
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `Unexpected response: ${JSON.stringify(Object.keys(data ?? {}))}`);
      return;
    }

    const filtered: { name: string; size: number | string | null; link: string }[] = [];
    for (const f of files) {
      const name = (typeof f === "string" ? f : f.name ?? "").trim();
      const link = typeof f === "object" ? (f.link ?? f.directlink ?? f.url ?? "") : "";
      const size = typeof f === "object" ? (f.size ?? f.fileSize ?? f.file_size ?? null) : null;
      if (!name.match(/\.(mp4|mkv)$/i)) continue;
      if (/sample/i.test(name)) continue;
      if (link && /sample/i.test(link)) continue;
      filtered.push({ name, size, link });
    }

    if (!filtered.length) {
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, "No video files found (excluding samples).");
      return;
    }

    let output = `<b>Files (${filtered.length}):</b>\n\n`;
    let overflowed = false;

    for (const item of filtered) {
      const safeName = item.name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const sizeStr = formatSize(item.size);
      const safeLink = (item.link ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&/g, "&amp;");
      const entry = `<b>${safeName}</b>\n📦 ${sizeStr}${safeLink ? ` | <code>${safeLink}</code>` : " | (No Link)"}\n\n`;
      if (output.length + entry.length > 3600) { overflowed = true; break; }
      output += entry;
    }

    if (overflowed) {
      const token = process.env.TELEGRAPH_TOKEN;
      if (token) {
        const tc = new TelegraphClient(token);
        const nodes = [{ tag: "h4", children: [`Files (${filtered.length})`] }];
        for (const item of filtered) {
          const children: any[] = [{ tag: "b", children: [item.name] }, { tag: "br" }, `📦 ${formatSize(item.size)}`];
          if (item.link) { children.push(" | "); children.push({ tag: "code", children: [item.link] }); }
          nodes.push({ tag: "p", children });
        }
        const pageUrl = await tc.createPage(`Files (${filtered.length})`, nodes);
        output = pageUrl
          ? `<b>Files (${filtered.length}):</b>\n\n📄 <a href="${pageUrl}">View all ${filtered.length} files on Telegraph</a>\n\n<i>Reply with /tdel to delete this page</i>`
          : `<b>Files (${filtered.length}):</b>\n\nFailed to create Telegraph page.`;
      } else {
        output = `<b>Files (${filtered.length}):</b>\n\nToo many files. Set TELEGRAPH_TOKEN to enable overflow.`;
      }
    }

    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, output, {
      parse_mode: "HTML",
    } as any);

    setTimeout(async () => {
      try { await ctx.api.deleteMessage(ctx.chat!.id, msg.message_id); } catch (_) {}
      try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch (_) {}
    }, 600000);
  } catch (e: any) {
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `Error viewing: ${e.message}`);
  }
});

export const handleDeleteCommand = restricted(async (ctx: Ctx) => {
  const text = ctx.message?.text ?? "";
  const match = text.match(/^\/delete_(\w+)$/);
  if (!match) return;

  const shortId = match[1];
  const tid = resolveId(shortId);
  if (!tid) { await ctx.reply("Invalid or expired link."); return; }

  const userId = ctx.from!.id;
  const client = getClient(userId);
  const msg = await ctx.reply("Deleting...");

  let found = false;
  try {
    const data = await client.fetchTransfers();
    if (data && typeof data === "object") {
      for (const key of ["running", "queued", "finished", "error"] as const) {
        for (const t of (data as TransfersDict)[key] ?? []) {
          if (t.id === tid) { found = true; break; }
        }
        if (found) break;
      }
    }
  } catch (_) {}

  if (!found) {
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, "⚠️ Transfer not found or already deleted.");
    setTimeout(async () => {
      try { await ctx.api.deleteMessage(ctx.chat!.id, msg.message_id); } catch (_) {}
      try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch (_) {}
    }, 5000);
    return;
  }

  const success = await client.deleteTransfer(tid);
  await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, success ? "✅ Deleted." : "❌ Failed to delete.");
  setTimeout(async () => {
    try { await ctx.api.deleteMessage(ctx.chat!.id, msg.message_id); } catch (_) {}
    try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch (_) {}
  }, 5000);
});

export const transferButtonHandler = restricted(async (ctx: Ctx) => {
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery!.data!;
  const parts = data.split("_");
  if (parts.length < 3) return;
  const page = parseInt(parts[2], 10) || 1;
  const userId = ctx.from!.id;
  const client = getClient(userId);
  await StatusManager.updatePage(userId, page);
  try {
    const tData = await client.fetchTransfers();
    if ((tData as any)?.error && typeof (tData as any).error === "string") {
      await ctx.answerCallbackQuery({ text: `Error: ${(tData as any).error}`, show_alert: true });
      return;
    }
    const [msg, markup] = generateListMessage(tData as TransfersDict, page);
    try { await ctx.editMessageText(msg, { reply_markup: markup, parse_mode: "HTML" }); } catch (_) {}
  } catch (e: any) {
    try { await ctx.answerCallbackQuery({ text: `Error: ${e.message}`, show_alert: true }); } catch (_) {}
  }
});

export const historyButtonHandler = restricted(async (ctx: Ctx) => {
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery!.data!;
  const parts = data.split("_");
  const page = parseInt(parts[2], 10) || 1;
  const userId = ctx.from!.id;
  const client = getClient(userId);
  try {
    const tData = await client.fetchTransfers();
    const [msg, markup] = generateHistoryMessage(tData as TransfersDict, page);
    try { await ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: markup ?? undefined }); } catch (_) {}
  } catch (e: any) {
    await ctx.api.editMessageText(ctx.chat!.id, (ctx.callbackQuery!.message as any).message_id, `Error refreshing: ${e.message}`);
  }
});

export const searchButtonHandler = restricted(async (ctx: Ctx) => {
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery!.data!;
  const parts = data.split("_");
  const page = parseInt(parts[parts.length - 1], 10) || 1;
  const userId = ctx.from!.id;
  const searchQuery = ctx.session?.lastSearch ?? "";
  if (!searchQuery) { await ctx.editMessageText("Search session expired. Please search again."); return; }
  const client = getClient(userId);
  try {
    const tData = await client.fetchTransfers();
    const allItems: Transfer[] = [];
    if (tData && typeof tData === "object") {
      for (const key of ["running", "queued", "finished", "error"] as const) {
        allItems.push(...((tData as TransfersDict)[key] ?? []));
      }
    }
    const results = allItems.filter((item) =>
      (item.name ?? "").toLowerCase().replace(/[._\-]/g, " ").includes(searchQuery)
    );
    if (!results.length) { await ctx.editMessageText(`No results found for '${searchQuery}'.`); return; }
    const headerText = `🔍 <b>Search Results (${results.length}):</b>\n\n`;
    const [msg, markup] = generateHistoryMessage(results, page, "search", headerText);
    try { await ctx.editMessageText(msg, { reply_markup: markup ?? undefined, parse_mode: "HTML" }); } catch (_) {}
  } catch (e: any) {
    try { await ctx.answerCallbackQuery({ text: `Error: ${e.message}`, show_alert: true }); } catch (_) {}
  }
});
