ALTER TABLE operations.scheduler_runs
  ADD COLUMN projection_cursors jsonb NOT NULL DEFAULT '{}'::jsonb;
