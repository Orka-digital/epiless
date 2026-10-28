// Static diagnostic surface, including deliberately private names that must never leave the page.
export const diagnosticFixtureHtml = `<!doctype html><html><head><style>
        body{margin:0;min-height:2000px;background:#eee}
        canvas,video,x-private-customer,x-private-shadow{position:absolute;box-sizing:border-box;display:block;width:240px;height:120px;background:#aaa}
        canvas{left:20px;top:20px}video{left:300px;top:20px}
        x-private-customer{left:580px;top:20px;width:180px}
        x-private-shadow{left:20px;top:180px}
      </style></head><body>
        <canvas id="private-id" class="private-class" data-secret="private-attribute" width="240" height="120">private-text</canvas>
        <video id="private-video" class="private-class" data-src="https://private-host.test/private-path"></video>
        <x-private-customer>private-customer-text</x-private-customer>
        <x-private-shadow></x-private-shadow>
        <script>
          window.diagnosticClicks=0;
          document.body.onclick=()=>window.diagnosticClicks++;
          const shadow=document.querySelector('x-private-shadow').attachShadow({mode:'open'});
          shadow.innerHTML='<div hidden><span></span><canvas id="private-shadow-decoy"></canvas></div><x-private-nested style="display:block;width:240px;height:120px"></x-private-nested>';
          shadow.querySelector('x-private-nested').attachShadow({mode:'open'}).innerHTML='<div hidden><span></span><canvas id="private-nested-decoy"></canvas></div><canvas id="private-shadow-id" width="240" height="120" style="display:block;width:240px;height:120px;background:#bbb">private-shadow-text</canvas>';
          const canvas=document.querySelector('canvas');
          canvas.animate([{transform:'translateX(0)'},{transform:'translateX(0)'}],{duration:10000,iterations:Infinity});
          canvas.animate([{opacity:1},{opacity:1}],{duration:10000,iterations:Infinity}).pause();
        </script>
      </body></html>`;
