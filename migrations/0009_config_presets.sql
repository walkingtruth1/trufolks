-- TruFolks Ticket 7 — settings (toggles) with presets, immutable log, startup
-- validation hooks, cooling-off, offer caps and the full disclosure (BRD v1.6
-- §20 CFG-01–CFG-13, PAY-01, PAY-08, FR-21, LEG-01, LEG-03, HON-01; gaps 18–21).
--
-- * Settings are one JSON document per VERSION. A version row never changes,
--   except once from 'accepted' to 'rejected' (startup validation, CFG-01).
--   New settings are new keys in the document: no core table changes (CFG-02).
-- * Validation lives in the app (src/lib/config/validate.ts). The app refuses an
--   invalid version at write time, and on first use in each process it marks
--   any stored version that no longer validates as 'rejected' (logged), so
--   every SQL reader below falls back to the last valid version. Nothing crashes.
-- * Offers are PINNED to the version in force when they were created
--   (campaigns.config_preset_id, can't change). An offer's money rules, cap,
--   eligibility and format never change mid-flight: a change applies to the
--   next offer (CFG-13 "subsequent campaign cycles").
-- * Global settings (visibility, disclosure wording, fraud checks) apply to
--   live offers, so a change to them waits 24 hours while any offer is live
--   (CFG-13). Only one pending version at a time.
-- * PAY-08: reward = min(cap, max(floor, order × percentage)). The function
--   takes no rating, and nothing that calls it reads one (PAY-01, HON-01).
-- * Disclosure v2 states the formula and the amount for that review (LEG-03).
--   It counts as complete only when the amount is known AND the wording is
--   marked lawyer-approved (Jack, 11 Nov 2026). Until then contacts see nothing
--   (gap 19). Earlier reviews are finished by a deliberate, logged step (gap 21).
-- Atomic work is one plpgsql function per call (the Sql client has no transactions).

-- ------------------------------------------------------------------ versions
create table config_versions (
  id                     text primary key default gen_random_uuid()::text,
  settings               jsonb not null check (jsonb_typeof(settings) = 'object'),
  status                 text not null default 'accepted' check (status in ('accepted', 'rejected')),
  created_by             text references users (id),       -- null = the system seed
  reason                 text not null check (length(trim(reason)) > 0),
  created_at             timestamptz not null default clock_timestamp(),
  cooling_off_started_at timestamptz,
  effective_at           timestamptz not null,
  rejected_at            timestamptz,
  rejected_reason        text,
  check ((status = 'rejected') = (rejected_at is not null))
);
create index config_versions_effective_idx on config_versions (effective_at desc, created_at desc);

create or replace function trufolks_config_versions_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'config_versions rows are kept for good';
  end if;
  if new.settings is distinct from old.settings
     or new.created_by is distinct from old.created_by
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at
     or new.cooling_off_started_at is distinct from old.cooling_off_started_at
     or new.effective_at is distinct from old.effective_at
     or old.status = 'rejected' then
    raise exception 'A settings version can only be marked rejected, once';
  end if;
  return new;
end;
$$;

create trigger config_versions_guard
  before update or delete on config_versions
  for each row execute function trufolks_config_versions_guard();

create or replace function trufolks_config_no_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'Settings history cannot be deleted';
end;
$$;

create trigger config_versions_no_truncate
  before truncate on config_versions
  for each statement execute function trufolks_config_no_truncate();

-- ------------------------------------------------------------------ the toggle log (CFG-01, CFG-13)
create table config_log (
  id                     text primary key default gen_random_uuid()::text,
  version_id             text references config_versions (id),
  actor_user_id          text references users (id),       -- null = the system
  event                  text not null check (event in
                           ('seeded', 'changed', 'refused', 'rejected_at_startup', 'disclosures_completed')),
  setting_key            text,
  old_value              jsonb,
  new_value              jsonb,
  reason                 text,
  cooling_off_started_at timestamptz,
  effective_at           timestamptz,
  at                     timestamptz not null default clock_timestamp()
);
create index config_log_at_idx on config_log (at desc);

create or replace function trufolks_config_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'config_log is append-only';
end;
$$;

create trigger config_log_no_update_or_delete
  before update or delete on config_log
  for each row execute function trufolks_config_log_append_only();

create trigger config_log_no_truncate
  before truncate on config_log
  for each statement execute function trufolks_config_log_append_only();

-- ------------------------------------------------------------------ seed: BRD v1.6 §20 pilot preset
-- Must equal PILOT_PRESET in src/lib/config/preset.ts (a test checks it).
insert into config_versions (id, settings, reason, effective_at) values (
  'pilot-preset-1',
  '{
    "schema": 1,
    "payout": {
      "mode": "guaranteed_formula",
      "percent_bp": 2000,
      "floor_cents": 200,
      "cap_cents": 1500,
      "currency": "USD",
      "hold_days": 14
    },
    "campaign": { "max_reviews": 50, "max_days": 14, "pool_cents": 25000 },
    "eligibility": { "types": ["A"] },
    "review_format": { "text_qualifies": true, "video": "optional", "video_extra_tier": false },
    "funding": { "model": "merchant_prefunded", "platform_fee_waived": true },
    "split_test": { "enabled": false, "unit": "merchant" },
    "visibility": { "scope": "contacts_only" },
    "disclosure": {
      "wording_version": "draft-1",
      "wording_approved": false,
      "lines": [
        "{merchant} pays people back for honest reviews of things they bought.",
        "The amount is the same whether they give 1 star or 5.",
        "How it is worked out: {percent} of what they spent, at least {floor} and at most {cap}.",
        "For this review: {amount}."
      ]
    },
    "fraud": {
      "single_use_codes": true,
      "photo_for_handout_codes": true,
      "device_binding": true,
      "code_lifetime_seconds": 1209600,
      "failure_window_seconds": 900,
      "max_failures_per_device": 5,
      "max_failures_per_ip": 20,
      "new_device_window_seconds": 3600,
      "max_new_devices_per_ip": 10,
      "purchase_clock_skew_seconds": 600
    }
  }'::jsonb,
  'BRD v1.6 §20 pilot preset (starting values, not decisions)',
  now()
);
insert into config_log (version_id, event, reason, effective_at)
values ('pilot-preset-1', 'seeded', 'BRD v1.6 §20 pilot preset', now());

