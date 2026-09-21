import {useEffect,useRef,useState} from 'react';
import type {Decision} from '@/lib/court';
import {LiveDecisionQueue,type DecisionEvent,type DecisionSnapshot} from '@/lib/live-decisions';

class ProviderError extends Error {status:number;constructor(message:string,status:number){super(message);this.status=status}}
export function useLiveJev({snapshot,clip,apiKey,configured,suspended,events,onResult,onRejectedKey}:{
  snapshot:DecisionSnapshot|null;clip:unknown;apiKey:string;configured:boolean;suspended:boolean;events:DecisionEvent[];
  onResult:(event:DecisionEvent)=>void;onRejectedKey:()=>void;
}){
  const [evaluating,setEvaluating]=useState(false),[streamError,setStreamError]=useState('');
  const queue=useRef<LiveDecisionQueue|null>(null);
  const [visible,setVisible]=useState(true),[revision,setRevision]=useState(0);
  const callbacks=useRef({onResult,onRejectedKey});callbacks.current={onResult,onRejectedKey};
  const saved=useRef(events);saved.current=events;
  useEffect(()=>{const update=()=>setVisible(!document.hidden);update();document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update)},[]);
  useEffect(()=>{
    if(!apiKey&&!configured)return;
    setStreamError('');
    const instance=new LiveDecisionQueue({
      async run(input,signal){
        const response=await fetch('/api/decision',{method:'POST',headers:{'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},body:JSON.stringify({states:[input.state]}),signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
        const result=await response.json() as {decisions?:Decision[];error?:string};
        if(!response.ok||!result.decisions?.[0])throw new ProviderError(result.error??'Jev is unavailable.',response.status);
        return result.decisions[0];
      },
      onResult:(input,decision)=>callbacks.current.onResult({...input,id:crypto.randomUUID(),decision}),
      onBusy:setEvaluating,
      onError(error){
        setStreamError(error instanceof Error?error.message:'Live analysis stopped. Try again.');
        if(error instanceof ProviderError&&error.status===401)callbacks.current.onRejectedKey();
      },
    });
    for(const event of saved.current)instance.remember(event);
    queue.current=instance;
    return()=>{instance.dispose();if(queue.current===instance)queue.current=null;};
  },[clip,apiKey,configured]);
  useEffect(()=>{queue.current?.enqueue(!suspended&&visible?snapshot:null)},[snapshot,suspended,visible,clip,apiKey,configured,revision]);
  return {evaluating,streamError,invalidate:()=>{queue.current?.invalidate();setRevision(n=>n+1)},retry:()=>{setStreamError('');queue.current?.retry();}};
}
