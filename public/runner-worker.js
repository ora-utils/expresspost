/**
 * ExpressPost Collection Runner Worker
 * Executes requests, evaluates pre-request/test scripts in a background thread,
 * and communicates results back to the main runner thread.
 */

importScripts('utils.js', 'sandbox.js');

self.onmessage = async function(e) {
  const { action, request, globals, environment, proxyUrl, engine, iterationData, meta } = e.data;

  if (action === 'run_request') {
    try {
      const result = await executeRequestInWorker(request, globals, environment, proxyUrl, engine, iterationData, meta);
      self.postMessage({ status: 'success', result });
    } catch (error) {
      self.postMessage({
        status: 'error',
        error: error.message,
        requestId: request && request.id
      });
    }
  }
};

function makeScopes(globals, environment, collectionVariables, iterationData, localVariables) {
  return {
    globals: globals || {},
    collectionVariables: collectionVariables || {},
    environment: environment || {},
    iterationData: iterationData || {},
    localVariables: localVariables || {}
  };
}

/**
 * Executes a single API request, running pre-request and post-response assertion scripts
 */
async function executeRequestInWorker(req, globals, environment, proxyUrl, engine, iterationData = {}, meta = {}) {
  let requestGlobals = { ...(globals || {}) };
  let requestEnv = { ...(environment || {}) };
  let requestCollectionVariables = { ...(req.collectionVariables || {}) };
  let requestLocalVariables = {};
  const safeIterationData = { ...(iterationData || {}) };

  let requestUrl = req.url || '';
  let requestMethod = req.method || 'GET';
  let requestBodyType = req.bodyType || 'none';
  const requestBodyRawType = req.bodyRawType || 'application/json';
  let requestHeaders = getHeadersObject(req.headers);
  let preRequestResults = [];
  let nextRequest = undefined;
  let requestBody = requestBodyType === 'form-data'
    ? (req.formdata || req.formData || [])
    : requestBodyType === 'urlencoded'
      ? (req.urlencoded || [])
      : req.body;

  // 1. Run Pre-request Script
  let preRequestLogs = [];
  if (req.preRequestScript && req.preRequestScript.trim() !== '') {
    const preSandboxResult = await runScriptSandbox(req.preRequestScript, {
      globals: requestGlobals,
      environment: requestEnv,
      collectionVariables: requestCollectionVariables,
      localVariables: requestLocalVariables,
      iterationData: safeIterationData,
      info: {
        eventName: 'prerequest',
        requestName: req.name || '',
        requestId: req.id || '',
        iteration: meta.iteration || 1,
        iterationCount: meta.iterationCount || 1
      },
      sendRequest: options => executeScriptRequest(options, engine, proxyUrl),
      request: {
        url: requestUrl,
        method: requestMethod,
        headers: requestHeaders,
        body: requestBody,
        bodyType: requestBodyType
      }
    });

    requestGlobals = preSandboxResult.globals;
    requestEnv = preSandboxResult.environment;
    requestCollectionVariables = preSandboxResult.collectionVariables;
    requestLocalVariables = preSandboxResult.localVariables;
    preRequestResults = preSandboxResult.testResults;
    requestUrl = preSandboxResult.request.url || requestUrl;
    requestMethod = preSandboxResult.request.method || requestMethod;
    requestHeaders = preSandboxResult.request.headers || requestHeaders;
    requestBody = preSandboxResult.request.body;
    requestBodyType = preSandboxResult.request.bodyType || requestBodyType;
    if (preSandboxResult.nextRequest !== undefined) {
      nextRequest = preSandboxResult.nextRequest;
    }
    preRequestLogs = preSandboxResult.logs;
  }

  // 2. Resolve Variables
  const scopes = makeScopes(requestGlobals, requestEnv, requestCollectionVariables, safeIterationData, requestLocalVariables);
  let resolvedUrl = resolveVariables(requestUrl, scopes);
  const resolvedHeaders = resolveHeaders(requestHeaders, scopes);
  const resolvedBody = resolveRequestBody(requestBody, requestBodyType, scopes);

  // 3. Inject Authorization
  resolvedUrl = injectAuthorization(req.auth, resolvedHeaders, resolvedUrl, scopes);

  // 4. Send HTTP Request (Direct or Proxy Mode)
  let responseData = null;
  const start = Date.now();

  try {
    if (engine === 'proxy') {
      responseData = await executeProxyRequest(proxyUrl, requestMethod, resolvedUrl, resolvedHeaders, resolvedBody, requestBodyType, requestBodyRawType);
    } else {
      responseData = await executeDirectRequest(requestMethod, resolvedUrl, resolvedHeaders, resolvedBody, requestBodyType, requestBodyRawType);
    }
  } catch (err) {
    responseData = {
      status: 0,
      statusText: 'Connection Failed',
      headers: {},
      body: `Error: ${err.message}`,
      time: Date.now() - start,
      size: 0
    };
  }

  // 5. Run Test Scripts
  let testLogs = [];
  const testResults = preRequestResults;
  if (req.testsScript && req.testsScript.trim() !== '') {
    const testSandboxResult = await runScriptSandbox(req.testsScript, {
      globals: requestGlobals,
      environment: requestEnv,
      collectionVariables: requestCollectionVariables,
      localVariables: requestLocalVariables,
      iterationData: safeIterationData,
      info: {
        eventName: 'test',
        requestName: req.name || '',
        requestId: req.id || '',
        iteration: meta.iteration || 1,
        iterationCount: meta.iterationCount || 1
      },
      sendRequest: options => executeScriptRequest(options, engine, proxyUrl),
      request: {
        url: resolvedUrl,
        method: requestMethod,
        headers: resolvedHeaders,
        body: typeof resolvedBody === 'string' ? resolvedBody : JSON.stringify(resolvedBody)
      },
      response: responseData
    });

    requestGlobals = testSandboxResult.globals;
    requestEnv = testSandboxResult.environment;
    requestCollectionVariables = testSandboxResult.collectionVariables;
    requestLocalVariables = testSandboxResult.localVariables;
    if (testSandboxResult.nextRequest !== undefined) {
      nextRequest = testSandboxResult.nextRequest;
    }
    testLogs = testSandboxResult.logs;
    testResults.push(...testSandboxResult.testResults);
  }

  return {
    requestId: req.id,
    requestName: req.name,
    method: requestMethod,
    url: resolvedUrl,
    requestBody: typeof resolvedBody === 'string' ? resolvedBody : (resolvedBody ? JSON.stringify(resolvedBody) : ''),
    globals: requestGlobals,
    environment: requestEnv,
    collectionVariables: requestCollectionVariables,
    nextRequest,
    logs: [...preRequestLogs, ...testLogs],
    testResults: testResults,
    response: responseData
  };
}

