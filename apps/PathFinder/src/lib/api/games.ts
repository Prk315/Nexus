// Games and their roadmap items.

import {
  err, mapRoadmapItem, num, supabase, getUserId,
} from "./_shared";
import type {
  Game, GameDevlogEntry, GameFeature, RoadmapItem,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════
// GAMES
// ═══════════════════════════════════════════════════════════════════════════

export const getGames = async (): Promise<Game[]> => {
  const { data, error } = await supabase
    .from("pf_games")
    .select("*, pf_game_features(id, status)")
    .eq("user_id", getUserId()).order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((g) => ({
    id: num(g.id), title: g.title, genre: g.genre, platform: g.platform, engine: g.engine,
    status: g.status, description: g.description, core_mechanic: g.core_mechanic,
    target_audience: g.target_audience, inspiration: g.inspiration, color: g.color,
    created_at: g.created_at,
    feature_count: (g.pf_game_features ?? []).length,
    done_count: (g.pf_game_features ?? []).filter((f: any) => f.status === 'done').length,
  }));
};

export const createGame = async (payload: {
  title: string; genre?: string | null; platform?: string | null; engine?: string | null;
  status?: string; description?: string | null; core_mechanic?: string | null;
  target_audience?: string | null; inspiration?: string | null; color?: string;
}): Promise<Game> => {
  const { data, error } = await supabase
    .from("pf_games").insert({ user_id: getUserId(), ...payload }).select("*, pf_game_features(id, status)").single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, genre: data!.genre, platform: data!.platform, engine: data!.engine, status: data!.status, description: data!.description, core_mechanic: data!.core_mechanic, target_audience: data!.target_audience, inspiration: data!.inspiration, color: data!.color, created_at: data!.created_at, feature_count: 0, done_count: 0 };
};

export const updateGame = async (id: number, payload: {
  title: string; genre?: string | null; platform?: string | null; engine?: string | null;
  status: string; description?: string | null; core_mechanic?: string | null;
  target_audience?: string | null; inspiration?: string | null; color: string;
}): Promise<Game> => {
  const { error } = await supabase.from("pf_games").update(payload).eq("id", id);
  if (error) err(error);
  const games = await getGames();
  return games.find((g) => g.id === id)!;
};

export const deleteGame = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_games").delete().eq("id", id);
  if (error) err(error);
};

// ─── Game features ───────────────────────────────────────────────────────────

export const getGameFeatures = async (gameId: number): Promise<GameFeature[]> => {
  const { data, error } = await supabase
    .from("pf_game_features").select("*").eq("game_id", gameId).order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), game_id: num(r.game_id), title: r.title, description: r.description, status: r.status, priority: r.priority, sort_order: r.sort_order, created_at: r.created_at }));
};

export const createGameFeature = async (payload: { game_id: number; title: string; description?: string | null; status?: string; priority?: string }): Promise<GameFeature> => {
  const { data, error } = await supabase.from("pf_game_features").insert(payload).select().single();
  if (error) err(error);
  return { id: num(data!.id), game_id: num(data!.game_id), title: data!.title, description: data!.description, status: data!.status, priority: data!.priority, sort_order: data!.sort_order, created_at: data!.created_at };
};

export const updateGameFeature = async (id: number, payload: { title: string; description?: string | null; status: string; priority: string }): Promise<GameFeature> => {
  const { data, error } = await supabase.from("pf_game_features").update(payload).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), game_id: num(data!.game_id), title: data!.title, description: data!.description, status: data!.status, priority: data!.priority, sort_order: data!.sort_order, created_at: data!.created_at };
};

export const setGameFeatureStatus = async (id: number, status: string): Promise<GameFeature> => {
  const { data, error } = await supabase.from("pf_game_features").update({ status }).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), game_id: num(data!.game_id), title: data!.title, description: data!.description, status: data!.status, priority: data!.priority, sort_order: data!.sort_order, created_at: data!.created_at };
};

export const deleteGameFeature = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_game_features").delete().eq("id", id);
  if (error) err(error);
};

// ─── Game devlog ─────────────────────────────────────────────────────────────

export const getGameDevlog = async (gameId: number): Promise<GameDevlogEntry[]> => {
  const { data, error } = await supabase
    .from("pf_game_devlog").select("*").eq("game_id", gameId).order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), game_id: num(r.game_id), content: r.content, created_at: r.created_at }));
};

export const addGameDevlogEntry = async (payload: { game_id: number; content: string }): Promise<GameDevlogEntry> => {
  const { data, error } = await supabase.from("pf_game_devlog").insert(payload).select().single();
  if (error) err(error);
  return { id: num(data!.id), game_id: num(data!.game_id), content: data!.content, created_at: data!.created_at };
};

export const deleteGameDevlogEntry = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_game_devlog").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// ROADMAP
// ═══════════════════════════════════════════════════════════════════════════

export const getRoadmapItems = async (planId: number): Promise<RoadmapItem[]> => {
  const { data, error } = await supabase
    .from("pf_roadmap_items").select("*").eq("plan_id", planId).order("sort_order");
  if (error) err(error);
  return (data ?? []).map(mapRoadmapItem);
};

export const createRoadmapItem = async (payload: { plan_id: number; title: string; description?: string | null; due_date?: string | null }): Promise<RoadmapItem> => {
  const { data, error } = await supabase.from("pf_roadmap_items").insert(payload).select().single();
  if (error) err(error);
  return mapRoadmapItem(data!);
};

export const updateRoadmapItem = async (id: number, payload: { title: string; description?: string | null; due_date?: string | null; status: string }): Promise<RoadmapItem> => {
  const { data, error } = await supabase.from("pf_roadmap_items").update(payload).eq("id", id).select().single();
  if (error) err(error);
  return mapRoadmapItem(data!);
};

export const deleteRoadmapItem = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_roadmap_items").delete().eq("id", id);
  if (error) err(error);
};

export const setRoadmapItemStatus = async (id: number, status: string): Promise<RoadmapItem> => {
  const { data, error } = await supabase.from("pf_roadmap_items").update({ status }).eq("id", id).select().single();
  if (error) err(error);
  return mapRoadmapItem(data!);
};
