-- Add RLHF feedback columns to filtered_jobs
-- Run this once against your Neon DB if drizzle-kit push isn't available:
--   psql $DATABASE_URL -f drizzle/add_feedback_columns.sql

ALTER TABLE filtered_jobs
  ADD COLUMN IF NOT EXISTS user_feedback text,
  ADD COLUMN IF NOT EXISTS user_notes text,
  ADD COLUMN IF NOT EXISTS feedback_at timestamp;
