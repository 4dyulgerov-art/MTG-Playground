// ════════════════════════════════════════════════════════════════════════════
// TCG Playsim v7.6.5 — Moderation data layer
// ════════════════════════════════════════════════════════════════════════════
// Wraps the lobby_messages and moderation_log tables and the revoke_media /
// restore_media RPCs. Every function returns { data, error } in keeping with
// the rest of the lib/* modules.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

// ── Lobby chat ─────────────────────────────────────────────────────────────

export async function fetchLobbyMessages(limit = 80) {
  const { data, error } = await supabase
    .from("lobby_messages")
    .select("id, user_id, alias, avatar, avatar_img, text, created_at, edited_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { data: [], error };
  // Return in chronological order (oldest first) for natural rendering.
  return { data: (data || []).reverse(), error: null };
}

export async function postLobbyMessage({ alias, avatar, avatarImg, text }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error("not_authenticated") };
  const row = {
    user_id: user.id,
    alias: alias || "Anonymous",
    avatar: avatar || "🧙",
    avatar_img: avatarImg || null,           // v7.6.5.2: image URL if user has one
    text: String(text || "").slice(0, 500),
  };
  const { data, error } = await supabase
    .from("lobby_messages")
    .insert(row)
    .select()
    .single();
  return { data, error };
}

// v7.6.5.1: edit your own message. Sets edited_at = now() so the UI can
// show "(edited)" with the user's local-timezone formatted time.
export async function updateLobbyMessage(id, newText) {
  const text = String(newText || "").slice(0, 500);
  if (!text.trim()) return { data: null, error: new Error("empty_text") };
  const { data, error } = await supabase
    .from("lobby_messages")
    .update({ text, edited_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  return { data, error };
}

export async function deleteLobbyMessage(id) {
  const { error } = await supabase.from("lobby_messages").delete().eq("id", id);
  return { error };
}

// v7.6.5.1: subscribe to all changes (INSERT/UPDATE/DELETE) on lobby_messages.
// Returns the channel; call channel.unsubscribe() to stop.
//   onInsert(row)        — new message
//   onUpdate(row, oldRow) — edited message (text and/or edited_at changed)
//   onDelete(oldRow)      — deleted message
export function subscribeLobbyMessages(onInsert, onUpdate, onDelete) {
  const channel = supabase
    .channel("lobby_messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "lobby_messages" },
      (payload) => { try { onInsert?.(payload.new); } catch {} }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "lobby_messages" },
      (payload) => { try { onUpdate?.(payload.new, payload.old); } catch {} }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "lobby_messages" },
      (payload) => { try { onDelete?.(payload.old); } catch {} }
    )
    .subscribe();
  return channel;
}

// ── Moderation log ─────────────────────────────────────────────────────────

export async function logModeration({
  kind, surface, offenderId, offenderAlias,
  reporterId, reporterAlias, payload,
}) {
  const { data, error } = await supabase
    .from("moderation_log")
    .insert({
      kind,
      surface,
      offender_id: offenderId || null,
      offender_alias: offenderAlias || null,
      reporter_id: reporterId || null,
      reporter_alias: reporterAlias || null,
      payload: payload || {},
    })
    .select()
    .single();
  return { data, error };
}

