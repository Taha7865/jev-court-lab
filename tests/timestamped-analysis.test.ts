import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TimestampedAnalysisQueue} from '../lib/timestamped-analysis.ts';
import {buildState,sampleClip,sampleSetup,baseline} from '../lib/court.ts';
import type {DecisionSnapshot} from '../lib/live-decisions.ts';
const clip=sampleClip();const snapshot=(index:number):DecisionSnapshot=>({state:buildState(clip,clip.frames[index],sampleSetup)!,setup:sampleSetup});
const decision=(s:DecisionSnapshot)=>baseline(s.state);
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('analysis is timestamp ordered, sampled every 250ms, and scrubs read the same cached result',async()=>{
  const seen:number[]=[];const queue=new TimestampedAnalysisQueue({run:async s=>{seen.push(s.state.time_seconds);return decision(s)},onResult:()=>{},onError:error=>assert.fail(String(error))});
  queue.enqueue(snapshot(0));queue.enqueue(snapshot(1));queue.enqueue(snapshot(2));await queue.whenIdle();
  assert.deepEqual(seen,[0,.25,.5]);assert.equal(queue.get(.25)?.decision.choice,queue.get(.25)?.decision.choice);
});
test('late work from an invalidated clip cannot write a stale recommendation',async()=>{
  let release!:(value:ReturnType<typeof decision>)=>void;const queue=new TimestampedAnalysisQueue({run:()=>new Promise(resolve=>{release=resolve}),onResult:()=>assert.fail('stale result was cached'),onError:error=>assert.fail(String(error))});
  queue.enqueue(snapshot(0));await flush();queue.invalidate();release(decision(snapshot(0)));await queue.whenIdle();assert.equal(queue.get(0),undefined);
});
