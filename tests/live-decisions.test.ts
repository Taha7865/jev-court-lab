import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildState,sampleClip,sampleSetup,baseline,type Decision} from '../lib/court.ts';
import {LiveDecisionQueue,visibleDecision,type DecisionSnapshot,type DecisionEvent} from '../lib/live-decisions.ts';
const c=sampleClip();
const snapshot=(index=0):DecisionSnapshot=>({state:buildState(c,c.frames[index],sampleSetup)!,setup:sampleSetup});
const decision=(s:DecisionSnapshot):Decision=>({...baseline(s.state),source:'jev',model:'test-model'});
const event=(s:DecisionSnapshot):DecisionEvent=>({...s,id:String(s.state.time_seconds),decision:decision(s)});
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve!:(value:Decision)=>void;let reject!:(error:Error)=>void;const promise=new Promise<Decision>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};

test('live queue keeps playback input moving and coalesces to the newest state with one active request',async()=>{
  const requests:{snapshot:DecisionSnapshot;task:ReturnType<typeof deferred>}[]=[],received:number[]=[];
  const q=new LiveDecisionQueue({intervalMs:0,run:async snapshot=>{const task=deferred();requests.push({snapshot,task});return task.promise},onResult:s=>received.push(s.state.time_seconds),onBusy:()=>{},onError:()=>assert.fail('unexpected error')});
  q.enqueue(snapshot(0));await flush();q.enqueue(snapshot(1));q.enqueue(snapshot(2));q.enqueue(snapshot(3));assert.equal(requests.length,1);
  requests[0].task.resolve(decision(snapshot()));await flush();assert.equal(requests.length,2);assert.equal(requests[1].snapshot.state.time_seconds,.75);
  requests[1].task.resolve(decision(snapshot(3)));await flush();assert.deepEqual(received,[0,.75]);q.dispose();
});
test('live cadence is limited even when responses finish instantly',async()=>{
  let now=0,timer:(()=>void)|undefined,delay=0;const starts:number[]=[];
  const q=new LiveDecisionQueue({now:()=>now,schedule:((fn:()=>void,ms:number)=>{timer=fn;delay=ms;return 1}) as unknown as typeof setTimeout,cancel:(()=>{timer=undefined}) as unknown as typeof clearTimeout,run:async s=>{starts.push(now);return decision(s)},onResult:()=>{},onBusy:()=>{},onError:()=>assert.fail('unexpected error')});
  q.enqueue(snapshot());await flush();q.enqueue(snapshot(1));assert.equal(starts.length,1);assert.equal(delay,500);now=500;timer!();await flush();assert.deepEqual(starts,[0,500]);q.dispose();
});
test('rewinding reuses completed states without another model request',async()=>{
  let calls=0;const q=new LiveDecisionQueue({intervalMs:0,run:async s=>{calls++;return decision(s)},onResult:()=>{},onBusy:()=>{},onError:()=>{}});
  q.enqueue(snapshot());await flush();q.invalidate();q.enqueue(snapshot());await flush();assert.equal(calls,1);q.dispose();
});
test('seek or clip replacement aborts requests and discards their late results',async()=>{
  const requests:{signal:AbortSignal;task:ReturnType<typeof deferred>}[]=[],received:number[]=[];
  const q=new LiveDecisionQueue({intervalMs:0,run:async(_,signal)=>{const task=deferred();requests.push({task,signal});return task.promise},onResult:s=>received.push(s.state.time_seconds),onBusy:()=>{},onError:()=>{}});
  q.enqueue(snapshot(3));await flush();q.invalidate();assert.equal(requests[0].signal.aborted,true);q.enqueue(snapshot(0));await flush();
  requests[0].task.resolve(decision(snapshot(3)));requests[1].task.resolve(decision(snapshot(0)));await flush();assert.deepEqual(received,[0]);q.dispose();
});
test('provider failures pause requests until explicit retry and then use the latest frame',async()=>{
  let calls=0,errors=0;const seen:number[]=[];
  const q=new LiveDecisionQueue({intervalMs:0,run:async s=>{calls++;if(calls===1)throw Error('busy');seen.push(s.state.time_seconds);return decision(s)},onResult:()=>{},onBusy:()=>{},onError:()=>{errors++}});
  q.enqueue(snapshot());await flush();q.enqueue(snapshot(1));q.enqueue(snapshot(2));await flush();assert.equal(calls,1);assert.equal(errors,1);q.retry();await flush();assert.deepEqual(seen,[.5]);q.dispose();
});
test('unknown possession drops queued work without restarting old frames',async()=>{
  const task=deferred();let calls=0;const q=new LiveDecisionQueue({intervalMs:0,run:async()=>{calls++;return task.promise},onResult:()=>{},onBusy:()=>{},onError:()=>{}});
  q.enqueue(snapshot());await flush();q.enqueue(snapshot(2));q.enqueue(null);task.resolve(decision(snapshot()));await flush();assert.equal(calls,1);q.dispose();
});
test('live display allows only recent past decisions for the same current handler',()=>{
  const zero=event(snapshot(0)),one=event(snapshot(4));
  assert.equal(visibleDecision([zero,one],snapshot(2),true)?.id,zero.id);
  assert.equal(visibleDecision([zero],snapshot(8),true),undefined);
  assert.equal(visibleDecision([one],snapshot(2),true),undefined);
  assert.equal(visibleDecision([zero],null,true),undefined);
  assert.equal(visibleDecision([zero],{...snapshot(2),state:{...snapshot(2).state,ball_handler:7}},true),undefined);
});
test('paused or corrected frames require an exact matching state, not old probabilities',()=>{
  const s=snapshot(),e=event(s);assert.equal(visibleDecision([e],s,false),e);
  assert.equal(visibleDecision([e],snapshot(1),false),undefined);
  assert.equal(visibleDecision([e],{...s,state:{...s.state,basket_distance:.9}},false),undefined);
});
