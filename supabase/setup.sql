-- Snack Vault V1 setup. Run this once in Supabase SQL Editor.
create extension if not exists pgcrypto with schema extensions;
create table if not exists creators(id uuid primary key default gen_random_uuid(),slug text unique not null,name text not null,owner_id uuid references auth.users(id),accent_color text default '#ff2d95',created_at timestamptz default now());
create table if not exists creator_api_keys(id uuid primary key default gen_random_uuid(),creator_id uuid not null references creators(id) on delete cascade,key_prefix text not null,key_hash text not null unique,created_at timestamptz default now(),revoked_at timestamptz);
create table if not exists snacks(id uuid primary key default gen_random_uuid(),creator_id uuid not null references creators(id) on delete cascade,name text not null,description text,image_url text,rarity text not null default 'Common',category text,weight integer not null default 10 check(weight>=0),enabled boolean not null default true,archived boolean not null default false,created_at timestamptz default now());
create index if not exists snacks_creator_idx on snacks(creator_id);
create table if not exists viewers(id uuid primary key default gen_random_uuid(),creator_id uuid not null references creators(id) on delete cascade,username_lower text not null,display_name text not null,created_at timestamptz default now(),unique(creator_id,username_lower));
create table if not exists viewer_snacks(creator_id uuid not null references creators(id) on delete cascade,viewer_id uuid not null references viewers(id) on delete cascade,snack_id uuid not null references snacks(id),quantity integer not null default 0 check(quantity>=0),first_obtained_at timestamptz default now(),primary key(viewer_id,snack_id));
create table if not exists pulls(id uuid primary key default gen_random_uuid(),creator_id uuid not null references creators(id) on delete cascade,viewer_id uuid not null references viewers(id),snack_id uuid not null references snacks(id),created_at timestamptz default now());
create index if not exists pulls_creator_idx on pulls(creator_id,created_at desc);
insert into creators(slug,name) values('pretty-massacure','Pretty Massacure') on conflict(slug) do nothing;

