# Snack Vault launch update

This update fixes the incoming Twitch chat subscription setup and adds the missing public overlay feed route. Enabling the cloud bot now registers or repairs both chat and Channel Point EventSub subscriptions. No new OAuth application or credentials are needed.

## Install

1. Upload the files in this update to the root of the existing GitHub repository, keeping the folder paths. Replace matching files, add `api/overlay.js`, commit, and wait for Vercel to show **Ready**.
2. In Snack Vault, open **Admin → Bot Setup** and click **Repair Twitch subscriptions**. Wait a few seconds, then click **Refresh**. The dashboard should show **Chat: enabled**.
3. Send `!snack` in your Twitch chat. The default command opens a snack bag; other saved commands use their selected reply or pull action.
4. In OBS, use the overlay URLs from the dashboard. Add `&demo=1` temporarily to preview an overlay; remove it for stream. Pull alerts and the vending machine stay transparent until a new pull happens.

If you have not already applied the earlier command migration, run `supabase/20261013-afterhours-chat-pull.sql` in the existing Supabase SQL Editor after `20261013-afterhours-commands.sql`. Do not rerun `setup.sql`.

## Files in this update

- `api/bot/dashboard.js`
- `api/bot/rewards.js`
- `api/overlay.js`
- `admin/index.html`
- `js/admin.js`
- `tests/integration.test.js`
- `README-FIRST.md`

The existing `api/bot/send-message.js`, bot connection, encrypted tokens, registered Twitch callback, and snack data are unchanged. The local test suite covers chat subscription registration, `!snack`, overlay feed output, OAuth protections, and cooldown behavior.
