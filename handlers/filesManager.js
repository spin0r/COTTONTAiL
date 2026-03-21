const fs = require("fs");
const path = require("path");
const {
  restricted,
  getClient,
  DOWNLOAD_DIR,
  getReadableFileSize,
  sendToLogGroupSafe,
  LOG_GROUP_ID,
} = require("../utils/helpers");
const { StatusManager } = require("../statusManager");

const MAX_CHARS = 3800;

function scanFiles() {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    return [];
  }
  return fs
    .readdirSync(DOWNLOAD_DIR)
    .filter((f) => f.toLowerCase().endsWith(".nzb"))
    .sort((a, b) => {
      const ma = fs.statSync(path.join(DOWNLOAD_DIR, a)).mtimeMs;
      const mb = fs.statSync(path.join(DOWNLOAD_DIR, b)).mtimeMs;
      return mb - ma;
    });
}

function buildPage(files, page = 1) {
  if (!files.length) return ["📂 No NZB files on server.", null];

  const header = `📂 <b>NZB Files (${files.length}):</b>\n\n💡 <b>Batch Upload:</b> /upload_0_5 (uploads files 0 to 5)\n\n`;
  const headerLen = header.length;

  const pages = [];
  let currentItems = [];
  let currentChars = 0;

  for (let i = 0; i < files.length; i++) {
    const fname = files[i];
    let size = "?";
    try {
      size = getReadableFileSize(
        fs.statSync(path.join(DOWNLOAD_DIR, fname)).size,
      );
    } catch (_) {}
    const safeName = fname.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const itemText = `<b>${safeName}</b>  <i>(${size})</i>\n📤 /upload_${i}  |  🗑 /del_${i}\n\n`;

    if (
      currentChars > 0 &&
      currentChars + itemText.length > MAX_CHARS - headerLen
    ) {
      pages.push(currentItems);
      currentItems = [itemText];
      currentChars = itemText.length;
    } else {
      currentItems.push(itemText);
      currentChars += itemText.length;
    }
  }
  if (currentItems.length) pages.push(currentItems);

  const totalPages = pages.length;
  if (!totalPages) return ["📂 No NZB files on server.", null];

  page = Math.max(1, Math.min(page, totalPages));
  let msg = header + pages[page - 1].join("");
  msg += `<b>Page: ${page} / ${totalPages}</b>`;

  const navRow = [];
  if (page > 1)
    navRow.push({ text: "<<", callback_data: `fm_page_${page - 1}` });
  navRow.push({ text: "⟳", callback_data: `fm_page_${page}` });
  if (page < totalPages)
    navRow.push({ text: ">>", callback_data: `fm_page_${page + 1}` });

  return [msg, { inline_keyboard: [navRow] }];
}

const filesCommand = restricted(async (ctx) => {
  const files = scanFiles();
  const [text, markup] = buildPage(files, 1);
  await ctx.reply(text, { reply_markup: markup, parse_mode: "HTML" });
});

const filesButtonHandler = async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery.data;
  const parts = data.split("_");
  const action = parts[1];

  try {
    if (action === "page") {
      const page = parseInt(parts[2], 10) || 1;
      const files = scanFiles();
      const [text, markup] = buildPage(files, page);
      try {
        await ctx.editMessageText(text, {
          reply_markup: markup,
          parse_mode: "HTML",
        });
      } catch (_) {}
    } else if (action === "upload") {
      const idx = parseInt(parts[2], 10);
      const page = parseInt(parts[3], 10) || 1;
      await handleUploadConfirm(ctx, idx, page);
    } else if (action === "confirmup") {
      const idx = parseInt(parts[2], 10);
      const page = parseInt(parts[3], 10) || 1;
      await executeUpload(ctx, idx, page);
    } else if (action === "delete") {
      const idx = parseInt(parts[2], 10);
      const page = parseInt(parts[3], 10) || 1;
      await confirmDelete(ctx, idx, page);
    } else if (action === "confirmdel") {
      const idx = parseInt(parts[2], 10);
      const page = parseInt(parts[3], 10) || 1;
      await executeDelete(ctx, idx, page);
    } else if (action === "cancel") {
      const page = parseInt(parts[2], 10) || 1;
      const files = scanFiles();
      const [text, markup] = buildPage(files, page);
      try {
        await ctx.editMessageText(text, {
          reply_markup: markup,
          parse_mode: "HTML",
        });
      } catch (_) {}
    }
  } catch (e) {
    console.error(`Invalid callback data '${data}':`, e.message);
  }
};

