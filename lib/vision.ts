import {sceneChanged,BallEvidence} from './detection-geometry.ts';
import type { Clip, Frame, Track } from './court';
import {PersistentBallTracker} from './ball-tracking.ts';
export type Detection={box:[number,number,number,number];confidence:number;kind:'player'|'ball';jersey?:[number,number,number]};
export class Tracker {
  private next=1;
  private active: {track:Track;time:number}[]=[];
  reset(){this.active=[];}
  update(detections:Detection[],time:number):Track[]{
    this.active=this.active.filter(a=>time-a.time<=.8);
    const pairs:{i:number;j:number;cost:number}[]=[];
    this.active.forEach((a,i)=>detections.forEach((d,j)=>{if(a.track.kind!==d.kind)return;const dt=time-a.time;const b=a.track.box;const cx=b[0]+b[2]/2+a.track.vx*dt,cy=b[1]+b[3]/2+a.track.vy*dt;const distance=Math.hypot(cx-d.box[0]-d.box[2]/2,cy-d.box[1]-d.box[3]/2);const size=Math.abs(Math.log((d.box[2]*d.box[3]+1e-6)/(b[2]*b[3]+1e-6)));if(distance<Math.max(.065,Math.min(.17,b[3]*.7))&&size<1.1)pairs.push({i,j,cost:distance+.04*size+(a.track.jersey&&d.jersey?.length?Math.hypot(...a.track.jersey.map((v,k)=>v-d.jersey![k]))*.055:0)+(d.confidence<.25?.15:0)});}));
    pairs.sort((a,b)=>a.cost-b.cost);const usedA=new Set<number>(),usedD=new Set<number>();const matches=new Map<number,number>();
    for(const p of pairs){if(usedA.has(p.i)||usedD.has(p.j))continue;usedA.add(p.i);usedD.add(p.j);matches.set(p.j,p.i);}
    const out:Track[]=detections.flatMap((d,j)=>{
      const i=matches.get(j),old=i===undefined?undefined:this.active[i];
      if(d.kind==='player'&&d.confidence<.25&&!old)return [];
      const dt=old?time-old.time:0;
      const vx=old&&dt>0?((d.box[0]+d.box[2]/2)-(old.track.box[0]+old.track.box[2]/2))/dt:0;
      const vy=old&&dt>0?((d.box[1]+d.box[3])-(old.track.box[1]+old.track.box[3]))/dt:0;
      return [{...d,id:old?.track.id??this.next++,vx,vy}];
    });
    this.active=[...this.active.filter((_,i)=>!usedA.has(i)),...out.map(track=>({track,time}))];return out;
  }
}
export function deduplicate(detections:Detection[]):Detection[]{
  const kept:Detection[]=[];
  for(const d of [...detections].sort((a,b)=>b.confidence-a.confidence)){
    const [x,y,w,h]=d.box;
    const overlaps=kept.some(k=>{if(k.kind!==d.kind)return false;const [a,b,c,e]=k.box;const intersection=Math.max(0,Math.min(x+w,a+c)-Math.max(x,a))*Math.max(0,Math.min(y+h,b+e)-Math.max(y,b));return intersection/(w*h+c*e-intersection+1e-9)>.4||intersection/(Math.min(w*h,c*e)+1e-9)>.8;});
    if(!overlaps)kept.push(d);
  }
  return kept.slice(0,60);
}
let modelPromise:Promise<Awaited<ReturnType<typeof import('./yolo').loadYolo>>>|undefined;
async function detector(){if(!modelPromise)modelPromise=import('./yolo').then(y=>y.loadYolo()).catch(e=>{modelPromise=undefined;throw e});return modelPromise;}
export type VideoMetadata={duration:number;width:number;height:number};
export type IncrementalAnalysisOptions={
  /** Fires as soon as the file is decodable, before model loading or detection. */
  onReady:(metadata:VideoMetadata)=>void;
  /** Frames are ordered, timestamped and share one tracker across every batch. */
  onBatch:(frames:Frame[],analyzedThrough:number,metadata:VideoMetadata)=>void|Promise<void>;
  onProgress:(progress:number,message:string)=>void;
  batchSize?:number;
  getBallSeed?:()=>{time:number;x:number;y:number}|null;
};

/**
 * Decode and detect a local file in short, ordered batches. The Tracker and
 * BallEvidence intentionally live outside the batch loop so IDs and short
 * possession carries do not restart at a batch boundary.
 */
