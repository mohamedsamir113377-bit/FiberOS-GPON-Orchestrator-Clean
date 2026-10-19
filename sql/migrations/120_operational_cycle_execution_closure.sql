-- 120_operational_cycle_execution_closure.sql
BEGIN;

ALTER TABLE public.sync_operations ADD COLUMN IF NOT EXISTS actor_sub text;
ALTER TABLE public.sync_operations ADD COLUMN IF NOT EXISTS actor_role text;
CREATE INDEX IF NOT EXISTS idx_sync_pending_actor ON public.sync_operations(status,actor_sub,actor_role,created_at);
DROP POLICY IF EXISTS sync_owner_processor ON public.sync_operations;
CREATE POLICY sync_owner_processor ON public.sync_operations FOR ALL TO fiberos_owner USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fiberos_transition_ticket(p_ticket_id uuid,p_to text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auth AS $$
DECLARE
 v_tenant uuid; v_role text; v_actor uuid; v_from text; v_to text:=replace(lower(trim(p_to)),'-','_'); v_allowed boolean:=false;
BEGIN
 v_tenant:=fiberos_current_tenant_id(); v_actor:=auth.uid(); v_role:=auth.jwt()->'app_metadata'->>'role';
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED'; END IF;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'VERIFIED_PRINCIPAL_REQUIRED'; END IF;
 IF v_role IS NULL OR v_role='' THEN RAISE EXCEPTION 'ROLE_REQUIRED_FOR_TRANSITION'; END IF;
 IF p_ticket_id IS NULL OR v_to IS NULL OR v_to='' THEN RAISE EXCEPTION 'TRANSITION_INPUT_REQUIRED'; END IF;
 SELECT status INTO v_from FROM tickets WHERE id=p_ticket_id AND tenant_id=v_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_NOT_FOUND'; END IF;
 IF v_role IN ('field_tech','technician') AND NOT EXISTS(
   SELECT 1 FROM tickets t JOIN technicians tech ON tech.id=t.technician_id
   WHERE t.id=p_ticket_id AND tech.user_id=v_actor AND tech.tenant_id=v_tenant AND tech.is_active=true
 ) THEN RAISE EXCEPTION 'TECHNICIAN_MUTATION_SCOPE_REQUIRED'; END IF;
 v_allowed:=CASE
 WHEN v_from='pending' AND v_to='in_progress' AND v_role IN('field_tech','technician','dispatcher','ops_manager','sysadmin') THEN true
 WHEN v_from='pending' AND v_to='cancelled' AND v_role IN('dispatcher','ops_manager','sysadmin','area_supervisor') THEN true
 WHEN v_from='pending' AND v_to='rejected' AND v_role IN('qc','ops_manager','sysadmin','area_supervisor') THEN true
 WHEN v_from='in_progress' AND v_to='awaiting_evidence' AND v_role IN('field_tech','technician','ops_manager','sysadmin') THEN true
 WHEN v_from='in_progress' AND v_to='faulty' AND v_role IN('field_tech','technician','qc','ops_manager','sysadmin') THEN true
 WHEN v_from='in_progress' AND v_to='cancelled' AND v_role IN('dispatcher','ops_manager','sysadmin','area_supervisor') THEN true
 WHEN v_from='in_progress' AND v_to='manager_review' AND v_role IN('field_tech','technician','qc','ops_manager','sysadmin') THEN true
 WHEN v_from='awaiting_evidence' AND v_to IN('manager_review','in_progress','faulty') AND v_role IN('field_tech','technician','qc','ops_manager','sysadmin') THEN true
 WHEN v_from='awaiting_evidence' AND v_to='cancelled' AND v_role IN('ops_manager','sysadmin','area_supervisor') THEN true
 WHEN v_from='manager_review' AND v_to='pending_signature' AND v_role IN('ops_manager','qc','sysadmin','area_supervisor') THEN true
 WHEN v_from='manager_review' AND v_to IN('completed','rejected','in_progress') AND v_role IN('ops_manager','qc','sysadmin','area_supervisor') THEN true
 WHEN v_from='pending_signature' AND v_to IN('completed','manager_review','rejected') AND v_role IN('ops_manager','qc','sysadmin','area_supervisor') THEN true
 WHEN v_from='compensating' AND v_to IN('in_progress','manager_review') AND v_role IN('ops_manager','qc','sysadmin','area_supervisor') THEN true
 WHEN v_from='compensating' AND v_to='cancelled' AND v_role IN('ops_manager','sysadmin','area_supervisor') THEN true
 WHEN v_from='faulty' AND v_to='in_progress' AND v_role IN('field_tech','technician','dispatcher','ops_manager','sysadmin','area_supervisor') THEN true
 WHEN v_from='faulty' AND v_to='cancelled' AND v_role IN('ops_manager','sysadmin','area_supervisor') THEN true
 WHEN v_from='rejected' AND v_to='in_progress' AND v_role IN('ops_manager','qc','sysadmin','area_supervisor') THEN true
 ELSE false END;
 IF NOT v_allowed THEN RAISE EXCEPTION 'TRANSITION_REJECTED'; END IF;
 PERFORM set_config('fiberos.lifecycle_transition','allowed',true);
 UPDATE tickets SET status=v_to,updated_at=now(),
 first_assigned_at=CASE WHEN v_to='in_progress' AND first_assigned_at IS NULL THEN now() ELSE first_assigned_at END,
 closed_at=CASE WHEN v_to IN('completed','cancelled','rejected','faulty') AND closed_at IS NULL THEN now()
 WHEN v_to IN('in_progress','awaiting_evidence','manager_review','pending_signature','compensating') THEN NULL ELSE closed_at END
 WHERE id=p_ticket_id AND tenant_id=v_tenant AND status=v_from;
 IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_NOT_UPDATED'; END IF;
 RETURN jsonb_build_object('ticket_id',p_ticket_id,'from',v_from,'to',v_to,'tenant_id',v_tenant,'role',v_role);
END $$;
REVOKE ALL ON FUNCTION public.fiberos_transition_ticket(uuid,text) FROM public,anon,authenticated,fiberos_app;
GRANT EXECUTE ON FUNCTION public.fiberos_transition_ticket(uuid,text) TO fiberos_app;

CREATE OR REPLACE FUNCTION public.fiberos_ingest_sync_batch(p_ops jsonb,p_principal jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
-- p_principal is retained only for RPC signature compatibility; identity and role are
-- always derived from the verified database session and never from caller JSON.
DECLARE op jsonb; tenant uuid; existing sync_operations%ROWTYPE; inserted int:=0; duplicate int:=0; conflict int:=0; rejected int:=0; out_arr jsonb:='[]'::jsonb; v_hash text;
BEGIN
 SELECT tenant_id INTO tenant FROM user_preferences WHERE user_id=auth.uid() LIMIT 1;
 IF tenant IS NULL THEN RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED'; END IF;
 IF jsonb_typeof(p_ops)<>'array' THEN RAISE EXCEPTION 'SYNC_BATCH_MUST_BE_ARRAY'; END IF;
 FOR op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
  BEGIN
   IF coalesce(op->>'operationId','')='' OR coalesce(op->>'clientId','')='' OR coalesce(op->>'type','')='' THEN RAISE EXCEPTION 'SYNC_OPERATION_IDENTITY_REQUIRED'; END IF;
   v_hash:=lower(coalesce(op->>'requestHash',''));
   IF v_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'SYNC_REQUEST_HASH_INVALID'; END IF;
   SELECT * INTO existing FROM sync_operations WHERE tenant_id=tenant AND client_id=op->>'clientId' AND operation_id=op->>'operationId' FOR UPDATE;
   IF FOUND THEN
    IF existing.request_hash<>v_hash THEN conflict:=conflict+1; out_arr:=out_arr||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','status','CONFLICT','error','OPERATION_ID_REUSED_WITH_DIFFERENT_HASH'));
    ELSE duplicate:=duplicate+1; out_arr:=out_arr||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','status',existing.status,'replayed',true)); END IF;
    CONTINUE;
   END IF;
   INSERT INTO sync_operations(tenant_id,actor_sub,actor_role,client_id,operation_id,operation_type,aggregate_type,aggregate_id,base_version,payload,request_hash,status)
   VALUES(tenant,auth.uid()::text,coalesce(nullif(auth.jwt()->'app_metadata'->>'role',''),'field_tech'),op->>'clientId',op->>'operationId',op->>'type',op->>'aggregateType',op->>'aggregateId',nullif(op->>'baseVersion','')::bigint,coalesce(op->'payload','{}'::jsonb),v_hash,'PENDING');
   inserted:=inserted+1; out_arr:=out_arr||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','status','PENDING'));
  EXCEPTION WHEN unique_violation THEN rejected:=rejected+1; out_arr:=out_arr||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','status','REJECTED','error','SYNC_UNIQUE_CONSTRAINT'));
  WHEN others THEN rejected:=rejected+1; out_arr:=out_arr||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','status','REJECTED','error',SQLSTATE));
  END;
 END LOOP;
 RETURN jsonb_build_object('inserted',inserted,'duplicate',duplicate,'conflict',conflict,'rejected',rejected,'operations',out_arr);
END $$;

CREATE OR REPLACE FUNCTION public.fiberos_process_sync_batch(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auth AS $$
DECLARE row sync_operations%ROWTYPE; done int:=0; rejected int:=0; conflicts int:=0; results jsonb:='[]'::jsonb; v_to text; v_ticket uuid; v_transition jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'SYNC_LIMIT_INVALID'; END IF;
 FOR row IN SELECT * FROM sync_operations WHERE status='PENDING' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit LOOP
  BEGIN
   IF row.actor_sub IS NULL OR row.actor_sub !~* '^[0-9a-f-]{36}$' THEN
    UPDATE sync_operations SET status='REJECTED',rejection_code='SYNC_ACTOR_ID_INVALID',rejection_detail='The persisted operation actor is not a UUID-backed identity',processed_at=now() WHERE id=row.id;
    rejected:=rejected+1; CONTINUE;
   END IF;
   PERFORM set_config('request.jwt.claim.sub',row.actor_sub,true);
   PERFORM set_config('request.jwt.claim.role','authenticated',true);
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',row.actor_sub,'role','authenticated','app_metadata',jsonb_build_object('role',coalesce(row.actor_role,'field_tech')))::text,true);
   IF fiberos_current_tenant_id() IS DISTINCT FROM row.tenant_id THEN
    UPDATE sync_operations SET status='CONFLICT',rejection_code='SYNC_TENANT_CONTEXT_MISMATCH',rejection_detail='Stored actor no longer resolves to the operation tenant' WHERE id=row.id;
    conflicts:=conflicts+1; CONTINUE;
   END IF;
   UPDATE sync_operations SET status='SENDING' WHERE id=row.id;
   IF row.operation_type IN('ticket.transition','ticket_transition') THEN
    v_ticket:=NULLIF(row.aggregate_id,'')::uuid; v_to:=coalesce(row.payload->>'toStatus',row.payload->>'to');
    IF v_ticket IS NULL OR v_to IS NULL OR v_to='' THEN RAISE EXCEPTION 'SYNC_TICKET_TRANSITION_INPUT_REQUIRED'; END IF;
    v_transition:=fiberos_transition_ticket(v_ticket,v_to);
    UPDATE sync_operations SET status='ACKED',server_version=extract(epoch from clock_timestamp())::bigint,processed_at=now(),rejection_code=null,rejection_detail=null WHERE id=row.id;
    done:=done+1; results:=results||jsonb_build_array(jsonb_build_object('operationId',row.operation_id,'status','ACKED','transition',v_transition));
   ELSE
    UPDATE sync_operations SET status='REJECTED',rejection_code='UNSUPPORTED_OPERATION_TYPE',rejection_detail='No authoritative server executor is registered for this operation type',processed_at=now() WHERE id=row.id;
    rejected:=rejected+1; results:=results||jsonb_build_array(jsonb_build_object('operationId',row.operation_id,'status','REJECTED','error','UNSUPPORTED_OPERATION_TYPE'));
   END IF;
  EXCEPTION WHEN others THEN
   IF SQLSTATE IN('40001','40P01') THEN UPDATE sync_operations SET status='CONFLICT',rejection_code=SQLSTATE,rejection_detail='RETRYABLE_DATABASE_CONFLICT' WHERE id=row.id; conflicts:=conflicts+1;
   ELSE UPDATE sync_operations SET status='REJECTED',rejection_code=SQLSTATE,rejection_detail='AUTHORITATIVE_SYNC_EXECUTION_FAILED',processed_at=now() WHERE id=row.id; rejected:=rejected+1; END IF;
  END;
 END LOOP;
 RETURN jsonb_build_object('processed',done,'rejected',rejected,'conflicts',conflicts,'results',results);
END $$;
REVOKE ALL ON FUNCTION public.fiberos_process_sync_batch(integer) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiberos_process_sync_batch(integer) TO fiberos_worker;
COMMENT ON FUNCTION public.fiberos_process_sync_batch(integer) IS 'Executes only registered authoritative offline operations; unsupported types are explicitly rejected.';
COMMIT;