-- ------------------------------------------------------------------ which version applies
-- The latest valid version already in force (global settings).
create or replace function trufolks_effective_config()
returns table (version_id text, settings jsonb)
language sql stable as $$
  select id, settings from config_versions
   where status = 'accepted' and effective_at <= now()
   order by effective_at desc, created_at desc
   limit 1;
$$;

-- The version an offer is pinned to; if that version was rejected, the last
-- valid one created before it; else whatever is in force.
create or replace function trufolks_campaign_config(p_campaign_id text)
returns table (version_id text, settings jsonb)
language sql stable as $$
  with pin as (
    select v.created_at from campaigns c join config_versions v on v.id = c.config_preset_id
     where c.id = p_campaign_id
  ), candidate as (
    select v.id, v.settings, 0 as pref, v.created_at
      from config_versions v, pin
     where v.status = 'accepted' and v.created_at <= pin.created_at
    union all
    select e.version_id, e.settings, 1 as pref, null::timestamptz from trufolks_effective_config() e
  )
  select id, settings from candidate order by pref, created_at desc nulls last limit 1;
$$;

-- ------------------------------------------------------------------ offers are pinned (CFG-13)
update campaigns set config_preset_id = 'pilot-preset-1' where config_preset_id is null;
alter table campaigns
  add constraint campaigns_config_preset_id_fkey foreign key (config_preset_id) references config_versions (id);

create or replace function trufolks_campaigns_pin_locked() returns trigger
language plpgsql as $$
begin
  if old.config_preset_id is not null and new.config_preset_id is distinct from old.config_preset_id then
    raise exception 'An offer''s settings version can''t change';
  end if;
  return new;
end;
$$;

create trigger campaigns_pin_locked
  before update on campaigns
  for each row execute function trufolks_campaigns_pin_locked();

-- New offers get the version in force when they are made.
create or replace function trufolks_campaigns_pin_default() returns trigger
language plpgsql as $$
begin
  if new.config_preset_id is null then
    select e.version_id into new.config_preset_id from trufolks_effective_config() e;
  end if;
  return new;
end;
$$;

create trigger campaigns_pin_default
  before insert on campaigns
  for each row execute function trufolks_campaigns_pin_default();

