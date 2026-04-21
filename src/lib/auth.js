import { supabase } from './supabase';

export async function signUp(email, password, alias) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { alias },  // fed to raw_user_meta_data → trigger creates profile
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  });
  return { data, error };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  return supabase.auth.signOut();
}

// v7.3: redirect the magic link to a dedicated ?reset=1 URL so the app knows
// to show the "choose a new password" form instead of just logging the user in.
export async function resetPassword(email) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: origin ? `${origin}/?reset=1` : undefined,
  });
}

// v7.3: actually change the password once the user is in the reset flow.
export async function updatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  return { data, error };
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

export function onAuthChange(cb) {
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => sub.subscription.unsubscribe();
}
