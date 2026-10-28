/** Build the isolated native debugger/workspace probe; its browser is never attached by Playwright.
 * @param {string} origin
 */
export function viewportWorkspaceProgram(origin) {
  return `
      import { trustedHover, attachPointerSession, detachPointerSession } from './trusted-pointer';
      import { resizeCapturedViewport } from './viewport-driver';
      import { createViewportWorkspace, restoreViewportWorkspace } from './viewport-workspace';
      const origin = ${JSON.stringify(origin)};
      async function run() {
        const tab = await chrome.tabs.create({url: origin, active:true});
        for(let i=0;i<100;i++){if((await chrome.tabs.get(tab.id)).status==='complete')break;await new Promise(r=>setTimeout(r,100));}
        await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
        const send = async(type,target)=>{const result=await chrome.tabs.sendMessage(tab.id,{type,target});if(!result.ok)throw new Error(result.error);return result.value};
        await attachPointerSession(tab.id);
        await new Promise(resolve=>setTimeout(resolve,750));
        const inventory=await send('FG_INVENTORY');
        const pointer=await trustedHover({enabled:true,tabId:tab.id,target:inventory.actions[0].target,guard:async()=>{},request:send,ownsDebuggerSession:true});
        const evidence=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({hover:document.querySelector('button').matches(':hover'),trusted:document.documentElement.dataset.trusted,clicks:document.documentElement.dataset.clicks})}))[0].result;
        const duringSession=(await chrome.debugger.getTargets()).find(target=>target.tabId===tab.id)?.attached;
        let original;
        const beforeResize = (await send('FG_INVENTORY')).viewport;
        const compact = await resizeCapturedViewport({tabId:tab.id,expected:{width:600,height:400,dpr:inventory.viewport.dpr},guard:async()=>{},read:()=>send('FG_INVENTORY'),wait:()=>new Promise(resolve=>setTimeout(resolve,600)),remember:window=>{original=window}});
        await chrome.windows.update(original.id,{width:original.width,height:original.height});
        await new Promise(resolve=>setTimeout(resolve,600));
        const restored = (await send('FG_INVENTORY')).viewport;
        const restoredWindow=await chrome.windows.get(original.id);
        const foreground = await chrome.tabs.create({url:'about:blank',active:true});
        await new Promise(resolve=>setTimeout(resolve,400));
        const beforeInactive = (await send('FG_INVENTORY')).viewport;
        const inactive = !(await chrome.tabs.get(tab.id)).active;
        const activity=[];
        const onActivated=info=>activity.push({event:'active',...info});
        const onFocusChanged=windowId=>activity.push({event:'focus',windowId});
        chrome.tabs.onActivated.addListener(onActivated);
        chrome.windows.onFocusChanged.addListener(onFocusChanged);
        const originalTab = await chrome.tabs.get(tab.id);
        const originalForeground = await chrome.windows.getLastFocused();
        const originalOuter = await chrome.windows.get(tab.windowId);
        globalThis.__workspacePhase='create';
        const workspace = await createViewportWorkspace({tabId:tab.id,guard:async()=>{},read:async()=>(await send('FG_INVENTORY')).viewport,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),rememberIntent:async()=>{},remember:async()=>{}});
        const workspaceState = {window: await chrome.windows.get(workspace.windowId), tab: await chrome.tabs.get(tab.id), focused: await chrome.windows.getLastFocused()};
        let remembered;
        const restoreSteps=[];
        const compactViewport={width:600,height:Math.min(400,beforeInactive.height),dpr:beforeInactive.dpr};
        let responsive, compactAction, inactiveHover, afterEmulation;
        try {
          responsive = await resizeCapturedViewport({tabId:tab.id,expected:compactViewport,guard:async()=>{},read:()=>send('FG_INVENTORY'),wait:()=>new Promise(resolve=>setTimeout(resolve,500)),remember:window=>{remembered=beforeInactive}});
          const target = responsive.actions.find(action=>action.target.selectorPath.join(' ').includes('button:nth-child(4)')) ?? responsive.actions.at(-1);
          compactAction = await send('FG_ACTION',target.target);
          inactiveHover = await trustedHover({enabled:true,tabId:tab.id,target:target.target,guard:async()=>{},request:send,ownsDebuggerSession:true});
          afterEmulation=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({compactVisible:getComputedStyle(document.querySelector('.compact')).display!=='none',expanded:document.querySelector('.compact').getAttribute('aria-expanded'),panelVisible:!document.querySelector('#compact-panel').hidden,hover:document.querySelector('.compact').matches(':hover')})}))[0].result;
        } finally {
          globalThis.__workspacePhase='restore';
          await restoreViewportWorkspace({workspace,read:async()=>(await send('FG_INVENTORY')).viewport,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
          restoreSteps.push({workspaceRestored:(await send('FG_INVENTORY')).viewport});
        }
        await new Promise(resolve=>setTimeout(resolve,500));
        const cleared = (await send('FG_INVENTORY')).viewport;
        const inactiveAfter = !(await chrome.tabs.get(tab.id)).active;
        const foregroundAfter = (await chrome.tabs.query({active:true,windowId:tab.windowId}))[0]?.id;
        const outerAfter = await chrome.windows.get(original.id);
        await detachPointerSession(tab.id);
        const attached=(await chrome.debugger.getTargets()).find(target=>target.tabId===tab.id)?.attached;
        await fetch(origin+'/result',{method:'POST',body:JSON.stringify({pointer,evidence,attached,duringSession,compact:compact.viewport,restored,beforeResize,original,restoredWindow,responsive:responsive.viewport,compactAction,inactiveHover,afterEmulation,beforeInactive,remembered,cleared,inactive,inactiveAfter,foreground:foreground.id,foregroundAfter,outerAfter,restoreSteps,originalForeground,workspaceState,activity,lastFocused:await chrome.windows.getLastFocused()})});
      }
      chrome.runtime.onInstalled.addListener(()=>{void run().catch(error=>fetch(origin+'/result',{method:'POST',body:JSON.stringify({error:String(error),phase:globalThis.__workspacePhase})}));});
    `;
}
