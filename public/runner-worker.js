/**
 * AeroPost Collection Runner Worker
 * Executes requests, evaluates pre-request/test scripts in a background thread,
 * and communicates results back to the main runner thread.
 */

// Import the sandbox library
importScripts('sandbox.js');

// Listen for execution commands from the main thread
self.onmessage = async function(e) {
  const { action, request, globals, environment, proxyUrl, engine, iterationData } = e.data;

  if (action === 'run_request') {
    try {
      const result = await executeRequestInWorker(request, globals, environment, proxyUrl, engine, iterationData);
      self.postMessage({ status: 'success', result });
    } catch (error) {
      self.postMessage({
        status: 'error',
        error: error.message,
        requestId: request.id
      });
    }
  }
};

/**
 * Executes a single API request, running pre-request and post-response assertion scripts
 */
async function executeRequestInWorker(req, globals, environment, proxyUrl, engine, iterationData = {}) {
  let requestGlobals = { ...globals };
  let requestEnv = { ...environment };
  let requestCollectionVariables = { ...(req.collectionVariables || {}) };
  let requestLocalVariables = {};
  let requestUrl = req.url;
  let requestMethod = req.method;
  let requestBodyType = req.bodyType;
  let requestHeaders = getHeadersObject(req.headers);
  let preRequestResults = [];
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
      iterationData,
      sendRequest: options => executeScriptRequest(options, engine, proxyUrl),
      request: {
        url: requestUrl,
        method: requestMethod,
        headers: requestHeaders,
        body: requestBody,
        bodyType: requestBodyType
      }
    });
    
    // Capture mutations
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
    preRequestLogs = preSandboxResult.logs;
  }

  // 2. Resolve Variables
  let resolvedUrl = resolveVariables(requestUrl, requestGlobals, requestEnv, requestLocalVariables, requestCollectionVariables);
  const resolvedHeaders = resolveHeaders(requestHeaders, requestGlobals, requestEnv, requestLocalVariables, requestCollectionVariables);
  const resolvedBody = resolveRequestBody(requestBody, requestBodyType, requestGlobals, requestEnv, requestLocalVariables, requestCollectionVariables);

  // 3. Inject Authorization
  resolvedUrl = injectAuthorization(req.auth, resolvedHeaders, resolvedUrl, requestGlobals, {
    ...requestEnv,
    ...requestCollectionVariables,
    ...requestLocalVariables
  });

  // 4. Send HTTP Request (Direct or Proxy Mode)
  let responseData = null;
  const start = Date.now();

  try {
    if (engine === 'proxy') {
      responseData = await executeProxyRequest(proxyUrl, requestMethod, resolvedUrl, resolvedHeaders, resolvedBody, requestBodyType);
    } else {
      responseData = await executeDirectRequest(requestMethod, resolvedUrl, resolvedHeaders, resolvedBody, requestBodyType);
    }
  } catch (err) {
    // Return connection failure representation
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
  let testResults = preRequestResults;
  if (req.testsScript && req.testsScript.trim() !== '') {
    const testSandboxResult = await runScriptSandbox(req.testsScript, {
      globals: requestGlobals,
      environment: requestEnv,
      collectionVariables: requestCollectionVariables,
      localVariables: requestLocalVariables,
      iterationData,
      sendRequest: options => executeScriptRequest(options, engine, proxyUrl),
      request: {
        url: resolvedUrl,
        method: requestMethod,
        headers: resolvedHeaders,
        body: typeof resolvedBody === 'string' ? resolvedBody : JSON.stringify(resolvedBody)
      },
      response: responseData
    });

    // Capture mutations & outputs
    requestGlobals = testSandboxResult.globals;
    requestEnv = testSandboxResult.environment;
    requestCollectionVariables = testSandboxResult.collectionVariables;
    requestLocalVariables = testSandboxResult.localVariables;
    testLogs = testSandboxResult.logs;
    testResults.push(...testSandboxResult.testResults);
  }

  return {
    requestId: req.id,
    requestName: req.name,
    method: requestMethod,
    url: resolvedUrl,
    requestBody: typeof resolvedBody === 'string' ? resolvedBody : JSON.stringify(resolvedBody),
    globals: requestGlobals,
    environment: requestEnv,
    collectionVariables: requestCollectionVariables,
    logs: [...preRequestLogs, ...testLogs],
    testResults: testResults,
    response: responseData
  };
}

/**
 * Replaces double curly brace variables {{my_var}} in strings
 */
function resolveVariables(str, globals, environment, localVariables = {}, collectionVariables = {}) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (trimmedKey in localVariables) return localVariables[trimmedKey];
    if (trimmedKey in environment) return environment[trimmedKey];
    if (trimmedKey in collectionVariables) return collectionVariables[trimmedKey];
    if (trimmedKey in globals) return globals[trimmedKey];
    return match;
  });
}

/**
 * Returns header key-values as flat object
 */
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

/**
 * Resolves headers list keys & values
 */