-- ------------------------------------------------------------------ write a new version
-- The app has already validated p_settings and worked out p_changes (an array
-- of {key, old, new}). Outcomes: ok, pending_exists, no_change.
create or replace function trufolks_create_config_version(
  p_actor text,
  p_settings jsonb,
  p_reason text,
  p_changes jsonb
) returns table (r_outcome text, r_version_id text, r_effective_at timestamptz, r_cooling_off boolean)
language plpgsql as $$
declare
  v_current jsonb;
  v_global_changed boolean;
  v_live boolean;
  v_effective timestamptz;
  v_cooling timestamptz;
  v_id text;
  v_change jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('trufolks_config_write'));
  if exists (select 1 from config_versions where status = 'accepted' and effective_at > now()) then
    return query select 'pending_exists'::text, null::text, null::timestamptz, false; return;
  end if;
  select e.settings into v_current from trufolks_effective_config() e;
  if v_current is not distinct from p_settings or jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) = 0 then
    return query select 'no_change'::text, null::text, null::timestamptz, false; return;
  end if;
  v_global_changed := v_current is null
    or v_current -> 'visibility' is distinct from p_settings -> 'visibility'
    or v_current -> 'disclosure' is distinct from p_settings -> 'disclosure'
    or v_current -> 'fraud' is distinct from p_settings -> 'fraud';
  v_live := exists (select 1 from campaigns where status = 'live' and ends_at > now());
  if v_global_changed and v_live then
    v_cooling := now();
    v_effective := now() + interval '24 hours';
  else
    v_effective := now();
  end if;
  insert into config_versions (settings, created_by, reason, cooling_off_started_at, effective_at)
  values (p_settings, p_actor, trim(p_reason), v_cooling, v_effective)
  returning id into v_id;
  for v_change in select * from jsonb_array_elements(p_changes) loop
    insert into config_log (version_id, actor_user_id, event, setting_key, old_value, new_value, reason,
                            cooling_off_started_at, effective_at)
    values (v_id, p_actor, 'changed', v_change ->> 'key', v_change -> 'old', v_change -> 'new', trim(p_reason),
            v_cooling, v_effective);
  end loop;
  return query select 'ok'::text, v_id, v_effective, v_cooling is not null;
end;
$$;

-- A change the app refused (invalid or touching a guardrail) is still logged (CFG-01).
create or replace function trufolks_log_config_refusal(p_actor text, p_attempt jsonb, p_why text) returns void
language sql as $$
  insert into config_log (actor_user_id, event, new_value, reason) values (p_actor, 'refused', p_attempt, p_why);
$$;

-- Startup validation found a stored version invalid: mark it rejected (once) and log it.
create or replace function trufolks_reject_config_version(p_version_id text, p_why text) returns text
language plpgsql as $$
begin
  update config_versions set status = 'rejected', rejected_at = now(), rejected_reason = p_why
   where id = p_version_id and status = 'accepted';
  if not found then return 'not_found'; end if;
  insert into config_log (version_id, event, reason) values (p_version_id, 'rejected_at_startup', p_why);
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ PAY-08 (never reads a rating)
create or replace function trufolks_pay08_reward(
  p_order_value_cents integer,
  p_percent_bp integer,
  p_floor_cents integer,
  p_cap_cents integer
) returns integer
language sql immutable as $$
  select least(p_cap_cents, greatest(p_floor_cents, ((p_order_value_cents::bigint * p_percent_bp + 5000) / 10000)::int));
$$;

-- The reward for a purchase, from the confirmed receipt amount and the offer's
-- pinned formula. 'none' = not part of an offer; 'not_set' = amount or formula
-- not known yet.
create or replace function trufolks_purchase_reward(p_purchase_id text)
returns table (r_status text, r_amount_cents integer, r_percent_bp integer, r_floor_cents integer,
               r_cap_cents integer, r_currency text, r_version_id text)
language plpgsql stable as $$
declare
  v_p verified_purchases%rowtype;
  v_cfg jsonb;
  v_version text;
  v_confirmed integer;
  v_bp integer;
  v_floor integer;
  v_cap integer;
