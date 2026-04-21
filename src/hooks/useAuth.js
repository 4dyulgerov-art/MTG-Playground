import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onAuthChange } from '../lib/auth';

export function useAuth() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data?.session || null);
    });
    const unsub = onAuthChange(s => { if (active) setSession(s || null); });
    return () => { active = false; unsub && unsub(); };
  }, []);
  return {
    session,
    user: session?.user || null,
    loading: session === undefined,
  };
}
