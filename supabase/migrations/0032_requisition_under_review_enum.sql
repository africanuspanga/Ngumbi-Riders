-- =========================================================================
-- 0032_requisition_under_review_enum.sql — add 'under_review' to
-- requisition_status (client feedback 2026-09-11 #14).
--
-- SPLIT DELIBERATELY FROM 0033, for the reason 0024 was split from 0025:
-- Postgres refuses to USE a new enum label in the same transaction that added
-- it, and 0033 is a single transaction that touches the requisition guards.
-- Keeping the label alone means 0033 can be replayed safely without an
-- "unsafe use of new value of enum type" error the day someone adds a
-- predicate that mentions it.
--
-- Additive and backfill-free: every existing requisition keeps its status.
-- =========================================================================

alter type public.requisition_status add value if not exists 'under_review';
