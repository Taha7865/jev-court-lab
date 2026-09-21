import {test} from 'node:test';
import assert from 'node:assert/strict';
import {question,questionWithContext} from '../lib/decision-policy.ts';
import {ACTIONS,buildState,sampleClip,sampleSetup,type CourtState} from '../lib/court.ts';
import {visibleDecision,snapshotKey} from '../lib/live-decisions.ts';
import {baseline} from '../lib/court.ts';
const clip=sampleClip();
const state=(time:number):CourtState=>({...buildState(clip,clip.frames[0],sampleSetup)!,time_seconds:time});

test('every request carries explicit finishing, open-shot, drive and comparative passing criteria',()=>{
  const request=questionWithContext(state(2),[]);
  assert.deepEqual(Object.keys(request.criteria),[...ACTIONS]);
  assert.match(request.criteria.SHOOT,/layup, dunk or close finish/);
  assert.match(request.criteria.SHOOT,/open catch-and-shoot or pull-up/);
  assert.match(request.criteria.DRIVE,/one-on-one/);
  assert.match(request.criteria.DRIVE,/Prefer SHOOT if the defender backs off/);
  assert.match(request.criteria.PASS_LEFT,/concrete advantage/);
  assert.match(request.criteria.PASS_RIGHT,/concrete improvement/);
  assert.match(request.instructions,/not meters, feet, arm lengths or proven layup range/);
});

test('temporal context keeps the latest four causal observations and the new attacking evidence',()=>{
  const current=state(2);
  const context=[state(3),state(1),state(1.25),state(.75),state(2),state(1.5),state(1.75),state(1.8),{...state(1.9),ball_handler:99},{...state(1.95),source:'uploaded_clip' as const}];
  const supplied=questionWithContext(current,context);
  const earlier=JSON.parse(supplied.instructions.slice(supplied.instructions.indexOf('[{'))) as CourtState[];
  assert.deepEqual(earlier.map(s=>s.time_seconds),[1.25,1.5,1.75,1.8]);
  assert.deepEqual(earlier[0].attacking,current.attacking);
  assert.deepEqual(supplied.criteria,question.criteria);
  assert.equal(context[0].time_seconds,3); // Do not reorder the caller's array.
  assert.equal(questionWithContext(current,[state(2),state(3)]),question);
});

test('corrected attacking facts cannot reuse a paused decision for the old evidence',()=>{
  const current=state(1),snapshot={state:current,setup:sampleSetup};
  const saved={...snapshot,id:'before-correction',decision:baseline(current)};
  const corrected={...snapshot,state:{...current,attacking:{...current.attacking!,basket_position:{x:.1,y:.1}}}};
  assert.notEqual(snapshotKey(snapshot),snapshotKey(corrected));
  assert.equal(visibleDecision([saved],corrected,false),undefined);
  assert.equal(visibleDecision([saved],snapshot,false),saved);
});
