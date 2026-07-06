import { getClient, getProgressBarString } from "./utils/helpers";
import type { Bot } from "grammy";
import type { TransfersDict, Transfer, InlineKeyboard, InlineKeyboardButton } from "./types";

// ─── Short ID Mapper ──────────────────────────────────────────────────────────

const _shortToLong: Record<string, string> = {};
const _longToShort: Record<string, string> = {};

export function getShortId(fullId: string): string {
  if (_longToShort[fullId]) return _longToShort[fullId];
  let code: string;
  do {
    code = Math.random().toString(36).slice(2, 7);
  } while (_shortToLong[code]);
  _shortToLong[code] = fullId;
  _longToShort[fullId] = code;
  return code;
}

export function resolveId(shortId: string): string | null {
  return _shortToLong[shortId] ?? null;
}

// ─── Message Generation ───────────────────────────────────────────────────────

const PAGE_LIMIT = 10;

type ListItem =
  | { type: "header"; text: string }
  | { type: "spacer" }
  | { type: "running"; data: Transfer }
  | { type: "queued"; data: Transfer; index: number }
  | { type: "error"; data: Transfer }
  | { type: "finished"; data: Transfer; index: number };

export function generateListMessage(
  transfersDict: TransfersDict | null | undefined,
  page = 1,
  headers: Record<string, string> | null = null
): [string, InlineKeyboard] {
  const running = (transfersDict as TransfersDict)?.running ?? [];
  const queued = (transfersDict as TransfersDict)?.queued ?? [];
  const finished = (transfersDict as TransfersDict)?.finished ?? [];
  const error: Transfer[] = (transfersDict as TransfersDict)?.error ?? (transfersDict as any)?.failed ?? [];

  const allItems: ListItem[] = [];

  if (running.length) {
    allItems.push({ type: "header", text: `<b>Running (${running.length}):</b>` });
    running.forEach((t) => allItems.push({ type: "running", data: t }));
    allItems.push({ type: "spacer" });
  }
  if (queued.length) {
    allItems.push({ type: "header", text: `<b>Queued (${queued.length}):</b>` });
    queued.forEach((t, i) => allItems.push({ type: "queued", data: t, index: i + 1 }));
    allItems.push({ type: "spacer" });
  }
  if (error.length) {
    allItems.push({ type: "header", text: `<b>Error (${error.length}):</b>` });
    error.forEach((t) => allItems.push({ type: "error", data: t }));
    allItems.push({ type: "spacer" });
  }

  let msg = "";
  if (headers) {
    const headerTexts = Object.values(headers).filter(Boolean);
    if (headerTexts.length) msg += headerTexts.join("\n\n") + "\n\n";
  }

  if (!allItems.length) {
    const emptyMsg = msg + "No active transfers found.";
    return [emptyMsg, { inline_keyboard: [[{ text: "⟳", callback_data: "list_refresh_1" }]] }];
  }

  const totalPages = Math.ceil(allItems.length / PAGE_LIMIT);
  page = Math.max(1, Math.min(page, totalPages));
  const pageItems = allItems.slice((page - 1) * PAGE_LIMIT, page * PAGE_LIMIT);

  for (const item of pageItems) {
    if (item.type === "header") {
      msg += `${item.text}\n`;
    } else if (item.type === "spacer") {
      msg += "\n";
    } else if (item.type === "running") {
      const t = item.data;
      const name = t.name ?? "Unknown";
      const tid = t.id ?? "";
      let progVal = 0;
      try {
        const raw = parseFloat(String(t.progress ?? 0).replace("%", ""));
        progVal = raw <= 1.0 && raw > 0 ? raw * 100 : raw;
      } catch (_) {}
      const messageText = t.message ?? "";
      if (progVal === 0 && messageText) {
        const m = messageText.match(/(\d+(?:\.\d+)?)%/);
        if (m) progVal = parseFloat(m[1]);
      }
      const bar = getProgressBarString(progVal);
      const delCode = tid ? getShortId(tid) : "";
      msg += `<code>${name}</code>\n${bar} ${progVal.toFixed(2)}%\n`;
      if (messageText) msg += `<i>${messageText}</i>\n`;
      msg += `/delete_${delCode}\n\n`;
    } else if (item.type === "queued") {
      const t = item.data;
      const tid = t.id ?? "";
      const delCode = tid ? getShortId(tid) : "";
      msg += `${item.index}. ${t.name}\n/delete_${delCode}\n\n`;
    } else if (item.type === "error") {
      const t = item.data;
      const tid = t.id ?? "";
      const delCode = tid ? getShortId(tid) : "";
      msg += `❌ ${t.name} - ${t.message ?? "Unknown Error"}\n/delete_${delCode}\n\n`;
    } else if (item.type === "finished") {
      const t = item.data;
      const tid = t.id ?? "";
      const delCode = tid ? getShortId(tid) : "";
      msg += `${item.index}. ${t.name}\n/delete_${delCode}\n\n`;
    }
  }

  msg += `<b>Page: ${page} / ${totalPages}</b>`;

  const navRow: InlineKeyboardButton[] = [];
  if (page > 1) navRow.push({ text: "<<", callback_data: `list_prev_${page - 1}` });
  navRow.push({ text: "⟳", callback_data: `list_refresh_${page}` });
  if (page < totalPages) navRow.push({ text: ">>", callback_data: `list_next_${page + 1}` });

  return [msg, { inline_keyboard: [navRow] }];
}

