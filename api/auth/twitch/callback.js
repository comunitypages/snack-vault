
import { timingSafeEqual } from "node:crypto";

function sameValue(a, b) {
  const x = Buffer.from(a || "");
  const y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map(part => part.trim().split("="))
      .filter(pair => pair.length === 2)
  );

  const state = req.query.state;
  const code = req.query.code;

  res.setHeader(
    "Set-Cookie",
    "twitch_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/twitch; Max-Age=0"
  );

  if (req.query.error) {
    return res.status(400).send("Twitch authorization was cancelled or denied.");
  }

  if (
    typeof state !== "string" ||
    typeof code !== "string" ||
    !cookies.twitch_oauth_state ||
    !sameValue(state, cookies.twitch_oauth_state)
  ) {
    return res.status(403).send("Invalid or expired login request.");
  }

  try {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.TWITCH_REDIRECT_URI
      })
    });

    const tokens = await response.json();

    if (!response.ok || !tokens.access_token) {
      return res.status(502).send("Twitch token exchange failed.");
    }

    const userResponse = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Client-Id": process.env.TWITCH_CLIENT_ID
      }
    });

    if (!userResponse.ok) {
      return res.status(502).send("Could not verify Twitch account.");
    }

    const userData = await userResponse.json();
    const account = userData.data?.[0];

    if (account?.login?.toLowerCase() !== "afterhoursai") {
      return res.status(403).send(
        "Please authorize using the AfterHoursAI Twitch account."
      );
    }

    // Tokens are intentionally NOT saved or displayed.
    // Secure storage will be added in the next step.
    return res.status(200).send(
      "AfterHoursAI authorized successfully! Secure token storage is the next step."
    );
  } catch {
    return res.status(500).send("Twitch authorization failed.");
  }
}

