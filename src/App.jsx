/*  src/App.jsx
    ─────────────────────────────────────────────────────────────────────────
    Top-level router that sits IN FRONT of v6's MTGPlayground.
    Responsibilities:
      1. Handle ?reset=1 magic-link landing → PasswordReset view.
      2. Gate on auth (AuthGate) until signed in.
      3. Load the signed-in profile from Supabase once.
      4. Migrate local decks → cloud (once per device per user) on first login.
      5. Write profile + session into both React state AND a window global
         so the unmodified v6 code can read them via a tiny bridge.
      6. Expose deck cloud save/load to Playground via window.__MTG_V7__.
      7. Render v6's Playground.
*/
import { useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { getMyProfile, upsertMyProfile } from './lib/profiles';
import { getMyDecksCloud, saveMyDecksCloud, migrateLocalDecksIfNeeded } from './lib/decks';
import { signOut } from './lib/auth';
import AuthGate from './components/auth/AuthGate.jsx';
import PasswordReset from './components/auth/PasswordReset.jsx';
import Playground from './Playground.jsx';

const BG = '#050a12';

function SplashLoader({ label = 'Loading…' }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 10, color: '#c8a870',
      fontFamily: 'Cinzel, serif', letterSpacing: '.15em',
    }}>
      <div style={{ fontSize: 28, animation: 'floaty 1.8s ease-in-out infinite' }}>⚔</div>
      <div style={{ fontSize: 12 }}>{label}</div>
      <style>{`@keyframes floaty { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }`}</style>
    </div>
  );
}

// Detect ?reset=1 in the URL. We store in state so flipping it off after
// completion re-renders us past the gate.
function useResetFlag() {
  const [on, setOn] = useState(() => {
    try {
      // v7.6.4: also catch hash fragment that supabase recovery emails carry.
      // The link comes back as either ?reset=1 OR with #access_token=...&type=recovery.
      const url = new URL(window.location.href);
      if (url.searchParams.get('reset') === '1') return true;
      if (window.location.hash.includes('type=recovery')) return true;
      return false;
    }
    catch { return false; }
  });
  // v7.6.4: ALSO listen for PASSWORD_RECOVERY events on the global auth
  // listener — supabase fires this exactly once when the recovery link is
  // consumed. Without this, fast page loads can race past the gate.
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        const { supabase } = await import('./lib/supabase');
        const { data } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') {
            setOn(true);
            // Persist via search param so refreshes stay on this view too.
            try {
              const u = new URL(window.location.href);
              u.searchParams.set('reset', '1');
              window.history.replaceState({}, '', u.toString());
            } catch {}
          }
        });
        unsub = () => data.subscription.unsubscribe();
      } catch {}
    })();
    return () => unsub();
  }, []);
  return [on, setOn];
}

