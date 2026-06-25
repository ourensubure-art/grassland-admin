import { supabase } from "../lib/supabase.js";

const DECISIONS_TABLE = "decisions";

export async function fetchDecisions({ status = "published" } = {}) {
  const { data, error } = await supabase
    .from(DECISIONS_TABLE)
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false });

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

export async function createOrUpdateDecisionDraft({ draft }) {
  const payload = {
    pasture_id: draft.pasture_id,
    status: "draft",
    title: draft.title,
    reason: draft.reason,
    risk_level: draft.risk_level,
    ndvi_current: draft.ndvi_current,
    ndvi_forecast: draft.ndvi_forecast,
    local_level: draft.local_level,
    trend: draft.trend,
    confidence: draft.confidence,
    rest_days: draft.rest_days,
    start_date: draft.start_date,
    end_date: draft.end_date,
    published_at: null,
    created_by: draft.created_by || "decision_admin"
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
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return { action: "inserted", decision: data };
}

export async function publishDecision({ decisionId }) {
  const { data, error } = await supabase
    .from(DECISIONS_TABLE)
    .update({
      status: "published",
      published_at: new Date().toISOString()
    })
    .eq("id", decisionId)
    .eq("status", "draft")
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteDecisionDraft(decisionId) {
  const { error } = await supabase
    .from(DECISIONS_TABLE)
    .delete()
    .eq("id", decisionId)
    .eq("status", "draft");

  if (error) throw error;
}
