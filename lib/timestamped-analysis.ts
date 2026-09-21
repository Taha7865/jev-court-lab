import type {Decision} from './court';
import type {DecisionSnapshot} from './live-decisions';

type Cached={snapshot:DecisionSnapshot;decision:Decision};
export type TimestampedAnalysisOptions={
  run:(snapshot:DecisionSnapshot,context:DecisionSnapshot[],signal:AbortSignal)=>Promise<Decision>;
  onResult:(item:Cached)=>void;
  onError:(error:unknown)=>void;
  intervalSeconds?:number;
};

/**
 * Causal, timestamp-ordered precomputation. A seek reads this cache; it never
 * changes the queue. State changes bypass the normal 250 ms sampling interval.
 */
export class TimestampedAnalysisQueue {
  private readonly cache=new Map<number,Cached>();private readonly history:DecisionSnapshot[]=[];
  private lastQueued=-Infinity;private lastSignature='';private generation=0;private tail=Promise.resolve();
  private readonly options:TimestampedAnalysisOptions;
  constructor(options:TimestampedAnalysisOptions){this.options=options;}
  enqueue(snapshot:DecisionSnapshot){
    const time=snapshot.state.time_seconds,signature=JSON.stringify({handler:snapshot.state.ball_handler,ball:snapshot.state.ball_detected,quality:snapshot.state.quality.unassigned_players,source:snapshot.state.handler_source});
    if(time<=this.lastQueued||this.cache.has(time))return;
    const important=signature!==this.lastSignature,interval=this.options.intervalSeconds??.25;
    if(!important&&time-this.lastQueued<interval)return;
    this.lastQueued=time;this.lastSignature=signature;const generation=this.generation;const context=this.history.filter(item=>time-item.state.time_seconds<=1).slice(-4);
    this.history.push(snapshot);if(this.history.length>20)this.history.shift();
    this.tail=this.tail.then(async()=>{const controller=new AbortController();try{const decision=await this.options.run(snapshot,context,controller.signal);if(generation!==this.generation)return;const item={snapshot,decision};this.cache.set(time,item);this.options.onResult(item);}catch(error){if(generation===this.generation)this.options.onError(error);}});
  }
  /** Exact frame timestamps make pause/scrub lookup deterministic and causal. */
  get(time:number){return this.cache.get(time);}
  invalidate(){this.generation++;}
  whenIdle(){return this.tail;}
}
