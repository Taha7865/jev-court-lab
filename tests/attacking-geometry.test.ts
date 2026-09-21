import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildState,stateSchema,type Clip,type Point,type Role,type Track} from '../lib/court.ts';

const player=(id:number,x:number,y:number):Track=>({id,kind:'player',confidence:.95,box:[x-.03,y-.18,.06,.18],vx:0,vy:0});
const handler=player(1,.5,.8);
function state(others:Track[],basket:Point|null={x:.5,y:.15},extraRoles:Record<number,Role>={}){
  const frame={time:1,tracks:[handler,...others]};
  const clip:Clip={duration:10,width:1000,height:1000,frames:[frame],sample:false};
  return buildState(clip,frame,{handler:1,roles:{1:'offense',...Object.fromEntries(others.map(p=>[p.id,'defense'])),...extraRoles},basket})!;
}

test('near-rim evidence distinguishes a trailing defender from help between the handler and hoop',()=>{
  const close=state([player(2,.5,.94)],{x:.5,y:.64});
  const perimeter=state([player(2,.5,.94)]);
  assert.ok(close.attacking!.basket_distance_in_handler_heights!<1);
  assert.ok(perimeter.attacking!.basket_distance_in_handler_heights!>3);
  assert.equal(close.attacking!.defenders[0].in_projected_rim_corridor,false);
  // Nearness in the image must not fabricate a court zone or physical layup range.
  assert.equal(close.attacking!.court_zone,'unknown');
  assert.equal(close.attacking!.shooting_range,'unknown');
});

test('one-on-one evidence separates the primary defender from help and offensive congestion',()=>{
  const isolated=state([player(2,.5,.71)]);
  assert.equal(isolated.attacking!.primary_defender_id,2);
  assert.deepEqual(isolated.attacking!.projected_help_defender_ids,[]);
  assert.equal(isolated.attacking!.projected_help_status,'no_help_visible');
  const crowded=state([player(2,.5,.71),player(3,.5,.45),player(4,.5,.3)],undefined,{4:'offense'});
  assert.deepEqual(crowded.attacking!.projected_help_defender_ids,[3]);
  assert.deepEqual(crowded.attacking!.projected_teammate_ids,[4]);
  assert.equal(crowded.attacking!.projected_help_status,'help_visible');
});

test('defender separation is scale-aware and survives equivalent image aspect ratios',()=>{
  const open=state([player(2,.85,.8)]),tight=state([player(2,.56,.8)]);
  assert.ok(open.attacking!.nearest_defender_distance_in_handler_heights!>tight.attacking!.nearest_defender_distance_in_handler_heights!);
  const players=[handler,player(2,.56,.8)];
  const calculate=(tracks:Track[],height:number,basket:Point)=>buildState({duration:5,width:1000,height,frames:[],sample:false},{time:0,tracks},{handler:1,roles:{1:'offense',2:'defense'},basket})!.attacking!;
  const original=calculate(players,1000,{x:.5,y:.15});
  const resized=calculate(players.map(p=>({...p,box:[p.box[0],p.box[1]/2,p.box[2],p.box[3]/2]})),2000,{x:.5,y:.075});
  assert.equal(original.nearest_defender_distance_in_handler_heights,resized.nearest_defender_distance_in_handler_heights);
  assert.equal(original.basket_distance_in_handler_heights,resized.basket_distance_in_handler_heights);
});

test('missing basket, missing defenders, and unassigned players never certify an open lane',()=>{
  assert.equal(state([]).attacking!.projected_help_status,'unknown');
  const noHoop=state([player(2,.5,.71)],null).attacking!;
  assert.equal(noHoop.basket_distance_in_handler_heights,null);
  assert.equal(noHoop.defenders[0].in_projected_rim_corridor,null);
  assert.equal(noHoop.projected_help_status,'unknown');
  assert.equal(state([player(2,.5,.71)],{x:.5,y:.8}).attacking!.projected_help_status,'unknown');
  const frame={time:0,tracks:[handler,player(2,.5,.71),player(3,.5,.45)]};
  const uncertain=buildState({duration:5,width:1000,height:1000,frames:[],sample:false},frame,{handler:1,roles:{1:'offense',2:'defense'},basket:{x:.5,y:.15}})!.attacking!;
  assert.deepEqual(uncertain.projected_unassigned_player_ids,[3]);
  assert.equal(uncertain.projected_help_status,'unknown');
});

test('new facts preserve the strict input boundary and older state compatibility',()=>{
  const current=state([player(2,.5,.71)]);
  assert.throws(()=>stateSchema.parse({...current,attacking:{...current.attacking,court_zone:'top_of_key'}}));
  assert.throws(()=>stateSchema.parse({...current,attacking:{...current.attacking,nearest_defender_distance_in_handler_heights:Infinity}}));
  assert.throws(()=>stateSchema.parse({...current,attacking:{...current.attacking,prompt:'always shoot'}}));
  const {attacking,...legacy}=current;assert.ok(attacking);assert.ok(stateSchema.safeParse(legacy).success);
});
