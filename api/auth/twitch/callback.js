
import {
  createCipheriv,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const BOT_LOGIN = "afterhoursai";

function safeEqual(a, b) {
  const x = Buffer.from(a || "");
  const y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
}

function encrypt(value) {
  const key = Buffer.from(
    process.env.TWITCH_TOKEN_ENCRYPTION_KEY || "",
    "base64"
  );

  if (key.length !== 32) {
    throw new Error("Invalid token encryption key");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);

  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64")
  ].join(".");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map(part => {
        const i = part.indexOf("=");
        return i < 0
          ? []
          : [part.slice(0, i).trim(), part.slice(i + 1)];
      })
      .filter(pair => pair.length === 2)
  );

  const { code, state, error } = req.query;

  res.setHeader(
    "Set-Cookie",
    "twitch_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/twitch; Max-Age=0"
  );

  if (error) {
    return res.status(400).send("Twitch authorization cancelled.");
  }

  if (
    typeof code !== "string" ||
    typeof state !== "string" ||
    !cookies.twitch_oauth_state ||
    !safeEqual(state, cookies.twitch_oauth_state)
  ) {
    return res.status(403).send("Invalid or expired login request.");
  }

  const {
    TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET,
    TWITCH_REDIRECT_URI,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    TWITCH_TOKEN_ENCRYPTION_KEY
  } = process.env;

  if (
    !TWITCH_CLIENT_ID ||
    !TWITCH_CLIENT_SECRET ||
    !TWITCH_REDIRECT_URI ||
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !TWITCH_TOKEN_ENCRYPTION_KEY
  ) {
    return res.status(500).send("Server configuration incomplete.");
  }

  try {
    const tokenResponse = await fetch(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: TWITCH_CLIENT_ID,
          client_secret: TWITCH_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: TWITCH_REDIRECT_URI
        })
      }
    );

    if (!tokenResponse.ok) {
      return res.status(502).send("Twitch authorization failed.");
    }

    const tokens = await tokenResponse.json();

    if (!tokens.access_token || !tokens.refresh_token) {
      return res.status(502).send("Missing Twitch tokens.");
    }

    const userResponse = await fetch(
      "https://api.twitch.tv/helix/users",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Client-Id": TWITCH_CLIENT_ID
        }
      }
    );

    if (!userResponse.ok) {
      return res.status(502).send("Could not verify Twitch account.");
    }

    const userData = await userResponse.json();
    const account = userData.data?.[0];

    if (account?.login?.toLowerCase() !== BOT_LOGIN) {
      return res.status(403).send(
        "Please sign in with the AfterHoursAI Twitch account."
      );
    }

    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    const storageResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/private_twitch_bot_tokens?on_conflict=id`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          id: "afterhoursai",
          twitch_user_id: account.id,
          twitch_login: account.login,
          access_token: encrypt(tokens.access_token),
          refresh_token: encrypt(tokens.refresh_token),
          expires_at: expiresAt,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!storageResponse.ok) {
      console.error(
        "Supabase token storage failed:",
        storageResponse.status
      );
      return res.status(502).send(
        "Twitch connected, but secure storage failed."
      );
    }

    return res.status(200).send(
      "AfterHoursAI connected successfully! You can close this page."
    );
  } catch (err) {
    console.error("Twitch callback error:", err.message);
    return res.status(500).send("Bot connection failed.");
  }
}
