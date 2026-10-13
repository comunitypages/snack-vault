-- ADDITIVE migration for an EXISTING Snack Vault database. Do not re-run setup.sql.
-- No snacks, collections, pulls or existing private bot credentials are replaced.
begin;
create table if not exists public.creator_twitch_bots (
 creator_id uuid primary key references public.creators(id) on delete cascade,
 twitch_user_id text not null, twitch_login text not null,
 access_token_enc text not null, refresh_token_enc text not null,
 enabled boolean not null default false, connected_at timestamptz default now(), last_test_at timestamptz
);
create unique index if not exists sv_one_connection_per_creator on public.creator_twitch_bots(creator_id);
create unique index if not exists sv_one_vault_per_twitch_channel on public.creator_twitch_bots(twitch_user_id);
alter table public.creator_twitch_bots add column if not exists reward_id text;
alter table public.creator_twitch_bots add column if not exists reward_managed boolean not null default false;
alter table public.creator_twitch_bots add column if not exists eventsub_id text;
alter table public.creator_twitch_bots add column if not exists eventsub_status text;
create table if not exists public.bot_oauth_nonces(nonce text primary key,creator_id uuid not null references public.creators(id) on delete cascade,created_at timestamptz not null default now());
create unique index if not exists sv_unique_oauth_nonce on public.bot_oauth_nonces(nonce);
create table if not exists public.sv_redemptions(
 redemption_id text primary key, creator_id uuid not null references public.creators(id) on delete cascade,
 reward_id text not null, user_login text not null, result jsonb not null,
 chat_status text not null default 'pending', fulfilled boolean not null default false,
 fulfillment_status text not null default 'pending', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists sv_redemptions_creator_time on public.sv_redemptions(creator_id,created_at desc);
alter table public.creator_twitch_bots enable row level security;
alter table public.bot_oauth_nonces enable row level security;
alter table public.sv_redemptions enable row level security;
-- RLS alone is not enough if earlier permissive policies exist. These tables are server-only.
revoke all on public.creator_twitch_bots,public.bot_oauth_nonces,public.sv_redemptions from public,anon,authenticated;
grant all on public.creator_twitch_bots,public.bot_oauth_nonces,public.sv_redemptions to service_role;
-- Protect existing encrypted bot credentials if that table exists in the live database.
do $$ begin
 if to_regclass('public.private_twitch_bot_tokens') is not null then
  alter table public.private_twitch_bot_tokens enable row level security;
  revoke all on public.private_twitch_bot_tokens from public,anon,authenticated;
  grant all on public.private_twitch_bot_tokens to service_role;
 end if;
end $$;

create or replace function public.sv_consume_nonce(p_nonce text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_creator uuid;
begin
 delete from bot_oauth_nonces where nonce=p_nonce and created_at>now()-interval '10 minutes' returning creator_id into v_creator;
 delete from bot_oauth_nonces where created_at<=now()-interval '10 minutes';
 return v_creator;
end $$;
create or replace function public.sv_claim_test(p_creator uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 update creator_twitch_bots set last_test_at=now() where creator_id=p_creator and enabled and (last_test_at is null or last_test_at<now()-interval '30 seconds');
 return found;
end $$;
create or replace function public.sv_bot_summary(p_creator uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'total_pulls',(select count(*) from pulls where creator_id=p_creator),
 'collectors',(select count(*) from viewers where creator_id=p_creator),
 'total_copies',(select coalesce(sum(quantity),0) from viewer_snacks where creator_id=p_creator),
 'recent',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select p.created_at,v.display_name,s.name,s.rarity from pulls p join viewers v on v.id=p.viewer_id join snacks s on s.id=p.snack_id where p.creator_id=p_creator order by p.created_at desc limit 5)t),
 'deliveries',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select redemption_id,chat_status,fulfillment_status,created_at from sv_redemptions where creator_id=p_creator order by created_at desc limit 10)t)
 );
$$;

-- The pull and the unique redemption receipt commit together. A retry never grants a second snack.
create or replace function public.sv_process_redemption(p_redemption text,p_channel text,p_reward text,p_login text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c creator_twitch_bots; receipt sv_redemptions; result jsonb;
begin
 -- Serialize concurrent deliveries for the same redemption before testing for an existing receipt.
 perform pg_advisory_xact_lock(hashtextextended(p_redemption,0));
 select * into receipt from sv_redemptions where redemption_id=p_redemption;
 if found then return to_jsonb(receipt); end if;
 select * into c from creator_twitch_bots where twitch_user_id=p_channel for share;
 if not found or c.reward_id is distinct from p_reward then return null; end if;
 if not c.enabled then
  result:=jsonb_build_object('success',false,'error','bot_disabled');
 else
  if p_login !~ '^[a-zA-Z0-9_]{1,25}$' then raise exception 'invalid Twitch login'; end if;
  result:=do_pull(c.creator_id,p_login);
 end if;
 insert into sv_redemptions(redemption_id,creator_id,reward_id,user_login,result,chat_status)
 values(p_redemption,c.creator_id,p_reward,p_login,result,case when result->>'success'='true' then 'pending' else 'skipped' end) returning * into receipt;
 return to_jsonb(receipt);
end $$;

-- Public overlay projection: contains public collection/activity fields, never tokens or owner IDs.
create or replace function public.sv_overlay_feed(p_slug text) returns jsonb
language sql stable security definer set search_path=public as $$
 with c as(select id from creators where slug=p_slug),
 e as(select p.id,p.created_at,p.viewer_id,v.display_name username,s.name snack_name,s.image_url,s.rarity
      from pulls p join viewers v on v.id=p.viewer_id join snacks s on s.id=p.snack_id
      where p.creator_id=(select id from c) order by p.created_at desc,p.id desc limit 50),
 latest_viewer as(select viewer_id from e order by created_at desc,id desc limit 1)
 select case when exists(select 1 from c) then jsonb_build_object(
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'username',username,'snack_name',snack_name,'image_url',image_url,'rarity',rarity,'timestamp',created_at) order by created_at desc,id desc) from e),'[]'::jsonb),
 'total',(select coalesce(sum(quantity),0) from viewer_snacks where viewer_id=(select viewer_id from latest_viewer)),
 'items',coalesce((select jsonb_agg(row_to_json(t)) from (select s.name,vs.quantity count from viewer_snacks vs join snacks s on s.id=vs.snack_id where vs.viewer_id=(select viewer_id from latest_viewer) and vs.quantity>0 order by vs.quantity desc,s.name limit 9)t),'[]'::jsonb),
 'leaders',coalesce((select jsonb_agg(row_to_json(t)) from (select display_name name,unique_snacks count from leaderboard where creator_id=(select id from c) order by unique_snacks desc,total_snacks desc,display_name limit 5)t),'[]'::jsonb),
 'snacks',coalesce((select jsonb_agg(jsonb_build_object('name',name,'image_url',image_url,'rarity',rarity)) from snacks where creator_id=(select id from c) and enabled and not archived),'[]'::jsonb)
 ) else null end;
$$;
revoke all on function public.sv_consume_nonce(text),public.sv_claim_test(uuid),public.sv_bot_summary(uuid),public.sv_process_redemption(text,text,text,text),public.sv_overlay_feed(text) from public,anon,authenticated;
grant execute on function public.sv_consume_nonce(text),public.sv_claim_test(uuid),public.sv_bot_summary(uuid),public.sv_process_redemption(text,text,text,text),public.sv_overlay_feed(text) to service_role;
commit;
