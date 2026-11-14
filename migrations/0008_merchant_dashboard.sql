-- TruFolks Ticket 6 — merchant dashboard and concierge set-up (BRD v1.6
-- FR-24, MER-01, MER-02, MER-05, MER-07, Journey C, §13, P5, FR-27).
--
-- * Concierge set-up (Jack, 11 Nov 2026): the TruFolks team adds a business for
--   an existing account after checking it in person (MER-01) and creates its
--   offer. The OWNER must accept the pay-for-any-rating statement (MER-02) and
--   the mixed-ratings walkthrough (MER-07) themselves, before any code is made
--   (the code engine already refuses until both are accepted). Every step is
--   logged in merchant_events.
-- * Pilot offers are Type A only (CFG-11 pilot preset). Type B waits for the
--   Ticket 7 toggle.
-- * The dashboard reads only through functions that take the owner's user id:
--   an owner never sees another business (§13). It shows every rating (FR-24),
--   scan-to-review numbers (MER-05) and reviews with NO reviewer name (P5).
-- * No payout numbers here: reward cost to date and cap remaining come with
--   Tickets 7/8 (FR-27).
-- Atomic work is one plpgsql function per call (the Sql client has no transactions).

-- ------------------------------------------------------------------ event log
create table merchant_events (
  id            text primary key default gen_random_uuid()::text,
  merchant_id   text not null references merchants (id),
  actor_user_id text not null references users (id),
  event         text not null check (event in
                  ('created', 'offer_created', 'terms_accepted', 'walkthrough_accepted')),
  campaign_id   text references campaigns (id),
  at            timestamptz not null default now()
);
create index merchant_events_merchant_idx on merchant_events (merchant_id, at);

create or replace function trufolks_merchant_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'merchant_events is append-only';
end;
$$;

create trigger merchant_events_no_update_or_delete
  before update or delete on merchant_events
  for each row execute function trufolks_merchant_events_append_only();

create trigger merchant_events_no_truncate
  before truncate on merchant_events
  for each statement execute function trufolks_merchant_events_append_only();

-- Acceptance is a one-way, dated record: once set it can't be changed or cleared.
create or replace function trufolks_merchants_acceptance_locked() returns trigger
language plpgsql as $$
begin
  if (old.terms_accepted_at is not null and new.terms_accepted_at is distinct from old.terms_accepted_at)
     or (old.walkthrough_accepted_at is not null and new.walkthrough_accepted_at is distinct from old.walkthrough_accepted_at)
     or new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'A merchant''s owner and accepted terms can''t be changed';
  end if;
  return new;
end;
$$;

create trigger merchants_acceptance_locked
  before update on merchants
  for each row execute function trufolks_merchants_acceptance_locked();

-- ------------------------------------------------------------------ concierge set-up (admin)
-- The caller's admin status is checked in the app (allowlist in env), and
-- recorded here as the actor. Outcomes: ok, owner_not_found, invalid.
create or replace function trufolks_admin_create_merchant(
  p_admin_id text,
  p_owner_user_id text,
  p_name text,
  p_business_type text
) returns table (r_outcome text, r_merchant_id text)
language plpgsql as $$
declare
  v_id text;
begin
  if coalesce(length(trim(p_name)), 0) = 0 or length(p_name) > 120
     or length(coalesce(p_business_type, '')) > 80 then
    return query select 'invalid'::text, null::text; return;
  end if;
  if not exists (select 1 from users where id = p_owner_user_id and deleted_at is null) then
    return query select 'owner_not_found'::text, null::text; return;
  end if;
  insert into merchants (owner_user_id, name, business_type, verification_status)
  values (p_owner_user_id, trim(p_name), nullif(trim(coalesce(p_business_type, '')), ''), 'verified')
  returning id into v_id;
  insert into merchant_events (merchant_id, actor_user_id, event) values (v_id, p_admin_id, 'created');
  return query select 'ok'::text, v_id;
end;
$$;

