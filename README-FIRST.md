
# Snack Vault — AfterHoursAI integration update

This updates your existing project. Your working `/api/bot/send-message.js` is unchanged.
The registered OAuth callback stays `https://snackvault.vercel.app/api/auth/twitch/callback`.
No new Twitch app, database or bot account is needed.

## Deploy in this order

1. In your current Supabase project, open **SQL Editor → New query**.
2. Paste the contents of **supabase/20261013-afterhours-integration.sql** and run it once.
   This is an additive migration. It does not re-import snacks or replace collections.
   **Do not run setup.sql or import-70-snacks.sql again.**
3. Extract this ZIP. Open the inner **snack-vault** folder.
4. Open your existing GitHub repository → **Add file → Upload files**.
   Drag the CONTENTS of the inner folder into the repository root, so `api`, `admin`, `js`, `lib`, `package.json` and `vercel.json` are at the top level.
   Commit the changes. Your existing Vercel connection should deploy that commit automatically.
5. Wait for Vercel to show **Ready**. Open `https://snackvault.vercel.app/admin` and hard refresh (Ctrl+Shift+R).
6. Sign in to your existing creator account → **Bot Setup → Connect Twitch**.
   Authorize **underscorepower**, not AfterHoursAI. This NEW step binds your existing creator dashboard to your channel and adds Channel Point permission. It does not reconnect or replace the shared bot.
7. Click **Enable Bot → Send Test Message**. Check your channel's chat.
8. Click **Create and connect reward**, or **Load my rewards → Use selected reward**.
   If another bot already handles that reward, turn off its old action before using this integration.
9. Click **Check / repair EventSub** after a few seconds. It should show `enabled`.
10. Have a viewer redeem it once. Check Twitch chat, the collection, and dashboard pull history (Refresh).
    Add an overlay URL to OBS if wanted. Live overlay updates normally arrive within several seconds.

Keep all existing Vercel environment variable names/values. No new variable is required.
The EventSub signing secret is derived privately from `BOT_API_SECRET`; do not expose or rotate that value casually. OAuth still uses the original callback; EventSub uses `/api/twitch/eventsub` automatically.

## What is included

- Creator-authenticated Connect Twitch, enable/disable, status, test-message and refresh controls.
- Each dashboard session is verified by Supabase Auth; the server finds the owned creator itself.
- Single-use, ten-minute OAuth nonces with secure browser state cookies.
- Encrypted per-channel token storage and token refresh on Twitch authorization expiry.
- One Twitch channel per creator connection and one vault per Twitch channel.
- Existing pull history/statistics retained; total collected copies and recent delivery status added.
- Five copyable OBS URLs connected to a public, cached data feed; animated vending uses real catalog images.
- Create/select Channel Point rewards and create/repair a webhook EventSub subscription.
- Signature and timestamp validation using the exact webhook body.
- Atomic redemption receipt + existing `do_pull` call: repeat delivery cannot grant a second snack.
- Cloud chat announcements and fulfillment/refunds for rewards this Twitch application can manage.
- Dashboard retry for chat or fulfillment after a transient failure.

The bot can read creator totals/recent pulls on the server and include totals in a test message. Interactive chat commands such as `!collection` and chat-message EventSub subscriptions are not included in this release.

## Important behavior

- Enabling the bot is separate from authorizing Twitch. New connections start disabled.
- Disabling stops new pulls and announcements. **Pause the reward in Twitch too** while the bot is off. Redemptions delivered while disabled are recorded without a pull; app-managed rewards are refunded. Others need a manual refund.
- Rewards created in Twitch's dashboard or by a different app can be selected, but their fulfillment/refunds must be handled in Twitch manually. Twitch only permits the creating application to change a reward's redemption status.
- Twitch login must be the same channel when reconnecting an already-linked vault. Changing vault ownership/channel requires a deliberate administrative migration.
- Test messages have a 30-second cooldown; `last_test_at` records the test attempt, including failed sends.
- A successful pull is committed before Twitch's webhook acknowledgment. Chat/fulfillment then continue via Vercel `waitUntil`. Failed work is visible in Bot Setup and can be retried. This is not a separate durable worker with automatic scheduled retries.
- If a network response is lost after Twitch accepts a chat message, its status may be `uncertain`. A manual retry can duplicate the chat announcement, but never the snack award.
- The public overlay feed shows viewer display names, snack names, collection information and recent activity. It never returns private credentials or creator owner IDs.
- Overlays poll every five seconds and share a five-second Vercel cache. New alerts ignore historical events on first load; the feed retains the latest 50. This is a beta baseline, not a load-tested 200-channel architecture; high-volume bursts or long disconnects may miss visual alerts without losing saved pulls.

## Check a second streamer before release

1. The streamer signs in to THEIR creator dashboard (never your account).
2. They connect THEIR Twitch channel, enable the bot, and send a test.
3. Confirm the test goes to their channel only.
4. Connect a reward, redeem once, and confirm exactly one pull in their vault.
5. Confirm your vault totals did not change.
6. Disable the bot, pause their reward in Twitch, and confirm a dashboard test is blocked.

## Verification and limitations

Local checks: 14 Node security/handler tests passed, plus database checks using a local PostgreSQL-compatible PGlite engine: migration reruns, preservation of pulls/collections, duplicate redemption handling, channel/reward isolation, disabled/empty catalogs, one-use nonce, summary/feed data, and denial of anonymous credential/pull access.
Dashboard DOM smoke testing also passed for the toggle, test message, reward selector and all five overlay URLs. A visual browser screenshot check could not run because the browser download was unavailable in this environment.
`npm ci && npm test` reruns the Node checks.

No production Vercel/Supabase credentials were available in this session. Live environment values, production schema differences, deployment, real Twitch consent, webhook delivery, and a real second streamer remain to be verified. The latest database schema has live additions absent from the old setup.sql; this update assumes the columns listed in your handoff and the existing `do_pull(uuid,text)` function are present.

If the new SQL migration fails, do not deploy or change existing tables by guessing. Save the error (without keys/tokens) for diagnosis. If the new code fails after deployment, Vercel can roll back to your previous working deployment; leave the additive database migration in place.

## Files intentionally preserved

- `api/bot/send-message.js`: byte-for-byte original.
- `api/auth/twitch/start.js`: original bot authorization.
- Original bot/legacy channel branches in the registered callback.
- Existing snacks.json, collection pages, creator pages, Supabase pull edge function, and original SQL files.

Sources used for integration behavior:
- https://dev.twitch.tv/docs/eventsub/handling-webhook-events/
- https://dev.twitch.tv/docs/api/reference/#update-redemption-status
- https://dev.twitch.tv/docs/authentication/refresh-tokens/
- https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
