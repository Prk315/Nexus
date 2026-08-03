import { getSupabaseClient, getUserId } from "./supabase";

const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const REDIRECT_URI = "https://efxmzsdisaymtpebaxlp.supabase.co/functions/v1/oura-oauth-callback";

/** Inserts a CSRF nonce, then redirects to Oura's consent screen. Scope is
 * omitted deliberately — Oura grants every scope the app is approved for,
 * which is more robust than hand-maintaining a scope list against an
 * under-documented spec. */
export async function startOuraConnect(): Promise<void> {
  const supabase = getSupabaseClient();
  const state = crypto.randomUUID();

  const { error } = await supabase.from("protocol_oauth_states").insert({
    state,
    user_id: getUserId(),
  });
  if (error) throw error;

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", await getOuraClientId());
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", state);

  window.location.href = url.toString();
}

async function getOuraClientId(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_oura_client_id");
  if (error || !data) throw error ?? new Error("Oura client id not configured");
  return data as string;
}

export async function isOuraConnected(): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("protocol_oura_tokens")
    .select("user_id")
    .eq("user_id", getUserId())
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function disconnectOura(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("protocol_oura_tokens")
    .delete()
    .eq("user_id", getUserId());
  if (error) throw error;
}

export interface OuraSyncResult {
  user_id: string;
  status: string;
  sleepDays?: number;
  bodyDays?: number;
  workoutCount?: number;
}

export async function syncOuraNow(): Promise<OuraSyncResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("oura-sync");
  if (error) throw error;
  const result = (data?.synced as OuraSyncResult[] | undefined)?.[0];
  if (!result) throw new Error("Oura sync returned no result");
  if (result.status !== "ok") throw new Error(`Oura sync failed: ${result.status}`);
  return result;
}