function getHeadersObject(headersArray) {
  const headers = {};
  if (Array.isArray(headersArray)) {
    headersArray.forEach(h => {
      if (h.enabled !== false && h.key) {
        headers[h.key] = h.value || '';
      }
    });
  }
  return headers;
}

function resolveHeaders(headersArray, scopes) {
  const headers = {};
  if (Array.isArray(headersArray)) {
    headersArray.forEach(h => {
      if (h.enabled !== false && h.key) {
        const resolvedKey = resolveVariables(h.key, scopes);
        const resolvedVal = resolveVariables(h.value || '', scopes);
        headers[resolvedKey] = resolvedVal;
      }
    });
  } else {
    Object.entries(headersArray || {}).forEach(([key, value]) => {
      headers[resolveVariables(key, scopes)] = resolveVariables(value || '', scopes);
    });
  }
  return headers;
}

function resolveRequestBody(body, bodyType, scopes) {
  if (bodyType === 'none') return null;

  if (bodyType === 'raw') {
    return resolveVariables(body || '', scopes);
  }

  if (Array.isArray(body)) {
    const resolvedFields = [];
    body.forEach(item => {
      if (item.enabled !== false && item.key) {
        resolvedFields.push({
          key: resolveVariables(item.key, scopes),
          value: resolveVariables(item.value || '', scopes),
          type: item.type || 'text',
          fileName: item.fileName || '',
          fileData: item.fileData || ''
        });
      }
    });
    return resolvedFields;
  }

  return body;
}

