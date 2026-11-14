-- TruFolks Ticket 3b-1 — receipt photo check + human verification
-- (BRD v1.6 FR-08a, FR-09, HON-04, HON-07, RES-01, AI-06, NFR-04, NFR-05, §20C).
--
-- * A purchase from a handout code becomes "verified" only after a person (an
--   admin on the allowlist) looks at the receipt photo and approves it. Checks
--   computed by the app only FLAG; they never approve or reject by themselves.
-- * The same photo bytes can never back two purchases. Every photo hash ever
--   seen is kept, even after the photo itself is deleted.
-- * Photos are private (NFR-04) and deleted after a retention window; only the
--   hash and dates stay. GPS / location is never stored (P5).
-- * The admin records the order value read off the receipt next to the value
--   the person typed. Nothing here is a reward or payout (Ticket 8).
-- * No limit values live here; they are passed in from limits.ts (CFG-11).

-- Shared append-only guard for audit tables.
create or replace function trufolks_append_only() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

-- The receipt code event log also records photo uploads, decisions and purges.
alter table receipt_code_events drop constraint receipt_code_events_kind_check;
alter table receipt_code_events add constraint receipt_code_events_kind_check
  check (kind in ('issued', 'scan', 'claim', 'suspend', 'device_created',
                  'photo_upload', 'decision', 'photo_purge'));

-- Every receipt photo hash ever accepted, and the purchase it belongs to.
create table receipt_photo_hashes (
  sha256               text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  verified_purchase_id text not null references verified_purchases (id),
  first_seen_at        timestamptz not null default now()
);

create trigger receipt_photo_hashes_no_update_or_delete
  before update or delete on receipt_photo_hashes
  for each row execute function trufolks_append_only();

-- The current receipt photo for a purchase (one per purchase; a re-upload
-- replaces it while the purchase is still pending).
create table receipt_photos (
  id                   text primary key default gen_random_uuid()::text,
  verified_purchase_id text not null unique,
  user_id              text not null references users (id),
  mime_type            text not null check (mime_type in ('image/jpeg', 'image/webp', 'image/png')),
  byte_size            integer not null check (byte_size > 0),
  photo                bytea,                  -- null once deleted
  sha256               text not null references receipt_photo_hashes (sha256),
  exif_taken_at        timestamptz,            -- "photo taken" time, if the file carried one
  exif_has_offset      boolean not null default false,  -- false = time zone unknown
  uploaded_at          timestamptz not null default now(),
  delete_after         timestamptz not null,
  deleted_at           timestamptz,
  foreign key (verified_purchase_id, user_id) references verified_purchases (id, user_id),
  check ((photo is null) = (deleted_at is not null)),
  check (delete_after > uploaded_at)
);
create index receipt_photos_delete_after_idx on receipt_photos (delete_after) where photo is not null;

-- One human decision per purchase. Append-only (NFR-05, RES-01 h).
create table purchase_verification_decisions (
  id                          text primary key default gen_random_uuid()::text,
  verified_purchase_id        text not null unique references verified_purchases (id),
  decided_by_user_id          text not null references users (id),
  decision                    text not null check (decision in ('verified', 'rejected')),
  reason                      text,
  typed_order_value_cents     integer not null,
  confirmed_order_value_cents integer check (confirmed_order_value_cents >= 0),
  checks                      jsonb not null default '[]'::jsonb,  -- the flags the admin saw
  decided_at                  timestamptz not null default now(),
  check (decision <> 'rejected' or length(trim(coalesce(reason, ''))) > 0),
  check (decision <> 'verified' or confirmed_order_value_cents is not null)
);

create trigger purchase_verification_decisions_no_update_or_delete
  before update or delete on purchase_verification_decisions
  for each row execute function trufolks_append_only();

-- Store (or replace) the receipt photo for a pending purchase. Only the
-- purchaser; only while pending; never a photo already used elsewhere.
create or replace function trufolks_store_receipt_photo(
  p_purchase_id text,
  p_user_id text,
  p_mime_type text,
  p_photo bytea,
  p_sha256 text,
  p_exif_taken_at timestamptz,
  p_exif_has_offset boolean,
  p_retention_seconds integer
) returns table (r_outcome text, r_photo_id text)
language plpgsql as $$
declare
  v_purchase verified_purchases%rowtype;
  v_hash_owner text;
  v_photo_id text;
  v_outcome text;