export async function analyzeVideoIncrementally(file:File,options:IncrementalAnalysisOptions,signal:AbortSignal):Promise<VideoMetadata>{
  const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';const url=URL.createObjectURL(file);v.src=url;
  const check=()=>{if(signal.aborted)throw new DOMException('Analysis cancelled','AbortError')};
  const wait=(event:string,timeout=15000)=>new Promise<void>((resolve,reject)=>{const done=()=>{clearTimeout(timer);v.removeEventListener(event,ok);v.removeEventListener('error',bad);signal.removeEventListener('abort',abort);};const ok=()=>{done();resolve()};const bad=()=>{done();reject(new Error('This video cannot be decoded. Try an H.264 MP4 or WebM clip.'))};const abort=()=>{done();reject(new DOMException('Analysis cancelled','AbortError'))};const timer=setTimeout(()=>{done();reject(new Error('Video decoding timed out. Try another clip.'))},timeout);v.addEventListener(event,ok,{once:true});v.addEventListener('error',bad,{once:true});signal.addEventListener('abort',abort,{once:true});});
  try{check();await wait('loadeddata');check();const duration=v.duration;
    if(!Number.isFinite(duration)||duration<=0||duration>86400)throw new Error('Choose a playable video with a duration below 24 hours.');
    if(!v.videoWidth||!v.videoHeight)throw new Error('Video dimensions are unavailable.');
    const metadata={duration,width:v.videoWidth,height:v.videoHeight};options.onReady(metadata);
    options.onProgress(0,'Loading the player & ball detector…');const model=await new Promise<Awaited<ReturnType<typeof detector>>>((resolve,reject)=>{const cancel=()=>{cleanup();reject(new DOMException('Analysis cancelled','AbortError'))};const timer=setTimeout(()=>{cleanup();reject(new Error('The detector could not load. Check your network and try again.'))},60000);const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel)};signal.addEventListener('abort',cancel,{once:true});detector().then(m=>{cleanup();resolve(m)},e=>{cleanup();reject(e)})});check();
    const c=document.createElement('canvas');c.width=Math.min(1600,v.videoWidth);c.height=Math.round(c.width*v.videoHeight/v.videoWidth);const ctx=c.getContext('2d',{willReadFrequently:true})!;const tracker=new Tracker();const ballEvidence=new BallEvidence();const possession=new PersistentBallTracker();const count=Math.ceil(duration*4),batch:Frame[]=[];
    const thumb=document.createElement('canvas');thumb.width=32;thumb.height=18;const thumbContext=thumb.getContext('2d',{willReadFrequently:true})!;let previous:Uint8ClampedArray|undefined;
    for(let i=0;i<count;i++){check();const t=i/4;if(Math.abs(v.currentTime-t)>.001){const ready=wait('seeked');v.currentTime=t;await ready;}check();ctx.drawImage(v,0,0,c.width,c.height);
      thumbContext.drawImage(c,0,0,32,18);const current=thumbContext.getImageData(0,0,32,18).data;const scene_cut=sceneChanged(previous,current);previous=current;if(scene_cut){tracker.reset();ballEvidence.reset();}
      const detection=await model.detect(c,signal);check();const selected=ballEvidence.select(deduplicate(detection.detections),t,c.height/c.width);const tracks=tracker.update(selected.detections,t);const seed=options.getBallSeed?.();if(seed&&Math.abs(seed.time-t)<=.26)possession.initializeAt(seed,tracks,t);if(scene_cut)possession.reset();batch.push({time:t,tracks,basket:detection.basket,scene_cut,ball_uncertain:selected.uncertain,...possession.update({time:t,tracks,scene_cut,ball_uncertain:selected.uncertain})});
      const complete=i+1;if(batch.length>=(options.batchSize??12)||complete===count){await options.onBatch(batch.splice(0),t,metadata);check();}
      options.onProgress(complete/count,`Detecting players and ball · ${Math.round(complete/count*100)}%`);await new Promise(r=>setTimeout(r,0));}
    return metadata;
  }finally{v.pause();v.removeAttribute('src');v.load();URL.revokeObjectURL(url);}
}

/** Backward-compatible one-shot helper for callers that need a complete clip. */
export async function analyzeVideo(file:File,onProgress:(progress:number,message:string)=>void,signal:AbortSignal):Promise<Clip>{
  const frames:Frame[]=[];let metadata:VideoMetadata|undefined;
  await analyzeVideoIncrementally(file,{onReady:m=>{metadata=m},onBatch:batch=>{frames.push(...batch)},onProgress},signal);
  if(!metadata)throw new Error('Video metadata was unavailable.');
  return {...metadata,frames,sample:false};
}
