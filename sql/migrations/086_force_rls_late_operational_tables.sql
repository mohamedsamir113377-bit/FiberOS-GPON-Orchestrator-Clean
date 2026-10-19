-- 086: Force RLS on operational tables created by migration 057.
-- Ordered after their creation; no table existence assumption is made earlier.
ALTER TABLE payment_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_cycles FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_cycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_cycle_events FORCE ROW LEVEL SECURITY;
ALTER TABLE rework_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE rework_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_case_events FORCE ROW LEVEL SECURITY;
