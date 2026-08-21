// The sidebar side-tools: quick notes, brain dump, events, deadlines, agreements.

import {
  err, mapDeadline, num, supabase, getUserId,
} from "./_shared";
import type {
  Agreement, BrainEntry, CalEvent, Deadline, QuickNote,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════
// REMINDERS
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// QUICK NOTES
// ═══════════════════════════════════════════════════════════════════════════

export const getQuickNotes = async (): Promise<QuickNote[]> => {
  const { data, error } = await supabase
    .from("pf_quick_notes").select("*").eq("user_id", getUserId()).order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), title: r.title, body: r.body, created_at: r.created_at }));
};

export const addQuickNote = async (title: string, body?: string | null): Promise<QuickNote> => {
  const { data, error } = await supabase
    .from("pf_quick_notes").insert({ user_id: getUserId(), title, body: body ?? null }).select().single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, body: data!.body, created_at: data!.created_at };
};

export const deleteQuickNote = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_quick_notes").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// BRAIN DUMP
// ═══════════════════════════════════════════════════════════════════════════

export const getBrainDump = async (): Promise<BrainEntry[]> => {
  const { data, error } = await supabase
    .from("pf_brain_dump").select("*").eq("user_id", getUserId()).order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), content: r.content, created_at: r.created_at }));
};

export const addBrainEntry = async (content: string): Promise<BrainEntry> => {
  const { data, error } = await supabase
    .from("pf_brain_dump").insert({ user_id: getUserId(), content }).select().single();
  if (error) err(error);
  return { id: num(data!.id), content: data!.content, created_at: data!.created_at };
};

export const deleteBrainEntry = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_brain_dump").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export const getEvents = async (): Promise<CalEvent[]> => {
  const { data, error } = await supabase
    .from("pf_events").select("*").eq("user_id", getUserId()).order("date");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), title: r.title, date: r.date, description: r.description, created_at: r.created_at }));
};

export const addEvent = async (title: string, date: string, description?: string | null): Promise<CalEvent> => {
  const { data, error } = await supabase
    .from("pf_events").insert({ user_id: getUserId(), title, date, description: description ?? null }).select().single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, date: data!.date, description: data!.description, created_at: data!.created_at };
};

export const deleteEvent = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_events").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// DEADLINES
// ═══════════════════════════════════════════════════════════════════════════

export const getDeadlines = async (): Promise<Deadline[]> => {
  const { data, error } = await supabase
    .from("pf_deadlines").select("*").eq("user_id", getUserId()).order("due_date");
  if (error) err(error);
  return (data ?? []).map(mapDeadline);
};

export const addDeadline = async (title: string, due_date: string): Promise<Deadline> => {
  const { data, error } = await supabase
    .from("pf_deadlines").insert({ user_id: getUserId(), title, due_date }).select().single();
  if (error) err(error);
  return mapDeadline(data!);
};

export const toggleDeadline = async (id: number): Promise<Deadline> => {
  const { data: cur } = await supabase.from("pf_deadlines").select("done").eq("id", id).single();
  const { data, error } = await supabase
    .from("pf_deadlines").update({ done: !cur!.done }).eq("id", id).select().single();
  if (error) err(error);
  return mapDeadline(data!);
};

export const deleteDeadline = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_deadlines").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// AGREEMENTS
// ═══════════════════════════════════════════════════════════════════════════

export const getAgreements = async (): Promise<Agreement[]> => {
  const { data, error } = await supabase
    .from("pf_agreements").select("*").eq("user_id", getUserId()).order("created_at");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), title: r.title, notes: r.notes, created_at: r.created_at }));
};

export const addAgreement = async (title: string, notes?: string | null): Promise<Agreement> => {
  const { data, error } = await supabase
    .from("pf_agreements").insert({ user_id: getUserId(), title, notes: notes ?? null }).select().single();
  if (error) err(error);
  return { id: num(data!.id), title: data!.title, notes: data!.notes, created_at: data!.created_at };
};

export const deleteAgreement = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_agreements").delete().eq("id", id);
  if (error) err(error);
};
