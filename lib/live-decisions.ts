import type {Action,CourtState,Decision,Setup} from './court';
export type DecisionSnapshot={state:CourtState;setup:Setup};
export type DecisionEvent=DecisionSnapshot&{id:string;decision:Decision;observed?:Action};
export const snapshotKey=(snapshot:DecisionSnapshot)=>JSON.stringify(snapshot.state);

type LiveQueueOptions={
    run:(snapshot:DecisionSnapshot,signal:AbortSignal)=>Promise<Decision>;
    onResult:(snapshot:DecisionSnapshot,decision:Decision)=>void;
    onBusy:(busy:boolean)=>void;
    onError:(error:unknown)=>void;
    intervalMs?:number;
    now?:()=>number;
    schedule?:typeof setTimeout;
    cancel?:typeof clearTimeout;
};

/** Single-flight inference: queued intermediate frames are replaced by the latest state. */
export class LiveDecisionQueue {
  private target:DecisionSnapshot|null=null;
  private active:{controller:AbortController;generation:number}|null=null;
  private completed=new Set<string>();
  private timer:ReturnType<typeof setTimeout>|null=null;
  private lastStart=-Infinity;
  private generation=0;
  private failed=false;
  private disposed=false;
  private options:LiveQueueOptions;
  constructor(options:LiveQueueOptions){this.options=options;}
  enqueue(snapshot:DecisionSnapshot|null){
    if(this.disposed)return;
    this.target=snapshot;
    if(!snapshot&&this.timer){(this.options.cancel??clearTimeout)(this.timer);this.timer=null;}
    this.pump();
  }
  remember(snapshot:DecisionSnapshot){this.completed.add(snapshotKey(snapshot));}
  invalidate(){
    this.generation++;this.active?.controller.abort();this.active=null;this.target=null;
    if(this.timer)(this.options.cancel??clearTimeout)(this.timer);
    this.timer=null;this.options.onBusy(false);
  }
  retry(){this.failed=false;this.pump();}
  dispose(){this.disposed=true;this.invalidate();}
  private pump(){
    if(this.disposed||this.failed||this.active||this.timer||!this.target)return;
    const snapshot=this.target,key=snapshotKey(snapshot);
    if(this.completed.has(key))return;
    const now=(this.options.now??Date.now)();
    const wait=(this.options.intervalMs??500)-(now-this.lastStart);
    if(wait>0){this.timer=(this.options.schedule??setTimeout)(()=>{this.timer=null;this.pump()},wait);return;}
    const active={controller:new AbortController(),generation:this.generation};this.active=active;this.lastStart=now;this.options.onBusy(true);
    void Promise.resolve().then(()=>this.options.run(snapshot,active.controller.signal)).then(decision=>{
      if(active.generation!==this.generation||this.disposed)return;
      this.completed.add(key);this.options.onResult(snapshot,decision);
    }).catch(error=>{
      if(active.generation!==this.generation||this.disposed)return;
      this.failed=true;this.options.onError(error);
    }).finally(()=>{
      if(this.active!==active)return;
      this.active=null;this.options.onBusy(false);this.pump();
    });
  }
}

/** Never show a future, different-handler, or stale result as the current decision. */
export function visibleDecision(events:DecisionEvent[],snapshot:DecisionSnapshot|null,playing:boolean,maxAge=1.5):DecisionEvent|undefined{
  if(!snapshot)return;
  const current=snapshot.state,key=snapshotKey(snapshot);
  return events.filter(e=>{
    const age=current.time_seconds-e.state.time_seconds;
    if(e.state.source!==current.source||e.state.ball_handler!==current.ball_handler||age<0)return false;
    if(age===0)return snapshotKey(e)===key;
    return playing&&age<=maxAge;
  }).sort((a,b)=>b.state.time_seconds-a.state.time_seconds)[0];
}
