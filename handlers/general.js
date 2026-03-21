const {
  restricted,
  getClient,
  fetchMagicCookies,
  setVersionInfo,
  AUTHORIZED_USERS,
  approveUser,
  disapproveUser,
  getApprovedUsers,
  getAvailableCookieProfiles,
  fetchProfileCookies,
  BOT_VERSION,
  VERSION_IMAGE_URL,
} = require("../utils/helpers");
const TelegraphClient = require("../telegraphClient");

const start = restricted(async (ctx) => {
  await ctx.reply(
    "Welcome to MagicNZB Bot!\n\n" +
      "Commands:\n" +
      "/login <cookie_string> - Set your MagicNZB cookies\n" +
      "/list - List active transfers\n" +
      "/extract - Extract links from finished transfers\n" +
      "/delete <id> or /delete all - Delete transfers\n" +
      "/local - Manage local files\n" +
      "/files - Browse & manage NZB files (inline buttons)",
  );
});

const login = restricted(async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.match
    ? ctx.match.trim()
    : ctx.message?.text?.split(" ").slice(1).join(" ") || "";
  if (!args) {
    await ctx.reply("Usage: /login <cookie_string>");
    return;
  }
  const client = getClient(userId);
  client.updateCookies(args);
  await ctx.reply("Cookies updated. Try /list to verify.");
});

const versionCommand = async (ctx) => {
  const ver = BOT_VERSION();
  const imgUrl = VERSION_IMAGE_URL();
  if (imgUrl) {
    try {
      const message = `<a href="${imgUrl}">​</a><b><code>${ver}</code></b>`;
      await ctx.reply(message, {
        parse_mode: "HTML",
        disable_web_page_preview: false,
      });
      return;
    } catch (_) {}
  }
  await ctx.reply(`<b><code>${ver}</code></b>`, { parse_mode: "HTML" });
};

const setCommand = restricted(async (ctx) => {
  const currentVer = BOT_VERSION();
  const prefixMatch = currentVer.match(/^(v[\d.]+)/);
  const prefix = prefixMatch ? prefixMatch[1] : "v6.0";

  ctx.session._setPrefix = prefix;
  ctx.session._setState = "awaiting_name";
  await ctx.reply("📝 Enter the version name:");
});

const cookiesCommand = restricted(async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message?.text?.trim() || "";
  const match = text.match(/^\/(cook|cookies)_(.+)$/);

  if (!match) {
    const msg = await ctx.reply("Fetching available cookie profiles...");
    const profiles = await getAvailableCookieProfiles();
    if (profiles.length) {
      const pList = profiles.map((p) => `• \`/cook_${p}\``).join("\n");
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        `🍪 **Available Cookie Profiles:**\n\n${pList}`,
        { parse_mode: "Markdown" },
      );
    } else {
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        "❌ No profiles found on index (or failed to fetch).",
      );
    }
    return;
  }

  const profileName = match[2];
  const msg = await ctx.reply(
    `Fetching cookies for profile: \`${profileName}\`...`,
    { parse_mode: "Markdown" },
  );

  const success = await fetchMagicCookies(profileName);
  if (success) {
    const {
      MAGIC_COOKIES,
      ACTIVE_ACCOUNT_EMAIL,
      ACTIVE_ACCOUNT_EXPIRY,
      ACTIVE_ACCOUNT_TRAFFIC,
    } = require("../utils/helpers");
    const client = getClient(userId);
    client.updateCookies(MAGIC_COOKIES());
    const renewRes = await client.renewFreeTrial();
    const renewed =
      renewRes?.success || renewRes?.message === "Trial activated";
    const email = ACTIVE_ACCOUNT_EMAIL();
    const expiry = ACTIVE_ACCOUNT_EXPIRY() || "Unknown";
    const traffic = ACTIVE_ACCOUNT_TRAFFIC() || "unlimited";
    const infoStr = email
      ? `\nUser: **${email}**\nExpiry: **${expiry}**\nTraffic: **${traffic}**`
      : "";
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `✅ Cookies updated! (${profileName})${infoStr}${renewed ? "\n🔄 Free trial renewed." : ""}`,
      { parse_mode: "Markdown" },
    );
  } else {
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      "❌ Failed to fetch cookies. Check logs.",
    );
  }
});

