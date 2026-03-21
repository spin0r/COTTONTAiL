const { restricted, getClient } = require("../utils/helpers");
const TelegraphClient = require("../telegraphClient");

const TELEGRAPH_TOKEN = process.env.TELEGRAPH_TOKEN;
const telegraph = new TelegraphClient(TELEGRAPH_TOKEN);

if (!TELEGRAPH_TOKEN) {
  console.log("No TELEGRAPH_TOKEN found. Creating new Telegraph account...");
  telegraph.createAccount().then((token) => {
    if (token) console.log(`Created Telegraph Account! Token: ${token}`);
    else console.log("Failed to auto-create Telegraph account.");
  });
}

const CANCEL_FLAGS = {};

const cancelCommand = async (ctx) => {
  const userId = ctx.from.id;
  CANCEL_FLAGS[userId] = true;
  await ctx.reply("🛑 Cancellation request sent.");
};

const extract = restricted(async (ctx) => {
  const userId = ctx.from.id;
  CANCEL_FLAGS[userId] = false;

  const client = getClient(userId);
  const statusMsg = await ctx.reply("Fetching transfers list...");

  let transfers;
  try {
    transfers = await client.fetchTransfers();
  } catch (e) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `Error fetching: ${e.message}`,
    );
    return;
  }

  if (transfers?.error) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `Error: ${transfers.error}`,
    );
    return;
  }

  // Flatten finished transfers
  let allFinished = [];
  if (Array.isArray(transfers)) {
    allFinished = transfers;
  } else if (transfers && typeof transfers === "object") {
    allFinished = transfers.finished || [];
  }

  if (!allFinished.length) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      "No transfers found.",
    );
    return;
  }

  // Parse args
  const text = ctx.message?.text || "";
  const argsStr = text.split(" ").slice(1).join("").replace(/\s/g, "");
  let selectedTransfers = [];

  if (argsStr) {
    const indices = new Set();
    for (const part of argsStr.split(",")) {
      if (part.includes("-")) {
        const [s, e] = part.split("-").map(Number);
        for (let i = s; i <= e; i++) indices.add(i);
      } else if (part.trim()) {
        indices.add(parseInt(part, 10));
      }
    }
    for (const idx of [...indices].sort((a, b) => a - b)) {
      if (idx >= 1 && idx <= allFinished.length)
        selectedTransfers.push(allFinished[idx - 1]);
    }
    if (!selectedTransfers.length) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        "No valid transfers selected from range.",
      );
      return;
    }
  } else {
    selectedTransfers = allFinished;
  }

  const total = selectedTransfers.length;
  await ctx.api.editMessageText(
    ctx.chat.id,
    statusMsg.message_id,
    `Starting extraction for ${total} transfers...\n0/${total} [....................]`,
  );

  const extractedItems = [];
  let lastUpdateTime = Date.now();

  for (let i = 0; i < selectedTransfers.length; i++) {
    if (CANCEL_FLAGS[userId]) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        "❌ Extraction Cancelled by User.",
      );
      return;
    }

    const t = selectedTransfers[i];
    const folderId = t.folder_id;
    if (!folderId) continue;

    const data = await client.getFolderContents(folderId);
    if (data?.status === "success" && data.files) {
      const files = data.files.content || [];
      for (const mf of files) {
        if (mf.type !== "file") continue;
        const name = mf.name || "";
        if (!name.match(/\.(mp4|mkv)$/i)) continue;
        if (/sample/i.test(name)) continue;
        extractedItems.push([name, mf.directlink]);
      }
    }

    const now = Date.now();
    if (now - lastUpdateTime > 2000 || i === total - 1) {
      const progress = Math.floor(((i + 1) / total) * 20);
      const bar = "=".repeat(progress) + ".".repeat(20 - progress);
      try {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `Processing...\n${i + 1}/${total} [${bar}]`,
        );
        lastUpdateTime = now;
      } catch (_) {}
    }
  }

  if (!extractedItems.length) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      "No suitable video files found.",
    );
    return;
  }

  let pageUrl = null;
  if (extractedItems.length >= 5) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      "Creating Telegraph page...",
    );
    const nodes = TelegraphClient.formatLinksToNodes(extractedItems);
    const title = `Extracted Links - ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    try {
      pageUrl = await telegraph.createPage(title, nodes);
    } catch (e) {
      console.error("Telegraph creation failed:", e.message);
    }
  }

  if (pageUrl) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `✅ Extraction Complete!\n\nView Links: ${pageUrl}`,
    );
  } else {
    const prefix =
      extractedItems.length >= 5
        ? "⚠️ Telegraph connection failed. Sending links directly..."
        : "✅ Extraction Complete! Sending links directly...";
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, prefix);

    let chunk = "";
    for (const [name, link] of extractedItems) {
      const line = `${name}\n${link}\n\n`;
      if (chunk.length + line.length > 4000) {
        await ctx.reply(chunk);
        chunk = "";
      }
      chunk += line;
    }
    if (chunk) await ctx.reply(chunk);
  }
});

module.exports = { extract, cancelCommand };
