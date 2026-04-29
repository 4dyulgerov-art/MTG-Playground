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
    .select("id, user_id, alias, avatar, text, created_at, edited_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { data: [], error };
  // Return in chronological order (oldest first) for natural rendering.
  return { data: (data || []).reverse(), error: null };
}

export async function postLobbyMessage({ alias, avatar, text }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error("not_authenticated") };
  const row = {
    user_id: user.id,
    alias: alias || "Anonymous",
    avatar: avatar || "🧙",
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
    .select("user_id, alias, avatar, avatar_url, gamemat_custom, sleeve_color, strikes, media_revoked, is_moderator, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}
