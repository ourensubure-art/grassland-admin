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
