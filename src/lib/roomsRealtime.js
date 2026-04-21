/*  src/lib/roomsRealtime.js
    Realtime helpers for rooms. Used by the lobby UI to see people join live.
    v6's polling in RoomLobby still works (and is used as the primary path
    so we don't need edits inside v6) — this is ADDITIVE.
*/
import { supabase } from './supabase';

// Subscribe to all changes on rooms + room_players globally.
// Callback fires on any event; lobby can refresh its list in response.
export function subscribeLobby(onChange) {
  const ch = supabase
    .channel('lobby')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' },        () => onChange('rooms'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players' }, () => onChange('room_players'))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// Subscribe to a single room's roster changes.
export function subscribeRoomPlayers(roomId, onChange) {
  const ch = supabase
    .channel(`room:${roomId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'room_players',
      filter: `room_id=eq.${roomId}`,
    }, (payload) => onChange(payload))
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'rooms',
      filter: `id=eq.${roomId}`,
    }, (payload) => onChange(payload))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// Mark room as playing (host only; enforced by RLS).
export async function launchRoom(roomId) {
  const { error } = await supabase.from('rooms').update({ status: 'playing' }).eq('id', roomId);
  return error;
}

// Close a room (host only).
export async function closeRoom(roomId) {
  const { error } = await supabase.from('rooms').update({ status: 'closed' }).eq('id', roomId);
  return error;
}

// Leave a room (removes your row; if host, also closes room).
export async function leaveRoom(roomId, userId, isHost) {
  await supabase.from('room_players').delete().eq('room_id', roomId).eq('user_id', userId);
  if (isHost) await closeRoom(roomId);
}
