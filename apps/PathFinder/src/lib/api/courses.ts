// Study: course assignments, pipelines and course books.

import {
  err, mapBookSection, mapCourseAssignment, mapCourseBook, mapPipelineStep, num, supabase,
} from "./_shared";
import type {
  BookSection, CaSubtask, CourseAssignment, CourseBook, PipelineRun, PipelineRunStep, PipelineStep, PipelineStepSubtask, PipelineTemplate,
} from "../../types";

// ═══════════════════════════════════════════════════════════════════════════
// COURSE ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════════════════

type CAPayload = {
  plan_id: number; title: string; assignment_type: string; due_date?: string | null;
  status: string; priority: string; book_title?: string | null;
  chapter_start?: string | null; chapter_end?: string | null;
  page_start?: number | null; page_end?: number | null; page_current?: number | null;
  notes?: string | null; start_time?: string | null; end_time?: string | null;
  time_estimate?: number | null;
};

export const getCourseAssignments = async (): Promise<CourseAssignment[]> => {
  const { data, error } = await supabase
    .from("pf_course_assignments").select("*, pf_plans(title)").order("created_at", { ascending: false });
  if (error) err(error);
  return (data ?? []).map(mapCourseAssignment);
};

export const createCourseAssignment = async (payload: CAPayload): Promise<CourseAssignment> => {
  const { data, error } = await supabase
    .from("pf_course_assignments").insert(payload).select("*, pf_plans(title)").single();
  if (error) err(error);
  return mapCourseAssignment(data!);
};

export const updateCourseAssignment = async (id: number, payload: CAPayload): Promise<CourseAssignment> => {
  const { data, error } = await supabase
    .from("pf_course_assignments").update(payload).eq("id", id).select("*, pf_plans(title)").single();
  if (error) err(error);
  return mapCourseAssignment(data!);
};

export const deleteCourseAssignment = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_course_assignments").delete().eq("id", id);
  if (error) err(error);
};

// ─── CA subtasks ────────────────────────────────────────────────────────────

export const getCaSubtasks = async (assignmentId: number): Promise<CaSubtask[]> => {
  const { data, error } = await supabase
    .from("pf_ca_subtasks").select("*").eq("assignment_id", assignmentId).order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), assignment_id: num(r.assignment_id), title: r.title, done: r.done, sort_order: r.sort_order }));
};