begin
  select * into v_p from verified_purchases where id = p_purchase_id;
  if not found then return; end if;
  if v_p.campaign_id is null then
    return query select 'none'::text, null::int, null::int, null::int, null::int, null::text, null::text; return;
  end if;
  select c.version_id, c.settings into v_version, v_cfg from trufolks_campaign_config(v_p.campaign_id) c;
  v_bp := (v_cfg -> 'payout' ->> 'percent_bp')::int;
  v_floor := (v_cfg -> 'payout' ->> 'floor_cents')::int;
  v_cap := (v_cfg -> 'payout' ->> 'cap_cents')::int;
  if v_bp is null or v_floor is null or v_cap is null then
    return query select 'not_set'::text, null::int, null::int, null::int, null::int, null::text, v_version; return;
  end if;
  select d.confirmed_order_value_cents into v_confirmed
    from purchase_verification_decisions d
   where d.verified_purchase_id = p_purchase_id and d.decision = 'verified';
  if v_p.verification_status <> 'verified' or v_confirmed is null then
    return query select 'not_set'::text, null::int, v_bp, v_floor, v_cap, v_cfg -> 'payout' ->> 'currency', v_version; return;
  end if;
  return query select 'set'::text, trufolks_pay08_reward(v_confirmed, v_bp, v_floor, v_cap), v_bp, v_floor, v_cap,
                      v_cfg -> 'payout' ->> 'currency', v_version;
end;
$$;

-- ------------------------------------------------------------------ offer cap (CFG-04, FR-21)
-- Room left in an offer. Claims not turned down count against the review cap;
-- rewards owed (confirmed amount) plus pending (typed amount) count against
-- the pool. p_extra_order_cents is a new claim's typed amount (0 = just looking).
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
  v_pool := (v_cfg -> 'campaign' ->> 'pool_cents')::int;
  select count(*)::int,
         coalesce(sum(trufolks_pay08_reward(coalesce(d.confirmed_order_value_cents, vp.order_value_cents), v_bp, v_floor, v_cap)), 0)::int
    into v_claims, v_committed
    from verified_purchases vp
    left join purchase_verification_decisions d on d.verified_purchase_id = vp.id and d.decision = 'verified'
   where vp.campaign_id = p_campaign_id and vp.verification_status <> 'rejected';
  v_extra := case when p_extra_order_cents > 0 then trufolks_pay08_reward(p_extra_order_cents, v_bp, v_floor, v_cap)
                  else v_floor end;
  return query select (v_claims < v_max and v_committed + v_extra <= v_pool), v_claims, v_max, v_committed, v_pool;
end;
$$;

-- Scan and claim both say "full" before anything else time-related.
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
  if not (select r.r_ok from trufolks_campaign_room(p_campaign.id, 0) r) then return 'campaign_full'; end if;
  return 'ok';
end;
$$;

-- Hard backstop: a new offer purchase can never overshoot the cap, even when
-- two claims race (serialised per offer; the count is re-read after the lock).
create or replace function trufolks_verified_purchases_cap_guard() returns trigger
language plpgsql as $$
begin
  if new.campaign_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('trufolks_campaign_room'), hashtext(new.campaign_id));
  if not (select r.r_ok from trufolks_campaign_room(new.campaign_id, new.order_value_cents) r) then
    raise exception 'TRUFOLKS_CAMPAIGN_FULL';
  end if;
  return new;
end;
$$;

create trigger verified_purchases_cap_guard
  before insert on verified_purchases
  for each row execute function trufolks_verified_purchases_cap_guard();

-- ------------------------------------------------------------------ concierge offers follow the settings
-- Replaces the Ticket 6 version: the type comes from the eligibility setting
-- (pilot: A only) and the length is capped by campaign.max_days. Outcomes: ok,
-- not_found, invalid, too_long.
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
  v_version text;
  v_cfg jsonb;
  v_type text;
  v_max_days integer;
