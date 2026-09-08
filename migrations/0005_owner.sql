alter table profiles add column if not exists is_owner boolean not null default false;
create unique index if not exists profiles_one_owner on profiles (is_owner) where is_owner;
