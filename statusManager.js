const { getClient, getProgressBarString } = require("./utils/helpers");

// ─── Short ID Mapper ──────────────────────────────────────────────────────────

const _shortToLong = {};
const _longToShort = {};

function getShortId(fullId) {
  if (_longToShort[fullId]) return _longToShort[fullId];
  let code;
  do {
    code = Math.random().toString(36).slice(2, 7);
  } while (_shortToLong[code]);
  _shortToLong[code] = fullId;
  _longToShort[fullId] = code;
  return code;
}

function resolveId(shortId) {
  return _shortToLong[shortId] || null;
}

// ─── Message Generation ───────────────────────────────────────────────────────

const PAGE_LIMIT = 10;

function generateListMessage(transfersDict, page = 1, headers = null) {
  if (!transfersDict || typeof transfersDict !== "object") {
    transfersDict = {
      finished: Array.isArray(transfersDict) ? transfersDict : [],
    };
  }

  const running = transfersDict.running || [];
  const queued = transfersDict.queued || [];
  const finished = transfersDict.finished || [];
  const error = transfersDict.error || transfersDict.failed || [];

  const allItems = [];

  if (running.length) {
    allItems.push({
      type: "header",
      text: `<b>Running (${running.length}):</b>`,
    });
    running.forEach((t) => allItems.push({ type: "running", data: t }));
    allItems.push({ type: "spacer" });
  }
  if (queued.length) {
    allItems.push({
      type: "header",
      text: `<b>Queued (${queued.length}):</b>`,
    });
    queued.forEach((t, i) =>
      allItems.push({ type: "queued", data: t, index: i + 1 }),
    );
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
    const refreshMarkup = {
      inline_keyboard: [[{ text: "⟳", callback_data: "list_refresh_1" }]],
    };
    return [emptyMsg, refreshMarkup];
  }

  const totalItems = allItems.length;
  const totalPages = Math.ceil(totalItems / PAGE_LIMIT);
  page = Math.max(1, Math.min(page, totalPages));

  const pageItems = allItems.slice((page - 1) * PAGE_LIMIT, page * PAGE_LIMIT);

  for (const item of pageItems) {
    if (item.type === "header") {
      msg += `${item.text}\n`;
    } else if (item.type === "spacer") {
      msg += "\n";
    } else if (item.type === "running") {
      const t = item.data;
      const name = t.name || "Unknown";
      const tid = t.id || "";
      let progVal = 0;
      try {
        const raw = parseFloat(String(t.progress || 0).replace("%", ""));
        progVal = raw <= 1.0 && raw > 0 ? raw * 100 : raw;
      } catch (_) {}
      const messageText = t.message || "";
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
      const tid = t.id || "";
      const delCode = tid ? getShortId(tid) : "";
      msg += `${item.index}. ${t.name}\n/delete_${delCode}\n\n`;
    } else if (item.type === "error") {
      const t = item.data;
      const tid = t.id || "";
      const delCode = tid ? getShortId(tid) : "";
      msg += `❌ ${t.name} - ${t.message || "Unknown Error"}\n/delete_${delCode}\n\n`;
    } else if (item.type === "finished") {
      const t = item.data;
      const tid = t.id || "";
      const delCode = tid ? getShortId(tid) : "";
      msg += `${item.index}. ${t.name}\n/delete_${delCode}\n\n`;
    }
  }

  msg += `<b>Page: ${page} / ${totalPages}</b>`;

  const navRow = [];
  if (page > 1)
    navRow.push({ text: "<<", callback_data: `list_prev_${page - 1}` });
  navRow.push({ text: "⟳", callback_data: `list_refresh_${page}` });
  if (page < totalPages)
    navRow.push({ text: ">>", callback_data: `list_next_${page + 1}` });

  return [msg, { inline_keyboard: [navRow] }];
}

