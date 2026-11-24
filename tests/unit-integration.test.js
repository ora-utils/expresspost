const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const utils = require('../public/utils.js');
const { runScriptSandbox } = require('../public/sandbox.js');
const snippets = require('../public/snippets.js');
const { startServer } = require('../server.js');

test('utils: escapeHTML neutralizes XSS characters', () => {
  assert.equal(
    utils.escapeHTML('<script>alert("x" & \'y\')</script>'),
    '&lt;script&gt;alert(&quot;x&quot; &amp; &#039;y&#039;)&lt;/script&gt;'
  );
});

test('utils: resolveVariables enforces Postman scope precedence', () => {
  const scopes = {
    globals: { a: 'g', b: 'g', c: 'g', d: 'g', e: 'g' },
    collectionVariables: { a: 'c', b: 'c', c: 'c', d: 'c' },
    environment: { a: 'env', b: 'env', c: 'env' },
    iterationData: { a: 'data', b: 'data' },
    localVariables: { a: 'local' }
  };
  const resolved = utils.resolveVariables('{{a}}-{{b}}-{{c}}-{{d}}-{{e}}-{{missing}}', scopes);
  assert.equal(resolved, 'local-data-env-c-g-{{missing}}');
});

test('utils: parseUrlParams and rebuildUrlFromParams preserve {{vars}}, =, malformed %, and #hash', () => {
  const url = 'https://example.com/api?token=abc==&role={{userRole}}&pct=100%#section';
  const params = utils.parseUrlParams(url);
  assert.equal(params.length, 3);
  assert.deepEqual(params[0], { key: 'token', value: 'abc==', enabled: true, description: '' });
  assert.deepEqual(params[1], { key: 'role', value: '{{userRole}}', enabled: true, description: '' });
  assert.deepEqual(params[2], { key: 'pct', value: '100%', enabled: true, description: '' });

  params[0].enabled = false;
  const rebuilt = utils.rebuildUrlFromParams(url, params);
  assert.equal(rebuilt, 'https://example.com/api?role={{userRole}}&pct=100%25#section');
});

test('utils: parseCSV handles BOM, quoted commas, escaped quotes, and CRLF', () => {
  const csv = '\uFEFFname,note,role\r\n"Doe, Jane","Said ""hello""",admin\r\nBob,simple,user\r\n';
  const rows = utils.parseCSV(csv);
  assert.deepEqual(rows, [
    { name: 'Doe, Jane', note: 'Said "hello"', role: 'admin' },
    { name: 'Bob', note: 'simple', role: 'user' }
  ]);
});

test('utils: parseCurlCommand parses headers, auth, JSON body, form-data, and multiline', () => {
  const curl = `curl -X POST \\\n  'https://api.example.com/v1/items' \\\n  -H 'Authorization: Bearer tok_123' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"widget","qty":2}'`;
  const parsed = utils.parseCurlCommand(curl);
  assert.equal(parsed.method, 'POST');
  assert.equal(parsed.url, 'https://api.example.com/v1/items');
  assert.deepEqual(parsed.auth, { type: 'bearer', bearerToken: 'tok_123' });
  assert.equal(parsed.bodyType, 'raw');
  assert.equal(parsed.bodyRawType, 'application/json');
  assert.equal(parsed.body, '{"name":"widget","qty":2}');

  const formCurl = `curl -u admin:pass123 -F 'field=hello' -F 'file=@/tmp/doc.pdf' https://upload.example.com`;
  const parsedForm = utils.parseCurlCommand(formCurl);
  assert.equal(parsedForm.method, 'POST');
  assert.deepEqual(parsedForm.auth, { type: 'basic', username: 'admin', password: 'pass123' });
  assert.equal(parsedForm.bodyType, 'form-data');
  assert.equal(parsedForm.formdata.length, 2);
  assert.equal(parsedForm.formdata[1].type, 'file');
  assert.equal(parsedForm.formdata[1].fileName, 'doc.pdf');
});

