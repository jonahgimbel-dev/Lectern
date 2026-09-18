create table if not exists lecture_archive (
  id text primary key,
  lecture_id text not null,
  user_id text not null,
  user_email text not null default '',
  user_name text not null default '',
  course_id text not null,
  course_name text not null default '',
  course_code text not null default '',
  title text not null,
  started_at timestamptz,
  duration_sec integer not null default 0,
  transcript text not null default '',
  summary text not null default '',
  outline_json text not null default '[]',
  terms_json text not null default '[]',
  actions_json text not null default '[]',
  asks_json text not null default '[]',
  traps_json text not null default '[]',
  source text not null default 'mic',
  reason text not null default 'save',
  archived_at timestamptz not null default now()
);
create index if not exists lecture_archive_lecture_idx on lecture_archive (lecture_id, archived_at desc);
create index if not exists lecture_archive_email_idx on lecture_archive (lower(user_email), archived_at desc);
create index if not exists lecture_archive_course_idx on lecture_archive (course_code, course_name);
