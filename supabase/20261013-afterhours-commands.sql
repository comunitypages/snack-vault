-- Adds chat-command storage and exposes the reason for failed Channel Point pulls.
-- Safe to run more than once. Does not modify snack collections or prior pulls.
begin;
alter table public.creator_twitch_bots add column if not exists eventsub_chat_id text;
alter table public.creator_twitch_bots add column if not exists eventsub_chat_status text;

create table if not exists public.sv_commands(
 id uuid primary key default gen_random_uuid(),
 creator_id uuid not null references public.creators(id) on delete cascade,
 command_name text not null,
 response text not null,
 enabled boolean not null default true,
 cooldown_seconds integer not null default 5 check(cooldown_seconds between 1 and 3600),
 last_used_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(command_name ~ '^[a-zA-Z0-9_]{1,24}$'),
 check(length(response) between 1 and 450)
);
create unique index if not exists sv_commands_unique_name on public.sv_commands(creator_id,lower(command_name));
create index if not exists sv_commands_creator_idx on public.sv_commands(creator_id);
alter table public.sv_commands enable row level security;
revoke all on public.sv_commands from public,anon,authenticated;
grant all on public.sv_commands to service_role;

create or replace function public.sv_claim_command(p_creator uuid,p_command text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c sv_commands; remaining integer;
begin
 if not exists(select 1 from creator_twitch_bots where creator_id=p_creator and enabled) then return null; end if;
 select * into c from sv_commands where creator_id=p_creator and lower(command_name)=lower(p_command) and enabled for update;
 if not found then return null; end if;
 if c.last_used_at is not null and c.last_used_at+make_interval(secs=>c.cooldown_seconds)>now() then
   remaining:=ceil(extract(epoch from c.last_used_at+make_interval(secs=>c.cooldown_seconds)-now()))::integer;
   return jsonb_build_object('status','cooldown','remaining',remaining);
 end if;
 update sv_commands set last_used_at=now(),updated_at=now() where id=c.id;
 return jsonb_build_object('status','matched','response',c.response,'command',c.command_name);
end $$;

create or replace function public.sv_bot_summary(p_creator uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'total_pulls',(select count(*) from pulls where creator_id=p_creator),
 'collectors',(select count(*) from viewers where creator_id=p_creator),
 'total_copies',(select coalesce(sum(quantity),0) from viewer_snacks where creator_id=p_creator),
 'eligible_snacks',(select count(*) from snacks where creator_id=p_creator and enabled and not archived and weight>0),
 'recent',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select p.created_at,v.display_name,s.name,s.rarity from pulls p join viewers v on v.id=p.viewer_id join snacks s on s.id=p.snack_id where p.creator_id=p_creator order by p.created_at desc limit 5)t),
 'deliveries',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select redemption_id,user_login,chat_status,fulfillment_status,nullif(result->>'error','') as error,coalesce(result->>'success','false') as pull_success,created_at from sv_redemptions where creator_id=p_creator order by created_at desc limit 10)t)
 );
$$;
revoke all on function public.sv_claim_command(uuid,text) from public,anon,authenticated;
grant execute on function public.sv_claim_command(uuid,text) to service_role;
commit;
