import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PersistentBallTracker} from '../lib/ball-tracking.ts';
import type {Track} from '../lib/court.ts';
const player=(id=1):Track=>({id,kind:'player',box:[.4,.4,.12,.22],confidence:.9,vx:0,vy:0});
const ball=(x=.47,y=.52):Track=>({id:9,kind:'ball',box:[x,y,.02,.02],confidence:.8,vx:0,vy:0});
test('brief ball occlusion preserves possession, then expires in video time',()=>{
  const tracker=new PersistentBallTracker({occlusionExpirySeconds:.5});
  assert.equal(tracker.update({time:0,tracks:[player(),ball()]}).possession_handler,1);
  const hidden=tracker.update({time:.25,tracks:[player()]});assert.equal(hidden.possession_status,'occluded');assert.ok(hidden.possession_confidence!>0);
  const expired=tracker.update({time:.51,tracks:[player()]});assert.equal(expired.possession_status,'lost');assert.equal(expired.possession_handler,null);
});
test('passes, shots and cuts invalidate the old possession immediately',()=>{
  const tracker=new PersistentBallTracker();tracker.update({time:0,tracks:[player(),ball()]});
  assert.equal(tracker.update({time:.25,tracks:[player(),ball(.05,.05)]}).possession_status,'ball_in_flight');
  tracker.update({time:.5,tracks:[player(),ball()]});assert.equal(tracker.update({time:.75,tracks:[player()],scene_cut:true}).possession_status,'camera_cut');
});
