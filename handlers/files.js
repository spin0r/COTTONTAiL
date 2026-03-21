const {
  restricted,
  getClient,
  forwardToLogGroup,
  LOG_GROUP_ID,
} = require("../utils/helpers");
const { StatusManager } = require("../statusManager");

const ALBUM_BUFFERS = {};

async function waitAndProcess(bot, mgId) {
  await new Promise((r) => setTimeout(r, 5000));
  await processAlbum(bot, mgId);
}

const handleDocument = restricted(async (ctx) => {
  const userId = ctx.from.id;
  const document = ctx.message?.document;
  if (!document) return;

  // Album handling
  const mgId = ctx.message.media_group_id;
  if (mgId) {
    if (!ALBUM_BUFFERS[mgId]) {
      ALBUM_BUFFERS[mgId] = { messages: [], timer: null };
    }
    const buffer = ALBUM_BUFFERS[mgId];
    buffer.messages.push(ctx.message);

    if (buffer.timer) clearTimeout(buffer.timer);
    buffer.timer = setTimeout(() => processAlbum(ctx.api, mgId, ctx), 5000);
    return;
  }

  const fileName = document.file_name || "";
  if (!fileName) return;

  const isNzb = fileName.toLowerCase().endsWith(".nzb");
  const caption = ctx.message.caption;
  let uploadName = caption ? caption.trim() : fileName;
  if (isNzb && caption && !uploadName.toLowerCase().endsWith(".nzb"))
    uploadName += ".nzb";

  try {
    const fileObj = await ctx.api.getFile(document.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileObj.file_path}`;
    const axios = require("axios");
    const res = await axios.get(fileUrl, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
    const fileContent = Buffer.from(res.data);

    if (LOG_GROUP_ID) {
      await forwardToLogGroup(
        ctx,
        ctx.chat.id,
        ctx.message.message_id,
        uploadName,
      );
    }

    await StatusManager.setHeader(
      userId,
      `upload_${uploadName}`,
      `📤 Uploading: ${uploadName}`,
    );

    const client = getClient(userId);
    const result = await client.uploadNzb(fileContent, uploadName);

    if (result?.status === "success") {
      await StatusManager.setHeader(userId, `upload_${uploadName}`, null);
      await StatusManager.startOrUpdate(ctx, userId, ctx.chat.id);
    } else {
      const error = result?.error || "Unknown";
      await StatusManager.setHeader(
        userId,
        `upload_${uploadName}`,
        `❌ Failed: ${uploadName} - ${error}`,
      );
      await new Promise((r) => setTimeout(r, 5000));
      await StatusManager.setHeader(userId, `upload_${uploadName}`, null);
    }
  } catch (e) {
    await StatusManager.setHeader(
      userId,
      `upload_${uploadName}`,
      `❌ Error: ${uploadName} - ${e.message.slice(0, 50)}`,
    );
    await new Promise((r) => setTimeout(r, 5000));
    await StatusManager.setHeader(userId, `upload_${uploadName}`, null);
  }
});

async function processAlbum(api, mgId, ctx) {
  const buffer = ALBUM_BUFFERS[mgId];
  if (!buffer) return;
  delete ALBUM_BUFFERS[mgId];

  const messages = buffer.messages.sort((a, b) => a.message_id - b.message_id);
  const userId = messages[0].from.id;
  const chatId = messages[0].chat.id;
  const total = messages.length;

  const client = getClient(userId);
  const batchKey = `batch_${mgId}`;

  await StatusManager.startOrUpdate(ctx, userId, chatId);
  await StatusManager.setHeader(
    userId,
    batchKey,
    `📦 Batch Upload: 0/${total} files`,
  );

  let successCount = 0;
  const failedTxt = [];
  const axios = require("axios");

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const doc = msg.document;
    const fileName = doc.file_name || "unknown_file";
    const isNzb = fileName.toLowerCase().endsWith(".nzb");
    const caption = msg.caption;
    let uploadName = caption ? caption.trim() : fileName;
    if (isNzb && caption && !uploadName.toLowerCase().endsWith(".nzb"))
      uploadName += ".nzb";

    await StatusManager.setHeader(
      userId,
      batchKey,
      `📦 Batch Upload: ${i + 1}/${total}\n📤 ${uploadName}`,
    );

    try {
      const fileObj = await api.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileObj.file_path}`;
      const res = await axios.get(fileUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
      });
      const fileContent = Buffer.from(res.data);

      if (LOG_GROUP_ID) {
        await forwardToLogGroup({ api }, chatId, msg.message_id, uploadName);
      }

      const result = await client.uploadNzb(fileContent, uploadName);
      if (result?.status === "success") {
        successCount++;
      } else {
        const err = (result?.error || "Unknown").slice(0, 30);
        failedTxt.push(`${uploadName} (${err})`);
      }
    } catch (e) {
      failedTxt.push(`${uploadName} (${e.message.slice(0, 30)})`);
    }
  }

  let summary = `✅ Batch Complete: ${successCount}/${total} uploaded`;
  if (failedTxt.length) {
    summary += `\n❌ Failed: ${failedTxt.length}`;
    failedTxt.slice(0, 3).forEach((f) => {
      summary += `\n  • ${f}`;
    });
    if (failedTxt.length > 3)
      summary += `\n  • ...and ${failedTxt.length - 3} more`;
  }

  await StatusManager.setHeader(userId, batchKey, summary);
  await new Promise((r) => setTimeout(r, 15000));
  await StatusManager.setHeader(userId, batchKey, null);
}

module.exports = { handleDocument };
