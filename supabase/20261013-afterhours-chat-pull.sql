-- Adds a default !snack pull and lets creators make other commands pull snacks.
-- Safe to run after 20261013-afterhours-commands.sql; preserves existing commands.
begin;
alter table public.sv_commands add column if not exists command_type text not null default 'response' check(command_type in ('response','pull'));
alter table public.creator_twitch_bots add column if not exists redemption_user_cooldown_seconds integer not null default 1 check(redemption_user_cooldown_seconds between 1 and 3600);
create index if not exists sv_redemptions_creator_user_success_time on public.sv_redemptions(creator_id,user_login,created_at desc);

create or replace function public.sv_bot_summary(p_creator uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'total_pulls',(select count(*) from pulls where creator_id=p_creator),
 'collectors',(select count(*) from viewers where creator_id=p_creator),
 'total_copies',(select coalesce(sum(quantity),0) from viewer_snacks where creator_id=p_creator),
 'eligible_snacks',(select count(*) from snacks where creator_id=p_creator and enabled and not archived and weight>0),
 'recent',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select p.created_at,v.display_name,s.name,s.rarity from pulls p join viewers v on v.id=p.viewer_id join snacks s on s.id=p.snack_id where p.creator_id=p_creator order by p.created_at desc limit 5)t),
 'deliveries',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select redemption_id,user_login,chat_status,fulfillment_status,nullif(result->>'error','') as error,coalesce((result->>'retry_after')::integer,0) as retry_after,coalesce(result->>'success','false') as pull_success,created_at from sv_redemptions where creator_id=p_creator order by created_at desc limit 10)t)
 );
$$;

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
 return jsonb_build_object('status','matched','response',c.response,'command',c.command_name,'command_type',c.command_type);
end $$;
revoke all on function public.sv_claim_command(uuid,text) from public,anon,authenticated;
grant execute on function public.sv_claim_command(uuid,text) to service_role;

create or replace function public.sv_ensure_snack_command(p_creator uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from creator_twitch_bots where creator_id=p_creator) then
  insert into sv_commands(creator_id,command_name,command_type,response,cooldown_seconds,enabled)
  values(p_creator,'snack','pull','Pull result is announced automatically.',5,true)
  on conflict do nothing;
 end if;
end $$;
revoke all on function public.sv_ensure_snack_command(uuid) from public,anon,authenticated;
grant execute on function public.sv_ensure_snack_command(uuid) to service_role;

-- Give every currently connected creator a working snack-pull chat command.
insert into public.sv_commands(creator_id,command_name,command_type,response,cooldown_seconds,enabled)
select creator_id,'snack','pull','Pull result is announced automatically.',5,true
from public.creator_twitch_bots
on conflict do nothing;

-- Per-viewer cooldown is atomic across simultaneous redemptions. Failed/canceled attempts do not start it.
create or replace function public.sv_process_redemption(p_redemption text,p_channel text,p_reward text,p_login text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c creator_twitch_bots; receipt sv_redemptions; result jsonb; last_success_at timestamptz; retry_seconds integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_redemption,0));
 select * into receipt from sv_redemptions where redemption_id=p_redemption;
 if found then return to_jsonb(receipt); end if;
 select * into c from creator_twitch_bots where twitch_user_id=p_channel for share;
 if not found or c.reward_id is distinct from p_reward then return null; end if;
 if not c.enabled then
  result:=jsonb_build_object('success',false,'error','bot_disabled');
 else
  if p_login !~ '^[a-zA-Z0-9_]{1,25}$' then raise exception 'invalid Twitch login'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sv-user-redemption:'||c.creator_id::text||':'||lower(p_login),0));
  select r.created_at into last_success_at from sv_redemptions r
   where r.creator_id=c.creator_id and lower(r.user_login)=lower(p_login) and r.result->>'success'='true'
   order by r.created_at desc limit 1;
  if found and last_success_at+make_interval(secs=>c.redemption_user_cooldown_seconds)>now() then
   retry_seconds:=greatest(1,ceil(extract(epoch from last_success_at+make_interval(secs=>c.redemption_user_cooldown_seconds)-now()))::integer);
   result:=jsonb_build_object('success',false,'error','user_cooldown','retry_after',retry_seconds);
  else
   result:=do_pull(c.creator_id,lower(p_login));
  end if;
 end if;
 insert into sv_redemptions(redemption_id,creator_id,reward_id,user_login,result,chat_status)
 values(p_redemption,c.creator_id,p_reward,lower(p_login),result,case when result->>'success'='true' then 'pending' else 'skipped' end)
 returning * into receipt;
 return to_jsonb(receipt);
end $$;
revoke all on function public.sv_process_redemption(text,text,text,text) from public,anon,authenticated;
grant execute on function public.sv_process_redemption(text,text,text,text) to service_role;
revoke all on function public.sv_bot_summary(uuid) from public,anon,authenticated;
grant execute on function public.sv_bot_summary(uuid) to service_role;
commit;