function injectAuthorization(auth, headers, url, scopes) {
  if (!auth || auth.type === 'none') return url;

  if (auth.type === 'bearer' && auth.bearerToken) {
    const token = resolveVariables(auth.bearerToken, scopes);
    headers['Authorization'] = `Bearer ${token}`;
  } else if (auth.type === 'basic') {
    const username = resolveVariables(auth.username || '', scopes);
    const password = resolveVariables(auth.password || '', scopes);
    const hash = btoa(`${username}:${password}`);
    headers['Authorization'] = `Basic ${hash}`;
  } else if (auth.type === 'oauth2') {
    if (!auth.oauthAccessToken) throw new Error('OAuth access token is missing. Get a token before starting the runner.');
    headers.Authorization = `Bearer ${auth.oauthAccessToken}`;
  } else if (auth.type === 'apikey' && auth.key) {
    const key = resolveVariables(auth.key, scopes);
    const value = resolveVariables(auth.value || '', scopes);

    if (auth.in === 'header') {
      headers[key] = value;
    } else {
      try {
        const urlObj = new URL(url);
        urlObj.searchParams.set(key, value);
        url = urlObj.toString();
      } catch (e) {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      }
    }
  }
  return url;
}

async function executeProxyRequest(proxyUrl, method, url, headers, body, bodyType, bodyRawType = 'application/json') {
  const hasContentType = Object.keys(headers).some(key => key.toLowerCase() === 'content-type');
  if (bodyType === 'raw' && body && !hasContentType) {
    headers['content-type'] = bodyRawType || 'application/json';
  } else if (bodyType === 'urlencoded' && !hasContentType) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (bodyType === 'form-data' && !hasContentType) {
    headers['content-type'] = 'multipart/form-data';
  }

  let finalBody = body;
  if (bodyType === 'urlencoded' && Array.isArray(body)) {
    const params = new URLSearchParams();
    body.forEach(item => params.append(item.key, item.value));
    finalBody = params.toString();
  }

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      method,
      headers,
      body: finalBody
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Proxy error: ${response.statusText}`);
  }

  return payload;
}

async function executeScriptRequest(options, engine, proxyUrl) {
  const request = typeof options === 'string' ? { url: options } : options;
  const url = typeof request.url === 'string' ? request.url : request.url && request.url.raw;
  const method = String(request.method || 'GET').toUpperCase();
  const headers = Array.isArray(request.header)
    ? request.header.reduce((result, header) => {
      if (header.key && header.disabled !== true) result[header.key] = header.value || '';
      return result;
    }, {})
    : { ...(request.headers || request.header || {}) };
  let body = request.body;
  let bodyType = body == null ? 'none' : 'raw';
  if (body && typeof body === 'object') {
    if (body.mode === 'urlencoded') {
      body = body.urlencoded || [];
      bodyType = 'urlencoded';
    } else if (body.mode === 'formdata') {
      body = body.formdata || [];
      bodyType = 'form-data';
    } else {
      body = body.raw;
      bodyType = body == null ? 'none' : 'raw';
    }
  }

  if (!url) throw new Error('pm.sendRequest requires a URL.');
  if (engine === 'proxy') {
    return executeProxyRequest(proxyUrl, method, url, headers, body, bodyType);
  }
  return executeDirectRequest(method, url, headers, body, bodyType);
}

async function executeDirectRequest(method, url, headers, body, bodyType, bodyRawType = 'application/json') {
  const fetchOptions = {
    method: method,
    headers: new Headers(headers)
  };

  if (bodyType === 'raw' && body) {
    fetchOptions.body = body;
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
      fetchOptions.headers.set('Content-Type', bodyRawType || 'application/json');
    }
  } else if (bodyType === 'urlencoded' && Array.isArray(body)) {
    const params = new URLSearchParams();
    body.forEach(item => params.append(item.key, item.value));
    fetchOptions.body = params.toString();
    fetchOptions.headers.set('Content-Type', 'application/x-www-form-urlencoded');
  } else if (bodyType === 'form-data' && Array.isArray(body)) {
    const formData = new FormData();
    body.forEach(item => {
      if (item.type === 'file' && item.fileData) {
        const matches = String(item.fileData).match(/^data:([^;,]*)(?:;[^,]*)?;base64,(.+)$/);
        if (matches) {
          const fileBuffer = base64ToArrayBuffer(matches[2]);
          const blob = new Blob([fileBuffer], { type: matches[1] || 'application/octet-stream' });
          formData.append(item.key, blob, item.fileName || 'file');
        }
      } else {
        formData.append(item.key, item.value || '');
      }
    });
    fetchOptions.body = formData;
    fetchOptions.headers.delete('Content-Type');
  }

  const start = Date.now();
  const response = await fetch(url, fetchOptions);
  const duration = Date.now() - start;

  const responseHeaders = {};
  response.headers.forEach((val, key) => {
    responseHeaders[key] = val;
  });

  const responseText = await response.text();
  const size = getByteLength(responseText);

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: responseText,
    time: duration,
    size: size
  };
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
