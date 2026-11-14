-- TruFolks v1.8 — every review needs a receipt; a TruFolks code is optional
-- (REV-18-02, owner decision 2026-11-13; claude/trufolks-update-log.csv).
--
-- 0011 has run on the shared preview database, so this is a forward migration.
-- ONCE THIS FILE HAS RUN ON A SHARED DATABASE, never edit it again: add 0013_….
--
-- * "Verified purchase" keeps one meaning everywhere: a receipt our team checked.
--   There are still no reviews without a receipt.
-- * NEW: a receipt-only purchase. The member writes their review, names where
--   they bought it and uploads a photo of ANY receipt, all in one step. No
--   business, no offer, no code, so no reward: its disclosure is the existing
--   "No one paid for this review." (trufolks_review_disclosure, campaign null).
-- * The review waits in review_drafts until the team decides the receipt with
--   the existing trufolks_decide_purchase (photo + value read off the receipt).
--   Confirmed: the review posts automatically, exactly as written, through the
--   existing trufolks_submit_review. Not confirmed: the draft is deleted.
-- * WITH a TruFolks code nothing changes: claim → photo → check → review → reward.
-- * Duplicate receipt photos are refused by the existing hash check (0005).

-- ------------------------------------------------------------------ receipt-only purchases
alter table verified_purchases alter column merchant_id drop not null;
-- Where they bought it, in the member's words (receipt-only purchases only).
alter table verified_purchases add column store_name text
  check (store_name is null or length(trim(store_name)) between 1 and 80);
-- Exactly one of: a TruFolks business, or a store name typed by the member.
alter table verified_purchases add constraint verified_purchases_one_place
  check ((merchant_id is null) <> (store_name is null));
-- A receipt-only purchase never has a code or an offer, and is checked by photo.
alter table verified_purchases add constraint verified_purchases_receipt_only_shape
  check (merchant_id is not null
         or (receipt_code_id is null and campaign_id is null and verification_method = 'receipt_photo'));

-- ------------------------------------------------------------------ the review waiting for its receipt
create table review_drafts (
  purchase_id    text primary key,
  user_id        text not null references users (id),
  rating         smallint not null check (rating between 1 and 5),
  what_used      text not null check (length(trim(what_used)) > 0),
  how_long       text not null check (length(trim(how_long)) > 0),
  honest_thought text not null check (length(trim(honest_thought)) > 0),
  created_at     timestamptz not null default now(),
  foreign key (purchase_id, user_id) references verified_purchases (id, user_id)
);

-- One call: purchase + review draft + photo. Outcomes: ok, not_found (no such
-- member), invalid (review fields), bad_store, bad_date, too_many (daily cap),
-- and any photo outcome (duplicate_photo, …), in which case nothing is kept.
create or replace function trufolks_submit_receipt_review(
  p_user_id text,
  p_store_name text,
  p_purchased_at timestamptz,
  p_rating integer,
  p_what_used text,
  p_how_long text,
  p_honest_thought text,
  p_max_short integer,
  p_max_thought integer,
  p_daily_cap integer,
  p_mime_type text,
  p_photo bytea,
  p_sha256 text,
  p_exif_taken_at timestamptz,
  p_exif_has_offset boolean,
  p_retention_seconds integer
) returns table (r_outcome text, r_purchase_id text)
language plpgsql as $$
declare
  v_store text := trim(coalesce(p_store_name, ''));
  v_id text;
  v_photo text;
begin
  if not exists (select 1 from users where id = p_user_id and deleted_at is null) then
    return query select 'not_found'::text, null::text; return;
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5
     or coalesce(length(trim(p_what_used)), 0) = 0 or length(p_what_used) > p_max_short
     or coalesce(length(trim(p_how_long)), 0) = 0 or length(p_how_long) > p_max_short
     or coalesce(length(trim(p_honest_thought)), 0) = 0 or length(p_honest_thought) > p_max_thought then
    return query select 'invalid'::text, null::text; return;
  end if;
  if length(v_store) not between 1 and 80 then
    return query select 'bad_store'::text, null::text; return;
  end if;
  if p_purchased_at is null or p_purchased_at > now() + interval '1 day'
     or p_purchased_at < now() - interval '2 years' then
    return query select 'bad_date'::text, null::text; return;
  end if;
  perform pg_advisory_xact_lock(hashtext('trufolks_receipt_only'), hashtext(p_user_id));
  if (select count(*) from verified_purchases
       where user_id = p_user_id and merchant_id is null
         and created_at > now() - interval '24 hours') >= p_daily_cap then
    return query select 'too_many'::text, null::text; return;
  end if;

  insert into verified_purchases (user_id, merchant_id, store_name, campaign_id, product_label,
                                  order_value_cents, verification_method, verification_status, purchased_at)
  values (p_user_id, null, v_store, null, trim(p_what_used), 0, 'receipt_photo', 'pending', p_purchased_at)
  returning id into v_id;
  insert into review_drafts (purchase_id, user_id, rating, what_used, how_long, honest_thought)
  values (v_id, p_user_id, p_rating, trim(p_what_used), trim(p_how_long), trim(p_honest_thought));

  select s.r_outcome into v_photo
    from trufolks_store_receipt_photo(v_id, p_user_id, p_mime_type, p_photo, p_sha256,
                                      p_exif_taken_at, p_exif_has_offset, p_retention_seconds) s;
  if v_photo is distinct from 'ok' then
    delete from review_drafts where purchase_id = v_id;
    delete from verified_purchases where id = v_id;
    return query select coalesce(v_photo, 'unavailable'), null::text; return;
  end if;
  return query select 'ok'::text, v_id;