export default function App() {
  const { user, loading } = useAuth();
  const [profile, setProfile]       = useState(undefined); // undefined = not loaded
  const [profileError, setProfileError] = useState(null);
  const [resetMode, setResetMode]   = useResetFlag();

  // Load profile once we have a user (unless in reset mode).
  useEffect(() => {
    if (resetMode) return;
    if (!user) { setProfile(undefined); return; }
    let alive = true;
    (async () => {
      try {
        const p = await getMyProfile();
        if (!alive) return;
        setProfile(p || null);
        // Fire-and-forget: migrate local decks to cloud on first login.
        migrateLocalDecksIfNeeded();
      } catch (e) {
        if (!alive) return;
        setProfileError(e.message || String(e));
        setProfile(null);
      }
    })();
    return () => { alive = false; };
  }, [user?.id, resetMode]);

  // Bridge state + deck cloud API → window global for v6 code.
  useEffect(() => {
    window.__MTG_V7__ = window.__MTG_V7__ || {};
    window.__MTG_V7__.user = user || null;
    window.__MTG_V7__.profile = profile || null;
    window.__MTG_V7__.signOut = async () => { await signOut(); };
    window.__MTG_V7__.saveProfile = async (p) => {
      const { data, error } = await upsertMyProfile(p);
      if (error) throw error;
      setProfile(data);
      return data;
    };
    // v7.3: cloud deck API surfaced to Playground.jsx
    window.__MTG_V7__.getDecks  = getMyDecksCloud;
    window.__MTG_V7__.saveDecks = saveMyDecksCloud;
  }, [user, profile]);

  // Sign-out event from within v6.
  useEffect(() => {
    const h = () => signOut();
    window.addEventListener('mtg:signout', h);
    return () => window.removeEventListener('mtg:signout', h);
  }, []);

  // v7.6.5: presence heartbeat. Every 60s while signed in, touch
  // profiles.updated_at so the PresenceCounter can see "active in
  // last 10 minutes" as a proxy for "online". If the column doesn't
  // exist on the deployed schema, abort the heartbeat after the first
  // failure — don't loop spamming the network.
  // v7.6.5.7: was hitting `user_profiles?id=eq.<uuid>` which doesn't
  // exist (correct table is `profiles`, keyed by `user_id`). 404'd
  // every 60s on every signed-in client.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    let interval = null;
    let columnMissing = false;
    const ping = async () => {
      if (cancelled || columnMissing) return;
      try {
        const { supabase } = await import('./lib/supabase');
        const { error } = await supabase.from('profiles')
          .update({ updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
        if (error && /updated_at/i.test(error.message || '')) {
          columnMissing = true;
          if (interval) { clearInterval(interval); interval = null; }
        }
      } catch {}
    };
    ping();
    interval = setInterval(ping, 60_000);
    const onVis = () => { if (!document.hidden) ping(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user?.id]);

  // v7.6.5: GLOBAL site presence channel. Anyone on playsim.live (signed in
  // or not) joins a Supabase Realtime presence channel `playsim:lobby`. The
  // count is exposed as `window.__MTG_V7__.sitePresenceCount` and updated on
  // any join/leave event. PresenceCounter reads this in addition to the
  // logged-in-users-in-last-10min query so the "Players Online" number
  // reflects actual eyeballs on the site, not just authenticated profiles.
  useEffect(() => {
    let cancelled = false;
    let channel = null;
    let mySessionId = null;
    try {
      mySessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    } catch { mySessionId = `s_${Date.now()}`; }
    const updateCount = (presenceState) => {
      try {
        const keys = Object.keys(presenceState || {});
        const total = keys.reduce((acc, k) => acc + (Array.isArray(presenceState[k]) ? presenceState[k].length : 1), 0);
        window.__MTG_V7__ = window.__MTG_V7__ || {};
        window.__MTG_V7__.sitePresenceCount = total;
        // Notify listeners (PresenceCounter polls this on its tick anyway).
        try { window.dispatchEvent(new CustomEvent('mtg-site-presence', { detail: { count: total } })); } catch {}
      } catch {}
    };
    (async () => {
      try {
        const { supabase } = await import('./lib/supabase');
        if (cancelled) return;
        channel = supabase.channel('playsim:lobby', {
          config: { presence: { key: mySessionId } },
        });
        channel
          .on('presence', { event: 'sync' }, () => {
            updateCount(channel.presenceState());
          })
          .on('presence', { event: 'join' }, () => {
            updateCount(channel.presenceState());
          })
          .on('presence', { event: 'leave' }, () => {
            updateCount(channel.presenceState());
          })
          .subscribe(async (status) => {
            if (status === 'SUBSCRIBED' && !cancelled) {
              try {
                await channel.track({
                  alias: profile?.alias || (user?.user_metadata?.alias) || null,
                  signedIn: !!user,
                  ts: Date.now(),
                });
              } catch {}
            }
          });
      } catch {}
    })();
    return () => {
      cancelled = true;
      if (channel) {
        try { channel.untrack().catch(()=>{}); } catch {}
        try { channel.unsubscribe(); } catch {}
      }
      try {
        if (window.__MTG_V7__) delete window.__MTG_V7__.sitePresenceCount;
      } catch {}
    };
  }, [user?.id, profile?.alias]);

  // 1. Reset-password mode takes precedence over everything except "still loading".
  if (loading) return <SplashLoader label="AUTHENTICATING…" />;
  if (resetMode && user) {
    return <PasswordReset onDone={() => setResetMode(false)} />;
  }
  if (resetMode && !user) {
    // Link expired or was consumed. Drop out of reset mode.
    setTimeout(() => setResetMode(false), 0);
    return <SplashLoader label="LINK EXPIRED, REDIRECTING…" />;
  }

  if (!user)                  return <AuthGate />;
  if (profile === undefined)  return <SplashLoader label="LOADING PROFILE…" />;

  return (
    <Playground
      authUser={user}
      initialProfile={profile}
      onProfileSaved={async p => {
        await upsertMyProfile(p);
        setProfile(p);
      }}
      onSignOut={() => signOut()}
    />
  );
}
