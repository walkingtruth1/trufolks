-- TruFolks Ticket 2a — link TruFolks users to Better Auth logins.
--
-- * users.id must be an existing Better Auth "user"."id": no TruFolks profile
--   without a login.
-- * A trigger creates the users row in the same transaction as sign-up, so a
--   login can never exist without its TruFolks profile (and vice versa).
-- * Deleting a login is blocked while its TruFolks profile exists. Account
--   deletion (FR-01) gets its own flow in a later ticket.

alter table users
  add constraint users_id_auth_user_fkey
  foreign key (id) references "user" ("id") on delete restrict;

create or replace function trufolks_create_user_profile() returns trigger
language plpgsql as $$
begin
  insert into users (id, display_name)
  values (new."id", coalesce(nullif(trim(new."name"), ''), 'TruFolks member'))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger user_create_trufolks_profile
  after insert on "user"
  for each row execute function trufolks_create_user_profile();
