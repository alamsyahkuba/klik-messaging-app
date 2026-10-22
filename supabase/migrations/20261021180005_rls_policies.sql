-- =============================================================
-- KLIK Migration 005: Row Level Security policies
-- Prinsip:
--   - default-deny (tabel sudah enable RLS tanpa policy = tertutup)
--   - helper is_room_member/is_group_admin SECURITY DEFINER -> anti recursive RLS
--   - tabel sensitif (credentials, login_attempts) tanpa policy -> service-role only
-- =============================================================

-- -------------------------------------------------------------
-- profiles
-- -------------------------------------------------------------
drop policy if exists "profiles_select_own_friends_coMembers" on public.profiles;
create policy "profiles_select_own_friends_coMembers"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where (f.user_id_1 = auth.uid() and f.user_id_2 = profiles.id)
         or (f.user_id_2 = auth.uid() and f.user_id_1 = profiles.id)
    )
    or exists (
      select 1 from public.friend_requests fr
      where fr.status = 'pending'
        and ((fr.sender_id = auth.uid() and fr.receiver_id = profiles.id)
          or (fr.receiver_id = auth.uid() and fr.sender_id = profiles.id))
    )
    or exists (
      select 1
      from public.chat_room_members m_me
      join public.chat_room_members m_you
        on m_you.room_id = m_me.room_id and m_you.user_id = profiles.id
      where m_me.user_id = auth.uid()
    )
  );

-- Klien boleh update profilnya sendiri, tetapi TIDAK public_code/id
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated, anon;
grant update (display_name, status, avatar_url, updated_at) on public.profiles to authenticated;

-- account_credentials & login_attempts: sengaja TANPA policy.

-- -------------------------------------------------------------
-- friend_requests & friendships (tulisan hanya via RPC)
-- -------------------------------------------------------------
drop policy if exists "friend_requests_select_related" on public.friend_requests;
create policy "friend_requests_select_related"
  on public.friend_requests for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own"
  on public.friendships for select to authenticated
  using (user_id_1 = auth.uid() or user_id_2 = auth.uid());

-- -------------------------------------------------------------
-- chat_rooms & chat_room_members (tulisan hanya via RPC)
-- -------------------------------------------------------------
drop policy if exists "rooms_select_member" on public.chat_rooms;
create policy "rooms_select_member"
  on public.chat_rooms for select to authenticated
  using (public.is_room_member(id, auth.uid()));

drop policy if exists "members_select_self_or_comember" on public.chat_room_members;
create policy "members_select_self_or_comember"
  on public.chat_room_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_room_member(room_id, auth.uid())
  );

-- -------------------------------------------------------------
-- messages
-- -------------------------------------------------------------
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member"
  on public.messages for select to authenticated
  using (public.is_room_member(room_id, auth.uid()));

drop policy if exists "messages_insert_member_only" on public.messages;
create policy "messages_insert_member_only"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_room_member(room_id, auth.uid())
  );
