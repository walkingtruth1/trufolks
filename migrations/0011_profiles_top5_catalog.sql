-- TruFolks v1.7 — My Profile, My Top 5, Shop, catalog and sharing
-- (work order "My Profile, My Top 5, and Shop"; BRD v1.7 §7: PRO-18-01..03,
-- PRO-18-04 Top 5 by category (extends SOC-17-02), SHOP-18-01, CAT-18-01
-- shared catalog (was cited as FR-23)).
--
-- ONCE THIS FILE HAS RUN ON A SHARED DATABASE (the first Vercel preview build
-- with DATABASE_URL), never edit it again: add a forward migration (0012_…).
--
-- * Every member gets a profile with a stable handle (/u/<handle>). It is
--   Friends only until the owner publishes it (explicit, reversible).
-- * Review publication is a separate, explicit switch on each review
--   (reviews.visibility: 'contacts' = Friends only, 'public'). A review can only
--   be made public once its disclosure is complete (LEG-01).
-- * THE read rule lives here: trufolks_viewer_relation + trufolks_visible_reviews.
--   Every profile, Top 5, Shop, review and product read goes through them.
--   Blocked pairs see nothing of each other, in either direction.
-- * My Top 5: two lists (products, services), 0–5 of the owner's own eligible
--   reviews each, in the owner's order. One review sits in one list at most.
-- * Shop: only reviews the owner switched on (shop_items, off by default); a
--   Top 5 pin does not add one. Reads still need audience + approved seller link.
-- * Catalog: shared product records (brand, model, variant, category, verified
--   release year, optional identifiers), seller offers stored separately, review
--   links stored separately (reviews stay locked, FR-15; legacy reviews have no
--   link and stay readable). Uncertain new entries wait in a queue.
-- * No receipt, purchase amount, photo or payout field is exposed by any
--   function below.
-- * Review, product, brand, seller offer and link ids are separate so a later
--   partner integration can attribute a sale to one recommendation.
-- Atomic work is one plpgsql function per call (the Sql client has no transactions).

-- ------------------------------------------------------------------ helpers
create or replace function trufolks_norm(p text) returns text
language sql immutable as $$
  select trim(both ' ' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function trufolks_slugify(p text, p_max integer) returns text
language sql immutable as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), p_max);
$$;

