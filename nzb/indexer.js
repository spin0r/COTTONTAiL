/**
 * NZB Channel Backfill Indexer
 *
 * One-time script that scans ALL messages in the private log channel
 * using MTProto (GramJS) via a user account session, and populates
 * the SQLite FTS5 database.
 *
 * Usage:
 *   1. Set INDEXER_API_ID, INDEXER_API_HASH, INDEXER_SESSION in .env
 *      (run this script once without INDEXER_SESSION to generate one)
 *   2. node nzb/indexer.js
 *   3. Wait for completion — progress is printed to console
 *
 * This script is NOT imported by bot.js. It runs standalone.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram");
const readline = require("readline");

const db = require("./db");
const { extractKeywords } = require("./utils");

// ─── Config ───────────────────────────────────────────────────────────────────

const API_ID = parseInt(process.env.INDEXER_API_ID || "0", 10);
const API_HASH = process.env.INDEXER_API_HASH || "";
const SESSION = process.env.INDEXER_SESSION || "";
const LOG_GROUP_ID = parseInt(process.env.LOG_GROUP_ID || "0", 10);

if (!API_ID || !API_HASH) {
  console.error("Error: Set INDEXER_API_ID and INDEXER_API_HASH in .env");
  console.error("Get them from https://my.telegram.org → API Development Tools");
  process.exit(1);
}

if (!LOG_GROUP_ID) {
  console.error("Error: Set LOG_GROUP_ID in .env");
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const remainder = s % 60;
  return m > 0 ? `${m}m ${remainder}s` : `${s}s`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   NZB Channel Backfill Indexer       ║");
  console.log("╚══════════════════════════════════════╝");
  console.log();

  const session = new StringSession(SESSION);
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  // If no session string, go through interactive login
  if (!SESSION) {
    console.log("No INDEXER_SESSION found — starting interactive login...\n");
    await client.start({
      phoneNumber: async () => await prompt("📱 Phone number (with country code): "),
      password: async () => await prompt("🔑 2FA password (if enabled): "),
      phoneCode: async () => await prompt("📨 Verification code: "),
      onError: (err) => console.error("Login error:", err),
    });

    const sessionString = client.session.save();
    console.log("\n✅ Login successful!");
    console.log("┌──────────────────────────────────────────┐");
    console.log("│ Save this as INDEXER_SESSION in your .env │");
    console.log("└──────────────────────────────────────────┘");
    console.log(sessionString);
    console.log("\nRerun this script after saving the session.\n");
    await client.disconnect();
    process.exit(0);
  }

  await client.connect();
  console.log("✅ Connected to Telegram\n");

  // Resolve the channel entity
  let entity;
  try {
    entity = await client.getEntity(LOG_GROUP_ID);
    console.log(`📢 Channel: ${entity.title || entity.id}`);
  } catch (e) {
    console.error(`Failed to resolve channel ${LOG_GROUP_ID}:`, e.message);
    await client.disconnect();
    process.exit(1);
  }

  // Initialize the database
  db.init();

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalNonNzb = 0;
  let offsetId = 0;
  const BATCH_SIZE = 100;
  const INSERT_BATCH = [];
  const INSERT_BATCH_SIZE = 500;

  console.log("🔍 Scanning channel messages...\n");

  while (true) {
    let messages;
    try {
      messages = await client.invoke(
        new Api.messages.GetHistory({
          peer: entity,
          offsetId,
          offsetDate: 0,
          addOffset: 0,
          limit: BATCH_SIZE,
          maxId: 0,
          minId: 0,
          hash: BigInt(0),
        })
      );
    } catch (e) {
      console.error(`Failed to fetch messages (offsetId=${offsetId}):`, e.message);
      // Wait and retry once
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const msgs = messages.messages || [];
    if (!msgs.length) break;

    for (const msg of msgs) {
      totalProcessed++;
      offsetId = msg.id;

      // Only interested in documents
      if (!msg.media || msg.media.className !== "MessageMediaDocument") {
        totalNonNzb++;
        continue;
      }

      const doc = msg.media.document;
      if (!doc || !doc.attributes) {
        totalNonNzb++;
        continue;
      }

      // Find filename attribute
      const fileAttr = doc.attributes.find(
        (a) => a.className === "DocumentAttributeFilename"
      );
      if (!fileAttr) {
        totalNonNzb++;
        continue;
      }

      const fileName = fileAttr.fileName || "";
      if (!fileName.toLowerCase().endsWith(".nzb")) {
        totalNonNzb++;
        continue;
      }

      // Check if already indexed
      if (db.isIndexed(msg.id)) {
        totalSkipped++;
        continue;
      }

      const caption = msg.message || "";
      const keywords = extractKeywords(fileName, caption);
      const uploadedAt = msg.date
        ? new Date(msg.date * 1000).toISOString()
        : new Date().toISOString();

      INSERT_BATCH.push({
        msg_id: msg.id,
        file_name: fileName,
        caption: caption,
        keywords: keywords,
        file_type: "nzb",
        uploaded_at: uploadedAt,
      });

      // Flush batch to DB when full
      if (INSERT_BATCH.length >= INSERT_BATCH_SIZE) {
        const count = db.bulkInsert(INSERT_BATCH);
        totalInserted += count;
        INSERT_BATCH.length = 0;
      }
    }

    // Progress
    const elapsed = formatDuration(Date.now() - startTime);
    process.stdout.write(
      `\r⏳ Processed: ${totalProcessed} | NZB: ${totalInserted + INSERT_BATCH.length} | Skipped: ${totalSkipped} | Elapsed: ${elapsed}  `
    );

    // Small delay to avoid hitting rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  // Flush remaining batch
  if (INSERT_BATCH.length > 0) {
    const count = db.bulkInsert(INSERT_BATCH);
    totalInserted += count;
    INSERT_BATCH.length = 0;
  }

  const elapsed = formatDuration(Date.now() - startTime);

  console.log("\n\n═══════════════════════════════════════");
  console.log("            BACKFILL COMPLETE           ");
  console.log("═══════════════════════════════════════");
  console.log(`  Total messages scanned:  ${totalProcessed}`);
  console.log(`  NZB files indexed:       ${totalInserted}`);
  console.log(`  Already in DB (skipped): ${totalSkipped}`);
  console.log(`  Non-NZB messages:        ${totalNonNzb}`);
  console.log(`  Total in database:       ${db.getCount()}`);
  console.log(`  Time elapsed:            ${elapsed}`);
  console.log("═══════════════════════════════════════\n");

  db.close();
  await client.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("\nFatal error:", e);
  process.exit(1);
});