export async function fetchModerationLog({ limit = 200, unreviewedOnly = false } = {}) {
  let q = supabase
    .from("moderation_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreviewedOnly) q = q.eq("reviewed", false);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function markModerationReviewed(id, note) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("moderation_log")
    .update({
      reviewed: true,
      reviewer_id: user?.id || null,
      reviewer_note: note || null,
    })
    .eq("id", id);
  return { error };
}

// ── Strike counter / media revocation ──────────────────────────────────────

export async function incrementStrike(userId) {
  // Read-then-write because we need the new total to decide on revocation.
  const { data: prof, error: e1 } = await supabase
    .from("profiles")
    .select("strikes")
    .eq("user_id", userId)
    .single();
  if (e1) return { data: null, error: e1 };
  const newStrikes = (prof?.strikes || 0) + 1;
  const { error: e2 } = await supabase
    .from("profiles")
    .update({ strikes: newStrikes })
    .eq("user_id", userId);
  return { data: { strikes: newStrikes }, error: e2 };
}

export async function revokeMedia(userId) {
  const { error } = await supabase.rpc("revoke_media", { target: userId });
  return { error };
}

export async function restoreMedia(userId) {
  const { error } = await supabase.rpc("restore_media", { target: userId });
  return { error };
}

// ── Username history ───────────────────────────────────────────────────────

export async function fetchUsernameHistory(userId) {
  const { data, error } = await supabase
    .from("usernames_history")
    .select("alias, changed_at")
    .eq("user_id", userId)
    .order("changed_at", { ascending: false })
    .limit(50);
  return { data: data || [], error };
}

// ── Mod-panel data: list users with profile data ───────────────────────────

export async function fetchAllProfilesForMod({ limit = 500 } = {}) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, alias, avatar, avatar_url, gamemat_custom, sleeve_color, strikes, media_revoked, is_moderator, banned, chat_muted, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

// ── v7.6.5.3 Moderator powers ──────────────────────────────────────────────

export async function banUser(userId, reason) {
  const { error } = await supabase.rpc("ban_user", { target: userId, reason: reason || null });
  return { error };
}

export async function unbanUser(userId) {
  const { error } = await supabase.rpc("unban_user", { target: userId });
  return { error };
}

export async function muteUser(userId) {
  const { error } = await supabase.rpc("mute_user", { target: userId });
  return { error };
}

export async function unmuteUser(userId) {
  const { error } = await supabase.rpc("unmute_user", { target: userId });
  return { error };
}

export async function modEditProfile(userId, { alias, avatar } = {}) {
  const { error } = await supabase.rpc("mod_edit_profile", {
    target: userId,
    new_alias: alias ?? null,
    new_avatar: avatar ?? null,
  });
  return { error };
}

// Issue a warning to a user. Goes into their inbox; they see it on next load
// or live via realtime. Records the warning in moderation_log too.
export async function warnUser(userId, alias, title, body) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: senderProf } = await supabase.from("profiles")
    .select("alias").eq("user_id", user?.id || "").maybeSingle();
  const { error } = await supabase.from("inbox_messages").insert({
    user_id: userId,
    kind: "warning",
    title: title || "Moderator warning",
    body:  body  || "Please review the Code of Conduct.",
    sender_id: user?.id || null,
    sender_alias: senderProf?.alias || null,
  });
  if (!error) {
    await logModeration({
      kind: "manual_warning",
      surface: "profile",
      offenderId: userId,
      offenderAlias: alias,
      reporterId: user?.id || null,
      reporterAlias: senderProf?.alias || null,
      payload: { title, body },
    });
  }
  return { error };
}

// Maintainer-only: send the same message to every user. Returns the number
// of recipients reached.
export async function broadcastAnnouncement(title, body) {
  const { data, error } = await supabase.rpc("broadcast_announcement", {
    p_title: title, p_body: body,
  });
  return { data, error };
}

// ── v7.6.5.3 User inbox ─────────────────────────────────────────────────────

export async function fetchMyInbox({ limit = 50 } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: new Error("not_authenticated") };
  const { data, error } = await supabase
    .from("inbox_messages")
    .select("id, kind, title, body, sender_alias, read, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

export async function fetchUnreadInboxCount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { count: 0, error: null };
  const { count, error } = await supabase
    .from("inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("read", false);
  return { count: count || 0, error };
}

export async function markInboxRead(id) {
  const { error } = await supabase
    .from("inbox_messages")
    .update({ read: true })
    .eq("id", id);
  return { error };
}

export async function markAllInboxRead() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: new Error("not_authenticated") };
  const { error } = await supabase
    .from("inbox_messages")
    .update({ read: true })
    .eq("user_id", user.id)
    .eq("read", false);
  return { error };
}

export async function deleteInboxMessage(id) {
  const { error } = await supabase
    .from("inbox_messages")
    .delete()
    .eq("id", id);
  return { error };
}

export function subscribeMyInbox(onInsert) {
  // Realtime channel filtered to current user only.
  let channel;
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) return;
    channel = supabase
      .channel(`inbox_${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inbox_messages", filter: `user_id=eq.${user.id}` },
        (payload) => { try { onInsert?.(payload.new); } catch {} }
      )
      .subscribe();
  });
  return {
    unsubscribe: () => { try { channel?.unsubscribe(); } catch {} }
  };
}