function generateHistoryMessage(
  transfersDict,
  page = 1,
  callbackPrefix = "history",
  header = null,
) {
  if (!transfersDict || typeof transfersDict !== "object") {
    transfersDict = {
      finished: Array.isArray(transfersDict) ? transfersDict : [],
    };
  }

  const finished = transfersDict.finished || [];
  const errors = transfersDict.error || transfersDict.failed || [];

  const allItems = [
    ...errors.map((e) => ({ ...e, _type: "error" })),
    ...finished.map((f) => ({ ...f, _type: "finished" })),
  ];

  if (!allItems.length)
    return ["No completed or failed transfers found.", null];

  if (!header) {
    header = `<b>Transfers (Completed: ${finished.length} | Failed: ${errors.length}):</b>\n\n`;
  }

  const MAX_CHARS = 3800 - header.length;
  const pages = [];
  let currentPageItems = [];
  let currentChars = 0;

  for (const item of allItems) {
    const name = (item.name || "Unknown")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const transferId = item.id || "0";
    const folderId = item.folder_id || transferId || "0";
    const isError = item._type === "error";
    const errorMsg = item.message || "";

    let itemText;
    if (isError) {
      itemText = `❌ <b>${name}</b>\n<i>${errorMsg}</i>\n/delete_${getShortId(transferId)}\n\n`;
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

  const navRow = [];
  if (page > 1)
    navRow.push({
      text: "<<",
      callback_data: `${callbackPrefix}_prev_${page - 1}`,
    });
  navRow.push({
    text: "⟳",
    callback_data: `${callbackPrefix}_refresh_${page}`,
  });
  if (page < totalPages)
    navRow.push({
      text: ">>",
      callback_data: `${callbackPrefix}_next_${page + 1}`,
    });

  return [msg, { inline_keyboard: [navRow] }];
}

// ─── Status Manager ───────────────────────────────────────────────────────────

const _instances = {}; // userId -> { page, chatId, messageId, headers, interval }

const StatusManager = {
  async setHeader(userId, key, text) {
    if (_instances[userId]) {
      if (text) {
        _instances[userId].headers[key] = text;
      } else {
        delete _instances[userId].headers[key];
      }
    }
  },

  async startOrUpdate(bot, userId, chatId, messageIdToEdit = null) {
    if (_instances[userId]) {
      const existing = _instances[userId];
      if (messageIdToEdit && existing.messageId !== messageIdToEdit) {
        try {
          await bot.api.deleteMessage(chatId, messageIdToEdit);
        } catch (_) {}
        return;
      }
      if (!messageIdToEdit) {
        try {
          if (existing.messageId)
            await bot.api.deleteMessage(chatId, existing.messageId);
        } catch (_) {}
        existing.messageId = null;
      }
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
      () => StatusManager._tick(bot, userId).catch(console.error),
      5000,
    );
    // Run immediately
    StatusManager._tick(bot, userId).catch(console.error);
  },

  async updatePage(userId, page) {
    if (_instances[userId]) _instances[userId].page = page;
  },

  async _tick(bot, userId) {
    const inst = _instances[userId];
    if (!inst) return;

    // Recreate message if needed
    if (inst.messageId === null) {
      try {
        const m = await bot.api.sendMessage(
          inst.chatId,
          "Refreshing Monitor...",
        );
        inst.messageId = m.message_id;
        inst._lastText = "";
      } catch (e) {
        console.error("Error re-creating monitor message:", e.message);
        return;
      }
    }

    if (!inst.messageId) {
      try {
        const m = await bot.api.sendMessage(
          inst.chatId,
          "Initializing Global Monitor...",
        );
        inst.messageId = m.message_id;
        inst._lastText = "";
      } catch (e) {
        console.error("Error sending init message:", e.message);
        return;
      }
    }

    const client = getClient(userId);
    try {
      const tData = await client.fetchTransfers();
      if (tData?.error && typeof tData.error === "string") return;

      const [msg, markup] = generateListMessage(tData, inst.page, inst.headers);

      // Auto-stop
      if (!inst._emptyPolls) inst._emptyPolls = 0;
      if (
        msg.includes("No active transfers") &&
        !Object.keys(inst.headers).length
      ) {
        inst._emptyPolls++;
      } else {
        inst._emptyPolls = 0;
      }

      if (inst._emptyPolls > 12) {
        clearInterval(inst.interval);
        delete _instances[userId];
        try {
          await bot.api.editMessageText(
            "All transfers finished. Monitor stopped.",
            {
              chat_id: inst.chatId,
              message_id: inst.messageId,
              reply_markup: {
                inline_keyboard: [
                  [{ text: "⟳", callback_data: "list_refresh_1" }],
                ],
              },
            },
          );
        } catch (_) {}
        return;
      }

      if (msg !== inst._lastText) {
        try {
          await bot.api.editMessageText(msg, {
            chat_id: inst.chatId,
            message_id: inst.messageId,
            reply_markup: markup,
            parse_mode: "HTML",
          });
          inst._lastText = msg;
        } catch (e) {
          const err = e.message?.toLowerCase() || "";
          if (err.includes("message to edit not found")) {
            try {
              const m = await bot.api.sendMessage(inst.chatId, msg, {
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
    } catch (e) {
      console.error("Global Monitor Error:", e.message);
    }
  },
};

module.exports = {
  StatusManager,
  generateListMessage,
  generateHistoryMessage,
  getShortId,
  resolveId,
};
