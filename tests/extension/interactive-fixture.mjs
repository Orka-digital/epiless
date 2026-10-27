// Shared DOM/native fixture: static grey video frames, no audio or flashing.
export function interactiveFixture({ controls = true } = {}) {
  return `<!doctype html><html lang="nl"><meta charset="utf-8"><title>FlashGuard interactieve fixture</title>
<style>body{font:18px Arial;color:#233;background:#eee;padding:24px;max-width:750px}button,a{font:inherit;margin:8px;padding:8px}video{width:240px;height:135px;background:#ddd}[aria-roledescription=slide]{padding:12px;min-height:40px;background:#e4e4e4}[hidden]{display:none!important}</style>
<nav><a href="/redirect">Redirect route</a><a href="/redirect-again">Second redirect alias</a><a href="#/private-token">Hash route — unsupported</a><a href="/logout">Logout — overslaan</a></nav>
<main><h1>Niet-flitsende interactieve fixture</h1>
${
  controls
    ? `<div id="onetrust-banner-sdk" role="dialog" aria-modal="true"><p>Testconsent</p><button id="onetrust-reject-all-handler" type="button" onclick="this.parentElement.hidden=true;window.rejects++">Reject all</button></div>
<div role="dialog" aria-modal="true" hidden>Hidden dialog must not block controls.</div>
<button type="button" aria-controls="menu-panel" aria-haspopup="menu" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.getElementById('menu-panel').hidden=false;window.menuClicks++">Show menu</button>
<div id="menu-panel" hidden><a href="/spa/client" data-spa>SPA route</a><button type="button" role="tab" aria-controls="media-panel" aria-selected="false" onclick="this.setAttribute('aria-selected','true');document.getElementById('media-panel').hidden=false;window.tabClicks++">Media tab</button></div>
<div id="media-panel" hidden><p>Static grey frames; no audio track.</p><video id="quiet-video" playsinline></video></div>
<div id="gallery" aria-roledescription="carousel"><div aria-roledescription="slide">Static slide one</div><div aria-roledescription="slide" hidden>Static slide two</div></div>
<button type="button" aria-controls="gallery" onclick="window.slide(1)">Next slide</button><button type="button" aria-controls="gallery" onclick="window.slide(0)">Previous slide</button>
<div id="lazy-space" style="height:1100px">Scroll to reveal additional static content.</div>`
    : '<p>Reached same-origin page.</p>'
}
</main><script>
window.rejects=0;window.menuClicks=0;window.tabClicks=0;window.spaNavigations=0;window.lazyAdded=false;
window.slide=function(index){document.querySelectorAll('[aria-roledescription=slide]').forEach((element,i)=>element.hidden=i!==index)};
document.querySelector('[data-spa]')?.addEventListener('click',event=>{event.preventDefault();history.pushState({},'',event.currentTarget.href);window.spaNavigations++;document.querySelector('main').innerHTML='<h1>Client-side route reached</h1><p>This route is served only through pushState.</p>'});
if(document.getElementById('quiet-video')){const canvas=document.createElement('canvas');canvas.width=240;canvas.height=135;const ctx=canvas.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,240,135);document.getElementById('quiet-video').srcObject=canvas.captureStream(20);setInterval(()=>{ctx.fillStyle='#ddd';ctx.fillRect(0,0,240,135)},50)};
addEventListener('scroll',()=>{if(scrollY>100&&!window.lazyAdded&&document.getElementById('lazy-space')){window.lazyAdded=true;const section=document.createElement('section');section.style.height='700px';section.innerHTML='<p>Lazy-loaded static section</p><a href="/lazy-observed">Newly discovered route</a>';document.querySelector('main').append(section)}});
</script></html>`;
}