const setReplyHandler = restricted(async (ctx) => {
  const state = ctx.session._setState;
  if (!state) return false;

  const text = ctx.message?.text?.trim() || "";
  const prefix = ctx.session._setPrefix || "v6.0";

  if (state === "awaiting_name") {
    ctx.session._setName = text;
    ctx.session._setState = "awaiting_url";
    await ctx.reply("🖼 Enter the image URL (or send `-` to skip):");
    return true;
  }

  if (state === "awaiting_url") {
    const name = ctx.session._setName || "Cotton";
    const fullVersion = `${prefix}: ${name}`;
    const url = text === "-" || !text.startsWith("http") ? null : text;

    setVersionInfo(fullVersion, url);

    ctx.session._setState = null;
    ctx.session._setName = null;
    ctx.session._setPrefix = null;

    await ctx.reply(
      `✅ Version updated:\n<b><code>${fullVersion}</code></b>${url ? `\nImage: <code>${url}</code>` : ""}`,
      { parse_mode: "HTML" },
    );
    return true;
  }

  return false;
});

const approveCommand = async (ctx) => {
  const userId = ctx.from.id;
  if (AUTHORIZED_USERS.length && !AUTHORIZED_USERS.includes(userId)) {
    await ctx.reply("⛔ Only bot owners can use this command.");
    return;
  }
  const text = ctx.message?.text || "";
  const args = text.split(" ").slice(1).filter(Boolean);
  if (!args.length) {
    await ctx.reply("Usage: /approve <user_id>");
    return;
  }
  const targetId = parseInt(args[0], 10);
  if (isNaN(targetId)) {
    await ctx.reply("❌ Invalid user ID.");
    return;
  }
  if (approveUser(targetId)) {
    await ctx.reply(`✅ User <code>${targetId}</code> has been approved.`, {
      parse_mode: "HTML",
    });
  } else {
    await ctx.reply(`ℹ️ User <code>${targetId}</code> is already approved.`, {
      parse_mode: "HTML",
    });
  }
};

const disapproveCommand = async (ctx) => {
  const userId = ctx.from.id;
  if (AUTHORIZED_USERS.length && !AUTHORIZED_USERS.includes(userId)) {
    await ctx.reply("⛔ Only bot owners can use this command.");
    return;
  }
  const text = ctx.message?.text || "";
  const args = text.split(" ").slice(1).filter(Boolean);
  if (!args.length) {
    await ctx.reply("Usage: /disapprove <user_id>");
    return;
  }
  const targetId = parseInt(args[0], 10);
  if (isNaN(targetId)) {
    await ctx.reply("❌ Invalid user ID.");
    return;
  }
  if (disapproveUser(targetId)) {
    await ctx.reply(`🚫 User <code>${targetId}</code> has been removed.`, {
      parse_mode: "HTML",
    });
  } else {
    await ctx.reply(
      `ℹ️ User <code>${targetId}</code> was not in the approved list.`,
      { parse_mode: "HTML" },
    );
  }
};

const approvedCommand = async (ctx) => {
  const userId = ctx.from.id;
  if (AUTHORIZED_USERS.length && !AUTHORIZED_USERS.includes(userId)) {
    await ctx.reply("⛔ Only bot owners can use this command.");
    return;
  }
  const users = getApprovedUsers();
  if (users.length) {
    const userList = users.map((uid) => `• <code>${uid}</code>`).join("\n");
    await ctx.reply(`👥 <b>Approved Users:</b>\n${userList}`, {
      parse_mode: "HTML",
    });
  } else {
    await ctx.reply("No approved users yet.");
  }
};

