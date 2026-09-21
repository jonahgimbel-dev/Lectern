create table if not exists course_archive (
  id text primary key,
  course_id text not null,
  user_id text not null,
  user_email text not null default '',
  user_name text not null default '',
  name text not null,
  code text not null default '',
  term text not null default '',
  instructor text not null default '',
  syllabus text not null default '',
  master_summary text not null default '',
  archived_at timestamptz not null default now()
);
create index if not exists course_archive_course_idx on course_archive (course_id, archived_at desc);
create index if not exists course_archive_email_idx on course_archive (lower(user_email), archived_at desc);

create table if not exists exam_archive (
  id text primary key,
  exam_id text not null,
  user_id text not null,
  user_email text not null default '',
  user_name text not null default '',
  course_id text not null,
  course_name text not null default '',
  course_code text not null default '',
  title text not null,
  exam_on text not null,
  notes text not null default '',
  archived_at timestamptz not null default now()
);
create index if not exists exam_archive_exam_idx on exam_archive (exam_id, archived_at desc);
