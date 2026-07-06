import "dotenv/config";
import { Bot, session, Context, SessionFlavor } from "grammy";
import { TELEGRAM_TOKEN } from "./config";
import { startWebServer } from "./utils/server";
import * as nzbDb from "./nzb/db";
import { startBackupScheduler, autoRestore } from "./nzb/backup";
import type { BotSession } from "./types";

// Extend Context with session flavor
export type MyContext = Context & SessionFlavor<BotSession>;

// Handlers
import {
  start, login, versionCommand, setCommand, setReplyHandler, cookiesCommand,
  tdelCommand, renewCommand, approveCommand, disapproveCommand, approvedCommand,
  backupCommand, restoreCommand, backupInfoCommand,
} from "./handlers/general";
import {
  listTransfers, transfersCommand, searchCommand, deleteCommand,
  handleViewCommand, handleDeleteCommand, transferButtonHandler,
  historyButtonHandler, searchButtonHandler,
} from "./handlers/transfers";
import { extract, cancelCommand } from "./handlers/extract";
import { handleDocument } from "./handlers/files";
import { localCommand, filenameReplyHandler } from "./handlers/local";
import {
  filesCommand, filesButtonHandler, handleUploadCommand,
  handleDelCommand, handleBatchUploadCommand,
} from "./handlers/filesManager";
import {
  handleNzbUpload, nzbSearchCommand, nzbStatsCommand,
  logsButtonHandler, grabNzbCommand, aiRenameCommand,
} from "./handlers/nzb";

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_TOKEN || TELEGRAM_TOKEN;
  if (!token) {
    console.error("Error: TELEGRAM_TOKEN not found in .env or config.");
    process.exit(1);
  }

  await autoRestore();

  nzbDb.init();
  console.log(`[NZB-DB] ${nzbDb.getCount()} files indexed.`);

  const bot = new Bot<MyContext>(token);

  bot.use(session({ initial: (): BotSession => ({}) }));

  // Commands
  bot.command("start", start as any);
  bot.command("login", login as any);
  bot.command(["list", "l"], listTransfers as any);
  bot.command("transfers", transfersCommand as any);
  bot.command("search", searchCommand as any);
  bot.command(["extract", "e"], extract as any);
  bot.command("delete", deleteCommand as any);
  bot.command("v", versionCommand as any);
  bot.command("set", setCommand as any);
  bot.command("renew", renewCommand as any);
  bot.command("cancel", cancelCommand as any);
  bot.command("tdel", tdelCommand as any);
  bot.command("approve", approveCommand as any);
  bot.command("disapprove", disapproveCommand as any);
  bot.command("approved", approvedCommand as any);
  bot.command("local", localCommand as any);
  bot.command("files", filesCommand as any);
  bot.command("log", nzbSearchCommand as any);
  bot.command("nzbstats", nzbStatsCommand as any);
  bot.command("backup", backupCommand as any);
  bot.command("restore", restoreCommand as any);
  bot.command("backupinfo", backupInfoCommand as any);

  // Regex-based commands
  bot.hears(/^\/(cook|cookies)/, cookiesCommand as any);
  bot.hears(/^\/view_\w+/, handleViewCommand as any);
  bot.hears(/^\/delete_\w+/, handleDeleteCommand as any);
  bot.hears(/^\/upload_\d+_\d+/, handleBatchUploadCommand as any);
  bot.hears(/^\/upload_\d+$/, handleUploadCommand as any);
  bot.hears(/^\/del_\d+$/, handleDelCommand as any);
  bot.hears(/^\/grab_\d+$/, grabNzbCommand as any);
  bot.hears(/^\/rename_\d+$/, aiRenameCommand as any);

  // Document handler — NZB intercept first
  bot.on("message:document", async (ctx) => {
    const handled = await handleNzbUpload(ctx);
    if (!handled) await handleDocument(ctx);
  });

  // Text reply handler
  bot.on("message:text", async (ctx) => {
    if ((ctx.session as BotSession)._setState) {
      await setReplyHandler(ctx as any);
      return;
    }
    if (ctx.message?.reply_to_message) {
      await filenameReplyHandler(ctx);
    }
  });

  // Callback query handlers
  bot.callbackQuery(/^list_/, transferButtonHandler as any);
  bot.callbackQuery(/^history_/, historyButtonHandler as any);
  bot.callbackQuery(/^search_/, searchButtonHandler as any);
  bot.callbackQuery(/^logs_/, logsButtonHandler as any);
  bot.callbackQuery(/^fm_/, filesButtonHandler as any);

  await startWebServer(bot);

  startBackupScheduler();

  console.log("Bot is running...");
  bot.start();
}

main().catch(console.error);
