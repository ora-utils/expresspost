const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { startServer } = require('../server');

function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find(p => fs.existsSync(p));
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.msgId = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id && this.pending.has(data.id)) {
          const { resolve, reject } = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.error) reject(new Error(data.error.message || 'CDP Error'));
          else resolve(data.result);
        }
      } catch (err) {
        // ignore parse error
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
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
    if (this.ws) this.ws.close();
  }
}

async function waitFor(fn, timeoutMs = 15000, intervalMs = 120) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await fn();
    if (val) return val;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

test('Mock API QA: validates real live mock APIs and built-in mock engine', { timeout: 75000 }, async () => {
  const chromePath = findChromePath();
  assert.ok(chromePath, 'Chrome or Edge executable must exist');

  const appServer = await startServer(0);
  const appPort = appServer.address().port;
  const appBase = `http://127.0.0.1:${appPort}`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expresspost-live-mock-'));
  const debugPort = 9247;
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

  let cdp = null;

  try {
    const endpointsUrl = `http://127.0.0.1:${debugPort}/json`;
    const target = await waitFor(async () => {
      try {
        const res = await fetch(endpointsUrl);
        const list = await res.json();
        return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch {
        return null;
      }
    }, 12000, 250);

    cdp = new CDPClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await waitFor(() => cdp.evaluate(`Boolean(document.getElementById('btn-send-request'))`));

    // =========================================================================
    // TEST 1: GET jsonplaceholder.typicode.com/posts/1
    // =========================================================================
    console.log('-> Running Mock API Test 1: GET jsonplaceholder.typicode.com/posts/1');
    await cdp.evaluate(`(() => {
      document.getElementById('request-method').value = 'GET';
      const urlEl = document.getElementById('request-url');
      urlEl.value = 'https://jsonplaceholder.typicode.com/posts/1';
      urlEl.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btn-send-request').click();
    })()`);

    await waitFor(() => cdp.evaluate(`Boolean(!document.getElementById('response-metadata').classList.contains('hidden') && getActiveTab()?.response && document.getElementById('resp-status').innerText.startsWith('200'))`));

    const test1Results = await cdp.evaluate(`({
      status: document.getElementById('resp-status').innerText,
      time: document.getElementById('resp-time').innerText,
      size: document.getElementById('resp-size').innerText,
      body: document.getElementById('response-raw-text')?.value || '',
      prettyBody: typeof responseEditor !== 'undefined' ? responseEditor.getValue() : '',
      prettyType: document.getElementById('resp-pretty-type')?.value
    })`);

    assert.match(test1Results.status, /^200 OK/);
    assert.match(test1Results.time, /ms$/);
    assert.match(test1Results.body, /sunt aut facere repellat provident/);
    assert.ok(test1Results.prettyBody.includes('\n'), 'Response editor should contain formatted multiline JSON');
    assert.equal(test1Results.prettyType, 'json', 'Response auto-detected as json');
    console.log('   ✓ Test 1 Passed: 200 OK, Response Time:', test1Results.time, 'Size:', test1Results.size, '(Formatted multiline JSON verified)');

    // =========================================================================
    // TEST 2: POST jsonplaceholder.typicode.com/posts with JSON Body & Tests Script
    // =========================================================================
    console.log('-> Running Mock API Test 2: POST jsonplaceholder.typicode.com/posts with JSON payload & test assertions');
    await cdp.evaluate(`(() => {
      createNewTab();
      const methodSelect = document.getElementById('request-method');
      methodSelect.value = 'POST';
      methodSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const urlEl = document.getElementById('request-url');
      urlEl.value = 'https://jsonplaceholder.typicode.com/posts';
      urlEl.dispatchEvent(new Event('input', { bubbles: true }));

      // Set Body to raw JSON
      document.querySelector('.config-tab[data-config="body"]').click();
      const rawRadio = document.querySelector('input[name="body-type"][value="raw"]');
      rawRadio.checked = true;
      rawRadio.dispatchEvent(new Event('change', { bubbles: true }));

      const rawTypeSelect = document.getElementById('body-raw-type');
      rawTypeSelect.value = 'application/json';
      rawTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));

      if (bodyEditor) {
        // Set single-line JSON containing variables to verify Beautify works
        bodyEditor.setValue('{"title":"ExpressPost Mock Test","userId":42,"authCookie":"{{fusionCookie}}"}', -1);
        document.getElementById('btn-format-body-json').click();
      }

      // Add Test script
      document.querySelector('.config-tab[data-config="tests"]').click();
      if (testsEditor) {
        testsEditor.setValue([
          'pm.test("Status is 201 Created", function () {',
          '    pm.response.to.have.status(201);',
          '});',
          'pm.test("Title matches input", function () {',
          '    var data = pm.response.json();',
          '    pm.expect(data.title).to.eql("ExpressPost Mock Test");',
          '});',
          'pm.test("Auto-generated ID is present", function () {',
          '    var data = pm.response.json();',
          '    pm.expect(data.id).to.be.above(0);',
          '});'
        ].join('\\n'), -1);
      }

      document.getElementById('btn-send-request').click();
    })()`);

    await waitFor(() => cdp.evaluate(`Boolean(!document.getElementById('response-metadata').classList.contains('hidden') && getActiveTab()?.response && document.getElementById('resp-status').innerText.startsWith('201'))`));

    const test2Results = await cdp.evaluate(`({
      status: document.getElementById('resp-status').innerText,
      testBadge: document.getElementById('test-pass-badge').innerText,
      body: document.getElementById('response-raw-text')?.value || '',
      reqBodyFormatted: typeof bodyEditor !== 'undefined' ? bodyEditor.getValue() : ''
    })`);

    assert.match(test2Results.status, /^201 Created/);
    assert.equal(test2Results.testBadge, '3/3', 'All 3 test assertions must pass');
    assert.match(test2Results.body, /ExpressPost Mock Test/);
    assert.ok(test2Results.reqBodyFormatted.includes('\n'), 'Request body editor should be formatted multiline JSON after Beautify');
    assert.ok(test2Results.reqBodyFormatted.includes('{{fusionCookie}}'), 'Request body formatting should preserve Postman variables');
    console.log('   ✓ Test 2 Passed: 201 Created, Tests passed: 3/3 (Beautify verified on request body with variables)');

    // =========================================================================
    // TEST 3: Variable Interpolation: dummyjson.com/products/{{productId}}
    // =========================================================================
    console.log('-> Running Mock API Test 3: dummyjson.com/products/{{productId}} with variable chip & popover');
    await cdp.evaluate(`(() => {
      createNewTab();
      const urlEl = document.getElementById('request-url');
      urlEl.value = 'https://dummyjson.com/products/{{productId}}';
      urlEl.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    await waitFor(() => cdp.evaluate(`!document.getElementById('url-var-pills').classList.contains('hidden')`));
    const pillState = await cdp.evaluate(`({
      name: document.querySelector('.url-var-pill-name')?.textContent,
      isUnresolved: document.querySelector('.url-var-pill')?.classList.contains('is-unresolved')
    })`);
    assert.equal(pillState.name, 'productId');
    assert.equal(pillState.isUnresolved, true);

    // Click pill to set value
    await cdp.evaluate(`document.querySelector('.url-var-pill').click()`);
    await waitFor(() => cdp.evaluate(`!document.getElementById('variable-popover').classList.contains('hidden')`));
    await cdp.evaluate(`(() => {
      document.getElementById('var-popover-value').value = '1';
      document.getElementById('btn-save-var-popover').click();
    })()`);
    await waitFor(() => cdp.evaluate(`document.getElementById('variable-popover').classList.contains('hidden')`));

    // Send request with resolved variable
    await cdp.evaluate(`document.getElementById('btn-send-request').click()`);
    await waitFor(() => cdp.evaluate(`Boolean(!document.getElementById('response-metadata').classList.contains('hidden') && getActiveTab()?.response && document.getElementById('resp-status').innerText.startsWith('200'))`));

    const test3Body = await cdp.evaluate(`document.getElementById('response-raw-text')?.value || ''`);
    assert.match(test3Body, /Essence Mascara Lash Princess/);
    console.log('   ✓ Test 3 Passed: 200 OK with {{productId}} -> 1 resolved and returned product data');

    // =========================================================================
    // TEST 4: Built-in Mock Server Engine: Create & Query Mock Endpoint
    // =========================================================================
    console.log('-> Running Mock API Test 4: Built-in ExpressPost Mock Server Engine');
    await cdp.evaluate(`(() => {
      document.querySelector('.nav-tab[data-tab="mocks"]').click();
      document.getElementById('btn-new-mock').click();
      document.getElementById('mock-method').value = 'GET';
      document.getElementById('mock-path').value = '/api/v2/orders/1001';
      document.getElementById('mock-status').value = '200';
      document.getElementById('mock-body').value = JSON.stringify({
        orderId: 'ORD-1001',
        customer: 'Acme Corp',
        total: 450.00,
        status: 'Confirmed'
      }, null, 2);
      document.getElementById('btn-save-mock').click();
    })()`);

    await waitFor(() => cdp.evaluate(`document.querySelectorAll('#mocks-list .mock-list-item').length > 1`));

    // Open newly created mock in tab and send
    await cdp.evaluate(`document.querySelector('#mocks-list .mock-list-item:last-child .btn-test-mock').click()`);
    await cdp.evaluate(`document.getElementById('btn-send-request').click()`);
    await waitFor(() => cdp.evaluate(`Boolean(!document.getElementById('response-metadata').classList.contains('hidden') && getActiveTab()?.response && document.getElementById('resp-status').innerText.startsWith('200'))`));

    const mockBody = await cdp.evaluate(`document.getElementById('response-raw-text')?.value || ''`);
    assert.match(mockBody, /ORD-1001/);
    assert.match(mockBody, /Acme Corp/);
    console.log('   ✓ Test 4 Passed: Built-in mock route /api/v2/orders/1001 returned defined mock payload');

    // =========================================================================
    // TEST 5: Collection Runner with 3 Diverse Mock API Requests
    // =========================================================================
    console.log('-> Running Mock API Test 5: Collection Runner batch execution of mock APIs');
    await cdp.evaluate(`(() => {
      const suiteColl = {
        id: 'coll-mock-suite',
        name: 'Mock APIs Suite',
        variables: {},
        requests: [
          {
            id: 'req-m1',
            name: 'Get User (JSONPlaceholder)',
            method: 'GET',
            url: 'https://jsonplaceholder.typicode.com/users/1',
            headers: [],
            bodyType: 'none',
            testsScript: 'pm.test("Status is 200", () => pm.response.to.have.status(200));'
          },
          {
            id: 'req-m2',
            name: 'Get Quote (DummyJSON)',
            method: 'GET',
            url: 'https://dummyjson.com/quotes/1',
            headers: [],
            bodyType: 'none',
            testsScript: 'pm.test("Status is 200", () => pm.response.to.have.status(200));'
          },
          {
            id: 'req-m3',
            name: 'Get Mock Order (Built-in Mock)',
            method: 'GET',
            url: '${appBase}/mock/api/v2/orders/1001',
            headers: [],
            bodyType: 'none',
            testsScript: 'pm.test("Status is 200", () => pm.response.to.have.status(200)); pm.test("Order verified", () => pm.expect(pm.response.json().orderId).to.eql("ORD-1001"));'
          }
        ]
      };
      collections.push(suiteColl);
      saveCollections();
      renderCollections();
      populateRunnerSelects();

      // Open Runner
      document.querySelector('.btn-run-coll-direct[data-id="coll-mock-suite"]').click();
    })()`);

    await waitFor(() => cdp.evaluate(`document.querySelectorAll('#runner-request-checklist input').length === 3`));
    await cdp.evaluate(`document.getElementById('btn-start-run').click()`);

    await waitFor(() => cdp.evaluate(`document.querySelectorAll('#runner-execution-logs .runner-log-item').length === 3`), 25000);

    const runnerSummary = await cdp.evaluate(`({
      rowCount: document.querySelectorAll('#runner-execution-logs .runner-log-item').length,
      totalStat: document.getElementById('run-stat-total-req').innerText,
      passedStat: document.getElementById('run-stat-passed').innerText,
      failedStat: document.getElementById('run-stat-failed').innerText
    })`);

    assert.equal(runnerSummary.rowCount, 3, 'Must execute all 3 collection requests');
    assert.equal(runnerSummary.totalStat, '3 / 3', 'Total requests stat must reach 3 / 3');
    assert.equal(runnerSummary.failedStat, '0', 'No test assertions in mock suite should fail');
    console.log('   ✓ Test 5 Passed: Collection Runner executed all 3 mock requests with 100% success (Passed:', runnerSummary.passedStat, 'Failed: 0)');

  } finally {
    if (cdp) cdp.close();
    chromeProc.kill();
    await new Promise(r => appServer.close(r));
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
});
