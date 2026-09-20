import type { Detection } from './vision';
const SIZE=416;
export function decodeYolo(data:ArrayLike<number>,ratio:number,width:number,height:number):Detection[]{
  const out:Detection[]=[];let anchor=0;
  for(const stride of [8,16,32]){const count=SIZE/stride;for(let gy=0;gy<count;gy++)for(let gx=0;gx<count;gx++,anchor++){
    const offset=anchor*85;const objectness=data[offset+4];if(objectness<.16)continue;
    for(const [cls,kind] of [[0,'player'],[32,'ball']] as const){const confidence=objectness*data[offset+5+cls];if(confidence<(kind==='player'?.35:.17))continue;
      const cx=(data[offset]+gx)*stride/ratio,cy=(data[offset+1]+gy)*stride/ratio,w=Math.exp(data[offset+2])*stride/ratio,h=Math.exp(data[offset+3])*stride/ratio;
      const left=Math.max(0,Math.min(1,(cx-w/2)/width)),top=Math.max(0,Math.min(1,(cy-h/2)/height));const right=Math.max(0,Math.min(1,(cx+w/2)/width)),bottom=Math.max(0,Math.min(1,(cy+h/2)/height));
      if(right<=left||bottom<=top)continue;if(kind==='player'&&((bottom-top)<.035||(right-left)>.3||(bottom-top)>.75))continue;
      out.push({kind,confidence,box:[left,top,right-left,bottom-top]});
    }
  }}return out;
}
export async function loadYolo(){
  const ort=await import('onnxruntime-web/wasm');ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('/onnx/',window.location.href).href;
  const session=await ort.InferenceSession.create('/models/yolox_tiny.onnx',{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  const c=document.createElement('canvas');c.width=SIZE;c.height=SIZE;const ctx=c.getContext('2d',{willReadFrequently:true})!;
  return {async detect(image:HTMLCanvasElement):Promise<Detection[]>{
    const ratio=Math.min(SIZE/image.width,SIZE/image.height);ctx.fillStyle='rgb(114,114,114)';ctx.fillRect(0,0,SIZE,SIZE);ctx.drawImage(image,0,0,Math.floor(image.width*ratio),Math.floor(image.height*ratio));
    const rgba=ctx.getImageData(0,0,SIZE,SIZE).data;const input=new Float32Array(3*SIZE*SIZE);const plane=SIZE*SIZE;
    // Official YOLOX ONNX preprocessing: 0–255 BGR, CHW, top-left letterbox.
    for(let i=0;i<plane;i++){input[i]=rgba[i*4+2];input[plane+i]=rgba[i*4+1];input[plane*2+i]=rgba[i*4];}
    const tensor=new ort.Tensor('float32',input,[1,3,SIZE,SIZE]);
    const output=await session.run({[session.inputNames[0]]:tensor});const result=output[session.outputNames[0]];
    const decoded=decodeYolo(result.data as Float32Array,ratio,image.width,image.height);tensor.dispose();for(const t of Object.values(output))t.dispose();return decoded;
  }};
}
