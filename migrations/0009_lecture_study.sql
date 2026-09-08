alter table lectures add column if not exists asks_json text not null default '[]';
alter table lectures add column if not exists traps_json text not null default '[]';
alter table exams add column if not exists source text not null default 'manual';
