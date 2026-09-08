create table if not exists profiles (
  user_id text primary key,
  school text not null default '',
  grade text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists lectures_started_at_idx on lectures (started_at desc);