export function generateHistoryMessage(
  transfersDict: TransfersDict | Transfer[] | null | undefined,
  page = 1,
  callbackPrefix = "history",
  header: string | null = null
): [string, InlineKeyboard | null] {
  let finished: Transfer[] = [];
  let errors: Transfer[] = [];

  if (Array.isArray(transfersDict)) {
    finished = transfersDict;
  } else {
    finished = (transfersDict as TransfersDict)?.finished ?? [];
    errors = (transfersDict as TransfersDict)?.error ?? ((transfersDict as any)?.failed as Transfer[] | undefined) ?? [];
  }

  const allItems: (Transfer & { _type: "error" | "finished" })[] = [
    ...errors.map((e) => ({ ...e, _type: "error" as const })),
    ...finished.map((f) => ({ ...f, _type: "finished" as const })),
  ];

  if (!allItems.length) return ["No completed or failed transfers found.", null];

  if (!header) {
    header = `<b>Transfers (Completed: ${finished.length} | Failed: ${errors.length}):</b>\n\n`;
  }

  const MAX_CHARS = 3800 - header.length;
  const pages: string[] = [];
  let currentPageItems: string[] = [];
  let currentChars = 0;

  for (const item of allItems) {
    const name = (item.name ?? "Unknown").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const transferId = item.id ?? "0";
    const folderId = (item as any).folder_id ?? transferId ?? "0";
    const isError = item._type === "error";

    let itemText: string;
    if (isError) {
      itemText = `❌ <b>${name}</b>\n<i>${item.message ?? ""}</i>\n/delete_${getShortId(transferId)}\n\n`;
    } else {
      itemText = `<b>${name}</b>\n/view_${getShortId(folderId)} | /delete_${getShortId(transferId)}\n\n`;
    }

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
  if (!totalPages) return ["No completed transfers found.", null];

  page = Math.max(1, Math.min(page, totalPages));
  let msg = pages[page - 1];
  msg += `<b>Page: ${page} / ${totalPages}</b>`;

  const navRow: InlineKeyboardButton[] = [];
  if (page > 1) navRow.push({ text: "<<", callback_data: `${callbackPrefix}_prev_${page - 1}` });
  navRow.push({ text: "⟳", callback_data: `${callbackPrefix}_refresh_${page}` });
  if (page < totalPages) navRow.push({ text: ">>", callback_data: `${callbackPrefix}_next_${page + 1}` });

  return [msg, { inline_keyboard: [navRow] }];
}

// ─── Status Manager ───────────────────────────────────────────────────────────

interface StatusInstance {
  page: number;
  chatId: number;
  messageId: number | null;
  headers: Record<string, string>;
  interval: ReturnType<typeof setInterval> | null;
  _lastText?: string;
  _emptyPolls?: number;
}

const _instances: Record<number, StatusInstance> = {};

export const StatusManager = {
  async setHeader(userId: number, key: string, text: string | null): Promise<void> {
    if (_instances[userId]) {
      if (text) {
        _instances[userId].headers[key] = text;
      } else {
        delete _instances[userId].headers[key];
      }
    }
  },

  async startOrUpdate(bot: Bot | { api: any }, userId: number, chatId: number, messageIdToEdit: number | null = null): Promise<void> {
    if (_instances[userId]) {
      const existing = _instances[userId];
      if (existing.messageId && existing.messageId !== messageIdToEdit) {
        try {
          await (bot as any).api.deleteMessage(existing.chatId ?? chatId, existing.messageId);
        } catch (_) {}
      }
      existing.chatId = chatId;
      existing.messageId = messageIdToEdit;
      StatusManager._tick(bot as any, userId).catch(console.error);
      return;
    }

    _instances[userId] = {
      page: 1,
      chatId,
      messageId: messageIdToEdit,
      headers: {},
      interval: null,
    };

    _instances[userId].interval = setInterval(
      () => StatusManager._tick(bot as any, userId).catch(console.error),
      5000
    );
    StatusManager._tick(bot as any, userId).catch(console.error);
  },

  async updatePage(userId: number, page: number): Promise<void> {
    if (_instances[userId]) _instances[userId].page = page;
  },

  async _tick(bot: Bot, userId: number): Promise<void> {
    const inst = _instances[userId];
    if (!inst) return;

    if (inst.messageId === null) {
      try {
        const m = await (bot as any).api.sendMessage(inst.chatId, "Refreshing Monitor...");
        inst.messageId = m.message_id;
        inst._lastText = "";
      } catch (e: any) {
        console.error("Error re-creating monitor message:", e.message);
        return;
      }
    }

    if (!inst.messageId) {
      try {
        const m = await (bot as any).api.sendMessage(inst.chatId, "Initializing Global Monitor...");
        inst.messageId = m.message_id;
        inst._lastText = "";
      } catch (e: any) {
        console.error("Error sending init message:", e.message);
        return;
      }
    }

    const client = getClient(userId);
    try {
      const tData = await client.fetchTransfers();
      if ((tData as any)?.error && typeof (tData as any).error === "string") return;

      const [msg, markup] = generateListMessage(tData as TransfersDict, inst.page, inst.headers);

      if (!inst._emptyPolls) inst._emptyPolls = 0;
      if (msg.includes("No active transfers") && !Object.keys(inst.headers).length) {
        inst._emptyPolls++;
      } else {
        inst._emptyPolls = 0;
      }

      if (inst._emptyPolls > 12) {
        clearInterval(inst.interval!);
        delete _instances[userId];
        try {
          await (bot as any).api.editMessageText(
            inst.chatId,
            inst.messageId,
            "All transfers finished. Monitor stopped.",
            { reply_markup: { inline_keyboard: [[{ text: "⟳", callback_data: "list_refresh_1" }]] } }
          );
        } catch (_) {}
        return;
      }

      if (msg !== inst._lastText) {
        try {
          await (bot as any).api.editMessageText(inst.chatId, inst.messageId, msg, {
            reply_markup: markup,
            parse_mode: "HTML",
          });
          inst._lastText = msg;
        } catch (e: any) {
          const err = e.message?.toLowerCase() ?? "";
          if (err.includes("message to edit not found")) {
            try {
              const m = await (bot as any).api.sendMessage(inst.chatId, msg, {
                reply_markup: markup,
                parse_mode: "HTML",
              });
              inst.messageId = m.message_id;
              inst._lastText = msg;
            } catch (_) {}
          } else if (err.includes("message is not modified")) {
            inst._lastText = msg;
          }
        }
      }
    } catch (e: any) {
      console.error("Global Monitor Error:", e.message);
    }
  },
};