create or replace function do_pull(p_creator_id uuid,p_username text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_viewer viewers;v_total bigint;v_roll numeric;v_snack snacks;v_qty integer;
begin
 insert into viewers(creator_id,username_lower,display_name) values(p_creator_id,lower(p_username),p_username) on conflict(creator_id,username_lower) do update set display_name=excluded.display_name returning * into v_viewer;
 select coalesce(sum(weight),0) into v_total from snacks where creator_id=p_creator_id and enabled and not archived and weight>0;
 if v_total=0 then return jsonb_build_object('success',false,'error','no_eligible_snacks');end if;
 v_roll:=random()*v_total;
 select s.* into v_snack from (select sn.*,sum(sn.weight) over(order by sn.id) running from snacks sn where sn.creator_id=p_creator_id and sn.enabled and not sn.archived and sn.weight>0)s where s.running>v_roll order by s.running limit 1;
 insert into pulls(creator_id,viewer_id,snack_id) values(p_creator_id,v_viewer.id,v_snack.id);
 insert into viewer_snacks(creator_id,viewer_id,snack_id,quantity) values(p_creator_id,v_viewer.id,v_snack.id,1) on conflict(viewer_id,snack_id) do update set quantity=viewer_snacks.quantity+1 returning quantity into v_qty;
 return jsonb_build_object('success',true,'username',v_viewer.display_name,'snack',jsonb_build_object('id',v_snack.id,'name',v_snack.name,'rarity',v_snack.rarity,'image_url',v_snack.image_url),'quantity',v_qty,'is_new',v_qty=1,'message',v_viewer.display_name||' pulled '||v_snack.name||case when v_qty=1 then '! NEW snack discovered!' else '! They now have x'||v_qty||'!' end);
end$$;
revoke all on function do_pull(uuid,text) from public,anon,authenticated;grant execute on function do_pull(uuid,text) to service_role;

create or replace function generate_api_key(p_creator_id uuid) returns text language plpgsql security definer set search_path=public,extensions as $$ declare v_key text;begin
 if not exists(select 1 from creators where id=p_creator_id and owner_id=auth.uid()) then raise exception 'not owner';end if;
 update creator_api_keys set revoked_at=now() where creator_id=p_creator_id and revoked_at is null;
 v_key:='snk_live_'||encode(gen_random_bytes(24),'hex');
 insert into creator_api_keys(creator_id,key_prefix,key_hash) values(p_creator_id,left(v_key,12),encode(digest(v_key,'sha256'),'hex'));
 return v_key;
end$$;
revoke all on function generate_api_key(uuid) from public,anon;grant execute on function generate_api_key(uuid) to authenticated;

-- Public collection RPC deliberately returns owned disabled snacks too, so disabling a snack never erases a viewer's collection.
create or replace function get_public_collection(p_creator_id uuid,p_username text) returns jsonb language sql stable security definer set search_path=public as $$
 with v as(select * from viewers where creator_id=p_creator_id and username_lower=lower(trim(leading '@' from p_username)) limit 1), inv as(select vs.snack_id,vs.quantity from viewer_snacks vs join v on v.id=vs.viewer_id), pc as(select count(*)::int n from pulls p join v on v.id=p.viewer_id)
 select jsonb_build_object('display_name',coalesce((select display_name from v),p_username),'unique_snacks',coalesce((select count(*) from inv where quantity>0),0),'total_snacks',coalesce((select sum(quantity) from inv),0),'total_pulls',coalesce((select n from pc),0),'snacks',coalesce((select jsonb_agg(jsonb_build_object('snack_id',snack_id,'quantity',quantity)) from inv),'[]'::jsonb));
$$;
grant execute on function get_public_collection(uuid,text) to anon,authenticated;

create or replace view leaderboard with(security_invoker=true) as select v.creator_id,v.display_name,count(vs.snack_id) filter(where vs.quantity>0) unique_snacks,coalesce(sum(vs.quantity),0) total_snacks from viewers v left join viewer_snacks vs on vs.viewer_id=v.id group by v.creator_id,v.id,v.display_name;

alter table creators enable row level security;alter table creator_api_keys enable row level security;alter table snacks enable row level security;alter table viewers enable row level security;alter table viewer_snacks enable row level security;alter table pulls enable row level security;
drop policy if exists "public read creators" on creators;create policy "public read creators" on creators for select using(true);
drop policy if exists "public read active snacks" on snacks;create policy "public read active snacks" on snacks for select using(enabled and not archived or exists(select 1 from creators c where c.id=creator_id and c.owner_id=auth.uid()));
drop policy if exists "public read viewers" on viewers;create policy "public read viewers" on viewers for select using(true);
drop policy if exists "public read viewer_snacks" on viewer_snacks;create policy "public read viewer_snacks" on viewer_snacks for select using(true);
drop policy if exists "owner writes snacks" on snacks;create policy "owner writes snacks" on snacks for all using(exists(select 1 from creators c where c.id=creator_id and c.owner_id=auth.uid())) with check(exists(select 1 from creators c where c.id=creator_id and c.owner_id=auth.uid()));
drop policy if exists "owner reads pulls" on pulls;create policy "owner reads pulls" on pulls for select using(exists(select 1 from creators c where c.id=creator_id and c.owner_id=auth.uid()));
drop policy if exists "owner reads keys" on creator_api_keys;create policy "owner reads keys" on creator_api_keys for select using(exists(select 1 from creators c where c.id=creator_id and c.owner_id=auth.uid()));
drop policy if exists "owner edits creator" on creators;create policy "owner edits creator" on creators for update using(owner_id=auth.uid()) with check(owner_id=auth.uid());

insert into storage.buckets(id,name,public) values('snack-images','snack-images',true) on conflict(id) do update set public=true;
drop policy if exists "owner uploads snack images" on storage.objects;create policy "owner uploads snack images" on storage.objects for insert to authenticated with check(bucket_id='snack-images' and exists(select 1 from creators c where c.owner_id=auth.uid() and c.id::text=(storage.foldername(name))[1]));
drop policy if exists "owner updates snack images" on storage.objects;create policy "owner updates snack images" on storage.objects for update to authenticated using(bucket_id='snack-images' and exists(select 1 from creators c where c.owner_id=auth.uid() and c.id::text=(storage.foldername(name))[1]));
drop policy if exists "owner deletes snack images" on storage.objects;create policy "owner deletes snack images" on storage.objects for delete to authenticated using(bucket_id='snack-images' and exists(select 1 from creators c where c.owner_id=auth.uid() and c.id::text=(storage.foldername(name))[1]));