async function handleUploadConfirm(ctx, idx, page) {
  const files = scanFiles();
  if (idx < 0 || idx >= files.length) {
    await ctx.editMessageText("⚠️ File not found. Use /files to refresh.");
    return;
  }
  const safeName = files[idx].replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await ctx.editMessageText(`📤 Upload <b>${safeName}</b> to MagicNZB?`, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ Yes, upload",
            callback_data: `fm_confirmup_${idx}_${page}`,
          },
          { text: "❌ Cancel", callback_data: `fm_cancel_${page}` },
        ],
      ],
    },
    parse_mode: "HTML",
  });
}

async function executeUpload(ctx, idx, page) {
  const files = scanFiles();
  if (idx < 0 || idx >= files.length) {
    await ctx.editMessageText("⚠️ File not found. Use /files to refresh.");
    return;
  }

  const fname = files[idx];
  const fpath = path.join(DOWNLOAD_DIR, fname);
  const safeName = fname.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (!fs.existsSync(fpath)) {
    await ctx.editMessageText(`⚠️ <b>${safeName}</b> no longer exists.`, {
      parse_mode: "HTML",
    });
    return;
  }

  await ctx.editMessageText(`📤 Uploading <b>${safeName}</b>…`, {
    parse_mode: "HTML",
  });

  let statusText;
  let fileContent;
  try {
    fileContent = fs.readFileSync(fpath);
    const userId = ctx.from.id;
    const client = getClient(userId);
    const result = await client.uploadNzb(fileContent, fname);

    if (result?.status === "success") {
      statusText = `✅ <b>Uploaded:</b> <b>${safeName}</b>`;
      if (LOG_GROUP_ID) {
        const { InputFile } = require("grammy");
        await sendToLogGroupSafe(
          ctx,
          new InputFile(fileContent, fname),
          fname,
          `<code>${fname}</code>`,
        );
      }
    } else {
      const error = result?.error || "Unknown error";
      statusText = `❌ <b>Upload failed:</b> <b>${safeName}</b>\n${error}`;
    }
  } catch (e) {
    statusText = `❌ <b>Error:</b> ${e.message}`;
  }

  await ctx.editMessageText(statusText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "<< Back to files", callback_data: `fm_page_${page}` }],
      ],
    },
    parse_mode: "HTML",
  });

  if (statusText.includes("Uploaded")) {
    const userId = ctx.from.id;
    const chatId = ctx.callbackQuery.message.chat.id;
    await StatusManager.startOrUpdate(ctx, userId, chatId);
  }
}

