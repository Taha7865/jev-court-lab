import type {Clip,Frame,Role,Setup} from './court';
export type PossessionEstimate={handler:number|null;confidence:number;source:'ball_proximity'|'recent_ball_track'|'unknown'};

function directPossession(frame:Frame,aspect:number):PossessionEstimate{
  const players=frame.tracks.filter(t=>t.kind==='player');
  const candidates:{id:number;score:number;confidence:number}[]=[];
  for(const ball of frame.tracks.filter(t=>t.kind==='ball')){
    const bx=ball.box[0]+ball.box[2]/2,by=ball.box[1]+ball.box[3]/2;
    const ranked=players.map(p=>{
      const [x,y,w,h]=p.box;
      const height=h*aspect;
      const outside=Math.hypot(Math.max(x-bx,0,bx-x-w),Math.max(y-by,0,by-y-h)*aspect)/(height||1);
      const center=Math.hypot(bx-x-w/2,(by-y-h*.56)*aspect)/(height||1);
      return {id:p.id,score:outside*2+center*.35,outside};
    }).filter(p=>p.outside<.3).sort((a,b)=>a.score-b.score);
    if(!ranked.length||ranked[0].score>.53)continue;
    const gap=ranked.length>1?ranked[1].score-ranked[0].score:1;
    if(gap<.065)continue;
    candidates.push({id:ranked[0].id,score:ranked[0].score,confidence:Math.min(.96,.52+Math.min(.25,ball.confidence*.3)+Math.min(.2,gap))});
  }
  candidates.sort((a,b)=>b.confidence-a.confidence);
  if(candidates.length>1&&candidates[0].id!==candidates[1].id&&candidates[0].confidence-candidates[1].confidence<.1)return {handler:null,confidence:0,source:'unknown'};
  return candidates.length?{handler:candidates[0].id,confidence:candidates[0].confidence,source:'ball_proximity'}:{handler:null,confidence:0,source:'unknown'};
}
export function estimatePossession(clip:Clip,frame:Frame):PossessionEstimate{
  const direct=directPossession(frame,clip.height/clip.width);if(direct.handler!==null)return direct;
  // Use only past evidence, and stop carrying possession after half a second.
  // A visible unassociated ball may be a pass or shot, so do not carry through it.
  if(frame.tracks.some(t=>t.kind==='ball'))return direct;
  for(const prior of clip.frames.filter(f=>f.time<frame.time&&frame.time-f.time<=.5).reverse()){
    const estimate=directPossession(prior,clip.height/clip.width);
    if(estimate.handler!==null&&frame.tracks.some(t=>t.kind==='player'&&t.id===estimate.handler))return {...estimate,confidence:estimate.confidence*(1-(frame.time-prior.time)*.5),source:'recent_ball_track'};
    if(prior.tracks.some(t=>t.kind==='ball'))break;
  }
  return direct;
}
const colorDistance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
export function estimateRoles(frame:Frame,handler:number|null):Record<number,Role>{
  const players=frame.tracks.filter(t=>t.kind==='player'&&t.jersey);
  const h=players.find(t=>t.id===handler);if(!h?.jersey)return handler===null?{}:{[handler]:'offense'};
  let seeds:[number[],number[]]=[h.jersey,h.jersey];let widest=0;
  for(const a of players)for(const b of players){const d=colorDistance(a.jersey!,b.jersey!);if(d>widest){widest=d;seeds=[a.jersey!,b.jersey!]}}
  if(widest<.32)return {[h.id]:'offense'};
  let centers=seeds;
  for(let iteration=0;iteration<6;iteration++){
    const groups=centers.map(()=>[] as number[][]);
    for(const p of players)groups[colorDistance(p.jersey!,centers[0])<=colorDistance(p.jersey!,centers[1])?0:1].push(p.jersey!);
    centers=groups.map((g,i)=>g.length?[0,1,2].map(c=>g.reduce((s,p)=>s+p[c],0)/g.length):centers[i]) as [number[],number[]];
  }
  const handlerGroup=colorDistance(h.jersey,centers[0])<=colorDistance(h.jersey,centers[1])?0:1;
  const roles:Record<number,Role>={[h.id]:'offense'};
  for(const p of players){const d=centers.map(c=>colorDistance(p.jersey!,c));const group=d[0]<=d[1]?0:1;if(Math.abs(d[0]-d[1])>.12&&d[group]<.55)roles[p.id]=group===handlerGroup?'offense':'defense';}
  return roles;
}
export function automaticSetup(clip:Clip,frame:Frame):Setup{
  const possession=estimatePossession(clip,frame);
  return {handler:possession.handler,handlerSource:possession.source==='unknown'?'ball_proximity':possession.source,handlerConfidence:possession.confidence,roles:estimateRoles(frame,possession.handler),rolesSource:'jersey_color',basket:frame.basket??null};
}
export function resolveSetup(clip:Clip,frame:Frame,manual:Setup,markerTime:number|null,correctionTime?:number|null):Setup{
  if(clip.sample)return manual;
  const auto=automaticSetup(clip,frame);
  if(correctionTime!==undefined&&correctionTime!==frame.time)manual={handler:null,roles:{},basket:null};
  const manualHandler=manual.handler!==null&&frame.tracks.some(t=>t.kind==='player'&&t.id===manual.handler);
  const handler=manualHandler?manual.handler:auto.handler;
  return {...auto,handler,handlerSource:manualHandler?(manual.handlerSource??'user_confirmed'):auto.handlerSource,handlerConfidence:manualHandler?(manual.handlerConfidence??1):auto.handlerConfidence,roles:{...estimateRoles(frame,handler),...manual.roles,...(handler!==null?{[handler]:'offense' as const}:{})},rolesSource:Object.keys(manual.roles).length?(manual.rolesSource??'mixed'):'jersey_color',basket:markerTime===frame.time&&manual.basket?manual.basket:auto.basket};
}
export function firstDecisionFrame(clip:Clip):Frame|undefined{
  return clip.frames.find(f=>estimatePossession(clip,f).handler!==null)??clip.frames.find(f=>f.tracks.some(t=>t.kind==='player'))??clip.frames[0];
}
