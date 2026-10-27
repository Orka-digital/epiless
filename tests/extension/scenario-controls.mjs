import assert from 'node:assert/strict';

export async function testScenarioControls({
  context,
  page,
  worker,
  tabId,
  send,
}) {
  await context.route('http://127.0.0.1:47820/scenario-controls', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><style>button{display:block;margin:12px} #focus:hover{outline:3px solid #999} [hidden]{display:none!important}</style>
      <button id="focus" type="button" aria-controls="focus-panel" aria-expanded="false">Show details</button>
      <div id="focus-panel" hidden>Focus state</div>
      <button id="late" type="button" aria-controls="late-panel" aria-expanded="false">More details</button>
      <div id="late-panel" hidden>Delayed state</div>
      <div id="carousel" aria-roledescription="carousel"><div aria-roledescription="slide">One</div><div aria-roledescription="slide" hidden>Two</div><div aria-roledescription="slide" hidden>Three</div></div>
      <button id="next" type="button" aria-controls="carousel">Next slide</button>
      <script>window.clicks=0;window.hoverEvents=0;window.slide=0;
      document.querySelector('#focus').addEventListener('focus',()=>{document.querySelector('#focus-panel').hidden=false;document.querySelector('#focus').setAttribute('aria-expanded','true')});
      document.querySelector('#focus').onclick=()=>window.clicks++;
      document.querySelector('#focus').onmouseover=(event)=>{window.hoverEvents++;window.nativeHover=event.isTrusted};
      document.querySelector('#late').onclick=()=>setTimeout(()=>{document.querySelector('#late-panel').hidden=false;document.querySelector('#late').setAttribute('aria-expanded','true')},700);
      document.querySelector('#next').onclick=()=>{window.slide=(window.slide+1)%3;document.querySelectorAll('[aria-roledescription=slide]').forEach((el,i)=>el.hidden=i!==window.slide)};
      </script>`,
    }),
  );
  await page.goto('http://127.0.0.1:47820/scenario-controls');
  await worker.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }),
    tabId,
  );
  const inventory = async () => (await send({ type: 'FG_INVENTORY' })).value;
  let state = await inventory();
  const focus = state.actions[0];
  assert.ok(focus.target?.selectorPath.length);
  assert.equal(focus.focusable, true);
  const focused = (await send({ type: 'FG_FOCUS', actionId: focus.id })).value;
  assert.equal(focused.achieved, true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'focus');
  assert.equal(
    await page.evaluate(() => window.clicks),
    0,
    'Focus never substitutes a click',
  );
  assert.equal(
    (await send({ type: 'FG_HOVER', actionId: focus.id })).value.achieved,
    false,
  );
  assert.equal(
    await page.evaluate(() => window.hoverEvents),
    0,
    'Unsupported hover must not synthesize pointer events',
  );
  const extensionId = new URL(worker.url()).host;
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${extensionId}/trusted-hover-test.html`);
  const nativeHover = await probe.evaluate(
    ({ tabId, target }) => globalThis.__testTrustedHover(tabId, target),
    { tabId, target: focus.target },
  );
  assert.equal(
    nativeHover.achieved,
    false,
    'A Playwright-owned debugger must not be displaced',
  );
  assert.equal(nativeHover.reason, 'DEBUGGER_ALREADY_ATTACHED');
  assert.equal(
    await page.evaluate(() => window.clicks),
    0,
    'Hover must not activate the control',
  );
  assert.equal(
    await probe.evaluate(
      async (tabId) =>
        (await chrome.debugger.getTargets()).find(
          (target) => target.tabId === tabId,
        )?.attached,
      tabId,
    ),
    true,
    'The existing debugger remains attached',
  );
  await probe.close();
  state = await inventory();
  const late = state.actions.find(
    (action) => action.kind === 'accordion' && action.id !== focus.id,
  );
  const started = Date.now();
  assert.equal(
    (await send({ type: 'FG_ACTION', actionId: late.id })).value.achieved,
    true,
  );
  assert.ok(
    Date.now() - started >= 650,
    'Deferred state requires observed evidence',
  );
  state = await inventory();
  const next = state.actions.find((action) => action.kind === 'carousel');
  const observed = [];
  for (let count = 0; count < 3; count++) {
    const result = (await send({ type: 'FG_ACTION', target: next.target }))
      .value;
    assert.equal(result.achieved, true);
    observed.push(result.state);
  }
  assert.equal(
    new Set(observed).size,
    3,
    'Three distinct reached states are reproducible without transient IDs',
  );
  await page.evaluate(() => {
    const button = document.querySelector('#next');
    const form = document.createElement('form');
    form.id = 'sensitive';
    document.body.append(form);
    button.setAttribute('form', form.id);
  });
  assert.equal(
    (await send({ type: 'FG_ACTION', target: next.target })).value.achieved,
    false,
    'Replay rechecks current form safety',
  );
}