begin
  if not exists (select 1 from merchants where id = p_merchant_id) then
    return query select 'not_found'::text, null::text; return;
  end if;
  if coalesce(length(trim(p_name)), 0) = 0 or length(p_name) > 120
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at <= now() then
    return query select 'invalid'::text, null::text; return;
  end if;
  select e.version_id, e.settings into v_version, v_cfg from trufolks_effective_config() e;
  v_type := v_cfg -> 'eligibility' -> 'types' ->> 0;
  v_max_days := (v_cfg -> 'campaign' ->> 'max_days')::int;
  if v_type is null or v_max_days is null then
    return query select 'invalid'::text, null::text; return;
  end if;
  if p_ends_at - p_starts_at > make_interval(days => v_max_days) then
    return query select 'too_long'::text, null::text; return;
  end if;
  insert into campaigns (merchant_id, name, campaign_type, starts_at, ends_at, status, config_preset_id)
  values (p_merchant_id, trim(p_name), v_type, p_starts_at, p_ends_at, 'live', v_version)
  returning id into v_id;
  insert into merchant_events (merchant_id, actor_user_id, event, campaign_id)
  values (p_merchant_id, p_admin_id, 'offer_created', v_id);
  return query select 'ok'::text, v_id;
end;
$$;

-- ------------------------------------------------------------------ disclosure v2 (LEG-01, LEG-03)
-- Still the ONE place the disclosure is built, from the purchase and settings
-- only. Nothing about the review (rating included) goes in (PAY-01).
create or replace function trufolks_review_disclosure(p_purchase_id text) returns jsonb
language plpgsql stable as $$
declare
  v_p verified_purchases%rowtype;
  v_merchant_name text;
  v_campaign_name text;
  v_reward record;
  v_global jsonb;
  v_wording jsonb;
  v_approved boolean;
begin
  select * into v_p from verified_purchases where id = p_purchase_id;
  if not found then return null; end if;
  select name into v_merchant_name from merchants where id = v_p.merchant_id;
  if v_p.campaign_id is null then
    return jsonb_build_object(
      'version', 2, 'incentive', false, 'rating_blind', true, 'merchant_name', v_merchant_name,
      'campaign_id', null, 'campaign_name', null, 'verified_purchase', true,
      'reward', jsonb_build_object('status', 'none', 'formula', null, 'amount_cents', null),
      'complete', true);
  end if;
  select name into v_campaign_name from campaigns where id = v_p.campaign_id;
  select * into v_reward from trufolks_purchase_reward(p_purchase_id);
  select e.settings into v_global from trufolks_effective_config() e;
  v_approved := coalesce((v_global -> 'disclosure' ->> 'wording_approved')::boolean, false);
  v_wording := jsonb_build_object(
    'version', v_global -> 'disclosure' ->> 'wording_version',
    'approved', v_approved,
    'lines', coalesce(v_global -> 'disclosure' -> 'lines', '[]'::jsonb));
  return jsonb_build_object(
    'version', 2,
    'incentive', true,
    'rating_blind', true,
    'merchant_name', v_merchant_name,
    'campaign_id', v_p.campaign_id,
    'campaign_name', v_campaign_name,
    'verified_purchase', true,
    'config_version_id', v_reward.r_version_id,
    'reward', jsonb_build_object(
      'status', coalesce(v_reward.r_status, 'not_set'),
      'formula', case when v_reward.r_percent_bp is null then null else jsonb_build_object(
                   'percent_bp', v_reward.r_percent_bp, 'floor_cents', v_reward.r_floor_cents,
                   'cap_cents', v_reward.r_cap_cents, 'currency', v_reward.r_currency) end,
      'amount_cents', v_reward.r_amount_cents),
    'wording', v_wording,
    'complete', coalesce(v_reward.r_status, 'not_set') = 'set' and v_approved
  );
end;
$$;

-- ------------------------------------------------------------------ submit: block until the amount is known (gap 20)
-- Same as Ticket 4, plus outcome 'amount_not_set'.
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
  v_disclosure := trufolks_review_disclosure(p_purchase_id);
  if v_disclosure -> 'reward' ->> 'status' = 'not_set' then
    return query select 'amount_not_set'::text, null::text; return;
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5
     or coalesce(length(trim(p_what_used)), 0) = 0 or length(p_what_used) > p_max_short
     or coalesce(length(trim(p_how_long)), 0) = 0 or length(p_how_long) > p_max_short
     or coalesce(length(trim(p_honest_thought)), 0) = 0 or length(p_honest_thought) > p_max_thought then
    return query select 'invalid'::text, null::text; return;
  end if;

  v_disclosure := v_disclosure || jsonb_build_object('attached_at', now());

  insert into reviews (user_id, verified_purchase_id, rating, what_used, how_long, honest_thought, disclosure)
  values (p_user_id, p_purchase_id, p_rating, trim(p_what_used), trim(p_how_long), trim(p_honest_thought), v_disclosure)
  returning id into v_id;

  insert into review_events (review_id, user_id, event, disclosure_version)
  values (v_id, p_user_id, 'submitted', (v_disclosure ->> 'version')::int);

  return query select 'ok'::text, v_id;
