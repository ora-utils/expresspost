/**
 * AeroPost Collection Runner Worker
 * Executes requests, evaluates pre-request/test scripts in a background thread,
 * and communicates results back to the main runner thread.
 */

// Import the sandbox library
importScripts('sandbox.js');

// Listen for execution commands from the main thread
self.onmessage = async function(e) {
  const { action, request, globals, environment, proxyUrl, engine } = e.data;

  if (action === 'run_request') {
    try {
      const result = await executeRequestInWorker(request, globals, environment, proxyUrl, engine);
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
async function executeRequestInWorker(req, globals, environment, proxyUrl, engine) {
  let requestGlobals = { ...globals };
  let requestEnv = { ...environment };

  // 1. Run Pre-request Script
  let preRequestLogs = [];
  if (req.preRequestScript && req.preRequestScript.trim() !== '') {
    const preSandboxResult = runScriptSandbox(req.preRequestScript, {
      globals: requestGlobals,
      environment: requestEnv,
      request: {
        url: req.url,
        method: req.method,
        headers: getHeadersObject(req.headers),
        body: req.body
      }
    });
    
    // Capture mutations
    requestGlobals = preSandboxResult.globals;
    requestEnv = preSandboxResult.environment;
    preRequestLogs = preSandboxResult.logs;
  }

  // 2. Resolve Variables
  const resolvedUrl = resolveVariables(req.url, requestGlobals, requestEnv);
  const resolvedHeaders = resolveHeaders(req.headers, requestGlobals, requestEnv);
  const resolvedBody = resolveRequestBody(req.body, req.bodyType, requestGlobals, requestEnv);

  // 3. Inject Authorization
  injectAuthorization(req.auth, resolvedHeaders, resolvedUrl, requestGlobals, requestEnv);

  // 4. Send HTTP Request (Direct or Proxy Mode)
  let responseData = null;
  const start = Date.now();

  try {
    if (engine === 'proxy') {
      responseData = await executeProxyRequest(proxyUrl, req.method, resolvedUrl, resolvedHeaders, resolvedBody, req.bodyType);
    } else {
      responseData = await executeDirectRequest(req.method, resolvedUrl, resolvedHeaders, resolvedBody, req.bodyType);
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
  let testResults = [];
  if (req.testsScript && req.testsScript.trim() !== '') {
    const testSandboxResult = runScriptSandbox(req.testsScript, {
      globals: requestGlobals,
      environment: requestEnv,
      request: {
        url: resolvedUrl,
        method: req.method,
        headers: resolvedHeaders,
        body: typeof resolvedBody === 'string' ? resolvedBody : JSON.stringify(resolvedBody)
      },
      response: responseData
    });

    // Capture mutations & outputs
    requestGlobals = testSandboxResult.globals;
    requestEnv = testSandboxResult.environment;
    testLogs = testSandboxResult.logs;
    testResults = testSandboxResult.testResults;
  }

  return {
    requestId: req.id,
    requestName: req.name,
    method: req.method,
    url: resolvedUrl,
    requestBody: typeof resolvedBody === 'string' ? resolvedBody : JSON.stringify(resolvedBody),
    globals: requestGlobals,
    environment: requestEnv,
    logs: [...preRequestLogs, ...testLogs],
    testResults: testResults,
    response: responseData
  };
}

/**
 * Replaces double curly brace variables {{my_var}} in strings
 */
function resolveVariables(str, globals, environment) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (trimmedKey in environment) return environment[trimmedKey];
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
function resolveHeaders(headersArray, globals, environment) {
  const headers = {};
  if (Array.isArray(headersArray)) {
    headersArray.forEach(h => {
      if (h.enabled !== false && h.key) {
        const resolvedKey = resolveVariables(h.key, globals, environment);
        const resolvedVal = resolveVariables(h.value || '', globals, environment);
        headers[resolvedKey] = resolvedVal;
      }
    });
  }
  return headers;
}

/**
 * Resolves body parameters and structures form data or urlencoded inputs
 */
function resolveRequestBody(body, bodyType, globals, environment) {
  if (bodyType === 'none') return null;

  if (bodyType === 'raw') {
    return resolveVariables(body || '', globals, environment);
  }

  // Handle key-value body types (form-data, urlencoded)
  if (Array.isArray(body)) {
    const resolvedFields = [];
    body.forEach(item => {
      if (item.enabled !== false && item.key) {
        resolvedFields.push({
          key: resolveVariables(item.key, globals, environment),
          value: resolveVariables(item.value || '', globals, environment),
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
  if (!auth || auth.type === 'none') return;

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
  
  else if (auth.type === 'apikey' && auth.key) {
    const key = resolveVariables(auth.key, globals, environment);
    const value = resolveVariables(auth.value || '', globals, environment);
    
    if (auth.in === 'header') {
      headers[key] = value;
    } else {
      // Query parameters injection
      // Since it's a worker, we manipulate the URL string
      const urlObj = new URL(url);
      urlObj.searchParams.set(key, value);
      // We modify URL inside this function by reference if possible? 
      // JavaScript strings are immutable, so we'll need to mutate it manually.
      // But standard approach: since URL object cannot be mutated from outer scope easily,
      // we can do:
    }
  }
}

/**
 * Performs proxy request through Express server
 */
async function executeProxyRequest(proxyUrl, method, url, headers, body, bodyType) {
  // Set content-type automatically if missing and body exists
  if (bodyType === 'raw' && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  } else if (bodyType === 'urlencoded' && !headers['content-type']) {
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
    if (!headers['content-type']) {
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
