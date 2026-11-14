-- TruFolks Ticket 5 — contacts and the contacts feed (BRD v1.6 FR-02, FR-05,
-- FR-16, FR-17, FR-18, P1, P4, P5, P6, LEG-01, NFR-04).
--
-- * People become contacts only through a private invite link that one of
--   them sends the other (FR-02). No address book, no search for strangers,
--   no email lookup (P5).
-- * Contacts are MUTUAL: accepting writes both directed rows as 'accepted'.
--   Removing deletes both. Blocking keeps only the blocker's 'blocked' row.
-- * Only the token's SHA-256 is stored; the raw link is shown once.
-- * A contact sees a review only when ALL hold (trufolks_contact_reviews):
--   both rows accepted, author not deleted, purchase verified, and the
--   disclosure is attached IN FULL (`complete` = true). LEG-01 / gap 19: an
--   incomplete disclosure is never shown to contacts.
-- * No follower counts, no ranking signals (FR-05, P6). Order is newest first.
-- Atomic work is one plpgsql function per call (the Sql client has no transactions).

-- ------------------------------------------------------------------ invites
create table contact_invites (
  id          text primary key default gen_random_uuid()::text,
  user_id     text not null references users (id),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  check (expires_at > created_at)
);
create index contact_invites_user_idx on contact_invites (user_id, created_at desc);

-- An invite's owner, hash and dates never change; it can only be turned off once.
create or replace function trufolks_contact_invites_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'contact_invites rows are kept; turn a link off instead';
  end if;
  if new.user_id is distinct from old.user_id
     or new.token_hash is distinct from old.token_hash
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'An invite link can only be turned off';
  end if;
  return new;
end;
$$;

create trigger contact_invites_guard
  before update or delete on contact_invites
  for each row execute function trufolks_contact_invites_guard();

-- ------------------------------------------------------------------ event log
create table contact_events (
  id            text primary key default gen_random_uuid()::text,
  user_id       text not null references users (id),
  other_user_id text references users (id),
  event         text not null check (event in
                  ('invite_created', 'invite_revoked', 'accepted', 'removed', 'blocked', 'unblocked')),
  at            timestamptz not null default now()
);
create index contact_events_user_idx on contact_events (user_id, at);

create or replace function trufolks_contact_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'contact_events is append-only';
end;
$$;

create trigger contact_events_no_update_or_delete
  before update or delete on contact_events
  for each row execute function trufolks_contact_events_append_only();

create trigger contact_events_no_truncate
  before truncate on contact_events
  for each statement execute function trufolks_contact_events_append_only();

-- Serialises changes to one pair of people, whichever side acts.
create or replace function trufolks_lock_contact_pair(p_a text, p_b text) returns void
language sql as $$
  select pg_advisory_xact_lock(hashtext('trufolks_contact_pair'), hashtext(least(p_a, p_b) || '|' || greatest(p_a, p_b)));
$$;

-- ------------------------------------------------------------------ make / turn off a link
-- One working link per person: making a new one turns the old one off.
create or replace function trufolks_create_contact_invite(
  p_user_id text,
  p_token_hash text,
  p_lifetime_seconds integer
) returns table (r_outcome text, r_expires_at timestamptz)
language plpgsql as $$
declare
  v_expires timestamptz;
begin
  if not exists (select 1 from users where id = p_user_id and deleted_at is null) then
    return query select 'not_found'::text, null::timestamptz; return;
  end if;
  perform pg_advisory_xact_lock(hashtext('trufolks_contact_invite'), hashtext(p_user_id));
  update contact_invites set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;
  v_expires := now() + make_interval(secs => p_lifetime_seconds);
  insert into contact_invites (user_id, token_hash, expires_at) values (p_user_id, p_token_hash, v_expires);
  insert into contact_events (user_id, event) values (p_user_id, 'invite_created');
  return query select 'ok'::text, v_expires;
end;
$$;

create or replace function trufolks_revoke_contact_invite(p_user_id text) returns text
language plpgsql as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('trufolks_contact_invite'), hashtext(p_user_id));
  update contact_invites set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;
  get diagnostics v_count = row_count;
  if v_count = 0 then return 'not_found'; end if;
  insert into contact_events (user_id, event) values (p_user_id, 'invite_revoked');
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ look up / accept
-- Outcomes: ok, not_found (unknown, turned off, expired, deleted account, or
-- the inviter blocked you — deliberately not told apart), own_invite,
-- you_blocked, already_contacts.
create or replace function trufolks_contact_invite_status(p_token_hash text, p_user_id text)
returns table (r_outcome text, r_inviter_id text, r_inviter_name text)
language plpgsql stable as $$
declare
  v_inv contact_invites%rowtype;
  v_name text;
begin
  select * into v_inv from contact_invites
   where token_hash = p_token_hash and revoked_at is null and expires_at > now();
  if not found then
    return query select 'not_found'::text, null::text, null::text; return;
  end if;
  select display_name into v_name from users where id = v_inv.user_id and deleted_at is null;
  if v_name is null or not exists (select 1 from users where id = p_user_id and deleted_at is null) then
    return query select 'not_found'::text, null::text, null::text; return;
  end if;
  if v_inv.user_id = p_user_id then
    return query select 'own_invite'::text, v_inv.user_id, v_name; return;
  end if;
  if exists (select 1 from contacts where owner_user_id = v_inv.user_id and contact_user_id = p_user_id and status = 'blocked') then
    return query select 'not_found'::text, null::text, null::text; return;
  end if;
  if exists (select 1 from contacts where owner_user_id = p_user_id and contact_user_id = v_inv.user_id and status = 'blocked') then
    return query select 'you_blocked'::text, v_inv.user_id, v_name; return;
  end if;
  if exists (select 1 from contacts where owner_user_id = v_inv.user_id and contact_user_id = p_user_id and status = 'accepted')
     and exists (select 1 from contacts where owner_user_id = p_user_id and contact_user_id = v_inv.user_id and status = 'accepted') then
    return query select 'already_contacts'::text, v_inv.user_id, v_name; return;
  end if;
  return query select 'ok'::text, v_inv.user_id, v_name;
