import { env } from 'cloudflare:workers';
import { stateSchema, parseDecision, type CourtState } from '../../../lib/court';
import {DECISION_POLICY_VERSION,questionWithContext} from '../../../lib/decision-policy';
const headers={'Cache-Control':'no-store'};
export async function GET(){return Response.json({configured:Boolean((env as Record<string,unknown>).OPENROUTER_API_KEY),model:'~typesafe/jev-latest',policy_version:DECISION_POLICY_VERSION},{headers});}
export async function POST(req:Request){
  const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return Response.json({error:'Cross-origin requests are not allowed.'},{status:403,headers});
  if(!req.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Expected structured JSON court state.'},{status:415,headers});
  try{
    const reader=req.body?.getReader();if(!reader)throw Error('Missing state');let bytes=0;const chunks:Uint8Array[]=[];
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>48000){await reader.cancel();return Response.json({error:'Court state is too large.'},{status:413,headers});}chunks.push(value);}
    const merged=new Uint8Array(bytes);let off=0;for(const c of chunks){merged.set(c,off);off+=c.length;}
    const raw=new TextDecoder().decode(merged);let jobs:{state:CourtState;context:CourtState[]}[];try{const payload=JSON.parse(raw);const supplied=Array.isArray(payload?.items)?payload.items:(Array.isArray(payload?.states)?payload.states:[payload]).map((state:unknown)=>({state,context:[]}));jobs=supplied.map((item:unknown)=>{const value=item as {state?:unknown;context?:unknown};const state=stateSchema.parse(value.state??item);const context=Array.isArray(value.context)?value.context.map((previous:unknown)=>stateSchema.parse(previous)):[];return {state,context};});if(!jobs.length||jobs.length>12)throw Error('Invalid batch size');}catch{return Response.json({error:'Invalid court state batch. Confirm a visible ball handler and review your tracks.'},{status:400,headers});}
    const key=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||(env as Record<string,string>).OPENROUTER_API_KEY;
    if(!key)return Response.json({error:'Connect an OpenRouter API key to evaluate with Jev.'},{status:401,headers});
    const decisions=[];for(const {state,context} of jobs){const start=Date.now();const response=await fetch('https://openrouter.ai/api/alpha/decisions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','X-Title':'JEV Court Lab'},body:JSON.stringify({model:'~typesafe/jev-latest',state,questions:{decision:questionWithContext(state,context)}}),signal:AbortSignal.timeout(25000)});
      if(!response.ok){const message=response.status===401?'OpenRouter rejected this API key. Check your connection.':response.status===402?'This OpenRouter account needs credits to use Jev.':response.status===429?'OpenRouter is busy. Wait a moment and try again.':`Jev is unavailable (OpenRouter ${response.status}). Try again shortly.`;return Response.json({error:message},{status:response.status>=500?502:response.status,headers});}
      decisions.push({...parseDecision(await response.json()),latency_ms:Date.now()-start,policy_version:DECISION_POLICY_VERSION});}
    return Response.json({decisions},{headers});
  }catch(error){return Response.json({error:error instanceof Error&&error.name==='TimeoutError'?'Jev timed out. Please try again.':'Jev did not return a valid decision. Please try again.'},{status:502,headers});}
}
