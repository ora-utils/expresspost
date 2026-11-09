/**
 * ExpressPost request-script runtime.
 * Exposes a Postman-style pm API for pre-request and post-response scripts.
 */

async function runScriptSandbox(scriptText, context = {}) {
  context.globals = context.globals || {};
  context.environment = context.environment || {};
  context.collectionVariables = context.collectionVariables || {};
  context.localVariables = context.localVariables || {};
  context.request = context.request || { url: '', method: 'GET', headers: {}, body: '' };

  const testResults = [];
  const logs = [];
  const pendingTests = [];
  const timestamp = () => new Date().toLocaleTimeString();
  const stringify = value => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  };
  const log = (type, args) => logs.push({
    type,
    message: args.map(stringify).join(' '),
    time: timestamp()
  });
  const mockConsole = {
    log: (...args) => log('info', args),
    info: (...args) => log('info', args),
    warn: (...args) => log('warn', args),
    error: (...args) => log('error', args)
  };

  const makeStore = (store, fallbackStores = []) => ({
    get: key => {
      if (key in store) return store[key];
      for (const fallback of fallbackStores) {
        if (key in fallback) return fallback[key];
      }
      return undefined;
    },
    set: (key, value) => { store[key] = String(value); },
    unset: key => { delete store[key]; },
    has: key => key in store || fallbackStores.some(fallback => key in fallback),
    clear: () => Object.keys(store).forEach(key => delete store[key]),
    toObject: () => Object.assign({}, ...fallbackStores.slice().reverse(), store)
  });

  const globals = makeStore(context.globals);
  const environment = makeStore(context.environment);
  const collectionVariables = makeStore(context.collectionVariables);
  const iterationData = makeStore(context.iterationData || {});
  const variables = makeStore(context.localVariables, [
    context.environment,
    context.collectionVariables,
    context.globals
  ]);
  variables.replaceIn = text => {
    if (typeof text !== 'string') return text;
    return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const value = variables.get(key.trim());
      return value === undefined ? match : value;
    });
  };

  const request = context.request;
  request.headers = request.headers || {};
  const requestHeaders = {
    get: key => {
      const found = Object.keys(request.headers).find(header => header.toLowerCase() === String(key).toLowerCase());
      return found === undefined ? undefined : request.headers[found];
    },
    has: key => Object.keys(request.headers).some(header => header.toLowerCase() === String(key).toLowerCase()),
    set: (key, value) => {
      const oldKey = Object.keys(request.headers).find(header => header.toLowerCase() === String(key).toLowerCase());
      request.headers[oldKey || key] = String(value);
    },
    add: header => {
      if (header && header.key) requestHeaders.set(header.key, header.value || '');
    },
    remove: key => {
      const found = Object.keys(request.headers).find(header => header.toLowerCase() === String(key).toLowerCase());
      if (found !== undefined) delete request.headers[found];
    },
    toObject: () => ({ ...request.headers }),
    all: () => Object.entries(request.headers).map(([key, value]) => ({ key, value }))
  };
  const pmRequest = {
    headers: requestHeaders,
    body: {
      get: () => request.body,
      update: value => {
        request.body = value;
        if (request.bodyType === 'none') request.bodyType = 'raw';
      }
    }
  };
  Object.defineProperties(pmRequest, {
    url: {
      enumerable: true,
      get: () => request.url,
      set: value => { request.url = String(value); }
    },
    method: {
      enumerable: true,
      get: () => request.method,
      set: value => { request.method = String(value).toUpperCase(); }
    }
  });

  const expect = (actual, negate = false) => {
    const check = (condition, message) => {
      if (negate ? condition : !condition) throw new Error(negate ? `expected ${message} not to match` : `expected ${message}`);
    };
    const chain = {
      equal: expected => check(actual === expected, `${stringify(actual)} to equal ${stringify(expected)}`),
      eql: expected => check(JSON.stringify(actual) === JSON.stringify(expected), `${stringify(actual)} to deeply equal ${stringify(expected)}`),
      include: expected => {
        const includes = typeof actual === 'string' || Array.isArray(actual)
          ? actual.includes(expected)
          : actual !== null && typeof actual === 'object' && expected in actual;
        check(includes, `${stringify(actual)} to include ${stringify(expected)}`);
      },
      a: type => check(typeof actual === type || (type === 'array' && Array.isArray(actual)), `${stringify(actual)} to be a ${type}`),
      an: type => check(typeof actual === type || (type === 'array' && Array.isArray(actual)), `${stringify(actual)} to be an ${type}`),
      ok: () => check(Boolean(actual), `${stringify(actual)} to be truthy`),
      above: value => check(actual > value, `${stringify(actual)} to be above ${value}`),
      below: value => check(actual < value, `${stringify(actual)} to be below ${value}`),
      least: value => check(actual >= value, `${stringify(actual)} to be at least ${value}`),
      most: value => check(actual <= value, `${stringify(actual)} to be at most ${value}`),
      within: (min, max) => check(actual >= min && actual <= max, `${stringify(actual)} to be between ${min} and ${max}`),
      lengthOf: length => check(actual != null && actual.length === length, `${stringify(actual)} to have length ${length}`),
      length: length => check(actual != null && actual.length === length, `${stringify(actual)} to have length ${length}`),
      match: regex => {
        const matcher = regex instanceof RegExp ? regex : new RegExp(regex);
        check(matcher.test(String(actual)), `${stringify(actual)} to match ${matcher}`);
      },
      property: function (key, expected) {
        const hasProperty = actual != null && key in Object(actual);
        check(hasProperty, `${stringify(actual)} to have property "${key}"`);
        const value = actual == null ? undefined : actual[key];
        if (arguments.length > 1) check(value === expected, `property "${key}" to equal ${stringify(expected)}`);
        return expect(value, negate);
      }
    };
    Object.defineProperties(chain, {
      to: { get: () => chain },
      be: { get: () => chain },
      have: { get: () => chain },
      and: { get: () => chain },
      not: { get: () => expect(actual, !negate) },
      true: { get: () => { check(actual === true, `${stringify(actual)} to be true`); return true; } },
      false: { get: () => { check(actual === false, `${stringify(actual)} to be false`); return true; } },
      empty: { get: () => {
        const empty = actual == null || actual.length === 0 || (typeof actual === 'object' && Object.keys(actual).length === 0);
        check(empty, `${stringify(actual)} to be empty`);
        return true;
      } }
    });
    return chain;
  };

  const response = context.response;
  const pendingRequests = [];
  const sendRequest = (options, callback) => {
    if (typeof context.sendRequest !== 'function') {
      throw new Error('pm.sendRequest is unavailable in this execution context.');
    }

    const request = typeof options === 'string' ? { url: options } : { ...options };
    const requestPromise = Promise.resolve().then(() => context.sendRequest(request));
    const resultPromise = requestPromise.then(result => {
      const headers = result.headers || {};
      const responseHeaders = {
        get: name => {
          const key = Object.keys(headers).find(header => header.toLowerCase() === String(name).toLowerCase());
          return key === undefined ? undefined : headers[key];
        },
        has: name => Object.keys(headers).some(header => header.toLowerCase() === String(name).toLowerCase()),
        toObject: () => ({ ...headers })
      };
      const responseBody = result.body || '';
      const scriptResponse = {
        ...result,
        code: result.status,
        headers: responseHeaders,
        text: () => responseBody,
        json: () => {
          try {
            return JSON.parse(responseBody || '{}');
          } catch (error) {
            throw new Error(`Response is not valid JSON: ${error.message}`);
          }
        }
      };

      if (typeof callback === 'function') {
        return Promise.resolve(callback(null, scriptResponse)).then(() => scriptResponse);
      }
      return scriptResponse;
    }, error => {
      if (typeof callback === 'function') {
        return Promise.resolve(callback(error)).then(() => undefined);
      }
      throw error;
    });

    pendingRequests.push(resultPromise);
    return resultPromise;
  };
  let pmResponse = null;
  if (response) {
    const responseHeaders = response.headers || {};
    const findHeader = name => Object.keys(responseHeaders).find(key => key.toLowerCase() === String(name).toLowerCase());
    const responseHeaderApi = {
      get: name => {
        const key = findHeader(name);
        return key === undefined ? undefined : responseHeaders[key];
      },
      has: name => findHeader(name) !== undefined,
      toObject: () => ({ ...responseHeaders })
    };
    pmResponse = {
      code: response.status,
      status: response.statusText || '',
      body: response.body || '',
      headers: responseHeaderApi,
      responseTime: response.time || 0,
      size: response.size || 0,
      text: () => response.body || '',
      json: () => {
        try {
          return JSON.parse(response.body || '{}');
        } catch (error) {
          throw new Error(`Response is not valid JSON: ${error.message}`);
        }
      },
      to: {
        have: {
          status: expected => {
            if (response.status !== expected) throw new Error(`expected status code ${expected} but got ${response.status}`);
          },
          header: (name, expectedValue) => {
            const value = responseHeaderApi.get(name);
            if (value === undefined) throw new Error(`expected header "${name}" to exist`);
            if (expectedValue !== undefined && value !== expectedValue) {
              throw new Error(`expected header "${name}" to equal "${expectedValue}" but got "${value}"`);
            }
          }
        },
        be: {
          success: () => {
            if (response.status < 200 || response.status >= 300) throw new Error(`expected successful (2xx) status code but got ${response.status}`);
          },
          clientError: () => {
            if (response.status < 400 || response.status >= 500) throw new Error(`expected client error (4xx) status code but got ${response.status}`);
          },
          serverError: () => {
            if (response.status < 500 || response.status >= 600) throw new Error(`expected server error (5xx) status code but got ${response.status}`);
          }
        }
      }
    };
  }

  const pm = {
    globals,
    environment,
    collectionVariables,
    iterationData,
    variables,
    request: pmRequest,
    response: pmResponse,
    sendRequest,
    info: context.info || {},
    testResults,
    test: (name, assertFn) => {
      try {
        const result = assertFn();
        if (result && typeof result.then === 'function') {
          pendingTests.push(Promise.resolve(result).then(
            () => testResults.push({ name, passed: true }),
            error => testResults.push({ name, passed: false, error: error.message })
          ));
        } else {
          testResults.push({ name, passed: true });
        }
      } catch (error) {
        testResults.push({ name, passed: false, error: error.message });
      }
    },
    expect: value => expect(value)
  };

  try {
    if (scriptText && scriptText.trim()) {
      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
      const runFn = new AsyncFunction('pm', 'console', scriptText);
      await runFn(pm, mockConsole);
    }
    while (pendingRequests.length > 0 || pendingTests.length > 0) {
      await Promise.all([...pendingRequests.splice(0), ...pendingTests.splice(0)]);
    }
  } catch (error) {
    logs.push({
      type: 'error',
      message: `Script Error: ${error.message}\nStack: ${error.stack || ''}`,
      time: timestamp()
    });
    testResults.push({ name: 'Script execution status', passed: false, error: error.message });
  }

  return {
    globals: context.globals,
    environment: context.environment,
    collectionVariables: context.collectionVariables,
    localVariables: context.localVariables,
    request,
    testResults,
    logs
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runScriptSandbox };
} else if (typeof self !== 'undefined') {
  self.runScriptSandbox = runScriptSandbox;
}