function resolveHeaders(headersArray, globals, environment, localVariables = {}, collectionVariables = {}) {
  const headers = {};
  if (Array.isArray(headersArray)) {
    headersArray.forEach(h => {
      if (h.enabled !== false && h.key) {
        const resolvedKey = resolveVariables(h.key, globals, environment, localVariables, collectionVariables);
        const resolvedVal = resolveVariables(h.value || '', globals, environment, localVariables, collectionVariables);
        headers[resolvedKey] = resolvedVal;
      }
    });
  } else {
    Object.entries(headersArray || {}).forEach(([key, value]) => {
      headers[resolveVariables(key, globals, environment, localVariables, collectionVariables)] =
        resolveVariables(value || '', globals, environment, localVariables, collectionVariables);
    });
  }
  return headers;
}

/**
 * Resolves body parameters and structures form data or urlencoded inputs
 */
function resolveRequestBody(body, bodyType, globals, environment, localVariables = {}, collectionVariables = {}) {
  if (bodyType === 'none') return null;

  if (bodyType === 'raw') {
    return resolveVariables(body || '', globals, environment, localVariables, collectionVariables);
  }

  // Handle key-value body types (form-data, urlencoded)
  if (Array.isArray(body)) {
    const resolvedFields = [];
    body.forEach(item => {
      if (item.enabled !== false && item.key) {
        resolvedFields.push({
          key: resolveVariables(item.key, globals, environment, localVariables, collectionVariables),
          value: resolveVariables(item.value || '', globals, environment, localVariables, collectionVariables),
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

/**
 * Injects basic, bearer, or apikey credentials into request headers or url
 */
function injectAuthorization(auth, headers, url, globals, environment) {
  if (!auth || auth.type === 'none') return url;

  if (auth.type === 'bearer' && auth.bearerToken) {
    const token = resolveVariables(auth.bearerToken, globals, environment);
    headers['Authorization'] = `Bearer ${token}`;
  } 
  
  else if (auth.type === 'basic') {
    const username = resolveVariables(auth.username || '', globals, environment);
    const password = resolveVariables(auth.password || '', globals, environment);
    const hash = btoa(`${username}:${password}`);
    headers['Authorization'] = `Basic ${hash}`;
  } 
  else if (auth.type === 'oauth2') {
    if (!auth.oauthAccessToken) throw new Error('OAuth access token is missing. Get a token before starting the runner.');
    headers.Authorization = `Bearer ${auth.oauthAccessToken}`;
  }
  
  else if (auth.type === 'apikey' && auth.key) {
    const key = resolveVariables(auth.key, globals, environment);
    const value = resolveVariables(auth.value || '', globals, environment);
    
    if (auth.in === 'header') {
      headers[key] = value;
    } else {
      const urlObj = new URL(url);
      urlObj.searchParams.set(key, value);
      url = urlObj.toString();
    }
  }
  return url;
}

/**
 * Performs proxy request through Express server
 */
async function executeProxyRequest(proxyUrl, method, url, headers, body, bodyType) {
  // Set content-type automatically if missing and body exists
  const hasContentType = Object.keys(headers).some(key => key.toLowerCase() === 'content-type');
  if (bodyType === 'raw' && !hasContentType) {
    headers['content-type'] = 'application/json';
  } else if (bodyType === 'urlencoded' && !hasContentType) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }

  let finalBody = body;
  // Format urlencoded body list to a standard string
  if (bodyType === 'urlencoded' && Array.isArray(body)) {
    const params = new URLSearchParams();
    body.forEach(item => params.append(item.key, item.value));
    finalBody = params.toString();
  }

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url,
      method,
      headers,
      body: finalBody
    })
  });

  if (!response.ok) {
    throw new Error(`Proxy error: ${response.statusText}`);
  }

  return await response.json();
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
      if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'multipart/form-data';
      }
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

/**
 * Performs request directly from Web Worker browser environment
 */
async function executeDirectRequest(method, url, headers, body, bodyType) {
  let fetchOptions = {
    method: method,
    headers: new Headers(headers)
  };

  if (bodyType === 'raw' && body) {
    fetchOptions.body = body;
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
      fetchOptions.headers.set('Content-Type', 'application/json');
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
        // Base64 decoding file simulation
        const matches = item.fileData.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
          const fileBuffer = base64ToArrayBuffer(matches[2]);
          const blob = new Blob([fileBuffer], { type: matches[1] });
          formData.append(item.key, blob, item.fileName || 'file');
        }
      } else {
        formData.append(item.key, item.value || '');
      }
    });
    fetchOptions.body = formData;
    // Don't set Content-Type header; browser does it with boundaries automatically
    fetchOptions.headers.delete('Content-Type');
  }

  const start = Date.now();
  const response = await fetch(url, fetchOptions);
  const duration = Date.now() - start;

  // Convert response headers to simple object
  const responseHeaders = {};
  response.headers.forEach((val, key) => {
    responseHeaders[key] = val;
  });

  const responseText = await response.text();
  const size = responseText.length; // Approximate size in characters

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: responseText,
    time: duration,
    size: size
  };
}

/**
 * Decodes base64 string to ArrayBuffer for Blob construction
 */
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
