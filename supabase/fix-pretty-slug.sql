-- Run once in Supabase SQL Editor.
-- This changes only Pretty's public slug/name; creator ID and all related data stay the same.
update public.creators
set slug = 'pretty-massacre',
    name = 'Pretty Massacre'
where slug = 'pretty-massacure';

select id, slug, name from public.creators where slug = 'pretty-massacre';
