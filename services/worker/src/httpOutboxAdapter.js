'use strict';

const crypto=require('node:crypto');

function createHttpAdapter(env=process.env){
  const url=String(env.OUTBOX_DELIVERY_URL||'').trim();
  if(!url)throw new Error('OUTBOX_DELIVERY_URL_REQUIRED');
  let parsed;
  try{parsed=new URL(url);}catch(_){throw new Error('OUTBOX_DELIVERY_URL_INVALID');}
  if(parsed.protocol!=='https:' && String(env.NODE_ENV||'').toLowerCase()==='production')throw new Error('OUTBOX_DELIVERY_URL_HTTPS_REQUIRED');
  const secret=String(env.OUTBOX_DELIVERY_SECRET||'').trim();
  if(!secret && String(env.NODE_ENV||'').toLowerCase()==='production')throw new Error('OUTBOX_DELIVERY_SECRET_REQUIRED');

  return Object.freeze({
    async deliver(event,context={}){
      const body=JSON.stringify({event,context:{workerId:context.workerId||null,attempt:context.attempt||null,idempotencyKey:context.idempotencyKey||event.event_id}});
      const timestamp=String(Date.now());
      const signature=secret?crypto.createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex'):null;
      const headers={'content-type':'application/json','x-fiberos-event-id':String(event.event_id),'x-fiberos-idempotency-key':String(context.idempotencyKey||event.event_id),'x-fiberos-timestamp':timestamp};
      if(signature)headers['x-fiberos-signature']='sha256='+signature;
      const response=await fetch(parsed,{method:'POST',headers,body,signal:AbortSignal.timeout(Number(env.OUTBOX_DELIVERY_TIMEOUT_MS||10000)),redirect:'error'});
      if(!response.ok)throw new Error('OUTBOX_DELIVERY_HTTP_'+response.status);
      let payload={};
      try{payload=await response.json();}catch(_){}
      return {delivered:true,status:response.status,provider:payload.provider||'http'};
    }
  });
}

module.exports={createHttpAdapter};