-- Outcomes: ok, not_found, invalid (bad name or dates).
create or replace function trufolks_admin_create_offer(
  p_admin_id text,
  p_merchant_id text,
  p_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns table (r_outcome text, r_campaign_id text)
language plpgsql as $$
declare
  v_id text;
begin
  if not exists (select 1 from merchants where id = p_merchant_id) then
    return query select 'not_found'::text, null::text; return;
  end if;
  if coalesce(length(trim(p_name)), 0) = 0 or length(p_name) > 120
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at <= now() then
    return query select 'invalid'::text, null::text; return;
  end if;
  insert into campaigns (merchant_id, name, campaign_type, starts_at, ends_at, status)
  values (p_merchant_id, trim(p_name), 'A', p_starts_at, p_ends_at, 'live')
  returning id into v_id;
  insert into merchant_events (merchant_id, actor_user_id, event, campaign_id)
  values (p_merchant_id, p_admin_id, 'offer_created', v_id);
  return query select 'ok'::text, v_id;
end;
$$;

-- ------------------------------------------------------------------ owner accepts (MER-02, MER-07)
-- Outcomes: ok, already, not_found (not this person's business), invalid.
create or replace function trufolks_merchant_accept(
  p_user_id text,
  p_merchant_id text,
  p_what text
) returns text
language plpgsql as $$
declare
  v_m merchants%rowtype;
begin
  if p_what not in ('terms', 'walkthrough') then return 'invalid'; end if;
  select * into v_m from merchants where id = p_merchant_id for update;
  if not found or v_m.owner_user_id is distinct from p_user_id then return 'not_found'; end if;
  if p_what = 'terms' then
    if v_m.terms_accepted_at is not null then return 'already'; end if;
    update merchants set terms_accepted_at = now(), updated_at = now() where id = p_merchant_id;
    insert into merchant_events (merchant_id, actor_user_id, event) values (p_merchant_id, p_user_id, 'terms_accepted');
  else
    if v_m.walkthrough_accepted_at is not null then return 'already'; end if;
    update merchants set walkthrough_accepted_at = now(), updated_at = now() where id = p_merchant_id;
    insert into merchant_events (merchant_id, actor_user_id, event) values (p_merchant_id, p_user_id, 'walkthrough_accepted');
  end if;
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ dashboard reads (owner only)
-- One row per offer of every business this person owns. Every rating counted
-- (FR-24); scan-to-review funnel (MER-05). No payout numbers (FR-27).
create or replace function trufolks_owner_offer_stats(p_owner text)
returns table (
  merchant_id         text,
  campaign_id         text,
  campaign_name       text,
  starts_at           timestamptz,
  ends_at             timestamptz,
  status              text,
  codes_made          integer,
  codes_opened        integer,
  codes_claimed       integer,
  purchases_pending   integer,
  purchases_verified  integer,
  purchases_rejected  integer,
  reviews             integer,
  stars_1             integer,
  stars_2             integer,
  stars_3             integer,
  stars_4             integer,
  stars_5             integer
)
language sql stable as $$
  select m.id, c.id, c.name, c.starts_at, c.ends_at, c.status,
         (select count(*)::int from receipt_codes rc where rc.campaign_id = c.id),
         (select count(*)::int from receipt_codes rc where rc.campaign_id = c.id and rc.bound_at is not null),
         (select count(*)::int from receipt_codes rc where rc.campaign_id = c.id and rc.claimed_at is not null),
         (select count(*)::int from verified_purchases vp where vp.campaign_id = c.id and vp.verification_status = 'pending'),
         (select count(*)::int from verified_purchases vp where vp.campaign_id = c.id and vp.verification_status = 'verified'),
         (select count(*)::int from verified_purchases vp where vp.campaign_id = c.id and vp.verification_status = 'rejected'),
         (select count(*)::int from merchant_reviews mr where mr.campaign_id = c.id),
         (select count(*)::int from merchant_reviews mr where mr.campaign_id = c.id and mr.rating = 1),
         (select count(*)::int from merchant_reviews mr where mr.campaign_id = c.id and mr.rating = 2),
         (select count(*)::int from merchant_reviews mr where mr.campaign_id = c.id and mr.rating = 3),
         (select count(*)::int from merchant_reviews mr where mr.campaign_id = c.id and mr.rating = 4),
         (select count(*)::int from merchant_reviews mr where mr.campaign_id = c.id and mr.rating = 5)
    from merchants m
    join campaigns c on c.merchant_id = m.id
   where m.owner_user_id = p_owner;
$$;

-- Reviews of this person's businesses: every rating, no reviewer (P5).
create or replace function trufolks_owner_reviews(p_owner text, p_limit integer)
returns table (
  merchant_id     text,
  campaign_id     text,
  review_id       text,
  product_label   text,
  rating          smallint,
  what_used       text,
  how_long        text,
  honest_thought  text,
  disclosure      jsonb,
  created_at      timestamptz
)
language sql stable as $$
  select mr.merchant_id, mr.campaign_id, mr.review_id, mr.product_label, mr.rating,
         mr.what_used, mr.how_long, mr.honest_thought, mr.disclosure, mr.created_at
    from merchant_reviews mr
    join merchants m on m.id = mr.merchant_id
   where m.owner_user_id = p_owner
   order by mr.created_at desc, mr.review_id desc
   limit p_limit;
$$;
