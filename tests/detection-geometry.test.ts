import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectionCrops,restoreCrop,sceneChanged} from '../lib/detection-geometry.ts';
import {Tracker,type Detection} from '../lib/vision.ts';
import {buildState,sampleClip,sampleSetup,stateSchema} from '../lib/court.ts';
import {estimatePossession} from '../lib/possession.ts';
const player=(confidence=.9):Detection=>({kind:'player',box:[.2,.2,.08,.2],confidence});
test('crops cover the full image with overlap and restore original coordinates',()=>{
 const crops=detectionCrops(1600,900);assert.equal(crops[0].x,0);assert.equal(crops.at(-1)!.x+900,1600);assert.ok(crops[1].x<crops[0].x+900);
 const restored=restoreCrop({kind:'ball',box:[.5,.5,.02,.02],confidence:.8},crops[1],1600,900)!;
 assert.equal(restored.box[0],.5);assert.equal(restored.box[1],.5);assert.equal(restored.box[2],.01125);
 assert.equal(restoreCrop({...player(),box:[0,.2,.1,.2]},crops[1],1600,900),null);
 assert.equal(detectionCrops(900,900).length,0);
});
test('low-confidence players can extend a track but cannot start one',()=>{
 const tracker=new Tracker();assert.equal(tracker.update([player(.18)],0).length,0);
 const first=tracker.update([player()],.25);const next=tracker.update([player(.18)],.5);assert.equal(first[0].id,next[0].id);
 tracker.reset();assert.equal(tracker.update([player(.18)],.75).length,0);assert.notEqual(tracker.update([player()],1)[0].id,first[0].id);
});
test('camera cuts reset continuity while mild lighting differences do not',()=>{
 const a=new Uint8ClampedArray(32*18*4).fill(40),b=new Uint8ClampedArray(a.length).fill(48),c=new Uint8ClampedArray(a.length).fill(240);
 assert.equal(sceneChanged(undefined,c),false);assert.equal(sceneChanged(a,b),false);assert.equal(sceneChanged(a,c),true);
 const clip=sampleClip();const f={...clip.frames[1],scene_cut:true,tracks:clip.frames[1].tracks.filter(t=>t.kind==='player')};assert.equal(estimatePossession(clip,f).handler,null);
});
test('multi-minute decision timestamps are accepted without weakening the state boundary',()=>{
 const clip=sampleClip(),state=buildState(clip,{...clip.frames[0],time:511},sampleSetup)!;assert.equal(state.time_seconds,511);assert.throws(()=>stateSchema.parse({...state,raw_video:'data'}));
});
test('ball evidence rejects courtside objects and keeps ambiguous choices uncertain',async()=>{
 const {BallEvidence}=await import('../lib/detection-geometry.ts');const select=new BallEvidence();
 const ball=(x:number,y:number):Detection=>({kind:'ball',confidence:.85,box:[x,y,.01,.01]});
 const p=player(),onBall=ball(.24,.3),sidelineBall=ball(.8,.1);
 assert.equal(select.select([p,onBall,sidelineBall],0,.6).detections.filter(d=>d.kind==='ball').length,1);
 select.reset();const ambiguous=select.select([p,ball(.21,.3),ball(.26,.3)],1,.6);assert.equal(ambiguous.uncertain,true);assert.equal(ambiguous.detections.some(d=>d.kind==='ball'),false);
 const clip=sampleClip(),f={...clip.frames[1],ball_uncertain:true,tracks:clip.frames[1].tracks.filter(t=>t.kind==='player')};assert.equal(estimatePossession(clip,f).handler,null);
});
test('an unassigned person in a passing lane prevents a clear-lane claim',()=>{
 const clip=sampleClip(),frame=clip.frames[0];const handler=frame.tracks.find(t=>t.id===4)!,receiver=frame.tracks.find(t=>t.id===7)!;
 const hx=handler.box[0]+handler.box[2]/2,hy=handler.box[1]+handler.box[3],rx=receiver.box[0]+receiver.box[2]/2,ry=receiver.box[1]+receiver.box[3];
 const unknown={...handler,id:777,box:[(hx+rx)/2-.01,(hy+ry)/2-.08,.02,.08] as [number,number,number,number]};
 const state=buildState(clip,{...frame,tracks:[handler,receiver,{...handler,id:11,box:[.9,.8,.02,.08]},unknown]}, {handler:4,roles:{4:'offense',7:'offense',11:'defense'},basket:null})!;
 assert.equal(state.teammate_positions[0].passing_lane,'unknown');
});
