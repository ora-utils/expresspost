// Code snippet generation module
(function(globalScope) {
  function getActiveHeaders(headers) {
    if (!headers || !Array.isArray(headers)) return {};
    const h = {};
    headers.forEach(header => {
      if (header.enabled !== false && header.key && header.key.trim() !== '') {
        h[header.key.trim()] = header.value || '';
      }
    });
    return h;
  }

  function hasHeaderCI(headersObj, name) {
    const target = name.toLowerCase();
    return Object.keys(headersObj).some(k => k.toLowerCase() === target);
  }

  function escapeSingleQuoteShell(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "'\\''");
  }

  function escapeDoubleQuote(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
  }

  function applyAuthToSnippet(request, headersObj, url) {
    let finalUrl = url || '';
    const auth = request && request.auth;
    if (!auth || auth.type === 'none') return finalUrl;

    if (auth.type === 'bearer' && auth.bearerToken) {
      headersObj['Authorization'] = `Bearer ${auth.bearerToken}`;
    } else if (auth.type === 'oauth2') {
      const token = auth.oauthAccessToken || '<OAUTH_ACCESS_TOKEN>';
      headersObj['Authorization'] = `Bearer ${token}`;
    } else if (auth.type === 'apikey' && auth.key) {
      if (auth.in === 'query') {
        const sep = finalUrl.includes('?') ? '&' : '?';
        finalUrl = `${finalUrl}${sep}${encodeURIComponent(auth.key)}=${encodeURIComponent(auth.value || '')}`;
      } else {
        headersObj[auth.key] = auth.value || '';
      }
    }
    return finalUrl;
  }

  function encodeBasicToken(username, password) {
    const raw = `${username}:${password || ''}`;
    if (typeof btoa === 'function') return btoa(raw);
    if (typeof Buffer !== 'undefined') return Buffer.from(raw, 'utf8').toString('base64');
    return raw;
  }

  function generateCurl(request) {
    const method = (request && request.method) || 'GET';
    const headersObj = getActiveHeaders(request && request.headers);
    let url = applyAuthToSnippet(request, headersObj, (request && request.url) || '');

    if (request && request.auth && request.auth.type === 'basic' && request.auth.username) {
      headersObj['Authorization'] = 'Basic ' + encodeBasicToken(request.auth.username, request.auth.password);
    }

    if (!url) return `curl --request ${method} ''`;

    let curl = `curl --request ${method} \\\n  --url '${escapeSingleQuoteShell(url)}'`;

    for (const [key, value] of Object.entries(headersObj)) {
      curl += ` \\\n  --header '${escapeSingleQuoteShell(key)}: ${escapeSingleQuoteShell(value)}'`;
    }

    const formItems = (request && (request.formdata || request.formData)) || [];
    if (request && request.bodyType === 'raw' && request.body) {
      if (!hasHeaderCI(headersObj, 'Content-Type')) {
        curl += ` \\\n  --header 'Content-Type: ${escapeSingleQuoteShell(request.bodyRawType || 'application/json')}'`;
      }
      curl += ` \\\n  --data '${escapeSingleQuoteShell(request.body)}'`;
    } else if (request && request.bodyType === 'form-data' && Array.isArray(formItems)) {
      formItems.forEach(item => {
        if (item.enabled !== false && item.key) {
          if (item.type === 'file' && item.fileName) {
            curl += ` \\\n  --form '${escapeSingleQuoteShell(item.key)}=@"/path/to/${escapeSingleQuoteShell(item.fileName)}"'`;
          } else {
            curl += ` \\\n  --form '${escapeSingleQuoteShell(item.key)}=${escapeSingleQuoteShell(item.value || '')}'`;
          }
        }
      });
    } else if (request && request.bodyType === 'urlencoded' && Array.isArray(request.urlencoded)) {
      if (!hasHeaderCI(headersObj, 'Content-Type')) {
        curl += ` \\\n  --header 'Content-Type: application/x-www-form-urlencoded'`;
      }
      request.urlencoded.forEach(item => {
        if (item.enabled !== false && item.key) {
          curl += ` \\\n  --data-urlencode '${escapeSingleQuoteShell(item.key)}=${escapeSingleQuoteShell(item.value || '')}'`;
        }
      });
    }

    return curl;
  }

  function generatePython(request) {
    const method = (request && request.method) || 'GET';
    const headersObj = getActiveHeaders(request && request.headers);
    const url = applyAuthToSnippet(request, headersObj, (request && request.url) || '');

    let py = `import requests\n\nurl = "${escapeDoubleQuote(url)}"\n\n`;

    if (request && request.bodyType === 'raw' && request.body && !hasHeaderCI(headersObj, 'Content-Type')) {
      headersObj['Content-Type'] = request.bodyRawType || 'application/json';
    }

    if (Object.keys(headersObj).length > 0) {
      py += `headers = {\n`;
      for (const [key, value] of Object.entries(headersObj)) {
        py += `  "${escapeDoubleQuote(key)}": "${escapeDoubleQuote(value)}",\n`;
      }
      py += `}\n\n`;
    }

    let dataArg = '';
    const formItems = (request && (request.formdata || request.formData)) || [];
    if (request && request.bodyType === 'raw' && request.body) {
      py += `payload = "${escapeDoubleQuote(request.body)}"\n\n`;
      dataArg = 'data=payload';
    } else if (request && request.bodyType === 'urlencoded' && Array.isArray(request.urlencoded)) {
      py += `payload = {\n`;
      request.urlencoded.forEach(item => {
        if (item.enabled !== false && item.key) {
          py += `  "${escapeDoubleQuote(item.key)}": "${escapeDoubleQuote(item.value || '')}",\n`;
        }
      });
      py += `}\n\n`;
      dataArg = 'data=payload';
    } else if (request && request.bodyType === 'form-data' && Array.isArray(formItems)) {
      py += `payload = {}\nfiles = []\n`;
      formItems.forEach(item => {
        if (item.enabled !== false && item.key) {
          if (item.type === 'file' && item.fileName) {
            py += `files.append(("${escapeDoubleQuote(item.key)}", open("/path/to/${escapeDoubleQuote(item.fileName)}", "rb")))\n`;
          } else {
            py += `payload["${escapeDoubleQuote(item.key)}"] = "${escapeDoubleQuote(item.value || '')}"\n`;
          }
        }
      });
      py += `\n`;
      dataArg = 'data=payload, files=files';
    }

    let reqLine = `response = requests.request("${escapeDoubleQuote(method)}", url`;
    if (Object.keys(headersObj).length > 0) reqLine += `, headers=headers`;
    if (dataArg) reqLine += `, ${dataArg}`;
    if (request && request.auth && request.auth.type === 'basic' && request.auth.username) {
      reqLine += `, auth=("${escapeDoubleQuote(request.auth.username)}", "${escapeDoubleQuote(request.auth.password || '')}")`;
    }
    reqLine += `)\n\nprint(response.text)`;
    return py + reqLine;
  }

  function generateNode(request) {
    const method = (request && request.method) || 'GET';
    const headersObj = getActiveHeaders(request && request.headers);
    const url = applyAuthToSnippet(request, headersObj, (request && request.url) || '');

    let js = `const axios = require('axios');\n`;
    if (request && request.bodyType === 'form-data') {
      js += `const FormData = require('form-data');\nconst fs = require('fs');\n`;
    }
    if (request && request.bodyType === 'urlencoded') {
      js += `const qs = require('qs');\n`;
    }

    let dataSetup = '';
    let hasData = false;
    const formItems = (request && (request.formdata || request.formData)) || [];

    if (request && request.bodyType === 'raw' && request.body) {
      let emitted = false;
      if ((request.bodyRawType || 'application/json').includes('json')) {
        try {
          const parsed = JSON.parse(request.body);
          dataSetup = `let data = JSON.stringify(${JSON.stringify(parsed, null, 2)});\n\n`;
          emitted = true;
        } catch (e) {
          // Contains template variables or invalid JSON, emit as safe string literal
        }
      }
      if (!emitted) {
        dataSetup = `let data = ${JSON.stringify(request.body)};\n\n`;
      }
      hasData = true;
      if (!hasHeaderCI(headersObj, 'Content-Type')) {
        headersObj['Content-Type'] = request.bodyRawType || 'application/json';
      }
    } else if (request && request.bodyType === 'urlencoded' && Array.isArray(request.urlencoded)) {
      dataSetup = `let data = qs.stringify({\n`;
      request.urlencoded.forEach(item => {
        if (item.enabled !== false && item.key) {
          dataSetup += `  ${JSON.stringify(item.key)}: ${JSON.stringify(item.value || '')},\n`;
        }
      });
      dataSetup += `});\n\n`;
      hasData = true;
      if (!hasHeaderCI(headersObj, 'Content-Type')) {
        headersObj['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    } else if (request && request.bodyType === 'form-data' && Array.isArray(formItems)) {
      dataSetup = `let data = new FormData();\n`;
      formItems.forEach(item => {
        if (item.enabled !== false && item.key) {
          if (item.type === 'file' && item.fileName) {
            dataSetup += `data.append(${JSON.stringify(item.key)}, fs.createReadStream('/path/to/${escapeSingleQuoteShell(item.fileName)}'));\n`;
          } else {
            dataSetup += `data.append(${JSON.stringify(item.key)}, ${JSON.stringify(item.value || '')});\n`;
          }
        }
      });
      dataSetup += `\n`;
      hasData = true;
    }

    js += `\n${dataSetup}let config = {\n  method: ${JSON.stringify(method.toLowerCase())},\n  maxBodyLength: Infinity,\n  url: ${JSON.stringify(url)},\n`;
    if (hasData) {
      js += `  data: data,\n`;
    }

    if (Object.keys(headersObj).length > 0 || (request && request.bodyType === 'form-data')) {
      js += `  headers: {\n`;
      for (const [key, value] of Object.entries(headersObj)) {
        js += `    ${JSON.stringify(key)}: ${JSON.stringify(value)},\n`;
      }
      if (request && request.bodyType === 'form-data') js += `    ...data.getHeaders()\n`;
      js += `  },\n`;
    }

    if (request && request.auth && request.auth.type === 'basic' && request.auth.username) {
      js += `  auth: {\n    username: ${JSON.stringify(request.auth.username)},\n    password: ${JSON.stringify(request.auth.password || '')}\n  },\n`;
    }

    js += `};\n\n`;
    js += `axios.request(config)\n  .then((response) => {\n    console.log(JSON.stringify(response.data));\n  })\n  .catch((error) => {\n    console.log(error);\n  });\n`;
    return js;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateCurl, generatePython, generateNode };
  }
  if (typeof window !== 'undefined') {
    window.generateCurl = generateCurl;
    window.generatePython = generatePython;
    window.generateNode = generateNode;
  }
})(typeof window !== 'undefined' ? window : globalThis);
