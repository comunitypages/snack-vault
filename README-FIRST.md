# Snack Vault — chat pulls, placeholders, and viewer cooldowns

This follow-up completes the chat `!snack` pull and adds a per-viewer Channel Point cooldown. It also accepts `{user}`, `%user%`, `$(user)`, `$user`, and `$user%` placeholders in custom chat replies (with matching `channel` and `command` forms).

## Install in order

1. In the existing Supabase project, open **SQL Editor → New query**. Run `supabase/20261013-afterhours-chat-pull.sql` from this ZIP. It adds a one-second default per-viewer cooldown and the default `!snack` pull command. The migration is safe to rerun; do not rerun `setup.sql` or the earlier migrations.
2. Upload the ZIP's files to the root of your existing GitHub repository, keeping folder paths in place. Commit and wait until Vercel shows **Ready**.
3. Open `/admin` → **Bot Setup**. Confirm **Chat: enabled** under EventSub. Set **Per-viewer redemption cooldown** to 1 second or your preferred 1–3600 seconds, then click **Save cooldown**. Create or select a reward and test `!snack` in chat.

New rewards created here have Twitch's global cooldown disabled. If you select a reward this app can manage, it disables that reward's global cooldown so Snack Vault can apply its own per-viewer setting. Rewards created by another app may retain Twitch's global cooldown. Twitch's API supports cooldown seconds, while its UI only displays global cooldowns of at least 60 seconds. Too-soon attempts make no pull; Snack Vault automatically cancels/refunds app-managed rewards, and external rewards may need manual handling.

The cooldown applies to successful Channel Point pulls per viewer. It does not block different viewers. Failed pulls do not start the cooldown. The chat `!snack` command has its own configurable command cooldown.

## Files in this ZIP

- `api/bot/commands.js`
- `api/bot/dashboard.js`
- `api/bot/rewards.js`
- `api/twitch/eventsub.js`
- `admin/index.html`
- `js/admin.js`
- `supabase/20261013-afterhours-chat-pull.sql`
- `supabase/20261013-afterhours-commands.sql`
- `tests/integration.test.js`
- `README-FIRST.md`
- `CHANGED-FILES.txt`

The working `api/bot/send-message.js`, existing bot connection, credentials, and registered OAuth callback are unchanged. Local tests cover the one-second cooldown, placeholder aliases, custom chat pulls, command cooldowns, and migration reruns. Test once in production after deployment; no live Twitch/database credentials were available for this check.
