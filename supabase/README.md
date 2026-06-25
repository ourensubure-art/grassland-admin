# 决策发布数据库说明

本目录只用于准备 Supabase SQL。请在 Supabase 后台手动执行，不需要本地连接数据库。

## 执行顺序

1. 打开 Supabase 项目后台。
2. 进入左侧 `SQL Editor`。
3. 新建 Query，复制并执行：
   `supabase/migrations/001_create_grazing_decisions.sql`
4. 确认执行成功后，再新建 Query，复制并执行：
   `supabase/seeds/001_seed_decisions.sql`
5. 执行验证 SQL，确认新表和示例数据存在。

请不要在这一步修改 `observations`、`ndvi_weekly`、`v_latest_ndvi`、`v_pasture_quantiles`。

## 表字段说明

### grazing_decisions

用于保存管理端发布给牧民端或合作社的放牧决策。

- `id`：决策主键，自增。
- `pasture_id`：牧场编号，当前与现有 NDVI 数据对齐为 `pasture_001`。
- `decision_type`：决策类型，可选 `rest`、`graze`、`reduce`、`resume`。
- `severity`：严重程度，可选 `info`、`warning`、`critical`。
- `start_date`：决策开始日期。
- `end_date`：决策结束日期。
- `duration_days`：持续天数。
- `ndvi_current`：发布决策时的当前 NDVI。
- `ndvi_predicted`：发布决策时的预测 NDVI。
- `ndvi_threshold_p25`：本地历史 P25 阈值快照。
- `ndvi_threshold_p50`：本地历史 P50 阈值快照。
- `local_grade`：本地化健康等级，如 `优`、`良`、`中`、`差`。
- `trend`：趋势判断，如 `上升`、`稳定`、`下降`。
- `overload_rate`：超载率或承载压力比值。
- `biomass_agb`：估算地上生物量，单位 kg/ha。
- `confidence`：决策置信度，建议存 0-1 之间的小数。
- `title`：决策标题，面向管理端和牧民端展示。
- `reason_summary`：简短原因摘要。
- `reason_for_herder`：给牧民看的解释。
- `reason_technical`：技术原因，供管理端查看。
- `recommended_actions`：推荐动作列表，jsonb 数组。
- `status`：状态，可选 `draft`、`published`、`acknowledged`、`executing`、`completed`、`cancelled`。
- `published_by`：发布人。
- `published_at`：发布时间。
- `acknowledged_at`：牧民确认时间。
- `completed_at`：完成时间。
- `created_at`：创建时间。
- `updated_at`：更新时间，更新记录时自动刷新。

### decision_feedback

用于保存牧民端或合作社对某条决策的确认、问题、执行进度和完成反馈。

- `id`：反馈主键，自增。
- `decision_id`：关联的 `grazing_decisions.id`，决策删除时级联删除反馈。
- `feedback_type`：反馈类型，可选 `acknowledge`、`question`、`progress`、`completion`。
- `message`：反馈文字。
- `photo_urls`：反馈图片 URL 数组。
- `created_by`：反馈人。
- `created_at`：反馈创建时间。

## RLS 策略

两张表都启用了 RLS：

- `anon` 可以读取，方便前端使用 publishable/anon key 展示已发布内容。
- `authenticated` 可以新增、更新、删除，后续接入登录后用于管理端发布和维护决策。

## 验证建表成功

在 Supabase SQL Editor 执行：

```sql
select
  d.id,
  d.pasture_id,
  d.decision_type,
  d.severity,
  d.status,
  d.title,
  d.start_date,
  d.end_date,
  d.published_at,
  count(f.id) as feedback_count
from public.grazing_decisions d
left join public.decision_feedback f on f.decision_id = d.id
group by d.id
order by d.created_at desc;
```

如果 seed 已执行，应该能看到 3 条 `pasture_001` 示例决策。

也可以检查表是否存在：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('grazing_decisions', 'decision_feedback')
order by table_name;
```
