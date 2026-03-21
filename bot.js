require("dotenv").config();
const { Bot, session } = require("grammy");
const { TELEGRAM_TOKEN } = require("./config");
const { startWebServer } = require("./utils/server");

// Handlers
const {
  start,
  login,
  versionCommand,
  setCommand,
  setReplyHandler,
  cookiesCommand,
  tdelCommand,
  renewCommand,
  approveCommand,
  disapproveCommand,
  approvedCommand,
} = require("./handlers/general");
const {
  listTransfers,
  transfersCommand,
  searchCommand,
  deleteCommand,
  handleViewCommand,
  handleDeleteCommand,
  transferButtonHandler,
  historyButtonHandler,
  searchButtonHandler,
} = require("./handlers/transfers");
const { extract, cancelCommand } = require("./handlers/extract");
const { handleDocument } = require("./handlers/files");
const { localCommand, filenameReplyHandler } = require("./handlers/local");
const {
  filesCommand,
  filesButtonHandler,
  handleUploadCommand,
  handleDelCommand,
  handleBatchUploadCommand,
} = require("./handlers/filesManager");

async function main() {
  const token = process.env.TELEGRAM_TOKEN || TELEGRAM_TOKEN;
  if (!token) {
    console.error("Error: TELEGRAM_TOKEN not found in .env or config.");
    process.exit(1);
  }

  const bot = new Bot(token);

  // Session middleware (for search state)
  bot.use(session({ initial: () => ({}) }));

  // Commands
  bot.command("start", start);
  bot.command("login", login);
  bot.command(["list", "l"], listTransfers);
  bot.command("transfers", transfersCommand);
  bot.command("search", searchCommand);
  bot.command(["extract", "e"], extract);
  bot.command("delete", deleteCommand);
  bot.command("v", versionCommand);
  bot.command("set", setCommand);
  bot.command("renew", renewCommand);
  bot.command("cancel", cancelCommand);
  bot.command("tdel", tdelCommand);
  bot.command("approve", approveCommand);
  bot.command("disapprove", disapproveCommand);
  bot.command("approved", approvedCommand);
  bot.command("local", localCommand);
  bot.command("files", filesCommand);

  // /cook and /cookies (with optional _profile suffix)
  bot.hears(/^\/(cook|cookies)/, cookiesCommand);

  // Regex-based text commands
  bot.hears(/^\/view_\w+/, handleViewCommand);
  bot.hears(/^\/delete_\w+/, handleDeleteCommand);
  bot.hears(/^\/upload_\d+_\d+/, handleBatchUploadCommand);
  bot.hears(/^\/upload_\d+$/, handleUploadCommand);
  bot.hears(/^\/del_\d+$/, handleDelCommand);

  // Document handler
  bot.on("message:document", handleDocument);

  // Text reply handler (for zip filename and /set flow)
  bot.on("message:text", async (ctx) => {
    if (ctx.session._setState) {
      await setReplyHandler(ctx);
      return;
    }
    if (ctx.message?.reply_to_message) {
      await filenameReplyHandler(ctx);
    }
  });

  // Callback query handlers
  bot.callbackQuery(/^list_/, transferButtonHandler);
  bot.callbackQuery(/^history_/, historyButtonHandler);
  bot.callbackQuery(/^search_/, searchButtonHandler);
  bot.callbackQuery(/^fm_/, filesButtonHandler);

  // Start web server
  await startWebServer(bot);

  console.log("Bot is running...");
  bot.start();
}

main().catch(console.error);