end;
$$;

create or replace function trufolks_accept_contact_invite(p_token_hash text, p_user_id text)
returns table (r_outcome text, r_inviter_id text)
language plpgsql as $$
declare
  v_inviter text;
  v_status text;
begin
  select user_id into v_inviter from contact_invites
   where token_hash = p_token_hash and revoked_at is null and expires_at > now();
  if v_inviter is null then
    return query select 'not_found'::text, null::text; return;
  end if;
  perform trufolks_lock_contact_pair(v_inviter, p_user_id);
  -- Re-check everything under the lock.
  select s.r_outcome into v_status from trufolks_contact_invite_status(p_token_hash, p_user_id) s;
  if v_status <> 'ok' then
    return query select v_status, case when v_status = 'not_found' then null else v_inviter end; return;
  end if;

  insert into contacts (owner_user_id, contact_user_id, status) values (v_inviter, p_user_id, 'accepted')
  on conflict (owner_user_id, contact_user_id) do update set status = 'accepted', updated_at = now();
  insert into contacts (owner_user_id, contact_user_id, status) values (p_user_id, v_inviter, 'accepted')
  on conflict (owner_user_id, contact_user_id) do update set status = 'accepted', updated_at = now();
  insert into contact_events (user_id, other_user_id, event) values (p_user_id, v_inviter, 'accepted');
  return query select 'ok'::text, v_inviter;
end;
$$;

-- ------------------------------------------------------------------ remove / block / unblock
create or replace function trufolks_remove_contact(p_user_id text, p_other_id text) returns text
language plpgsql as $$
begin
  perform trufolks_lock_contact_pair(p_user_id, p_other_id);
  if not exists (select 1 from contacts where owner_user_id = p_user_id and contact_user_id = p_other_id and status = 'accepted') then
    return 'not_found';
  end if;
  delete from contacts
   where status = 'accepted'
     and ((owner_user_id = p_user_id and contact_user_id = p_other_id)
       or (owner_user_id = p_other_id and contact_user_id = p_user_id));
  insert into contact_events (user_id, other_user_id, event) values (p_user_id, p_other_id, 'removed');
  return 'ok';
end;
$$;

-- Only a current contact can be blocked (no blocking by guessed id).
create or replace function trufolks_block_contact(p_user_id text, p_other_id text) returns text
language plpgsql as $$
begin
  perform trufolks_lock_contact_pair(p_user_id, p_other_id);
  if not exists (select 1 from contacts where owner_user_id = p_user_id and contact_user_id = p_other_id and status = 'accepted') then
    return 'not_found';
  end if;
  -- The other side loses sight of you. Their own block on you (if any) is kept.
  delete from contacts
   where owner_user_id = p_other_id and contact_user_id = p_user_id and status <> 'blocked';
  update contacts set status = 'blocked', updated_at = now()
   where owner_user_id = p_user_id and contact_user_id = p_other_id;
  insert into contact_events (user_id, other_user_id, event) values (p_user_id, p_other_id, 'blocked');
  return 'ok';
end;
$$;

-- Unblocking does not make you contacts again; a new invite is needed.
create or replace function trufolks_unblock_contact(p_user_id text, p_other_id text) returns text
language plpgsql as $$
declare
  v_count integer;
begin
  perform trufolks_lock_contact_pair(p_user_id, p_other_id);
  delete from contacts
   where owner_user_id = p_user_id and contact_user_id = p_other_id and status = 'blocked';
  get diagnostics v_count = row_count;
  if v_count = 0 then return 'not_found'; end if;
  insert into contact_events (user_id, other_user_id, event) values (p_user_id, p_other_id, 'unblocked');
  return 'ok';
end;
$$;

-- ------------------------------------------------------------------ what contacts can see
-- Mutual, accepted, live contacts of the viewer.
create or replace function trufolks_mutual_contacts(p_viewer text)
returns table (contact_id text, display_name text, since timestamptz)
language sql stable as $$
  select a.contact_user_id, u.display_name, greatest(a.updated_at, b.updated_at)
    from contacts a
    join contacts b on b.owner_user_id = a.contact_user_id and b.contact_user_id = a.owner_user_id
    join users u on u.id = a.contact_user_id
   where a.owner_user_id = p_viewer
     and a.status = 'accepted' and b.status = 'accepted'
     and u.deleted_at is null;
$$;

-- THE rule for showing a review to someone other than its author (P1, LEG-01).
-- Every page that shows other people's reviews reads from here. The disclosure
-- check is on the stored JSON itself: anything but complete = true is hidden
-- (gap 19). Removed reviews (FR-25) must be added here when that ticket lands.
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
  select r.id, r.user_id, mc.display_name, m.id, m.name, vp.product_label, r.rating,
         r.what_used, r.how_long, r.honest_thought, vp.verification_status, r.disclosure, r.created_at
    from trufolks_mutual_contacts(p_viewer) mc
    join reviews r on r.user_id = mc.contact_id
    join verified_purchases vp on vp.id = r.verified_purchase_id
    join merchants m on m.id = vp.merchant_id
   where r.visibility in ('contacts', 'public')
     and vp.verification_status = 'verified'
     and jsonb_typeof(r.disclosure) = 'object'
     and r.disclosure -> 'complete' = 'true'::jsonb
     and r.disclosure -> 'rating_blind' = 'true'::jsonb;
$$;
