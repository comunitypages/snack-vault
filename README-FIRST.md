# Snack Vault V1 — setup order

This project follows the supplied blueprint: the website **never creates a pull**. Twitch -> Mix It Up/Firebot -> Supabase Edge Function -> database. The public site only reads collection data.

## 1. Create Supabase project
Create a project, then open **SQL Editor** and run `supabase/setup.sql`.

## 2. Create Pretty's login
In Supabase **Authentication -> Users**, create Pretty's email/password account. Copy that user's UUID. In SQL Editor run:

```sql
update creators set owner_id = 'PASTE_AUTH_USER_UUID' where slug = 'pretty-massacure';
```

After this Pretty only uses `/admin/`; she does not need Supabase.

## 3. Import the 70 snacks
Run `supabase/import-70-snacks.sql`. The final query should return **70** on a fresh project. All start Common/weight 50 so Pretty can assign rarities and weights in the dashboard.

## 4. Put public Supabase values in the website
Supabase -> Project Settings/API. Copy the Project URL and **publishable/anon key** into `js/config.js`. These are browser-safe public credentials; do NOT put a service-role key or Snack Vault bot key there.

## 5. Deploy the Edge Function
Install Supabase CLI, log in, link this folder to your project, then deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy pull --no-verify-jwt
```

Supabase automatically provides the Edge Function with `SUPABASE_URL` and server credentials. The service role never belongs in the frontend.

## 6. Generate the bot key
Open the deployed website at `/admin/`, sign in as Pretty, go to **Bot Setup**, and click **Generate / Regenerate**. Copy it immediately. The database stores only its SHA-256 hash.

## 7. Connect Mix It Up / Firebot
The bot sends:

```text
POST https://YOUR_PROJECT.supabase.co/functions/v1/pull
Content-Type: application/json
x-snack-api-key: snk_live_...

{"username":"THE_REDEEMING_TWITCH_USERNAME"}
```

Then print the returned JSON `message` field in Twitch chat. Example: `Nick pulled Oreos! NEW snack discovered!`

## 8. Deploy the website
Put this folder in GitHub and import the repo into Vercel. There is no build command: it is plain HTML/CSS/JS. The public page is `/`; Pretty's dashboard is `/admin/`.

## Important
- Never commit a `snk_live_...` key.
- Never put the Supabase service-role key in GitHub or browser JS.
- Disabling/archiving a snack prevents future pulls but does not delete viewer ownership or pull history.
- Images are uploaded by Pretty through the dashboard to the public `snack-images` bucket.
