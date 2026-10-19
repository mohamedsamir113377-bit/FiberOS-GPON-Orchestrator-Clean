-- R14.1 customer portal work-domain expansion.
-- Adds specialist commercial disciplines without inventing price or buyer-specific rules.
BEGIN;

INSERT INTO portal_work_type_catalog(code,display_name,discipline,summary,required_evidence,standards,feature_flags,sort_order)
VALUES
('survey-design','Survey / Design / Planning','engineering-design','Route survey, design package, bill-of-materials and planned-to-field reconciliation.',
 ARRAY['survey_identity','geometry','design_revision','evidence_reference'],
 '[{"ref":"ITU-T G.984.1","edition":"2008 Amd.2 04/2012","status":"in_force"},{"ref":"ITU-T G.9804.1","edition":"2019 Amd.3 05/2025","status":"in_force"},{"ref":"ITU-T G.9807.1","edition":"2023 Amd.1 05/2025","status":"in_force"}]'::jsonb,
 '{"survey":true,"designRevision":true,"bom":true,"gisReconciliation":true}'::jsonb,15),
('gpon-engineering','GPON Engineering','pon-engineering','GPON OLT/ODN planning, split architecture, port capacity and measured acceptance.',
 ARRAY['olt_identity','pon_port','splitter_identity','optical_budget','measurement'],
 '[{"ref":"ITU-T G.984.1","edition":"2008 Amd.2 04/2012","status":"in_force"}]'::jsonb,
 '{"gpon":true,"splitterPlanning":true,"opticalBudget":true,"capacity":true}'::jsonb,35),
('xgs-pon-engineering','XGS-PON Engineering','pon-engineering','XGS-PON OLT/ODN planning, capacity, coexistence and optical assurance.',
 ARRAY['olt_identity','pon_port','technology_identity','optical_budget','measurement'],
 '[{"ref":"ITU-T G.9807.1","edition":"2023 Amd.1 05/2025","status":"in_force"}]'::jsonb,
 '{"xgsPon":true,"coexistence":true,"opticalBudget":true,"capacity":true}'::jsonb,36),
('cable-deployment','Fiber Cable Deployment','outside-plant','Cable pulling/blowing/laying with route identity, reel traceability and as-built evidence.',
 ARRAY['route_identity','reel_identity','installation_event','gps','as_built_identity'],
 '[{"ref":"IEC 61280-4-2","edition":"2024","status":"current"},{"ref":"IEC 61280-4-3","edition":"2022","status":"current"}]'::jsonb,
 '{"reelTrace":true,"cableRoute":true,"asBuilt":true,"materialConservation":true}'::jsonb,55),
('drop-installation','Drop / Premises Installation','customer-installation','Drop cable, ONT/CPE installation, optical acceptance and customer handover evidence.',
 ARRAY['customer_order','drop_identity','ont_identity','optical_test','customer_acceptance'],
 '[{"ref":"ITU-T G.9804.1","edition":"2019 Amd.3 05/2025","status":"in_force"},{"ref":"IEC 61280-4-3","edition":"2022","status":"current"}]'::jsonb,
 '{"drop":true,"ont":true,"activation":true,"customerAcceptance":true}'::jsonb,65),
('commissioning-acceptance','Commissioning / Final Acceptance','acceptance','Controlled commissioning, punch-list closure and acceptance evidence pack.',
 ARRAY['asset_identity','test_results','quality_gates','punch_list','acceptance_certificate'],
 '[{"ref":"IEC 61280-4-2","edition":"2024","status":"current"},{"ref":"IEC 61280-4-3","edition":"2022","status":"current"}]'::jsonb,
 '{"commissioning":true,"acceptance":true,"punchList":true}'::jsonb,75),
('maintenance-fault','Maintenance / Fault Restoration','assurance-maintenance','Reactive and planned maintenance with service-impact trace, repair evidence and return-to-service.',
 ARRAY['incident_identity','service_path','repair_evidence','measurement','closure_evidence'],
 '[{"ref":"ITU-T G.9804.3","edition":"2021 Amd.3 02/2026","status":"in_force"},{"ref":"IEC 61280-4-2","edition":"2024","status":"current"}]'::jsonb,
 '{"faultRestoration":true,"serviceImpact":true,"opticalVerification":true}'::jsonb,85),
('warehouse-logistics','Warehouse / Logistics','supply-chain','Material reservation, issue, return and custody linked to field work packages.',
 ARRAY['material_identity','warehouse_transaction','work_package_link','actor_identity'],
 '[{"ref":"INTERNAL_CONTROL","edition":"buyer policy","status":"required"}]'::jsonb,
 '{"materialCustody":true,"reelLedger":true,"workPackageLink":true}'::jsonb,95)
ON CONFLICT(code) DO UPDATE SET
  display_name=excluded.display_name,
  discipline=excluded.discipline,
  summary=excluded.summary,
  required_evidence=excluded.required_evidence,
  standards=excluded.standards,
  feature_flags=excluded.feature_flags,
  active=true,
  sort_order=excluded.sort_order;

INSERT INTO portal_plan_catalog(code,work_type_code,billing_interval,display_name,summary,quote_required,published,active,feature_flags)
SELECT w.code||'-'||i.billing_interval,w.code,i.billing_interval,w.display_name||' — '||initcap(i.billing_interval),
       w.summary||' Frequency: '||i.billing_interval||'.',true,true,true,w.feature_flags
FROM portal_work_type_catalog w
CROSS JOIN (VALUES ('weekly'),('monthly'),('yearly')) AS i(billing_interval)
WHERE w.code IN (
  'survey-design','gpon-engineering','xgs-pon-engineering','cable-deployment',
  'drop-installation','commissioning-acceptance','maintenance-fault','warehouse-logistics'
)
ON CONFLICT(code) DO UPDATE SET
  work_type_code=excluded.work_type_code,
  billing_interval=excluded.billing_interval,
  display_name=excluded.display_name,
  summary=excluded.summary,
  feature_flags=excluded.feature_flags,
  published=true,
  active=true;

COMMIT;
