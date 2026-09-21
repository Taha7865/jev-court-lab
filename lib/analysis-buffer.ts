/** Keep a little processed video in reserve so playback cannot outrun tracks. */
export const INITIAL_ANALYSIS_BUFFER_SECONDS=10;
export const PLAYBACK_GUARD_SECONDS=.5;

export function playbackLimit(analyzedThrough:number,duration:number,processing:boolean){
  if(!processing)return duration;
  return Math.max(0,Math.min(duration,analyzedThrough-PLAYBACK_GUARD_SECONDS));
}

export function hasInitialAnalysisBuffer(analyzedThrough:number,duration:number){
  return analyzedThrough>=Math.min(INITIAL_ANALYSIS_BUFFER_SECONDS,duration);
}