-- ------------------------------------------------------------------ profiles
create table profiles (
  user_id      text primary key references users (id),
  handle       text not null unique check (handle ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  bio          text not null default '' check (length(bio) <= 280),
  audience     text not null default 'friends' check (audience in ('friends', 'public')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (audience = 'friends' or published_at is not null)
);

create table profile_events (
  id        text primary key default gen_random_uuid()::text,
  user_id   text not null references users (id),
  event     text not null check (event in
              ('profile_published', 'profile_unpublished', 'review_published', 'review_unpublished',
               'bio_changed', 'name_changed', 'top_picks_changed', 'shop_added', 'shop_removed')),
  review_id text references reviews (id),
  at        timestamptz not null default now()
);
create index profile_events_user_idx on profile_events (user_id, at);

create or replace function trufolks_profile_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'profile_events is append-only';
end;
$$;

create trigger profile_events_no_update_or_delete
  before update or delete on profile_events
  for each row execute function trufolks_profile_events_append_only();

create trigger profile_events_no_truncate
  before truncate on profile_events
  for each statement execute function trufolks_profile_events_append_only();

-- A handle never changes once made, so shared links keep working.
create or replace function trufolks_profiles_handle_locked() returns trigger
language plpgsql as $$
begin
  if new.handle is distinct from old.handle or new.user_id is distinct from old.user_id then
    raise exception 'A profile handle cannot change';
  end if;
  return new;
end;
$$;

create trigger profiles_handle_locked
  before update on profiles
  for each row execute function trufolks_profiles_handle_locked();

-- Make the person's profile if it doesn't exist yet. Returns the handle.
create or replace function trufolks_ensure_profile(p_user_id text) returns text
language plpgsql as $$
declare
  v_handle text;
  v_name text;
  v_base text;
  v_try integer := 0;
begin
  select handle into v_handle from profiles where user_id = p_user_id;
  if v_handle is not null then return v_handle; end if;
  select display_name into v_name from users where id = p_user_id and deleted_at is null;
  if v_name is null then return null; end if;
  v_base := trufolks_slugify(v_name, 24);
  if length(v_base) < 2 then v_base := 'member'; end if;
  loop
    v_handle := v_base || '-' || substr(md5(p_user_id || ':' || v_try::text), 1, 6);
    begin
      insert into profiles (user_id, handle) values (p_user_id, v_handle);
      return v_handle;
    exception when unique_violation then
      select handle into v_handle from profiles where user_id = p_user_id;
      if v_handle is not null then return v_handle; end if;
      v_try := v_try + 1;
      if v_try > 20 then raise; end if;
    end;
  end loop;
end;
$$;

create or replace function trufolks_users_make_profile() returns trigger
language plpgsql as $$
begin
  perform trufolks_ensure_profile(new.id);
  return new;
end;
$$;

create trigger users_make_profile
  after insert on users
  for each row execute function trufolks_users_make_profile();

select trufolks_ensure_profile(id) from users where deleted_at is null;

-- ------------------------------------------------------------------ THE read rule
-- owner | blocked | friend | member | anonymous
create or replace function trufolks_viewer_relation(p_owner text, p_viewer text) returns text
language sql stable as $$
  select case
    when p_viewer is not null and p_viewer = p_owner then 'owner'
    when p_viewer is not null and exists (
      select 1 from contacts
       where status = 'blocked'
         and ((owner_user_id = p_owner and contact_user_id = p_viewer)
           or (owner_user_id = p_viewer and contact_user_id = p_owner))) then 'blocked'
    when p_viewer is not null and exists (
      select 1 from contacts a
        join contacts b on b.owner_user_id = a.contact_user_id and b.contact_user_id = a.owner_user_id
       where a.owner_user_id = p_viewer and a.contact_user_id = p_owner
         and a.status = 'accepted' and b.status = 'accepted') then 'friend'
    when p_viewer is not null then 'member'
    else 'anonymous'
  end;
$$;

-- Can this relation see the owner's profile page?
create or replace function trufolks_profile_visible(p_owner text, p_relation text) returns boolean
language sql stable as $$
  select exists (select 1 from users where id = p_owner and deleted_at is null)
     and case p_relation
           when 'owner' then true
           when 'friend' then true
           when 'blocked' then false
           else exists (select 1 from profiles where user_id = p_owner and audience = 'public')
         end;
$$;

-- A review others may ever see: verified purchase, complete rating-blind disclosure (LEG-01).
create or replace function trufolks_review_shareable(p_disclosure jsonb, p_status text) returns boolean
language sql immutable as $$
  select p_status = 'verified'
     and jsonb_typeof(p_disclosure) = 'object'
     and p_disclosure -> 'complete' = 'true'::jsonb
     and p_disclosure -> 'rating_blind' = 'true'::jsonb;
$$;

-- The owner's reviews this relation may read. Owner: all. Friend: shareable,
-- Friends only or public. Member / anonymous: shareable and public. Blocked: none.
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
  select r.id, r.user_id, u.display_name, m.name, vp.product_label, r.rating,
         r.what_used, r.how_long, r.honest_thought, vp.verification_status = 'verified',
         r.disclosure, r.visibility,
         trufolks_review_shareable(r.disclosure, vp.verification_status),
         r.created_at
    from reviews r
    join users u on u.id = r.user_id and u.deleted_at is null
    join verified_purchases vp on vp.id = r.verified_purchase_id
    join merchants m on m.id = vp.merchant_id
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

-- ------------------------------------------------------------------ sharing switches
-- Outcomes: ok, not_found.
create or replace function trufolks_set_profile_audience(p_user_id text, p_audience text) returns text
language plpgsql as $$
declare
  v_old text;
begin
  if p_audience not in ('friends', 'public') then return 'not_found'; end if;
  perform trufolks_ensure_profile(p_user_id);
  select audience into v_old from profiles where user_id = p_user_id for update;
  if v_old is null then return 'not_found'; end if;
  if v_old = p_audience then return 'ok'; end if;
  update profiles
     set audience = p_audience,
         published_at = case when p_audience = 'public' then now() else published_at end,
         updated_at = now()
   where user_id = p_user_id;
  insert into profile_events (user_id, event)
  values (p_user_id, case when p_audience = 'public' then 'profile_published' else 'profile_unpublished' end);
  return 'ok';
end;
$$;

-- Outcomes: ok, not_found, not_shareable (public needs a complete disclosure).
create or replace function trufolks_set_review_audience(p_user_id text, p_review_id text, p_audience text) returns text
language plpgsql as $$
declare
  v_r reviews%rowtype;
  v_status text;
  v_new text;
begin
  if p_audience not in ('contacts', 'public') then return 'not_found'; end if;
  select * into v_r from reviews where id = p_review_id and user_id = p_user_id for update;
  if not found then return 'not_found'; end if;
  select verification_status into v_status from verified_purchases where id = v_r.verified_purchase_id;
  if p_audience = 'public' and not trufolks_review_shareable(v_r.disclosure, v_status) then
    return 'not_shareable';
  end if;
  v_new := p_audience;
  if v_r.visibility = v_new then return 'ok'; end if;
  update reviews set visibility = v_new, updated_at = now() where id = p_review_id;
  insert into profile_events (user_id, event, review_id)
  values (p_user_id, case when v_new = 'public' then 'review_published' else 'review_unpublished' end, p_review_id);
  return 'ok';
end;
$$;

-- Outcomes: ok, not_found, invalid.
create or replace function trufolks_set_profile_bio(p_user_id text, p_bio text) returns text
language plpgsql as $$
begin
  if p_bio is null or length(p_bio) > 280 then return 'invalid'; end if;
  perform trufolks_ensure_profile(p_user_id);
  update profiles set bio = trim(p_bio), updated_at = now() where user_id = p_user_id;
  if not found then return 'not_found'; end if;
  insert into profile_events (user_id, event) values (p_user_id, 'bio_changed');
  return 'ok';
end;
$$;

-- The name shown on the profile and on every review (PRO-18-02). Outcomes: ok, not_found, invalid.
create or replace function trufolks_set_display_name(p_user_id text, p_name text) returns text
language plpgsql as $$
begin
  if p_name is null or length(trim(p_name)) not between 1 and 60 then return 'invalid'; end if;
  update users set display_name = trim(p_name), updated_at = now() where id = p_user_id and deleted_at is null;
  if not found then return 'not_found'; end if;
  insert into profile_events (user_id, event) values (p_user_id, 'name_changed');
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ My Top 5
create table top_picks (
  user_id    text not null references users (id),
  list       text not null check (list in ('products', 'services')),
  position   smallint not null check (position between 1 and 5),
  review_id  text not null references reviews (id),
  created_at timestamptz not null default now(),
  primary key (user_id, list, position),
  unique (user_id, review_id)
);

-- Second lock: a pick is always the owner's own review.
create or replace function trufolks_top_picks_own_review() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from reviews where id = new.review_id and user_id = new.user_id) then
    raise exception 'A Top 5 pick must be the owner''s own review';
  end if;
  return new;
end;
$$;

create trigger top_picks_own_review
  before insert or update on top_picks
  for each row execute function trufolks_top_picks_own_review();

-- Replace one list with the given reviews, in order. Outcomes: ok, too_many,
-- duplicate, not_eligible (not yours, or not shareable yet), in_other_list.
create or replace function trufolks_set_top_picks(p_user_id text, p_list text, p_review_ids text[]) returns text
language plpgsql as $$
declare
  v_ids text[] := coalesce(p_review_ids, array[]::text[]);
  v_n integer;
  i integer;
begin
  if p_list not in ('products', 'services') then return 'not_eligible'; end if;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n > 5 then return 'too_many'; end if;
  if v_n <> (select count(distinct x) from unnest(v_ids) x) then return 'duplicate'; end if;
  perform pg_advisory_xact_lock(hashtext('trufolks_top_picks'), hashtext(p_user_id));
  if exists (
    select 1 from unnest(v_ids) x
     where not exists (
       select 1 from reviews r join verified_purchases vp on vp.id = r.verified_purchase_id
        where r.id = x and r.user_id = p_user_id
          and trufolks_review_shareable(r.disclosure, vp.verification_status))) then
    return 'not_eligible';
  end if;
  if exists (select 1 from top_picks where user_id = p_user_id and list <> p_list and review_id = any (v_ids)) then
    return 'in_other_list';
  end if;
  delete from top_picks where user_id = p_user_id and list = p_list;
  for i in 1 .. v_n loop
    insert into top_picks (user_id, list, position, review_id) values (p_user_id, p_list, i, v_ids[i]);
  end loop;
  insert into profile_events (user_id, event) values (p_user_id, 'top_picks_changed');
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ catalog
create table catalog_brands (
  id             text primary key default gen_random_uuid()::text,
  name           text not null check (length(trim(name)) between 1 and 80),
  name_norm      text not null unique check (length(name_norm) > 0),
  -- A brand's own shop link is a seller_offers row with offer_kind = 'brand'.
  created_at     timestamptz not null default now()
);

create table catalog_products (
  id                    text primary key default gen_random_uuid()::text,
  slug                  text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,119}$'),
  kind                  text not null check (kind in ('product', 'service')),
  brand_id              text not null references catalog_brands (id),
  model                 text not null check (length(trim(model)) between 1 and 120),
  model_norm            text not null check (length(model_norm) > 0),
  variant               text check (variant is null or length(trim(variant)) between 1 and 80),
  variant_norm          text not null default '',
  category              text not null check (length(trim(category)) between 1 and 60),
  release_year          smallint check (release_year is null or release_year between 1900 and 2100),
  release_year_verified boolean not null default false,
  gtin                  text check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  mpn                   text check (mpn is null or length(trim(mpn)) between 1 and 60),
  status                text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected', 'merged')),
  merged_into           text references catalog_products (id),
  -- Why the entry is in the queue (e.g. a possible variant of another record).
  match_note            text,
  similar_to            text references catalog_products (id),
  submitted_by          text references users (id),
  reviewed_by           text references users (id),
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (status <> 'merged' or merged_into is not null),
  check (not release_year_verified or release_year is not null)
);
create unique index catalog_products_live_identity
  on catalog_products (brand_id, model_norm, variant_norm) where status in ('pending', 'approved');
