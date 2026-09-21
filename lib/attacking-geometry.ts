import type {Point,Role,Track} from './court';

/** Measured screen geometry, not a court calibration or a shot-quality classifier. */
export function attackingGeometry(handler:Track,players:Track[],roles:Record<number,Role>,basket:Point|null,aspect:number){
  const feet=(track:Track):Point=>({x:track.box[0]+track.box[2]/2,y:track.box[1]+track.box[3]});
  const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,(a.y-b.y)*aspect);
  const hp=feet(handler),height=handler.box[3]*aspect;
  const inHeights=(value:number)=>height>0?value/height:null;
  const defenders=players.filter(p=>roles[p.id]==='defense').sort((a,b)=>distance(hp,feet(a))-distance(hp,feet(b)));
  const primary=defenders[0];
  // This segment points to an elevated hoop in the image, not to its ground
  // projection. A blocker is supporting evidence only; absence is not clearance.
  const inCorridor=(track:Track):boolean|null=>{
    if(!basket||height<=0)return null;
    const dx=basket.x-hp.x,dy=(basket.y-hp.y)*aspect,lengthSquared=dx*dx+dy*dy;
    if(lengthSquared<1e-8)return null;
    const p=feet(track),px=p.x-hp.x,py=(p.y-hp.y)*aspect;
    const along=(px*dx+py*dy)/lengthSquared;
    const perpendicular=Math.hypot(px-along*dx,py-along*dy);
    return along>0&&along<=1&&perpendicular<=Math.max(handler.box[2],track.box[2])/2;
  };
  const observations=defenders.map(d=>({
    id:d.id,position:feet(d),distance_to_handler:distance(hp,feet(d)),
    distance_to_basket:basket?distance(basket,feet(d)):null,
    in_projected_rim_corridor:inCorridor(d),
  }));
  const help=defenders.filter(d=>d.id!==primary?.id&&inCorridor(d)===true).map(d=>d.id);
  const unknown=players.filter(p=>p.id!==handler.id&&!roles[p.id]&&inCorridor(p)===true).map(p=>p.id);
  const teammates=players.filter(p=>p.id!==handler.id&&roles[p.id]==='offense'&&inCorridor(p)===true).map(p=>p.id);
  return {
    basis:'image_plane_estimate' as const,basket_position:basket,handler_height_image_width:height,
    basket_distance_in_handler_heights:basket?inHeights(distance(hp,basket)):null,
    nearest_defender_distance_in_handler_heights:primary?inHeights(distance(hp,feet(primary))):null,
    primary_defender_id:primary?.id??null,defenders:observations,
    projected_help_defender_ids:help,projected_unassigned_player_ids:unknown,projected_teammate_ids:teammates,
    // Unknown/undetected defenders must not be converted into an "open lane".
    projected_help_status:!primary||inCorridor(primary)===null||unknown.length?'unknown' as const:help.length?'help_visible' as const:'no_help_visible' as const,
    court_zone:'unknown' as const,shooting_range:'unknown' as const,shot_readiness:'unknown' as const,
  };
}
