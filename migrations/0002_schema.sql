create table if not exists courses (
  id text primary key,
  user_id text not null,
  name text not null,
  code text not null,
  term text not null default '',
  instructor text not null default '',
  accent text not null default 'forest',
  syllabus text not null default '',
  master_summary text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists courses_user_id_idx on courses (user_id);

create table if not exists lectures (
  id text primary key,
  user_id text not null,
  course_id text not null references courses(id) on delete cascade,
  title text not null,
  started_at timestamptz not null default now(),
  duration_sec integer not null default 0,
  transcript text not null default '',
  summary text not null default '',
  outline_json text not null default '[]',
  terms_json text not null default '[]',
  actions_json text not null default '[]',
  source text not null default 'mic',
  created_at timestamptz not null default now()
);
create index if not exists lectures_user_course_idx on lectures (user_id, course_id, started_at desc);

create table if not exists cards (
  id text primary key,
  user_id text not null,
  course_id text not null,
  lecture_id text,
  front text not null,
  back text not null,
  box integer not null default 1,
  due_at timestamptz not null default now()
);
create index if not exists cards_due_idx on cards (user_id, course_id, due_at);

create table if not exists exams (
  id text primary key,
  user_id text not null,
  course_id text not null,
  title text not null,
  exam_on text not null,
  notes text not null default ''
);
create index if not exists exams_user_idx on exams (user_id, course_id);