end;
$$;

-- ------------------------------------------------------------------ finishing earlier disclosures (gap 21)
alter table review_events drop constraint review_events_event_check;
alter table review_events add constraint review_events_event_check
  check (event in ('submitted', 'disclosure_completed'));
alter table review_events add column actor_user_id text references users (id);

-- The ONLY change a posted review's disclosure may get: from incomplete to
-- complete, filling in the reward (if it wasn't set), the wording and the
-- settings version. Everything else must stay exactly as it was.
create or replace function trufolks_disclosure_completion_ok(p_old jsonb, p_new jsonb) returns boolean
language sql immutable as $$
  select coalesce(p_old ->> 'complete', 'false') = 'false'
     and p_new -> 'complete' = 'true'::jsonb
     and p_new -> 'reward' ->> 'status' in ('set', 'none')
     and (p_old -> 'reward' ->> 'status' is distinct from 'set' or p_new -> 'reward' = p_old -> 'reward')
     and (p_old -> 'config_version_id' is null or p_old -> 'config_version_id' = 'null'::jsonb
          or p_new -> 'config_version_id' = p_old -> 'config_version_id')
     and (p_new - array['version', 'reward', 'wording', 'complete', 'completed_at', 'config_version_id'])
       = (p_old - array['version', 'reward', 'wording', 'complete', 'completed_at', 'config_version_id']);
$$;

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
     or new.created_at is distinct from old.created_at
     or (new.disclosure is distinct from old.disclosure
         and not trufolks_disclosure_completion_ok(old.disclosure, new.disclosure)) then
    raise exception 'A posted review''s rating, honest fields and disclosure are locked';
  end if;
  return new;
end;
$$;

-- Finish one review's disclosure if it can be completed now. Outcomes: ok,
-- already, not_ready, not_found.
create or replace function trufolks_complete_review_disclosure(p_review_id text, p_actor text) returns text
language plpgsql as $$
declare
  v_r reviews%rowtype;
  v_fresh jsonb;
  v_new jsonb;
begin
  select * into v_r from reviews where id = p_review_id for update;
  if not found then return 'not_found'; end if;
  if v_r.disclosure -> 'complete' = 'true'::jsonb then return 'already'; end if;
  v_fresh := trufolks_review_disclosure(v_r.verified_purchase_id);
  if v_fresh is null or v_fresh -> 'complete' is distinct from 'true'::jsonb then return 'not_ready'; end if;
  v_new := v_r.disclosure || jsonb_build_object(
    'version', v_fresh -> 'version',
    'config_version_id', coalesce(nullif(v_r.disclosure -> 'config_version_id', 'null'::jsonb), v_fresh -> 'config_version_id'),
    'reward', case when v_r.disclosure -> 'reward' ->> 'status' = 'set' then v_r.disclosure -> 'reward'
                   else v_fresh -> 'reward' end,
    'wording', v_fresh -> 'wording',
    'complete', true,
    'completed_at', now());
  update reviews set disclosure = v_new, updated_at = now() where id = p_review_id;
  insert into review_events (review_id, user_id, event, disclosure_version, actor_user_id)
  values (p_review_id, v_r.user_id, 'disclosure_completed', (v_new ->> 'version')::int, p_actor);
  return 'ok';
end;
$$;

-- Finish every review that can be finished now. Returns how many were finished.
create or replace function trufolks_complete_pending_disclosures(p_actor text) returns integer
language plpgsql as $$
declare
  v_id text;
  v_done integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('trufolks_complete_disclosures'));
  for v_id in select id from reviews where coalesce(disclosure ->> 'complete', 'false') = 'false' order by created_at loop
    if trufolks_complete_review_disclosure(v_id, p_actor) = 'ok' then v_done := v_done + 1; end if;
  end loop;
  insert into config_log (actor_user_id, event, new_value, reason)
  values (p_actor, 'disclosures_completed', to_jsonb(v_done), 'Finished disclosures of earlier reviews');
  return v_done;
end;
$$;
