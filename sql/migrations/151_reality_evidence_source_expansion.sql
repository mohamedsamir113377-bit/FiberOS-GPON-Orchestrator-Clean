-- 151_reality_evidence_source_expansion.sql
-- Expands the reality catalog without claiming runtime adapter connectivity.
BEGIN;
INSERT INTO reality_source_catalog(source_key,label,authority_class,capabilities,network_families,requires_external_connection,requires_instrument_provenance,authoritative_numeric,proof_only,description) VALUES
('nms_otdr_read_only','Read-only remote OTDR trace','observed',ARRAY['otdr_trace'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber'],true,false,false,false,'Buyer-authorized remote OTDR evidence; adapter connectivity remains unverified.'),
('nms_radio_telemetry','Read-only wireless radio telemetry','observed',ARRAY['radio_signal_numeric'],ARRAY['wireless_backhaul'],true,false,true,false,'Buyer-authorized wireless telemetry; no optical assumptions.'),
('field_radio_meter','Field radio measurement','measured',ARRAY['radio_signal_numeric','radio_signal_field_proof'],ARRAY['wireless_backhaul'],false,true,true,false,'Measured wireless signal with instrument provenance.'),
('field_installation_photo','Installation/site acceptance photo','unverified',ARRAY['installation_acceptance','site_identity','gps_presence','physical_condition'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul'],false,false,false,true,'Visual/GPS proof only; never numeric authority.'),
('recorded_measurement','Persisted measurement record','derived',ARRAY['commercial_support'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown'],false,false,false,false,'Existing measurement record reused as commercial support; not a new measurement.'),
('invoice_document','Invoice/supporting commercial document','unverified',ARRAY['commercial_support','site_identity'],ARRAY['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber','wireless_backhaul','unknown'],false,false,false,true,'Documentary support only; not operational truth.'),
('field_radio_photo','Technician radio-screen photo','unverified',ARRAY['radio_signal_field_proof','site_identity','gps_presence','physical_condition'],ARRAY['wireless_backhaul'],false,false,false,true,'Visual radio proof only; not parsed telemetry.')
ON CONFLICT(source_key) DO NOTHING;
COMMIT;
