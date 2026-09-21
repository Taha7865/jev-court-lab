import type {Detection} from './vision';
export type Crop={x:number;y:number;width:number;height:number};
// Overlapping squares keep small objects larger than a whole-frame resize does.
export function detectionCrops(width:number,height:number):Crop[]{
  const size=Math.min(width,height);
  if(Math.max(width,height)<=size*1.15)return [];
  return [0,.5,1].map(p=>({x:Math.round((width-size)*p),y:Math.round((height-size)*p),width:size,height:size}));
}
export function restoreCrop(d:Detection,crop:Crop,width:number,height:number):Detection|null{
  const [x,y,w,h]=d.box;
  // Partial players at internal tile edges should not become new tracks.
  if(d.kind==='player'&&((x<.015&&crop.x>0)||(x+w>.985&&crop.x+crop.width<width)||(y<.015&&crop.y>0)||(y+h>.985&&crop.y+crop.height<height)))return null;
  return {...d,box:[(crop.x+x*crop.width)/width,(crop.y+y*crop.height)/height,w*crop.width/width,h*crop.height/height]};
}
export function sceneChanged(previous:Uint8ClampedArray|undefined,current:Uint8ClampedArray):boolean{
  if(!previous||previous.length!==current.length)return false;
  let difference=0,changed=0;
  for(let i=0;i<current.length;i+=4){const d=(Math.abs(current[i]-previous[i])+Math.abs(current[i+1]-previous[i+1])+Math.abs(current[i+2]-previous[i+2]))/765;difference+=d;if(d>.2)changed++;}
  const pixels=current.length/4;
  return difference/pixels>.23&&changed/pixels>.55;
}

// Select observed ball evidence, never synthesized positions. Courtside spare balls
// and round crowd details need player proximity or continuity with the active ball.
export class BallEvidence {
  private previous:{x:number;y:number;time:number}|undefined;
  reset(){this.previous=undefined;}
  select(detections:Detection[],time:number,aspect:number):{detections:Detection[];uncertain:boolean}{
    const players=detections.filter(d=>d.kind==='player'&&d.confidence>=.25);
    const balls=detections.filter(d=>d.kind==='ball');
    const previous=this.previous&&time-this.previous.time<=.5?this.previous:undefined;
    const ranked=balls.flatMap(ball=>{
      const x=ball.box[0]+ball.box[2]/2,y=ball.box[1]+ball.box[3]/2;
      const proximity=players.length?Math.min(...players.map(p=>{
        const [px,py,pw,ph]=p.box;
        return Math.hypot(Math.max(px-x,0,x-px-pw),Math.max(py-y,0,y-py-ph)*aspect)/(ph*aspect||1);
      })):Infinity;
      const travel=previous?Math.hypot(x-previous.x,(y-previous.y)*aspect):Infinity;
      const continuous=previous&&travel<.04+(time-previous.time)*.55;
      if(proximity>.35&&!continuous)return [];
      const score=ball.confidence*.45+Math.max(0,1-proximity/.35)*.35+(continuous?Math.max(0,1-travel/.2)*.2:0);
      return [{ball,x,y,score}];
    }).sort((a,b)=>b.score-a.score);
    if(!ranked.length||(ranked.length>1&&ranked[0].score-ranked[1].score<.08))return {detections:detections.filter(d=>d.kind!=='ball'),uncertain:balls.length>0};
    const best=ranked[0];this.previous={x:best.x,y:best.y,time};
    return {detections:[...detections.filter(d=>d.kind!=='ball'),best.ball],uncertain:false};
  }
}
