-- Anbieterunabhängige Anmeldung (Phase 0 der Umstellung auf beliebige Postgres-Anbieter)
--
-- 1. Plattform-Administratoren stehen in einer eigenen Tabelle statt in den Metadaten des
--    Anmeldedienstes. Damit hängt die Berechtigung nicht mehr vom Anbieter ab.
-- 2. Benutzer-IDs sind Text: Anmeldedienste vergeben IDs in unterschiedlichen Formaten
--    (Supabase: UUID, Better Auth: Zeichenkette).

create table platform_admin (
  user_id text primary key,
  email text not null,
  created_at timestamptz not null default now()
);
alter table platform_admin enable row level security;

alter table organization_member alter column user_id type text using user_id::text;

-- Bestehende Plattform-Administratoren aus Supabase Auth übernehmen (nur dort vorhanden).
do $$
begin
  if to_regclass('auth.users') is not null then
    execute $q$
      insert into platform_admin (user_id, email)
      select id::text, coalesce(email, '')
      from auth.users
      where raw_app_meta_data ->> 'kb_role' = 'admin'
      on conflict (user_id) do nothing
    $q$;
  end if;
end $$;
