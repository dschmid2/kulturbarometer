-- Verteilung über den öffentlichen Kampagnen-Link, offene Teilnahmen und Antworten
-- Anforderungen 7 und 8; Datenmodell siehe design.md
-- Anonymität: Antworten verweisen weder auf Link noch Teilnahmekennung noch Session (7.19, 8.9).

create table campaign_link (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaign (id) on delete cascade,
  link_token  text not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  constraint campaign_link_token_unique unique (link_token)
);

-- Höchstens ein gültiger Link je Kampagne (7.15).
create unique index campaign_link_one_active on campaign_link (campaign_id) where revoked_at is null;

-- Serverseitiger Teil der Teilnahmekennung: nur ein Hash, kein Zeitstempel (7.6, 7.19).
create table participant_marker (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaign (id) on delete cascade,
  code_hash   text not null,
  status      text not null default 'OFFEN',
  constraint participant_marker_status_valid check (status in ('OFFEN', 'TEILGENOMMEN')),
  constraint participant_marker_unique unique (campaign_id, code_hash)
);

-- Offene Teilnahme: gezogene Teilmenge bis zur Übermittlung, keine Bewertungen (8.11, 8.13).
create table survey_session (
  id                      uuid primary key default gen_random_uuid(),
  campaign_id             uuid not null references campaign (id) on delete cascade,
  access_key_hash         text not null,
  drawn_snapshot_item_ids uuid[] not null,
  constraint survey_session_unique unique (campaign_id, access_key_hash),
  constraint survey_session_not_empty check (cardinality(drawn_snapshot_item_ids) >= 1)
);

-- Antwort-Hülle: nur Kalendertag und Abgabenummer (7.19, 10.12).
create table participation (
  id                      uuid primary key default gen_random_uuid(),
  campaign_id             uuid not null references campaign (id) on delete restrict,
  submitted_on            date not null default current_date,
  submission_seq          integer not null,
  drawn_snapshot_item_ids uuid[] not null,
  constraint participation_seq_unique unique (campaign_id, submission_seq),
  constraint participation_seq_positive check (submission_seq >= 1)
);

create table answer_item (
  id               uuid primary key default gen_random_uuid(),
  participation_id uuid not null references participation (id) on delete cascade,
  snapshot_item_id uuid not null references snapshot_item (id) on delete restrict,
  rating           numeric(3, 2) not null,
  comment          text,
  constraint answer_item_rating_range check (rating >= 1 and rating <= 5),
  constraint answer_item_comment_length check (comment is null or char_length(comment) <= 1000),
  constraint answer_item_unique unique (participation_id, snapshot_item_id)
);

create index answer_item_snapshot_idx on answer_item (snapshot_item_id);

-- Antworten nur für aktive Kampagnen (6.27).
create or replace function kb_participation_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select status from campaign where id = new.campaign_id) <> 'AKTIV' then
    raise exception 'CAMPAIGN_NOT_ACTIVE: Die Umfrage ist derzeit nicht verfügbar.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger participation_guard before insert on participation
  for each row execute function kb_participation_guard();

-- ---------------------------------------------------------------------------
-- Row Level Security: aktiviert, ohne Policies. Das Frontend greift nie direkt
-- auf Tabellen zu; nur das Backend (direkte Postgres-Verbindung) liest und schreibt.
-- ---------------------------------------------------------------------------

alter table value enable row level security;
alter table focus_sentence enable row level security;
alter table item_family enable row level security;
alter table item enable row level security;
alter table value_assignment enable row level security;
alter table campaign enable row level security;
alter table campaign_pool_item enable row level security;
alter table snapshot_item enable row level security;
alter table snapshot_assignment enable row level security;
alter table campaign_link enable row level security;
alter table participant_marker enable row level security;
alter table survey_session enable row level security;
alter table participation enable row level security;
alter table answer_item enable row level security;
