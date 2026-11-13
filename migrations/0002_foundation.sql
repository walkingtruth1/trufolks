-- TruFolks foundation schema — Ticket 1 (BRD v1.6 §2A, §13).
--
-- Core records only: users, merchants, campaigns, verified_purchases, reviews,
-- contacts, plus two read views. Deliberately NOT here:
--   * No payout / reward / percentage / floor / cap / pool columns. Money rules
--     are CFG presets (Ticket 7) and payouts are a separate ledger, so a review
--     record never carries payout data and the payout engine can never read the
--     star rating (FR-27, PAY-01, HON-01).
--   * No follower counts anywhere (FR-05, P6).
--   * No link to Better Auth's "user" table yet — that schema is opt-in under
--     migrations/auth/ and is enabled in Ticket 2, which adds the foreign key.
--     users.id is TEXT so it can hold the Better Auth user id 1:1.
--   * Receipt codes (Ticket 3), config presets + audit log (Ticket 7).

-- People. One row per person; holds TruFolks profile fields only.
create table users (
  id                 text primary key,
  display_name       text not null check (length(trim(display_name)) > 0),
  -- FR-03 / CFG-07: contacts-only by default; wider sharing only if chosen.
  default_visibility text not null default 'contacts'
                     check (default_visibility in ('contacts', 'public')),
  deleted_at         timestamptz,            -- FR-01 account deletion (soft)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Businesses that issue receipt codes and fund a campaign pool.
create table merchants (
  id                      text primary key default gen_random_uuid()::text,
  owner_user_id           text not null references users (id),
  name                    text not null check (length(trim(name)) > 0),
  business_type           text,
  verification_status     text not null default 'pending'
                          check (verification_status in ('pending', 'verified', 'suspended')),
  terms_accepted_at       timestamptz,       -- MER-02: pays for every qualifying review, any rating
  walkthrough_accepted_at timestamptz,       -- MER-07: mixed-ratings walkthrough accepted
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index merchants_owner_user_id_idx on merchants (owner_user_id);

-- A merchant offer: window + type. Budget cap, pool and reward formula are
-- config presets (CFG-03/04/08), attached via config_preset_id in Ticket 7.
create table campaigns (
  id               text primary key default gen_random_uuid()::text,
  merchant_id      text not null references merchants (id),
  name             text not null check (length(trim(name)) > 0),
  campaign_type    text not null check (campaign_type in ('A', 'B')),  -- §20C; no default (CFG-05)
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'draft'
                   check (status in ('draft', 'live', 'ended', 'suspended')),
  config_preset_id text,                     -- FK added in Ticket 7
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (id, merchant_id)                   -- lets purchases prove campaign/merchant match
);
create index campaigns_merchant_id_idx on campaigns (merchant_id);

-- One row per verified purchase (P2, FR-06–FR-09). order_value_cents is the
-- purchase fact the PAY-08 formula will read later — not a pricing rule.
create table verified_purchases (
  id                  text primary key default gen_random_uuid()::text,
  user_id             text not null references users (id),
  merchant_id         text not null references merchants (id),
  campaign_id         text,                  -- null = verified outside a campaign
  product_label       text not null check (length(trim(product_label)) > 0),
  order_value_cents   integer not null check (order_value_cents >= 0),
  currency            text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  verification_method text not null
                      check (verification_method in ('receipt_code', 'receipt_photo', 'receipt_code_and_photo')),
  verification_status text not null default 'pending'
                      check (verification_status in ('pending', 'verified', 'rejected')),
  receipt_code_id     text,                  -- FK added in Ticket 3
  purchased_at        timestamptz not null,
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  check (verification_status <> 'verified' or verified_at is not null),
  -- The campaign must belong to the same merchant as the purchase.
  foreign key (campaign_id, merchant_id) references campaigns (id, merchant_id),
  unique (id, user_id)                       -- lets reviews prove reviewer = purchaser
);
create index verified_purchases_user_id_idx on verified_purchases (user_id);
create index verified_purchases_merchant_id_idx on verified_purchases (merchant_id);
create index verified_purchases_campaign_id_idx on verified_purchases (campaign_id);

-- One honest review per verified purchase (HON-04), by the purchaser only.
-- No payout data lives here (FR-27).
create table reviews (
  id                   text primary key default gen_random_uuid()::text,
  user_id              text not null references users (id),
  verified_purchase_id text not null unique,
  rating               smallint not null check (rating between 1 and 5),
  -- FR-11: all three honest fields are required. Written by the person, never AI (AI-05).
  what_used            text not null check (length(trim(what_used)) > 0),
  how_long             text not null check (length(trim(how_long)) > 0),
  honest_thought       text not null check (length(trim(honest_thought)) > 0),
  video_url            text,                 -- optional (FR-12, D2)
  visibility           text not null default 'contacts'
                       check (visibility in ('contacts', 'public')),
  -- LEG-01: system-attached disclosure metadata, written by the server from the
  -- campaign's parameters (Ticket 4). Never user free text.
  disclosure           jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (verified_purchase_id, user_id) references verified_purchases (id, user_id)
);
create index reviews_user_id_created_at_idx on reviews (user_id, created_at desc);

-- Who can see whom (FR-02). Directed edge; no follower counts.
create table contacts (
  owner_user_id   text not null references users (id),
  contact_user_id text not null references users (id),
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'blocked')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (owner_user_id, contact_user_id),
  check (owner_user_id <> contact_user_id)
);
create index contacts_contact_user_id_idx on contacts (contact_user_id);

-- A user's Top 5 is a view of their latest five reviews, not a table (§13).
create view user_top5_reviews as
select *
from (
  select r.*,
         row_number() over (partition by r.user_id order by r.created_at desc, r.id desc) as recency_rank
  from reviews r
) ranked
where recency_rank <= 5;

-- Reviews with the merchant they belong to (via the verified purchase).
-- All ratings included (FR-24). Reviewer id omitted (P5 limited data).
-- Access scoping to the signed-in merchant is enforced in Ticket 6.
create view merchant_reviews as
select vp.merchant_id,
       vp.campaign_id,
       vp.product_label,
       r.id as review_id,
       r.rating,
       r.what_used,
       r.how_long,
       r.honest_thought,
       r.video_url,
       r.disclosure,
       r.created_at
from reviews r
join verified_purchases vp on vp.id = r.verified_purchase_id;