export const addCaSubtask = async (assignmentId: number, title: string): Promise<CaSubtask> => {
  const { data, error } = await supabase
    .from("pf_ca_subtasks").insert({ assignment_id: assignmentId, title }).select().single();
  if (error) err(error);
  return { id: num(data!.id), assignment_id: num(data!.assignment_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const toggleCaSubtask = async (id: number): Promise<CaSubtask> => {
  const { data: cur } = await supabase.from("pf_ca_subtasks").select("done").eq("id", id).single();
  const { data, error } = await supabase
    .from("pf_ca_subtasks").update({ done: !cur!.done }).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), assignment_id: num(data!.assignment_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const deleteCaSubtask = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_ca_subtasks").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINES
// ═══════════════════════════════════════════════════════════════════════════

type PipelineStepInput = {
  id?: number | null; title: string; description?: string | null;
  sort_order: number; time_estimate?: number | null;
  step_type?: string | null; attend_type?: string | null;
};

async function fetchPipelineRuns(templateId: number): Promise<PipelineRun[]> {
  const { data: runs, error } = await supabase
    .from("pf_pipeline_runs").select("*").eq("template_id", templateId).order("sort_order");
  if (error) err(error);
  if (!runs?.length) return [];

  const { data: steps } = await supabase
    .from("pf_pipeline_steps").select("*").eq("template_id", templateId).order("sort_order");

  const runIds = runs.map((r) => num(r.id));
  const { data: runSteps } = await supabase
    .from("pf_pipeline_run_steps").select("*").in("run_id", runIds);

  return runs.map((run): PipelineRun => ({
    id: num(run.id), template_id: num(run.template_id),
    title: run.title, notes: run.notes,
    scheduled_date: run.scheduled_date, sort_order: run.sort_order, created_at: run.created_at,
    steps: (steps ?? []).map((step): PipelineRunStep => {
      const rs = (runSteps ?? []).find(
        (x) => num(x.run_id) === num(run.id) && num(x.step_id) === num(step.id)
      );
      return {
        step_id: num(step.id), step_title: step.title,
        step_sort_order: step.sort_order, step_type: step.step_type,
        done: rs?.done ?? false, done_at: rs?.done_at ?? null,
        notes: rs?.notes ?? null, due_date: rs?.due_date ?? null,
        chapter_ref: rs?.chapter_ref ?? null,
        page_start: rs?.page_start ?? null, page_end: rs?.page_end ?? null,
        start_time: rs?.start_time ?? null, end_time: rs?.end_time ?? null,
        location: rs?.location ?? null, time_estimate: rs?.time_estimate ?? null,
        assignment_id: rs?.assignment_id ? num(rs.assignment_id) : null,
        due_date_2: rs?.due_date_2 ?? null,
      };
    }),
  }));
}

export const getPipelineTemplates = async (planId: number): Promise<PipelineTemplate[]> => {
  const { data: templates, error } = await supabase
    .from("pf_pipeline_templates").select("*").eq("plan_id", planId).order("created_at");
  if (error) err(error);
  if (!templates?.length) return [];

  const templateIds = templates.map((t) => num(t.id));
  const [{ data: steps }, { data: runs }, { data: runSteps }] = await Promise.all([
    supabase.from("pf_pipeline_steps").select("*").in("template_id", templateIds).order("sort_order"),
    supabase.from("pf_pipeline_runs").select("id, template_id").in("template_id", templateIds),
    supabase.from("pf_pipeline_run_steps").select("run_id, done"),
  ]);

  return templates.map((t): PipelineTemplate => {
    const tSteps = (steps ?? []).filter((s) => num(s.template_id) === num(t.id));
    const tRuns  = (runs  ?? []).filter((r) => num(r.template_id) === num(t.id));
    const doneRunCount = tRuns.filter((run) => {
      const rs = (runSteps ?? []).filter((x) => num(x.run_id) === num(run.id));
      return rs.length > 0 && rs.every((x) => x.done);
    }).length;

    return {
      id: num(t.id), plan_id: num(t.plan_id), title: t.title,
      description: t.description, color: t.color, created_at: t.created_at,
      steps: tSteps.map(mapPipelineStep),
      run_count: tRuns.length, done_run_count: doneRunCount,
    };
  });
};

export const createPipelineTemplate = async (payload: {
  plan_id: number; title: string; description?: string | null; color?: string;
}): Promise<PipelineTemplate> => {
  const { data, error } = await supabase
    .from("pf_pipeline_templates").insert(payload).select().single();
  if (error) err(error);
  return { id: num(data!.id), plan_id: num(data!.plan_id), title: data!.title, description: data!.description, color: data!.color, created_at: data!.created_at, steps: [], run_count: 0, done_run_count: 0 };
};

export const updatePipelineTemplate = async (id: number, payload: { title: string; description?: string | null; color: string }): Promise<PipelineTemplate> => {
  const { data, error } = await supabase
    .from("pf_pipeline_templates").update(payload).eq("id", id).select().single();
  if (error) err(error);
  const [full] = await getPipelineTemplates(num(data!.plan_id));
  return full;
};

export const deletePipelineTemplate = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_pipeline_templates").delete().eq("id", id);
  if (error) err(error);
};

export const upsertPipelineSteps = async (templateId: number, steps: PipelineStepInput[]): Promise<PipelineStep[]> => {
  const { data: existing } = await supabase
    .from("pf_pipeline_steps").select("id").eq("template_id", templateId);
  const existingIds = new Set((existing ?? []).map((s) => num(s.id)));
  const keepIds     = new Set(steps.filter((s) => s.id).map((s) => s.id!));
  const toDelete    = [...existingIds].filter((id) => !keepIds.has(id));

  if (toDelete.length > 0) {
    await supabase.from("pf_pipeline_steps").delete().in("id", toDelete);
  }

  for (const step of steps) {
    const row = {
      title: step.title, description: step.description ?? null,
      sort_order: step.sort_order, time_estimate: step.time_estimate ?? null,
      step_type: step.step_type ?? "generic", attend_type: step.attend_type ?? null,
    };
    if (step.id) {
      await supabase.from("pf_pipeline_steps").update(row).eq("id", step.id);
    } else {
      await supabase.from("pf_pipeline_steps").insert({ template_id: templateId, ...row });
    }
  }

  const { data } = await supabase
    .from("pf_pipeline_steps").select("*").eq("template_id", templateId).order("sort_order");
  return (data ?? []).map(mapPipelineStep);
};

export const getPipelineRuns = async (templateId: number): Promise<PipelineRun[]> => {
  return fetchPipelineRuns(templateId);
};

export const createPipelineRun = async (payload: {
  template_id: number; title: string; notes?: string | null; scheduled_date?: string | null;
}): Promise<PipelineRun> => {
  const { data: run, error } = await supabase
    .from("pf_pipeline_runs").insert(payload).select().single();
  if (error) err(error);

  // Auto-initialise run_steps; attend steps get scheduled_date pre-filled
  const { data: steps } = await supabase
    .from("pf_pipeline_steps").select("id, step_type, attend_type, title")
    .eq("template_id", payload.template_id);
  if (steps?.length) {
    await supabase.from("pf_pipeline_run_steps").insert(
      steps.map((s) => ({
        run_id:   num(run!.id),
        step_id:  num(s.id),
        ...(s.step_type === "attend" && payload.scheduled_date
          ? { due_date: payload.scheduled_date }
          : {}),
      }))
    );
  }

  // If a date was provided, immediately create the course_assignment for attend steps
  if (payload.scheduled_date && steps?.length) {
    const attendSteps = steps.filter((s) => s.step_type === "attend");
    if (attendSteps.length) {
      const { data: tmpl } = await supabase
        .from("pf_pipeline_templates").select("plan_id").eq("id", payload.template_id).single();
      if (tmpl?.plan_id) {
        const planId = num(tmpl.plan_id);
        for (const s of attendSteps) {
          const title = `${payload.title}${s.title ? ` — ${s.title}` : ""}`;
          const { data: newAsg } = await supabase
            .from("pf_course_assignments")
            .insert({
              plan_id:         planId,
              title,
              assignment_type: s.attend_type ?? "lecture",
              due_date:        payload.scheduled_date,
              status:          "pending",
              priority:        "medium",
            })
            .select("id").single();
          if (newAsg) {
            await supabase.from("pf_pipeline_run_steps")
              .update({ assignment_id: num(newAsg.id) })
              .eq("run_id", num(run!.id))
              .eq("step_id", num(s.id));
          }
        }
      }
    }
  }

  const runs = await fetchPipelineRuns(payload.template_id);
  return runs.find((r) => r.id === num(run!.id))!;
};

export const updatePipelineRun = async (id: number, payload: { title: string; notes?: string | null; scheduled_date?: string | null }): Promise<PipelineRun> => {
  const { data, error } = await supabase
    .from("pf_pipeline_runs").update(payload).eq("id", id).select().single();
  if (error) err(error);
  const runs = await fetchPipelineRuns(num(data!.template_id));
  return runs.find((r) => r.id === id)!;
};

export const deletePipelineRun = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_pipeline_runs").delete().eq("id", id);
  if (error) err(error);
};

export const togglePipelineRunStep = async (runId: number, stepId: number): Promise<PipelineRun> => {
  const { data: existing } = await supabase
    .from("pf_pipeline_run_steps").select("done").eq("run_id", runId).eq("step_id", stepId).maybeSingle();

  if (existing) {
    const nowDone = !existing.done;
    await supabase.from("pf_pipeline_run_steps")
      .update({ done: nowDone, done_at: nowDone ? new Date().toISOString() : null })
      .eq("run_id", runId).eq("step_id", stepId);
  } else {
    await supabase.from("pf_pipeline_run_steps")
      .insert({ run_id: runId, step_id: stepId, done: true, done_at: new Date().toISOString() });
  }

  const { data: run } = await supabase.from("pf_pipeline_runs").select("template_id").eq("id", runId).single();
  const runs = await fetchPipelineRuns(num(run!.template_id));
  return runs.find((r) => r.id === runId)!;
};

export const updatePipelineRunStep = async (
  runId: number, stepId: number,
  payload: { notes: string | null; due_date: string | null; due_date_2: string | null; chapter_ref: string | null; page_start: number | null; page_end: number | null; start_time: string | null; end_time: string | null; location: string | null; time_estimate: number | null },
): Promise<PipelineRun> => {
  await supabase.from("pf_pipeline_run_steps").update(payload).eq("run_id", runId).eq("step_id", stepId);

  // ── Sync attend steps → pf_course_assignments for weekly overview ──────────
  // Only "attend" type steps (lectures, theory sessions, labs) need a calendar
  // entry. Read the step definition and the run's plan context in parallel.
  const [{ data: stepRow }, { data: runRow }] = await Promise.all([
    supabase.from("pf_pipeline_steps")
      .select("step_type, attend_type, title, template_id")
      .eq("id", stepId)
      .single(),
    supabase.from("pf_pipeline_runs")
      .select("title, template_id")
      .eq("id", runId)
      .single(),
  ]);

  if (stepRow?.step_type === "attend" && runRow) {
    // Fetch plan_id from the template and existing assignment_id in parallel.
    const [{ data: templateRow }, { data: rsRow }] = await Promise.all([
      supabase.from("pf_pipeline_templates")
        .select("plan_id")
        .eq("id", runRow.template_id)
        .single(),
      supabase.from("pf_pipeline_run_steps")
        .select("assignment_id")
        .eq("run_id", runId)
        .eq("step_id", stepId)
        .single(),
    ]);

    const planId         = templateRow?.plan_id ? num(templateRow.plan_id) : null;
    const existingAsgId  = rsRow?.assignment_id ? num(rsRow.assignment_id) : null;

    if (planId) {
      const assignmentType = stepRow.attend_type ?? "lecture";
      const title          = `${runRow.title}${stepRow.title ? ` — ${stepRow.title}` : ""}`;

      if (existingAsgId) {
        // Update the already-linked course assignment's schedule fields.
        await supabase.from("pf_course_assignments").update({
          due_date:   payload.due_date,
          start_time: payload.start_time,
          end_time:   payload.end_time,
        }).eq("id", existingAsgId);
      } else if (payload.due_date) {
        // Create a new course assignment and store the back-link.
        const { data: newAsg } = await supabase.from("pf_course_assignments")
          .insert({
            plan_id:         planId,
            title,
            assignment_type: assignmentType,
            due_date:        payload.due_date,
            start_time:      payload.start_time,
            end_time:        payload.end_time,
            status:          "pending",
            priority:        "medium",
          })
          .select("id")
          .single();

        if (newAsg) {
          await supabase.from("pf_pipeline_run_steps")
            .update({ assignment_id: num(newAsg.id) })
            .eq("run_id", runId)
            .eq("step_id", stepId);
        }
      }

      // Keep the run card's scheduled_date in sync with the attend step's date.
      await supabase.from("pf_pipeline_runs")
        .update({ scheduled_date: payload.due_date })
        .eq("id", runId);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const { data: run } = await supabase.from("pf_pipeline_runs").select("template_id").eq("id", runId).single();
  const runs = await fetchPipelineRuns(num(run!.template_id));
  return runs.find((r) => r.id === runId)!;
};

// ─── Pipeline step subtasks ──────────────────────────────────────────────────

export const getPipelineStepSubtasks = async (runId: number, stepId: number): Promise<PipelineStepSubtask[]> => {
  const { data, error } = await supabase
    .from("pf_pipeline_step_subtasks").select("*").eq("run_id", runId).eq("step_id", stepId).order("sort_order");
  if (error) err(error);
  return (data ?? []).map((r) => ({ id: num(r.id), run_id: num(r.run_id), step_id: num(r.step_id), title: r.title, done: r.done, sort_order: r.sort_order }));
};

export const addPipelineStepSubtask = async (runId: number, stepId: number, title: string): Promise<PipelineStepSubtask> => {
  const { data, error } = await supabase
    .from("pf_pipeline_step_subtasks").insert({ run_id: runId, step_id: stepId, title }).select().single();
  if (error) err(error);
  return { id: num(data!.id), run_id: num(data!.run_id), step_id: num(data!.step_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const togglePipelineStepSubtask = async (id: number): Promise<PipelineStepSubtask> => {
  const { data: cur } = await supabase.from("pf_pipeline_step_subtasks").select("done").eq("id", id).single();
  const { data, error } = await supabase
    .from("pf_pipeline_step_subtasks").update({ done: !cur!.done }).eq("id", id).select().single();
  if (error) err(error);
  return { id: num(data!.id), run_id: num(data!.run_id), step_id: num(data!.step_id), title: data!.title, done: data!.done, sort_order: data!.sort_order };
};

export const deletePipelineStepSubtask = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_pipeline_step_subtasks").delete().eq("id", id);
  if (error) err(error);
};

// ═══════════════════════════════════════════════════════════════════════════
// COURSE BOOKS
// ═══════════════════════════════════════════════════════════════════════════

type CreateCourseBookPayload = { plan_id: number; title: string; author?: string | null; total_pages?: number | null; total_chapters?: number | null; daily_pages_goal?: number; weekly_chapters_goal?: number };
type UpdateCourseBookPayload = { title: string; author?: string | null; total_pages?: number | null; total_chapters?: number | null; current_page: number; current_chapter: number; daily_pages_goal: number; weekly_chapters_goal: number };
type CreateBookReadingLogPayload = { book_id: number; date: string; pages_read: number; chapters_read: number; note?: string | null };
type BookSectionInput = { id?: number | null; title: string; kind: string; sort_order: number; page_start?: number | null; page_end?: number | null; due_date?: string | null; time_estimate?: number | null };

async function fetchCourseBook(id: number): Promise<CourseBook> {
  const { data, error } = await supabase
    .from("pf_course_books")
    .select("*, pf_book_sections(*), pf_book_reading_log(*)")
    .eq("id", id).single();
  if (error) err(error);
  return mapCourseBook(data!);
}

export const getCourseBooks = async (planId: number): Promise<CourseBook[]> => {
  const { data, error } = await supabase
    .from("pf_course_books")
    .select("*, pf_book_sections(*), pf_book_reading_log(*)")
    .eq("plan_id", planId).order("created_at");
  if (error) err(error);
  return (data ?? []).map(mapCourseBook);
};

export const createCourseBook = async (payload: CreateCourseBookPayload): Promise<CourseBook> => {
  const { data, error } = await supabase
    .from("pf_course_books").insert(payload).select().single();
  if (error) err(error);
  return fetchCourseBook(num(data!.id));
};

export const updateCourseBook = async (id: number, payload: UpdateCourseBookPayload): Promise<CourseBook> => {
  const { error } = await supabase.from("pf_course_books").update(payload).eq("id", id);
  if (error) err(error);
  return fetchCourseBook(id);
};

export const deleteCourseBook = async (id: number): Promise<void> => {
  const { error } = await supabase.from("pf_course_books").delete().eq("id", id);
  if (error) err(error);
};

export const addBookReadingLog = async (payload: CreateBookReadingLogPayload): Promise<CourseBook> => {
  const { error } = await supabase.from("pf_book_reading_log").insert(payload);
  if (error) err(error);
  return fetchCourseBook(payload.book_id);
};

export const deleteBookReadingLog = async (logId: number, bookId: number): Promise<CourseBook> => {
  const { error } = await supabase.from("pf_book_reading_log").delete().eq("id", logId);
  if (error) err(error);
  return fetchCourseBook(bookId);
};

export const upsertBookSections = async (bookId: number, sections: BookSectionInput[]): Promise<CourseBook> => {
  const { data: existing } = await supabase
    .from("pf_book_sections").select("id").eq("book_id", bookId);
  const existingIds = new Set((existing ?? []).map((s) => num(s.id)));
  const keepIds     = new Set(sections.filter((s) => s.id).map((s) => s.id!));
  const toDelete    = [...existingIds].filter((id) => !keepIds.has(id));

  if (toDelete.length > 0) {
    await supabase.from("pf_book_sections").delete().in("id", toDelete);
  }
  for (const s of sections) {
    const row = { title: s.title, kind: s.kind, sort_order: s.sort_order, page_start: s.page_start ?? null, page_end: s.page_end ?? null, due_date: s.due_date ?? null, time_estimate: s.time_estimate ?? null };
    if (s.id) {
      await supabase.from("pf_book_sections").update(row).eq("id", s.id);
    } else {
      await supabase.from("pf_book_sections").insert({ book_id: bookId, ...row });
    }
  }
  return fetchCourseBook(bookId);
};

export const toggleBookSection = async (bookId: number, sectionId: number): Promise<CourseBook> => {
  const { data: cur } = await supabase.from("pf_book_sections").select("done").eq("id", sectionId).single();
  const nowDone = !cur!.done;
  await supabase.from("pf_book_sections")
    .update({ done: nowDone, done_at: nowDone ? new Date().toISOString() : null })
    .eq("id", sectionId);
  return fetchCourseBook(bookId);
};

export const updateBookSection = async (sectionId: number, notes: string | null, dueDate: string | null): Promise<BookSection> => {
  const { data, error } = await supabase
    .from("pf_book_sections")
    .update({ notes, due_date: dueDate })
    .eq("id", sectionId).select().single();
  if (error) err(error);
  return mapBookSection(data!);
};
