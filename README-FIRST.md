# Snack Vault — redemption diagnostics + custom commands

This is a small follow-up to the integration files you already uploaded. It does not replace your working AfterHoursAI bot or the existing `/api/bot/send-message.js` endpoint. It does not ask you to register another Twitch app or reconnect your Twitch account.

## Do these two steps

1. In the existing Supabase project, open **SQL Editor → New query**. Open `supabase/20261013-afterhours-commands.sql` from this ZIP, copy all of it into the editor, and click **Run**. It is safe to run twice. It adds custom command storage and lets the dashboard show why a redemption failed; it does not change existing collections or pulls. Do not run `setup.sql` or the previous integration migration again.
2. Upload the ZIP's files to the root of your existing GitHub repository, keeping the folders (`api`, `admin`, `css`, `js`, `supabase`, `tests`) in place. Choose **Commit changes** and wait for Vercel to finish deploying. This ZIP contains only the files changed for this follow-up, so it will not repeat your earlier uploads.

After Vercel says **Ready**, open `/admin`, sign in as usual, click **Bot Setup → Check / repair EventSub**, then click **Refresh**. Your connected bot should remain connected. Do not run another test redemption until the dashboard reports EventSub enabled and the eligible-snack count is above zero.

## What the change fixes

- The dashboard now shows each redemption's saved pull error. A canceled redemption is absent from normal pull history because no snack was awarded; the delivery history will say `no_eligible_snacks`, `bot_disabled`, or the actual stored error.
- The dashboard shows how many snacks can currently be pulled. If it says zero, enable at least one snack and set its weight above zero in Snack Management; then a new redemption can award a snack.
- Refresh reloads bot redemption history and error details.
- The dashboard can create, edit, disable, and delete per-channel Twitch chat commands. Responses support `{user}`, `{channel}`, and `{command}`. Commands have an adjustable cooldown and use the already-configured AfterHoursAI bot and chat EventSub.
- EventSub repair ensures both Channel Point redemption and chat-message subscriptions exist.

Existing failed/canceled redemptions are not replayed as pulls: that avoids awarding a snack after Twitch refunded the points. Test with one new redemption after checking the dashboard status.

## Files in this ZIP

- `api/bot/commands.js` (new)
- `api/bot/dashboard.js`
- `api/bot/rewards.js`
- `api/twitch/eventsub.js`
- `admin/index.html`
- `css/admin.css`
- `js/admin.js`
- `supabase/20261013-afterhours-commands.sql` (new)
- `tests/integration.test.js`
- `README-FIRST.md`

No environment variables, secrets, bot credentials, or service-role keys are included. The existing OAuth callback remains `https://snackvault.vercel.app/api/auth/twitch/callback`.

## Local verification

`npm test` passes. The PostgreSQL-compatible database check verifies migration reruns, one-pull-per-redemption behavior, failure diagnostics, command cooldowns, and preservation of collections. No production database credentials were available here, so the live redemption still needs one new test after deployment.
