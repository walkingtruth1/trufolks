-- TruFolks Ticket 3a — receipt / claim codes (BRD v1.6 FR-06–FR-10, FR-08a,
-- HON-04, HON-05, HON-07, MER-04, NFR-05, NFR-06, §20C).
--
-- * Only hashes are stored: never a raw receipt code or a raw device token.
-- * Scan and claim each run as ONE Postgres function, so "check the code, then
--   mark it" is atomic. The shared Sql client has no transactions and on Neon
--   each query may use a different pooled connection; the code row is locked
--   with FOR UPDATE inside the function instead.
-- * No limit values live in this file. Rate limits and windows are passed in by
--   the caller from src/lib/receipt-codes/limits.ts (CFG-11, Ticket 7).
-- * Claimed = purchase pending verification. Nothing here is money: no amounts,
--   no payout status (FR-27, PAY-01). The payout ledger is Ticket 8.
-- * A purchase from a handout code (not tied to one till purchase) can only be
--   verified with a receipt-photo check (FR-08a). Pilot codes are handouts.

-- A phone / browser, known by a long-lived server-made token (HON-07). Not a
-- login and not a session: it survives sign-out. Only the token's hash is kept.
create table devices (
  id            text primary key default gen_random_uuid()::text,
  token_hash    text not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);

-- One row per printed / handed-out code (FR-06, MER-04).
create table receipt_codes (
  id                 text primary key default gen_random_uuid()::text,
  campaign_id        text not null,
  merchant_id        text not null references merchants (id),
  code_hash          text not null unique,      -- HMAC-SHA256 of the normalised code
  issue_mode         text not null default 'handout_batch'
                     check (issue_mode in ('till_single_purchase', 'handout_batch')),
  -- Single use (HON-04). Kept as a column so a later campaign rule can relax
  -- it; until reuse is designed, anything other than 1 is refused.
  max_uses           integer not null check (max_uses = 1),
  status             text not null default 'issued'
                     check (status in ('issued', 'bound', 'claimed', 'suspended')),
  expires_at         timestamptz not null,
  issued_by_user_id  text not null references users (id),
  issued_at          timestamptz not null default now(),
  bound_device_id    text references devices (id),  -- set on first valid scan
  bound_at           timestamptz,
  claimed_by_user_id text references users (id),    -- set on claim
  claimed_at         timestamptz,
  suspended_at       timestamptz,
  suspended_reason   text,
  foreign key (campaign_id, merchant_id) references campaigns (id, merchant_id),
  check (expires_at > issued_at),
  check ((bound_device_id is null) = (bound_at is null)),
  check (status not in ('bound', 'claimed') or bound_device_id is not null),
  check ((claimed_by_user_id is null) = (claimed_at is null)),
  check (status <> 'claimed' or claimed_by_user_id is not null),
  check (status <> 'suspended'
         or (suspended_at is not null and length(trim(coalesce(suspended_reason, ''))) > 0))
);
create index receipt_codes_campaign_id_idx on receipt_codes (campaign_id);
create index receipt_codes_claimed_by_idx on receipt_codes (campaign_id, claimed_by_user_id);

-- Append-only log of every issue, scan, claim, suspension and new device
-- (FR-22, NFR-05, HON-07). Also the source for rate limiting. code_id is null
-- when a guess matched nothing. IPs are stored only as a keyed hash (P5).
create table receipt_code_events (
  id          text primary key default gen_random_uuid()::text,
  at          timestamptz not null default clock_timestamp(),
  kind        text not null
              check (kind in ('issued', 'scan', 'claim', 'suspend', 'device_created')),
  outcome     text not null,
  code_id     text references receipt_codes (id),
  campaign_id text,
  device_id   text references devices (id),
  user_id     text references users (id),
  ip_hash     text,
  detail      jsonb
);
create index receipt_code_events_device_idx on receipt_code_events (device_id, at);
create index receipt_code_events_ip_idx on receipt_code_events (ip_hash, at);
create index receipt_code_events_code_idx on receipt_code_events (code_id, at);

