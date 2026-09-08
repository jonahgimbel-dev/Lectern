alter table profiles add column if not exists plan text not null default 'free';
alter table profiles add column if not exists plan_status text not null default 'none';
alter table profiles add column if not exists stripe_customer_id text;
alter table profiles add column if not exists stripe_subscription_id text;
