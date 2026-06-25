-- 决策发布模块：创建放牧决策表与反馈表
-- 注意：本迁移只新增 grazing_decisions / decision_feedback，不改动现有业务表和视图。

create table if not exists public.grazing_decisions (
  id bigserial primary key,
  pasture_id text not null,
  decision_type text check (decision_type in ('rest', 'graze', 'reduce', 'resume')),
  severity text check (severity in ('info', 'warning', 'critical')) default 'info',
  start_date date not null,
  end_date date,
  duration_days int,

  -- 决策时的数据快照
  ndvi_current numeric(5,3),
  ndvi_predicted numeric(5,3),
  ndvi_threshold_p25 numeric(5,3),
  ndvi_threshold_p50 numeric(5,3),
  local_grade text,
  trend text,
  overload_rate numeric(5,2),
  biomass_agb int,
  confidence numeric(5,2),

  -- 给牧民看的内容
  title text not null,
  reason_summary text,
  reason_for_herder text,
  reason_technical text,
  recommended_actions jsonb default '[]'::jsonb,

  -- 状态追踪
  status text check (status in ('draft', 'published', 'acknowledged', 'executing', 'completed', 'cancelled')) default 'draft',
  published_by text,
  published_at timestamptz,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.decision_feedback (
  id bigserial primary key,
  decision_id bigint references public.grazing_decisions(id) on delete cascade,
  feedback_type text check (feedback_type in ('acknowledge', 'question', 'progress', 'completion')),
  message text,
  photo_urls text[],
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_grazing_decisions_pasture_status
  on public.grazing_decisions (pasture_id, status);

create index if not exists idx_grazing_decisions_published_at
  on public.grazing_decisions (published_at desc);

create index if not exists idx_decision_feedback_decision_created_at
  on public.decision_feedback (decision_id, created_at desc);

-- 自动维护 grazing_decisions.updated_at，仅作用于新表。
create or replace function public.set_grazing_decisions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_grazing_decisions_updated_at on public.grazing_decisions;

create trigger trg_grazing_decisions_updated_at
before update on public.grazing_decisions
for each row
execute function public.set_grazing_decisions_updated_at();

alter table public.grazing_decisions enable row level security;
alter table public.decision_feedback enable row level security;

-- RLS：匿名用户可读，便于牧民端/决策端用 anon key 展示已发布内容。
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'grazing_decisions'
      and policyname = 'anon_can_read_grazing_decisions'
  ) then
    create policy anon_can_read_grazing_decisions
      on public.grazing_decisions
      for select
      to anon
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'decision_feedback'
      and policyname = 'anon_can_read_decision_feedback'
  ) then
    create policy anon_can_read_decision_feedback
      on public.decision_feedback
      for select
      to anon
      using (true);
  end if;
end $$;

-- RLS：认证用户可写，后续登录后的管理端可发布/更新决策。
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'grazing_decisions'
      and policyname = 'authenticated_can_insert_grazing_decisions'
  ) then
    create policy authenticated_can_insert_grazing_decisions
      on public.grazing_decisions
      for insert
      to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'grazing_decisions'
      and policyname = 'authenticated_can_update_grazing_decisions'
  ) then
    create policy authenticated_can_update_grazing_decisions
      on public.grazing_decisions
      for update
      to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'grazing_decisions'
      and policyname = 'authenticated_can_delete_grazing_decisions'
  ) then
    create policy authenticated_can_delete_grazing_decisions
      on public.grazing_decisions
      for delete
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'decision_feedback'
      and policyname = 'authenticated_can_insert_decision_feedback'
  ) then
    create policy authenticated_can_insert_decision_feedback
      on public.decision_feedback
      for insert
      to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'decision_feedback'
      and policyname = 'authenticated_can_update_decision_feedback'
  ) then
    create policy authenticated_can_update_decision_feedback
      on public.decision_feedback
      for update
      to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'decision_feedback'
      and policyname = 'authenticated_can_delete_decision_feedback'
  ) then
    create policy authenticated_can_delete_decision_feedback
      on public.decision_feedback
      for delete
      to authenticated
      using (true);
  end if;
end $$;
