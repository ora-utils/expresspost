/**
 * ExpressPost Shared Utilities
 * Pure helpers used across main workspace, Web Workers, and Node tests.
 */
(function(globalScope) {
  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeDecodeURIComponent(str) {
    if (typeof str !== 'string') return '';
    try {
      return decodeURIComponent(str.replace(/\+/g, ' '));
    } catch (e) {
      return str;
    }
  }

  function getByteLength(str) {
    if (!str) return 0;
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(String(str)).length;
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.byteLength(String(str), 'utf8');
    }
    return String(str).length;
  }

  function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size > 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    if (size > 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${size} B`;
  }

  /**
   * Resolves {{variable}} placeholders using Postman scope precedence:
   * local > iterationData > environment > collectionVariables > globals
   */
  function resolveVariables(str, scopes = {}) {
    if (typeof str !== 'string') return str;
    const {
      globals = {},
      collectionVariables = {},
      environment = {},
      iterationData = {},
      localVariables = {}
    } = scopes;

    return str.replace(/\{\{([^}]+)\}\}/g, (match, rawKey) => {
      const key = rawKey.trim();
      if (Object.prototype.hasOwnProperty.call(localVariables, key)) return String(localVariables[key]);
      if (Object.prototype.hasOwnProperty.call(iterationData, key)) return String(iterationData[key]);
      if (Object.prototype.hasOwnProperty.call(environment, key)) return String(environment[key]);
      if (Object.prototype.hasOwnProperty.call(collectionVariables, key)) return String(collectionVariables[key]);
      if (Object.prototype.hasOwnProperty.call(globals, key)) return String(globals[key]);
      return match;
    });
  }

  /**
   * Deep equality check that ignores object key ordering and handles NaN/null/arrays.
   */
  function deepEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
      return false;
    }
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }
    if (a instanceof RegExp && b instanceof RegExp) {
      return a.source === b.source && a.flags === b.flags;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  /**
   * Parses query parameters from a URL string safely (preserving '=' in values and malformed '%').
   */
  function parseUrlParams(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return [];
    const hashIndex = urlStr.indexOf('#');
    const cleanUrl = hashIndex !== -1 ? urlStr.slice(0, hashIndex) : urlStr;
    const queryIndex = cleanUrl.indexOf('?');
    if (queryIndex === -1) return [];

    const queryString = cleanUrl.slice(queryIndex + 1);
    if (!queryString) return [];

    const params = [];
    const pairs = queryString.split('&');
    for (const pair of pairs) {
      if (!pair) continue;
      const eqIndex = pair.indexOf('=');
      const rawKey = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
      const rawVal = eqIndex === -1 ? '' : pair.slice(eqIndex + 1);
      params.push({
        key: safeDecodeURIComponent(rawKey),
        value: safeDecodeURIComponent(rawVal),
        enabled: true,
        description: ''
      });
    }
    return params;
  }

  /**
   * Encodes a query param key or value while keeping {{variable}} placeholders readable and intact.
   */
  function encodeParamPartPreservingVars(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .split(/(\{\{[^}]+\}\})/g)
      .map(segment => (/^\{\{[^}]+\}\}$/.test(segment) ? segment : encodeURIComponent(segment)))
      .join('');
  }

  /**
   * Rebuilds URL from enabled query params while preserving base URL, hash fragment, and {{variables}}.
   */
  function rebuildUrlFromParams(currentUrl, paramsList) {
    const raw = typeof currentUrl === 'string' ? currentUrl : '';
    const hashIndex = raw.indexOf('#');
    const hash = hashIndex !== -1 ? raw.slice(hashIndex) : '';
    const withoutHash = hashIndex !== -1 ? raw.slice(0, hashIndex) : raw;
    const queryIndex = withoutHash.indexOf('?');
    const urlBase = queryIndex !== -1 ? withoutHash.slice(0, queryIndex) : withoutHash;

    const queryParts = [];
    (paramsList || []).forEach(p => {
      if (p.enabled !== false && p.key) {
        const keyPart = encodeParamPartPreservingVars(p.key);
        const valPart = encodeParamPartPreservingVars(p.value || '');
        queryParts.push(p.value !== undefined && p.value !== '' ? `${keyPart}=${valPart}` : `${keyPart}=`);
      }
    });

    const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return `${urlBase}${query}${hash}`;
  }

  /**
   * RFC-4180 compliant CSV parser supporting UTF-8 BOM, quoted fields, embedded commas/newlines, and "" escapes.
   */
  function parseCSV(text) {
    if (typeof text !== 'string') throw new Error('CSV content must be text');
    const clean = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      const next = clean[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(field.trim());
          field = '';
        } else if (ch === '\r' && next === '\n') {
          row.push(field.trim());
          if (row.some(cell => cell !== '')) rows.push(row);
          row = [];
          field = '';
          i++;
        } else if (ch === '\n' || ch === '\r') {
          row.push(field.trim());
          if (row.some(cell => cell !== '')) rows.push(row);
          row = [];
          field = '';
        } else {
          field += ch;
        }
      }
    }

    if (field !== '' || row.length > 0) {
      row.push(field.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
    }

    if (rows.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }

    const headers = rows[0];
    return rows.slice(1).map(values => {
      const obj = {};
      headers.forEach((h, idx) => {
        if (h) obj[h] = values[idx] !== undefined ? values[idx] : '';
      });
      return obj;
    });
  }

  /**
   * Tokenizes a shell command string (handles \, ^ continuations, single/double/$'' quotes).
   */
  function tokenizeShellCommand(command) {
    const normalized = String(command || '')
      .replace(/\\\r?\n/g, ' ')
      .replace(/\^\r?\n/g, ' ')
      .trim();

    const tokens = [];
    let current = '';
    let quote = null;
    let hasToken = false;

    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];

      if (quote === "'") {
        if (ch === "'") {
          quote = null;
        } else {
          current += ch;
        }
        hasToken = true;
        continue;
      }

      if (quote === '"') {
        if (ch === '\\' && i + 1 < normalized.length && ['"', '\\', '$', '`', 'n', 'r', 't'].includes(normalized[i + 1])) {
          const next = normalized[++i];
          if (next === 'n') current += '\n';
          else if (next === 'r') current += '\r';
          else if (next === 't') current += '\t';
          else current += next;
        } else if (ch === '"') {
          quote = null;
        } else {
          current += ch;
        }
        hasToken = true;
        continue;
      }

      // Unquoted context
      if (ch === '$' && normalized[i + 1] === "'") {
        // ANSI-C quoting $'...'
        i += 2;
        hasToken = true;
        while (i < normalized.length && normalized[i] !== "'") {
          if (normalized[i] === '\\' && i + 1 < normalized.length) {
            const esc = normalized[++i];
            if (esc === 'n') current += '\n';
            else if (esc === 'r') current += '\r';
            else if (esc === 't') current += '\t';
            else current += esc;
          } else {
            current += normalized[i];
          }
          i++;
        }
        continue;
      }

      if (ch === "'" || ch === '"') {
        quote = ch;
        hasToken = true;
      } else if (ch === '\\' && i + 1 < normalized.length) {
        current += normalized[++i];
        hasToken = true;
      } else if (/\s/.test(ch)) {
        if (hasToken) {
          tokens.push(current);
          current = '';
          hasToken = false;
        }
      } else {
        current += ch;
        hasToken = true;
      }
    }

    if (hasToken) tokens.push(current);
    return tokens;
  }

  /**
   * Parses a cURL command into an ExpressPost request structure.
   */
  function parseCurlCommand(curlStr) {
    const tokens = tokenizeShellCommand(curlStr);
    if (tokens.length === 0) {
      throw new Error('Please paste a valid cURL command.');
    }

    let idx = 0;
    if (tokens[0].toLowerCase() === 'curl') {
      idx = 1;
    }

    let method = null;
    let url = '';
    const headers = [];
    const dataParts = [];
    const urlencodedParts = [];
    const formParts = [];
    let auth = { type: 'none' };
    let isGetFlag = false;

    const takeValue = (flag, inlineVal) => {
      if (inlineVal !== undefined) return inlineVal;
      if (idx + 1 < tokens.length) return tokens[++idx];
      throw new Error(`Missing value for flag ${flag}`);
    };

    for (; idx < tokens.length; idx++) {
      const token = tokens[idx];

      if (token === '-X' || token === '--request') {
        method = takeValue(token).toUpperCase();
      } else if (token.startsWith('-X') && token.length > 2) {
        method = token.slice(2).toUpperCase();
      } else if (token === '--url') {
        url = takeValue(token);
      } else if (token.startsWith('--url=')) {
        url = token.slice(6);
      } else if (token === '-H' || token === '--header') {
        const headerLine = takeValue(token);
        const colonIdx = headerLine.indexOf(':');
        if (colonIdx !== -1) {
          const key = headerLine.slice(0, colonIdx).trim();
          const value = headerLine.slice(colonIdx + 1).trim();
          if (key) {
            if (key.toLowerCase() === 'authorization' && value.toLowerCase().startsWith('bearer ')) {
              auth = { type: 'bearer', bearerToken: value.slice(7).trim() };
            } else {
              headers.push({ key, value, enabled: true, description: '' });
            }
          }
        }
      } else if (token === '-u' || token === '--user') {
        const creds = takeValue(token);
        const colonIdx = creds.indexOf(':');
        auth = {
          type: 'basic',
          username: colonIdx === -1 ? creds : creds.slice(0, colonIdx),
          password: colonIdx === -1 ? '' : creds.slice(colonIdx + 1)
        };
      } else if (
        token === '-d' ||
        token === '--data' ||
        token === '--data-raw' ||
        token === '--data-binary' ||
        token === '--data-ascii'
      ) {
        dataParts.push(takeValue(token));
      } else if (
        token.startsWith('--data=') ||
        token.startsWith('--data-raw=') ||
        token.startsWith('--data-binary=')
      ) {
        dataParts.push(token.slice(token.indexOf('=') + 1));
      } else if (token === '--data-urlencode') {
        urlencodedParts.push(takeValue(token));
      } else if (token === '-F' || token === '--form') {
        const formStr = takeValue(token);
        const eqIdx = formStr.indexOf('=');
        if (eqIdx !== -1) {
          const k = formStr.slice(0, eqIdx).trim();
          let v = formStr.slice(eqIdx + 1).trim();
          if (v.startsWith('@')) {
            const fileName = v.slice(1).replace(/^"|"$/g, '').split(/[\\/]/).pop();
            formParts.push({ key: k, value: '', type: 'file', fileName, fileData: '', enabled: true });
          } else {
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
              v = v.slice(1, -1);
            }
            formParts.push({ key: k, value: v, type: 'text', fileName: '', fileData: '', enabled: true });
          }
        }
      } else if (token === '-G' || token === '--get') {
        isGetFlag = true;
      } else if (token === '-A' || token === '--user-agent') {
        headers.push({ key: 'User-Agent', value: takeValue(token), enabled: true, description: '' });
      } else if (token === '-b' || token === '--cookie') {
        headers.push({ key: 'Cookie', value: takeValue(token), enabled: true, description: '' });
      } else if (
        token === '--compressed' || token === '-s' || token === '--silent' ||
        token === '-S' || token === '--show-error' || token === '-i' || token === '--include' ||
        token === '-k' || token === '--insecure' || token === '-L' || token === '--location' ||
        token === '-v' || token === '--verbose'
      ) {
        // Boolean flags without values
      } else if (token.startsWith('-')) {
        // Skip unknown flag with possible value if next token doesn't look like a URL or flag
        if (!token.includes('=') && idx + 1 < tokens.length && !tokens[idx + 1].startsWith('-') && !/^https?:\/\//i.test(tokens[idx + 1])) {
          idx++;
        }
      } else if (!url) {
        url = token;
      }
    }

    if (!url) {
      throw new Error('No target URL found in the cURL command.');
    }

    if (!/^https?:\/\//i.test(url) && !url.startsWith('{{')) {
      url = `https://${url}`;
    }

    let bodyType = 'none';
    let body = '';
    let bodyRawType = 'application/json';
    let formdata = [];
    let urlencoded = [];

    const contentTypeHeader = headers.find(h => h.key.toLowerCase() === 'content-type');
    const contentTypeVal = contentTypeHeader ? contentTypeHeader.value.toLowerCase() : '';

    if (formParts.length > 0) {
      bodyType = 'form-data';
      formdata = formParts;
    } else if (urlencodedParts.length > 0 || (dataParts.length > 0 && contentTypeVal.includes('application/x-www-form-urlencoded'))) {
      bodyType = 'urlencoded';
      const allPairs = [...urlencodedParts];
      if (dataParts.length > 0) {
        dataParts.join('&').split('&').forEach(p => { if (p) allPairs.push(p); });
      }
      urlencoded = allPairs.map(pair => {
        const eqIdx = pair.indexOf('=');
        return {
          key: safeDecodeURIComponent(eqIdx === -1 ? pair : pair.slice(0, eqIdx)),
          value: safeDecodeURIComponent(eqIdx === -1 ? '' : pair.slice(eqIdx + 1)),
          enabled: true
        };
      });
    } else if (dataParts.length > 0) {
      const combined = dataParts.join('&');
      if (isGetFlag) {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}${combined}`;
      } else {
        bodyType = 'raw';
        body = combined;
        if (contentTypeVal.includes('xml')) bodyRawType = 'application/xml';
        else if (contentTypeVal.includes('html')) bodyRawType = 'text/html';
        else if (contentTypeVal.includes('text/plain')) bodyRawType = 'text/plain';
        else if (contentTypeVal.includes('json')) bodyRawType = 'application/json';
        else {
          try {
            JSON.parse(combined);
            bodyRawType = 'application/json';
          } catch (e) {
            bodyRawType = 'text/plain';
          }
        }
      }
    }

    if (!method) {
      method = (bodyType !== 'none' && !isGetFlag) ? 'POST' : 'GET';
    }

    let name = 'Imported cURL';
    try {
      const parsed = new URL(url.replace(/\{\{[^}]+\}\}/g, 'placeholder'));
      const pathPart = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : parsed.hostname;
      if (pathPart) name = `${method} ${pathPart}`;
    } catch (e) {
      name = `${method} Request`;
    }

    return {
      name,
      method,
      url,
      headers,
      auth,
      bodyType,
      bodyRawType,
      body,
      formdata,
      urlencoded
    };
  }

  /**
   * Find a {{variable}} placeholder at a given character offset in text.
   */
  function findVariableAtOffset(text, offset) {
    if (typeof text !== 'string' || typeof offset !== 'number' || offset < 0) return null;
    const regex = /\{\{([^{}]+?)\}\}/g;
    let boundaryMatch = null;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1].trim();
      if (!name) continue;
      const start = match.index;
      const end = start + match[0].length;
      if (offset > start && offset < end) {
        return { name, raw: match[0], start, end };
      }
      if (!boundaryMatch && (offset === start || offset === end)) {
        boundaryMatch = { name, raw: match[0], start, end };
      }
    }
    return boundaryMatch;
  }

  /**
   * Detect an open `{{partial` variable token immediately before `offset` for live autocomplete.
   */
  function getPartialVariableQueryAtOffset(text, offset) {
    if (typeof text !== 'string' || typeof offset !== 'number' || offset < 2) return null;
    const before = text.slice(0, offset);
    const openIdx = before.lastIndexOf('{{');
    if (openIdx === -1) return null;
    const fragment = before.slice(openIdx + 2);
    if (fragment.includes('}}') || fragment.includes('\n') || fragment.includes('{')) return null;
    return {
      query: fragment,
      start: openIdx,
      end: offset
    };
  }

  /**
   * Pretty-format JSON string with support for Postman variables ({{var}})
   * and relaxed JSON (trailing commas, single quotes, unquoted keys).
   */
  function formatJSON(str, indent = 2) {
    if (typeof str !== 'string') return '';
    const trimmed = str.trim();
    if (!trimmed) return '';

    // 1. Direct standard JSON formatting
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, indent);
    } catch (e) {
      // Continue to variable & relaxed parser
    }

    // 2. Tokenize unquoted {{var}} so JSON.parse can process it
    const unquotedTokens = [];
    let inString = false;
    let escape = false;
    let transformed = '';

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escape) {
        transformed += char;
        escape = false;
        continue;
      }
      if (char === '\\' && inString) {
        transformed += char;
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        transformed += char;
        continue;
      }

      if (!inString && char === '{' && trimmed[i + 1] === '{') {
        const closeIdx = trimmed.indexOf('}}', i + 2);
        if (closeIdx !== -1) {
          const rawVar = trimmed.slice(i, closeIdx + 2);
          const placeholder = `__EP_UNQ_VAR_${unquotedTokens.length}__`;
          unquotedTokens.push({ placeholder, raw: rawVar });
          transformed += `"${placeholder}"`;
          i = closeIdx + 1;
          continue;
        }
      }

      transformed += char;
    }

    // Strip trailing commas before closing braces/brackets
    const cleaned = transformed.replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(cleaned);
      let formatted = JSON.stringify(parsed, null, indent);
      unquotedTokens.forEach(({ placeholder, raw }) => {
        formatted = formatted.split(`"${placeholder}"`).join(raw);
      });
      return formatted;
    } catch (err2) {
      // 3. Relaxed JSON: Convert single-quoted strings to double quotes and unquoted object keys
      try {
        const relaxed = cleaned
          .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
          .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
          .replace(/,\s*([}\]])/g, '$1');

        const parsedRelaxed = JSON.parse(relaxed);
        let formatted = JSON.stringify(parsedRelaxed, null, indent);
        unquotedTokens.forEach(({ placeholder, raw }) => {
          formatted = formatted.split(`"${placeholder}"`).join(raw);
        });
        return formatted;
      } catch (err3) {
        return str;
      }
    }
  }

  /**
   * Pretty-format XML / XHTML with proper tag indentation.
   */
  function formatXML(xmlStr, indent = 2) {
    if (typeof xmlStr !== 'string') return '';
    const trimmed = xmlStr.trim();
    if (!trimmed) return '';

    const pad = (depth) => ' '.repeat(Math.max(0, depth * indent));
    let formatted = '';
    let depth = 0;

    const tokens = trimmed.replace(/>\s*</g, '><').split(/(<[^>]+>)/g).filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].trim();
      if (!token) continue;

      if (token.startsWith('</')) {
        depth = Math.max(0, depth - 1);
        formatted += (formatted ? '\n' : '') + pad(depth) + token;
      } else if (token.startsWith('<?') || token.startsWith('<!')) {
        formatted += (formatted ? '\n' : '') + pad(depth) + token;
      } else if (token.startsWith('<') && (token.endsWith('/>') || token.endsWith('/ >'))) {
        formatted += (formatted ? '\n' : '') + pad(depth) + token;
      } else if (token.startsWith('<')) {
        const tagNameMatch = token.match(/^<([\w:.-]+)/);
        const tagName = tagNameMatch ? tagNameMatch[1] : null;
        const nextToken = tokens[i + 1] ? tokens[i + 1].trim() : '';
        const afterNextToken = tokens[i + 2] ? tokens[i + 2].trim() : '';

        if (tagName && nextToken && !nextToken.startsWith('<') && afterNextToken === `</${tagName}>`) {
          formatted += (formatted ? '\n' : '') + pad(depth) + token + nextToken + afterNextToken;
          i += 2;
        } else {
          formatted += (formatted ? '\n' : '') + pad(depth) + token;
          depth++;
        }
      } else {
        formatted += (formatted ? '\n' : '') + pad(depth) + token;
      }
    }

    return formatted || xmlStr;
  }

  /**
   * Pretty-format HTML with void tag awareness.
   */
  function formatHTML(htmlStr, indent = 2) {
    if (typeof htmlStr !== 'string') return '';
    const trimmed = htmlStr.trim();
    if (!trimmed) return '';

    const voidElements = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'source', 'track', 'wbr'
    ]);

    const pad = (depth) => ' '.repeat(Math.max(0, depth * indent));
    let formatted = '';
    let depth = 0;

    const tokens = trimmed.replace(/>\s*</g, '><').split(/(<[^>]+>)/g).filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].trim();
      if (!token) continue;

      if (token.startsWith('</')) {
        depth = Math.max(0, depth - 1);
        formatted += (formatted ? '\n' : '') + pad(depth) + token;
      } else if (token.startsWith('<!') || token.startsWith('<?')) {
        formatted += (formatted ? '\n' : '') + pad(depth) + token;
      } else if (token.startsWith('<') && token.endsWith('/>')) {
        formatted += (formatted ? '\n' : '') + pad(depth) + token;
      } else if (token.startsWith('<')) {
        const tagNameMatch = token.match(/^<([a-zA-Z0-9-]+)/);
        const tagName = tagNameMatch ? tagNameMatch[1].toLowerCase() : '';

        if (voidElements.has(tagName)) {
          formatted += (formatted ? '\n' : '') + pad(depth) + token;
        } else {
          const nextToken = tokens[i + 1] ? tokens[i + 1].trim() : '';
          const afterNextToken = tokens[i + 2] ? tokens[i + 2].trim() : '';
          if (tagName && nextToken && !nextToken.startsWith('<') && afterNextToken.toLowerCase() === `</${tagName}>`) {
            formatted += (formatted ? '\n' : '') + pad(depth) + token + nextToken + afterNextToken;
            i += 2;
          } else {
            formatted += (formatted ? '\n' : '') + pad(depth) + token;
            depth++;
          }
        }
      } else {
        formatted += (formatted ? '\n' : '') + pad(depth) + token;
      }
    }

    return formatted || htmlStr;
  }

  /**
   * Prettify any content based on explicit type or automatic detection.
   */
  function prettifyContent(str, typeHint = 'auto', indent = 2) {
    if (typeof str !== 'string') return '';
    const trimmed = str.trim();
    if (!trimmed) return str;

    const lowerHint = String(typeHint || 'auto').toLowerCase();

    if (lowerHint === 'json' || lowerHint === 'application/json') {
      return formatJSON(str, indent);
    }
    if (lowerHint === 'xml' || lowerHint === 'application/xml' || lowerHint === 'text/xml') {
      return formatXML(str, indent);
    }
    if (lowerHint === 'html' || lowerHint === 'text/html') {
      return formatHTML(str, indent);
    }
    if (lowerHint === 'text' || lowerHint === 'text/plain') {
      return str;
    }

    // Auto-detection
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      const jsonRes = formatJSON(str, indent);
      if (jsonRes !== str) return jsonRes;
    }
    if (trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && trimmed.endsWith('>'))) {
      if (trimmed.toLowerCase().startsWith('<!doctype html') || trimmed.toLowerCase().startsWith('<html')) {
        return formatHTML(str, indent);
      }
      return formatXML(str, indent);
    }

    return str;
  }

  const exported = {
    escapeHTML,
    safeDecodeURIComponent,
    getByteLength,
    formatBytes,
    resolveVariables,
    deepEqual,
    parseUrlParams,
    rebuildUrlFromParams,
    parseCSV,
    tokenizeShellCommand,
    parseCurlCommand,
    findVariableAtOffset,
    getPartialVariableQueryAtOffset,
    formatJSON,
    formatXML,
    formatHTML,
    prettifyContent
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  } else {
    Object.assign(globalScope, exported);
    globalScope.ExpressPostUtils = exported;
  }
})(typeof self !== 'undefined' ? self : globalThis);

