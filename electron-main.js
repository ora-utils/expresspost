const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const net = require('net');

let expressServer = null;
let mainWindow = null;

// Dynamically scans for available ports starting from a given port on IPv4 loopback
function findAvailablePort(startPort, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, host, () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1, host));
    });
  });
}

function stopExpressServer() {
  if (expressServer) {
    try {
      if (typeof expressServer.closeAllConnections === 'function') {
        expressServer.closeAllConnections();
      }
      expressServer.close();
    } catch (e) {
      // Ignore shutdown errors
    }
    expressServer = null;
  }
}

function createMainWindow(port) {
  const appOrigin = `http://127.0.0.1:${port}`;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'ExpressPost - Premium API Client & Runner',
    icon: path.join(__dirname, 'public', 'logo.png'),
    backgroundColor: '#171a20',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Allow OAuth popups in child windows; open unexpected external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === 'expresspost-oauth' || url === 'about:blank' || url.startsWith(appOrigin)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 700,
          height: 800,
          parent: mainWindow,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          }
        }
      };
    }
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Prevent accidental main-window navigation away from ExpressPost
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
    }
  });

  // Load local server URL
  mainWindow.loadURL(appOrigin);

  // Customize standard application menu to enable hotkeys (devtools, zoom, copy/paste)
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Startup lifecycle
app.on('ready', async () => {
  try {
    const port = await findAvailablePort(45123, '127.0.0.1');
    const { startServer } = require('./server');
    expressServer = await startServer(port, '127.0.0.1');
    createMainWindow(port);
  } catch (err) {
    console.error('Failed to initialize application:', err);
    app.quit();
  }
});

// App shutdown lifecycle
app.on('window-all-closed', () => {
  stopExpressServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', stopExpressServer);
app.on('quit', stopExpressServer);
