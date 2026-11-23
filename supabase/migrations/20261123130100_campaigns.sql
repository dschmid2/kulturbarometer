-- Kampagnen, Entwurfs-Pool und Kampagnen-Snapshot
-- Anforderung 6; Datenmodell siehe design.md

create table campaign (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  start_date            date not null,
  end_date              date not null,
  status                text not null default 'ENTWURF',
  items_per_participant integer,
  anonymity_threshold   integer not null default 5,
  distribution_mode     text not null default 'PUBLIC_LINK',
  activated_at          timestamptz,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint campaign_title_valid check (btrim(title) <> '' and char_length(title) <= 200),
  constraint campaign_period_valid check (end_date > start_date),
  constraint campaign_status_valid check (status in ('ENTWURF', 'AKTIV', 'ABGESCHLOSSEN')),
  constraint campaign_items_per_participant_valid check (items_per_participant is null or items_per_participant >= 1),
  constraint campaign_threshold_valid check (anonymity_threshold between 3 and 100),
  constraint campaign_distribution_mode_valid check (distribution_mode in ('PUBLIC_LINK', 'EMAIL_ONE_TIME'))
);

create trigger campaign_touch before update on campaign
  for each row execute function kb_touch_updated_at();

-- Statusfolge Entwurf → Aktiv → Abgeschlossen (6.26); nach der Aktivierung sind
-- Item-Anzahl, Anonymitätsschwelle und Verteilmodus eingefroren (6.14, 6.30).
create or replace function kb_campaign_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status
     and not ((old.status = 'ENTWURF' and new.status = 'AKTIV')
           or (old.status = 'AKTIV' and new.status = 'ABGESCHLOSSEN')) then
    raise exception 'INVALID_STATUS_TRANSITION: Statuswechsel von % nach % ist nicht zulässig.', old.status, new.status
      using errcode = 'P0001';
  end if;
  if old.status <> 'ENTWURF'
     and (new.items_per_participant is distinct from old.items_per_participant
          or new.anonymity_threshold is distinct from old.anonymity_threshold
          or new.distribution_mode is distinct from old.distribution_mode
          or new.start_date is distinct from old.start_date
          or new.end_date is distinct from old.end_date) then
    raise exception 'SNAPSHOT_IMMUTABLE: Die Einstellungen einer aktivierten Kampagne sind unveränderlich.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger campaign_guard before update on campaign
  for each row execute function kb_campaign_guard();

-- ---------------------------------------------------------------------------
-- Entwurfs-Pool (6.4, 6.5)
-- ---------------------------------------------------------------------------

create table campaign_pool_item (
  campaign_id uuid not null references campaign (id) on delete cascade,
  item_id     uuid not null references item (id) on delete cascade,
  primary key (campaign_id, item_id)
);

create index campaign_pool_item_item_idx on campaign_pool_item (item_id);

create or replace function kb_pool_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  c_status text;
  i_status text;
begin
  if tg_op = 'INSERT' then
    select status into c_status from campaign where id = new.campaign_id;
    if c_status <> 'ENTWURF' then
      raise exception 'SNAPSHOT_IMMUTABLE: Der Kampagnen-Pool kann nur im Status Entwurf geändert werden.'
        using errcode = 'P0001';
    end if;
    select status into i_status from item where id = new.item_id;
    if i_status <> 'FREIGEGEBEN' then
      raise exception 'ITEM_NOT_APPROVED: Nur freigegebene Items können einem Kampagnen-Pool zugeordnet werden.'
        using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- DELETE: Entfernen nur im Entwurf; das Löschen der Kampagne selbst (Kaskade) bleibt möglich.
  select status into c_status from campaign where id = old.campaign_id;
  if c_status is not null and c_status <> 'ENTWURF' then
    raise exception 'SNAPSHOT_IMMUTABLE: Der Kampagnen-Pool kann nur im Status Entwurf geändert werden.'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger campaign_pool_item_guard before insert or delete on campaign_pool_item
  for each row execute function kb_pool_guard();

-- ---------------------------------------------------------------------------
-- Kampagnen-Snapshot (6.13–6.15)
-- ---------------------------------------------------------------------------

create table snapshot_item (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references campaign (id) on delete restrict,
  item_version_id uuid not null references item (id) on delete restrict,
  text            text not null,
  item_type       text not null,
  perspective     text not null,
  deactivated_at  timestamptz,
  constraint snapshot_item_unique unique (campaign_id, item_version_id)
);

create index snapshot_item_campaign_idx on snapshot_item (campaign_id);

create table snapshot_assignment (
  id                     uuid primary key default gen_random_uuid(),
  snapshot_item_id       uuid not null references snapshot_item (id) on delete restrict,
  value_id               uuid not null references value (id) on delete restrict,
  value_name_at_snapshot text not null,
  weight                 numeric(5, 2) not null,
  constraint snapshot_assignment_unique unique (snapshot_item_id, value_id)
);

create index snapshot_assignment_value_idx on snapshot_assignment (value_id);

-- Einzige zulässige Änderung: deactivated_at einmalig von NULL auf einen Zeitpunkt (6.14, 6.21).
create or replace function kb_snapshot_item_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SNAPSHOT_IMMUTABLE: Kampagnen-Snapshots können nicht gelöscht werden.'
      using errcode = 'P0001';
  end if;
  if new.campaign_id is distinct from old.campaign_id
     or new.item_version_id is distinct from old.item_version_id
     or new.text is distinct from old.text
     or new.item_type is distinct from old.item_type
     or new.perspective is distinct from old.perspective
     or (old.deactivated_at is not null and new.deactivated_at is distinct from old.deactivated_at)
     or (old.deactivated_at is null and new.deactivated_at is null) then
    raise exception 'SNAPSHOT_IMMUTABLE: Der Kampagnen-Snapshot ist unveränderlich.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger snapshot_item_guard before update or delete on snapshot_item
  for each row execute function kb_snapshot_item_guard();

create or replace function kb_snapshot_assignment_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'SNAPSHOT_IMMUTABLE: Der Kampagnen-Snapshot ist unveränderlich.'
    using errcode = 'P0001';
end;
$$;

create trigger snapshot_assignment_guard before update or delete on snapshot_assignment
  for each row execute function kb_snapshot_assignment_guard();
