-- Unternehmenswerte, Fokussätze, Item-Familien, Item-Versionen und Werte-Zuordnungen
-- Anforderungen 2 und 5; Datenmodell siehe design.md

create or replace function kb_touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unternehmenswerte und Fokussätze (Anforderung 2)
-- ---------------------------------------------------------------------------

create table value (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint value_name_valid check (btrim(name) <> '' and char_length(name) <= 100),
  constraint value_name_unique unique (name),
  constraint value_description_length check (char_length(description) <= 1000)
);

create trigger value_touch before update on value
  for each row execute function kb_touch_updated_at();

create table focus_sentence (
  id         uuid primary key default gen_random_uuid(),
  value_id   uuid not null references value (id) on delete cascade,
  text       text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  constraint focus_sentence_text_valid check (btrim(text) <> '' and char_length(text) <= 500)
);

create index focus_sentence_value_idx on focus_sentence (value_id, position);

-- ---------------------------------------------------------------------------
-- Item-Familien und Item-Versionen (Anforderung 5)
-- ---------------------------------------------------------------------------

create table item_family (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table item (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references item_family (id) on delete restrict,
  version_number integer not null default 1,
  predecessor_id uuid references item (id) on delete restrict,
  text           text not null,
  item_type      text not null,
  perspective    text not null,
  status         text not null default 'ZUR_PRUEFUNG',
  used_at        timestamptz,
  origin         text not null default 'MANUELL',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint item_text_valid check (btrim(text) <> '' and char_length(text) <= 500),
  constraint item_type_valid check (item_type in ('FRAGE', 'SITUATION')),
  constraint item_perspective_valid check (perspective in ('SELBST', 'TEAM', 'FUEHRUNG')),
  constraint item_status_valid check (status in ('ZUR_PRUEFUNG', 'FREIGEGEBEN', 'DEAKTIVIERT')),
  constraint item_origin_valid check (origin in ('MANUELL', 'KI', 'IMPORT')),
  constraint item_version_positive check (version_number >= 1),
  constraint item_family_version_unique unique (family_id, version_number)
);

create index item_family_idx on item (family_id);
create index item_status_idx on item (status);

create trigger item_touch before update on item
  for each row execute function kb_touch_updated_at();

-- Verwendete Item-Versionen sind unveränderlich; nur der Status darf wechseln (5.20, 5.25, 6.15).
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

create trigger item_guard before update or delete on item
  for each row execute function kb_item_guard();

-- ---------------------------------------------------------------------------
-- Werte-Zuordnungen
-- ---------------------------------------------------------------------------

create table value_assignment (
  id       uuid primary key default gen_random_uuid(),
  item_id  uuid not null references item (id) on delete cascade,
  value_id uuid not null references value (id) on delete restrict,
  weight   numeric(5, 2) not null,
  constraint value_assignment_weight_range check (weight >= 0 and weight <= 100),
  constraint value_assignment_unique unique (item_id, value_id)
);

create index value_assignment_value_idx on value_assignment (value_id);

-- Zuordnungen verwendeter Item-Versionen sind unveränderlich (5.20).
create or replace function kb_value_assignment_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  target_item uuid;
begin
  target_item := case when tg_op = 'DELETE' then old.item_id else new.item_id end;
  if exists (select 1 from item where id = target_item and used_at is not null) then
    raise exception 'USED_ITEM_IMMUTABLE: Die Werte-Zuordnungen einer verwendeten Item-Version sind unveränderlich.'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.item_id <> new.item_id
     and exists (select 1 from item where id = old.item_id and used_at is not null) then
    raise exception 'USED_ITEM_IMMUTABLE: Die Werte-Zuordnungen einer verwendeten Item-Version sind unveränderlich.'
      using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger value_assignment_guard before insert or update or delete on value_assignment
  for each row execute function kb_value_assignment_guard();
