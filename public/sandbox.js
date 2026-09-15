/**
 * ExpressPost Script Sandbox
 * Provides sandboxed execution of Pre-request and Test scripts
 * exposing a Postman-compatible `pm` global object.
 */

function runScriptSandbox(scriptText, context = {}) {
  // Ensure we have fallback structures
  context.globals = context.globals || {};
  context.environment = context.environment || {};
  context.request = context.request || { url: '', method: 'GET', headers: {}, body: '' };
  
  const testResults = [];
  const logs = [];

  // Mock console log capture
  const mockConsole = {
    log: (...args) => {
      logs.push({
        type: 'info',
        message: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' '),
        time: new Date().toLocaleTimeString()
      });
    },
    info: (...args) => {
      logs.push({
        type: 'info',
        message: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' '),
        time: new Date().toLocaleTimeString()
      });
    },
    warn: (...args) => {
      logs.push({
        type: 'warn',
        message: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' '),
        time: new Date().toLocaleTimeString()
      });
    },
    error: (...args) => {
      logs.push({
        type: 'error',
        message: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' '),
        time: new Date().toLocaleTimeString()
      });
    }
  };

  // Build the pm object
  const pm = {
    globals: {
      get: (key) => context.globals[key],
      set: (key, val) => { context.globals[key] = String(val); },
      unset: (key) => { delete context.globals[key]; },
      has: (key) => key in context.globals,
      clear: () => { 
        Object.keys(context.globals).forEach(k => delete context.globals[k]);
      }
    },
    environment: {
      get: (key) => context.environment[key],
      set: (key, val) => { context.environment[key] = String(val); },
      unset: (key) => { delete context.environment[key]; },
      has: (key) => key in context.environment,
      clear: () => {
        Object.keys(context.environment).forEach(k => delete context.environment[k]);
      }
    },
    variables: {
      get: (key) => {
        if (key in context.environment) return context.environment[key];
        if (key in context.globals) return context.globals[key];
        return undefined;
      }
    },
    request: {
      url: context.request.url,
      method: context.request.method,
      headers: context.request.headers || {},
      body: context.request.body || ''
    },
    response: null,
    testResults: testResults,
    test: (name, assertFn) => {
      try {
        assertFn();
        testResults.push({ name, passed: true });
      } catch (error) {
        testResults.push({ name, passed: false, error: error.message });
      }
    },
    expect: (val) => {
      return {
        to: {
          be: {
            a: (type) => {
              if (typeof val !== type) {
                throw new Error(`expected type to be "${type}" but got "${typeof val}"`);
              }
            },
            ok: () => {
              if (!val) throw new Error(`expected value to be truthy, but got ${JSON.stringify(val)}`);
            },
            empty: () => {
              if (val && (val.length > 0 || Object.keys(val).length > 0)) {
                throw new Error(`expected value to be empty, but got ${JSON.stringify(val)}`);
              }
            }
          },
          eql: (expected) => {
            if (JSON.stringify(val) !== JSON.stringify(expected)) {
              throw new Error(`expected ${JSON.stringify(val)} to equal ${JSON.stringify(expected)}`);
            }
          },
          include: (needle) => {
            if (typeof val === 'string' || Array.isArray(val)) {
              if (!val.includes(needle)) {
                throw new Error(`expected ${JSON.stringify(val)} to include ${JSON.stringify(needle)}`);
              }
            } else if (val && typeof val === 'object') {
              if (!(needle in val)) {
                throw new Error(`expected keys in ${JSON.stringify(val)} to include "${needle}"`);
              }
            } else {
              throw new Error(`cannot run include assertion on type: ${typeof val}`);
            }
          },
          have: {
            property: (prop) => {
              if (!val || typeof val !== 'object' || !(prop in val)) {
                throw new Error(`expected object to have property "${prop}"`);
              }
            },
            length: (len) => {
              if (!val || val.length === undefined || val.length !== len) {
                throw new Error(`expected length ${len} but got ${val ? val.length : 'undefined'}`);
              }
            }
          }
        }
      };
    }
  };

  // Add response variables if response context exists
  if (context.response) {
    const rawHeaders = context.response.headers || {};
    
    // Normalise headers key access to be case-insensitive
    const normalizedHeaders = {};
    Object.keys(rawHeaders).forEach(k => {
      normalizedHeaders[k.toLowerCase()] = rawHeaders[k];
    });

    pm.response = {
      code: context.response.status,
      status: context.response.statusText || '',
      headers: {
        get: (headerName) => normalizedHeaders[headerName.toLowerCase()]
      },
      responseTime: context.response.time || 0,
      size: context.response.size || 0,
      text: () => context.response.body || '',
      json: () => {
        try {
          return JSON.parse(context.response.body || '{}');
        } catch (e) {
          throw new Error('Response is not valid JSON: ' + e.message);
        }
      },
      to: {
        have: {
          status: (expectedStatus) => {
            if (context.response.status !== expectedStatus) {
              throw new Error(`expected status code ${expectedStatus} but got ${context.response.status}`);
            }
          },
          header: (headerName, expectedValue) => {
            const actualVal = normalizedHeaders[headerName.toLowerCase()];
            if (actualVal === undefined) {
              throw new Error(`expected header "${headerName}" to exist`);
            }
            if (expectedValue !== undefined && actualVal !== expectedValue) {
              throw new Error(`expected header "${headerName}" to equal "${expectedValue}" but got "${actualVal}"`);
            }
          }
        },
        be: {
          success: () => {
            if (context.response.status < 200 || context.response.status >= 300) {
              throw new Error(`expected successful (2xx) status code but got ${context.response.status}`);
            }
          },
          clientError: () => {
            if (context.response.status < 400 || context.response.status >= 500) {
              throw new Error(`expected client error (4xx) status code but got ${context.response.status}`);
            }
          },
          serverError: () => {
            if (context.response.status < 500 || context.response.status >= 600) {
              throw new Error(`expected server error (5xx) status code but got ${context.response.status}`);
            }
          }
        }
      }
    };
  }

  // Execute the script within a function wrapper to isolate scope
  try {
    if (scriptText && scriptText.trim() !== '') {
      // Create executable function with pm and console injected
      const runFn = new Function('pm', 'console', scriptText);
      runFn(pm, mockConsole);
    }
  } catch (error) {
    logs.push({
      type: 'error',
      message: `Script Error: ${error.message}\nStack: ${error.stack || ''}`,
      time: new Date().toLocaleTimeString()
    });
    testResults.push({
      name: 'Script execution status',
      passed: false,
      error: error.message
    });
  }

  return {
    globals: context.globals,
    environment: context.environment,
    testResults: testResults,
    logs: logs
  };
}

// Support browser script loading, worker loading, and Node exports
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runScriptSandbox };
} else if (typeof self !== 'undefined') {
  self.runScriptSandbox = runScriptSandbox;
}
