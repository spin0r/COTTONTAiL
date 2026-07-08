/**
 * GramJS Userbot Client — MTProto fallback for deleting messages the Bot API can't handle.
 *
 * Uses the same INDEXER_* env vars from .env:
 *   INDEXER_API_ID     — from https://my.telegram.org
 *   INDEXER_API_HASH   — from https://my.telegram.org
 *   INDEXER_SESSION    — StringSession (generate via: npx ts-node src/utils/generate-session.ts)
 */

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { log } from "./logger";

let _client: TelegramClient | null = null;
let _connecting: Promise<TelegramClient> | null = null;

function getConfig() {
  const apiId = parseInt(process.env.INDEXER_API_ID ?? "", 10);
  const apiHash = process.env.INDEXER_API_HASH ?? "";
  const session = process.env.INDEXER_SESSION ?? "";
  if (!apiId || !apiHash || !session) return null;
  return { apiId, apiHash, session };
}

/** Returns true if userbot env vars are configured */
export function isUserbotConfigured(): boolean {
  return getConfig() !== null;
}

/** Get or create a connected GramJS client (lazy singleton) */
async function getClient(): Promise<TelegramClient | null> {
  if (_client?.connected) return _client;

  // Avoid duplicate connection attempts
  if (_connecting) return _connecting;

  const cfg = getConfig();
  if (!cfg) return null;

  _connecting = (async () => {
    try {
      const client = new TelegramClient(
        new StringSession(cfg.session),
        cfg.apiId,
        cfg.apiHash,
        { connectionRetries: 3 }
      );
      await client.connect();
      log.info("USERBOT", "MTProto client connected");
      _client = client;
      return client;
    } catch (e: any) {
      log.error("USERBOT", `MTProto connection failed — ${e.message}`);
      _client = null;
      throw e;
    } finally {
      _connecting = null;
    }
  })();

  return _connecting;
}

/**
 * Delete a message via MTProto userbot.
 * Returns true if successful, false otherwise.
 */
export async function userbotDeleteMessage(chatId: number, msgId: number): Promise<boolean> {
  try {
    const client = await getClient();
    if (!client) return false;

    const result = await client.invoke(
      new Api.channels.DeleteMessages({
        channel: chatId,
        id: [msgId],
      })
    );

    const deleted = (result as any)?.ptsCount > 0;
    if (deleted) {
      log.info("USERBOT", `Deleted message ${msgId} from ${chatId} via MTProto`);
    }
    return deleted;
  } catch (e: any) {
    log.error("USERBOT", `MTProto delete failed (msg_id=${msgId}, chat_id=${chatId}) — ${e.message}`);
    return false;
  }
}

/**
 * Bulk delete messages via MTProto userbot.
 * Returns count of successfully deleted messages.
 */
export async function userbotDeleteMessages(chatId: number, msgIds: number[]): Promise<number> {
  try {
    const client = await getClient();
    if (!client) return 0;

    const result = await client.invoke(
      new Api.channels.DeleteMessages({
        channel: chatId,
        id: msgIds,
      })
    );

    const count = (result as any)?.ptsCount ?? 0;
    if (count > 0) {
      log.info("USERBOT", `Bulk deleted ${count} messages from ${chatId} via MTProto`);
    }
    return count;
  } catch (e: any) {
    log.error("USERBOT", `MTProto bulk delete failed (chat_id=${chatId}) — ${e.message}`);
    return 0;
  }
}
