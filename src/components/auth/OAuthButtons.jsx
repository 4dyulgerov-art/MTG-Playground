/*  src/components/auth/OAuthButtons.jsx
    ─────────────────────────────────────────────────────────────────────────
    Google + Discord OAuth login buttons. Drops in below the email/password
    form on AuthGate. v7.6.5.

    Supabase project providers must be enabled (Authentication → Providers):
      - Google (with the OAuth client configured per AUTH-HANDOVER-BRIEF-v2.md)
      - Discord (with the app configured per AUTH-HANDOVER-BRIEF-v2.md)

    Callback URL (registered both with Google and Discord):
      https://twbponkjfwkvnsqemikk.supabase.co/auth/v1/callback

    Supabase then redirects back to `redirectTo`. We use the current origin so
    local dev (localhost:5173) and production (playsim.live) both work.
*/
import { supabase } from '../../lib/supabase';

const T = {
  panel:   '#080f1c',
  border:  '#1e3a5f',
  accent:  '#c8a870',
  text:    '#d4c5a0',
  muted:   '#8a99b0',
};
const fontHeading = "'Cinzel', 'Cinzel Decorative', Garamond, serif";
const fontBody    = "'Crimson Text', Garamond, Georgia, serif";

const CALLBACK = typeof window !== 'undefined'
  ? window.location.origin + '/auth/callback'
  : 'https://playsim.live/auth/callback';

async function signInWithProvider(provider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: CALLBACK },
  });
  if (error) {
    console.warn('[OAuth]', provider, error);
    alert(`Could not start ${provider} sign-in: ${error.message}`);
  }
}

export default function OAuthButtons() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
        <div style={{ flex: 1, height: 1, background: T.border, opacity: .5 }} />
        <span style={{ color: T.muted, fontFamily: fontBody, fontSize: 12, fontStyle: 'italic' }}>
          or continue with
        </span>
        <div style={{ flex: 1, height: 1, background: T.border, opacity: .5 }} />
      </div>

      <button onClick={() => signInWithProvider('google')} type="button"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          width: '100%', padding: '10px 14px',
          background: T.panel, color: T.text,
          border: `1px solid ${T.border}`, borderRadius: 5,
          fontFamily: fontHeading, fontSize: 11, letterSpacing: '.12em',
          cursor: 'pointer', textTransform: 'uppercase',
          transition: 'border-color .12s, background .12s',
        }}
        onMouseOver={e => { e.currentTarget.style.borderColor = T.accent; }}
        onMouseOut={e => { e.currentTarget.style.borderColor = T.border; }}>
        <GoogleIcon /> Sign in with Google
      </button>

      <button onClick={() => signInWithProvider('discord')} type="button"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          width: '100%', padding: '10px 14px',
          background: T.panel, color: T.text,
          border: `1px solid ${T.border}`, borderRadius: 5,
          fontFamily: fontHeading, fontSize: 11, letterSpacing: '.12em',
          cursor: 'pointer', textTransform: 'uppercase',
          transition: 'border-color .12s, background .12s',
        }}
        onMouseOver={e => { e.currentTarget.style.borderColor = '#5865f2'; }}
        onMouseOut={e => { e.currentTarget.style.borderColor = T.border; }}>
        <DiscordIcon /> Sign in with Discord
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#5865f2">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
    </svg>
  );
}
