-- eodi.me Supabase Schema — Subscription Management
-- Deploy via Supabase SQL Editor or `supabase db push`
--
-- Model: feature-unlock by plan tier (not credit-based)
-- Plans: free → personal ($8/mo) → solo_biz ($19/mo) → business ($99/mo) → enterprise ($249/mo)
-- LemonSqueezy webhook events sync subscription state here.
-- The desktop app manages its own local license.json via the LS Licenses API.

-- =============================================================================
-- 1. user_subscriptions — one row per paying customer (keyed by email)
-- =============================================================================

create table if not exists user_subscriptions (
  id                    uuid default gen_random_uuid() primary key,
  -- Customer email (matches LemonSqueezy order email)
  user_email            text not null unique,
  -- Current plan tier
  plan                  text not null default 'free'
    check (plan in ('free', 'personal', 'solo_biz', 'business', 'enterprise')),
  -- Subscription lifecycle status
  status                text not null default 'active'
    check (status in ('active', 'cancelled', 'expired', 'past_due', 'paused', 'on_trial')),
  -- LemonSqueezy IDs (for webhook idempotency and support)
  ls_subscription_id    text unique,
  ls_order_id           text,
  ls_customer_id        text,
  ls_variant_name       text,
  ls_product_name       text,
  -- Billing period
  current_period_start  timestamp with time zone,
  current_period_end    timestamp with time zone,
  -- Timestamps
  created_at            timestamp with time zone default now() not null,
  updated_at            timestamp with time zone default now() not null
);

create index if not exists user_subscriptions_email_idx on user_subscriptions(user_email);
create index if not exists user_subscriptions_ls_sub_idx on user_subscriptions(ls_subscription_id);
create index if not exists user_subscriptions_status_idx on user_subscriptions(status);

-- RLS: service role only (webhook function uses service key; no direct client reads needed)
alter table user_subscriptions enable row level security;

-- Explicit deny-all for anon and authenticated roles (belt-and-suspenders).
-- Only the webhook Edge Function (service role) can read/write.
create policy "deny_select_user_subscriptions" on user_subscriptions
  for select to anon, authenticated using (false);
create policy "deny_insert_user_subscriptions" on user_subscriptions
  for insert to anon, authenticated with check (false);
create policy "deny_update_user_subscriptions" on user_subscriptions
  for update to anon, authenticated using (false);
create policy "deny_delete_user_subscriptions" on user_subscriptions
  for delete to anon, authenticated using (false);

-- =============================================================================
-- 2. subscription_events — immutable audit log of all webhook events
-- =============================================================================

create table if not exists subscription_events (
  id           uuid default gen_random_uuid() primary key,
  user_email   text not null,
  event_name   text not null,
  plan         text,
  status       text,
  ls_sub_id    text,
  ls_order_id  text,
  raw_payload  jsonb,
  processed_at timestamp with time zone default now() not null
);

create index if not exists sub_events_email_idx on subscription_events(user_email);
create index if not exists sub_events_time_idx  on subscription_events(processed_at desc);

alter table subscription_events enable row level security;

-- Explicit deny-all for anon and authenticated roles.
create policy "deny_select_subscription_events" on subscription_events
  for select to anon, authenticated using (false);
create policy "deny_insert_subscription_events" on subscription_events
  for insert to anon, authenticated with check (false);
create policy "deny_update_subscription_events" on subscription_events
  for update to anon, authenticated using (false);
create policy "deny_delete_subscription_events" on subscription_events
  for delete to anon, authenticated using (false);

-- =============================================================================
-- 3. Trigger: auto-update updated_at on user_subscriptions
-- =============================================================================

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_user_subscriptions_updated_at on user_subscriptions;
create trigger update_user_subscriptions_updated_at
  before update on user_subscriptions
  for each row
  execute function update_updated_at_column();

-- =============================================================================
-- 4. Helper: get_subscription_plan(email) — callable by service role
-- =============================================================================

create or replace function get_subscription_plan(p_email text)
returns text
language plpgsql
security definer
as $$
declare
  v_plan   text;
  v_status text;
begin
  select plan, status into v_plan, v_status
  from user_subscriptions
  where user_email = lower(trim(p_email))
  limit 1;

  -- Treat cancelled/expired/past_due as free
  if v_plan is null or v_status in ('cancelled', 'expired') then
    return 'free';
  end if;

  return v_plan;
end;
$$;

-- =============================================================================
-- DEPLOYMENT CHECKLIST
-- =============================================================================
-- 1. Run this SQL in Supabase → SQL Editor
-- 2. Deploy lemon-webhook Edge Function:
--    supabase functions deploy lemon-webhook
-- 3. Set Supabase secrets:
--    supabase secrets set LEMON_SQUEEZY_WEBHOOK_SECRET=<from LS dashboard>
-- 4. Add webhook URL to LemonSqueezy dashboard:
--    https://<project>.supabase.co/functions/v1/lemon-webhook
--    Events: subscription_created, subscription_updated, subscription_cancelled,
--            subscription_expired, subscription_payment_success, subscription_payment_failed
-- =============================================================================