test('utils: findVariableAtOffset extracts {{var}} under cursor or adjacent tokens accurately', () => {
  const sample = 'Cookie: JSESSIONID={{fusionCookie}}{{tenantId}}; end';
  const firstStart = sample.indexOf('{{fusionCookie}}');
  const secondStart = sample.indexOf('{{tenantId}}');

  assert.equal(utils.findVariableAtOffset(sample, 3), null);
  assert.deepEqual(utils.findVariableAtOffset(sample, firstStart + 4), {
    name: 'fusionCookie',
    raw: '{{fusionCookie}}',
    start: firstStart,
    end: secondStart
  });
  assert.deepEqual(utils.findVariableAtOffset(sample, secondStart + 3), {
    name: 'tenantId',
    raw: '{{tenantId}}',
    start: secondStart,
    end: secondStart + '{{tenantId}}'.length
  });
  assert.deepEqual(utils.getPartialVariableQueryAtOffset('https://api.test/{{fus', 22), {
    query: 'fus',
    start: 17,
    end: 22
  });
  assert.equal(utils.getPartialVariableQueryAtOffset('https://api.test/{{fus}}', 24), null);
});

test('utils: formatJSON, formatXML, formatHTML, and prettifyContent format single-line text', () => {
  // 1. JSON formatting
  const singleLineJson = '{"name":"ExpressPost","version":1,"active":true,"tags":["api","client"]}';
  const formattedJson = utils.formatJSON(singleLineJson, 2);
  assert.ok(formattedJson.includes('\n'), 'JSON should be multiline');
  assert.ok(formattedJson.includes('  "name": "ExpressPost"'), 'Indentation should be 2 spaces');

  // 2. JSON with Postman variables (quoted and unquoted)
  const jsonWithVars = '{"token":"{{fusionCookie}}","userId":{{userId}},"valid":true,}';
  const formattedVars = utils.formatJSON(jsonWithVars, 2);
  assert.ok(formattedVars.includes('\n'), 'JSON with variables should be multiline');
  assert.ok(formattedVars.includes('"token": "{{fusionCookie}}"'), 'Preserves quoted variable');
  assert.ok(formattedVars.includes('"userId": {{userId}}'), 'Preserves unquoted variable');

  // 3. XML formatting
  const singleLineXml = '<root><user id="1"><name>Ada</name><role>Admin</role></user></root>';
  const formattedXml = utils.formatXML(singleLineXml, 2);
  assert.ok(formattedXml.includes('\n'), 'XML should be multiline');
  assert.ok(formattedXml.includes('  <user id="1">'), 'XML tags indented');

  // 4. HTML formatting
  const singleLineHtml = '<html><head><title>Test</title></head><body><h1>Hello</h1><br><p>World</p></body></html>';
  const formattedHtml = utils.formatHTML(singleLineHtml, 2);
  assert.ok(formattedHtml.includes('\n'), 'HTML should be multiline');

  // 5. PrettifyContent auto-detect
  assert.ok(utils.prettifyContent(singleLineJson, 'auto').includes('\n'), 'Auto-detects JSON');
  assert.ok(utils.prettifyContent(singleLineXml, 'auto').includes('\n'), 'Auto-detects XML');
  assert.equal(utils.prettifyContent('Plain text unchanged', 'auto'), 'Plain text unchanged');
});

test('sandbox: supports deep equality, negated property, iterationData, setNextRequest, and sendRequest', async () => {
  const script = `
    pm.request.headers.upsert({ key: 'X-Trace', value: pm.variables.get('traceId') });
    pm.environment.set('computed', pm.variables.get('fromData') + '_ok');
    postman.setNextRequest('Step 2');

    pm.test('object key order ignored', () => {
      pm.expect({ a: 1, b: { c: 2, d: 3 } }).to.eql({ b: { d: 3, c: 2 }, a: 1 });
    });

    pm.test('negated property checks', () => {
      pm.expect({ a: 1 }).to.not.have.property('b');
      pm.expect({ a: 1 }).to.not.have.property('a', 2);
    });

    pm.test('type and response assertions', () => {
      pm.expect([1, 2]).to.be.an('array');
      pm.expect(null).to.be.null;
      pm.response.to.be.ok;
      pm.response.to.have.status(200);
      pm.response.to.have.jsonBody({ ok: true });
    });

    const sub = await pm.sendRequest('https://mock.local/sub');
    pm.test('sendRequest works', () => {
      pm.expect(sub.json().sub).to.equal(42);
    });
  `;

  const result = await runScriptSandbox(script, {
    globals: { traceId: 'tr-1' },
    environment: {},
    collectionVariables: {},
    iterationData: { fromData: 'row1' },
    request: { url: 'https://example.com', method: 'GET', headers: {}, body: '' },
    response: { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '{"ok":true}', time: 12, size: 11 },
    sendRequest: async () => ({ status: 200, statusText: 'OK', headers: {}, body: '{"sub":42}', time: 5, size: 10 })
  });

  assert.equal(result.request.headers['X-Trace'], 'tr-1');
  assert.equal(result.environment.computed, 'row1_ok');
  assert.equal(result.nextRequest, 'Step 2');
  assert.equal(result.testResults.length, 4);
  assert.ok(result.testResults.every(t => t.passed), JSON.stringify(result.testResults));
});

