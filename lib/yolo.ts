import type {Detection} from './vision';
import type {Point} from './court';
const SIZE=704;
export function decodeYolo(data:ArrayLike<number>,ratio:number,width:number,height:number,padX=0,padY=0):{detections:Detection[];basket:Point|null}{
  const detections:Detection[]=[];let basket:Point|null=null,basketConfidence=0;const anchors=data.length/8;
  for(let i=0;i<anchors;i++){
    let cls=0,confidence=data[4*anchors+i];
    for(let c=1;c<4;c++)if(data[(4+c)*anchors+i]>confidence){cls=c;confidence=data[(4+c)*anchors+i]}
    if(cls===3||confidence<(cls===0?.18:cls===1?.35:.25))continue;
    const cx=(data[i]-padX)/ratio,cy=(data[anchors+i]-padY)/ratio,w=data[2*anchors+i]/ratio,h=data[3*anchors+i]/ratio;
    const left=Math.max(0,Math.min(1,(cx-w/2)/width)),top=Math.max(0,Math.min(1,(cy-h/2)/height));
    const right=Math.max(0,Math.min(1,(cx+w/2)/width)),bottom=Math.max(0,Math.min(1,(cy+h/2)/height));
    if(right<=left||bottom<=top)continue;
    if(cls===1){if(confidence>basketConfidence){basketConfidence=confidence;basket={x:(left+right)/2,y:top+(bottom-top)*.2}}continue;}
    const kind=cls===0?'ball':'player';
    if(kind==='ball'&&((right-left)>.06||(bottom-top)>.12))continue;
    if(kind==='player'&&((bottom-top)<.04||(right-left)>.35||(bottom-top)>.85))continue;
    detections.push({kind,confidence,box:[left,top,right-left,bottom-top]});
  }
  return {detections,basket};
}
export function jerseyColor(pixels:Uint8ClampedArray,width:number,height:number,box:Detection['box']):[number,number,number]{
  const [x,y,w,h]=box;
  const x1=Math.max(0,Math.floor((x+w*.3)*width)),x2=Math.min(width,Math.ceil((x+w*.7)*width));
  const y1=Math.max(0,Math.floor((y+h*.25)*height)),y2=Math.min(height,Math.ceil((y+h*.58)*height));
  const channels:number[][]=[[],[],[]];
  for(let py=y1;py<y2;py+=2)for(let px=x1;px<x2;px+=2){const at=(py*width+px)*4;for(let c=0;c<3;c++)channels[c].push(pixels[at+c]/255);}
  return channels.map(a=>a.length?a.sort((a,b)=>a-b)[Math.floor(a.length/2)]:0) as [number,number,number];
}
export async function loadYolo(){
  const ort=await import('onnxruntime-web/wasm');ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('/onnx/',window.location.href).href;
  const session=await ort.InferenceSession.create('/models/ebard-yolov8n.onnx',{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  const c=document.createElement('canvas');c.width=SIZE;c.height=SIZE;const ctx=c.getContext('2d',{willReadFrequently:true})!;
  return {async detect(image:HTMLCanvasElement){
    const ratio=Math.min(SIZE/image.width,SIZE/image.height),rw=Math.round(image.width*ratio),rh=Math.round(image.height*ratio);
    const padX=Math.floor((SIZE-rw)/2),padY=Math.floor((SIZE-rh)/2);
    ctx.fillStyle='rgb(114,114,114)';ctx.fillRect(0,0,SIZE,SIZE);ctx.drawImage(image,padX,padY,rw,rh);
    const rgba=ctx.getImageData(0,0,SIZE,SIZE).data,input=new Float32Array(3*SIZE*SIZE),plane=SIZE*SIZE;
    // Ultralytics export expects RGB channels, normalized to 0–1, with centered letterboxing.
    for(let i=0;i<plane;i++){input[i]=rgba[i*4]/255;input[plane+i]=rgba[i*4+1]/255;input[plane*2+i]=rgba[i*4+2]/255;}
    const tensor=new ort.Tensor('float32',input,[1,3,SIZE,SIZE]);
    try{
      const output=await session.run({[session.inputNames[0]]:tensor});
      try{
        const result=decodeYolo(output[session.outputNames[0]].data as Float32Array,ratio,image.width,image.height,padX,padY);
        const pixels=image.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,image.width,image.height).data;
        return {...result,detections:result.detections.map(d=>d.kind==='player'?{...d,jersey:jerseyColor(pixels,image.width,image.height,d.box)}:d)};
      }finally{for(const out of Object.values(output))out.dispose();}
    }finally{tensor.dispose();}
  }};
}
