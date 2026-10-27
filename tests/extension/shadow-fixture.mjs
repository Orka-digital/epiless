// Non-flashing, real browser components with duplicate IDs in different tree scopes.
export function shadowFixture() {
  return `<!doctype html><style>
  body{font:16px system-ui;margin:20px}x-shell,x-content,x-secret,x-guard{display:block}
  button,[role=button],a{display:block;padding:8px;margin:8px}#shared{padding:8px}
  </style><main><div id="shared">A light-DOM ID must not satisfy a shadow control.</div>
  <x-shell></x-shell><x-secret></x-secret>
  <form><x-guard data-risk="form"></x-guard></form>
  <div inert><x-guard data-risk="inert"></x-guard></div>
  <div style="opacity:0"><x-guard data-risk="transparent"></x-guard></div>
  <button id="deceptive" type="button" aria-controls="transparent-panel" aria-expanded="false">Show explanation</button>
  <div style="opacity:0"><div id="transparent-panel">Never visibly opened</div></div>
  <button id="offscreen" type="button" aria-controls="offscreen-panel" aria-expanded="false">Show extra information</button>
  <div id="offscreen-panel" style="position:absolute;top:10000px">Outside the measured viewport</div>
  </main><script>
  window.menuClicks=0;window.tabClicks=0;window.guardClicks=0;window.shadowNavigations=0;
  const shell=document.querySelector('x-shell').attachShadow({mode:'open'});
  shell.innerHTML='<style>[role=button],button{display:block;padding:12px}#shared{padding:8px}</style><div role="button" tabindex="0" aria-haspopup="menu" aria-controls="shared" aria-expanded="false">Browse details</div><div id="shared" hidden><x-content></x-content></div>';
  shell.querySelector('[role=button]').onclick=function(){window.menuClicks++;this.setAttribute('aria-expanded','true');shell.getElementById('shared').hidden=false};
  const content=shell.querySelector('x-content').attachShadow({mode:'open'});
  content.innerHTML='<style>button,a{display:block;padding:12px}video{display:block;width:120px;height:80px}</style><button role="tab" aria-controls="shared" aria-selected="false">Preview</button><section id="shared" hidden><video playsinline></video><a href="/shadow-route">Read documentation</a></section>';
  content.querySelector('button').onclick=function(){window.tabClicks++;this.setAttribute('aria-selected','true');content.getElementById('shared').hidden=false};
  content.querySelector('a').onclick=function(event){event.preventDefault();window.shadowNavigations++;history.pushState({},'',this.href)};
  const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;
  const drawing=canvas.getContext('2d');let frame=0;
  setInterval(()=>{drawing.fillStyle='#777';drawing.fillRect(0,0,120,80);drawing.fillStyle='#888';drawing.fillRect(frame++%100,30,20,20)},50);
  content.querySelector('video').srcObject=canvas.captureStream(20);
  const secret=document.querySelector('x-secret').attachShadow({mode:'open'});
  secret.innerHTML='<button type="button" aria-controls="secret-panel" aria-expanded="false">Open details</button><section id="secret-panel"><x-private></x-private></section>';
  secret.querySelector('x-private').attachShadow({mode:'open'}).innerHTML='<input type="password">';
  for(const host of document.querySelectorAll('x-guard')){
    const root=host.attachShadow({mode:'open'});
    root.innerHTML='<button type="button" aria-controls="guard-panel" aria-expanded="false">Open details</button><div id="guard-panel">Details</div>';
    root.querySelector('button').onclick=()=>window.guardClicks++;
  }
  document.getElementById('deceptive').onclick=function(){this.setAttribute('aria-expanded','true')};
  document.getElementById('offscreen').onclick=function(){this.setAttribute('aria-expanded','true')};
  </script>`;
}