const tdelCommand = restricted(async (ctx) => {
  const reply = ctx.message?.reply_to_message;
  if (!reply) {
    await ctx.reply("REPLY to a message containing the Telegraph link.");
    return;
  }

  const text = reply.text || reply.caption || "";
  let match = text.match(/telegra\.ph\/([a-zA-Z0-9-]+)/);

  if (!match) {
    const entities = [
      ...(reply.entities || []),
      ...(reply.caption_entities || []),
    ];
    for (const ent of entities) {
      const url = ent.url || "";
      const m = url.match(/telegra\.ph\/([a-zA-Z0-9-]+)/);
      if (m) {
        match = m;
        break;
      }
    }
  }

  if (!match) {
    await ctx.reply("No Telegraph link found in replied message.");
    return;
  }

  const path = match[1];
  const token = process.env.TELEGRAPH_TOKEN;
  if (!token) {
    await ctx.reply("❌ Telegraph Token not found on server.");
    return;
  }

  const client = new TelegraphClient(token);
  const res = await client.editPage(path, "Deleted Page", [
    { tag: "p", children: ["This page has been deleted by the bot."] },
  ]);

  if (res) {
    await ctx.reply(`✅ Page '${path}' deleted (content cleared).`);
  } else {
    await ctx.reply("❌ Failed to delete. Maybe I didn't create it?");
  }
});

const renewCommand = restricted(async (ctx) => {
  const msg = await ctx.reply("🔍 checking accounts...");
  const MagicClient = require("../client");

  const profiles = await getAvailableCookieProfiles();
  if (!profiles.length) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      "❌ No profiles found.",
    );
    return;
  }

  const results = [];

  for (const profile of profiles) {
    const cookieStr = await fetchProfileCookies(profile);
    if (!cookieStr) {
      results.push(`❌ \`${profile}\`: Failed to fetch cookies`);
      continue;
    }

    const tempClient = new MagicClient(cookieStr);
    const info = await tempClient.getAccountInfo();

    if (!info) {
      results.push(`⚠️ \`${profile}\`: Failed to get info`);
      continue;
    }

    const daysStr = (info.days_left || "").trim();
    let isExpired = false;
    let notes = "";

    if (daysStr.toLowerCase().includes("expired")) {
      isExpired = true;
    } else {
      try {
        const expiry = new Date(daysStr);
        if (!isNaN(expiry.getTime())) {
          if (expiry < new Date()) {
            isExpired = true;
          } else {
            const diff = Math.floor(
              (expiry - new Date()) / (1000 * 60 * 60 * 24),
            );
            notes = `(${diff} days left)`;
          }
        } else {
          notes = `(Date: ${daysStr})`;
        }
      } catch (_) {
        notes = `(Date: ${daysStr})`;
      }
    }

    if (isExpired) {
      const renewClient = new MagicClient(cookieStr);
      const renewRes = await renewClient.renewFreeTrial();
      if (renewRes?.success || renewRes?.message === "Trial activated") {
        results.push(`✅ \`${profile}\`: **RENEWED**`);
      } else {
        const err = renewRes?.error || renewRes?.message || "Unknown error";
        results.push(`❌ \`${profile}\`: Renew Failed (${err})`);
      }
    } else {
      results.push(`ℹ️ \`${profile}\`: Active ${notes}`);
    }
  }

  let report = results.join("\n");
  if (report.length > 4000) report = report.slice(0, 4000) + "\n...(truncated)";
  await ctx.api.editMessageText(
    ctx.chat.id,
    msg.message_id,
    `🔄 **Renew Check Complete**\n\n${report}`,
    { parse_mode: "Markdown" },
  );
});

module.exports = {
  start,
  login,
  versionCommand,
  setCommand,
  setReplyHandler,
  cookiesCommand,
  approveCommand,
  disapproveCommand,
  approvedCommand,
  tdelCommand,
  renewCommand,
};
