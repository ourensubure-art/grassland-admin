-- 决策发布模块示例数据
-- 注意：重复执行本文件不会重复插入同一 pasture_id + start_date + title 的样例。

insert into public.grazing_decisions (
  pasture_id,
  decision_type,
  severity,
  start_date,
  end_date,
  duration_days,
  ndvi_current,
  ndvi_predicted,
  ndvi_threshold_p25,
  ndvi_threshold_p50,
  local_grade,
  trend,
  overload_rate,
  biomass_agb,
  confidence,
  title,
  reason_summary,
  reason_for_herder,
  reason_technical,
  recommended_actions,
  status,
  published_by,
  published_at
)
select
  'pasture_001',
  'graze',
  'info',
  current_date,
  current_date + 7,
  7,
  0.263,
  0.278,
  0.217,
  0.262,
  '良',
  '上升',
  0.72,
  374,
  0.86,
  '草场状态良好，可继续适度放牧',
  '当前 NDVI 高于本地 P50，近期趋势稳定向好。',
  '本周草场长势较好，可以继续适度放牧。请控制放牧密度，避免集中踩踏低洼区域。',
  'NDVI 当前值 0.263，高于本地 P50 0.262，预测值 0.278，综合判断为可放牧。',
  '["控制放牧密度", "优先轮牧", "每日观察草高和裸地变化"]'::jsonb,
  'published',
  'system',
  now()
where not exists (
  select 1 from public.grazing_decisions
  where pasture_id = 'pasture_001'
    and start_date = current_date
    and title = '草场状态良好，可继续适度放牧'
);

insert into public.grazing_decisions (
  pasture_id,
  decision_type,
  severity,
  start_date,
  end_date,
  duration_days,
  ndvi_current,
  ndvi_predicted,
  ndvi_threshold_p25,
  ndvi_threshold_p50,
  local_grade,
  trend,
  overload_rate,
  biomass_agb,
  confidence,
  title,
  reason_summary,
  reason_for_herder,
  reason_technical,
  recommended_actions,
  status,
  published_by,
  published_at
)
select
  'pasture_001',
  'reduce',
  'warning',
  current_date + 8,
  current_date + 14,
  7,
  0.221,
  0.208,
  0.217,
  0.262,
  '中',
  '下降',
  1.28,
  285,
  0.78,
  '草场压力偏高，建议降低放牧强度',
  '当前 NDVI 接近本地 P25，且承载压力偏高。',
  '下周建议减少进入该区域的羊单位数量，优先转移到草势更好的区域。',
  'NDVI 当前值 0.221，接近本地 P25 0.217，超载率 1.28，建议减畜或缩短放牧时间。',
  '["减少放牧羊单位", "缩短每日放牧时长", "3天后复查草情"]'::jsonb,
  'draft',
  'system',
  null
where not exists (
  select 1 from public.grazing_decisions
  where pasture_id = 'pasture_001'
    and start_date = current_date + 8
    and title = '草场压力偏高，建议降低放牧强度'
);

insert into public.grazing_decisions (
  pasture_id,
  decision_type,
  severity,
  start_date,
  end_date,
  duration_days,
  ndvi_current,
  ndvi_predicted,
  ndvi_threshold_p25,
  ndvi_threshold_p50,
  local_grade,
  trend,
  overload_rate,
  biomass_agb,
  confidence,
  title,
  reason_summary,
  reason_for_herder,
  reason_technical,
  recommended_actions,
  status,
  published_by,
  published_at
)
select
  'pasture_001',
  'rest',
  'critical',
  current_date + 15,
  current_date + 28,
  14,
  0.168,
  0.154,
  0.217,
  0.262,
  '差',
  '下降',
  1.62,
  172,
  0.82,
  '草场恢复不足，建议临时休牧',
  'NDVI 低于本地 P25，预测仍有下降风险。',
  '该区域草场恢复不足，建议暂停放牧两周，让草地恢复。确需放牧时请先联系合作社确认。',
  'NDVI 当前值 0.168，低于本地 P25 0.217，预测值 0.154，超载率 1.62，建议休牧。',
  '["暂停放牧14天", "设置临时围栏", "休牧期结束后重新评估"]'::jsonb,
  'draft',
  'system',
  null
where not exists (
  select 1 from public.grazing_decisions
  where pasture_id = 'pasture_001'
    and start_date = current_date + 15
    and title = '草场恢复不足，建议临时休牧'
);
