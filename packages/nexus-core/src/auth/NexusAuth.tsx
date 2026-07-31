import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient, Session, User } from "@supabase/supabase-js";

// ─── Shared ecosystem auth ──────────────────────────────────────────────────
// One Supabase project backs every Nexus app, so a single account (auth.uid())
// is universal across the ecosystem. Each app wraps itself in <NexusAuthProvider>
// (passing its own supabase client) and gates its UI behind <AuthGate>. Sessions
// persist in localStorage per app, so you log in once per app and stay in.

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function useNexusAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useNexusAuth must be used within <NexusAuthProvider>");
  return ctx;
}

export function NexusAuthProvider({
  supabase,
  children,
}: {
  supabase: SupabaseClient;
  children: ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    loading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message };
    },
    signUp: async (email, password) => {
      const { data, error } = await supabase.auth.signUp({ email, password });
      // If email confirmation is on, a user is returned but no session yet.
      return { error: error?.message, needsConfirmation: !!data.user && !data.session };
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

// Gates children behind a session. Shows a loading state, then the login screen
// until the user is authenticated.
export function AuthGate({ appName, children }: { appName?: string; children: ReactNode }) {
  const { session, loading } = useNexusAuth();
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-400">
        Loading…
      </div>
    );
  }
  if (!session) return <LoginScreen appName={appName} />;
  return <>{children}</>;
}

export function LoginScreen({ appName }: { appName?: string }) {
  const { signIn, signUp } = useNexusAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { error } = await signIn(email.trim(), password);
        if (error) setError(error);
      } else {
        const { error, needsConfirmation } = await signUp(email.trim(), password);
        if (error) setError(error);
        else if (needsConfirmation)
          setNotice("Check your inbox to confirm your email, then sign in.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-2xl"
      >
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-neutral-100">
            {appName ?? "Nexus"}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {mode === "signin" ? "Sign in to your account" : "Create your account"}
          </p>
        </div>

        <label className="mb-1 block text-xs font-medium text-neutral-400">Email</label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          placeholder="you@example.com"
        />

        <label className="mb-1 block text-xs font-medium text-neutral-400">Password</label>
        <input
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-5 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          placeholder="••••••••"
        />

        {error && (
          <div className="mb-4 rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-lg border border-emerald-900 bg-emerald-950/60 px-3 py-2 text-xs text-emerald-300">
            {notice}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-neutral-100 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white disabled:opacity-60"
        >
          {busy ? "…" : mode === "signin" ? "Log in" : "Sign up"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          className="mt-4 w-full text-center text-xs text-neutral-500 hover:text-neutral-300"
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
