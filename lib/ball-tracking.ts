import type {Frame,Track} from './court';

export type BallTrackingOptions={occlusionExpirySeconds?:number};
export type BallTrackingState=Pick<Frame,'ball_visible'|'ball_track_confidence'|'possession_handler'|'possession_confidence'|'possession_source'|'possession_status'>;

/** Causal ball and possession continuity. It never invents a ball position. */
export class PersistentBallTracker {
  private last:{time:number;handler:number;confidence:number}|undefined;
  private readonly expiry:number;
  constructor(options:BallTrackingOptions={}){this.expiry=options.occlusionExpirySeconds??.5;}
  initialize(handler:number,time:number){this.last={time,handler,confidence:1};}
  initializeAt(point:{x:number;y:number},tracks:Track[],time:number){
    const candidate=tracks.filter(track=>track.kind==='player').map(track=>{const [x,y,w,h]=track.box;return {id:track.id,distance:Math.hypot(point.x-(x+w/2),point.y-(y+h*.6))/(h||1)};}).sort((a,b)=>a.distance-b.distance)[0];
    if(!candidate||candidate.distance>.8)return false;this.initialize(candidate.id,time);return true;
  }
  reset(){this.last=undefined;}
  update(frame:Pick<Frame,'time'|'tracks'|'scene_cut'|'ball_uncertain'>):BallTrackingState{
    if(frame.scene_cut){this.reset();return {ball_visible:false,ball_track_confidence:0,possession_handler:null,possession_confidence:0,possession_source:'unknown',possession_status:'camera_cut'};}
    const ball=frame.tracks.find(track=>track.kind==='ball');
    if(ball){const handler=this.nearestHandler(ball,frame.tracks);
      if(handler!==null){const confidence=Math.min(.98,.52+ball.confidence*.42);this.last={time:frame.time,handler,confidence};return {ball_visible:true,ball_track_confidence:ball.confidence,possession_handler:handler,possession_confidence:confidence,possession_source:'ball_proximity',possession_status:'tracking'};}
      // A confirmed ball separated from every player is a pass/shot, not an occlusion.
      this.reset();return {ball_visible:true,ball_track_confidence:ball.confidence,possession_handler:null,possession_confidence:0,possession_source:'unknown',possession_status:'ball_in_flight'};
    }
    const prior=this.last,age=prior?frame.time-prior.time:Infinity;
    if(prior&&age>=0&&age<=this.expiry&&!frame.ball_uncertain){const confidence=prior.confidence*Math.max(0,1-age/this.expiry);return {ball_visible:false,ball_track_confidence:0,possession_handler:prior.handler,possession_confidence:confidence,possession_source:'recent_ball_track',possession_status:'occluded'};}
    this.reset();return {ball_visible:false,ball_track_confidence:0,possession_handler:null,possession_confidence:0,possession_source:'unknown',possession_status:'lost'};
  }
  private nearestHandler(ball:Track,tracks:Track[]){
    const bx=ball.box[0]+ball.box[2]/2,by=ball.box[1]+ball.box[3]/2;
    const candidates=tracks.filter(track=>track.kind==='player').map(player=>{const [x,y,w,h]=player.box;const distance=Math.hypot(Math.max(x-bx,0,bx-x-w),Math.max(y-by,0,by-y-h))/(h||1);return {id:player.id,distance};}).sort((a,b)=>a.distance-b.distance);
    return candidates[0]?.distance!==undefined&&candidates[0].distance<.53?candidates[0].id:null;
  }
}