create unique index catalog_products_live_gtin
  on catalog_products (gtin) where gtin is not null and status in ('pending', 'approved');
create index catalog_products_status_idx on catalog_products (status, created_at);

-- Where to buy: stored apart from products so offers can change without
-- touching the record, and so a partner can attribute a sale to one offer.
create table seller_offers (
  id                  text primary key default gen_random_uuid()::text,
  product_id          text not null references catalog_products (id),
  seller_name         text not null check (length(trim(seller_name)) between 1 and 80),
  url                 text not null check (url ~ '^https://[^\s]+$' and length(url) <= 500),
  offer_kind          text not null default 'seller' check (offer_kind in ('seller', 'brand')),
  -- Referral commissions are disclosed separately from review incentives.
  referral_commission boolean not null default false,
  status              text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  submitted_by        text references users (id),
  reviewed_by         text references users (id),
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index seller_offers_product_idx on seller_offers (product_id, status);

-- One review → one catalog record. Kept apart from reviews (FR-15 lock).
create table review_products (
  review_id    text primary key references reviews (id),
  product_id   text not null references catalog_products (id),
  match_method text not null check (match_method in ('identifier', 'brand_model', 'new_entry', 'admin')),
  linked_by    text not null references users (id),
  linked_at    timestamptz not null default now()
);
create index review_products_product_idx on review_products (product_id);

create table catalog_corrections (
  id          text primary key default gen_random_uuid()::text,
  product_id  text not null references catalog_products (id),
  user_id     text not null references users (id),
  note        text not null check (length(trim(note)) between 1 and 500),
  status      text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by text references users (id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index catalog_corrections_open_idx on catalog_corrections (status, created_at);

create or replace function trufolks_catalog_brand(p_name text) returns text
language plpgsql as $$
declare
  v_id text;
  v_norm text := trufolks_norm(p_name);
begin
  if length(v_norm) = 0 then return null; end if;
  select id into v_id from catalog_brands where name_norm = v_norm;
  if v_id is not null then return v_id; end if;
  insert into catalog_brands (name, name_norm) values (trim(p_name), v_norm)
  on conflict (name_norm) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from catalog_brands where name_norm = v_norm; end if;
  return v_id;
end;
$$;

-- Link the author's own review to a catalog record, matching by identifier
-- first, then by normalized brand + model + variant. Anything not matched
-- exactly becomes a pending entry for the TruFolks team (a near match — same
-- brand and model, different variant — is noted for them).
-- Outcomes: ok, not_found, invalid.
create or replace function trufolks_link_review_product(
  p_user_id  text,
  p_review_id text,
  p_kind     text,
  p_brand    text,
  p_model    text,
  p_variant  text,
  p_category text,
  p_gtin     text,
  p_mpn      text,
  p_offer_seller text,
  p_offer_url    text
) returns table (r_outcome text, r_product_id text, r_status text, r_method text)
language plpgsql as $$
declare
  v_brand_id text;
  v_model_norm text := trufolks_norm(p_model);
  v_variant text := nullif(trim(coalesce(p_variant, '')), '');
  v_variant_norm text := trufolks_norm(p_variant);
  v_gtin text := nullif(regexp_replace(coalesce(p_gtin, ''), '[^0-9]', '', 'g'), '');
  v_mpn text := nullif(trim(coalesce(p_mpn, '')), '');
  v_pid text;
  v_status text;
  v_method text;
  v_similar text;
  v_slug text;
begin
  if not exists (select 1 from reviews where id = p_review_id and user_id = p_user_id) then
    return query select 'not_found'::text, null::text, null::text, null::text; return;
  end if;
  if p_kind not in ('product', 'service')
     or length(trufolks_norm(p_brand)) = 0 or length(trim(coalesce(p_brand, ''))) > 80
     or length(v_model_norm) = 0 or length(trim(coalesce(p_model, ''))) > 120
     or length(coalesce(v_variant, '')) > 80
     or length(trim(coalesce(p_category, ''))) not between 1 and 60
     or (v_gtin is not null and v_gtin !~ '^[0-9]{8,14}$')
     or length(coalesce(v_mpn, '')) > 60
     or (nullif(trim(coalesce(p_offer_url, '')), '') is not null
         and (trim(p_offer_url) !~ '^https://[^\s]+$' or length(trim(p_offer_url)) > 500
              or length(trim(coalesce(p_offer_seller, ''))) not between 1 and 80)) then
    return query select 'invalid'::text, null::text, null::text, null::text; return;
  end if;
  perform pg_advisory_xact_lock(hashtext('trufolks_catalog'), 0);

  -- 1. Identifier.
  if v_gtin is not null then
    select id, status into v_pid, v_status from catalog_products
     where gtin = v_gtin and status in ('approved', 'pending')
     order by (status = 'approved') desc limit 1;
    if v_pid is not null then v_method := 'identifier'; end if;
  end if;

  -- 2. Normalized brand + model + variant.
  if v_pid is null then
    v_brand_id := trufolks_catalog_brand(p_brand);
    select id, status into v_pid, v_status from catalog_products
     where brand_id = v_brand_id and model_norm = v_model_norm and variant_norm = v_variant_norm
       and status in ('approved', 'pending')
     limit 1;
    if v_pid is not null then v_method := 'brand_model'; end if;
  end if;

  -- 3. New entry, queued for the team.
  if v_pid is null then
    select id into v_similar from catalog_products
     where brand_id = v_brand_id and model_norm = v_model_norm and status in ('approved', 'pending')
     order by (status = 'approved') desc, created_at limit 1;
    v_slug := trufolks_slugify(trim(p_brand) || ' ' || trim(p_model) || coalesce(' ' || v_variant, ''), 100);
    if length(v_slug) < 3 then v_slug := 'item'; end if;
    v_slug := v_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    insert into catalog_products (slug, kind, brand_id, model, model_norm, variant, variant_norm, category,
                                  gtin, mpn, status, match_note, similar_to, submitted_by)
    values (v_slug, p_kind, v_brand_id, trim(p_model), v_model_norm, v_variant, v_variant_norm, trim(p_category),
            v_gtin, v_mpn, 'pending',
            case when v_similar is not null then 'possible_variant' else 'new_entry' end,
            v_similar, p_user_id)
    returning id, status into v_pid, v_status;
    v_method := 'new_entry';
  end if;

  insert into review_products (review_id, product_id, match_method, linked_by)
  values (p_review_id, v_pid, v_method, p_user_id)
  on conflict (review_id) do update
    set product_id = excluded.product_id, match_method = excluded.match_method,
        linked_by = excluded.linked_by, linked_at = now();

  -- A suggested place to buy waits for the team like any new entry.
  if nullif(trim(coalesce(p_offer_url, '')), '') is not null
     and not exists (select 1 from seller_offers where product_id = v_pid and url = trim(p_offer_url)
                      and status in ('pending', 'approved')) then
    insert into seller_offers (product_id, seller_name, url, submitted_by)
    values (v_pid, trim(p_offer_seller), trim(p_offer_url), p_user_id);
  end if;

  return query select 'ok'::text, v_pid, v_status, v_method;
end;
$$;

-- Admin: decide a queued record. Outcomes: ok, not_found, invalid.
-- p_action: approve | reject | merge (into p_target, moving every review link).
create or replace function trufolks_admin_decide_product(
  p_admin_id text,
  p_product_id text,
  p_action text,
  p_target text
) returns text
language plpgsql as $$
declare
  v_p catalog_products%rowtype;
  v_t catalog_products%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('trufolks_catalog'), 0);
  select * into v_p from catalog_products where id = p_product_id for update;
  if not found or v_p.status = 'merged' then return 'not_found'; end if;
  if p_action = 'approve' then
    update catalog_products set status = 'approved', reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
     where id = p_product_id;
  elsif p_action = 'reject' then
    update catalog_products set status = 'rejected', reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
     where id = p_product_id;
  elsif p_action = 'merge' then
    select * into v_t from catalog_products where id = p_target;
    if not found or v_t.id = v_p.id or v_t.status <> 'approved' then return 'invalid'; end if;
    update review_products set product_id = v_t.id, match_method = 'admin', linked_by = p_admin_id, linked_at = now()
     where product_id = v_p.id;
    update seller_offers set product_id = v_t.id where product_id = v_p.id;
    update catalog_products set status = 'merged', merged_into = v_t.id, reviewed_by = p_admin_id,
           reviewed_at = now(), updated_at = now()
     where id = p_product_id;
  else
    return 'invalid';
  end if;
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ Show in Shop (SHOP-18-01)
-- The owner chooses which reviews appear in their Shop. Off by default; a Top 5
-- pin does not add an item. The flag is only a choice: every read still needs
-- the review visible to the viewer (profile AND review audience, THE read rule
-- above), an approved catalog record and at least one approved seller link. So
-- unsharing the review, removing it from Shop, or losing the approved link
-- takes the listing away without touching this table.
create table shop_items (
  user_id   text not null references users (id),
  review_id text not null references reviews (id),
  added_at  timestamptz not null default now(),
  primary key (user_id, review_id)
);

create trigger shop_items_own_review
  before insert or update on shop_items
  for each row execute function trufolks_top_picks_own_review();

-- Can this review be listed in its author's Shop right now?
create or replace function trufolks_shop_eligible(p_review_id text) returns boolean
language sql stable as $$
  select exists (
    select 1
      from reviews r
      join verified_purchases vp on vp.id = r.verified_purchase_id
      join review_products rp on rp.review_id = r.id
      join catalog_products cp on cp.id = rp.product_id and cp.status = 'approved'
     where r.id = p_review_id
       and trufolks_review_shareable(r.disclosure, vp.verification_status)
       and exists (select 1 from seller_offers o where o.product_id = cp.id and o.status = 'approved'));
$$;

-- Outcomes: ok, not_found (not your review), not_eligible (no approved seller link yet, or not shareable).
create or replace function trufolks_set_shop_item(p_user_id text, p_review_id text, p_on boolean) returns text
language plpgsql as $$
begin
  if not exists (select 1 from reviews where id = p_review_id and user_id = p_user_id) then
    return 'not_found';
  end if;
  if p_on then
    if not trufolks_shop_eligible(p_review_id) then return 'not_eligible'; end if;
    insert into shop_items (user_id, review_id) values (p_user_id, p_review_id)
    on conflict (user_id, review_id) do nothing;
    if found then
      insert into profile_events (user_id, event, review_id) values (p_user_id, 'shop_added', p_review_id);
    end if;
  else
    delete from shop_items where user_id = p_user_id and review_id = p_review_id;
    if found then
      insert into profile_events (user_id, event, review_id) values (p_user_id, 'shop_removed', p_review_id);
    end if;
  end if;
  return 'ok';
end;
$$;
