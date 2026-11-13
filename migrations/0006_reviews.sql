-- TruFolks Ticket 4 — review submission (BRD v1.6 FR-08, FR-11, FR-13–FR-15,
-- HON-01, HON-02, HON-04, LEG-01, LEG-03, AI-05, NFR-05, FR-27).
--
-- * A review needs a VERIFIED purchase of the person writing it (FR-08).
-- * The disclosure is built HERE from the campaign record, never from text the
--   person or the browser sends (LEG-01). Until the PAY-08 formula exists
--   (Tickets 7/8) its reward part is "not_set" and `complete` is false, so the
--   contacts feed (Ticket 5) must not show it to anyone yet.
-- * The disclosure never depends on the star rating (PAY-01, HON-01).
-- * Once posted, rating, honest fields and disclosure are locked (FR-15).
--   Edit-with-history is a later ticket. Removal is an admin action (FR-25).
-- * No payout data on reviews or review events (FR-27).
-- Atomic work is one plpgsql function per call (the Sql client has no transactions).

-- ------------------------------------------------------------------ event log
create table review_events (
  id                 text primary key default gen_random_uuid()::text,
  review_id          text not null references reviews (id),
  user_id            text not null references users (id),
  event              text not null check (event in ('submitted')),
  disclosure_version integer,
  at                 timestamptz not null default now()
);
create index review_events_review_idx on review_events (review_id, at);

create or replace function trufolks_review_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'review_events is append-only';
end;
$$;

create trigger review_events_no_update_or_delete
  before update or delete on review_events
  for each row execute function trufolks_review_events_append_only();

create trigger review_events_no_truncate
  before truncate on review_events
  for each statement execute function trufolks_review_events_append_only();

-- ------------------------------------------------------------------ disclosure
-- The one place the disclosure is built. Used for the preview and for the
-- posted review, so the person sees exactly what contacts will see (FR-14).
-- Takes only the purchase: nothing about the review (rating included) can
-- change it.
create or replace function trufolks_review_disclosure(p_purchase_id text) returns jsonb
language plpgsql stable as $$
declare
  v_p verified_purchases%rowtype;
  v_merchant_name text;
  v_campaign_name text;
begin
  select * into v_p from verified_purchases where id = p_purchase_id;
  if not found then return null; end if;
  select name into v_merchant_name from merchants where id = v_p.merchant_id;
  if v_p.campaign_id is not null then
    select name into v_campaign_name from campaigns where id = v_p.campaign_id;
  end if;
  return jsonb_build_object(
    'version', 1,
    'incentive', v_p.campaign_id is not null,
    'rating_blind', true,
    'merchant_name', v_merchant_name,
    'campaign_id', v_p.campaign_id,
    'campaign_name', v_campaign_name,
    'verified_purchase', true,
    -- PAY-08 / LEG-03: filled by Tickets 7/8. Not set = not ready to show contacts.
    'reward', jsonb_build_object('status', case when v_p.campaign_id is null then 'none' else 'not_set' end,
                                 'formula', null, 'amount_cents', null),
    'complete', v_p.campaign_id is null
  );
end;
$$;

-- ------------------------------------------------------------------ guards on reviews
create or replace function trufolks_reviews_insert_guard() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  select verification_status into v_status from verified_purchases where id = new.verified_purchase_id;
  if v_status is distinct from 'verified' then
    raise exception 'A review needs a verified purchase';
  end if;
  if new.disclosure is null or jsonb_typeof(new.disclosure) <> 'object' then
    raise exception 'A review needs its system-attached disclosure';
  end if;
  return new;
end;
$$;

create trigger reviews_insert_guard
  before insert on reviews
  for each row execute function trufolks_reviews_insert_guard();

create or replace function trufolks_reviews_locked() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Reviews cannot be deleted directly';
  end if;
  if new.user_id is distinct from old.user_id
     or new.verified_purchase_id is distinct from old.verified_purchase_id
     or new.rating is distinct from old.rating
     or new.what_used is distinct from old.what_used
     or new.how_long is distinct from old.how_long
     or new.honest_thought is distinct from old.honest_thought
     or new.disclosure is distinct from old.disclosure
     or new.created_at is distinct from old.created_at then
    raise exception 'A posted review''s rating, honest fields and disclosure are locked';
  end if;
  return new;
end;
$$;

create trigger reviews_locked
  before update or delete on reviews
  for each row execute function trufolks_reviews_locked();

create or replace function trufolks_reviews_no_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'Reviews cannot be deleted directly';
end;
$$;

create trigger reviews_no_truncate
  before truncate on reviews
  for each statement execute function trufolks_reviews_no_truncate();

-- ------------------------------------------------------------------ submit
-- Outcomes: ok, not_found, not_verified, rejected, already_reviewed, invalid.
create or replace function trufolks_submit_review(
  p_purchase_id text,
  p_user_id text,
  p_rating integer,
  p_what_used text,
  p_how_long text,
  p_honest_thought text,
  p_max_short integer,
  p_max_thought integer
) returns table (r_outcome text, r_review_id text)
language plpgsql as $$
declare
  v_p verified_purchases%rowtype;
  v_id text;
  v_disclosure jsonb;
begin
  select * into v_p from verified_purchases where id = p_purchase_id for update;
  if not found or v_p.user_id is distinct from p_user_id then
    return query select 'not_found'::text, null::text; return;
  end if;
  if v_p.verification_status = 'pending' then
    return query select 'not_verified'::text, null::text; return;
  end if;
  if v_p.verification_status <> 'verified' then
    return query select 'rejected'::text, null::text; return;
  end if;
  if exists (select 1 from reviews where verified_purchase_id = p_purchase_id) then
    return query select 'already_reviewed'::text, null::text; return;
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5
     or coalesce(length(trim(p_what_used)), 0) = 0 or length(p_what_used) > p_max_short
     or coalesce(length(trim(p_how_long)), 0) = 0 or length(p_how_long) > p_max_short
     or coalesce(length(trim(p_honest_thought)), 0) = 0 or length(p_honest_thought) > p_max_thought then
    return query select 'invalid'::text, null::text; return;
  end if;

  v_disclosure := trufolks_review_disclosure(p_purchase_id) || jsonb_build_object('attached_at', now());

  insert into reviews (user_id, verified_purchase_id, rating, what_used, how_long, honest_thought, disclosure)
  values (p_user_id, p_purchase_id, p_rating, trim(p_what_used), trim(p_how_long), trim(p_honest_thought), v_disclosure)
  returning id into v_id;

  insert into review_events (review_id, user_id, event, disclosure_version)
  values (v_id, p_user_id, 'submitted', (v_disclosure ->> 'version')::int);

  return query select 'ok'::text, v_id;
end;
$$;
