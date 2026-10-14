SNACK VAULT CREATOR FIXES

Extract this ZIP and upload every included folder/file to the matching path in your existing GitHub repository. Keep js/home.js and lib/oauth-state.js; these are new required files.

No SQL changes. Keep your existing Twitch app and registered /api/auth/twitch/callback URL. No environment values need to be pasted anywhere.

After Vercel finishes deploying, open https://snackvault.vercel.app/admin and start a NEW Connect Twitch request. Old expired Twitch URLs cannot be reused. Creators should sign in on that same address before connecting.

Features: dynamic homepage community list; creator-specific names and logos; permanent delete for unused snacks; archive guidance when a snack has collection/history records; per-request OAuth cookies and canonical-host checks. Archive All and Enable All are retained.

Delete does not remove snack-image files or erase viewer progress. Collected snacks cannot be permanently deleted because those records reference them.

Verification: 23 server tests passed, plus local DOM checks for second-streamer branding, home directory, safe deletion, and bulk controls. Live Twitch consent still needs testing after deployment.