create or replace function trufolks_receipt_code_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'receipt_code_events is append-only';
end;
$$;

create trigger receipt_code_events_no_update_or_delete
  before update or delete on receipt_code_events
  for each row execute function trufolks_receipt_code_events_append_only();

create trigger receipt_code_events_no_truncate
  before truncate on receipt_code_events
  for each statement execute function trufolks_receipt_code_events_append_only();

-- Link purchases to the code that proved them. One purchase per code (HON-04).
alter table verified_purchases
  add constraint verified_purchases_receipt_code_id_fkey
  foreign key (receipt_code_id) references receipt_codes (id);
alter table verified_purchases
  add constraint verified_purchases_receipt_code_id_key unique (receipt_code_id);

-- Purchase ↔ code rules, checked on every insert / update:
--   * a code-based purchase must link its code;
--   * the purchaser must be the person who claimed the code, for the same campaign;
--   * "verified" needs the code to still be claimed (not suspended);
--   * a handout code alone can never verify a purchase — it needs the receipt
--     photo check too (FR-08a, HON-07: a photographed static code must fail).
create or replace function trufolks_check_purchase_receipt_code() returns trigger
language plpgsql as $$
declare
  v_code receipt_codes%rowtype;
begin
  if new.verification_method in ('receipt_code', 'receipt_code_and_photo')
     and new.receipt_code_id is null then
    raise exception 'A purchase verified by a receipt code must link that code';
  end if;
  if new.receipt_code_id is null then
    return new;
  end if;

  select * into v_code from receipt_codes where id = new.receipt_code_id;
  if not found then
    raise exception 'Receipt code % does not exist', new.receipt_code_id;
  end if;
  if v_code.claimed_by_user_id is distinct from new.user_id then
    raise exception 'Only the person who claimed this code can use it for a purchase';
  end if;
  if v_code.campaign_id is distinct from new.campaign_id then
    raise exception 'The purchase campaign must match the code campaign';
  end if;
  if new.verification_status = 'verified' then
    if v_code.status <> 'claimed' then
      raise exception 'A purchase cannot be verified with a code that is %', v_code.status;
    end if;
    if v_code.issue_mode = 'handout_batch'
       and new.verification_method <> 'receipt_code_and_photo' then
      raise exception 'A handout code needs a receipt photo check before the purchase can be verified (FR-08a)';
    end if;
  end if;
  return new;
end;
$$;

create trigger verified_purchases_check_receipt_code
  before insert or update on verified_purchases
  for each row execute function trufolks_check_purchase_receipt_code();

-- Why a code cannot be used right now, or 'ok'. Shared by scan and claim.
create or replace function trufolks_receipt_code_problem(
  p_code receipt_codes,
  p_campaign campaigns,
  p_merchant_status text,
  p_device_id text
) returns text
language plpgsql stable as $$
begin
  if p_code.status = 'suspended' then return 'suspended'; end if;
  if p_code.status = 'claimed' then return 'used'; end if;
  if p_code.status = 'bound' and p_code.bound_device_id is distinct from p_device_id then
    return 'other_device';
  end if;
  if p_merchant_status <> 'verified' or p_campaign.status <> 'live' then
    return 'campaign_not_live';
  end if;
  if now() < p_campaign.starts_at then return 'campaign_not_started'; end if;
  if now() >= p_campaign.ends_at then return 'campaign_ended'; end if;
  if now() >= p_code.expires_at then return 'expired'; end if;
  return 'ok';
end;
$$;

-- Serialise work per device and per network address for the rest of the
-- transaction, so parallel requests can't all pass a rate-limit count before
-- any of them is logged. Always device first, then address.
create or replace function trufolks_receipt_code_lock(p_device_id text, p_ip_hash text) returns void
language plpgsql as $$
begin
  if p_device_id is not null then
    perform pg_advisory_xact_lock(hashtext('trufolks-rc-device:' || p_device_id));
  end if;
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtext('trufolks-rc-ip:' || p_ip_hash));
  end if;
end;
$$;

