const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

app.get('/oauth/callback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'oauth-callback.html'));
});

// Support parsing JSON and URL-encoded bodies for proxy inputs
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Memory cache for client mock endpoints
let localMocks = [];

function normalizeMockPath(rawPath) {
  let p = String(rawPath || '').trim();
  const qIndex = p.indexOf('?');
  if (qIndex !== -1) p = p.slice(0, qIndex);
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), mocksCount: localMocks.length });
});

// HTTP Proxy Endpoint to bypass CORS
app.post('/api/proxy', async (req, res) => {
  const { url, method, headers = {}, body = null, timeout = 30000 } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.trim());
  } catch (err) {
    return res.status(400).json({ error: 'Invalid URL', message: 'Please enter a valid http:// or https:// URL.' });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Unsupported Protocol', message: 'Only http:// and https:// URLs are supported.' });
  }

  // Clean request headers to avoid conflicts
  const cleanHeaders = {};
  if (headers && typeof headers === 'object') {
    Object.keys(headers).forEach(key => {
      const lowerKey = key.toLowerCase();
      // Do not forward standard host, connection, or length headers; let axios/Node compute them
      if (lowerKey !== 'host' && lowerKey !== 'content-length' && lowerKey !== 'connection' && headers[key] !== undefined && headers[key] !== '') {
        cleanHeaders[key] = String(headers[key]);
      }
    });
  }

  // Ensure realistic client User-Agent, Accept, and Encoding like Postman Desktop
  const hasUserAgent = Object.keys(cleanHeaders).some(k => k.toLowerCase() === 'user-agent');
  if (!hasUserAgent) {
    cleanHeaders['user-agent'] = 'PostmanRuntime/7.39.0 (ExpressPost/1.0.0; Windows NT 10.0; Win64; x64)';
  }
  const hasAccept = Object.keys(cleanHeaders).some(k => k.toLowerCase() === 'accept');
  if (!hasAccept) {
    cleanHeaders['accept'] = '*/*';
  }
  const hasAcceptEncoding = Object.keys(cleanHeaders).some(k => k.toLowerCase() === 'accept-encoding');
  if (!hasAcceptEncoding) {
    cleanHeaders['accept-encoding'] = 'gzip, deflate, br';
  }

  const normalizedMethod = String(method || 'GET').toUpperCase();
  const safeTimeout = Math.min(Math.max(parseInt(timeout, 10) || 30000, 1000), 120000);
  const start = Date.now();

  try {
    let requestData = body;

    // For form-data payload sent as structured key-value array
    const contentTypeHeader = Object.keys(cleanHeaders).find(key => key.toLowerCase() === 'content-type');
    if (body && typeof body === 'object' && contentTypeHeader &&
        String(cleanHeaders[contentTypeHeader]).toLowerCase().includes('multipart/form-data')) {
      const boundary = '----WebKitFormBoundaryExpressPost' + Math.random().toString(36).substring(2);
      cleanHeaders[contentTypeHeader] = `multipart/form-data; boundary=${boundary}`;

      if (Array.isArray(body)) {
        const chunks = [];
        const safeQuote = v => String(v || '').replace(/[\r\n"]/g, '_');

        for (const item of body) {
          if (!item || !item.key) continue;
          const fieldName = safeQuote(item.key);

          if (item.type === 'file' && item.fileData) {
            const matches = String(item.fileData).match(/^data:([^;,]*)(?:;[^,]*)?;base64,(.+)$/);
            if (matches) {
              const mimeType = matches[1] || 'application/octet-stream';
              const filename = safeQuote(item.fileName || 'file');
              const fileBuffer = Buffer.from(matches[2], 'base64');
              chunks.push(Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
                'utf8'
              ));
              chunks.push(fileBuffer);
              chunks.push(Buffer.from('\r\n', 'utf8'));
            }
          } else {
            chunks.push(Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${item.value == null ? '' : String(item.value)}\r\n`,
              'utf8'
            ));
          }
        }
        chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
        requestData = Buffer.concat(chunks);
      }
    }

    const axiosConfig = {
      method: normalizedMethod,
      url: parsedUrl.toString(),
      headers: cleanHeaders,
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'arraybuffer',
      timeout: safeTimeout
    };

    if (requestData !== null && requestData !== undefined &&
        !((normalizedMethod === 'GET' || normalizedMethod === 'HEAD') && requestData === '')) {
      axiosConfig.data = requestData;
    }

    const response = await axios(axiosConfig);
    const duration = Date.now() - start;

    const responseHeaders = {};
    Object.keys(response.headers || {}).forEach(key => {
      const val = response.headers[key];
      responseHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
    });

    const bodyBuffer = response.data;
    const bodySize = bodyBuffer ? bodyBuffer.length : 0;

    let responseText = '';
    if (bodyBuffer) {
      responseText = bodyBuffer.toString('utf8');
    }

    res.json({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseText,
      time: duration,
      size: bodySize
    });
  } catch (error) {
    const duration = Date.now() - start;
    res.status(502).json({
      error: 'Proxy Error',
      code: error.code || 'PROXY_FAILED',
      message: error.message,
      time: duration
    });
  }
});

// Get currently synced mocks
app.get('/api/mocks', (req, res) => {
  res.json({ mocks: localMocks, count: localMocks.length });
});

// Sync mocks from the client
app.post('/api/mocks/sync', (req, res) => {
  const { mocks } = req.body || {};
  if (Array.isArray(mocks)) {
    localMocks = mocks.map(m => ({
      ...m,
      path: normalizeMockPath(m.path),
      method: String(m.method || 'GET').toUpperCase(),
      status: Math.min(Math.max(parseInt(m.status, 10) || 200, 100), 599),
      delay: Math.min(Math.max(parseInt(m.delay, 10) || 0, 0), 10000)
    }));
    console.log(`[ExpressPost Mock Engine] Synced ${localMocks.length} mock endpoints.`);
    return res.json({ success: true, count: localMocks.length });
  }
  return res.status(400).json({ error: 'Mocks must be an array' });
});

// Wildcard Mock Endpoint
app.all(['/mock', '/mock/*'], async (req, res) => {
  const mockPath = normalizeMockPath(req.path.replace(/^\/mock/, '') || '/');
  const method = req.method.toUpperCase();
  console.log(`[ExpressPost Mock Engine] Request: ${method} ${mockPath}`);

  const match = localMocks.find(m =>
    m.enabled !== false &&
    normalizeMockPath(m.path).toLowerCase() === mockPath.toLowerCase() &&
    String(m.method || 'GET').toUpperCase() === method
  );

  if (match) {
    if (match.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, match.delay));
    }

    const status = Math.min(Math.max(parseInt(match.status, 10) || 200, 100), 599);
    const contentType = match.contentType || 'application/json';

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Powered-By', 'ExpressPost Mock Simulator');

    if (Array.isArray(match.headers)) {
      match.headers.forEach(h => {
        if (h && h.enabled !== false && h.key && h.value !== undefined) {
          const lower = String(h.key).trim().toLowerCase();
          if (lower && lower !== 'content-length' && lower !== 'transfer-encoding') {
            try {
              res.setHeader(String(h.key).trim(), String(h.value));
            } catch (e) {
              // Ignore invalid header names/values
            }
          }
        }
      });
    }

    if (status === 204 || status === 304) {
      return res.status(status).end();
    }

    const responseBody = match.body == null ? '' : String(match.body);
    if (contentType.toLowerCase().includes('json')) {
      try {
        return res.status(status).json(JSON.parse(responseBody));
      } catch (e) {
        return res.status(status).send(responseBody);
      }
    }
    return res.status(status).send(responseBody);
  }

  // Not found
  res.status(404).json({
    error: 'Mock Endpoint Not Found',
    message: `No mock configured for ${method} /mock${mockPath === '/' ? '' : mockPath}`,
    hint: 'Configure mock endpoints inside ExpressPost and sync them to make them active.',
    activeMocks: localMocks
      .filter(m => m.enabled !== false)
      .map(m => `${m.method} /mock${normalizeMockPath(m.path)}`)
  });
});

function startServer(port, host) {
  return new Promise((resolve, reject) => {
    const onListen = () => {
      console.log(`==================================================`);
      console.log(`🚀 ExpressPost server running on http://${host || 'localhost'}:${port}`);
      console.log(`📂 Serving static app files from ./public`);
      console.log(`🔗 CORS Proxy API active at http://${host || 'localhost'}:${port}/api/proxy`);
      console.log(`==================================================`);
      resolve(server);
    };
    const server = host ? app.listen(port, host, onListen) : app.listen(port, onListen);
    server.on('error', (err) => {
      reject(err);
    });
  });
}

// Run server if run directly
if (require.main === module) {
  startServer(PORT).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { app, startServer };