end;
$$;

-- When the team decides a purchase that has a waiting review: confirmed → post
-- it as written (the normal submit, so every review rule applies); not
-- confirmed → delete the words.
create or replace function trufolks_purchase_decided_post_draft() returns trigger
language plpgsql as $$
declare
  v_d review_drafts%rowtype;
begin
  if new.verification_status = old.verification_status then return null; end if;
  select * into v_d from review_drafts where purchase_id = new.id for update;
  if not found then return null; end if;
  if new.verification_status = 'verified' then
    perform 1 from trufolks_submit_review(new.id, v_d.user_id, v_d.rating, v_d.what_used, v_d.how_long,
                                          v_d.honest_thought, 100000, 100000);
  end if;
  if new.verification_status in ('verified', 'rejected') then
    delete from review_drafts where purchase_id = new.id;
  end if;
  return null;
end;
$$;

create trigger verified_purchases_post_draft
  after update of verification_status on verified_purchases
  for each row execute function trufolks_purchase_decided_post_draft();

-- ------------------------------------------------------------------ the place name everywhere
-- 0009's disclosure builder; the only change is the place name for a
-- receipt-only purchase (its store name, as there is no business).
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
  select coalesce((select name from merchants where id = v_p.merchant_id), v_p.store_name, '') into v_merchant_name;
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

-- 0011's read rule; the business join is now outer (store name for receipt-only).
create or replace function trufolks_visible_reviews(p_owner text, p_relation text)
returns table (
  review_id      text,
  author_id      text,
  reviewer_name  text,
  merchant_name  text,
  product_label  text,
  rating         smallint,
  what_used      text,
  how_long       text,
  honest_thought text,
  verified       boolean,
  disclosure     jsonb,
  visibility     text,
  shareable      boolean,
  created_at     timestamptz
)
language sql stable as $$
  select r.id, r.user_id, u.display_name, coalesce(m.name, vp.store_name, ''), vp.product_label, r.rating,
         r.what_used, r.how_long, r.honest_thought, vp.verification_status = 'verified',
         r.disclosure, r.visibility,
         trufolks_review_shareable(r.disclosure, vp.verification_status),
         r.created_at
    from reviews r
    join users u on u.id = r.user_id and u.deleted_at is null
    join verified_purchases vp on vp.id = r.verified_purchase_id
    left join merchants m on m.id = vp.merchant_id
   where r.user_id = p_owner
     and case p_relation
           when 'owner' then true
           when 'friend' then trufolks_review_shareable(r.disclosure, vp.verification_status)
                              and r.visibility in ('contacts', 'public')
           when 'member' then trufolks_review_shareable(r.disclosure, vp.verification_status)
                              and r.visibility = 'public'
           when 'anonymous' then trufolks_review_shareable(r.disclosure, vp.verification_status)
                                 and r.visibility = 'public'
           else false
         end;
$$;

-- 0007's friends feed rule; same change. merchant_id is null for a receipt-only
-- purchase, so it is never listed as a TruFolks place.
create or replace function trufolks_contact_reviews(p_viewer text)
returns table (
  review_id           text,
  author_id           text,
  reviewer_name       text,
  merchant_id         text,
  merchant_name       text,
  product_label       text,
  rating              smallint,
  what_used           text,
  how_long            text,
  honest_thought      text,
  verification_status text,
  disclosure          jsonb,
  created_at          timestamptz
)
language sql stable as $$
  select r.id, r.user_id, mc.display_name, m.id, coalesce(m.name, vp.store_name, ''), vp.product_label, r.rating,
         r.what_used, r.how_long, r.honest_thought, vp.verification_status, r.disclosure, r.created_at
    from trufolks_mutual_contacts(p_viewer) mc
    join reviews r on r.user_id = mc.contact_id
    join verified_purchases vp on vp.id = r.verified_purchase_id
    left join merchants m on m.id = vp.merchant_id
   where r.visibility in ('contacts', 'public')
     and vp.verification_status = 'verified'
     and jsonb_typeof(r.disclosure) = 'object'
     and r.disclosure -> 'complete' = 'true'::jsonb
     and r.disclosure -> 'rating_blind' = 'true'::jsonb;
$$;
