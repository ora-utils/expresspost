const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const net = require('net');

let expressServer = null;
let mainWindow = null;

// Dynamically scans for available ports starting from a given port
function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'CSK RestRunner - Premium API Client & Runner',
    icon: path.join(__dirname, 'public', 'logo.png'),
    backgroundColor: '#070a16',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Load local server URL
  mainWindow.loadURL(`http://localhost:${port}`);

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
    const port = await findAvailablePort(3000);
    const { startServer } = require('./server');
    expressServer = await startServer(port);
    createMainWindow(port);
  } catch (err) {
    console.error('Failed to initialize application:', err);
    app.quit();
  }
});

// App shutdown lifecycle
app.on('window-all-closed', () => {
  // Terminate express server
  if (expressServer) {
    expressServer.close();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (expressServer) {
    expressServer.close();
  }
});
