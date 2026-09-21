"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Activity, ArrowUpRight, Play, Pause, RotateCcw, Crosshair, ScanLine, Download, LockKeyhole, Check, X, ChevronRight, Film, ArrowLeftRight, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ACTIONS, atTime, baseline, buildState, feet, sampleClip, sampleSetup, type Action, type Clip, type Frame, type Role, type Setup } from '@/lib/court';
import type { analyzeVideo as AnalyzeVideo } from '@/lib/vision';
import { resolveSetup } from '@/lib/possession';
import {useLiveJev} from '@/hooks/use-live-jev';
import {snapshotKey,visibleDecision,type DecisionEvent} from '@/lib/live-decisions';
const label=(a:Action)=>a.replaceAll('_',' ');
const stamp=(t:number)=>`0:${t.toFixed(1).padStart(4,'0')}`;
const pct=(n:number|null)=>n===null?'Unknown':`${(n*100).toFixed(1)}% width`;
function Overlay({clip,frame,setup,marking,onMark}:{clip:Clip;frame?:Frame;setup:Setup;marking:boolean;onMark:(p:{x:number;y:number})=>void}){
  const svg=useRef<SVGSVGElement>(null);
  const width=clip.width,height=clip.height;
  return <svg ref={svg} className={`overlay ${marking?'marking':''}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={clip.sample?'Sample possession with ten generic player tracks':'Detected players, ball, trajectories and basket marker'} onClick={e=>{if(!marking||!svg.current)return;const r=svg.current.getBoundingClientRect();onMark({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height})}}>
    {clip.sample&&<g stroke="#567173" strokeWidth="2" fill="none"><path d="M55 28H645V395H55Z M255 28V180H445V28 M290 28V160H410V28 M98 28V75A252 252 0 0 0 602 75V28"/><circle cx="350" cy="180" r="58"/><path d="M318 42H382"/><circle cx="350" cy="60" r="10"/><path d="M55 395H645 M285 395A65 65 0 0 1 415 395"/></g>}
    {frame?.tracks.map(t=>{const role=setup.roles[t.id],color=t.kind==='ball'?'#ffbc62':setup.handler===t.id?'#d4f77d':role==='offense'?'#70c7fa':role==='defense'?'#ef9e8a':'#aab7c0';if(role==='ignore')return null;const p=feet(t);const [x,y,w,h]=t.box;const trail=clip.frames.filter(f=>f.time>=frame.time-1.5&&f.time<=frame.time).flatMap(f=>{const tr=f.tracks.find(a=>a.id===t.id);if(!tr)return [];const pt=feet(tr);return [`${pt.x*width},${pt.y*height}`]});return <g key={t.id}>
      {t.kind==='player'&&<polyline points={trail.join(' ')} fill="none" stroke={color} strokeWidth={width*.003} strokeOpacity=".65" strokeDasharray={`${width*.006} ${width*.005}`}/>}
      {t.kind==='ball'?<circle cx={(x+w/2)*width} cy={(y+h/2)*height} r={width*.01} fill="#ffbc62" stroke="#0b1116" strokeWidth={width*.002}/>:clip.sample?<><circle cx={p.x*width} cy={p.y*height} r={setup.handler===t.id?19:15} fill={color} stroke="#142328" strokeWidth="3"/>{setup.handler===t.id&&<circle cx={p.x*width} cy={p.y*height} r="26" fill="none" stroke={color} strokeOpacity=".4"/>}<text x={p.x*width} y={p.y*height+4} textAnchor="middle" fill="#0b1116" fontSize="12" fontWeight="bold">{t.id}</text></>:<><rect x={x*width} y={y*height} width={w*width} height={h*height} rx="3" fill={color} fillOpacity=".04" stroke={color} strokeWidth={width*.0025}/><rect x={x*width} y={Math.max(0,y*height-width*.022)} width={width*.055} height={width*.022} rx="2" fill={color}/><text x={x*width+width*.004} y={Math.max(width*.016,y*height-width*.006)} fill="#091217" fontSize={width*.014} fontWeight="bold">#{t.id}</text></>}
    </g>})}
    {setup.basket&&!clip.sample&&<g stroke="#d4f77d" strokeWidth={width*.003}><circle cx={setup.basket.x*width} cy={setup.basket.y*height} r={width*.016} fill="none"/><path d={`M${setup.basket.x*width-width*.025} ${setup.basket.y*height}h${width*.05} M${setup.basket.x*width} ${setup.basket.y*height-width*.025}v${width*.05}`}/></g>}
  </svg>;
}
export default function Home(){
  const [clip,setClip]=useState<Clip>(sampleClip),[setup,setSetup]=useState<Setup>(sampleSetup);
  const [time,setTime]=useState(4.25),[videoUrl,setVideoUrl]=useState(''),[name,setName]=useState('The closing defender');
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[status,setStatus]=useState(''),[error,setError]=useState('');
  const [playing,setPlaying]=useState(false),[marking,setMarking]=useState(false),[markerTime,setMarkerTime]=useState<number|null>(null),[correctionTime,setCorrectionTime]=useState<number|null>(null);
  const [key,setKey]=useState(''),[keyDraft,setKeyDraft]=useState(''),[connected,setConnected]=useState(false),[dialog,setDialog]=useState(false);
  const [events,setEvents]=useState<DecisionEvent[]>([]),[selected,setSelected]=useState<string|null>(null),[showTracks,setShowTracks]=useState(true);
  const video=useRef<HTMLVideoElement>(null),input=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),urlRef=useRef('');
  const frame=useMemo(()=>atTime(clip.frames,time),[clip,time]);
  const manualSetup:Setup=correctionTime===frame?.time?setup:{handler:null,roles:{},basket:null};
  const effectiveSetup=useMemo(()=>frame?resolveSetup(clip,frame,setup,markerTime,correctionTime):setup,[setup,markerTime,correctionTime,frame,clip]);
  const state=useMemo(()=>frame?buildState(clip,frame,effectiveSetup):null,[clip,frame,effectiveSetup]);
  const snapshot=useMemo(()=>state?{state,setup:effectiveSetup}:null,[state,effectiveSetup]);
  const currentEvent=events.find(e=>e.id===selected);
  const liveEvent=useMemo(()=>visibleDecision(events,snapshot,playing),[events,snapshot,playing]);
  const displayedEvent=currentEvent??liveEvent;
  const displayedState=displayedEvent?.state??state;
  const result=displayedEvent?.decision??(clip.sample&&state?baseline(state):null);
  const currentPlayers=frame?.tracks.filter(t=>t.kind==='player')??[];
  const hasPlayerTracks=useMemo(()=>clip.frames.some(f=>f.tracks.some(t=>t.kind==='player')),[clip]);
  const ready=!!state,hasConnection=!!(key||connected),disabled=busy;
  const live=useLiveJev({snapshot,clip,apiKey:key,configured:connected,suspended:busy||clip.sample||!!selected,events,
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
  const seek=(t:number)=>{live.invalidate();setPlaying(false);video.current?.pause();setTime(t);if(video.current)video.current.currentTime=t;setSelected(null);setMarking(false)};
  const changeSetup=(s:Setup)=>{live.invalidate();setSetup(s);setCorrectionTime(frame?.time??null);setSelected(null)};
  const togglePlay=async()=>{
    if(playing){video.current?.pause();setPlaying(false);return;}
    setSelected(null);setMarking(false);
    if(time>=clip.duration-.1){live.invalidate();setTime(0);if(video.current)video.current.currentTime=0;}
    if(video.current){try{await video.current.play()}catch{setError('Playback could not start. Try seeking to another moment.');return}}
    setPlaying(true);
  };
  async function upload(file?:File){
    if(!file||busy)return;setError('');
    if(!file.type.startsWith('video/')&&!/\.(mp4|mov|webm|m4v)$/i.test(file.name)){setError('Choose an MP4, MOV or WebM basketball clip.');return}
    if(file.size>80*1024*1024){setError('Choose a clip smaller than 80 MB.');return}
    live.invalidate();video.current?.pause();setPlaying(false);setBusy(true);setProgress(0);setStatus('Opening your clip…');abort.current=new AbortController();
    try{
      const {analyzeVideo}:{analyzeVideo:typeof AnalyzeVideo}=await import('@/lib/vision');
      const next=await analyzeVideo(file,(p,m)=>{setProgress(p);setStatus(m)},abort.current.signal);
      if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current=URL.createObjectURL(file);
      setVideoUrl(urlRef.current);setClip(next);setTime(0);setName(file.name);setSetup({handler:null,roles:{},basket:null});setMarkerTime(null);setCorrectionTime(null);setEvents([]);setSelected(null);
      const foundPlayers=next.frames.some(f=>f.tracks.some(t=>t.kind==='player'));
      setStatus(foundPlayers?`Tracked ${next.frames.length} frames. Jev follows the replay automatically.`:'Analysis finished with no player tracks. The uploaded video is available below.');
      if(!foundPlayers)setError('No players were detected in this file. Play the uploaded preview to check it contains the intended basketball footage.');
    }catch(e){
      if(e instanceof Error&&e.name!=='AbortError'){setError(e.message.includes('dynamically imported')?'The detector could not load. Reload the page and try again.':e.message);setStatus('Analysis stopped. Your previous possession is unchanged.')}
      else setStatus('Analysis cancelled. Your previous possession is unchanged.');
    }finally{setBusy(false);abort.current=null;if(input.current)input.current.value=''}
  }
  function loadSample(){
    if(busy)return;live.invalidate();video.current?.pause();setPlaying(false);setClip(sampleClip());setSetup(sampleSetup);setVideoUrl('');
    if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current='';setName('The closing defender');setTime(0);setEvents([]);setSelected(null);setError('');setStatus('');setMarkerTime(null);setCorrectionTime(null);
  }
  function openEvent(e:DecisionEvent){if(busy)return;seek(e.state.time_seconds);setSetup(e.setup);setMarkerTime(e.state.time_seconds);setCorrectionTime(e.state.time_seconds);setSelected(e.id)}
  function exportData(){const blob=new Blob([JSON.stringify({schema_version:'1.0',clip:{name,duration:clip.duration,width:clip.width,height:clip.height,source:clip.sample?'sample_fixture':'uploaded_clip'},tracks:clip.frames,events},null,2)],{type:'application/json'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='jev-possession.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
  // Read-only state, including the exact response currently shown beside the replay.
  const readable=useRef({state,events,displayedDecision:displayedEvent??null,playing,evaluating});readable.current={state,events,displayedDecision:displayedEvent??null,playing,evaluating};
  useEffect(()=>{const context=(document as unknown as {modelContext?:{registerTool:(t:unknown,o:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;if(!context?.registerTool)return;const life=new AbortController();Promise.resolve(context.registerTool({name:'read_court_decision',description:'Read the current basketball court state, live displayed decision and timeline. Does not upload video or call Jev.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:(args:unknown)=>{if(!args||typeof args!=='object'||Object.keys(args).length)throw Error('Expected an empty object.');return structuredClone(readable.current)}},{signal:life.signal})).catch(()=>{});return()=>life.abort()},[]);
  return <main>
    <header><a className="brand" href="/"><span className="logo">j.</span>JEV <span className="muted">/ COURT LAB</span></a><span className="tag">ONE POSSESSION · V1</span></header>
    <div className="intro"><div><p className="eyebrow">THE GAME, ONE DECISION AT A TIME</p><h1>See the next move.</h1></div><button onClick={()=>{setKeyDraft(key);setDialog(true)}} disabled={disabled}><LockKeyhole size={15}/>{key||connected?'Jev connection':'Connect OpenRouter'}<ArrowUpRight size={16}/></button></div>
    {error&&<div className="notice error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
    <div className="workspace">
      <aside className="panel input-panel"><h2>01 <span>Your possession</span></h2>
        <button className="drop" disabled={disabled} onClick={()=>input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void upload(e.dataTransfer.files[0])}}><Upload size={26}/><strong>Drop a basketball clip</strong><span>or click to choose a file</span><span>5–15 sec · up to 80 MB</span></button><input ref={input} className="hidden-input" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" onChange={e=>void upload(e.target.files?.[0])} disabled={disabled} aria-label="Upload basketball video"/>
        <p className="privacy"><LockKeyhole size={13}/> Video stays in your browser</p>
        <div className="divider"/>
        <div className="clip-info"><Film size={18}/><div><strong>{name}</strong><span>{clip.duration.toFixed(1)} seconds · {clip.sample?'sample schematic':`${clip.frames.length} sampled frames`}</span></div></div>
        <button className="text-button" onClick={loadSample} disabled={disabled}><RotateCcw size={14}/> Load sample possession</button>
        {busy&&<div className="progress" role="status"><p><LoaderCircle size={14} className="spin"/>{status}</p><progress value={progress} max="1"/><button onClick={()=>abort.current?.abort()}>Cancel analysis</button></div>}
        {!busy&&status&&<p className="small" role="status">{status}</p>}
        <div className="pipeline"><p className="eyebrow">THE PIPELINE</p><div><ScanLine size={17}/><span>Detect & track</span><small>{clip.sample?'Sample':'4 fps'}</small></div><div><Crosshair size={17}/><span>Reconstruct state</span><small>{ready?<Check size={14}/>:'Review'}</small></div><div><Activity size={17}/><span>Jev decisions</span><small>{clip.sample?'Preview':evaluating?'Updating':hasConnection?'Live':'Connect'}</small></div></div>
        <p className="small">CV observes. Geometry measures. Jev receives only the facts.</p>
      </aside>
      <section className="center-column"><div className="panel replay"><div className="panel-title"><h2>02 <span>Replay & tracks</span></h2><span className="tag">{clip.sample?'SAMPLE SCHEMATIC':`${currentPlayers.length} VISIBLE PLAYERS`}</span></div>
        <div className="replay-title"><h3>{name}</h3><span className="mono">{stamp(frame?.time??0)}</span></div>
        {clip.sample&&<p className="sample-note">Illustrative tracks · rules preview · upload a clip for real detection</p>}
        <div className={`video-stage ${clip.sample?'sample-stage':''}`} style={{aspectRatio:`${clip.width}/${clip.height}`}}>
          {!clip.sample&&<video ref={video} src={videoUrl} playsInline muted preload="auto" autoPlay={hasConnection} onLoadedMetadata={()=>{if(video.current)video.current.currentTime=time}} onTimeUpdate={()=>{if(video.current)setTime(video.current.currentTime)}} onEnded={()=>setPlaying(false)} onPause={()=>setPlaying(false)} onPlay={()=>setPlaying(true)} onError={()=>setError('The clip could not be played. Try an H.264 MP4 or WebM file.')} aria-label="Uploaded basketball possession"/>}
          {(showTracks||marking)&&<Overlay clip={clip} frame={frame} setup={effectiveSetup} marking={marking} onMark={p=>{changeSetup({...manualSetup,basket:p});setMarkerTime(frame?.time??null);setMarking(false)}}/>}
          {busy&&<div className="stage-cover"><LoaderCircle className="spin"/><strong>Tracking your possession</strong><span>{Math.round(progress*100)}%</span></div>}
          {marking&&<div className="mark-help">Click the basket in this frozen frame</div>}
        </div>
        <div className="playbar"><button className="icon-button" aria-label={playing?'Pause replay':'Play replay'} disabled={disabled} onClick={()=>void togglePlay()}>{playing?<Pause size={19}/>:<Play size={19}/>}</button><span>{stamp(time)}</span><input aria-label="Replay time" type="range" min="0" max={clip.duration} step=".05" value={time} disabled={disabled} onChange={e=>seek(Number(e.target.value))}/><span>{stamp(clip.duration)}</span></div>
        <div className="replay-toolbar"><div className="legend"><span><i className="offense"/>Offense</span><span><i className="defense"/>Defense</span><span><i className="handler"/>Handler</span></div><button className="text-button" disabled={disabled} aria-pressed={showTracks} onClick={()=>setShowTracks(a=>!a)}><ScanLine size={14}/>{showTracks?'Hide':'Show'} tracks</button></div>
        <div className="moment-bar"><span><Activity size={16}/> {currentEvent?'Saved decision':'Live replay'} <b>{stamp(frame?.time??0)}</b></span>{currentEvent?<button disabled={disabled} onClick={()=>void togglePlay()}>Resume live replay<ChevronRight size={15}/></button>:<span>Odds follow playback automatically</span>}</div>
        {currentEvent&&<details className="observed"><summary>Compare the observed action</summary><p>After watching the possession, you can label what the handler actually did.</p>{!clip.sample&&<label>Observed action<select value={currentEvent.observed??''} onChange={e=>setEvents(a=>a.map(v=>v.id===currentEvent.id?{...v,observed:e.target.value as Action}:v))}><option value="" disabled>Select observed action</option>{ACTIONS.map(a=><option key={a} value={a}>{label(a)}</option>)}</select></label>}</details>}
      </div>
      <div className="panel review"><div className="panel-title"><h2><Crosshair size={15}/><span>Automatic court state</span></h2><span className="small">{clip.sample?'Sample assignments':'Corrections are optional'}</span></div>
        {!clip.sample&&<p className="auto-summary">{effectiveSetup.handler!==null?`Ball handler: #${effectiveSetup.handler} · ${effectiveSetup.handlerSource==='user_confirmed'?'your correction':effectiveSetup.handlerSource==='recent_ball_track'?'recent ball track':'estimated from ball position'}`:'Ball handler is uncertain at this frame. Seek to a moment with a visible ball, or correct the handler below.'}</p>}
        <details className="corrections"><summary>Correct handler, teams or basket</summary><div className="review-controls"><label>Ball handler<select aria-label="Ball handler" disabled={disabled||!currentPlayers.length} value={effectiveSetup.handler??''} onChange={e=>{const id=e.target.value?Number(e.target.value):null;changeSetup({...manualSetup,handler:id,handlerSource:'user_confirmed',handlerConfidence:1})}}><option value="">Automatic selection</option>{currentPlayers.map(t=><option key={t.id} value={t.id}>Player #{t.id}</option>)}</select></label><div><span className="field-label">Basket position</span><button disabled={disabled||clip.sample||!currentPlayers.length} onClick={()=>{setPlaying(false);video.current?.pause();setMarking(v=>!v);setShowTracks(true)}}><Crosshair size={14}/>{marking?'Cancel marking':effectiveSetup.basket?'Re-mark basket':'Mark basket'}</button></div></div>
        {!clip.sample&&<p className="small">Jersey colors estimate teams; the detector estimates the hoop. These can be wrong. Track numbers are temporary IDs, not jersey numbers.</p>}
        {!clip.sample&&<button className="text-button" disabled={disabled} onClick={()=>{changeSetup({handler:null,roles:{},basket:null});setMarkerTime(null)}}>Restore automatic estimates</button>}
        <div className="track-assignments">{currentPlayers.map(t=><label key={t.id} className={effectiveSetup.handler===t.id?'is-handler':''}><span>#{t.id}</span><select aria-label={`Team for player ${t.id}`} disabled={disabled||effectiveSetup.handler===t.id} value={effectiveSetup.roles[t.id]??''} onChange={e=>changeSetup({...manualSetup,roles:{...manualSetup.roles,[t.id]:e.target.value as Role}})}><option value="" disabled>Assign team</option><option value="offense">Offense</option><option value="defense">Defense</option><option value="ignore">Ignore</option></select></label>)}</div>
        {!currentPlayers.length&&<p className="small">{hasPlayerTracks?'No players detected at this moment. Select a different frame.':'No player tracks in this clip. Play the preview to check the file, then upload the intended possession.'}</p>}</details>
      </div></section>
      <aside className="panel decision-panel"><h2>03 <span>Decision odds</span></h2>
        <p className="eyebrow">{clip.sample?'RULES PREVIEW · SAMPLE':currentEvent?'JEV · SAVED MOMENT':'JEV · LIVE REPLAY'}</p>
        <div className={`live-status ${hasConnection&&!streamError?'connected':''}`} role="status">
          {evaluating?<LoaderCircle size={13} className="spin"/>:<i/>}
          <span>{clip.sample?'Illustrative rules follow the replay':!hasConnection?'OpenRouter connection needed':streamError?'Live analysis paused':currentEvent?'Inspecting a saved decision':!ready?'Possession uncertain':evaluating?'Updating odds…':playing?'Following the play':'Ready — press play for live odds'}</span>
          {displayedEvent&&<small>Jev at {stamp(displayedEvent.state.time_seconds)}</small>}
        </div>
        <div className="choice-heading"><h3>{result?label(result.choice).toLowerCase().replace(/^./,c=>c.toUpperCase()):!hasConnection?'Connect to see Jev':!ready?'Handler uncertain':evaluating?'Reading the court…':'Waiting for Jev'}</h3>{result&&<ArrowUpRight size={28}/>}</div>
        <p className="small">{result?.source==='baseline'?'Illustrative rule weights, not Jev probabilities.':currentEvent?'Saved probabilities for this timestamp. Resume replay to follow the live play.':result?'Latest Jev judgment. New court states update these probabilities during playback.':!hasConnection?'Your clip is tracked locally. Connect once, then watch the probabilities move.':!ready?'Waiting for clear possession evidence. The replay continues.':'Jev is analyzing the latest court state automatically.'}</p>
        <div className="probabilities">{ACTIONS.map(a=><div className={result?.choice===a?'winning':''} key={a}><div><span>{label(a)}</span><strong>{result?`${(result.probabilities[a]*100).toFixed(1)}%`:'—'}</strong></div><div className="prob-track"><i style={{width:`${(result?.probabilities[a]??0)*100}%`}}/></div></div>)}</div>
        {!hasConnection&&!clip.sample&&<button className="primary" disabled={disabled} onClick={()=>{setKeyDraft(key);setDialog(true)}}><LockKeyhole size={16}/>Connect OpenRouter</button>}
        {streamError&&!clip.sample&&<div className="live-error" role="alert"><p>{streamError}</p>{hasConnection&&<button disabled={disabled} onClick={live.retry}>Retry live analysis</button>}</div>}
        {!clip.sample&&hasConnection&&!currentEvent&&<p className="small">Checks up to twice a second. Playback never waits for Jev; older responses are timestamped and outdated odds are hidden.</p>}
        {!ready&&<p className="small">{hasPlayerTracks?'Possession is uncertain. Use a frame with a visible ball or correct the handler. Team assignments are optional.':'Jev needs player tracks before it can evaluate. Check the video preview and upload the intended clip.'}</p>}
        {result?.source==='jev'&&<p className="model-meta">{result.model}<br/>Confidence {(result.confidence*100).toFixed(1)}% · {result.latency_ms} ms</p>}
        <div className="divider"/><h2 className="state-heading">{displayedEvent?`Decision state · ${stamp(displayedEvent.state.time_seconds)}`:'Reconstructed state'}</h2><dl className="metrics"><div><dt>Ball handler</dt><dd>{displayedState?`Player #${displayedState.ball_handler}`:'Uncertain'}</dd></div><div><dt>Possession source</dt><dd>{displayedState?displayedState.handler_source==='user_confirmed'?'Your correction':displayedState.handler_source==='recent_ball_track'?'Recent ball track':'Ball proximity':'—'}</dd></div><div><dt>Team estimates</dt><dd>{displayedState?`${displayedState.spacing.visible_offense} offense · ${displayedState.spacing.visible_defense} defense`: '—'}</dd></div><div><dt>Nearest defender</dt><dd>{displayedState?pct(displayedState.defender_distance):'—'}</dd></div><div><dt>Basket distance</dt><dd>{displayedState?pct(displayedState.basket_distance):'—'}</dd></div><div><dt>Movement</dt><dd>{displayedState?`${(displayedState.movement.speed*100).toFixed(1)}%/sec`:'—'}</dd></div><div><dt>Team spacing</dt><dd>{displayedState?pct(displayedState.spacing.mean_teammate_distance):'—'}</dd></div><div><dt>Ball detection</dt><dd>{(displayedState?.ball_detected??frame?.tracks.some(t=>t.kind==='ball'))?'Visible':'Not detected'}</dd></div></dl>
        {displayedState?.teammate_positions.slice(0,4).map(t=><div className="lane" key={t.id}><ArrowLeftRight size={14}/><span>#{t.id} · {t.side}</span><strong>{t.passing_lane==='clear'?'Clear lane':t.passing_lane==='blocked'?'Blocked':'Unknown'}</strong></div>)}
        <p className="small measurement-note">Distances are fractions of image width, not feet. Camera perspective affects all measurements.</p>
        <details><summary>Inspect facts sent to Jev</summary><pre>{displayedState?JSON.stringify(displayedState,null,2):'Possession is uncertain. Choose a frame with visible ball evidence, or correct the handler.'}</pre></details>
      </aside>
    </div>
    <section className="panel timeline"><div className="panel-title"><h2>Decision timeline <span className="count">{events.length}</span></h2><button className="text-button" disabled={disabled} onClick={exportData}><Download size={15}/> Export analysis</button></div>
      {!events.length?<div className="timeline-empty"><div className="timeline-line"><i/><i/><i/><i/><i/></div><p>Press play. Watch the odds move with the possession.</p><span>{clip.sample?'Upload a clip for Jev’s live decision timeline.':'Jev updates appear here automatically. Select one to inspect it.'}</span></div>:<div className="events">{events.map((e,i)=>{const prior=events.slice(0,i).findLast(p=>p.decision.source===e.decision.source&&p.state.time_seconds<e.state.time_seconds);const pass=e.decision.probabilities.PASS_LEFT+e.decision.probabilities.PASS_RIGHT;const priorPass=prior?prior.decision.probabilities.PASS_LEFT+prior.decision.probabilities.PASS_RIGHT:null;const closing=prior&&e.state.defender_distance!==null&&prior.state.defender_distance!==null&&e.state.defender_distance<prior.state.defender_distance-.01;return <button className={`event ${selected===e.id?'selected':''}`} key={e.id} disabled={disabled} onClick={()=>openEvent(e)}><time>{stamp(e.state.time_seconds)}</time><span><strong>{closing?'Defender closes':`Decision ${i+1}`}</strong><small>{e.decision.source==='jev'?'Jev':'Rules preview'} · {e.state.source==='sample_fixture'?'sample':'uploaded clip'}</small></span><span className="event-action">{label(e.decision.choice)}<small>Pass {priorPass===null?'':`${Math.round(priorPass*100)}% → `}{Math.round(pass*100)}%</small></span>{e.observed&&<span className="observed-tag">Observed: {label(e.observed)}{e.observed===e.decision.choice?' · match':' · differs'}</span>}<ChevronRight size={17}/></button>})}</div>}
    </section>
    <footer><span>CV observes. Geometry measures. Jev decides.</span><a href="https://huggingface.co/GabrieleGiudici/E-BARD-detection-models" target="_blank" rel="noreferrer">Detection: E-BARD · G. Giudici</a><a href="https://openrouter.ai/~typesafe/jev-latest" target="_blank" rel="noreferrer">Powered by TypeSafe Jev <ArrowUpRight size={12}/></a></footer>
    <Dialog open={dialog} onOpenChange={setDialog}><DialogContent className="connection-dialog"><DialogTitle>Connect to Jev</DialogTitle><DialogDescription className="muted">Use your OpenRouter key to evaluate this possession with TypeSafe Jev. Only the structured state is sent.</DialogDescription><form onSubmit={e=>{e.preventDefault();const nextKey=keyDraft.trim();setKey(nextKey);try{sessionStorage.setItem('jev-openrouter-key',nextKey)}catch{}setDialog(false);if(!clip.sample&&!playing)void togglePlay()}}><label>OpenRouter API key<input type="password" value={keyDraft} onChange={e=>setKeyDraft(e.target.value)} placeholder="sk-or-…" autoComplete="off" spellCheck={false}/></label><p className="small">Kept in this tab’s session, including page refreshes. Closing the tab or clearing the key removes it. During replay, Jev checks up to twice a second using your OpenRouter credits.</p><p className="small">Model: ~typesafe/jev-latest</p><div className="dialog-actions"><button type="button" onClick={()=>{setKey('');setKeyDraft('');try{sessionStorage.removeItem('jev-openrouter-key')}catch{}setDialog(false)}}>Clear key</button><button className="primary" type="submit" disabled={!keyDraft.trim()}>Use this key</button></div><a className="small" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get an OpenRouter key ↗</a></form></DialogContent></Dialog>
  </main>
}
