/**
 * One-time session generator for MTProto userbot.
 *
 * Run:  npx ts-node src/utils/generate-session.ts
 *
 * It will ask for your phone number, verification code, and 2FA password (if enabled).
 * At the end, it prints your INDEXER_SESSION string — paste it into your .env file.
 *
 * Prerequisites:
 *   1. Go to https://my.telegram.org → API development tools
 *   2. Create an app to get API_ID and API_HASH
 *   3. Set INDEXER_API_ID and INDEXER_API_HASH in your .env BEFORE running this script
 */

import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import * as readline from "readline";

const apiId = parseInt(process.env.INDEXER_API_ID ?? "", 10);
const apiHash = process.env.INDEXER_API_HASH ?? "";

if (!apiId || !apiHash) {
  console.error("\n❌ INDEXER_API_ID and INDEXER_API_HASH must be set in .env first!");
  console.error("   Get them from: https://my.telegram.org → API development tools\n");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

(async () => {
  console.log("\n🔐 Telegram MTProto Session Generator\n");

  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 3 });

  await client.start({
    phoneNumber: async () => await ask("📱 Phone number (with country code, e.g. +91...): "),
    password: async () => await ask("🔑 2FA Password (leave blank if none): "),
    phoneCode: async () => await ask("📨 Verification code: "),
    onError: (err) => console.error("Error:", err.message),
  });

  const sessionString = client.session.save() as unknown as string;

  console.log("\n✅ Logged in successfully!\n");
  console.log("━".repeat(60));
  console.log("Add this to your .env file:\n");
  console.log(`INDEXER_SESSION=${sessionString}`);
  console.log("━".repeat(60));
  console.log("\n💡 This session string does NOT expire unless you revoke it from Telegram settings.\n");

  await client.disconnect();
  rl.close();
  process.exit(0);
})();
