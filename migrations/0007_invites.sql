create table if not exists invite_codes (
  id text primary key,
  owner_id text not null,
  code text not null unique,
  label text not null default '',
  max_uses integer not null default 1,
  uses integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invite_codes_owner_idx on invite_codes (owner_id);
