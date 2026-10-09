
import { randomBytes } from "node:crypto";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const redirectUri = process.env.TWITCH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send("Twitch is not configured.");
  }

  const state = randomBytes(32).toString("hex");

  res.setHeader(
    "Set-Cookie",
    `twitch_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/twitch; Max-Age=600`
  );

  const url = new URL("https://id.twitch.tv/oauth2/authorize");

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [
    "user:read:chat",
    "user:write:chat",
    "user:bot"
  ].join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("force_verify", "true");

  return res.redirect(302, url.toString());
}
