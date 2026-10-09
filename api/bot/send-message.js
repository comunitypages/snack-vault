
const BOT_ID = "afterhoursai";
const CHANNEL_ID = "underscorepower";

function readSecret(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ")
    ? header.slice(7)
    : "";
}

async function getTwitchUserId(recordId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const response = await fetch(
    `${url}/rest/v1/private_twitch_bot_tokens` +
    `?id=eq.${recordId}&select=twitch_user_id,twitch_login`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    }
  );

  if (!response.ok) {
    throw new Error("Could not read Twitch account from Supabase.");
  }

  const rows = await response.json();

  if (
    rows.length !== 1 ||
    rows[0].twitch_login.toLowerCase() !== recordId
  ) {
    throw new Error(`${recordId} is not connected.`);
  }

  return rows[0].twitch_user_id;
}

async function getAppAccessToken() {
  const response = await fetch(
    "https://id.twitch.tv/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: "client_credentials"
      })
    }
  );

  if (!response.ok) {
    throw new Error("Could not obtain Twitch app token.");
  }

  const data = await response.json();
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Allow", "POST");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Use POST to send a message."
    });
  }

  const required = [
    "BOT_API_SECRET",
    "TWITCH_CLIENT_ID",
    "TWITCH_CLIENT_SECRET",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY"
  ];

  if (required.some(name => !process.env[name])) {
    return res.status(500).json({
      error: "Server configuration incomplete."
    });
  }

  const provided = readSecret(req);
  const expected = process.env.BOT_API_SECRET;

  // Constant-time secret comparison.
  const { timingSafeEqual } = await import("node:crypto");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (
    a.length !== b.length ||
    !timingSafeEqual(a, b)
  ) {
    return res.status(401).json({
      error: "Unauthorized."
    });
  }

  const message = req.body?.message;

  if (
    typeof message !== "string" ||
    message.trim().length === 0 ||
    message.length > 500
  ) {
    return res.status(400).json({
      error: "Message must contain 1-500 characters."
    });
  }

  try {
    const [senderId, broadcasterId, appToken] =
      await Promise.all([
        getTwitchUserId(BOT_ID),
        getTwitchUserId(CHANNEL_ID),
        getAppAccessToken()
      ]);

    const response = await fetch(
      "https://api.twitch.tv/helix/chat/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Client-Id": process.env.TWITCH_CLIENT_ID,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          broadcaster_id: broadcasterId,
          sender_id: senderId,
          message: message.trim()
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error(
        "Twitch chat API error:",
        response.status,
        result
      );

      return res.status(502).json({
        success: false,
        error: "Twitch rejected the message.",
        twitch_status: response.status,
        details: result.message || "Check Vercel logs."
      });
    }

    const sent = result.data?.[0];

    if (!sent?.is_sent) {
      return res.status(422).json({
        success: false,
        error: "Twitch did not send the message.",
        reason: sent?.drop_reason || null
      });
    }

    return res.status(200).json({
      success: true,
      sender: BOT_ID,
      channel: CHANNEL_ID,
      message_id: sent.message_id,
      message: message.trim()
    });
  } catch (error) {
    console.error("Bot send failed:", error);

    return res.status(500).json({
      success: false,
      error: "Bot message failed. Check Vercel logs."
    });
  }
}
