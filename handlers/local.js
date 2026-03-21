const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const {
  restricted,
  DOWNLOAD_DIR,
  LOG_GROUP_ID,
  sendToLogGroupSafe,
} = require("../utils/helpers");

const PENDING_ZIPS = {};

async function createZipBuffer(selectedFiles) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    for (const fname of selectedFiles) {
      const fpath = path.join(DOWNLOAD_DIR, fname);
      archive.file(fpath, { name: fname });
    }
    archive.finalize();
  });
}

async function executeZip(ctx, selection, filename) {
  if (!fs.existsSync(DOWNLOAD_DIR))
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const files = fs
    .readdirSync(DOWNLOAD_DIR)
    .filter((f) => f.endsWith(".nzb"))
    .sort();
  let selectedFiles = [];

  if (selection.toLowerCase() === "all") {
    selectedFiles = files;
  } else {
    const indices = new Set();
    for (const part of selection.split(",")) {
      if (part.includes("-")) {
        const [s, e] = part.split("-").map(Number);
        for (let i = s; i <= e; i++) indices.add(i);
      } else if (part.trim()) {
        indices.add(parseInt(part, 10));
      }
    }
    for (const idx of indices) {
      if (idx >= 1 && idx <= files.length) selectedFiles.push(files[idx - 1]);
    }
  }

  if (!selectedFiles.length) {
    await ctx.reply("No valid files selected.");
    return;
  }

  let zipName = filename.toLowerCase().endsWith(".zip")
    ? filename
    : filename + ".zip";
  let displayName = zipName;
  if (zipName.length > 60) {
    const ext = path.extname(zipName);
    displayName = zipName.slice(0, 60 - ext.length) + ext;
  }

  const zipBuffer = await createZipBuffer(selectedFiles);
  const caption = `Here is your zip with ${selectedFiles.length} files.${displayName !== zipName ? `\n\nOriginal Filename: ${zipName}` : ""}`;

  if (LOG_GROUP_ID) {
    const { InputFile } = require("grammy");
    await sendToLogGroupSafe(
      ctx,
      new InputFile(zipBuffer, displayName),
      displayName,
      caption,
    );
  }

  const { InputFile } = require("grammy");
  await ctx.replyWithDocument(new InputFile(zipBuffer, displayName), {
    caption,
  });
}

const localCommand = restricted(async (ctx) => {
  const text = ctx.message?.text || "";
  const args = text.split(" ").slice(1).filter(Boolean);

  if (!args.length) {
    await ctx.reply(
      "Usage:\n" +
        "/local list - List files\n" +
        "/local zip <1,2-4|all> - Download zip\n" +
        "/local delete <1,2-4|all> - Delete files\n" +
        "/local clear - Delete ALL files",
    );
    return;
  }

  const subcmd = args[0].toLowerCase();
  if (!fs.existsSync(DOWNLOAD_DIR))
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const files = fs
    .readdirSync(DOWNLOAD_DIR)
    .filter((f) => f.endsWith(".nzb"))
    .sort();

  if (subcmd === "list") {
    if (!files.length) {
      await ctx.reply("No local files found.");
      return;
    }
    let msg = `Local NZB Files (${files.length}):\n`;
    for (let i = 0; i < files.length; i++) {
      const line = `${i + 1}. ${files[i]}\n`;
      if (msg.length + line.length > 4000) {
        await ctx.reply(msg);
        msg = "";
      }
      msg += line;
    }
    if (msg.trim()) await ctx.reply(msg);
  } else if (subcmd === "zip") {
    if (!files.length) {
      await ctx.reply("No files to zip.");
      return;
    }
    if (args.length < 2) {
      await ctx.reply("Usage: /local zip <indices|all> [filename]");
      return;
    }

    const selection = args[1];
    const userId = ctx.from.id;

    if (args.length > 2) {
      const customName = args
        .slice(2)
        .join(" ")
        .replace(/[^a-zA-Z0-9 _-]/g, "");
      await executeZip(ctx, selection, customName);
    } else {
      PENDING_ZIPS[userId] = selection;
      await ctx.reply("Please enter a name for the zip file:", {
        reply_markup: { force_reply: true, selective: true },
      });
    }
  } else if (subcmd === "delete" || subcmd === "clear") {
    if (!files.length) {
      await ctx.reply("No files to delete.");
      return;
    }

    let target = subcmd === "clear" ? "all" : args.slice(1).join(" ").trim();
    if (!target) {
      await ctx.reply("Usage: /local delete <indices|all>");
      return;
    }

    let toDelete = [];
    if (target.toLowerCase() === "all") {
      toDelete = files;
    } else {
      const indices = new Set();
      for (const part of target.split(",")) {
        if (part.includes("-")) {
          const [s, e] = part.split("-").map(Number);
          for (let i = s; i <= e; i++) indices.add(i);
        } else if (part.trim()) {
          indices.add(parseInt(part, 10));
        }
      }
      for (const idx of indices) {
        if (idx >= 1 && idx <= files.length) toDelete.push(files[idx - 1]);
      }
    }

    if (!toDelete.length) {
      await ctx.reply("No files selected.");
      return;
    }

    let count = 0;
    for (const fname of toDelete) {
      try {
        fs.unlinkSync(path.join(DOWNLOAD_DIR, fname));
        count++;
      } catch (e) {
        console.error(e.message);
      }
    }
    await ctx.reply(`Deleted ${count} files.`);
  } else {
    await ctx.reply("Unknown subcommand. Use list, zip, delete, or clear.");
  }
});

const filenameReplyHandler = async (ctx) => {
  const userId = ctx.from.id;
  if (PENDING_ZIPS[userId]) {
    const selection = PENDING_ZIPS[userId];
    delete PENDING_ZIPS[userId];
    const customName = (ctx.message?.text || "")
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, "");
    await executeZip(ctx, selection, customName);
  }
};

module.exports = { localCommand, filenameReplyHandler };
