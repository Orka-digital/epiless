// Manual native tabCapture + extension-owned debugger integration gate.
// No Playwright connection attaches to this browser. Start through its toolbar.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const evidence = await mkdtemp(
  path.join(tmpdir(), 'flashguard-native-advanced-'),
);
const extension = path.join(evidence, 'instrumented-extension');
const production = fileURLToPath(
  new URL('../../apps/chrome-extension/dist-advanced/', import.meta.url),
);
async function hashDirectory(directory) {
  const hash = createHash('sha256');
  for (const name of (await readdir(directory)).sort()) {
    hash.update(name);
    hash.update('\0');
    hash.update(await readFile(path.join(directory, name)));
    hash.update('\0');
  }
  return hash.digest('hex');
}
const productionSha256 = await hashDirectory(production);
await cp(production, extension, { recursive: true });
const requests = [],
  geometries = [];
let origin, browser, environment;
const expectedColors = [
  [40, 80, 120, 255],
  [140, 180, 220, 255],
  [80, 120, 160, 255],
  [180, 140, 100, 255],
];
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (request.method === 'POST') {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 5_000_000) {
        response.writeHead(413);
        response.end();
        return;
      }
    }
    const value = JSON.parse(body);
    if (request.url === '/geometry') {
      geometries.push({ ...value, receivedAt: new Date().toISOString() });
      if (geometries.length > 600) geometries.shift();
    } else if (request.url === '/progress') console.log(JSON.stringify(value));
    else if (request.url === '/terminal') {
      await writeFile(
        path.join(evidence, `${value.job.id}.json`),
        JSON.stringify(value.report, null, 2),
      );
      await writeFile(
        path.join(evidence, `${value.job.id}-local-job.json`),
        JSON.stringify(value.job, null, 2),
      );
      await writeFile(
        path.join(evidence, 'environment.json'),
        JSON.stringify(
          {
            ...environment,
            recordedAt: new Date().toISOString(),
            runtime: value.runtime,
            initialGeometry: geometries[0],
            finalGeometry: geometries.at(-1),
            geometries,
            pixelProbe: {
              expectedColors,
              samples: value.probes ?? [],
              instrumentation:
                'Copied offscreen bundle samples four numeric static corners on frames 1, 30 and 120 per source geometry before forwarding the original VideoFrame. Sampled-frame overhead; no stored screenshot or video.',
            },
          },
          null,
          2,
        ),
      );
      await writeFile(
        path.join(evidence, 'requests.json'),
        JSON.stringify(requests, null, 2),
      );
      console.log(
        JSON.stringify({
          terminal: value.job.state,
          id: value.job.id,
          evidence,
          limitations: value.job.limitations,
          scenarios: value.job.tasks.flatMap((task) =>
            task.observations.map((obs) => ({
              scenario: obs.scenario,
              achieved: obs.achieved,
              coverage: obs.coverage,
              reason: obs.reason,
              viewportMethod: obs.replay?.viewportMethod,
              viewport: obs.replay?.viewport,
              quality: obs.measurement?.quality,
            })),
          ),
        }),
      );
    }
    response.end('ok');
    return;
  }
  requests.push({ path: request.url, at: new Date().toISOString() });
  if (request.url === '/robots.txt') {
    response.setHeader('content-type', 'text/plain');
    response.end('User-agent: *\n');
    return;
  }
  if (request.url !== '/') {
    response.writeHead(404);
    response.end('No additional route');
    return;
  }
  response.setHeader('content-type', 'text/html');
  response.end(`<!doctype html><html lang="nl"><meta charset="utf-8"><title>FlashGuard advanced native fixture</title>
  <style>html{overflow:hidden}body{margin:40px;font:18px system-ui;background:#eee;color:#234}button{font:inherit;padding:12px;border:1px solid #aaa;background:#ddd}button:hover{outline:2px solid #777}button:focus{outline:2px solid #666}.compact{display:none}@media(max-width:650px){.compact{display:block}.desktop{display:none}}.corner{position:fixed;width:20px;height:20px;z-index:2147483647;pointer-events:none}.motion{position:fixed;left:30px;top:30px;width:4px;height:4px;background:#e8e8e8;animation:gentle 20s linear infinite alternate}@keyframes gentle{to{transform:translateX(180px)}}</style>
  <i class="corner" style="left:0;top:0;background:rgb(40,80,120)"></i><i class="corner" style="right:0;top:0;background:rgb(140,180,220)"></i><i class="corner" style="left:0;bottom:0;background:rgb(80,120,160)"></i><i class="corner" style="right:0;bottom:0;background:rgb(180,140,100)"></i><i class="motion"></i>
  <h1>Native advanced test</h1><p>Geen flitsen of geluid. Alleen een klein contrastarm bewegend punt.</p>
  <div class="desktop"><button type="button" aria-controls="desktop-panel" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.querySelector('#desktop-panel').hidden=false">Desktop details</button><div id="desktop-panel" hidden>Statische uitleg.</div></div>
  <div class="compact"><button type="button" aria-controls="compact-panel" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.querySelector('#compact-panel').hidden=false">Compact details</button><div id="compact-panel" hidden>Werkelijk bereikte compacte bediening.</div></div>
  <script>function report(){fetch('/geometry',{method:'POST',body:JSON.stringify({at:Date.now(),innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio,visibility:document.visibilityState,screen:{width:screen.width,height:screen.height},compactVisible:getComputedStyle(document.querySelector('.compact')).display!=='none',compactExpanded:document.querySelector('.compact button').getAttribute('aria-expanded')})}).catch(()=>{})}report();addEventListener('resize',report);document.addEventListener('visibilitychange',report);setInterval(report,1000);</script></html>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const manifestFile = path.join(extension, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
if (!manifest.permissions.includes('debugger'))
  throw new Error(
    'Build dist-advanced first; this fixture requires its explicit debugger permission.',
  );
// Only the isolated fixture origin is granted in this temporary copy. Actual
// tabCapture still needs a real toolbar gesture; no stream ID or frame is fake.
manifest.host_permissions = [
  ...(manifest.host_permissions ?? []),
  'http://127.0.0.1/*',
];
manifest.name = 'FlashGuard advanced native fixture';
await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
const probe = `(() => { const OriginalWorker=globalThis.Worker,seen=new Map(),probes=[];
globalThis.Worker=class extends OriginalWorker { postMessage(message,...args){const frame=message?.frame;
if(message?.type==='FRAME'&&frame){const key=frame.displayWidth+'x'+frame.displayHeight,count=(seen.get(key)??0)+1;seen.set(key,count);if([1,30,120].includes(count)&&seen.size<=6){
const canvas=new OffscreenCanvas(1,1),ctx=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});const w=frame.displayWidth,h=frame.displayHeight,points=[[12,12],[w-13,12],[12,h-13],[w-13,h-13]];
const colors=points.map(([x,y])=>{ctx.drawImage(frame,x,y,1,1,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]});probes.push({width:w,height:h,frameNumber:count,sourceTimestampMs:message.timestampMs,points,colors});void chrome.runtime.sendMessage({type:'FIXTURE_PIXEL_PROBE',probes}).catch(()=>{});
}}return super.postMessage(message,...args)}};})();\n`;
await writeFile(
  path.join(extension, 'offscreen.js'),
  probe + (await readFile(path.join(extension, 'offscreen.js'), 'utf8')),
);
const collector = `\n;(() => {
const origin=${JSON.stringify(origin)};
chrome.runtime.onMessage.addListener((message,sender)=>{if(sender.id===chrome.runtime.id&&message?.type==='FIXTURE_PIXEL_PROBE')void chrome.storage.local.set({fixturePixelProbes:message.probes});});
chrome.runtime.onInstalled.addListener(()=>{void(async()=>{
await chrome.tabs.create({url:chrome.runtime.getURL('fixture-controller.html'),active:false});
const tab=await chrome.tabs.create({url:origin+'/',active:true});
await chrome.windows.update(tab.windowId,{state:'normal',width:900,height:650});
await chrome.storage.local.set({fixtureTargetTab:tab.id});
})().catch(error=>fetch(origin+'/progress',{method:'POST',body:JSON.stringify({fixtureError:String(error)})}));});
})();\n`;
await writeFile(
  path.join(extension, 'background.js'),
  (await readFile(path.join(extension, 'background.js'), 'utf8')) + collector,
);
await writeFile(
  path.join(extension, 'fixture-controller.html'),
  '<!doctype html><title>FlashGuard fixture collector</title><p>Local numeric evidence collector; start the scan through the real toolbar.</p><script src="fixture-controller.js"></script>',
);
await writeFile(
  path.join(extension, 'fixture-controller.js'),
  `
