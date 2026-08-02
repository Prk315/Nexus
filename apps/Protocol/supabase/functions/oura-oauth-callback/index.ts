import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const REDIRECT_URI = "https://efxmzsdisaymtpebaxlp.supabase.co/functions/v1/oura-oauth-callback";
const APP_URL = "https://nexus-protocol-ilx4.vercel.app";
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function bounce(status: "connected" | "error", message?: string): Response {
  const url = new URL(APP_URL);
  url.searchParams.set("oura", status);
  if (message) url.searchParams.set("oura_error", message);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return bounce("error", oauthError);
  if (!code || !state) return bounce("error", "missing_code_or_state");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Consume the one-time CSRF nonce created client-side before the redirect
  // to Oura. Its presence + freshness is what ties this callback back to a
  // specific Nexus account, since the callback itself carries no session.
  const { data: stateRow, error: stateError } = await supabase
    .from("protocol_oauth_states")
    .select("user_id, created_at")
    .eq("state", state)
    .maybeSingle();

  if (stateError || !stateRow) return bounce("error", "invalid_state");
  await supabase.from("protocol_oauth_states").delete().eq("state", state);

  const age = Date.now() - new Date(stateRow.created_at).getTime();
  if (age > STATE_MAX_AGE_MS) return bounce("error", "state_expired");

  const [{ data: clientId }, { data: clientSecret }] = await Promise.all([
    supabase.rpc("get_protocol_secret", { secret_name: "oura_client_id" }),
    supabase.rpc("get_protocol_secret", { secret_name: "oura_client_secret" }),
  ]);
  if (!clientId || !clientSecret) return bounce("error", "missing_oura_credentials");

  const tokenRes = await fetch("https://api.ouraring.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Oura token exchange failed", await tokenRes.text());
    return bounce("error", "token_exchange_failed");
  }

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error: upsertError } = await supabase.from("protocol_oura_tokens").upsert({
    user_id: stateRow.user_id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    scope: tokens.scope ?? null,
    updated_at: new Date().toISOString(),
  });

  if (upsertError) {
    console.error("Failed to store Oura tokens", upsertError);
    return bounce("error", "token_store_failed");
  }

  return bounce("connected");
});
