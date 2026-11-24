const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { startServer } = require('../server.js');

function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find(p => fs.existsSync(p));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Browser JS Error: ${desc}`);
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function waitFor(fn, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await fn();
    if (val) return val;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

test('E2E Browser QA: all critical ExpressPost workflows work in real Chrome', { timeout: 60000 }, async () => {
  const chromePath = findChromePath();
  assert.ok(chromePath, 'Chrome or Edge executable must exist');

  // Local mock target API for deterministic E2E testing
  const targetServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Target-Header': 'verified' });
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: bodyStr
      }));
    });
  });
  await new Promise(r => targetServer.listen(0, '127.0.0.1', r));
  const targetPort = targetServer.address().port;
  const targetBase = `http://127.0.0.1:${targetPort}`;

  const appServer = await startServer(0);
  const appPort = appServer.address().port;
  const appBase = `http://127.0.0.1:${appPort}`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expresspost-cdp-'));
  const debugPort = 9245;
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--window-size=1366,900',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    appBase
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const targetInfo = await waitFor(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
        const pages = await res.json();
        return pages.find(p => p.type === 'page' && p.url.startsWith(appBase));
      } catch {
        return null;
      }
    }, 15000, 200);

    cdp = new CDPClient(targetInfo.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    // Wait for DOMContentLoaded & app initialization
    await waitFor(() => cdp.evaluate(`Boolean(document.getElementById('request-url') && typeof sendActiveRequest === 'function')`));

    // Check for any runtime exceptions during startup
    const runtimeErrors = [];
    cdp.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        runtimeErrors.push(msg.params.exceptionDetails.text);
      }
    });

    // 1. Verify Send Request + Pre/Post Scripts + #resp-body-controls visibility + Env var creation
    await cdp.evaluate(`(() => {
      const urlInput = document.getElementById('request-url');
      urlInput.value = '${targetBase}/hello?foo=1&role={{userRole}}';
      urlInput.dispatchEvent(new Event('input'));
      const tab = getActiveTab();
      tab.preRequestScript = "pm.environment.set('createdInScript', 'abc123');";
      tab.testsScript = "pm.test('Status 200', () => pm.response.to.have.status(200));";
      saveTabsState();
    })()`);

    // Ensure environment is selected so pm.environment.set persists to active environment
    await cdp.evaluate(`(() => {
      const envSelect = document.getElementById('active-env-select');
      if (envSelect.options.length > 1) {
        envSelect.value = envSelect.options[1].value;
        envSelect.dispatchEvent(new Event('change'));
      }
    })()`);

    await cdp.evaluate(`document.getElementById('btn-send-request').click()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('response-content-area').classList.contains('hidden')`));

    const respCheck = await cdp.evaluate(`({
      statusText: document.getElementById('resp-status').innerText,
      controlsHidden: document.getElementById('resp-body-controls').classList.contains('hidden'),
      testBadge: document.getElementById('test-pass-badge').innerText,
      paramsBadge: document.getElementById('params-badge-count').innerText,
      respHeadersBadge: Number(document.getElementById('resp-headers-badge-count').innerText),
      body: document.getElementById('response-raw-text').value,
      envSaved: environments.find(e => e.id === activeEnvId)?.variables?.some(v => v.key === 'createdInScript' && v.value === 'abc123')
    })`);
    assert.match(respCheck.statusText, /^200/);
    assert.equal(respCheck.controlsHidden, false, 'Pretty/Raw/Preview controls must be visible immediately after response');
    assert.equal(respCheck.testBadge, '1/1');
    assert.equal(respCheck.paramsBadge, '2');
    assert.ok(respCheck.respHeadersBadge > 0);
    assert.match(respCheck.body, /role=guest/);
    assert.equal(respCheck.envSaved, true, 'New environment variable set by script must persist');

    // 1b. Verify engine dropdowns are removed and requests execute automatically via local Node.js runtime without CORS errors
    const engineCheck = await cdp.evaluate(`({
      hasRequestEngine: !!document.getElementById('request-engine'),
      hasRunnerEngine: !!document.getElementById('runner-engine')
    })`);
    assert.equal(engineCheck.hasRequestEngine, false, 'request-engine selector should not be in workspace');
    assert.equal(engineCheck.hasRunnerEngine, false, 'runner-engine selector should not be in runner');

    // 1c. Verify {{fusionCookie}} creates non-intrusive URL Variable Chip and typing {{fus opens autocomplete
    await cdp.evaluate(`(() => {
      const urlEl = document.getElementById('request-url');
      urlEl.value = '${targetBase}/hello?cookie={{fusionCookie}}';
      urlEl.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('url-var-pills').classList.contains('hidden')`));
    const pillBefore = await cdp.evaluate(`({
      count: document.querySelectorAll('.url-var-pill').length,
      name: document.querySelector('.url-var-pill-name')?.textContent,
      badge: document.querySelector('.url-var-pill .var-scope-badge')?.textContent,
      isUnresolved: document.querySelector('.url-var-pill')?.classList.contains('is-unresolved')
    })`);
    assert.equal(pillBefore.count, 1);
    assert.equal(pillBefore.name, 'fusionCookie');
    assert.equal(pillBefore.badge, 'U');
    assert.equal(pillBefore.isUnresolved, true);

    // Clicking the URL pill opens the popover to set variable value
    await cdp.evaluate(`document.querySelector('.url-var-pill').click()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('variable-popover').classList.contains('hidden')`));
    await cdp.evaluate(`(() => {
      document.getElementById('var-popover-value').value = 'ORA_SESSION_999';
      document.getElementById('btn-save-var-popover').click();
    })()`);
    await waitFor(() => cdp.evaluate(`document.getElementById('variable-popover').classList.contains('hidden')`));

    // Pill immediately updates to resolved (E) with new value
    const pillAfter = await cdp.evaluate(`({
      badge: document.querySelector('.url-var-pill .var-scope-badge')?.textContent,
      val: document.querySelector('.url-var-pill-val')?.textContent,
      isUnresolved: document.querySelector('.url-var-pill')?.classList.contains('is-unresolved')
    })`);
    assert.equal(pillAfter.badge, 'E');
    assert.equal(pillAfter.val, 'ORA_SESSION_999');
    assert.equal(pillAfter.isUnresolved, false);

    // Verify clicking inside {{fusionCookie}} in URL opens popover WITHOUT stealing typing focus
    await cdp.evaluate(`(() => {
      const urlEl = document.getElementById('request-url');
      urlEl.value = '${targetBase}/hello?cookie={{fusionCookie}}';
      const offset = urlEl.value.indexOf('fusionCookie') + 2;
      urlEl.focus();
      urlEl.setSelectionRange(offset, offset);
      urlEl.click();
    })()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('variable-popover').classList.contains('hidden')`));
    const urlStillFocused = await cdp.evaluate(`document.activeElement?.id === 'request-url'`);
    assert.equal(urlStillFocused, true, 'Clicking inside URL bar must keep typing focus inside URL input');
    await cdp.evaluate(`document.getElementById('btn-close-var-popover').click()`);

    // Verify typing {{fus opens Postman-style variable autocomplete dropdown and Tab completes it
    await cdp.evaluate(`(() => {
      const urlEl = document.getElementById('request-url');
      urlEl.value = '${targetBase}/hello?c={{fus';
      const end = urlEl.value.length;
      urlEl.focus();
      urlEl.setSelectionRange(end, end);
      urlEl.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('variable-autocomplete').classList.contains('hidden')`));
    const acMatch = await cdp.evaluate(`document.querySelector('#variable-autocomplete .var-ac-name')?.textContent`);
    assert.equal(acMatch, 'fusionCookie');
    await cdp.evaluate(`(() => {
      const urlEl = document.getElementById('request-url');
      urlEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })()`);
    const urlAfterAc = await cdp.evaluate(`document.getElementById('request-url').value`);
    assert.equal(urlAfterAc, `${targetBase}/hello?c={{fusionCookie}}`);

    // Restore original URL before query param test
    await cdp.evaluate(`(() => {
      const urlEl = document.getElementById('request-url');
      urlEl.value = '${targetBase}/hello?x=1&role={{userRole}}';
      urlEl.dispatchEvent(new Event('input'));
    })()`);

    // 2. Verify Query Params toggle preserves {{userRole}} unencoded AND keeps disabled param row
    await cdp.evaluate(`(() => {
      const firstCb = document.querySelector('#params-table-body tr:first-child .row-checkbox');
      firstCb.checked = false;
      firstCb.dispatchEvent(new Event('change'));
    })()`);
    const urlAfterToggle = await cdp.evaluate(`document.getElementById('request-url').value`);
    assert.equal(urlAfterToggle, `${targetBase}/hello?role={{userRole}}`);
    const paramRowCount = await cdp.evaluate(`getActiveTab().params.length`);
    assert.equal(paramRowCount, 2, 'Disabled param should still remain in tab.params');

    // 3. Verify Import cURL modal
    await cdp.evaluate(`document.getElementById('btn-import-curl').click()`);
    const curlModalOpen = await cdp.evaluate(`!document.getElementById('modal-import-curl').classList.contains('hidden')`);
    assert.equal(curlModalOpen, true);
    await cdp.evaluate(`(() => {
      document.getElementById('curl-import-input').value = "curl -X POST '${targetBase}/curl-test' -H 'X-From-Curl: true' -d '{\\"ok\\":true}'";
      document.getElementById('btn-confirm-curl-new').click();
    })()`);
    const importedTab = await cdp.evaluate(`({
      method: getActiveTab().method,
      url: getActiveTab().url,
      body: getActiveTab().body
    })`);
    assert.equal(importedTab.method, 'POST');
    assert.equal(importedTab.url, `${targetBase}/curl-test`);
    assert.equal(importedTab.body, '{"ok":true}');

    // 4. Verify Mock Server UI -> Create -> Sync -> Open in Tab -> Send
    await cdp.evaluate(`document.querySelector('.nav-tab[data-tab="mocks"]').click()`);
    await cdp.evaluate(`document.getElementById('btn-new-mock').click()`);
    await cdp.evaluate(`(() => {
      document.getElementById('mock-method').value = 'POST';
      document.getElementById('mock-path').value = '/e2e-mock';
      document.getElementById('mock-status').value = '201';
      document.getElementById('mock-body').value = '{"mocked":"success"}';
      document.getElementById('btn-save-mock').click();
    })()`);
    await waitFor(() => cdp.evaluate(`mocks.some(m => m.path === '/e2e-mock')`));
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('#mocks-list .mock-list-item'));
      const target = items.find(el => el.innerText.includes('/mock/e2e-mock'));
      target.querySelector('.btn-test-mock').click();
    })()`);
    await cdp.evaluate(`document.getElementById('btn-send-request').click()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('response-content-area').classList.contains('hidden')`));
    const mockResp = await cdp.evaluate(`({
      status: document.getElementById('resp-status').innerText,
      body: document.getElementById('response-raw-text').value
    })`);
    assert.match(mockResp.status, /^201/);
    assert.match(mockResp.body, /"mocked":\s*"success"/);

    // 5. Verify Collection Runner (direct run button + sequential + parallel Web Workers)
    await cdp.evaluate(`(() => {
      const testColl = {
        id: 'coll-e2e',
        name: 'E2E Runner Collection',
        variables: { collVar: 'cval' },
        requests: [
          {
            id: 'r1',
            name: 'First Step',
            method: 'GET',
            url: '${targetBase}/step1?v={{collVar}}',
            headers: [],
            auth: { type: 'none' },
            bodyType: 'none',
            body: '',
            preRequestScript: '',
            testsScript: "pm.test('Step 1 ok', () => pm.response.to.have.status(200));"
          },
          {
            id: 'r2',
            name: 'Second Step',
            method: 'GET',
            url: '${targetBase}/step2',
            headers: [],
            auth: { type: 'none' },
            bodyType: 'none',
            body: '',
            preRequestScript: '',
            testsScript: "pm.test('Step 2 ok', () => pm.response.to.have.status(200));"
          }
        ]
      };
      collections.push(testColl);
      saveCollections();
      renderCollections();
      populateRunnerSelects();
      document.querySelector('.btn-run-coll-direct[data-id="coll-e2e"]').click();
    })()`);

    const runnerCheck = await cdp.evaluate(`({
      selected: document.getElementById('runner-select-collection').value,
      checklistCount: document.querySelectorAll('.runner-req-checkbox').length
    })`);
    assert.equal(runnerCheck.selected, 'coll-e2e');
    assert.equal(runnerCheck.checklistCount, 2, 'Clicking direct Run Collection must populate its request checklist');

    // Start Sequential Run
    await cdp.evaluate(`document.getElementById('btn-start-run').click()`);
    await waitFor(() => cdp.evaluate(`!currentRun.active && currentRun.stats.totalCompleted === 2`));
    const seqStats = await cdp.evaluate(`currentRun.stats`);
    assert.equal(seqStats.passed, 2);
    assert.equal(seqStats.failed, 0);

    // Start Parallel Run (2 threads, 2 iterations = 4 tasks)
    await cdp.evaluate(`(() => {
      document.querySelector('input[name="runner-mode"][value="parallel"]').click();
      document.getElementById('runner-iterations').value = '2';
      document.getElementById('runner-threads').value = '2';
      document.getElementById('btn-start-run').click();
    })()`);
    await waitFor(() => cdp.evaluate(`!currentRun.active && currentRun.stats.totalCompleted === 4`));
    const parStats = await cdp.evaluate(`currentRun.stats`);
    assert.equal(parStats.passed, 4);
    assert.equal(parStats.failed, 0);

    // 6. Verify Generate Code modal, Collection Settings modal, In-App Prompt/Confirm Dialogs, Appearance modal, and Search filters
    await cdp.evaluate(`document.getElementById('btn-close-runner').click()`);

    // Create collection via in-app prompt dialog (critical for Electron where window.prompt throws!)
    await cdp.evaluate(`document.getElementById('btn-new-collection').click()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('modal-app-dialog').classList.contains('hidden')`));
    await cdp.evaluate(`(() => {
      document.getElementById('app-dialog-input').value = 'Electron Safe Collection';
      document.getElementById('btn-app-dialog-ok').click();
    })()`);
    await waitFor(() => cdp.evaluate(`collections.some(c => c.name === 'Electron Safe Collection')`));

    await cdp.evaluate(`document.getElementById('btn-export-curl').click()`);
    const snippetOpen = await cdp.evaluate(`!document.getElementById('snippet-modal').classList.contains('hidden')`);
    assert.equal(snippetOpen, true);
    await cdp.evaluate(`document.getElementById('close-snippet-modal').click()`);

    await cdp.evaluate(`(() => {
      document.querySelector('.nav-tab[data-tab="collections"]').click();
      document.getElementById('collections-search').value = 'E2E Runner';
      document.getElementById('collections-search').dispatchEvent(new Event('input'));
    })()`);
    const filteredCollCount = await cdp.evaluate(`document.querySelectorAll('#collections-list .coll-folder').length`);
    assert.equal(filteredCollCount, 1);

    await cdp.evaluate(`document.querySelector('.btn-edit-coll-vars[data-id="coll-e2e"]').click()`);
    const collModalOpen = await cdp.evaluate(`!document.getElementById('modal-collection-vars').classList.contains('hidden')`);
    assert.equal(collModalOpen, true);
    await cdp.evaluate(`(() => {
      document.getElementById('coll-settings-name').value = 'E2E Runner Renamed';
      document.getElementById('btn-save-coll-vars').click();
    })()`);
    const renamedOk = await cdp.evaluate(`collections.some(c => c.id === 'coll-e2e' && c.name === 'E2E Runner Renamed')`);
    assert.equal(renamedOk, true);

    // Verify always-visible collection ••• menu opens full actions and deletes collection cleanly
    await cdp.evaluate(`document.querySelector('.btn-coll-more[data-id="coll-e2e"]').click()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('collection-context-menu').classList.contains('hidden')`));
    const menuItems = await cdp.evaluate(`Array.from(document.querySelectorAll('#collection-context-menu .coll-menu-item')).map(b => b.dataset.action)`);
    assert.deepEqual(menuItems, ['add-req', 'run', 'settings', 'rename', 'duplicate', 'export', 'delete']);
    await cdp.evaluate(`document.querySelector('#collection-context-menu .coll-menu-item[data-action="delete"]').click()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('modal-app-dialog').classList.contains('hidden')`));
    await cdp.evaluate(`document.getElementById('btn-app-dialog-ok').click()`);
    await waitFor(() => cdp.evaluate(`!collections.some(c => c.id === 'coll-e2e')`));

    // 7. Verify Appearance theme switching + activeEnvId persistence across page reload
    await cdp.evaluate(`(() => {
      document.getElementById('btn-open-appearance').click();
      document.getElementById('appearance-theme').value = 'light';
      document.getElementById('appearance-theme').dispatchEvent(new Event('change'));
      document.getElementById('btn-done-appearance').click();
    })()`);
    assert.equal(await cdp.evaluate(`document.documentElement.dataset.theme`), 'light');

    const envBeforeReload = await cdp.evaluate(`activeEnvId`);
    await cdp.send('Page.reload');
    await waitFor(() => cdp.evaluate(`Boolean(document.getElementById('active-env-select') && typeof activeEnvId !== 'undefined')`));
    const envAfterReload = await cdp.evaluate(`activeEnvId`);
    assert.equal(envAfterReload, envBeforeReload);
    assert.equal(await cdp.evaluate(`document.documentElement.dataset.theme`), 'light');

    assert.deepEqual(runtimeErrors, [], `Unexpected browser runtime errors: ${runtimeErrors.join('; ')}`);
  } finally {
    if (cdp) cdp.close();
    chromeProc.kill();
    await new Promise(r => appServer.close(r));
    await new Promise(r => targetServer.close(r));
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
});
