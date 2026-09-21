import { z } from 'zod';
import {attackingGeometry} from './attacking-geometry.ts';
export {question} from './decision-policy.ts';
export const ACTIONS = ['SHOOT', 'DRIVE', 'PASS_LEFT', 'PASS_RIGHT', 'RESET'] as const;
export type Action = typeof ACTIONS[number];
export type Point = { x: number; y: number };
export type Track = { id: number; box: [number, number, number, number]; confidence: number; kind: 'player' | 'ball'; vx: number; vy: number; jersey?: [number,number,number] };
export type Frame = { time: number; tracks: Track[]; basket?:Point|null; scene_cut?:boolean; ball_uncertain?:boolean; ball_visible?:boolean; ball_track_confidence?:number; possession_handler?:number|null; possession_confidence?:number; possession_source?:'ball_proximity'|'recent_ball_track'|'unknown'; possession_status?:'acquiring'|'tracking'|'occluded'|'ball_in_flight'|'camera_cut'|'lost' };
export type Clip = { duration: number; width: number; height: number; frames: Frame[]; sample: boolean };
export type Role = 'offense' | 'defense' | 'ignore';
export type Setup = { handler: number | null; roles: Record<number, Role>; basket: Point | null; handlerSource?:'user_confirmed'|'ball_proximity'|'recent_ball_track'; handlerConfidence?:number; rolesSource?:'user_confirmed'|'jersey_color'|'mixed' };
const finite = z.number().finite();
const point = z.object({x:finite.min(0).max(1),y:finite.min(0).max(1)}).strict();
const distance = finite.min(0).max(3).nullable();
const ids=z.array(z.number().int().positive()).max(60);
export const attackingSchema=z.object({
  basis:z.literal('image_plane_estimate'),basket_position:point.nullable(),handler_height_image_width:finite.min(0),
  basket_distance_in_handler_heights:finite.min(0).nullable(),nearest_defender_distance_in_handler_heights:finite.min(0).nullable(),
  primary_defender_id:z.number().int().positive().nullable(),
  defenders:z.array(z.object({id:z.number().int().positive(),position:point,distance_to_handler:distance,distance_to_basket:distance,in_projected_rim_corridor:z.boolean().nullable()}).strict()).max(60),
  projected_help_defender_ids:ids,projected_unassigned_player_ids:ids,projected_teammate_ids:ids,
  projected_help_status:z.enum(['help_visible','no_help_visible','unknown']),
  court_zone:z.literal('unknown'),shooting_range:z.literal('unknown'),shot_readiness:z.literal('unknown'),
}).strict();
export const stateSchema = z.object({
  schema_version:z.literal('1.0'), time_seconds:finite.min(0).max(86400),
  source:z.enum(['uploaded_clip','sample_fixture']), coordinate_system:z.literal('image_width_units; x right, y down; uncalibrated perspective'),
  ball_handler:z.number().int().positive(), handler_position:point, handler_source:z.enum(['user_confirmed','ball_proximity','recent_ball_track']), handler_confidence:finite.min(0).max(1), team_source:z.enum(['user_confirmed','jersey_color','mixed']),
  ball_detected:z.boolean(), defender_distance:distance, basket_distance:distance,
  // Optional for old exports/clients; every newly built state supplies it.
  attacking:attackingSchema.optional(),
  movement:z.object({x_per_second:finite.min(-20).max(20),y_per_second:finite.min(-20).max(20),speed:finite.min(0).max(60)}).strict(),
  teammate_positions:z.array(z.object({id:z.number().int().positive(),position:point,side:z.enum(['left','right']),nearest_defender:distance,passing_lane:z.enum(['clear','blocked','unknown'])}).strict()).max(60),
  spacing:z.object({mean_teammate_distance:distance,visible_offense:z.number().int().min(1).max(60),visible_defense:z.number().int().min(0).max(60)}).strict(),
  quality:z.object({mean_detection_confidence:finite.min(0).max(1),unassigned_players:z.number().int().min(0).max(100),limitations:z.array(z.string().max(180)).max(8)}).strict(),
}).strict();
export type CourtState = z.infer<typeof stateSchema>;
export type Decision = { choice: Action; probabilities: Record<Action, number>; confidence: number; model: string; source: 'jev' | 'baseline'; latency_ms?: number; policy_version?:string };
export const feet = (t: Track): Point => ({x:t.box[0]+t.box[2]/2,y:t.box[1]+t.box[3]});
export function atTime(frames: Frame[], time: number): Frame | undefined {
  // Never leak a future frame into a frozen decision.
  return frames.findLast(f=>f.time<=time+0.0001);
}
export function buildState(clip: Clip, frame: Frame, setup: Setup): CourtState | null {
  const players=frame.tracks.filter(t=>t.kind==='player'&&setup.roles[t.id]!=='ignore');
  const h=players.find(t=>t.id===setup.handler); if(!h)return null;
  const aspect=clip.height/clip.width;
  const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,(a.y-b.y)*aspect);
  const hp=feet(h); const defenders=players.filter(t=>setup.roles[t.id]==='defense');
  const teammates=players.filter(t=>t.id!==h.id&&setup.roles[t.id]==='offense');
  const nearest=(p:Point)=>defenders.length?Math.min(...defenders.map(d=>dist(p,feet(d)))):null;
  const lane=(p:Point)=>{
    const ax=hp.x,ay=hp.y*aspect,bx=p.x,by=p.y*aspect;
    const crosses=(d:Track)=>{const q=feet(d),dx=bx-ax,dy=by-ay;const u=((q.x-ax)*dx+(q.y*aspect-ay)*dy)/(dx*dx+dy*dy||1);return u>.08&&u<.92&&Math.hypot(q.x-(ax+u*dx),q.y*aspect-(ay+u*dy))<.035;};
    if(defenders.some(crosses))return 'blocked' as const;
    if(!defenders.length||players.some(t=>t.id!==h.id&&!setup.roles[t.id]&&crosses(t)))return 'unknown' as const;
    return 'clear' as const;
  };
  const limitations=['Image-plane distances are not physical court distances. Perspective and camera movement distort geometry.','Generic track IDs may switch during occlusion; camera motion is not compensated.'];
  if(setup.rolesSource&&setup.rolesSource!=='user_confirmed')limitations.push('Teams are estimated from jersey colors; similar uniforms and occlusion can cause errors.');
  if(setup.handlerSource&&setup.handlerSource!=='user_confirmed')limitations.push('Possession is estimated from ball proximity and recent tracks, not player identity.');
  if(!frame.tracks.some(t=>t.kind==='ball'))limitations.push('Ball was not detected at this frame; possession uses manual or recent tracking evidence.');
  if(!setup.basket)limitations.push('Basket position is unknown.');
  limitations.push('Rim corridors and distances in player heights are screen estimates, not court zones, shot readiness, physical shooting range or confirmed driving lanes.');
  return stateSchema.parse({schema_version:'1.0',time_seconds:frame.time,source:clip.sample?'sample_fixture':'uploaded_clip',coordinate_system:'image_width_units; x right, y down; uncalibrated perspective',ball_handler:h.id,handler_position:hp,handler_source:setup.handlerSource??'user_confirmed',handler_confidence:setup.handlerConfidence??1,team_source:setup.rolesSource??'user_confirmed',ball_detected:frame.tracks.some(t=>t.kind==='ball'),defender_distance:nearest(hp),basket_distance:setup.basket?dist(hp,setup.basket):null,attacking:attackingGeometry(h,players,setup.roles,setup.basket,aspect),movement:{x_per_second:h.vx,y_per_second:h.vy*aspect,speed:Math.hypot(h.vx,h.vy*aspect)},teammate_positions:teammates.map(t=>({id:t.id,position:feet(t),side:feet(t).x<hp.x?'left':'right',nearest_defender:nearest(feet(t)),passing_lane:lane(feet(t))})),spacing:{mean_teammate_distance:teammates.length?teammates.reduce((a,t)=>a+dist(hp,feet(t)),0)/teammates.length:null,visible_offense:teammates.length+1,visible_defense:defenders.length},quality:{mean_detection_confidence:players.reduce((a,t)=>a+t.confidence,0)/(players.length||1),unassigned_players:players.filter(t=>t.id!==h.id&&!setup.roles[t.id]).length,limitations}});
}
export function baseline(s:CourtState):Decision {
  // A transparent rules-only preview, never represented as a Jev response.
  const pressure=s.defender_distance!==null&&s.defender_distance<.09;
  const score:Record<Action,number>={SHOOT:s.basket_distance!==null&&s.basket_distance<.28&&!pressure?5:1,DRIVE:pressure?1:3,PASS_LEFT:1,PASS_RIGHT:1,RESET:2};
  for(const p of s.teammate_positions){const open=p.nearest_defender!==null&&p.nearest_defender>.1;score[p.side==='left'?'PASS_LEFT':'PASS_RIGHT']+=p.passing_lane==='clear'?(open?6:2):0;}
  if(pressure){score.PASS_LEFT*=1.4;score.PASS_RIGHT*=1.4;}
  const sum=Object.values(score).reduce((a,b)=>a+b,0);const probabilities=Object.fromEntries(ACTIONS.map(k=>[k,score[k]/sum])) as Record<Action,number>;
  const choice=ACTIONS.reduce((a,b)=>probabilities[a]>=probabilities[b]?a:b);
  return {choice,probabilities,confidence:probabilities[choice],model:'Deterministic preview',source:'baseline'};
}
export function parseDecision(raw:unknown):Decision {
  const probabilities=z.object(Object.fromEntries(ACTIONS.map(a=>[a,finite.min(0).max(1)])) as Record<Action,z.ZodNumber>).strict();
  const data=z.object({model:z.string(),answers:z.object({decision:z.object({type:z.literal('choice'),choice:z.enum(ACTIONS),confidence:finite.min(0).max(1),probabilities})})}).parse(raw);
  const a=data.answers.decision;const sum=Object.values(a.probabilities).reduce((x,y)=>x+y,0);
  if(Math.abs(sum-1)>.015)throw new Error('Jev returned an invalid probability distribution.');
  if(a.probabilities[a.choice]+.0001<Math.max(...Object.values(a.probabilities)))throw new Error('Jev choice does not match its probabilities.');
  return {...a,model:data.model,source:'jev'};
}
export const sampleSetup:Setup={handler:4,roles:{4:'offense',7:'offense',9:'offense',2:'offense',8:'offense',11:'defense',12:'defense',13:'defense',14:'defense',15:'defense'},basket:{x:.5,y:.14}};
export function sampleClip():Clip {
  const frames:Frame[]=[];
  for(let i=0;i<=32;i++){const t=i/4;const positions:[number,number,number][]=[[4,.48-t*.005,.72-t*.012],[7,.19,.41],[9,.81,.49],[2,.34,.25],[8,.72,.21],[11,.51-t*.003,.36+t*.026],[12,.39,.3],[13,.69,.44],[14,.26,.22],[15,.62,.22]];
    const tracks:Track[]=positions.map(([id,x,y])=>({id,box:[x-.016,y-.08,.032,.08],confidence:1,kind:'player',vx:id===4?-.005:id===11?-.003:0,vy:id===4?-.012:id===11?.026:0}));
    const h=tracks[0];tracks.push({id:99,box:[h.box[0]+.036,h.box[1]+.04,.012,.018],confidence:1,kind:'ball',vx:-.005,vy:-.012});frames.push({time:t,tracks});}
  return {duration:8,width:700,height:420,frames,sample:true};
}
