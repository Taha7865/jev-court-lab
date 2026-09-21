"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Play, Pause, X, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ACTIONS, atTime, baseline, buildState, sampleClip, sampleSetup, type Action, type Clip, type Decision, type Frame, type Role, type Setup } from '@/lib/court';
import type { analyzeVideoIncrementally as AnalyzeVideoIncrementally } from '@/lib/vision';
import { resolveSetup } from '@/lib/possession';
import {useLiveJev} from '@/hooks/use-live-jev';
import {snapshotKey,visibleDecision,type DecisionEvent} from '@/lib/live-decisions';
import {hasInitialAnalysisBuffer,playbackLimit} from '@/lib/analysis-buffer';
import {TimestampedAnalysisQueue} from '@/lib/timestamped-analysis';
const label=(a:Action)=>a.replaceAll('_',' ');
const stamp=(t:number)=>`${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,'0')}`;
const pct=(n:number|null)=>n===null?'Unknown':`${(n*100).toFixed(1)}% width`;
const trackingMessage=(frame?:Frame)=>{const messages:Partial<Record<NonNullable<Frame['possession_status']>,string>>={tracking:'Ball tracked; possession is being revalidated.',occluded:'Ball briefly occluded; carrying possession with declining confidence.',ball_in_flight:'Ball is in flight; possession and recommendation are withheld.',camera_cut:'Camera cut detected; reacquiring ball and possession.',lost:'Ball not tracked; waiting to reacquire possession.'};return messages[frame?.possession_status??'acquiring']??'Acquiring ball and player tracks.';};
function Overlay({clip,frame,setup,marking,onMark}:{clip:Clip;frame?:Frame;setup:Setup;marking:boolean;onMark:(p:{x:number;y:number})=>void}){
  const width=clip.width,height=clip.height;
  return <svg className={`overlay ${marking?'marking':''}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Detected players and ball" onClick={e=>{if(!marking)return;const r=e.currentTarget.getBoundingClientRect();onMark({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height})}}>
    {frame?.tracks.map(t=>{if(setup.roles[t.id]==='ignore')return null;const [x,y,w,h]=t.box,isHandler=setup.handler===t.id,tagHeight=width*.03;return <g key={t.id}>
      {t.kind==='ball'?<><circle cx={(x+w/2)*width} cy={(y+h/2)*height} r={Math.max(w*width/2,width*.007)+3} fill="none" stroke="black" strokeWidth="5"/><circle cx={(x+w/2)*width} cy={(y+h/2)*height} r={Math.max(w*width/2,width*.007)+3} fill="none" stroke="white" strokeWidth="2"/></>:<><rect x={x*width} y={y*height} width={w*width} height={h*height} fill="none" stroke="black" strokeWidth={width*.0035}/><rect x={x*width} y={y*height} width={w*width} height={h*height} fill="none" stroke="white" strokeWidth={width*(isHandler?.0025:.0012)} strokeDasharray={setup.roles[t.id]==='defense'?'7 5':undefined}/><rect x={x*width} y={Math.max(0,y*height-tagHeight)} width={width*(isHandler?.15:.065)} height={tagHeight} fill="white"/><text x={x*width+width*.005} y={Math.max(tagHeight*.75,y*height-tagHeight*.2)} fill="black" fontSize={width*.021} fontWeight="600">#{t.id}{isHandler?' · ball':''}</text></>}
    </g>})}
    {marking&&setup.basket&&<circle cx={setup.basket.x*width} cy={setup.basket.y*height} r="15" fill="none" stroke="white" strokeWidth="3"/>}
  </svg>;
}
export default function Home(){
  const [sampleLoaded,setSampleLoaded]=useState(false);
  const [clip,setClip]=useState<Clip>(sampleClip),[setup,setSetup]=useState<Setup>(sampleSetup);
  const [time,setTime]=useState(0),[videoUrl,setVideoUrl]=useState(''),[name,setName]=useState('The closing defender');
  const [busy,setBusy]=useState(false),[analyzing,setAnalyzing]=useState(false),[analyzedThrough,setAnalyzedThrough]=useState(-1),[progress,setProgress]=useState(0),[status,setStatus]=useState(''),[error,setError]=useState('');
  const [playing,setPlaying]=useState(false),[marking,setMarking]=useState(false),[ballMarking,setBallMarking]=useState(false),[markerTime,setMarkerTime]=useState<number|null>(null),[correctionTime,setCorrectionTime]=useState<number|null>(null);
  const [key,setKey]=useState(''),[keyDraft,setKeyDraft]=useState(''),[connected,setConnected]=useState(false),[dialog,setDialog]=useState(false);
  const [events,setEvents]=useState<DecisionEvent[]>([]),[selected,setSelected]=useState<string|null>(null),[showTracks,setShowTracks]=useState(true);
  const video=useRef<HTMLVideoElement>(null),input=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),urlRef=useRef(''),ballSeed=useRef<{time:number;x:number;y:number}|null>(null),analysisRun=useRef(0);
  const frame=useMemo(()=>atTime(clip.frames,time),[clip,time]);
  const manualSetup:Setup=correctionTime===frame?.time?setup:{handler:null,roles:{},basket:null};
  const effectiveSetup=useMemo(()=>frame?resolveSetup(clip,frame,setup,markerTime,correctionTime):setup,[setup,markerTime,correctionTime,frame,clip]);
  const state=useMemo(()=>frame?buildState(clip,frame,effectiveSetup):null,[clip,frame,effectiveSetup]);
  const snapshot=useMemo(()=>state?{state,setup:effectiveSetup}:null,[state,effectiveSetup]);
  const currentEvent=events.find(e=>e.id===selected);
  const liveEvent=useMemo(()=>visibleDecision(events,snapshot,playing),[events,snapshot,playing]);
  const displayedEvent=currentEvent??liveEvent;
  const displayedState=displayedEvent?.state??state;
  const hasClip=!!videoUrl||sampleLoaded;
  const result=displayedEvent?.decision??(clip.sample&&sampleLoaded&&state?baseline(state):null);
  const passProbability=result?result.probabilities.PASS_LEFT+result.probabilities.PASS_RIGHT:null;
  const currentPlayers=frame?.tracks.filter(t=>t.kind==='player')??[];
  const ready=!!state,hasConnection=!!(key||connected),disabled=busy||analyzing;
  const playableThrough=playbackLimit(analyzedThrough,clip.duration,analyzing);
  const initialBufferReady=hasInitialAnalysisBuffer(analyzedThrough,clip.duration);
  const live=useLiveJev({snapshot,clip,apiKey:key,configured:connected,suspended:clip.sample||!!selected,events,
    onResult:event=>setEvents(previous=>[...previous.filter(e=>snapshotKey(e)!==snapshotKey(event)),event].sort((a,b)=>a.state.time_seconds-b.state.time_seconds)),
    onRejectedKey:()=>{setKey('');setConnected(false);try{sessionStorage.removeItem('jev-openrouter-key')}catch{}},
  });
  const {evaluating,streamError}=live;
  useEffect(()=>{
    try{setKey(sessionStorage.getItem('jev-openrouter-key')??'')}catch{}
    fetch('/api/decision').then(r=>r.json()).then(d=>setConnected((d as {configured?:boolean}).configured===true)).catch(()=>{});
    return()=>{abort.current?.abort();if(urlRef.current)URL.revokeObjectURL(urlRef.current)};
  },[]);
  useEffect(()=>{if(!clip.sample||!playing)return;const timer=setInterval(()=>setTime(t=>{if(t>=clip.duration-.05){setPlaying(false);return clip.duration}return Math.min(clip.duration,t+.05)}),50);return()=>clearInterval(timer)},[playing,clip]);
  const seek=(t:number)=>{const next=Math.min(t,playableThrough);live.invalidate();setPlaying(false);video.current?.pause();setTime(next);if(video.current)video.current.currentTime=next;setSelected(null);setMarking(false)};
  const changeSetup=(s:Setup)=>{live.invalidate();setSetup(s);setCorrectionTime(frame?.time??null);setSelected(null)};
  const togglePlay=async()=>{
    if(playing){video.current?.pause();setPlaying(false);return;}
    setSelected(null);setMarking(false);
    if(analyzing&&!initialBufferReady){setStatus(`Preparing ${Math.min(10,Math.round(clip.duration))} seconds of analysis before playback…`);return;}
    if(time>=clip.duration-.1){live.invalidate();setTime(0);if(video.current)video.current.currentTime=0;}
    if(video.current){try{await video.current.play()}catch{setError('Playback could not start. Try seeking to another moment.');return}}
    setPlaying(true);
  };
  async function upload(file?:File){
    if(!file||busy)return;setError('');
    if(!file.type.startsWith('video/')&&!/\.(mp4|mov|webm|m4v)$/i.test(file.name)){setError('Choose an MP4, MOV or WebM basketball clip.');return}
    if(file.size>1024*1024*1024){setError('Choose a video smaller than 1 GB.');return}
    const run=++analysisRun.current;live.invalidate();video.current?.pause();setPlaying(false);setBusy(true);setAnalyzing(true);setAnalyzedThrough(-1);ballSeed.current=null;setProgress(0);setStatus('Opening your clip…');abort.current=new AbortController();
    try{
      // The visible player owns this object URL; the detector has its own decoder.
      // Local playback is therefore available before the first detection batch.
      if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current=URL.createObjectURL(file);
      setVideoUrl(urlRef.current);setSampleLoaded(false);setClip({duration:0,width:16,height:9,frames:[],sample:false});setTime(0);setName(file.name);setSetup({handler:null,roles:{},basket:null});setMarkerTime(null);setCorrectionTime(null);setEvents([]);setSelected(null);setBallMarking(false);
      const {analyzeVideoIncrementally}:{analyzeVideoIncrementally:typeof AnalyzeVideoIncrementally}=await import('@/lib/vision');
      let foundPlayers=false;const analyzedFrames:Frame[]=[];
      // This queue is independent of the media clock. It receives frames in
      // decode order and only submits causal state/context to the server.
      const precompute=hasConnection?new TimestampedAnalysisQueue({
        async run(snapshot,context,signal){const response=await fetch('/api/decision',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({items:[{state:snapshot.state,context:context.map(item=>item.state)}]}),signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});const result=await response.json() as {decisions?:Decision[];error?:string};if(!response.ok||!result.decisions?.[0])throw Error(result.error??'Jev is unavailable.');return result.decisions[0];},
        onResult:({snapshot,decision})=>{if(run===analysisRun.current)setEvents(previous=>[...previous.filter(event=>snapshotKey(event)!==snapshotKey(snapshot)),{...snapshot,id:crypto.randomUUID(),decision}].sort((a,b)=>a.state.time_seconds-b.state.time_seconds));},
        onError:reason=>{if(run===analysisRun.current)setError(reason instanceof Error?reason.message:'Background Jev analysis stopped.');},
      }):null;
      await analyzeVideoIncrementally(file,{
        onReady:meta=>{setClip({...meta,frames:[],sample:false});setBusy(false);setStatus('Preparing the first analysis buffer…');},
        onBatch:(batch,through,meta)=>{foundPlayers||=batch.some(f=>f.tracks.some(t=>t.kind==='player'));for(const nextFrame of batch){analyzedFrames.push(nextFrame);const causalClip:Clip={...meta,frames:analyzedFrames,sample:false};const nextSetup=resolveSetup(causalClip,nextFrame,{handler:null,roles:{},basket:null},null);const nextState=buildState(causalClip,nextFrame,nextSetup);if(nextState)precompute?.enqueue({state:nextState,setup:nextSetup});}setClip(current=>({...current,frames:[...current.frames,...batch]}));setAnalyzedThrough(through);},
        onProgress:(p,m)=>{setProgress(p);setStatus(m)},getBallSeed:()=>ballSeed.current,
      },abort.current.signal);
      setStatus(foundPlayers?'Analysis caught up to the end of the clip.':'Analysis finished with no player tracks. The local video is still available below.');
      if(!foundPlayers)setError('No players were detected in this file. Play the uploaded preview to check it contains the intended basketball footage.');
      // Do not block playback on provider latency. Cached timestamped results
      // arrive as they are ready; late results are still tied to their frame.
    }catch(e){
      if(e instanceof Error&&e.name!=='AbortError'){setError(e.message.includes('dynamically imported')?'The detector could not load. Reload the page and try again.':e.message);setStatus('Analysis stopped. Your previous possession is unchanged.')}
      else setStatus('Analysis cancelled. Your previous possession is unchanged.');
    }finally{setBusy(false);setAnalyzing(false);abort.current=null;if(input.current)input.current.value=''}
  }
  function loadSample(){
    if(busy||analyzing)return;analysisRun.current++;live.invalidate();video.current?.pause();setPlaying(false);setSampleLoaded(true);setAnalyzedThrough(-1);setClip(sampleClip());setSetup(sampleSetup);setVideoUrl('');
    if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current='';setName('The closing defender');setTime(0);setEvents([]);setSelected(null);setError('');setStatus('');setMarkerTime(null);setCorrectionTime(null);
  }
  function openEvent(e:DecisionEvent){if(busy)return;seek(e.state.time_seconds);setSetup(e.setup);setMarkerTime(e.state.time_seconds);setCorrectionTime(e.state.time_seconds);setSelected(e.id)}
  function exportData(){const blob=new Blob([JSON.stringify({schema_version:'1.0',clip:{name,duration:clip.duration,width:clip.width,height:clip.height,source:clip.sample?'sample_fixture':'uploaded_clip'},tracks:clip.frames,events},null,2)],{type:'application/json'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='jev-possession.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
  // Read-only state, including the exact response currently shown beside the replay.
  const readable=useRef({state,events,displayedDecision:displayedEvent??null,playing,evaluating});readable.current={state,events,displayedDecision:displayedEvent??null,playing,evaluating};
  useEffect(()=>{const context=(document as unknown as {modelContext?:{registerTool:(t:unknown,o:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;if(!context?.registerTool)return;const life=new AbortController();Promise.resolve(context.registerTool({name:'read_court_decision',description:'Read the current basketball court state, live displayed decision and timeline. Does not upload video or call Jev.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:(args:unknown)=>{if(!args||typeof args!=='object'||Object.keys(args).length)throw Error('Expected an empty object.');return structuredClone(readable.current)}},{signal:life.signal})).catch(()=>{});return()=>life.abort()},[]);
  return <main>
    <header><h1>JEV</h1><div className="header-actions"><button onClick={()=>input.current?.click()} disabled={busy||analyzing}><Upload size={16}/>Upload video</button><button onClick={()=>{setKeyDraft(key);setDialog(true)}}>{hasConnection?'Connected to Jev':'Connect Jev'}</button></div></header>
    <input ref={input} className="hidden-input" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" onChange={e=>void upload(e.target.files?.[0])} disabled={busy||analyzing} aria-label="Upload basketball video"/>
    {error&&<div className="notice" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
    <div className="workspace">
      <section className="clip-column" aria-label="Basketball clip">
        <div className="section-heading"><h2>Clip</h2>{hasClip&&<span className="filename" title={name}>{name}</span>}</div>
        <div className="video-stage" style={{aspectRatio:hasClip?`${clip.width}/${clip.height}`:'16/9'}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void upload(e.dataTransfer.files[0])}}>
          {!hasClip?<button className="upload-empty" disabled={busy||analyzing} onClick={()=>input.current?.click()}><Upload size={24}/><span>Drop a basketball video</span><small>MP4, MOV or WebM · up to 1 GB</small></button>:<>
            {!clip.sample&&<video ref={video} src={videoUrl} playsInline muted preload="auto" onLoadedMetadata={()=>{if(video.current)video.current.currentTime=time}} onTimeUpdate={()=>{if(!video.current)return;const next=video.current.currentTime;if(analyzing&&next>playableThrough){video.current.pause();video.current.currentTime=playableThrough;setTime(playableThrough);setStatus('Playback paused at the end of the analysis buffer.');return}setTime(next)}} onEnded={()=>setPlaying(false)} onPause={()=>setPlaying(false)} onPlay={()=>setPlaying(true)} onError={()=>setError('The clip could not be played. Try an H.264 MP4 or WebM file.')} aria-label="Uploaded basketball video"/>}
            {(showTracks||marking||ballMarking)&&<Overlay clip={clip} frame={frame} setup={effectiveSetup} marking={marking||ballMarking} onMark={p=>{if(ballMarking){ballSeed.current={time:frame?.time??time,...p};setBallMarking(false);setStatus('Ball tracking will initialize from this point in the next timestamped batch.');return}changeSetup({...manualSetup,basket:p});setMarkerTime(frame?.time??null);setMarking(false)}}/>}
          </>}
          {busy&&<div className="stage-cover" role="status"><LoaderCircle className="spin"/><strong>{status}</strong><progress value={progress} max="1"/><button onClick={()=>abort.current?.abort()}>Cancel</button></div>}
          {(marking||ballMarking)&&<div className="mark-help">Click the {ballMarking?'ball or its handler':'basket'}</div>}
        </div>
        {hasClip&&<><div className="playbar"><button aria-label={playing?'Pause replay':'Play replay'} disabled={busy} onClick={()=>void togglePlay()}>{playing?<Pause size={19}/>:<Play size={19}/>}</button><span>{stamp(time)}</span><input aria-label="Replay time" type="range" min="0" max={playableThrough} step=".05" value={Math.min(time,playableThrough)} disabled={busy||playableThrough===0} onChange={e=>seek(Number(e.target.value))}/><span>{stamp(clip.duration)}</span></div>
          <div className="detection-line"><span>{currentPlayers.length} players · {frame?.ball_visible?'Ball visible':'Ball not visible'}{frame?.ball_track_confidence!==undefined?` · Track ${Math.round(frame.ball_track_confidence*100)}%`:''}{effectiveSetup.handler!==null?` · Handler #${effectiveSetup.handler}`:''}</span><button className="text-button" aria-pressed={showTracks} onClick={()=>setShowTracks(v=>!v)}>{showTracks?'Hide':'Show'} detections</button></div>
          {!clip.sample&&<p className="analysis-buffer" role="status">{analyzing?`Analyzed through ${stamp(Math.max(0,analyzedThrough))} · ${initialBufferReady?'playback buffer ready':'building playback buffer'}`:`Analyzed through ${stamp(clip.duration)} · complete`}</p>}
          {clip.sample&&<p className="small">Synthetic sample · rules only</p>}
          {currentEvent&&<button onClick={()=>void togglePlay()}>Resume live replay</button>}
        </>}
        <details className="extras"><summary>NBA clips</summary><ul className="source-clips">
          <li><a href="https://www.nba.com/watch/video/min-14-0-run-uncut?collection=uncut-moments&plsrc=nba" target="_blank" rel="noreferrer">Timberwolves–Nuggets · uncut run</a><span>4:52</span></li>
          <li><a href="https://www.nba.com/watch/video/mavericks-big-run-vs-knicks-uncut?collection=uncut-moments&plsrc=nba" target="_blank" rel="noreferrer">Mavericks–Knicks · uncut run</a><span>6:00</span></li>
          <li><a href="https://www.nba.com/watch/video/uncut-lookback-to-celtics-vs-knicks-2ot-thriller-opening-night-2021?collection=uncut-moments&plsrc=nba" target="_blank" rel="noreferrer">Celtics–Knicks · double-overtime finish</a><span>8:31</span></li>
          <li><a href="https://www.nba.com/watch/video/cavaliers-warriors-2016-nba-finals-game-7" target="_blank" rel="noreferrer">Cavaliers–Warriors · 2016 Finals, Game 7</a><span>Full game</span></li>
        </ul><p className="small">Official viewing links. Upload a local copy you’re allowed to use; these pages aren’t direct video imports. Longer videos are supported. Processing time grows with length.</p></details>
        <details className="extras"><summary>Tools</summary><div className="tool-actions"><button onClick={loadSample} disabled={busy}>Load synthetic sample</button><button onClick={exportData} disabled={!hasClip||busy}>Export analysis</button></div>
          {hasClip&&<><label>Correct ball handler<select disabled={disabled||!currentPlayers.length} value={effectiveSetup.handler??''} onChange={e=>changeSetup({...manualSetup,handler:e.target.value?Number(e.target.value):null,handlerSource:'user_confirmed',handlerConfidence:1})}><option value="">Automatic</option>{currentPlayers.map(t=><option key={t.id} value={t.id}>Player #{t.id}</option>)}</select></label><div className="tool-actions"><button disabled={busy||clip.sample} onClick={()=>{setPlaying(false);video.current?.pause();setMarking(v=>!v);setShowTracks(true)}}>{marking?'Cancel marking':'Correct basket'}</button><button disabled={busy||clip.sample} onClick={()=>{setPlaying(false);video.current?.pause();setBallMarking(v=>!v);setShowTracks(true)}}>{ballMarking?'Cancel ball mark':'Initialize ball tracking'}</button><button disabled={busy} onClick={()=>{changeSetup({handler:null,roles:{},basket:null});setMarkerTime(null)}}>Restore automatic detection</button></div><div className="track-assignments">{currentPlayers.map(t=><label key={t.id}>#{t.id}<select aria-label={`Team for player ${t.id}`} disabled={disabled||effectiveSetup.handler===t.id} value={effectiveSetup.roles[t.id]??''} onChange={e=>changeSetup({...manualSetup,roles:{...manualSetup.roles,[t.id]:e.target.value as Role}})}><option value="" disabled>Unknown</option><option value="offense">Offense</option><option value="defense">Defense</option><option value="ignore">Ignore</option></select></label>)}</div></>}
        </details>
      </section>
      <aside className="analysis-column" aria-label="Jev analysis">
        <div className="section-heading"><h2>Jev analysis</h2>{displayedEvent&&<time>{stamp(displayedEvent.state.time_seconds)}</time>}</div>
        <p className="live-status" role="status">{busy?'Opening local video…':!hasClip?'Upload a video to begin.':clip.sample?'Rules preview — not Jev':!hasConnection?'Connect Jev to analyze this video.':streamError?'Analysis paused':!ready?trackingMessage(frame):evaluating?'Updating cached analysis…':currentEvent?'Saved moment':playing?'Following timestamped analysis':'Paused — cached decisions stay attached to their frames'}</p>
        <div className="pass-result"><span>Pass now</span><strong>{passProbability===null?'—':`${Math.round(passProbability*100)}%`}</strong></div>
        <p className="small">Jev’s preference for passing now, not the chance a pass succeeds.</p>
        <div className="probabilities">{ACTIONS.map(a=><div key={a}><div><span>{label(a).toLowerCase().replace(/^./,c=>c.toUpperCase())}</span><strong>{result?`${(result.probabilities[a]*100).toFixed(1)}%`:'—'}</strong></div><div className="prob-track"><i style={{width:`${(result?.probabilities[a]??0)*100}%`}}/></div></div>)}</div>
        {result&&<p className="recommendation">Top choice: <strong>{label(result.choice).toLowerCase().replace(/^./,c=>c.toUpperCase())}</strong></p>}
        {streamError&&!clip.sample&&<div className="notice" role="alert"><span>{streamError}</span>{hasConnection&&<button onClick={live.retry}>Retry</button>}</div>}
        <details className="extras"><summary>What counts as a pass?</summary><p>Release the ball now to a visible teammate when the available lane and receiver’s space make passing preferable to shooting, driving or keeping possession.</p><p>Left and right refer to the screen, relative to the handler. “Pass now” adds those two probabilities. A side can contain several receivers.</p><p>Jev sees detected positions, defender distances, lane obstructions and movement. It does not see the video or the future. A clear lane in 2D is only an estimate: depth, reaching defenders and camera angle are unresolved.</p></details>
        <details className="extras"><summary>Detection details</summary><dl><div><dt>Handler</dt><dd>{hasClip&&displayedState?`#${displayedState.ball_handler}`:'Unknown'}</dd></div><div><dt>Nearest defender</dt><dd>{hasClip&&displayedState?pct(displayedState.defender_distance):'—'}</dd></div><div><dt>Team estimates</dt><dd>{hasClip&&displayedState?`${displayedState.spacing.visible_offense} offense / ${displayedState.spacing.visible_defense} defense`:'—'}</dd></div></dl>{hasClip&&displayedState?.teammate_positions.map(t=><p className="small" key={t.id}>#{t.id} · {t.side} · lane {t.passing_lane}</p>)}<p className="small">Track numbers are temporary, not jersey numbers. Distances are screen measurements. Teams and possession are estimates.</p>{hasClip&&displayedState&&<pre>{JSON.stringify(displayedState,null,2)}</pre>}<a className="small" href="https://huggingface.co/GabrieleGiudici/E-BARD-detection-models" target="_blank" rel="noreferrer">Detector: E-BARD / G. Giudici</a></details>
        <details className="extras"><summary>Decision history ({events.length})</summary><div className="events">{events.map(e=><button key={e.id} className="event" onClick={()=>openEvent(e)}><time>{stamp(e.state.time_seconds)}</time><span>Pass {Math.round((e.decision.probabilities.PASS_LEFT+e.decision.probabilities.PASS_RIGHT)*100)}%</span></button>)}</div>{currentEvent&&<label>Observed action<select value={currentEvent.observed??''} onChange={e=>setEvents(a=>a.map(v=>v.id===currentEvent.id?{...v,observed:e.target.value as Action}:v))}><option value="" disabled>Select action</option>{ACTIONS.map(a=><option key={a} value={a}>{label(a)}</option>)}</select></label>}</details>
      </aside>
    </div>
    <Dialog open={dialog} onOpenChange={setDialog}><DialogContent className="connection-dialog"><DialogTitle>Connect to Jev</DialogTitle><DialogDescription className="muted">Use your OpenRouter key to evaluate this possession with Jev. Video stays on this device; only measured court facts are sent.</DialogDescription><form onSubmit={e=>{e.preventDefault();const nextKey=keyDraft.trim();setKey(nextKey);try{sessionStorage.setItem('jev-openrouter-key',nextKey)}catch{}setDialog(false);if(!clip.sample&&!playing)void togglePlay()}}><label>OpenRouter API key<input type="password" value={keyDraft} onChange={e=>setKeyDraft(e.target.value)} placeholder="sk-or-…" autoComplete="off" spellCheck={false}/></label><p className="small">Kept in this tab’s session, including page refreshes. Closing the tab or clearing the key removes it. During replay, Jev checks up to twice a second using your OpenRouter credits.</p><p className="small">Model: ~typesafe/jev-latest</p><div className="dialog-actions"><button type="button" onClick={()=>{setKey('');setKeyDraft('');try{sessionStorage.removeItem('jev-openrouter-key')}catch{}setDialog(false)}}>Clear key</button><button className="primary" type="submit" disabled={!keyDraft.trim()}>Use this key</button></div><a className="small" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get an OpenRouter key ↗</a></form></DialogContent></Dialog>
  </main>
}