-- Create a device unless this network address has made too many recently.
-- Returns the new device id, or null when rate limited. Logged atomically.
create or replace function trufolks_create_device(
  p_token_hash text,
  p_ip_hash text,
  p_window_seconds integer,
  p_max_new_devices integer
) returns text
language plpgsql as $$
declare
  v_recent integer;
  v_id text;
begin
  perform trufolks_receipt_code_lock(null, p_ip_hash);
  select count(*)::int into v_recent
  from receipt_code_events
  where kind = 'device_created' and outcome = 'ok' and ip_hash = p_ip_hash
    and at > now() - make_interval(secs => p_window_seconds);
  if v_recent >= p_max_new_devices then
    insert into receipt_code_events (kind, outcome, ip_hash) values ('device_created', 'rate_limited', p_ip_hash);
    return null;
  end if;
  insert into devices (token_hash) values (p_token_hash) returning id into v_id;
  insert into receipt_code_events (kind, outcome, device_id, ip_hash) values ('device_created', 'ok', v_id, p_ip_hash);
  return v_id;
end;
$$;

-- Recent failures that count toward rate limits: guesses (not_found) and
-- replays / shared codes (used, other_device). Typos caught by the check
-- character (malformed) and plain expiry do not count.
create or replace function trufolks_receipt_code_failures(
  p_device_id text,
  p_ip_hash text,
  p_window_seconds integer
) returns table (r_device_failures integer, r_ip_failures integer)
language sql stable as $$
  select
    count(*) filter (where e.device_id = p_device_id)::int,
    count(*) filter (where e.ip_hash = p_ip_hash)::int
  from receipt_code_events e
  where e.kind in ('scan', 'claim')
    and e.outcome in ('not_found', 'used', 'other_device')
    and e.at > now() - make_interval(secs => p_window_seconds)
    and (e.device_id = p_device_id or e.ip_hash = p_ip_hash);
$$;

-- Scan (FR-07, FR-08, HON-07). On the first valid scan the code binds to the
-- scanning device. p_code_hash is null when the code failed its check
-- character. Never raises for a failed check, so the event is always logged.
create or replace function trufolks_scan_receipt_code(
  p_code_hash text,
  p_device_id text,
  p_ip_hash text,
  p_window_seconds integer,
  p_max_failures_per_device integer,
  p_max_failures_per_ip integer
) returns table (r_outcome text, r_code_id text, r_campaign_id text)
language plpgsql as $$
declare
  v_code receipt_codes%rowtype;
  v_campaign campaigns%rowtype;
  v_merchant_status text;
  v_device_failures integer;
  v_ip_failures integer;
  v_outcome text;
begin
  perform trufolks_receipt_code_lock(p_device_id, p_ip_hash);
  select f.r_device_failures, f.r_ip_failures into v_device_failures, v_ip_failures
  from trufolks_receipt_code_failures(p_device_id, p_ip_hash, p_window_seconds) f;

  if v_device_failures >= p_max_failures_per_device or v_ip_failures >= p_max_failures_per_ip then
    v_outcome := 'rate_limited';
  elsif p_code_hash is null then
    v_outcome := 'malformed';
  else
    select * into v_code from receipt_codes where code_hash = p_code_hash for update;
    if not found then
      v_outcome := 'not_found';
    else
      select * into v_campaign from campaigns where id = v_code.campaign_id;
      select verification_status into v_merchant_status from merchants where id = v_code.merchant_id;
      v_outcome := trufolks_receipt_code_problem(v_code, v_campaign, v_merchant_status, p_device_id);
      if v_outcome = 'ok' and v_code.status = 'issued' then
        update receipt_codes
           set status = 'bound', bound_device_id = p_device_id, bound_at = now()
         where id = v_code.id;
      end if;
    end if;
  end if;

  insert into receipt_code_events (kind, outcome, code_id, campaign_id, device_id, ip_hash)
  values ('scan', v_outcome, v_code.id, v_code.campaign_id, p_device_id, p_ip_hash);

  return query select v_outcome,
                      case when v_outcome = 'ok' then v_code.id end,
                      case when v_outcome = 'ok' then v_code.campaign_id end;