async function confirmDelete(ctx, idx, page) {
  const files = scanFiles();
  if (idx < 0 || idx >= files.length) {
    await ctx.editMessageText("⚠️ File not found. Use /files to refresh.");
    return;
  }
  const safeName = files[idx].replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await ctx.editMessageText(
    `🗑 Delete <b>${safeName}</b>?\n\nThis cannot be undone.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Yes, delete",
              callback_data: `fm_confirmdel_${idx}_${page}`,
            },
            { text: "❌ Cancel", callback_data: `fm_cancel_${page}` },
          ],
        ],
      },
      parse_mode: "HTML",
    },
  );
}

async function executeDelete(ctx, idx, page) {
  const files = scanFiles();
  if (idx < 0 || idx >= files.length) {
    await ctx.editMessageText("⚠️ File not found. Use /files to refresh.");
    return;
  }

  const fname = files[idx];
  const fpath = path.join(DOWNLOAD_DIR, fname);
  const safeName = fname.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  try {
    if (fs.existsSync(fpath)) {
      fs.unlinkSync(fpath);
    } else {
      await ctx.editMessageText(`⚠️ <b>${safeName}</b> already gone.`, {
        parse_mode: "HTML",
      });
      return;
    }
  } catch (e) {
    await ctx.editMessageText(`❌ Failed to delete: ${e.message}`);
    return;
  }

  const updatedFiles = scanFiles();
  const [text, markup] = buildPage(updatedFiles, page);
  try {
    await ctx.editMessageText(`✅ Deleted <b>${safeName}</b>\n\n${text}`, {
      reply_markup: markup,
      parse_mode: "HTML",
    });
  } catch (_) {}
}

async function vanish(ctx, msg, delay = 4000) {
  await new Promise((r) => setTimeout(r, delay));
  try {
    await ctx.api.deleteMessage(ctx.chat.id, msg.message_id);
  } catch (_) {}
  try {
    await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
  } catch (_) {}
}

const handleUploadCommand = restricted(async (ctx) => {
  const text = ctx.message?.text || "";
  const match = text.match(/^\/upload_(\d+)$/);
  if (!match) return;

  const idx = parseInt(match[1], 10);
  const files = scanFiles();

  if (idx < 0 || idx >= files.length) {
    const msg = await ctx.reply("⚠️ File not found. Use /files to refresh.");
    vanish(ctx, msg);
    return;
  }

  const fname = files[idx];
  const fpath = path.join(DOWNLOAD_DIR, fname);
  const safeName = fname.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (!fs.existsSync(fpath)) {
    const msg = await ctx.reply(`⚠️ <b>${safeName}</b> no longer exists.`, {
      parse_mode: "HTML",
    });
    vanish(ctx, msg);
    return;
  }

  const msg = await ctx.reply(`📤 Uploading <b>${safeName}</b> to MagicNZB…`, {
    parse_mode: "HTML",
  });

  let result;
  try {
    const fileContent = fs.readFileSync(fpath);
    const userId = ctx.from.id;
    const client = getClient(userId);
    result = await client.uploadNzb(fileContent, fname);

    if (result?.status === "success") {
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        `✅ <b>Uploaded:</b> <b>${safeName}</b>`,
        { parse_mode: "HTML" },
      );
      if (LOG_GROUP_ID) {
        const { InputFile } = require("grammy");
        await sendToLogGroupSafe(
          ctx,
          new InputFile(fileContent, fname),
          fname,
          `<code>${fname}</code>`,
        );
      }
    } else {
      const error = result?.error || "Unknown error";
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        `❌ <b>Upload failed:</b> <b>${safeName}</b>\n${error}`,
        { parse_mode: "HTML" },
      );
    }
  } catch (e) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `❌ <b>Error:</b> ${e.message}`,
      { parse_mode: "HTML" },
    );
  }

  vanish(ctx, msg);

  if (result?.status === "success") {
    await StatusManager.startOrUpdate(ctx, ctx.from.id, ctx.chat.id);
  }
});

const handleDelCommand = restricted(async (ctx) => {
  const text = ctx.message?.text || "";
  const match = text.match(/^\/del_(\d+)$/);
  if (!match) return;

  const idx = parseInt(match[1], 10);
  const files = scanFiles();

  if (idx < 0 || idx >= files.length) {
    const msg = await ctx.reply("⚠️ File not found. Use /files to refresh.");
    vanish(ctx, msg);
    return;
  }

  const fname = files[idx];
  const fpath = path.join(DOWNLOAD_DIR, fname);
  const safeName = fname.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let msg;
  try {
    if (fs.existsSync(fpath)) {
      fs.unlinkSync(fpath);
      msg = await ctx.reply(`✅ Deleted <b>${safeName}</b>`, {
        parse_mode: "HTML",
      });
    } else {
      msg = await ctx.reply(`⚠️ <b>${safeName}</b> already gone.`, {
        parse_mode: "HTML",
      });
    }
  } catch (e) {
    msg = await ctx.reply(`❌ Failed to delete: ${e.message}`);
  }

  vanish(ctx, msg);
});

const handleBatchUploadCommand = restricted(async (ctx) => {
  const text = ctx.message?.text || "";
  const match = text.match(/^\/upload_(\d+)_(\d+)/);
  if (!match) return;

  const startIdx = parseInt(match[1], 10);
  const endIdx = parseInt(match[2], 10);

  if (startIdx > endIdx) {
    const msg = await ctx.reply("⚠️ Invalid range. Start must be ≤ end.");
    vanish(ctx, msg);
    return;
  }
  if (endIdx - startIdx > 50) {
    const msg = await ctx.reply("⚠️ Maximum batch size is 50 files.");
    vanish(ctx, msg);
    return;
  }

  const files = scanFiles();
  if (startIdx < 0 || endIdx >= files.length) {
    const msg = await ctx.reply(
      `⚠️ Invalid range. Available files: 0-${files.length - 1}. Use /files to refresh.`,
    );
    vanish(ctx, msg);
    return;
  }

  const filesToUpload = files.slice(startIdx, endIdx + 1);
  const total = filesToUpload.length;
  const msg = await ctx.reply(
    `📤 <b>Batch Upload Started</b>\n\nUploading ${total} files (#${startIdx} to #${endIdx})...`,
    { parse_mode: "HTML" },
  );

  const userId = ctx.from.id;
  const client = getClient(userId);
  let uploaded = 0,
    failed = 0;
  const failedFiles = [];

  for (let i = 0; i < filesToUpload.length; i++) {
    const fname = filesToUpload[i];
    const fpath = path.join(DOWNLOAD_DIR, fname);
    const safeName = fname.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (!fs.existsSync(fpath)) {
      failed++;
      failedFiles.push(`${safeName} (not found)`);
      continue;
    }

    try {
      if (i % 5 === 0) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          msg.message_id,
          `📤 <b>Batch Upload Progress</b>\n\nProgress: ${uploaded}/${total}\nFailed: ${failed}\n\nUploading: <code>${safeName}</code>`,
          { parse_mode: "HTML" },
        );
      }

      const fileContent = fs.readFileSync(fpath);
      const result = await client.uploadNzb(fileContent, fname);

      if (result?.status === "success") {
        uploaded++;
        if (LOG_GROUP_ID) {
          const { InputFile } = require("grammy");
          await sendToLogGroupSafe(
            ctx,
            new InputFile(fileContent, fname),
            fname,
            `<code>${fname}</code>`,
          );
        }
      } else {
        const error = (result?.error || "Unknown error").slice(0, 30);
        failed++;
        failedFiles.push(`${safeName} (${error})`);
      }
    } catch (e) {
      failed++;
      failedFiles.push(`${safeName} (${e.message.slice(0, 30)})`);
    }
  }

  let statusText = `✅ <b>Batch Upload Complete</b>\n\n📊 <b>Summary:</b>\n• Uploaded: ${uploaded}/${total}\n• Failed: ${failed}\n`;
  if (failedFiles.length) {
    statusText += `\n<b>Failed Files:</b>\n`;
    failedFiles.slice(0, 10).forEach((f) => {
      statusText += `• ${f}\n`;
    });
    if (failedFiles.length > 10)
      statusText += `<i>...and ${failedFiles.length - 10} more</i>\n`;
  }

  await ctx.api.editMessageText(ctx.chat.id, msg.message_id, statusText, {
    parse_mode: "HTML",
  });
  vanish(ctx, msg, 10000);

  if (uploaded > 0) {
    await StatusManager.startOrUpdate(ctx, userId, ctx.chat.id);
  }
});

module.exports = {
  filesCommand,
  filesButtonHandler,
  handleUploadCommand,
  handleDelCommand,
  handleBatchUploadCommand,
};
