-- Delivery zones seeded from Libya's 22 administrative districts (shabiyat, 2007
-- system), sourced from the Districts of Libya dataset on Wikipedia:
-- https://en.wikipedia.org/wiki/Districts_of_Libya
--
-- name / region / capital / area_km2 / population (2020 estimate) are from that
-- source. fee is NOT — no public source gives per-zone courier pricing, so every
-- zone starts at 0 for the operator to set.
--
-- delivery_time_days is an editable starting estimate, not research. It is
-- derived from population density alone:
--   >= 20 people/km2 -> 2 days   (urban coastal belt)
--   >=  2 people/km2 -> 4 days
--   otherwise        -> 7 days   (sparse desert interior)

create table if not exists public.delivery_zones (
  id text primary key,
  name text not null,
  region text not null check (region in ('tripolitania', 'cyrenaica', 'fezzan')),
  capital text not null default '',
  area_km2 integer not null default 0 check (area_km2 >= 0),
  population integer not null default 0 check (population >= 0),
  fee numeric(14, 2) not null default 0 check (fee >= 0),
  delivery_time_days integer not null default 3 check (delivery_time_days > 0),
  active boolean not null default true
);

alter table public.delivery_zones enable row level security;

create policy "Active users can access delivery zones"
  on public.delivery_zones for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

revoke all on public.delivery_zones from anon;
grant select, insert, update, delete on public.delivery_zones to authenticated;

alter table public.delivery_zones replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_zones'
  ) then
    alter publication supabase_realtime add table public.delivery_zones;
  end if;
end;
$$;

insert into public.delivery_zones (id, name, region, capital, area_km2, population, delivery_time_days)
values
  -- Tripolitania
  ('tripoli',        'طرابلس',        'tripolitania', 'طرابلس',   2666,   1293016, 2),
  ('jafara',         'الجفارة',       'tripolitania', 'العزيزية', 835,    548855,  2),
  ('misrata',        'مصراتة',        'tripolitania', 'مصراتة',   29172,  663853,  2),
  ('murqub',         'المرقب',        'tripolitania', 'الخمس',    6796,   532227,  2),
  ('zawiya',         'الزاوية',       'tripolitania', 'الزاوية',  2753,   351306,  2),
  ('nuqat-al-khams', 'النقاط الخمس',  'tripolitania', 'زوارة',    6089,   349755,  2),
  ('jabal-gharbi',   'الجبل الغربي',  'tripolitania', 'غريان',    76717,  374911,  4),
  ('sirte',          'سرت',           'tripolitania', 'سرت',      77660,  170869,  4),
  ('nalut',          'نالوت',         'tripolitania', 'نالوت',    67191,  113886,  7),
  -- Cyrenaica
  ('benghazi',       'بنغازي',        'cyrenaica',    'بنغازي',   11372,  807255,  2),
  ('marj',           'المرج',         'cyrenaica',    'المرج',    13515,  286045,  2),
  ('jabal-akhdar',   'الجبل الأخضر',  'cyrenaica',    'البيضاء',  11429,  250020,  2),
  ('wahat',          'الواحات',       'cyrenaica',    'إجدابيا',  103143, 213728,  2),
  ('derna',          'درنة',          'cyrenaica',    'درنة',     31511,  201639,  4),
  ('butnan',         'البطنان',       'cyrenaica',    'طبرق',     84996,  195088,  4),
  ('kufra',          'الكفرة',        'cyrenaica',    'الجوف',    453161, 55495,   7),
  -- Fezzan
  ('sabha',          'سبها',          'fezzan',       'سبها',     15330,  153454,  7),
  ('wadi-al-hayat',  'وادي الحياة',   'fezzan',       'أوباري',   31485,  91749,   4),
  ('wadi-ash-shati', 'وادي الشاطئ',   'fezzan',       '',         97160,  95294,   7),
  ('murzuq',         'مرزق',          'fezzan',       'مرزق',     356308, 94088,   7),
  ('jufra',          'الجفرة',        'fezzan',       'هون',      117410, 60853,   7),
  ('ghat',           'غات',           'fezzan',       'غات',      68482,  27675,   7)
on conflict (id) do nothing;
