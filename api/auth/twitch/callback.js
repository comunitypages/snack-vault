
import {
  createCipheriv,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

function safeEqual(a, b) {
  const x = Buffer.from(a || "");
  const y = Buffer.from(b || "");

  return (
    x.length === y.length &&
    timingSafeEqual(x, y)
  );
}

function encrypt(value) {
  const key = Buffer.from(
    process.env.TWITCH_TOKEN_ENCRYPTION_KEY || "",
    "base64"
  );

  if (key.length !== 32) {
    throw new Error("Invalid encryption key");
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

function getCookies(req) {
  const cookies = {};

  for (const part of (req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");

    if (index === -1) continue;

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[name] = value;
  }

  return cookies;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const cookies = getCookies(req);

  const state = req.query.state;
  const code = req.query.code;
  const error = req.query.error;

  const flow =
    cookies.twitch_oauth_flow === "channel"
      ? "channel"
      : "bot";

  res.setHeader("Set-Cookie", [
    "twitch_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/twitch; Max-Age=0",
    "twitch_oauth_flow=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/twitch; Max-Age=0"
  ]);

  if (error) {
    return res.status(400).send(
      "Twitch authorization was cancelled or denied."
    );
  }

  if (
    typeof state !== "string" ||
    typeof code !== "string" ||
    !cookies.twitch_oauth_state ||
    !safeEqual(state, cookies.twitch_oauth_state)
  ) {
    return res.status(403).send(
      "Invalid or expired login request."
    );
  }

  const expectedLogin =
    flow === "channel"
      ? "underscorepower"
      : "afterhoursai";

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
    return res.status(500).send(
      "Server configuration incomplete."
    );
  }

  try {
    // Exchange authorization code for Twitch tokens.
    const tokenResponse = await fetch(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
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
      return res.status(502).send(
        "Twitch token exchange failed."
      );
    }

    const tokens = await tokenResponse.json();

    if (
      !tokens.access_token ||
      !tokens.refresh_token ||
      !Number.isFinite(tokens.expires_in)
    ) {
      return res.status(502).send(
        "Twitch returned incomplete authorization data."
      );
    }

    // Verify which Twitch account authorized.
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
      return res.status(502).send(
        "Could not verify Twitch account."
      );
    }

    const userData = await userResponse.json();
    const account = userData.data?.[0];

    if (
      account?.login?.toLowerCase() !== expectedLogin
    ) {
      return res.status(403).send(
        `Please authorize using the ${expectedLogin} Twitch account.`
      );
    }

    // Confirm Twitch granted the required permission.
    const requiredScopes =
      flow === "channel"
        ? ["channel:bot"]
        : [
            "user:read:chat",
            "user:write:chat",
            "user:bot"
          ];

    if (
      !requiredScopes.every(
        scope => tokens.scope?.includes(scope)
      )
    ) {
      return res.status(403).send(
        "Required Twitch permissions were not granted."
      );
    }

    // Encrypt before saving anything to the database.
    const encryptedAccessToken = encrypt(
      tokens.access_token
    );

    const encryptedRefreshToken = encrypt(
      tokens.refresh_token
    );

    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    const recordId =
      flow === "channel"
        ? "underscorepower"
        : "afterhoursai";

    // Store tokens using the private server-side key.
    const storageResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/private_twitch_bot_tokens?on_conflict=id`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer:
            "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          id: recordId,
          twitch_user_id: account.id,
          twitch_login: account.login,
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!storageResponse.ok) {
      console.error(
        "Supabase storage failed:",
        storageResponse.status
      );

      return res.status(502).send(
        "Twitch authorized, but secure storage failed."
      );
    }

    return res.status(200).send(
      `${expectedLogin} connected successfully! You can close this page.`
    );
  } catch (error) {
    console.error(
      "Twitch callback failed:",
      error.message
    );

    return res.status(500).send(
      "Twitch connection failed."
    );
  }
}
