alter table courses add column if not exists lms_provider text;
alter table courses add column if not exists lms_course_id text;
alter table courses add column if not exists lms_url text;

create unique index if not exists courses_user_lms_uidx
  on courses (user_id, lms_provider, lms_course_id)
  where lms_course_id is not null and lms_provider is not null;

create table if not exists lms_connections (
  id text primary key,
  user_id text not null,
  provider text not null,
  base_url text not null,
  token text not null,
  secret text not null default '',
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists lms_connections_user_provider_uidx
  on lms_connections (user_id, provider);