begin
  select * into v_purchase from verified_purchases where id = p_purchase_id for update;
  if not found or v_purchase.user_id is distinct from p_user_id then
    v_outcome := 'not_found';
  elsif v_purchase.verification_status <> 'pending' then
    v_outcome := 'already_decided';
  else
    select verified_purchase_id into v_hash_owner from receipt_photo_hashes where sha256 = p_sha256;
    if v_hash_owner is not null and v_hash_owner <> p_purchase_id then
      v_outcome := 'duplicate_photo';
    else
      insert into receipt_photo_hashes (sha256, verified_purchase_id)
      values (p_sha256, p_purchase_id)
      on conflict (sha256) do nothing;

      insert into receipt_photos
        (verified_purchase_id, user_id, mime_type, byte_size, photo, sha256,
         exif_taken_at, exif_has_offset, delete_after)
      values
        (p_purchase_id, p_user_id, p_mime_type, length(p_photo), p_photo, p_sha256,
         p_exif_taken_at, coalesce(p_exif_has_offset, false),
         now() + make_interval(secs => p_retention_seconds))
      on conflict (verified_purchase_id) do update set
        mime_type = excluded.mime_type,
        byte_size = excluded.byte_size,
        photo = excluded.photo,
        sha256 = excluded.sha256,
        exif_taken_at = excluded.exif_taken_at,
        exif_has_offset = excluded.exif_has_offset,
        uploaded_at = now(),
        delete_after = excluded.delete_after,
        deleted_at = null
      returning id into v_photo_id;
      v_outcome := 'ok';
    end if;
  end if;

  insert into receipt_code_events (kind, outcome, code_id, campaign_id, user_id, detail)
  values ('photo_upload', v_outcome, v_purchase.receipt_code_id, v_purchase.campaign_id, p_user_id,
          jsonb_build_object('purchase_id', p_purchase_id));

  return query select v_outcome, v_photo_id;
end;
$$;

-- A person decides a pending purchase. Verified needs a stored photo, a usable
-- code and the order value read off the receipt; rejected needs a reason.
-- An admin cannot decide their own purchase.
create or replace function trufolks_decide_purchase(
  p_purchase_id text,
  p_admin_user_id text,
  p_decision text,
  p_reason text,
  p_confirmed_order_value_cents integer,
  p_checks jsonb
) returns table (r_outcome text)
language plpgsql as $$
declare
  v_purchase verified_purchases%rowtype;
  v_code_status text;
  v_has_photo boolean;
  v_outcome text;
begin
  select * into v_purchase from verified_purchases where id = p_purchase_id for update;
  if not found then
    v_outcome := 'not_found';
  elsif v_purchase.verification_status <> 'pending' then
    v_outcome := 'already_decided';
  elsif v_purchase.user_id = p_admin_user_id then
    v_outcome := 'own_purchase';
  elsif p_decision = 'rejected' then
    if length(trim(coalesce(p_reason, ''))) = 0 then
      v_outcome := 'reason_required';
    else
      insert into purchase_verification_decisions
        (verified_purchase_id, decided_by_user_id, decision, reason, typed_order_value_cents, checks)
      values (p_purchase_id, p_admin_user_id, 'rejected', trim(p_reason), v_purchase.order_value_cents,
              coalesce(p_checks, '[]'::jsonb));
      update verified_purchases set verification_status = 'rejected' where id = p_purchase_id;
      v_outcome := 'ok';
    end if;
  elsif p_decision = 'verified' then
    select exists (select 1 from receipt_photos
                    where verified_purchase_id = p_purchase_id and photo is not null)
      into v_has_photo;
    if v_purchase.receipt_code_id is not null then
      select status into v_code_status from receipt_codes where id = v_purchase.receipt_code_id;
    end if;
    if not v_has_photo then
      v_outcome := 'no_photo';
    elsif p_confirmed_order_value_cents is null or p_confirmed_order_value_cents < 0 then
      v_outcome := 'bad_value';
    elsif v_purchase.receipt_code_id is not null and v_code_status <> 'claimed' then
      v_outcome := 'code_not_usable';
    else
      insert into purchase_verification_decisions
        (verified_purchase_id, decided_by_user_id, decision, reason, typed_order_value_cents,
         confirmed_order_value_cents, checks)
      values (p_purchase_id, p_admin_user_id, 'verified', nullif(trim(coalesce(p_reason, '')), ''),
              v_purchase.order_value_cents, p_confirmed_order_value_cents, coalesce(p_checks, '[]'::jsonb));
      update verified_purchases
         set verification_status = 'verified',
             verification_method = case when receipt_code_id is not null
                                        then 'receipt_code_and_photo' else 'receipt_photo' end,
             order_value_cents = p_confirmed_order_value_cents,
             verified_at = now()
       where id = p_purchase_id;
      v_outcome := 'ok';
    end if;
  else
    v_outcome := 'bad_decision';
  end if;

  insert into receipt_code_events (kind, outcome, code_id, campaign_id, user_id, detail)
  values ('decision', v_outcome, v_purchase.receipt_code_id, v_purchase.campaign_id, p_admin_user_id,
          jsonb_build_object('purchase_id', p_purchase_id, 'decision', p_decision));

  return query select v_outcome;
end;
$$;

-- Delete photo bytes past their retention date. Keeps the row, hash and dates.
create or replace function trufolks_purge_receipt_photos() returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  update receipt_photos
     set photo = null, deleted_at = now()
   where photo is not null and delete_after <= now();
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into receipt_code_events (kind, outcome, detail)
    values ('photo_purge', 'ok', jsonb_build_object('photos_deleted', v_count));
  end if;
  return v_count;
end;
$$;
