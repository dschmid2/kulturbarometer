-- Unternehmungen, Mitgliedschaften und Rollen (Anforderung 12)
-- Werte, Fragen (Items) und Kampagnen gehören jeweils genau einer Unternehmung.

create table organization (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_name_valid check (btrim(name) <> '' and char_length(name) <= 200),
  constraint organization_name_unique unique (name)
);

create trigger organization_touch before update on organization
  for each row execute function kb_touch_updated_at();

-- Mitgliedschaft eines Benutzers (Supabase Auth) in einer Unternehmung mit einer oder mehreren Rollen.
-- user_id verweist auf auth.users; bewusst ohne Fremdschlüssel, damit das Schema auch ausserhalb
-- von Supabase (Tests) funktioniert. Die E-Mail-Adresse dient nur der Anzeige in der Verwaltung.
create table organization_member (
  organization_id uuid not null references organization (id) on delete cascade,
  user_id         uuid not null,
  email           text not null,
  roles           text[] not null,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint organization_member_roles_valid check (
    cardinality(roles) >= 1 and roles <@ array['ADMIN', 'WERTE', 'KAMPAGNEN']::text[]
  )
);

create index organization_member_user_idx on organization_member (user_id);

-- ---------------------------------------------------------------------------
-- Zuordnung bestehender Tabellen zu einer Unternehmung
-- ---------------------------------------------------------------------------

alter table value add column organization_id uuid references organization (id) on delete restrict;
alter table item add column organization_id uuid references organization (id) on delete restrict;
alter table campaign add column organization_id uuid references organization (id) on delete restrict;

-- Bestehende Daten (aus der Zeit vor den Unternehmungen) einer Standard-Unternehmung zuordnen.
do $$
declare
  org uuid;
begin
  if exists (select 1 from value) or exists (select 1 from item) or exists (select 1 from campaign) then
    insert into organization (name) values ('Unternehmung') returning id into org;
    update value set organization_id = org where organization_id is null;
    -- Die Schutz-Trigger erlauben bei verwendeten Fragen keine Änderungen; die Zuordnung ist
    -- eine einmalige Datenmigration und ändert keinen fachlichen Inhalt.
    alter table item disable trigger item_guard;
    update item set organization_id = org where organization_id is null;
    alter table item enable trigger item_guard;
    alter table campaign disable trigger campaign_guard;
    update campaign set organization_id = org where organization_id is null;
    alter table campaign enable trigger campaign_guard;
  end if;
end $$;

alter table value alter column organization_id set not null;
alter table item alter column organization_id set not null;
alter table campaign alter column organization_id set not null;

-- Werte-Namen sind je Unternehmung eindeutig (2.3).
alter table value drop constraint value_name_unique;
alter table value add constraint value_name_unique unique (organization_id, name);

create index value_organization_idx on value (organization_id);
create index item_organization_idx on item (organization_id);
create index campaign_organization_idx on campaign (organization_id);

-- Die Unternehmung einer verwendeten Frage ist wie ihr Inhalt unveränderlich.
create or replace function kb_item_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.used_at is not null then
      raise exception 'USED_ITEM_NOT_DELETABLE: Die Item-Version wurde in einer Kampagne verwendet und kann nicht gelöscht werden.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'ORGANIZATION_IMMUTABLE: Die Unternehmung einer Frage kann nicht geändert werden.'
      using errcode = 'P0001';
  end if;

  if old.used_at is not null then
    if new.used_at is distinct from old.used_at
       or new.text is distinct from old.text
       or new.item_type is distinct from old.item_type
       or new.perspective is distinct from old.perspective
       or new.family_id is distinct from old.family_id
       or new.version_number is distinct from old.version_number
       or new.predecessor_id is distinct from old.predecessor_id
       or new.origin is distinct from old.origin then
      raise exception 'USED_ITEM_IMMUTABLE: Eine verwendete Item-Version ist unveränderlich.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Werte-Zuordnungen und Kampagnen-Pools dürfen nur innerhalb derselben Unternehmung bestehen.
create or replace function kb_same_organization_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  left_org uuid;
  right_org uuid;
begin
  if tg_table_name = 'value_assignment' then
    select organization_id into left_org from item where id = new.item_id;
    select organization_id into right_org from value where id = new.value_id;
  else
    select organization_id into left_org from campaign where id = new.campaign_id;
    select organization_id into right_org from item where id = new.item_id;
  end if;
  if left_org is distinct from right_org then
    raise exception 'ORGANIZATION_MISMATCH: Die Zuordnung ist nur innerhalb derselben Unternehmung möglich.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger value_assignment_same_org before insert or update on value_assignment
  for each row execute function kb_same_organization_guard();
create trigger campaign_pool_item_same_org before insert on campaign_pool_item
  for each row execute function kb_same_organization_guard();

alter table organization enable row level security;
alter table organization_member enable row level security;
