const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Support parsing JSON and URL-encoded bodies for proxy inputs
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// HTTP Proxy Endpoint to bypass CORS
app.post('/api/proxy', async (req, res) => {
  const { url, method, headers = {}, body = null } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Clean request headers to avoid conflicts
  const cleanHeaders = {};
  Object.keys(headers).forEach(key => {
    const lowerKey = key.toLowerCase();
    // Do not forward standard host or length headers, let axios/Node compute them
    if (lowerKey !== 'host' && lowerKey !== 'content-length' && headers[key] !== undefined && headers[key] !== '') {
      cleanHeaders[key] = headers[key];
    }
  });

  const start = Date.now();

  try {
    // Determine request payload config
    let requestData = body;
    
    // For form-data payload, if it was sent as structured key-value array
    if (body && typeof body === 'object' && cleanHeaders['content-type'] && cleanHeaders['content-type'].includes('multipart/form-data')) {
      // Create boundary and build multipart form body
      const boundary = '----WebKitFormBoundaryPostmanClone' + Math.random().toString(36).substring(2);
      cleanHeaders['content-type'] = `multipart/form-data; boundary=${boundary}`;
      
      let multipartBody = '';
      if (Array.isArray(body)) {
        for (const item of body) {
          if (!item.key) continue;
          multipartBody += `--${boundary}\r\n`;
          
          if (item.type === 'file' && item.fileData) {
            // fileData is expected to be a base64 encoded string: "data:mime/type;base64,..."
            const matches = item.fileData.match(/^data:(.+);base64,(.+)$/);
            if (matches) {
              const filename = item.fileName || 'file';
              const fileBuffer = Buffer.from(matches[2], 'base64');
              multipartBody += `Content-Disposition: form-data; name="${item.key}"; filename="${filename}"\r\n`;
              multipartBody += `Content-Type: ${matches[1]}\r\n\r\n`;
              multipartBody += fileBuffer.toString('binary');
              multipartBody += '\r\n';
            }
          } else {
            multipartBody += `Content-Disposition: form-data; name="${item.key}"\r\n\r\n`;
            multipartBody += `${item.value || ''}\r\n`;
          }
        }
        multipartBody += `--${boundary}--\r\n`;
        // Convert to buffer with binary encoding
        requestData = Buffer.from(multipartBody, 'binary');
      }
    }

    const axiosConfig = {
      method: method || 'GET',
      url: url,
      headers: cleanHeaders,
      data: requestData,
      // Do not follow redirects automatically so client can see them (optional)
      // but usually Postman follows redirects. We can follow them.
      maxRedirects: 5,
      // Don't reject promise for any status code
      validateStatus: () => true,
      // Receive raw response text/buffer to avoid parsing issues
      responseType: 'arraybuffer',
      // Set reasonable timeout (30 seconds)
      timeout: 30000
    };

    const response = await axios(axiosConfig);
    const duration = Date.now() - start;

    // Convert arraybuffer back to string/JSON
    const responseHeaders = {};
    Object.keys(response.headers).forEach(key => {
      // Convert headers array or string correctly
      responseHeaders[key] = response.headers[key];
    });

    const bodyBuffer = response.data;
    const bodySize = bodyBuffer ? bodyBuffer.length : 0;
    
    // Convert body to string
    let responseText = '';
    if (bodyBuffer) {
      // Decode with UTF-8 by default
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
      message: error.message,
      time: duration,
      details: error.stack
    });
  }
});



// Memory cache for client mock endpoints
let localMocks = [];

// Sync mocks from the client
app.post('/api/mocks/sync', (req, res) => {
  const { mocks } = req.body;
  if (Array.isArray(mocks)) {
    localMocks = mocks;
    console.log(`[ExpressPost Mock Engine] Synced ${localMocks.length} mock endpoints.`);
    return res.json({ success: true, count: localMocks.length });
  }
  return res.status(400).json({ error: 'Mocks must be an array' });
});

// Wildcard Mock Endpoint
app.all('/mock/*', (req, res) => {
  // Extract path without '/mock' prefix
  let mockPath = req.path.replace(/^\/mock/, '');
  if (!mockPath.startsWith('/')) {
    mockPath = '/' + mockPath;
  }
  
  const method = req.method.toUpperCase();
  console.log(`[ExpressPost Mock Engine] Request: ${method} ${mockPath}`);

  // Find exact matching mock
  const match = localMocks.find(m => {
    let mPath = m.path || '';
    if (!mPath.startsWith('/')) {
      mPath = '/' + mPath;
    }
    return mPath.toLowerCase() === mockPath.toLowerCase() && m.method.toUpperCase() === method;
  });

  if (match) {
    const status = parseInt(match.status) || 200;
    const contentType = match.contentType || 'application/json';
    
    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Powered-By', 'ExpressPost Mock Simulator');

    if (Array.isArray(match.headers)) {
      match.headers.forEach(h => {
        if (h.key && h.value) {
          res.setHeader(h.key, h.value);
        }
      });
    }

    let responseBody = match.body || '';
    if (contentType === 'application/json') {
      try {
        // Send as parsed JSON if valid
        return res.status(status).json(JSON.parse(responseBody));
      } catch (e) {
        // Fallback to sending string if not parseable
        return res.status(status).send(responseBody);
      }
    }
    return res.status(status).send(responseBody);
  }

  // Not found
  res.status(404).json({
    error: 'Mock Endpoint Not Found',
    message: `No mock configured for ${method} /mock${mockPath}`,
    hint: 'Configure mock endpoints inside ExpressPost and sync them to make them active.',
    activeMocks: localMocks.map(m => `${m.method} /mock${m.path.startsWith('/') ? m.path : '/' + m.path}`)
  });
});

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`==================================================`);
      console.log(`🚀 Postman Clone server running on http://localhost:${port}`);
      console.log(`📂 Serving static app files from ./public`);
      console.log(`🔗 CORS Proxy API active at http://localhost:${port}/api/proxy`);
      console.log(`==================================================`);
      resolve(server);
    });
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
