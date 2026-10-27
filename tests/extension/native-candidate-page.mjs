/** Native detector/recheck fixture. The signal occupies 2 × 2 CSS pixels.
 * Optional dense background varies channels only within 90–113 for five seconds;
 * it has no audio and is a separate processing workload, not a flash oracle. */
export function nativeCandidatePage({
  fixed = false,
  video = false,
  dense = false,
  encoded = undefined,
} = {}) {
  return `<!doctype html><html lang="nl"><meta charset="utf-8"><title>FlashGuard native detail and recheck fixture</title>
  <style>
    html{overflow:hidden}body{margin:40px;font:18px system-ui;color:#234;background:#eee}
    button{font:inherit;padding:12px;background:#ddd;border:1px solid #999}
    #stimulus{position:fixed;left:100px;top:240px;width:2px;height:2px;background:rgb(35,35,35)}
    #stimulus.running{animation:tiny-signal 160ms steps(1,end) 13}
    @keyframes tiny-signal{0%,100%{background:rgb(35,35,35)}50%{background:rgb(${fixed ? '35,35,35' : '125,125,125'})}}
    .motion{position:fixed;left:30px;top:30px;width:4px;height:4px;background:#e8e8e8;animation:gentle 20s linear infinite alternate}
    @keyframes gentle{to{transform:translateX(180px)}}
    #dense-background{position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none}
  </style><body>
  <h1>Detailmeting en hercontrole</h1>
  <p>${dense ? 'Deze lokale proef combineert een kleine markering met vijf seconden fijn, contrastarm GPU-beeld na bediening. De achtergrondkanalen blijven tussen 90 en 113; er is geen geluid.' : 'Deze lokale proef verandert alleen de kleur van één markering van 2 bij 2 CSS-pixels, gedurende circa twee seconden na bediening.'}</p>
  <button type="button" aria-controls="panel" aria-expanded="false">Toon details</button>
  <div id="panel" hidden>Statische uitleg. De kleine markering staat op een vaste positie.</div>
  ${video || encoded ? `<video id="stimulus" muted playsinline aria-hidden="true"${encoded ? ' preload="metadata" poster="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%222%22 height=%222%22%3E%3Cpath fill=%22%23232323%22 d=%22M0 0h2v2H0z%22/%3E%3C/svg%3E"' : ''}></video>` : '<i id="stimulus" aria-hidden="true"></i>'}<i class="motion" aria-hidden="true"></i>
  ${dense ? '<canvas id="dense-background" aria-hidden="true"></canvas>' : ''}
  <script>
  (()=>{
    const marker=document.querySelector('#stimulus'),button=document.querySelector('button');
    const state=window.__nativeCandidateFixture={fixed:${JSON.stringify(fixed)},video:${JSON.stringify(video || Boolean(encoded))},dense:${JSON.stringify(dense)},source:${JSON.stringify(encoded ? 'ENCODED_VP9_WEBM' : video ? 'CANVAS_CAPTURE_STREAM' : 'CSS_ANIMATION')},sizeCss:2,events:[],samples:[],presentations:[]${encoded ? `,encoded:${JSON.stringify(encoded).replaceAll('<', '\\u003c')}` : ''}};
    const epoch=()=>performance.timeOrigin+performance.now();
    function sample(){const rect=marker.getBoundingClientRect(),colour=getComputedStyle(marker).backgroundColor;
      if(state.samples.at(-1)?.colour!==colour)state.samples.push({at:epoch(),colour,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},dpr:devicePixelRatio});
    }
    let signalStart=-Infinity;
    let startDense=()=>{};
    if(state.dense){
      const canvas=document.querySelector('#dense-background');
      const gl=canvas.getContext('webgl2',{alpha:false,antialias:false});
      state.denseBackground={kind:'WEBGL2_LOW_CONTRAST_RGB',channelMinimum:90,channelMaximum:113,durationMs:5000,draws:[],errors:[]};
      const evidence=state.denseBackground;
      if(!gl)evidence.errors.push('WEBGL2_UNAVAILABLE');
      else {
        const shader=(type,source)=>{const value=gl.createShader(type);gl.shaderSource(value,source);gl.compileShader(value);if(!gl.getShaderParameter(value,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(value));return value;};
        try {
          const program=gl.createProgram();
          gl.attachShader(program,shader(gl.VERTEX_SHADER,'#version 300 es\\nvoid main(){vec2 p=gl_VertexID==0?vec2(-1,-1):gl_VertexID==1?vec2(3,-1):vec2(-1,3);gl_Position=vec4(p,0,1);}'));
          gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'#version 300 es\\nprecision highp float;precision highp int;uniform uint tick;out vec4 colour;uint hash(uint x){x=(x^(x>>16))*0x45d9f3bu;x=(x^(x>>16))*0x45d9f3bu;return x^(x>>16);}void main(){uint n=hash(uint(gl_FragCoord.x)+uint(gl_FragCoord.y)*4099u);uvec3 base=uvec3(n&255u,(n>>8)&255u,(n>>16)&255u);uvec3 rgb=90u+((base+uvec3(tick*3u,tick*5u,tick*7u))%24u);colour=vec4(vec3(rgb)/255.0,1.0);}'));
          gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
          gl.useProgram(program);const tickUniform=gl.getUniformLocation(program,'tick');
          const render=tick=>{const w=Math.round(innerWidth*devicePixelRatio),h=Math.round(innerHeight*devicePixelRatio);
            if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
            gl.uniform1ui(tickUniform,tick);gl.drawArrays(gl.TRIANGLES,0,3);return {width:w,height:h};
          };
          evidence.initialGeometry=render(0);let generation=0;
          startDense=()=>{const token=++generation,started=performance.now();let tick=0;
            const draw=()=>{if(token!==generation)return;const now=performance.now();
              if(now-started>=5000){evidence.endedAt=epoch();return;}
              const geometry=render(tick);
              if(evidence.draws.length<512)evidence.draws.push({at:epoch(),tick,...geometry});
              tick++;requestAnimationFrame(draw);
            };evidence.startedAt=epoch();requestAnimationFrame(draw);
          };
        }catch(error){evidence.errors.push(String(error).slice(0,500));}
      }
    }
    if(state.video){
      if(state.encoded){
        // Preload metadata and show a constant grey poster. Only the supported
        // disclosure below starts playback; this path has no canvas source.
        marker.muted=true;marker.preload='metadata';marker.src=state.encoded.url;
        marker.addEventListener('loadedmetadata',()=>state.events.push({kind:'ENCODED_METADATA',at:epoch(),duration:marker.duration,videoWidth:marker.videoWidth,videoHeight:marker.videoHeight,readyState:marker.readyState}));
        marker.addEventListener('error',()=>state.events.push({kind:'MEDIA_ERROR',at:epoch(),reason:'MEDIA_ERROR_'+marker.error?.code}));
        marker.addEventListener('playing',()=>state.events.push({kind:'ENCODED_PLAYING',at:epoch(),mediaTime:marker.currentTime}));
        marker.addEventListener('ended',()=>state.events.push({kind:'ENCODED_ENDED',at:epoch(),mediaTime:marker.currentTime}));
      }else{
      // This is a real HTMLVideoElement receiving a synthetic canvas stream,
      // not an encoded media file. The source canvas is never attached to DOM.
      const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
      const context=canvas.getContext('2d',{alpha:false});let previous=-1;
      function draw(){
        const elapsed=performance.now()-signalStart;
        const value=!state.fixed&&elapsed>=0&&elapsed<2080&&Math.floor(elapsed/80)%2===1?125:35;
        context.fillStyle='rgb('+value+','+value+','+value+')';context.fillRect(0,0,2,2);
        if(value!==previous){const r=marker.getBoundingClientRect();state.samples.push({at:epoch(),kind:'SOURCE_DRAW',grey:value,rect:{x:r.x,y:r.y,width:r.width,height:r.height},dpr:devicePixelRatio});if(state.samples.length>512)state.samples.shift();previous=value;}
        requestAnimationFrame(draw);
      }
      draw();marker.muted=true;marker.srcObject=canvas.captureStream(60);
      }
      if(typeof marker.requestVideoFrameCallback==='function'){
        const presented=(callbackTime,metadata)=>{
          const r=marker.getBoundingClientRect();
          const record={at:epoch(),callbackEpochMs:performance.timeOrigin+callbackTime,mediaTime:metadata.mediaTime,presentedFrames:metadata.presentedFrames,presentationEpochMs:performance.timeOrigin+metadata.presentationTime,expectedDisplayEpochMs:performance.timeOrigin+metadata.expectedDisplayTime,rect:{x:r.x,y:r.y,width:r.width,height:r.height},videoWidth:marker.videoWidth,videoHeight:marker.videoHeight};
          if(state.encoded){
            const expected=state.encoded.frames[Math.round(metadata.mediaTime*1000/state.encoded.frameDurationMs)];
            if(expected&&Math.abs(expected.timestampMs-metadata.mediaTime*1000)<0.1){
              record.expectedDecodedFrame={index:expected.index,timestampMs:expected.timestampMs,rgba:expected.rgba,rgbaSha256:expected.rgbaSha256};
            }else state.events.push({kind:'ENCODED_TIMESTAMP_UNMATCHED',at:epoch(),mediaTime:metadata.mediaTime});
          }
          state.lastPresentation=record;
          // Keep first-frame capability evidence and the real presentation
          // callbacks around the small control-triggered signal, bounded locally.
          if(state.presentations.length===0||performance.now()-signalStart<2400){state.presentations.push(record);if(state.presentations.length>512)state.presentations.shift();}
          marker.requestVideoFrameCallback(presented);
        };marker.requestVideoFrameCallback(presented);
      }else state.events.push({kind:'RVFC_UNAVAILABLE',at:epoch()});
      if(!state.encoded)marker.play().catch(error=>state.events.push({kind:'MEDIA_ERROR',at:epoch(),reason:String(error).slice(0,120)}));
    }else sample();
    button.addEventListener('click',()=>{
      state.events.push({kind:'CONTROL',at:epoch()});
      button.setAttribute('aria-expanded','true');document.querySelector('#panel').hidden=false;
      startDense();
      if(state.video){signalStart=performance.now();state.events.push({kind:'VIDEO_SIGNAL_START',at:epoch()});
        if(state.encoded){marker.currentTime=0;marker.play().catch(error=>state.events.push({kind:'MEDIA_ERROR',at:epoch(),reason:String(error).slice(0,120)}));}
        return;}
      marker.classList.remove('running');void marker.offsetWidth;marker.classList.add('running');
      const until=performance.now()+2300;function tick(){sample();if(performance.now()<until)requestAnimationFrame(tick)}requestAnimationFrame(tick);
    });
    marker.addEventListener('animationstart',()=>state.events.push({kind:'ANIMATION_START',at:epoch()}));
    marker.addEventListener('animationend',()=>{state.events.push({kind:'ANIMATION_END',at:epoch()});sample()});
  })();
  </script></body></html>`;
}
