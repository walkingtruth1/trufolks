-- TruFolks Ticket 8 — payout ledger (BRD v1.6 PAY-01, PAY-03, PAY-06, PAY-08,
-- HON-01, HON-09, FR-19, FR-20, FR-22, FR-27, MER-06, RES-01(c)).
--
-- * One payout per posted review of an offer purchase, in its OWN table: the
--   review row never holds payout data, and a payout rule change never touches
--   a review (FR-27).
-- * A payout is created automatically when a review is posted. The function
--   that does it reads only the purchase and WHETHER the honest fields are
--   filled in — never the rating (PAY-01, PAY-03 programmatic barrier, HON-01).
--   A test checks that neither function mentions the rating.
-- * Amount and formula are a snapshot from the offer's pinned settings and the
--   receipt amount the admin confirmed (PAY-08). Later setting changes don't
--   alter it.
-- * HON-09: held until purchase time + payout.hold_days. Released when due
--   (lazily, when a payouts page loads — there's no scheduler), unless flagged.
--   A flag (RES-01(c)) holds it but never hides the review. Forfeit ($0) only
--   while held: "returned" in the window, or a proven "policy_breach" (needs a
--   flag first). No clawback after release (undecided, for Jack).
-- * Paying: how money reaches people is OPEN (D6). In the concierge pilot the
--   TruFolks team pays by hand and records "paid" with how and a reference.
-- * MER-06: the business funds the pool upfront. The team records deposits; an
--   offer's budget is its deposits, never more than its pool setting. Forfeited
--   payouts give budget back.
-- * Every step is logged in payout_events (FR-22).
-- Atomic work is one plpgsql function per call (the Sql client has no transactions).

-- ------------------------------------------------------------------ deposits (MER-06)
create table offer_deposits (
  id               text primary key default gen_random_uuid()::text,
  campaign_id      text not null references campaigns (id),
  amount_cents     integer not null check (amount_cents > 0),
  received_by      text not null references users (id),
  note             text not null check (length(trim(note)) > 0),
  at               timestamptz not null default clock_timestamp()
);
create index offer_deposits_campaign_idx on offer_deposits (campaign_id);

create or replace function trufolks_ledger_append_only() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger offer_deposits_no_update_or_delete
  before update or delete on offer_deposits
  for each row execute function trufolks_ledger_append_only();
create trigger offer_deposits_no_truncate
  before truncate on offer_deposits
  for each statement execute function trufolks_ledger_append_only();

create or replace function trufolks_offer_deposited_cents(p_campaign_id text) returns integer
language sql stable as $$
  select coalesce(sum(amount_cents), 0)::int from offer_deposits where campaign_id = p_campaign_id;
$$;

-- Outcomes: ok, not_found, invalid, over_pool.
create or replace function trufolks_record_deposit(p_actor text, p_campaign_id text, p_amount_cents integer, p_note text)
returns text
language plpgsql as $$
declare
  v_pool integer;
begin
  if not exists (select 1 from campaigns where id = p_campaign_id) then return 'not_found'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or coalesce(length(trim(p_note)), 0) = 0 or length(p_note) > 500 then
    return 'invalid';
  end if;
  perform pg_advisory_xact_lock(hashtext('trufolks_campaign_room'), hashtext(p_campaign_id));
  select (c.settings -> 'campaign' ->> 'pool_cents')::int into v_pool from trufolks_campaign_config(p_campaign_id) c;
  if v_pool is not null and trufolks_offer_deposited_cents(p_campaign_id) + p_amount_cents > v_pool then
    return 'over_pool';
  end if;
  insert into offer_deposits (campaign_id, amount_cents, received_by, note) values (p_campaign_id, p_amount_cents, p_actor, trim(p_note));
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ payouts
create table payouts (
  id                  text primary key default gen_random_uuid()::text,
  review_id           text not null unique references reviews (id),
  verified_purchase_id text not null unique references verified_purchases (id),
  user_id             text not null references users (id),
  merchant_id         text not null references merchants (id),
  campaign_id         text not null references campaigns (id),
  receipt_code_id     text references receipt_codes (id),
  config_version_id   text references config_versions (id),
  order_value_cents   integer not null check (order_value_cents >= 0),  -- the confirmed receipt amount
  percent_bp          integer not null,
  floor_cents         integer not null,
  cap_cents           integer not null,
  amount_cents        integer not null check (amount_cents >= 0),
  currency            text not null,
  status              text not null default 'held' check (status in ('held', 'released', 'forfeited', 'paid')),
  hold_until          timestamptz not null,
  flagged             boolean not null default false,
  flag_reason         text,
  forfeit_kind        text check (forfeit_kind in ('returned', 'policy_breach')),
  forfeit_reason      text,
  paid_method         text,
  paid_reference      text,
  created_at          timestamptz not null default clock_timestamp(),
  released_at         timestamptz,
  forfeited_at        timestamptz,
  paid_at             timestamptz,
  check ((status = 'forfeited') = (forfeited_at is not null and forfeit_kind is not null)),
  check ((status = 'paid') = (paid_at is not null and paid_method is not null)),
  check (not flagged or flag_reason is not null)
);
create index payouts_user_idx on payouts (user_id, created_at desc);
create index payouts_campaign_idx on payouts (campaign_id);

-- The snapshot never changes; status moves only forward (paid and forfeited
-- are final; released can go back to held only by a flag).
create or replace function trufolks_payouts_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Payouts are kept for good'; end if;
  if (new.review_id, new.verified_purchase_id, new.user_id, new.merchant_id, new.campaign_id, new.receipt_code_id,
      new.config_version_id, new.order_value_cents, new.percent_bp, new.floor_cents, new.cap_cents, new.amount_cents,
      new.currency, new.hold_until, new.created_at)
     is distinct from
     (old.review_id, old.verified_purchase_id, old.user_id, old.merchant_id, old.campaign_id, old.receipt_code_id,
      old.config_version_id, old.order_value_cents, old.percent_bp, old.floor_cents, old.cap_cents, old.amount_cents,
      old.currency, old.hold_until, old.created_at) then
    raise exception 'A payout''s amount and links can''t change';
  end if;
  if old.status in ('paid', 'forfeited') and new is distinct from old then
    raise exception 'A % payout is final', old.status;
  end if;
  if old.status <> new.status and not (
       (old.status = 'held' and new.status in ('released', 'forfeited'))
    or (old.status = 'released' and new.status in ('paid', 'held'))) then
    raise exception 'A payout can''t go from % to %', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger payouts_guard
  before update or delete on payouts
  for each row execute function trufolks_payouts_guard();
create trigger payouts_no_truncate
  before truncate on payouts
  for each statement execute function trufolks_ledger_append_only();

-- ------------------------------------------------------------------ the log (FR-22)
create table payout_events (
  id               text primary key default gen_random_uuid()::text,
  payout_id        text not null references payouts (id),
  review_id        text not null references reviews (id),
  receipt_code_id  text references receipt_codes (id),
  campaign_id      text not null references campaigns (id),
  amount_cents     integer not null,
  event            text not null check (event in
                     ('qualified', 'held', 'released', 'flagged', 'flag_cleared', 'forfeited', 'paid')),
  actor_user_id    text references users (id),   -- null = the system
  reason           text,
  at               timestamptz not null default clock_timestamp()
);
create index payout_events_payout_idx on payout_events (payout_id, at);

create trigger payout_events_no_update_or_delete
  before update or delete on payout_events
  for each row execute function trufolks_ledger_append_only();
create trigger payout_events_no_truncate
  before truncate on payout_events
  for each statement execute function trufolks_ledger_append_only();

create or replace function trufolks_log_payout(p_payout_id text, p_event text, p_actor text, p_reason text) returns void
language sql as $$
  insert into payout_events (payout_id, review_id, receipt_code_id, campaign_id, amount_cents, event, actor_user_id, reason)
  select id, review_id, receipt_code_id, campaign_id, amount_cents, p_event, p_actor, p_reason from payouts where id = p_payout_id;
$$;

-- ------------------------------------------------------------------ qualification (PAY-01 barrier)
-- Reads ONLY: the review's purchase link and whether each honest field has
-- text. Never the rating, never the honest text itself. Outcomes: ok,
-- no_offer (not part of an offer), not_qualified, amount_not_set, already.
create or replace function trufolks_qualify_payout(p_review_id text) returns text
language plpgsql as $$
declare
  v_purchase_id text;
  v_fields_present boolean;
  v_p verified_purchases%rowtype;
  v_reward record;
  v_hold_days integer;
  v_confirmed integer;
  v_id text;
begin
  select r.verified_purchase_id,
         (length(trim(r.what_used)) > 0 and length(trim(r.how_long)) > 0 and length(trim(r.honest_thought)) > 0)
    into v_purchase_id, v_fields_present
    from reviews r where r.id = p_review_id;
  if v_purchase_id is null then return 'not_qualified'; end if;
  if exists (select 1 from payouts where review_id = p_review_id) then return 'already'; end if;
  select * into v_p from verified_purchases where id = v_purchase_id;
  if v_p.campaign_id is null then return 'no_offer'; end if;
  if v_p.verification_status <> 'verified' or not v_fields_present then return 'not_qualified'; end if;
  select * into v_reward from trufolks_purchase_reward(v_purchase_id);
  if v_reward.r_status is distinct from 'set' then return 'amount_not_set'; end if;
  select (c.settings -> 'payout' ->> 'hold_days')::int into v_hold_days from trufolks_campaign_config(v_p.campaign_id) c;
  select d.confirmed_order_value_cents into v_confirmed
    from purchase_verification_decisions d where d.verified_purchase_id = v_purchase_id and d.decision = 'verified';

  insert into payouts (review_id, verified_purchase_id, user_id, merchant_id, campaign_id, receipt_code_id, config_version_id,
                       order_value_cents, percent_bp, floor_cents, cap_cents, amount_cents, currency, hold_until)
  values (p_review_id, v_purchase_id, v_p.user_id, v_p.merchant_id, v_p.campaign_id, v_p.receipt_code_id, v_reward.r_version_id,
          v_confirmed, v_reward.r_percent_bp, v_reward.r_floor_cents, v_reward.r_cap_cents, v_reward.r_amount_cents,
          coalesce(v_reward.r_currency, 'USD'), v_p.purchased_at + make_interval(days => coalesce(v_hold_days, 0)))
  returning id into v_id;
  perform trufolks_log_payout(v_id, 'qualified', null, null);
  perform trufolks_log_payout(v_id, 'held', null, 'Return window (HON-09)');
  return 'ok';
end;
$$;

-- Runs when a review is posted. Passes only the review id on.
create or replace function trufolks_reviews_create_payout() returns trigger
language plpgsql as $$
begin
  perform trufolks_qualify_payout(new.id);
  return null;
end;
$$;

create trigger reviews_create_payout
  after insert on reviews
  for each row execute function trufolks_reviews_create_payout();

-- ------------------------------------------------------------------ release, flag, forfeit, paid
-- Release every held, unflagged payout whose return window has passed. Returns how many.
create or replace function trufolks_release_due_payouts() returns integer
language plpgsql as $$
declare
  v_id text;
  v_n integer := 0;
begin
  for v_id in select id from payouts where status = 'held' and not flagged and hold_until <= now() for update skip locked loop
    update payouts set status = 'released', released_at = now() where id = v_id;
    perform trufolks_log_payout(v_id, 'released', null, 'Return window passed (HON-09)');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Outcomes for the admin actions: ok, not_found, wrong_status, invalid.
create or replace function trufolks_flag_payout(p_actor text, p_payout_id text, p_reason text) returns text
language plpgsql as $$
declare
  v payouts%rowtype;
begin
  if coalesce(length(trim(p_reason)), 0) = 0 or length(p_reason) > 1000 then return 'invalid'; end if;
  select * into v from payouts where id = p_payout_id for update;
  if not found then return 'not_found'; end if;
  if v.status not in ('held', 'released') or v.flagged then return 'wrong_status'; end if;
  update payouts set status = 'held', flagged = true, flag_reason = trim(p_reason), released_at = null where id = p_payout_id;
  perform trufolks_log_payout(p_payout_id, 'flagged', p_actor, trim(p_reason));
  return 'ok';
end;
$$;

create or replace function trufolks_clear_payout_flag(p_actor text, p_payout_id text, p_reason text) returns text
language plpgsql as $$
declare
  v payouts%rowtype;
begin
  if coalesce(length(trim(p_reason)), 0) = 0 or length(p_reason) > 1000 then return 'invalid'; end if;
  select * into v from payouts where id = p_payout_id for update;
  if not found then return 'not_found'; end if;
  if v.status <> 'held' or not v.flagged then return 'wrong_status'; end if;
  update payouts set flagged = false, flag_reason = null where id = p_payout_id;
  perform trufolks_log_payout(p_payout_id, 'flag_cleared', p_actor, trim(p_reason));
  return 'ok';
end;
$$;

-- "returned": only inside the return window. "policy_breach": only after a flag
-- (RES-01: proven breach, logged reason). The review always stays up.
create or replace function trufolks_forfeit_payout(p_actor text, p_payout_id text, p_kind text, p_reason text) returns text
language plpgsql as $$
declare
  v payouts%rowtype;
begin
  if p_kind not in ('returned', 'policy_breach') or coalesce(length(trim(p_reason)), 0) = 0 or length(p_reason) > 1000 then
    return 'invalid';
  end if;
  select * into v from payouts where id = p_payout_id for update;
  if not found then return 'not_found'; end if;
  if v.status <> 'held' then return 'wrong_status'; end if;
  if p_kind = 'returned' and now() >= v.hold_until then return 'window_passed'; end if;
  if p_kind = 'policy_breach' and not v.flagged then return 'needs_flag'; end if;
  update payouts set status = 'forfeited', forfeited_at = now(), forfeit_kind = p_kind, forfeit_reason = trim(p_reason)
   where id = p_payout_id;
  perform trufolks_log_payout(p_payout_id, 'forfeited', p_actor, p_kind || ': ' || trim(p_reason));
  return 'ok';
end;
$$;

create or replace function trufolks_mark_payout_paid(p_actor text, p_payout_id text, p_method text, p_reference text) returns text
language plpgsql as $$
declare
  v payouts%rowtype;
begin
  if coalesce(length(trim(p_method)), 0) = 0 or length(p_method) > 200 or length(coalesce(p_reference, '')) > 200 then
    return 'invalid';
  end if;
  select * into v from payouts where id = p_payout_id for update;
  if not found then return 'not_found'; end if;
  if v.status <> 'released' then return 'wrong_status'; end if;
  update payouts set status = 'paid', paid_at = now(), paid_method = trim(p_method), paid_reference = nullif(trim(coalesce(p_reference, '')), '')
   where id = p_payout_id;
  perform trufolks_log_payout(p_payout_id, 'paid', p_actor, trim(p_method) || coalesce(' / ' || nullif(trim(coalesce(p_reference, '')), ''), ''));
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ the offer budget now uses deposits (MER-06)
-- Replaces the Ticket 7 version. Pool = deposits, never more than the pool
-- setting. Committed = each payout's amount (forfeited = $0), or for a
-- purchase without a payout yet, the PAY-08 estimate (confirmed, else typed).
create or replace function trufolks_campaign_room(p_campaign_id text, p_extra_order_cents integer)
returns table (r_ok boolean, r_claims integer, r_max_reviews integer, r_committed_cents integer, r_pool_cents integer)
language plpgsql stable as $$
declare
  v_cfg jsonb;
  v_bp integer;
  v_floor integer;
  v_cap integer;
  v_max integer;
  v_pool integer;
  v_claims integer;
  v_committed integer;
  v_extra integer;
begin
  select c.settings into v_cfg from trufolks_campaign_config(p_campaign_id) c;
  v_bp := (v_cfg -> 'payout' ->> 'percent_bp')::int;
  v_floor := (v_cfg -> 'payout' ->> 'floor_cents')::int;
  v_cap := (v_cfg -> 'payout' ->> 'cap_cents')::int;
  v_max := (v_cfg -> 'campaign' ->> 'max_reviews')::int;
  v_pool := least((v_cfg -> 'campaign' ->> 'pool_cents')::int, trufolks_offer_deposited_cents(p_campaign_id));
  select count(*)::int,
         coalesce(sum(case
                        when po.id is not null then case when po.status = 'forfeited' then 0 else po.amount_cents end
                        else trufolks_pay08_reward(coalesce(d.confirmed_order_value_cents, vp.order_value_cents), v_bp, v_floor, v_cap)
                      end), 0)::int
    into v_claims, v_committed
    from verified_purchases vp
    left join purchase_verification_decisions d on d.verified_purchase_id = vp.id and d.decision = 'verified'
    left join payouts po on po.verified_purchase_id = vp.id
   where vp.campaign_id = p_campaign_id and vp.verification_status <> 'rejected';
  v_extra := case when p_extra_order_cents > 0 then trufolks_pay08_reward(p_extra_order_cents, v_bp, v_floor, v_cap)
                  else v_floor end;
  return query select (v_claims < v_max and v_committed + v_extra <= v_pool), v_claims, v_max, v_committed, v_pool;
end;
$$;

-- ------------------------------------------------------------------ owner totals (dashboard; owner only)
create or replace function trufolks_owner_payout_totals(p_owner text)
returns table (campaign_id text, deposited_cents integer, held_cents integer, released_cents integer,
               paid_cents integer, forfeited_cents integer)
language sql stable as $$
  select c.id,
         trufolks_offer_deposited_cents(c.id),
         coalesce(sum(p.amount_cents) filter (where p.status = 'held'), 0)::int,
         coalesce(sum(p.amount_cents) filter (where p.status = 'released'), 0)::int,
         coalesce(sum(p.amount_cents) filter (where p.status = 'paid'), 0)::int,
         coalesce(sum(p.amount_cents) filter (where p.status = 'forfeited'), 0)::int
    from merchants m
    join campaigns c on c.merchant_id = m.id
    left join payouts p on p.campaign_id = c.id
   where m.owner_user_id = p_owner
   group by c.id;
$$;
