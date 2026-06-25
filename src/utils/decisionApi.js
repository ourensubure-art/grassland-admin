import { supabase } from "../lib/supabase.js";

const DECISIONS_TABLE = "grazing_decisions";
const FEEDBACK_TABLE = "decision_feedback";

export async function fetchDecisions({ admin = false } = {}) {
  let query = supabase
    .from(DECISIONS_TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (!admin) {
    query = query.eq("status", "published");
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchDecisionCounts() {
  const [draftResult, publishedResult] = await Promise.all([
    supabase
      .from(DECISIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("status", "draft"),
    supabase
      .from(DECISIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
  ]);

  if (draftResult.error) throw draftResult.error;
  if (publishedResult.error) throw publishedResult.error;
  return {
    draft: draftResult.count || 0,
    published: publishedResult.count || 0
  };
}

export async function fetchDecisionDetail(id) {
  const { data, error } = await supabase
    .from(DECISIONS_TABLE)
    .select(`
      *,
      decision_feedback (
        id,
        decision_id,
        feedback_type,
        message,
        photo_urls,
        created_by,
        created_at
      )
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    decision_feedback: [...(data.decision_feedback || [])].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    )
  };
}

export async function submitDecisionFeedback({ decisionId, feedbackType, message, photoUrls = [], createdBy }) {
  const { data, error } = await supabase
    .from(FEEDBACK_TABLE)
    .insert({
      decision_id: decisionId,
      feedback_type: feedbackType,
      message,
      photo_urls: photoUrls,
      created_by: createdBy
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function createOrUpdateDecisionDraft({ draft, createdBy }) {
  const payload = {
    pasture_id: draft.pasture_id,
    decision_type: draft.decision_type,
    severity: draft.severity,
    start_date: draft.start_date,
    end_date: draft.end_date,
    duration_days: draft.duration_days,
    ndvi_current: draft.ndvi_current,
    ndvi_predicted: draft.ndvi_predicted,
    ndvi_threshold_p25: draft.ndvi_threshold_p25,
    ndvi_threshold_p50: draft.ndvi_threshold_p50,
    local_grade: draft.local_grade,
    trend: draft.trend,
    overload_rate: draft.overload_rate,
    biomass_agb: draft.biomass_agb,
    confidence: draft.confidence,
    title: draft.title,
    reason_summary: draft.reason_summary,
    reason_for_herder: draft.reason_for_herder,
    reason_technical: draft.reason_technical,
    recommended_actions: draft.recommended_actions,
    status: "draft",
    published_by: null,
    published_at: null
  };

  const { data: existing, error: existingError } = await supabase
    .from(DECISIONS_TABLE)
    .select("id")
    .eq("pasture_id", draft.pasture_id)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingError) throw existingError;

  if (existing && existing.length > 0) {
    const { data, error } = await supabase
      .from(DECISIONS_TABLE)
      .update(payload)
      .eq("id", existing[0].id)
      .select("*")
      .single();

    if (error) throw error;
    return { action: "updated", decision: data };
  }

  const { data, error } = await supabase
    .from(DECISIONS_TABLE)
    .insert({
      ...payload,
      published_by: createdBy || null
    })
    .select("*")
    .single();

  if (error) throw error;
  return { action: "inserted", decision: data };
}

export async function publishDecision({ decisionId, publishedBy }) {
  const { data, error } = await supabase
    .from(DECISIONS_TABLE)
    .update({
      status: "published",
      published_by: publishedBy,
      published_at: new Date().toISOString()
    })
    .eq("id", decisionId)
    .eq("status", "draft")
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