const origin=${JSON.stringify(origin)},completed=new Set(),focusTransitions=[];let busy=false,progress='';
setInterval(async()=>{if(busy)return;busy=true;try{
const reply=await chrome.runtime.sendMessage({type:'GET_STATE'});if(!reply.ok)return;
for(const job of reply.value.jobs){if(completed.has(job.id))continue;
const targetState=await chrome.tabs.get(job.tabId),foregroundState=(await chrome.tabs.query({active:true,windowId:targetState.windowId}))[0];const targetWindowState=await chrome.windows.get(targetState.windowId);const focusState={at:Date.now(),targetActive:targetState.active,targetWindowId:targetState.windowId,targetWindowFocused:targetWindowState.focused,foregroundTabId:foregroundState?.id,state:job.state,pendingAction:job.tasks.find(task=>task.state==='RUNNING')?.pendingAction};const lastFocus=focusTransitions.at(-1);if(!lastFocus||lastFocus.targetActive!==focusState.targetActive||lastFocus.targetWindowId!==focusState.targetWindowId||lastFocus.targetWindowFocused!==focusState.targetWindowFocused||lastFocus.foregroundTabId!==focusState.foregroundTabId)focusTransitions.push(focusState);
const summary={id:job.id,state:job.state,scenarios:job.tasks.flatMap(task=>task.observations.map(obs=>({scenario:obs.scenario,coverage:obs.coverage,frames:obs.measurement?.quality.frameCount})))};
if(JSON.stringify(summary)!==progress){progress=JSON.stringify(summary);await fetch(origin+'/progress',{method:'POST',body:progress});}
if(['COMPLETED','PARTIAL','INTERRUPTED','ERROR'].includes(job.state)){
await new Promise(resolve=>setTimeout(resolve,1200));
const refreshed=(await chrome.runtime.sendMessage({type:'GET_STATE'})).value.jobs.find(value=>value.id===job.id);
const report=await chrome.runtime.sendMessage({type:'EXPORT',id:job.id});
const target=(await chrome.storage.local.get('fixtureTargetTab')).fixtureTargetTab;
const tab=await chrome.tabs.get(target);const currentWindow=await chrome.windows.get(tab.windowId);
const geometry=(await chrome.scripting.executeScript({target:{tabId:target},func:()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState})}))[0].result;
const attached=(await chrome.debugger.getTargets()).find(value=>value.tabId===target)?.attached;
await fetch(origin+'/terminal',{method:'POST',body:JSON.stringify({job:refreshed,report:report.value,probes:(await chrome.storage.local.get('fixturePixelProbes')).fixturePixelProbes,runtime:{userAgent:navigator.userAgent,focusTransitions,targetActive:tab.active,foregroundTab:(await chrome.tabs.query({active:true,windowId:tab.windowId}))[0]?.id,geometry,window:{id:currentWindow.id,focused:currentWindow.focused,width:currentWindow.width,height:currentWindow.height},debuggerAttached:attached}})});completed.add(job.id);
}}
}catch(error){await fetch(origin+'/progress',{method:'POST',body:JSON.stringify({collectorError:String(error)})}).catch(()=>{});}finally{busy=false;}},1000);
`,
);
environment = {
  platform: process.platform,
  machine: {
    arch: arch(),
    os: platform(),
    release: release(),
    cpuModel: cpus()[0]?.model,
    logicalCpus: cpus().length,
  },
  fixture:
    'One route, static desktop/responsive controls, four corner markers and low-contrast 4px slow motion; no flashing or audio.',
  origin,
  requestedWindow: { width: 900, height: 650 },
  headless: false,
  playwrightAttached: false,
  extensionBuild: {
    algorithm: 'sha256',
    input: 'sorted filenames, NUL, bytes, NUL',
    productionSha256,
    instrumentedSha256: await hashDirectory(extension),
    instrumentation:
      'Fixture-only loopback host permission, startup/terminal numeric collector and copied offscreen corner probe. Detector/background/capture implementation otherwise unchanged.',
  },
};
await writeFile(
  path.join(evidence, 'environment-start.json'),
  JSON.stringify(environment, null, 2),
);
browser = spawn(
  chromium.executablePath(),
  [
    `--user-data-dir=${path.join(evidence, 'browser-profile')}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
console.log(
  JSON.stringify({
    evidence,
    origin,
    pid: browser.pid,
    extensionBuild: environment.extensionBuild,
  }),
);
console.log(
  'Use the real FlashGuard toolbar: autonomous mode + genuine hover checkbox. No Playwright/CDP client is attached. Ctrl+C closes only this isolated fixture browser. Evidence is retained.',
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  browser.kill('SIGTERM');
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
browser.on('exit', () => void stop());