end;
$$;

-- Claim (FR-08, HON-04, HON-05, HON-07). Same checks as scan, plus: the code
-- must be bound to this device (or bind now if this is its first valid use),
-- the person must not own the business, and the purchase date must sit inside
-- the campaign window. Marks the code claimed and creates a PENDING verified
-- purchase in the same step. Logs how many codes this person has claimed in
-- the campaign, for HON-06 visibility — no cap is applied here.
create or replace function trufolks_claim_receipt_code(
  p_code_hash text,
  p_device_id text,
  p_user_id text,
  p_ip_hash text,
  p_product_label text,
  p_order_value_cents integer,
  p_currency text,
  p_purchased_at timestamptz,
  p_clock_skew_seconds integer,
  p_window_seconds integer,
  p_max_failures_per_device integer,
  p_max_failures_per_ip integer
) returns table (r_outcome text, r_code_id text, r_purchase_id text, r_user_claims_in_campaign integer)
language plpgsql as $$
declare
  v_code receipt_codes%rowtype;
  v_campaign campaigns%rowtype;
  v_merchant merchants%rowtype;
  v_device_failures integer;
  v_ip_failures integer;
  v_outcome text;
  v_purchase_id text;
  v_claims integer;
begin
  perform trufolks_receipt_code_lock(p_device_id, p_ip_hash);
  select f.r_device_failures, f.r_ip_failures into v_device_failures, v_ip_failures
  from trufolks_receipt_code_failures(p_device_id, p_ip_hash, p_window_seconds) f;

  if v_device_failures >= p_max_failures_per_device or v_ip_failures >= p_max_failures_per_ip then
    v_outcome := 'rate_limited';
  elsif p_code_hash is null then
    v_outcome := 'malformed';
  else
    select * into v_code from receipt_codes where code_hash = p_code_hash for update;
    if not found then
      v_outcome := 'not_found';
    else
      select * into v_campaign from campaigns where id = v_code.campaign_id;
      select * into v_merchant from merchants where id = v_code.merchant_id;
      v_outcome := trufolks_receipt_code_problem(v_code, v_campaign, v_merchant.verification_status, p_device_id);
      if v_outcome = 'ok' and v_merchant.owner_user_id = p_user_id then
        v_outcome := 'own_business';
      end if;
      if v_outcome = 'ok'
         and (p_purchased_at < v_campaign.starts_at - make_interval(secs => p_clock_skew_seconds)
              or p_purchased_at > now() + make_interval(secs => p_clock_skew_seconds)) then
        v_outcome := 'purchase_outside_window';
      end if;
      if v_outcome = 'ok' then
        update receipt_codes
           set status = 'claimed',
               bound_device_id = coalesce(bound_device_id, p_device_id),
               bound_at = coalesce(bound_at, now()),
               claimed_by_user_id = p_user_id,
               claimed_at = now()
         where id = v_code.id;

        insert into verified_purchases
          (user_id, merchant_id, campaign_id, product_label, order_value_cents, currency,
           verification_method, verification_status, receipt_code_id, purchased_at)
        values
          (p_user_id, v_code.merchant_id, v_code.campaign_id, p_product_label, p_order_value_cents,
           p_currency, 'receipt_code', 'pending', v_code.id, p_purchased_at)
        returning id into v_purchase_id;

        select count(*)::int into v_claims
        from receipt_codes
        where campaign_id = v_code.campaign_id and claimed_by_user_id = p_user_id;
      end if;
    end if;
  end if;

  insert into receipt_code_events (kind, outcome, code_id, campaign_id, device_id, user_id, ip_hash, detail)
  values ('claim', v_outcome, v_code.id, v_code.campaign_id, p_device_id, p_user_id, p_ip_hash,
          case when v_claims is not null
               then jsonb_build_object('user_claims_in_campaign', v_claims) end);

  return query select v_outcome,
                      case when v_outcome = 'ok' then v_code.id end,
                      v_purchase_id,
                      v_claims;
end;
$$;
