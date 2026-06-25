export interface Decision {
  id: string;
  pasture_id: string;
  status: "draft" | "published";
  title: string;
  reason?: string | null;
  risk_level?: "high" | "medium" | "low" | null;
  ndvi_current?: number | null;
  ndvi_forecast?: number | null;
  local_level?: string | null;
  trend?: string | null;
  confidence?: number | null;
  rest_days?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  published_at?: string | null;
  created_by?: string | null;
}