test('snippets: generates valid code without duplicate Content-Type or JSON.stringify crash on templates', () => {
  const req = {
    method: 'POST',
    url: 'https://api.example.com/users',
    headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
    auth: { type: 'apikey', key: 'api_key', value: 'k123', in: 'query' },
    bodyType: 'raw',
    bodyRawType: 'application/json',
    body: '{"id": {{userId}}, "name": "Ada"}'
  };

  const curl = snippets.generateCurl(req);
  assert.match(curl, /api_key=k123/);
  assert.equal((curl.match(/content-type/gi) || []).length, 1);

  const nodeCode = snippets.generateNode(req);
  assert.doesNotThrow(() => new Function(nodeCode.replace(/require\([^)]+\)/g, '{}')));

  const pyCode = snippets.generatePython(req);
  assert.match(pyCode, /requests\.request\("POST", url/);
});

test('server: proxy, UTF-8 + binary multipart, validation, and mock server work end-to-end', async () => {
  // Local echo server for proxy target
  let lastReceived = null;
  const echoServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      lastReceived = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodyBuffer: Buffer.concat(chunks)
      };
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Echo': 'yes' });
      res.end(JSON.stringify({ ok: true, bytes: lastReceived.bodyBuffer.length }));
    });
  });

  await new Promise(resolve => echoServer.listen(0, '127.0.0.1', resolve));
  const echoPort = echoServer.address().port;

  const appServer = await startServer(0);
  const appPort = appServer.address().port;
  const baseUrl = `http://127.0.0.1:${appPort}`;

  try {
    // 1. Health endpoint
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');

    // 2. Reject invalid protocol
    const badRes = await fetch(`${baseUrl}/api/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'file:///etc/passwd', method: 'GET' })
    });
    assert.equal(badRes.status, 400);

    // 3. Multipart with UTF-8 field + binary file bytes
    const binaryBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
    const dataUri = `data:image/png;base64,${binaryBytes.toString('base64')}`;
    const proxyRes = await fetch(`${baseUrl}/api/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `http://127.0.0.1:${echoPort}/upload`,
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: [
          { key: 'title', value: 'Café ₹100', type: 'text' },
          { key: 'avatar', type: 'file', fileName: 'pic.png', fileData: dataUri }
        ]
      })
    });
    assert.equal(proxyRes.status, 200);
    const proxyJson = await proxyRes.json();
    assert.equal(proxyJson.status, 200);
    assert.ok(lastReceived.bodyBuffer.includes(Buffer.from('Café ₹100', 'utf8')));
    assert.ok(lastReceived.bodyBuffer.includes(binaryBytes));

    // 4. Mock server sync + execution + 204 + disabled mock
    const syncRes = await fetch(`${baseUrl}/api/mocks/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mocks: [
          {
            id: 'm1',
            method: 'GET',
            path: 'items',
            status: 201,
            contentType: 'application/json',
            headers: [{ key: 'X-Custom', value: 'mocked', enabled: true }],
            body: '{"items":[1,2,3]}',
            enabled: true
          },
          {
            id: 'm2',
            method: 'DELETE',
            path: '/items/1',
            status: 204,
            body: '',
            enabled: true
          },
          {
            id: 'm3',
            method: 'GET',
            path: '/disabled',
            status: 200,
            body: 'no',
            enabled: false
          }
        ]
      })
    });
    assert.equal(syncRes.status, 200);

    const mockGet = await fetch(`${baseUrl}/mock/items`);
    assert.equal(mockGet.status, 201);
    assert.equal(mockGet.headers.get('x-custom'), 'mocked');
    assert.deepEqual(await mockGet.json(), { items: [1, 2, 3] });

    const mockDel = await fetch(`${baseUrl}/mock/items/1`, { method: 'DELETE' });
    assert.equal(mockDel.status, 204);

    const mockDisabled = await fetch(`${baseUrl}/mock/disabled`);
    assert.equal(mockDisabled.status, 404);
  } finally {
    await new Promise(resolve => appServer.close(resolve));
    await new Promise(resolve => echoServer.close(resolve));
  }
});

