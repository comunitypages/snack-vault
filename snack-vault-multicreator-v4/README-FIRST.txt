MULTI-CREATOR CONNECTION UPDATE V4

Upload all seven files to their matching paths together. This replaces the earlier connect-v3/host fix packages. No SQL changes and no new Twitch app.

After Vercel deploys, https://snackvault.vercel.app/api/auth/twitch/channel-start?status=1 must display version 20261014-multicreator-v4 and creator_connections per-creator.

Creators connect via their signed-in dashboard. Successful creator authorization returns to the dashboard rather than showing the old underscorepower connected successfully message. Old channel-only setup links now direct to the dashboard.

After connecting, enable the bot and send a test message in that creator's Twitch channel.

The original server-secret message request remains compatible. Other server integrations can also provide creator_id to send to that creator's enabled Twitch connection. BOT_API_SECRET stays server-only. Never place it in browser code.

Verification: 36 local server tests passed, including different creator channels, secure OAuth state, old message compatibility, and shared bot authorization. Live consent needs testing after deployment.
