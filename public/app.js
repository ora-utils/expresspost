/**
 * ExpressPost Main Workspace Application
 * Controls UI views, tab management, bidirectional URL/Params sync,
 * environment resolution modals, API request dispatches, and sandbox integrations.
 */

// UI State Variables
let tabs = [];
let activeTabId = null;
let bodyEditor = null;
let preRequestEditor = null;
let testsEditor = null;
let responseEditor = null;
let devConsoleLogs = [];
const activeRequestControllers = new Map();
// Global Request Deletion Handler
window.deleteRequestFromCollection = function(e, reqId, collId) {
  e.preventDefault();
  e.stopPropagation();
  if (confirm('Remove request from collection?')) {
    const coll = collections.find(c => String(c.id) === String(collId));
    if (coll) {
      coll.requests = coll.requests.filter(r => String(r.id) !== String(reqId));
      saveCollections();
      renderCollections();
      if (typeof populateRunnerSelects === 'function') populateRunnerSelects();
    }
  }
};

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
  setupAppearanceControls();
  initAceEditors();
  initCollectionsAndRunner();
  loadTabs();
  setupAppEventListeners();
  setupConsoleEventListeners();
  setupEnvironmentModalListeners();
  setupSaveModalListeners();
  
  // Create first tab if empty
  if (tabs.length === 0) {
    createNewTab();
  } else {
    switchActiveTab(activeTabId);
  }
});

function setupAppearanceControls() {
  const root = document.documentElement;
  const modal = document.getElementById('appearance-modal');
  const openButtons = [
    document.getElementById('btn-open-appearance'),
    document.getElementById('btn-open-appearance-runner')
  ].filter(Boolean);
  const themeSelect = document.getElementById('appearance-theme');
  const accentInput = document.getElementById('appearance-accent');
  const densitySelect = document.getElementById('appearance-density');
  const defaultAccent = '#4c9aff';

  if (!modal || openButtons.length === 0 || !themeSelect || !accentInput || !densitySelect) {
    throw new Error('Appearance controls are missing from the page.');
  }

  themeSelect.value = root.dataset.theme || 'dark';
  accentInput.value = root.style.getPropertyValue('--primary').trim() || defaultAccent;
  densitySelect.value = root.dataset.density || 'compact';

  const savePreferences = () => {
    root.dataset.theme = themeSelect.value;
    root.style.setProperty('--primary', accentInput.value);
    root.dataset.density = densitySelect.value;
    const editorTheme = themeSelect.value === 'light' ? 'ace/theme/chrome' : 'ace/theme/tomorrow_night';
    [bodyEditor, preRequestEditor, testsEditor, responseEditor]
      .filter(Boolean)
      .forEach(editor => editor.setTheme(editorTheme));
    localStorage.setItem('expresspost_theme', themeSelect.value);
    localStorage.setItem('expresspost_accent', accentInput.value);
    localStorage.setItem('expresspost_density', densitySelect.value);
  };
  let lastOpenButton = null;
  const closeModal = () => {
    modal.classList.add('hidden');
    if (lastOpenButton && lastOpenButton.isConnected) lastOpenButton.focus();
  };

  openButtons.forEach(button => {
    button.addEventListener('click', () => {
      lastOpenButton = button;
      modal.classList.remove('hidden');
      themeSelect.focus();
    });
  });
  document.getElementById('btn-close-appearance').addEventListener('click', closeModal);
  document.getElementById('btn-done-appearance').addEventListener('click', closeModal);
  document.getElementById('btn-reset-accent').addEventListener('click', () => {
    accentInput.value = defaultAccent;
    savePreferences();
  });
  [themeSelect, densitySelect].forEach(control => control.addEventListener('change', savePreferences));
  accentInput.addEventListener('input', savePreferences);
  modal.addEventListener('click', event => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });
}

/**
 * Initialize Ace Editors via CDN
 */
function initAceEditors() {
  const aceOptions = {
    theme: document.documentElement.dataset.theme === 'light' ? 'ace/theme/chrome' : 'ace/theme/tomorrow_night',
    showPrintMargin: false,
    fontSize: '13px',
    tabSize: 4,
    useSoftTabs: true,
    highlightActiveLine: false,
    cursorStyle: 'smooth'
  };

  // Body Editor
  bodyEditor = ace.edit('body-editor');
  bodyEditor.setOptions(aceOptions);
  bodyEditor.session.setMode('ace/mode/json');
  bodyEditor.on('change', () => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.body = bodyEditor.getValue();
      saveTabsState();
    }
  });

  // Pre-request Script Editor
  preRequestEditor = ace.edit('pre-request-editor');
  preRequestEditor.setOptions(aceOptions);
  preRequestEditor.session.setMode('ace/mode/javascript');
  preRequestEditor.on('change', () => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.preRequestScript = preRequestEditor.getValue();
      saveTabsState();
    }
  });

  // Test Script Editor
  testsEditor = ace.edit('tests-editor');
  testsEditor.setOptions(aceOptions);
  testsEditor.session.setMode('ace/mode/javascript');
  testsEditor.on('change', () => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.testsScript = testsEditor.getValue();
      saveTabsState();
    }
  });

  // Response Code Editor (Read only pretty view)
  responseEditor = ace.edit('response-editor');
  responseEditor.setOptions(aceOptions);
  responseEditor.setReadOnly(true);
  responseEditor.session.setMode('ace/mode/json');
}

/**
 * Tabs management
 */
function loadTabs() {
  const localTabs = localStorage.getItem('workspace_tabs');
  const localActiveId = localStorage.getItem('workspace_active_tab');

  if (localTabs) {
    try {
      tabs = JSON.parse(localTabs);
      activeTabId = localActiveId;
    } catch (e) {
      tabs = [];
    }
  }
}

function saveTabsState() {
  localStorage.setItem('workspace_tabs', JSON.stringify(stripOAuthSecrets(tabs)));
  localStorage.setItem('workspace_active_tab', activeTabId);
}

const OAUTH_SESSION_SECRET_FIELDS = [
  'oauthClientSecret',
  'oauthUsername',
  'oauthPassword',
  'oauthAccessToken',
  'oauthRefreshToken',
  'oauthExpiresAt'
];

function ensureOAuthSessionId(auth) {
  if (!auth.oauthSessionId) {
    auth.oauthSessionId = `oauth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return auth.oauthSessionId;
}

function saveOAuthSecret(auth, field, value) {
  const key = `expresspost:${ensureOAuthSessionId(auth)}:${field}`;
  if (value) sessionStorage.setItem(key, String(value));
  else sessionStorage.removeItem(key);
}

function readOAuthSecret(auth, field) {
  if (!auth || !auth.oauthSessionId) return '';
  return sessionStorage.getItem(`expresspost:${auth.oauthSessionId}:${field}`) || '';
}

function removeOAuthSecrets(auth) {
  const cleanAuth = { ...(auth || {}) };
  if (cleanAuth.type === 'oauth2') {
    OAUTH_SESSION_SECRET_FIELDS.forEach(field => {
      if (cleanAuth[field] !== undefined) {
        saveOAuthSecret(cleanAuth, field, cleanAuth[field]);
        delete cleanAuth[field];
      }
    });
  }
  return cleanAuth;
}

function moveOAuthSecretsToSession(auth) {
  const cleanAuth = removeOAuthSecrets(auth);
  OAUTH_SESSION_SECRET_FIELDS.forEach(field => { delete auth[field]; });
  Object.assign(auth, cleanAuth);
  return auth;
}

function hydrateOAuthAuth(auth) {
  const hydrated = { ...(auth || {}) };
  if (hydrated.type === 'oauth2') {
    ensureOAuthSessionId(hydrated);
    OAUTH_SESSION_SECRET_FIELDS.forEach(field => {
      hydrated[field] = readOAuthSecret(hydrated, field) || hydrated[field] || '';
    });
  }
  return hydrated;
}

function createNewTab(initialData = null) {
  const id = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const defaultTab = {
    id,
    name: 'New Request',
    method: 'GET',
    url: '',
    headers: [{ key: '', value: '', enabled: true, description: '' }],
    auth: { type: 'none', bearerToken: '', username: '', password: '', key: '', value: '', in: 'header' },
    bodyType: 'none',
    bodyRawType: 'application/json',
    body: '',
    formdata: [{ key: '', value: '', type: 'text', fileData: null, fileName: '', enabled: true }],
    urlencoded: [{ key: '', value: '', enabled: true }],
    preRequestScript: '',
    testsScript: '',
    savedCollectionId: null,
    savedRequestId: null,
    description: '',
    response: null,
    testResults: null
  };

  const newTabObj = initialData ? { ...defaultTab, ...initialData, id } : defaultTab;
  newTabObj.name = newTabObj.name || 'New Request';
  newTabObj.method = newTabObj.method || 'GET';
  newTabObj.url = newTabObj.url || '';
  newTabObj.headers = Array.isArray(newTabObj.headers) ? newTabObj.headers : defaultTab.headers;
  newTabObj.auth = { ...defaultTab.auth, ...(newTabObj.auth || {}) };
  newTabObj.formdata = initialData
    ? (initialData.formdata || initialData.formData || defaultTab.formdata)
    : defaultTab.formdata;
  newTabObj.urlencoded = initialData && initialData.urlencoded
    ? initialData.urlencoded
    : defaultTab.urlencoded;
  
  // Strip duplicate template empty rows from initial headers
  if (newTabObj.headers.length === 0) {
    newTabObj.headers.push({ key: '', value: '', enabled: true, description: '' });
  }

  tabs.push(newTabObj);
  activeTabId = id;
  saveTabsState();
  
  renderTabsUI();
  switchActiveTab(id);
}

function renderTabsUI() {
  const tabsContainer = document.getElementById('request-tabs');
  if (!tabsContainer) return;

  tabsContainer.innerHTML = '';
  tabs.forEach(tab => {
    const tabBtn = document.createElement('button');
    tabBtn.className = `workspace-tab ${tab.id === activeTabId ? 'active' : ''}`;
    tabBtn.id = `btn-${tab.id}`;
    
    let methodClass = 'method-dot method-badge-other';
    const method = (tab.method || 'GET').toLowerCase();
    if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
      methodClass = `method-dot method-badge-${method}`;
    }

    tabBtn.innerHTML = `
      <span class="${methodClass}">${tab.method}</span>
      <span class="tab-name">${escapeHTML(tab.name)}</span>
      ${activeRequestControllers.has(tab.id) ? '<i class="fa-solid fa-spinner fa-spin" aria-label="Request running"></i>' : ''}
      <span class="close-tab-btn" data-id="${tab.id}">&times;</span>
    `;
    
    tabBtn.addEventListener('click', (e) => {
      if (e.target.classList.contains('close-tab-btn')) {
        e.stopPropagation();
        closeTab(tab.id);
      } else {
        switchActiveTab(tab.id);
      }
    });

    tabsContainer.appendChild(tabBtn);
  });
}

function closeTab(id) {
  const tabIdx = tabs.findIndex(t => t.id === id);
  if (tabIdx === -1) return;

  const activeController = activeRequestControllers.get(id);
  if (activeController) activeController.abort();
  activeRequestControllers.delete(id);
  tabs.splice(tabIdx, 1);
  
  if (tabs.length === 0) {
    createNewTab();
  } else if (activeTabId === id) {
    // switch to closest tab
    const nextActiveIdx = tabIdx === 0 ? 0 : tabIdx - 1;
    activeTabId = tabs[nextActiveIdx].id;
  }
  
  saveTabsState();
  renderTabsUI();
  switchActiveTab(activeTabId);
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId);
}

function updateSendButtonState(tabId) {
  const sendBtn = document.getElementById('btn-send-request');
  if (!sendBtn) return;
  if (activeRequestControllers.has(tabId)) {
    sendBtn.innerHTML = '<span>Cancel</span> <i class="fa-solid fa-stop"></i>';
    sendBtn.title = 'Cancel the in-flight request';
    sendBtn.disabled = false;
  } else {
    sendBtn.innerHTML = '<span>Send</span> <i class="fa-solid fa-paper-plane"></i>';
    sendBtn.title = '';
    sendBtn.disabled = false;
  }
}

function switchActiveTab(id) {
  activeTabId = id;
  saveTabsState();

  // Active UI highlights
  document.querySelectorAll('.workspace-tab').forEach(t => t.classList.remove('active'));
  const activeBtn = document.getElementById(`btn-${id}`);
  if (activeBtn) activeBtn.classList.add('active');

  const tab = getActiveTab();
  if (!tab) return;
  updateSendButtonState(id);

  // Address Bar inputs
  document.getElementById('request-method').value = tab.method;
  document.getElementById('request-url').value = tab.url || '';
  
  // Params table UI
  renderKeyValueTable('params', parseUrlParams(tab.url));
  
  // Headers UI
  renderKeyValueTable('headers', tab.headers);
  updateHeadersCountBadge();

  // Auth UI
  document.getElementById('auth-type').value = tab.auth.type || 'none';
  toggleAuthPaneFields(tab.auth.type || 'none');
  document.getElementById('auth-bearer-token').value = tab.auth.bearerToken || '';
  document.getElementById('auth-basic-username').value = tab.auth.username || '';
  document.getElementById('auth-basic-password').value = tab.auth.password || '';
  document.getElementById('auth-apikey-key').value = tab.auth.key || '';
  document.getElementById('auth-apikey-value').value = tab.auth.value || '';
  document.getElementById('auth-apikey-in').value = tab.auth.in || 'header';
  if (tab.auth.type === 'oauth2') moveOAuthSecretsToSession(tab.auth);
  const oauthAuth = hydrateOAuthAuth(tab.auth);
  document.getElementById('oauth-grant-type').value = tab.auth.oauthGrantType || 'client_credentials';
  document.getElementById('oauth-client-id').value = tab.auth.oauthClientId || '';
  document.getElementById('oauth-client-secret').value = oauthAuth.oauthClientSecret || '';
  document.getElementById('oauth-token-url').value = tab.auth.oauthTokenUrl || '';
  document.getElementById('oauth-authorization-url').value = tab.auth.oauthAuthorizationUrl || '';
  document.getElementById('oauth-redirect-url').value = tab.auth.oauthRedirectUrl || `${window.location.origin}/oauth/callback`;
  document.getElementById('oauth-scope').value = tab.auth.oauthScope || '';
  document.getElementById('oauth-client-auth').value = tab.auth.oauthClientAuth || 'body';
  document.getElementById('oauth-username').value = oauthAuth.oauthUsername || '';
  document.getElementById('oauth-password').value = oauthAuth.oauthPassword || '';
  updateOAuthGrantFields(tab.auth.oauthGrantType || 'client_credentials');
  document.getElementById('oauth-token-status').textContent = oauthAuth.oauthAccessToken ? 'Token available for this session' : 'No token';

  // Body UI
  const bodyRadios = document.getElementsByName('body-type');
  bodyRadios.forEach(radio => {
    radio.checked = radio.value === tab.bodyType;
  });
  toggleBodyPane(tab.bodyType);
  document.getElementById('body-raw-type').value = tab.bodyRawType || 'application/json';
  bodyEditor.setValue(tab.body || '');
  bodyEditor.clearSelection();

  // Pre-request script Ace Value
  preRequestEditor.setValue(tab.preRequestScript || '');
  preRequestEditor.clearSelection();

  // Test script Ace Value
  testsEditor.setValue(tab.testsScript || '');
  testsEditor.clearSelection();

  // Reset Response area
  if (tab.response) {
    renderResponseUI(tab.response, tab.testResults);
  } else {
    document.getElementById('response-empty-state').classList.remove('hidden');
    document.getElementById('response-content-area').classList.add('hidden');
    document.getElementById('response-metadata').classList.add('hidden');
  }
}

/**
 * Key-Value Editors UI Sync
 */
function renderKeyValueTable(tableType, list) {
  const tbody = document.getElementById(`${tableType}-table-body`);
  if (!tbody) return;

  tbody.innerHTML = '';
  
  // Ensure we always have at least 1 blank row
  const items = (list && list.length > 0) ? [...list] : [];
  const lastItem = items[items.length - 1];
  if (!lastItem || lastItem.key !== '') {
    items.push({ key: '', value: '', enabled: true, description: '' });
  }

  items.forEach((item, index) => {
    const row = document.createElement('tr');
    
    // Different cell inputs for form-data (text/file option dropdown)
    const isFormData = tableType === 'formdata';
    const isFile = isFormData && item.type === 'file';

    row.innerHTML = `
      <td class="checkbox-cell">
        <input type="checkbox" class="row-checkbox" ${item.enabled !== false ? 'checked' : ''}>
      </td>
      <td>
        <input type="text" class="row-key code-font" placeholder="Key" value="${escapeHTML(item.key)}" autocomplete="off">
      </td>
      <td>
        ${isFile ? `
          <div style="display: flex; gap: 8px; align-items: center; width: 100%;">
            <input type="file" class="row-file-input">
            <span class="file-info-text text-accent" style="font-size: 11px;">${item.fileName || '(No file)'}</span>
          </div>
        ` : `
          <input type="text" class="row-value code-font" placeholder="Value" value="${escapeHTML(item.value)}" autocomplete="off">
        `}
      </td>
      ${isFormData ? `
        <td>
          <select class="row-type-select" style="font-size: 11px; padding: 4px;">
            <option value="text" ${item.type !== 'file' ? 'selected' : ''}>Text</option>
            <option value="file" ${isFile ? 'selected' : ''}>File</option>
          </select>
        </td>
      ` : `
        <td>
          <input type="text" class="row-desc" placeholder="Description" value="${escapeHTML(item.description || '')}">
        </td>
      `}
      <td>
        <button class="icon-btn row-delete-btn"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    `;

    // Row interaction events
    const checkbox = row.querySelector('.row-checkbox');
    const keyInput = row.querySelector('.row-key');
    const valInput = row.querySelector('.row-value');
    const fileInput = row.querySelector('.row-file-input');
    const typeSelect = row.querySelector('.row-type-select');
    const descInput = row.querySelector('.row-desc');
    const deleteBtn = row.querySelector('.row-delete-btn');

    checkbox.addEventListener('change', () => syncRowDataToTab(tableType));
    keyInput.addEventListener('input', () => {
      // Auto append row if typing on the last row key
      if (index === items.length - 1 && keyInput.value !== '') {
        appendEmptyRow(tableType);
      }
      syncRowDataToTab(tableType);
    });

    if (valInput) {
      valInput.addEventListener('input', () => {
        if (index === items.length - 1 && valInput.value !== '') {
          appendEmptyRow(tableType);
        }
        syncRowDataToTab(tableType);
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = function(evt) {
            item.fileData = evt.target.result; // base64 encoded
            item.fileName = file.name;
            row.querySelector('.file-info-text').innerText = file.name;
            syncRowDataToTab(tableType);
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        item.type = typeSelect.value;
        item.value = '';
        item.fileData = '';
        item.fileName = '';
        renderKeyValueTable(tableType, items);
        syncRowDataToTab(tableType);
      });
    }

    if (descInput) {
      descInput.addEventListener('input', () => syncRowDataToTab(tableType));
    }

    deleteBtn.addEventListener('click', () => {
      row.remove();
      syncRowDataToTab(tableType);
    });

    tbody.appendChild(row);
  });
}

function appendEmptyRow(tableType) {
  const tbody = document.getElementById(`${tableType}-table-body`);
  if (!tbody) return;

  const currentRows = getRowsDataFromTable(tableType);
  currentRows.push({ key: '', value: '', enabled: true, description: '' });
  renderKeyValueTable(tableType, currentRows);
}

function getRowsDataFromTable(tableType) {
  const tbody = document.getElementById(`${tableType}-table-body`);
  if (!tbody) return [];

  const rows = [];
  tbody.querySelectorAll('tr').forEach(tr => {
    const enabled = tr.querySelector('.row-checkbox').checked;
    const key = tr.querySelector('.row-key').value.trim();
    const typeSelect = tr.querySelector('.row-type-select');
    const fileInput = tr.querySelector('.row-file-input');

    let value = '';
    let type = 'text';
    let fileData = '';
    let fileName = '';
    let description = '';

    if (typeSelect) {
      type = typeSelect.value;
      if (type === 'file') {
        const fileInfo = tr.querySelector('.file-info-text');
        fileName = fileInfo ? fileInfo.innerText : '';
        // If file input has cached fileData, we preserve it
        const originalIndex = Array.from(tbody.children).indexOf(tr);
        const activeTab = getActiveTab();
        if (activeTab && activeTab[tableType] && activeTab[tableType][originalIndex]) {
          fileData = activeTab[tableType][originalIndex].fileData || '';
        }
      } else {
        value = tr.querySelector('.row-value').value;
      }
    } else {
      const valElem = tr.querySelector('.row-value');
      value = valElem ? valElem.value : '';
      const descElem = tr.querySelector('.row-desc');
      description = descElem ? descElem.value : '';
    }

    // Only save row if key is not empty or value is not empty (except for empty row placeholder)
    if (key || value || fileName) {
      rows.push({ key, value, enabled, description, type, fileData, fileName });
    }
  });

  return rows;
}

function syncRowDataToTab(tableType) {
  const activeTab = getActiveTab();
  if (!activeTab) return;

  const data = getRowsDataFromTable(tableType);

  if (tableType === 'params') {
    // Sync table parameters back to URL bar!
    const updatedUrl = rebuildUrlFromParams(document.getElementById('request-url').value, data);
    document.getElementById('request-url').value = updatedUrl;
    activeTab.url = updatedUrl;
  } else if (tableType === 'headers') {
    activeTab.headers = data;
    updateHeadersCountBadge();
  } else if (tableType === 'formdata') {
    activeTab.formdata = data;
  } else if (tableType === 'urlencoded') {
    activeTab.urlencoded = data;
  }

  saveTabsState();
}

function updateHeadersCountBadge() {
  const activeTab = getActiveTab();
  const count = activeTab && activeTab.headers ? activeTab.headers.filter(h => h.key !== '').length : 0;
  document.getElementById('header-badge-count').innerText = count;
}

/**
 * Query Params Bidirectional Sync Helpers
 */
function parseUrlParams(urlStr) {
  if (!urlStr) return [];
  const params = [];
  const queryIndex = urlStr.indexOf('?');
  if (queryIndex !== -1) {
    const queryString = urlStr.substring(queryIndex + 1);
    const pairs = queryString.split('&');
    pairs.forEach(pair => {
      if (!pair) return;
      const [key, value] = pair.split('=');
      params.push({
        key: decodeURIComponent(key || ''),
        value: decodeURIComponent(value || ''),
        enabled: true,
        description: ''
      });
    });
  }
  return params;
}

function rebuildUrlFromParams(currentUrl, paramsList) {
  const urlBase = currentUrl.split('?')[0];
  const queryParts = [];
  paramsList.forEach(p => {
    if (p.enabled && p.key) {
      queryParts.push(`${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`);
    }
  });
  return queryParts.length > 0 ? `${urlBase}?${queryParts.join('&')}` : urlBase;
}

/**
 * Core UI listeners setup
 */
function setupAppEventListeners() {
  // Method change
  document.getElementById('request-method').addEventListener('change', (e) => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.method = e.target.value;
      saveTabsState();
      renderTabsUI();
    }
  });

  // URL edit triggers param parsing
  document.getElementById('request-url').addEventListener('input', (e) => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.url = e.target.value;
      saveTabsState();
      // Parse query params and update table
      renderKeyValueTable('params', parseUrlParams(e.target.value));
    }
  });

  // Send request action
  document.getElementById('btn-send-request').addEventListener('click', sendActiveRequest);

  // New Tab Btn
  document.getElementById('btn-add-tab').addEventListener('click', () => createNewTab());

  // Configuration Panes toggles
  document.querySelectorAll('.config-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.config-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.config-pane').forEach(p => p.classList.remove('active'));
      
      tabBtn.classList.add('active');
      const paneId = `config-pane-${tabBtn.dataset.config}`;
      document.getElementById(paneId).classList.add('active');

      // Refresh Ace editor layout if visible (necessary for sizes recomputes)
      bodyEditor.resize();
      preRequestEditor.resize();
      testsEditor.resize();
      
      // Load table data if specific key-value options opened
      const activeTab = getActiveTab();
      if (tabBtn.dataset.config === 'body' && activeTab) {
        if (activeTab.bodyType === 'form-data') {
          renderKeyValueTable('formdata', activeTab.formdata || []);
        } else if (activeTab.bodyType === 'urlencoded') {
          renderKeyValueTable('urlencoded', activeTab.urlencoded || []);
        }
      }
    });
  });

  // Auth fields sync
  document.getElementById('auth-type').addEventListener('change', (e) => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.auth.type = e.target.value;
      if (e.target.value === 'oauth2') {
        ensureOAuthSessionId(activeTab.auth);
        activeTab.auth.oauthGrantType = activeTab.auth.oauthGrantType || 'client_credentials';
        activeTab.auth.oauthClientAuth = activeTab.auth.oauthClientAuth || 'body';
      }
      saveTabsState();
      toggleAuthPaneFields(e.target.value);
    }
  });

  // Auth fields content sync
  const authFields = ['auth-bearer-token', 'auth-basic-username', 'auth-basic-password', 'auth-apikey-key', 'auth-apikey-value', 'auth-apikey-in'];
  authFields.forEach(f => {
    document.getElementById(f).addEventListener('input', () => {
      const activeTab = getActiveTab();
      if (activeTab) {
        activeTab.auth.bearerToken = document.getElementById('auth-bearer-token').value;
        activeTab.auth.username = document.getElementById('auth-basic-username').value;
        activeTab.auth.password = document.getElementById('auth-basic-password').value;
        activeTab.auth.key = document.getElementById('auth-apikey-key').value;
        activeTab.auth.value = document.getElementById('auth-apikey-value').value;
        activeTab.auth.in = document.getElementById('auth-apikey-in').value;
        saveTabsState();
      }
    });

    const oauthConfigFields = {
      'oauth-grant-type': 'oauthGrantType',
      'oauth-client-id': 'oauthClientId',
      'oauth-token-url': 'oauthTokenUrl',
      'oauth-authorization-url': 'oauthAuthorizationUrl',
      'oauth-redirect-url': 'oauthRedirectUrl',
      'oauth-scope': 'oauthScope',
      'oauth-client-auth': 'oauthClientAuth'
    };
    Object.entries(oauthConfigFields).forEach(([elementId, authKey]) => {
      document.getElementById(elementId).addEventListener('input', event => {
        const activeTab = getActiveTab();
        if (!activeTab) return;
        activeTab.auth[authKey] = event.target.value;
        ensureOAuthSessionId(activeTab.auth);
        if (authKey === 'oauthGrantType') updateOAuthGrantFields(event.target.value);
        saveTabsState();
      });
      document.getElementById(elementId).addEventListener('change', event => {
        const activeTab = getActiveTab();
        if (!activeTab) return;
        activeTab.auth[authKey] = event.target.value;
        ensureOAuthSessionId(activeTab.auth);
        if (authKey === 'oauthGrantType') updateOAuthGrantFields(event.target.value);
        saveTabsState();
      });
    });
    [
      ['oauth-client-secret', 'oauthClientSecret'],
      ['oauth-username', 'oauthUsername'],
      ['oauth-password', 'oauthPassword']
    ].forEach(([elementId, secretKey]) => {
      document.getElementById(elementId).addEventListener('input', event => {
        const activeTab = getActiveTab();
        if (!activeTab) return;
        ensureOAuthSessionId(activeTab.auth);
        saveOAuthSecret(activeTab.auth, secretKey, event.target.value);
        saveTabsState();
      });
    });
    document.getElementById('btn-oauth-get-token').addEventListener('click', async event => {
      const activeTab = getActiveTab();
      if (!activeTab) return;
      const button = event.currentTarget;
      button.disabled = true;
      document.getElementById('oauth-token-status').textContent = 'Requesting token...';
      try {
        await acquireOAuthToken(activeTab.auth, true, true);
        document.getElementById('oauth-token-status').textContent = 'Token acquired for this session';
        saveTabsState();
      } catch (error) {
        document.getElementById('oauth-token-status').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  });

  // Body raw options change
  document.getElementsByName('body-type').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const activeTab = getActiveTab();
      if (activeTab) {
        activeTab.bodyType = e.target.value;
        saveTabsState();
        toggleBodyPane(e.target.value);
        
        if (e.target.value === 'form-data') {
          renderKeyValueTable('formdata', activeTab.formdata || []);
        } else if (e.target.value === 'urlencoded') {
          renderKeyValueTable('urlencoded', activeTab.urlencoded || []);
        }
      }
    });
  });

  document.getElementById('body-raw-type').addEventListener('change', (e) => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.bodyRawType = e.target.value;
      saveTabsState();
      
      // Update Ace editor highlighter mode
      if (e.target.value === 'application/json') {
        bodyEditor.session.setMode('ace/mode/json');
      } else if (e.target.value === 'application/xml') {
        bodyEditor.session.setMode('ace/mode/xml');
      } else if (e.target.value === 'text/html') {
        bodyEditor.session.setMode('ace/mode/html');
      } else {
        bodyEditor.session.setMode('ace/mode/text');
      }
    }
  });

  // Table add-row button listeners
  document.querySelectorAll('.add-row-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tableType = btn.dataset.table;
      appendEmptyRow(tableType);
      syncRowDataToTab(tableType);
    });
  });

  // Snippets Generator Modal Logic
  let snippetEditor = null;
  document.getElementById('btn-export-curl').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    document.getElementById('snippet-modal').classList.remove('hidden');
    
    if (!snippetEditor) {
      snippetEditor = ace.edit("snippet-editor");
      snippetEditor.setTheme("ace/theme/tomorrow_night_eighties");
      snippetEditor.session.setMode("ace/mode/sh");
      snippetEditor.setOptions({ readOnly: true, highlightActiveLine: false, highlightGutterLine: false, showPrintMargin: false });
    }
    
    // Trigger render
    document.getElementById('snippet-lang-select').dispatchEvent(new Event('change'));
  });
  
  document.getElementById('close-snippet-modal').addEventListener('click', () => {
    document.getElementById('snippet-modal').classList.add('hidden');
  });
  
  document.getElementById('snippet-lang-select').addEventListener('change', (e) => {
    const tab = getActiveTab();
    if (!tab || !snippetEditor) return;
    
    const lang = e.target.value;
    let code = '';
    
    if (lang === 'curl' && typeof window.generateCurl === 'function') {
      code = window.generateCurl(tab);
      snippetEditor.session.setMode("ace/mode/sh");
    } else if (lang === 'python' && typeof window.generatePython === 'function') {
      code = window.generatePython(tab);
      snippetEditor.session.setMode("ace/mode/python");
    } else if (lang === 'node' && typeof window.generateNode === 'function') {
      code = window.generateNode(tab);
      snippetEditor.session.setMode("ace/mode/javascript");
    }
    
    snippetEditor.setValue(code, -1);
  });
  
  document.getElementById('btn-copy-snippet').addEventListener('click', () => {
    if (snippetEditor) {
      navigator.clipboard.writeText(snippetEditor.getValue()).then(() => {
        const btn = document.getElementById('btn-copy-snippet');
        const originalText = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
        setTimeout(() => { btn.innerHTML = originalText; }, 1500);
      });
    }
  });

  // Snippets click injectors
  document.querySelectorAll('.snippet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const snipType = btn.dataset.snippet;
      const target = btn.dataset.snippetTarget === 'pre-request' ? preRequestEditor : testsEditor;
      let codeToInject = '';
      
      switch(snipType) {
        case 'set-env':
          codeToInject = btn.dataset.snippetTarget === 'pre-request'
            ? `pm.environment.set("access_token", "replace-with-token");\n`
            : `pm.environment.set("jwt_token", pm.response.json().token);\n`;
          break;
        case 'set-global':
          codeToInject = `pm.globals.set("run_id", Date.now());\n`;
          break;
        case 'timestamp':
          codeToInject = `pm.variables.set("timestamp", new Date().toISOString());\n`;
          break;
        case 'random-id':
          codeToInject = `pm.variables.set("requestId", Math.random().toString(36).slice(2));\n`;
          break;
        case 'add-header':
          codeToInject = `pm.request.headers.add({ key: "X-Request-Id", value: pm.variables.get("requestId") || "example-id" });\n`;
          break;
        case 'status-200':
          codeToInject = `pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});\n`;
          break;
        case 'json-val':
          codeToInject = `pm.test("Response body matches JSON values", function () {\n    var jsonData = pm.response.json();\n    pm.expect(jsonData.id).to.eql(100);\n});\n`;
          break;
        case 'contains-string':
          codeToInject = `pm.test("Body matches string check", function () {\n    pm.expect(pm.response.text()).to.include("success_token");\n});\n`;
          break;
        case 'response-time':
          codeToInject = `pm.test("Response latency is less than 200ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(200);\n});\n`;
          break;
        case 'content-type':
          codeToInject = `pm.test("Response is JSON", function () {\n    pm.expect(pm.response.headers.get("content-type")).to.include("application/json");\n});\n`;
          break;
      }
      
      const session = target.getSession();
      session.insert({ row: session.getLength(), column: 0 }, codeToInject);
      target.focus();
    });
  });

  // Response UI Tab Switchers
  document.querySelectorAll('.response-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.response-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.response-pane').forEach(p => p.classList.remove('active'));
      
      tabBtn.classList.add('active');
      const paneId = `resp-pane-${tabBtn.dataset.respTab}`;
      document.getElementById(paneId).classList.add('active');

      if (tabBtn.dataset.respTab === 'body') {
        document.getElementById('resp-body-controls').classList.remove('hidden');
        responseEditor.resize();
      } else {
        document.getElementById('resp-body-controls').classList.add('hidden');
      }
    });
  });

  // Pretty/Raw/Preview format settings
  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.resp-format-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const format = btn.dataset.format;
      document.getElementById(`resp-${format}-pane`).classList.add('active');
      
      if (format === 'pretty') {
        responseEditor.resize();
      }
    });
  });

  // Sidebar Tab Switchers
  document.querySelectorAll('.sidebar-nav-tabs .nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-nav-tabs .nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(`pane-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Global environment dropdown selection
  document.getElementById('active-env-select').addEventListener('change', (e) => {
    activeEnvId = e.target.value;
    localStorage.setItem('workspace_active_tab', activeTabId); // force saving state
    populateRunnerSelects();
  });

  // Clear History
  const clearHistBtn = document.getElementById('btn-clear-history');
  if (clearHistBtn) {
    clearHistBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear your requests history?')) {
        localStorage.removeItem('history');
        renderHistoryList();
      }
    });
  }

  // Bind key elements for modal windows exits
  document.querySelectorAll('.modal-close-btn, .modal-close-action').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    });
  });
}

function toggleAuthPaneFields(authType) {
  document.querySelectorAll('.auth-form-fields').forEach(f => f.classList.add('hidden'));
  document.getElementById('auth-none-fields').classList.add('hidden');
  
  if (authType === 'none') {
    document.getElementById('auth-none-fields').classList.remove('hidden');
  } else {
    document.getElementById(`auth-${authType}-fields`).classList.remove('hidden');
  }
}

function updateOAuthGrantFields(grantType) {
  const authorizationCode = grantType === 'authorization_code' || grantType === 'authorization_code_pkce';
  const needsPassword = grantType === 'password';
  document.getElementById('oauth-authorization-url-group').classList.toggle('hidden', !authorizationCode);
  document.getElementById('oauth-redirect-url-group').classList.toggle('hidden', !authorizationCode);
  document.getElementById('oauth-password-group').classList.toggle('hidden', !needsPassword);
  document.getElementById('oauth-client-secret-group').classList.toggle('hidden', grantType === 'authorization_code_pkce');
  document.getElementById('oauth-client-auth-group').classList.toggle('hidden', grantType === 'authorization_code_pkce');
}

function toggleBodyPane(bodyType) {
  document.querySelectorAll('.body-type-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`body-pane-${bodyType}`).classList.add('active');

  const rawSelect = document.getElementById('body-raw-type');
  if (bodyType === 'raw') {
    rawSelect.classList.remove('hidden');
  } else {
    rawSelect.classList.add('hidden');
  }
}

/**
 * Dev Console Capture
 */
function setupConsoleEventListeners() {
  const trigger = document.getElementById('btn-toggle-console');
  const panel = document.getElementById('dev-console-panel');
  const closeBtn = document.getElementById('btn-close-console');
  const clearBtn = document.getElementById('btn-clear-console');

  trigger.addEventListener('click', () => {
    panel.classList.toggle('hidden');
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  clearBtn.addEventListener('click', () => {
    devConsoleLogs = [];
    renderConsoleLogs();
  });
}

function appendConsoleLogs(newLogs = []) {
  devConsoleLogs = [...devConsoleLogs, ...newLogs];
  renderConsoleLogs();
}

function renderConsoleLogs() {
  const container = document.getElementById('console-logs-container');
  const countBadge = document.getElementById('console-log-count');
  if (!container) return;

  countBadge.innerText = devConsoleLogs.length;

  if (devConsoleLogs.length === 0) {
    container.innerHTML = `<div class="console-empty">Console is clean. Run requests with console.log() to see output.</div>`;
    return;
  }

  container.innerHTML = '';
  devConsoleLogs.forEach(log => {
    const row = document.createElement('div');
    row.className = 'console-log-row';
    
    row.innerHTML = `
      <span class="console-log-time">${log.time}</span>
      <span class="console-log-type log-${log.type}">${log.type}</span>
      <pre class="console-log-msg">${escapeHTML(log.message)}</pre>
    `;
    container.appendChild(row);
  });

  // Auto scroll
  container.scrollTop = container.scrollHeight;
}

/**
 * Environment Variables resolution variables injection before dispatching requests
 */
function getActiveEnvironmentSnapshot() {
  const snapshot = {};
  if (activeEnvId !== 'globals') {
    const env = environments.find(e => e.id === activeEnvId);
    if (env && env.variables) {
      env.variables.forEach(v => {
        if (v.enabled !== false) snapshot[v.key] = v.value || '';
      });
    }
  }
  return snapshot;
}

function resolveTextVariables(text, envSnapshot, localVariables = {}) {
  if (typeof text !== 'string') return text;
  
  // Combines environment snapshot + globals snapshot for matching
  const allVars = { ...globals, ...envSnapshot, ...localVariables };

  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (trimmedKey in allVars) return allVars[trimmedKey];
    return match;
  });
}

function getSavedCollectionVariables(tab) {
  const collection = tab && tab.savedCollectionId
    ? collections.find(item => String(item.id) === String(tab.savedCollectionId))
    : null;
  const stored = collection && collection.variables;
  if (Array.isArray(stored)) {
    return stored.reduce((values, variable) => {
      if (variable.enabled !== false && variable.key) values[variable.key] = variable.value || '';
      return values;
    }, {});
  }
  return stored && typeof stored === 'object' ? { ...stored } : {};
}

/**
 * API Requests Dispatch Engine
 */
async function sendActiveRequest() {
  const tab = getActiveTab();
  if (!tab) return;
  const existingController = activeRequestControllers.get(tab.id);
  if (existingController) {
    existingController.abort();
    return;
  }

  const urlInput = document.getElementById('request-url').value.trim();
  if (!urlInput) {
    alert('Please enter a target URL.');
    return;
  }
  const engine = document.getElementById('request-engine').value;
  const controller = new AbortController();
  const start = Date.now();
  let responseData = null;
  activeRequestControllers.set(tab.id, controller);
  tab.response = null;
  tab.testResults = null;

  updateSendButtonState(tab.id);
  renderTabsUI();

  try {
  // Clear previous response panels
  document.getElementById('response-empty-state').classList.add('hidden');
  document.getElementById('response-content-area').classList.add('hidden');
  document.getElementById('response-metadata').classList.add('hidden');

  // Load environment states
  const envSnapshot = getActiveEnvironmentSnapshot();
  let requestGlobals = { ...globals };
  let requestEnv = { ...envSnapshot };
  let requestCollectionVariables = getSavedCollectionVariables(tab);
  let requestLocalVariables = {};
  let preScriptResults = [];
  let requestUrl = urlInput;
  let requestMethod = tab.method;
  let requestBodyType = tab.bodyType;
  let requestHeaders = getFlatHeadersObject(getRowsDataFromTable('headers'));
  let requestBody = requestBodyType === 'raw'
    ? bodyEditor.getValue()
    : requestBodyType === 'form-data'
      ? getRowsDataFromTable('formdata')
      : requestBodyType === 'urlencoded'
        ? getRowsDataFromTable('urlencoded')
        : '';

  // 1. Evaluate Pre-request scripts
  if (tab.preRequestScript && tab.preRequestScript.trim() !== '') {
    appendConsoleLogs([{ type: 'info', message: `=== Pre-request Script execution: "${tab.name}" ===`, time: new Date().toLocaleTimeString() }]);
    
    const preSandboxResult = await runScriptSandbox(tab.preRequestScript, {
      globals: requestGlobals,
      environment: requestEnv,
      collectionVariables: requestCollectionVariables,
      localVariables: requestLocalVariables,
      sendRequest: options => executeScriptRequest(options, engine, controller.signal),
      request: {
        url: requestUrl,
        method: requestMethod,
        headers: requestHeaders,
        body: requestBody,
        bodyType: requestBodyType
      }
    });

    // Capture outputs
    requestGlobals = preSandboxResult.globals;
    requestEnv = preSandboxResult.environment;
    requestCollectionVariables = preSandboxResult.collectionVariables;
    requestLocalVariables = preSandboxResult.localVariables;
    preScriptResults = preSandboxResult.testResults;
    requestUrl = preSandboxResult.request.url || requestUrl;
    requestMethod = preSandboxResult.request.method || requestMethod;
    requestHeaders = preSandboxResult.request.headers || requestHeaders;
    requestBody = preSandboxResult.request.body;
    requestBodyType = preSandboxResult.request.bodyType || requestBodyType;
    appendConsoleLogs(preSandboxResult.logs);
  }

  // Resolve double curly braces
  const variableSnapshot = {
    ...requestCollectionVariables,
    ...requestEnv,
    ...requestLocalVariables
  };
  let resolvedUrl = resolveTextVariables(requestUrl, requestEnv, variableSnapshot);
  const resolvedHeaders = resolveHeadersObject(requestHeaders, requestEnv, variableSnapshot);
  
  // Format body parameters
  let resolvedBody = null;
  if (requestBodyType === 'raw') {
    resolvedBody = resolveTextVariables(requestBody, requestEnv, variableSnapshot);
  } else if (requestBodyType === 'urlencoded') {
    resolvedBody = getFlatBodyParams(Array.isArray(requestBody) ? requestBody : getRowsDataFromTable('urlencoded'), { ...requestEnv, ...variableSnapshot });
  } else if (requestBodyType === 'form-data') {
    resolvedBody = getFlatBodyParams(Array.isArray(requestBody) ? requestBody : getRowsDataFromTable('formdata'), { ...requestEnv, ...variableSnapshot });
  }

  try {
    if (tab.auth.type === 'oauth2') {
      const token = await acquireOAuthToken(tab.auth, false, false, controller.signal);
      resolvedHeaders.Authorization = `Bearer ${token}`;
    } else {
      resolvedUrl = injectAuthorizationToRequest(tab.auth, resolvedHeaders, resolvedUrl, { ...requestEnv, ...variableSnapshot });
    }

    if (engine === 'proxy') {
      const proxyPostUrl = `${window.location.origin}/api/proxy`;
      
      // Form fields format sync if sending form-data through proxy
      let finalProxyBody = resolvedBody;
      const hasContentType = Object.keys(resolvedHeaders).some(k => k.toLowerCase() === 'content-type');
      if (requestBodyType === 'urlencoded' && Array.isArray(resolvedBody)) {
        const params = new URLSearchParams();
        resolvedBody.forEach(item => params.append(item.key, item.value));
        finalProxyBody = params.toString();
        resolvedHeaders['content-type'] = 'application/x-www-form-urlencoded';
      } else if (requestBodyType === 'raw' && resolvedBody && !hasContentType) {
        resolvedHeaders['content-type'] = tab.bodyRawType || 'application/json';
      } else if (requestBodyType === 'form-data' && !hasContentType) {
        // Must explicitly set to trigger multipart handler in proxy
        resolvedHeaders['content-type'] = 'multipart/form-data';
      }

      const response = await fetch(proxyPostUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          url: resolvedUrl,
          method: requestMethod,
          headers: resolvedHeaders,
          body: finalProxyBody
        })
      });

      if (!response.ok) {
        throw new Error(`Proxy error: ${response.statusText}`);
      }

      responseData = await response.json();
    } else {
      // Direct browser connection fetch
      responseData = await executeDirectBrowserRequest(requestMethod, resolvedUrl, resolvedHeaders, resolvedBody, requestBodyType, controller.signal);
    }
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError') {
      responseData = {
        status: 0,
        statusText: 'Request Cancelled',
        headers: {},
        body: 'Request cancelled.',
        time: Date.now() - start,
        size: 0
      };
    } else {
      const directModeHelp = engine === 'direct'
        ? 'Direct Mode uses the browser and cannot bypass the target server’s CORS policy. Oracle Fusion may need to allow this app origin and the request headers/method in its CORS configuration. If you cannot change that configuration, switch to Proxy Mode.'
        : 'Check the target URL and local proxy/server availability.';
      responseData = {
        status: 0,
        statusText: 'Connection Error',
        headers: {},
        body: `Error: ${error.message}\n${directModeHelp}`,
        time: Date.now() - start,
        size: 0
      };
    }
  }

  // 2. Evaluate Test Assertion Script
  let testResults = preScriptResults.slice();
  if (!controller.signal.aborted && tab.testsScript && tab.testsScript.trim() !== '') {
    appendConsoleLogs([{ type: 'info', message: `=== Test Assertions execution: "${tab.name}" ===`, time: new Date().toLocaleTimeString() }]);

    const testSandboxResult = await runScriptSandbox(tab.testsScript, {
      globals: requestGlobals,
      environment: requestEnv,
      collectionVariables: requestCollectionVariables,
      localVariables: requestLocalVariables,
      sendRequest: options => executeScriptRequest(options, engine, controller.signal),
      request: {
        url: resolvedUrl,
        method: requestMethod,
        headers: resolvedHeaders,
        body: resolvedBody
      },
      response: responseData
    });

    // Capture mutations
    requestGlobals = testSandboxResult.globals;
    requestEnv = testSandboxResult.environment;
    requestCollectionVariables = testSandboxResult.collectionVariables;
    requestLocalVariables = testSandboxResult.localVariables;
    testResults.push(...testSandboxResult.testResults);
    appendConsoleLogs(testSandboxResult.logs);
  }

  if (!controller.signal.aborted) {
    globals = requestGlobals;
    saveGlobals();
    updateEnvironmentVariablesMemory(requestEnv);
    const savedCollection = tab.savedCollectionId
      ? collections.find(item => String(item.id) === String(tab.savedCollectionId))
      : null;
    if (savedCollection) {
      savedCollection.variables = requestCollectionVariables;
      saveCollections();
    }
  }

  // Cache response object to tab history
  tab.response = responseData;
  tab.testResults = testResults;
  saveTabsState();

  // Save successful trigger to History Panel
  if (!controller.signal.aborted) {
    logRequestToHistory(requestMethod, resolvedUrl, responseData.status, responseData.time);
  }

  // Render response panels
  if (activeTabId === tab.id) renderResponseUI(responseData, testResults);
  } catch (error) {
    responseData = {
      status: 0,
      statusText: controller.signal.aborted ? 'Request Cancelled' : 'Request Error',
      headers: {},
      body: controller.signal.aborted ? 'Request cancelled.' : `Error: ${error.message}`,
      time: Date.now() - start,
      size: 0
    };
    tab.response = responseData;
    tab.testResults = [];
    saveTabsState();
    if (activeTabId === tab.id) renderResponseUI(responseData, []);
  } finally {
    if (activeRequestControllers.get(tab.id) === controller) {
      activeRequestControllers.delete(tab.id);
    }
    renderTabsUI();
    if (activeTabId === tab.id) updateSendButtonState(tab.id);
  }
}

/**
 * Handle direct fetch dispatch from app.js main thread context
 */
async function executeDirectBrowserRequest(method, url, headers, body, bodyType, signal) {
  const fetchOptions = {
    method: method,
    headers: new Headers(headers),
    mode: 'cors',
    signal
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
        // Base64 file parser
        const matches = item.fileData.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
          const binaryString = atob(matches[2]);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes.buffer], { type: matches[1] });
          formData.append(item.key, blob, item.fileName || 'file');
        }
      } else {
        formData.append(item.key, item.value || '');
      }
    });
    fetchOptions.body = formData;
    fetchOptions.headers.delete('Content-Type'); // Let fetch boundaries do it
  }

  const start = Date.now();
  const response = await fetch(url, fetchOptions);
  const duration = Date.now() - start;

  // Form headers flat object
  const respHeaders = {};
  response.headers.forEach((val, key) => {
    respHeaders[key] = val;
  });

  const responseText = await response.text();
  const size = responseText.length;

  return {
    status: response.status,
    statusText: response.statusText,
    headers: respHeaders,
    body: responseText,
    time: duration,
    size: size
  };
}

async function executeScriptRequest(options, engine, signal) {
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
      if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
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
  if (engine !== 'proxy') {
    return executeDirectBrowserRequest(method, url, headers, body, bodyType, signal);
  }

  if (bodyType === 'urlencoded' && Array.isArray(body)) {
    const params = new URLSearchParams();
    body.forEach(item => params.append(item.key, item.value || ''));
    body = params.toString();
  }
  const response = await fetch(`${window.location.origin}/api/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ url, method, headers, body })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `Proxy error: ${response.statusText}`);
  return result;
}

function oauthBase64Url(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function requestOAuthAuthorizationCode(auth) {
  if (!auth.oauthAuthorizationUrl) throw new Error('Enter an Authorization URL first.');
  const popup = window.open('about:blank', 'expresspost-oauth', 'width=700,height=800');
  if (!popup) throw new Error('The authorization popup was blocked. Allow popups and try again.');

  const state = oauthBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  const pkce = auth.oauthGrantType === 'authorization_code_pkce';
  const verifier = pkce ? oauthBase64Url(crypto.getRandomValues(new Uint8Array(32))) : '';
  const redirectUri = auth.oauthRedirectUrl || `${window.location.origin}/oauth/callback`;
  const callbackUrl = new URL(redirectUri);
  if (callbackUrl.origin !== window.location.origin || callbackUrl.pathname !== '/oauth/callback') {
    throw new Error('Redirect URI must use this app’s /oauth/callback route.');
  }
  const authorizationUrl = new URL(auth.oauthAuthorizationUrl);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', auth.oauthClientId || '');
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('state', state);
  if (auth.oauthScope) authorizationUrl.searchParams.set('scope', auth.oauthScope);
  if (pkce) {
    const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    authorizationUrl.searchParams.set('code_challenge', oauthBase64Url(new Uint8Array(challenge)));
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  }

  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, code) => {
      if (finished) return;
      finished = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closeCheck);
      clearTimeout(timeout);
      if (!popup.closed) popup.close();
      if (error) reject(error);
      else resolve({ code, verifier, redirectUri });
    };
    const onMessage = event => {
      if (event.origin !== window.location.origin || event.source !== popup ||
          !event.data || event.data.type !== 'expresspost-oauth-callback') return;
      const params = event.data.params || {};
      if (params.state !== state) return finish(new Error('OAuth state validation failed.'));
      if (params.error) return finish(new Error(`Authorization failed: ${params.error_description || params.error}`));
      if (!params.code) return finish(new Error('The identity provider did not return an authorization code.'));
      finish(null, params.code);
    };
    const closeCheck = setInterval(() => {
      if (popup.closed) finish(new Error('Authorization window was closed before a code was received.'));
    }, 500);
    const timeout = setTimeout(() => finish(new Error('OAuth authorization timed out.')), 5 * 60 * 1000);
    window.addEventListener('message', onMessage);
    popup.location.href = authorizationUrl.toString();
  });
}

async function requestOAuthToken(auth, parameters, signal) {
  if (!auth.oauthTokenUrl) throw new Error('Enter a Token URL first.');
  const tokenParameters = new URLSearchParams(parameters);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (auth.oauthGrantType !== 'authorization_code_pkce' && auth.oauthClientAuth === 'basic') {
    if (!auth.oauthClientId || !auth.oauthClientSecret) throw new Error('Enter the OAuth client ID and secret.');
    headers.Authorization = `Basic ${btoa(`${auth.oauthClientId}:${auth.oauthClientSecret}`)}`;
    tokenParameters.delete('client_id');
    tokenParameters.delete('client_secret');
  } else if (auth.oauthClientId) {
    tokenParameters.set('client_id', auth.oauthClientId);
    if (auth.oauthGrantType !== 'authorization_code_pkce' && auth.oauthClientSecret) {
      tokenParameters.set('client_secret', auth.oauthClientSecret);
    }
  }

  const response = await executeScriptRequest({
    url: auth.oauthTokenUrl,
    method: 'POST',
    headers,
    body: tokenParameters.toString()
  }, 'proxy', signal);
  let tokenData;
  try {
    tokenData = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  } catch (error) {
    throw new Error(`OAuth token endpoint returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!tokenData || typeof tokenData !== 'object') {
    throw new Error(`OAuth token endpoint returned an invalid response (HTTP ${response.status}).`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`OAuth token request failed (${response.status}): ${tokenData.error_description || tokenData.error || response.statusText}`);
  }
  if (!tokenData.access_token) throw new Error('OAuth token response did not contain access_token.');
  return tokenData;
}

async function acquireOAuthToken(auth, allowInteractive = false, force = false, signal) {
  if (!auth || auth.type !== 'oauth2') throw new Error('Select OAuth 2.0 authorization first.');
  moveOAuthSecretsToSession(auth);
  ensureOAuthSessionId(auth);
  const hydrated = hydrateOAuthAuth(auth);
  const expiresAt = Number(hydrated.oauthExpiresAt || 0);
  if (!force && hydrated.oauthAccessToken && (!expiresAt || expiresAt > Date.now() + 60000)) {
    return hydrated.oauthAccessToken;
  }

  let parameters;
  if (!force && hydrated.oauthRefreshToken) {
    parameters = { grant_type: 'refresh_token', refresh_token: hydrated.oauthRefreshToken };
  } else if (hydrated.oauthGrantType === 'client_credentials') {
    parameters = { grant_type: 'client_credentials' };
    if (hydrated.oauthScope) parameters.scope = hydrated.oauthScope;
  } else if (hydrated.oauthGrantType === 'password') {
    if (!hydrated.oauthUsername || !hydrated.oauthPassword) throw new Error('Enter the OAuth username and password.');
    parameters = {
      grant_type: 'password',
      username: hydrated.oauthUsername,
      password: hydrated.oauthPassword
    };
    if (hydrated.oauthScope) parameters.scope = hydrated.oauthScope;
  } else if (hydrated.oauthGrantType === 'authorization_code' || hydrated.oauthGrantType === 'authorization_code_pkce') {
    if (!allowInteractive) throw new Error('Click "Get New Access Token" to complete OAuth authorization.');
    const authorization = await requestOAuthAuthorizationCode(hydrated);
    parameters = {
      grant_type: 'authorization_code',
      code: authorization.code,
      redirect_uri: authorization.redirectUri
    };
    if (authorization.verifier) parameters.code_verifier = authorization.verifier;
  } else {
    throw new Error(`Unsupported OAuth grant type: ${hydrated.oauthGrantType}`);
  }

  const tokenData = await requestOAuthToken(hydrated, parameters, signal);
  saveOAuthSecret(auth, 'oauthAccessToken', tokenData.access_token);
  if (tokenData.refresh_token) saveOAuthSecret(auth, 'oauthRefreshToken', tokenData.refresh_token);
  const expiresIn = Number(tokenData.expires_in || 0);
  saveOAuthSecret(auth, 'oauthExpiresAt', expiresIn ? String(Date.now() + expiresIn * 1000) : '');
  return tokenData.access_token;
}

/**
 * Sync variables mutation states back to environments variables
 */
function updateEnvironmentVariablesMemory(envSnapshot) {
  if (activeEnvId !== 'globals') {
    const activeEnv = environments.find(e => e.id === activeEnvId);
    if (activeEnv && activeEnv.variables) {
      activeEnv.variables.forEach(v => {
        if (v.key in envSnapshot) {
          v.value = envSnapshot[v.key];
        }
      });
      saveEnvironments();
    }
  }
}

/**
 * Flat mappings helpers
 */
function getFlatHeadersObject(headersArray) {
  const headers = {};
  headersArray.forEach(h => {
    if (h.enabled && h.key) {
      headers[h.key] = h.value || '';
    }
  });
  return headers;
}

function resolveHeadersObject(headersArray, envSnapshot, localVariables = {}) {
  const headers = {};
  const rows = Array.isArray(headersArray)
    ? headersArray.filter(header => header.enabled !== false && header.key).map(header => [header.key, header.value || ''])
    : Object.entries(headersArray || {});
  rows.forEach(([key, value]) => {
    if (key) {
      const resolvedKey = resolveTextVariables(key, envSnapshot, localVariables);
      const resolvedVal = resolveTextVariables(value || '', envSnapshot, localVariables);
      headers[resolvedKey] = resolvedVal;
    }
  });
  return headers;
}

function getFlatBodyParams(fieldsArray, envSnapshot) {
  return fieldsArray.filter(item => item.enabled !== false && item.key).map(item => {
    return {
      key: resolveTextVariables(item.key, envSnapshot),
      value: resolveTextVariables(item.value || '', envSnapshot),
      type: item.type || 'text',
      fileName: item.fileName || '',
      fileData: item.fileData || ''
    };
  });
}

function injectAuthorizationToRequest(auth, headers, url, envSnapshot) {
  if (!auth || auth.type === 'none') return url;

  if (auth.type === 'bearer' && auth.bearerToken) {
    const token = resolveTextVariables(auth.bearerToken, envSnapshot);
    headers['Authorization'] = `Bearer ${token}`;
  } else if (auth.type === 'basic') {
    const username = resolveTextVariables(auth.username || '', envSnapshot);
    const password = resolveTextVariables(auth.password || '', envSnapshot);
    const encoded = btoa(`${username}:${password}`);
    headers['Authorization'] = `Basic ${encoded}`;
  } else if (auth.type === 'apikey' && auth.key) {
    const key = resolveTextVariables(auth.key, envSnapshot);
    const value = resolveTextVariables(auth.value || '', envSnapshot);
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
 * Render API execution response payloads
 */
function renderResponseUI(resp, testResults) {
  document.getElementById('response-empty-state').classList.add('hidden');
  document.getElementById('response-content-area').classList.remove('hidden');
  
  // Status Code badge styling
  const metadata = document.getElementById('response-metadata');
  metadata.classList.remove('hidden');
  
  const statusBadge = document.getElementById('resp-status');
  statusBadge.innerText = `${resp.status} ${resp.statusText || ''}`;
  statusBadge.className = 'meta-item badge';
  
  if (resp.status >= 200 && resp.status < 300) {
    statusBadge.classList.add('badge-success');
  } else if (resp.status >= 400) {
    statusBadge.classList.add('badge-danger');
  } else {
    statusBadge.classList.add('badge-warning');
  }

  // Metrics
  document.getElementById('resp-time').innerText = `${resp.time || 0} ms`;
  
  // Size format
  let sizeText = '0 B';
  if (resp.size > 1024 * 1024) {
    sizeText = `${(resp.size / (1024 * 1024)).toFixed(2)} MB`;
  } else if (resp.size > 1024) {
    sizeText = `${(resp.size / 1024).toFixed(2)} KB`;
  } else if (resp.size > 0) {
    sizeText = `${resp.size} B`;
  }
  document.getElementById('resp-size').innerText = sizeText;

  // Pretty mode content type formatting
  const rawHeaders = resp.headers || {};
  const contentTypeKey = Object.keys(rawHeaders).find(k => k.toLowerCase() === 'content-type');
  const contentType = contentTypeKey ? rawHeaders[contentTypeKey] : '';

  if (contentType.includes('application/json')) {
    responseEditor.session.setMode('ace/mode/json');
    try {
      const parsedJson = JSON.parse(resp.body);
      responseEditor.setValue(JSON.stringify(parsedJson, null, 4));
    } catch(e) {
      responseEditor.setValue(resp.body || '');
    }
  } else if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    responseEditor.session.setMode('ace/mode/html');
    responseEditor.setValue(resp.body || '');
  } else if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
    responseEditor.session.setMode('ace/mode/xml');
    responseEditor.setValue(resp.body || '');
  } else {
    responseEditor.session.setMode('ace/mode/text');
    responseEditor.setValue(resp.body || '');
  }
  responseEditor.clearSelection();

  // Raw & Preview UI frames
  document.getElementById('response-raw-text').value = resp.body || '';
  
  const iframe = document.getElementById('response-preview-frame');
  iframe.srcdoc = resp.body || '';

  // Headers tables rendering
  const headersBody = document.getElementById('response-headers-body');
  headersBody.innerHTML = '';
  Object.keys(rawHeaders).forEach(key => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="code-font" style="color: var(--text-muted); font-weight: 500;">${key}</td>
      <td class="code-font">${rawHeaders[key]}</td>
    `;
    headersBody.appendChild(row);
  });

  // Tests panel metrics
  renderTestResultsList(testResults);
}

function renderTestResultsList(results = []) {
  const list = document.getElementById('test-results-list');
  const badge = document.getElementById('test-pass-badge');
  const progressBar = document.getElementById('test-progress-bar');
  const progressText = document.getElementById('test-progress-text');

  if (!results || results.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding: 20px;"><p>No tests scripts were evaluated for this request.</p></div>`;
    badge.innerText = '0/0';
    progressBar.style.width = '0%';
    progressText.innerText = '0 / 0 Tests Passed';
    return;
  }

  let passed = 0;
  list.innerHTML = '';
  
  results.forEach(res => {
    if (res.passed) passed++;
    const row = document.createElement('div');
    row.className = `test-result-row ${res.passed ? 'pass' : 'fail'}`;

    row.innerHTML = `
      <span class="test-status-badge">${res.passed ? 'Pass' : 'Fail'}</span>
      <span class="test-desc">${escapeHTML(res.name)}</span>
      ${res.error ? `<span style="font-size: 11px; color: var(--danger); font-family: var(--font-mono);">${escapeHTML(res.error)}</span>` : ''}
    `;
    list.appendChild(row);
  });

  badge.innerText = `${passed}/${results.length}`;
  
  const pct = Math.round((passed / results.length) * 100);
  progressBar.style.width = `${pct}%`;
  progressText.innerText = `${passed} / ${results.length} Tests Passed`;

  if (passed === results.length) {
    progressBar.className = 'progress-bar-fill';
  } else {
    progressBar.className = 'progress-bar-fill fail-red';
  }
}

/**
 * Log Sent Request meta details to history lists
 */
function logRequestToHistory(method, url, status, time) {
  const localHistory = localStorage.getItem('history');
  let historyList = [];
  if (localHistory) {
    try { historyList = JSON.parse(localHistory); } catch(e) { historyList = []; }
  }

  const logItem = {
    id: `history-${Date.now()}`,
    timestamp: new Date().toISOString(),
    method,
    url,
    status,
    time
  };

  historyList.unshift(logItem); // add to top
  // limit history to 50 items
  if (historyList.length > 50) historyList.pop();

  localStorage.setItem('history', JSON.stringify(historyList));
  renderHistoryList();
}

function renderHistoryList() {
  const container = document.getElementById('history-list');
  if (!container) return;

  const localHistory = localStorage.getItem('history');
  let historyList = [];
  if (localHistory) {
    try { historyList = JSON.parse(localHistory); } catch(e) { historyList = []; }
  }

  if (historyList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-clock-rotate-left"></i>
        <p>No requests sent yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  historyList.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    
    let methodClass = 'method-badge-other';
    const method = (item.method || 'GET').toLowerCase();
    if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
      methodClass = `method-badge-${method}`;
    }

    div.innerHTML = `
      <div class="history-details">
        <div style="display: flex; align-items: center; overflow: hidden;">
          <span class="history-method ${methodClass}">${item.method}</span>
          <span class="history-url" title="${item.url}">${item.url}</span>
        </div>
        <span class="history-meta">Status: ${item.status || 'Error'} • Latency: ${item.time || 0}ms</span>
      </div>
    `;

    // Click history item restores values to active request tab
    div.addEventListener('click', () => {
      const activeTab = getActiveTab();
      if (activeTab) {
        activeTab.url = item.url;
        activeTab.method = item.method;
        saveTabsState();
        switchActiveTab(activeTabId);
      }
    });

    container.appendChild(div);
  });
}

/**
 * Environments Manage Modals Setup
 */
let editingEnvId = null;

function setupEnvironmentModalListeners() {
  const quickManage = document.getElementById('quick-env-manage');
  const modal = document.getElementById('modal-env');
  const addVarBtn = document.getElementById('btn-add-env-variable');
  const saveEnvBtn = document.getElementById('btn-save-env-action');
  const newEnvBtn = document.getElementById('btn-new-env');
  const globalsBtn = document.getElementById('btn-manage-globals');

  quickManage.addEventListener('click', () => {
    if (activeEnvId === 'globals') {
      openGlobalsModal();
    } else {
      openEnvironmentModal(activeEnvId);
    }
  });

  newEnvBtn.addEventListener('click', () => {
    openEnvironmentModal(null);
  });

  globalsBtn.addEventListener('click', () => {
    openGlobalsModal();
  });

  addVarBtn.addEventListener('click', () => {
    appendVariableRowToModal('', '', '');
  });

  saveEnvBtn.addEventListener('click', saveModalEnvironmentData);

  renderEnvironmentsList();
  renderHistoryList();
}

function renderEnvironmentsList() {
  const container = document.getElementById('environments-list');
  if (!container) return;

  container.innerHTML = '';
  
  // Render Globals indicator row
  const globalsRow = document.createElement('div');
  globalsRow.className = `env-item ${activeEnvId === 'globals' ? 'active' : ''}`;
  globalsRow.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <i class="fa-solid fa-globe" style="color: var(--primary-hover);"></i>
      <span style="font-weight: 500; font-size: 13px;">System Globals</span>
    </div>
    <button class="icon-btn" onclick="openGlobalsModal()"><i class="fa-solid fa-pen-to-square"></i></button>
  `;
  container.appendChild(globalsRow);

  environments.forEach(env => {
    const div = document.createElement('div');
    div.className = `env-item ${activeEnvId === env.id ? 'active' : ''}`;
    
    div.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;" onclick="setActiveEnvironmentId('${env.id}')">
        <i class="fa-solid fa-server" style="color: var(--text-muted);"></i>
        <span style="font-size: 13px; font-weight: 500;">${escapeHTML(env.name)}</span>
      </div>
      <div>
        <button class="icon-btn" onclick="openEnvironmentModal('${env.id}')"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="icon-btn" onclick="deleteEnvironment('${env.id}')"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;
    container.appendChild(div);
  });
}

window.setActiveEnvironmentId = function(id) {
  activeEnvId = id;
  document.getElementById('active-env-select').value = id;
  renderEnvironmentsList();
  populateRunnerSelects();
};

window.deleteEnvironment = function(id) {
  if (confirm('Are you sure you want to delete this environment?')) {
    environments = environments.filter(e => e.id !== id);
    if (activeEnvId === id) activeEnvId = 'globals';
    saveEnvironments();
    renderEnvironmentsList();
    populateRunnerSelects();
  }
};

function openEnvironmentModal(envId) {
  editingEnvId = envId;
  const modal = document.getElementById('modal-env');
  const title = document.getElementById('env-modal-title');
  const nameInput = document.getElementById('env-name-input');
  const variablesBody = document.getElementById('env-variables-body');

  variablesBody.innerHTML = '';
  nameInput.disabled = false;

  if (envId === null) {
    title.innerText = 'Add New Environment';
    nameInput.value = '';
    appendVariableRowToModal('', '', '');
  } else {
    const env = environments.find(e => e.id === envId);
    if (env) {
      title.innerText = `Edit Environment: ${env.name}`;
      nameInput.value = env.name;
      
      const vars = env.variables || [];
      if (vars.length === 0) {
        appendVariableRowToModal('', '', '');
      } else {
        vars.forEach(v => {
          appendVariableRowToModal(v.key, v.value, v.value, v.enabled !== false);
        });
      }
    }
  }

  modal.classList.add('active');
}

function openGlobalsModal() {
  editingEnvId = 'globals';
  const modal = document.getElementById('modal-env');
  const title = document.getElementById('env-modal-title');
  const nameInput = document.getElementById('env-name-input');
  const variablesBody = document.getElementById('env-variables-body');

  variablesBody.innerHTML = '';
  title.innerText = 'Manage Globals';
  nameInput.value = 'Globals';
  nameInput.disabled = true;

  const keys = Object.keys(globals);
  if (keys.length === 0) {
    appendVariableRowToModal('', '', '');
  } else {
    keys.forEach(k => {
      appendVariableRowToModal(k, globals[k], globals[k], true);
    });
  }

  modal.classList.add('active');
}

function appendVariableRowToModal(key, initialVal, currentVal, enabled = true) {
  const tbody = document.getElementById('env-variables-table');
  const body = document.getElementById('env-variables-body');

  const row = document.createElement('tr');
  row.innerHTML = `
    <td class="checkbox-cell">
      <input type="checkbox" class="var-checkbox" ${enabled ? 'checked' : ''}>
    </td>
    <td>
      <input type="text" class="var-key code-font" placeholder="Variable key" value="${escapeHTML(key)}" autocomplete="off">
    </td>
    <td>
      <input type="text" class="var-initial code-font" placeholder="Initial value" value="${escapeHTML(initialVal)}" autocomplete="off">
    </td>
    <td>
      <input type="text" class="var-current code-font" placeholder="Current value" value="${escapeHTML(currentVal)}" autocomplete="off">
    </td>
    <td>
      <button class="icon-btn var-delete-btn"><i class="fa-solid fa-trash-can"></i></button>
    </td>
  `;

  row.querySelector('.var-delete-btn').addEventListener('click', () => {
    row.remove();
  });

  body.appendChild(row);
}

function saveModalEnvironmentData() {
  const modal = document.getElementById('modal-env');
  const nameVal = document.getElementById('env-name-input').value.trim();
  const rows = document.getElementById('env-variables-body').querySelectorAll('tr');

  if (editingEnvId !== 'globals' && !nameVal) {
    alert('Environment name is required.');
    return;
  }

  const variables = [];
  const globalsUpdate = {};

  rows.forEach(tr => {
    const enabled = tr.querySelector('.var-checkbox').checked;
    const key = tr.querySelector('.var-key').value.trim();
    const initial = tr.querySelector('.var-initial').value;
    const current = tr.querySelector('.var-current').value;

    if (key) {
      if (editingEnvId === 'globals') {
        // Globals saves current value only
        globalsUpdate[key] = current;
      } else {
        variables.push({
          key,
          value: current || initial || '',
          enabled
        });
      }
    }
  });

  if (editingEnvId === 'globals') {
    globals = globalsUpdate;
    saveGlobals();
  } else if (editingEnvId === null) {
    // Create new
    const newId = `env-${Date.now()}`;
    environments.push({
      id: newId,
      name: nameVal,
      variables
    });
    saveEnvironments();
    activeEnvId = newId;
    document.getElementById('active-env-select').value = newId;
  } else {
    // Edit existing
    const env = environments.find(e => e.id === editingEnvId);
    if (env) {
      env.name = nameVal;
      env.variables = variables;
      saveEnvironments();
    }
  }

  renderEnvironmentsList();
  populateRunnerSelects();
  modal.classList.remove('active');
}

/**
 * Save request to collection Modal Sync
 */
function setupSaveModalListeners() {
  const saveBtn = document.getElementById('btn-save-request');
  const confirmBtn = document.getElementById('btn-confirm-save-request');
  const modal = document.getElementById('modal-save-request');

  saveBtn.addEventListener('click', () => {
    const activeTab = getActiveTab();
    if (!activeTab) return;

    // Load Collections select dropdown
    const select = document.getElementById('save-req-collection');
    select.replaceChildren();
    collections.forEach(collection => {
      const option = document.createElement('option');
      option.value = collection.id;
      option.textContent = collection.name;
      select.appendChild(option);
    });
    if (collections.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '(No Collections Available)';
      select.appendChild(option);
    }

    if (activeTab.savedCollectionId && collections.some(c => String(c.id) === String(activeTab.savedCollectionId))) {
      select.value = String(activeTab.savedCollectionId);
    }
    document.getElementById('save-req-name').value = activeTab.name || 'New Request';
    document.getElementById('save-req-desc').value = activeTab.description || '';
    document.querySelector('#modal-save-request .modal-header h2').textContent =
      activeTab.savedRequestId ? 'Update Saved Request' : 'Save Request';
    confirmBtn.textContent = activeTab.savedRequestId ? 'Update' : 'Save';

    modal.classList.add('active');
  });

  confirmBtn.addEventListener('click', () => {
    const collId = document.getElementById('save-req-collection').value;
    const nameVal = document.getElementById('save-req-name').value.trim();
    const descVal = document.getElementById('save-req-desc').value.trim();

    if (!collId) {
      alert('Please select a collection first or create one.');
      return;
    }
    if (!nameVal) {
      alert('Request name is required.');
      return;
    }

    const coll = collections.find(c => String(c.id) === String(collId));
    if (coll) {
      const activeTab = getActiveTab();
      if (activeTab) {
        // Sync URL bar values back to tab memory before saving
        activeTab.url = document.getElementById('request-url').value;
        activeTab.method = document.getElementById('request-method').value;
        activeTab.headers = getRowsDataFromTable('headers');
        
        const sourceCollection = activeTab.savedCollectionId
          ? collections.find(c => String(c.id) === String(activeTab.savedCollectionId))
          : null;
        const sourceRequest = sourceCollection && sourceCollection.requests
          ? sourceCollection.requests.find(r => String(r.id) === String(activeTab.savedRequestId))
          : null;
        const requestId = sourceRequest ? sourceRequest.id : `req-${Date.now()}`;

        // Formulate request object while preserving the original record identity.
        const requestToSave = {
          ...(sourceRequest || {}),
          id: requestId,
          name: nameVal,
          description: descVal,
          method: activeTab.method,
          url: activeTab.url,
          headers: activeTab.headers,
          auth: activeTab.auth,
          bodyType: activeTab.bodyType,
          bodyRawType: activeTab.bodyRawType,
          body: activeTab.body,
          formdata: activeTab.formdata,
          urlencoded: activeTab.urlencoded,
          preRequestScript: activeTab.preRequestScript,
          testsScript: activeTab.testsScript
        };

        coll.requests = coll.requests || [];
        const sameCollection = sourceCollection && String(sourceCollection.id) === String(coll.id);
        const destinationRequest = coll.requests.find(r => String(r.id) === String(requestId));
        if (sameCollection && destinationRequest) {
          Object.assign(destinationRequest, requestToSave);
        } else {
          if (sourceRequest && sourceCollection) {
            sourceCollection.requests = sourceCollection.requests.filter(r => String(r.id) !== String(requestId));
          }
          if (destinationRequest) {
            Object.assign(destinationRequest, requestToSave);
          } else {
            coll.requests.push(requestToSave);
          }
        }
        saveCollections();
        
        activeTab.savedCollectionId = coll.id;
        activeTab.savedRequestId = requestId;
        activeTab.description = descVal;
        activeTab.name = nameVal;
        saveTabsState();
        renderTabsUI();
        renderCollections();
        populateRunnerSelects();
        
        modal.classList.remove('active');
        document.querySelector('#modal-save-request .modal-header h2').textContent = 'Save Request';
        confirmBtn.textContent = 'Save';
      }
    }
  });

  // Handle Collection Creation sidebar btn
  document.getElementById('btn-new-collection').addEventListener('click', () => {
    const name = prompt('Enter Collection Name:');
    if (name && name.trim()) {
      const newColl = {
        id: `coll-${Date.now()}`,
        name: name.trim(),
        requests: []
      };
      collections.push(newColl);
      saveCollections();
      renderCollections();
      populateRunnerSelects();
    }
  });

  // Import Collection Handler
  const importBtn = document.getElementById('btn-import-collection');
  const importInput = document.getElementById('file-import-input');
  
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const data = JSON.parse(evt.target.result);
        
        // Compatibility check: Standard Postman JSON vs our format
        let importedColl = null;
        if (data.info && data.item) {
          // Postman v2/v2.1 import parser
          importedColl = parsePostmanCollection(data);
        } else if (data.name && Array.isArray(data.requests)) {
          // Direct format import
          importedColl = data;
        }

        if (importedColl) {
          (importedColl.requests || []).forEach(request => {
            if (request.auth && request.auth.type === 'oauth2') request.auth = removeOAuthSecrets(request.auth);
          });
          collections.push(importedColl);
          saveCollections();
          renderCollections();
          populateRunnerSelects();
          alert(`Successfully imported collection: "${importedColl.name}"`);
        } else {
          alert('Could not parse JSON. Make sure it is a valid Postman collection export.');
        }
      } catch (err) {
        alert(`Error importing file: ${err.message}`);
      }
    };
    reader.readAsText(file);
    importInput.value = ''; // clear
  });

  // Setup sidebar tree deletions & request loadings
  const sidebarContainer = document.getElementById('collections-list');
  sidebarContainer.addEventListener('click', (e) => {
    const target = e.target;

    const exportCollBtn = target.closest('.btn-export-coll');
    if (exportCollBtn) {
      e.stopPropagation();
      exportCollection(exportCollBtn.dataset.id);
      return;
    }
    
    // 1. Delete Collection
    const delCollBtn = target.closest('.btn-delete-coll');
    if (delCollBtn) {
      e.stopPropagation();
      const id = delCollBtn.dataset.id;
      if (confirm('Are you sure you want to delete this collection and all its requests?')) {
        collections = collections.filter(c => c.id !== id);
        saveCollections();
        renderCollections();
        populateRunnerSelects();
      }
      return;
    }

    // 2. Add empty request directly to collection
    const addReqBtn = target.closest('.btn-add-req-to-coll');
    if (addReqBtn) {
      e.stopPropagation();
      const collId = addReqBtn.dataset.id;
      const name = prompt('Enter Request Name:');
      if (name && name.trim()) {
        const coll = collections.find(c => c.id === collId);
        if (coll) {
          coll.requests = coll.requests || [];
          coll.requests.push({
            id: `req-${Date.now()}`,
            name: name.trim(),
            method: 'GET',
            url: '',
            headers: [{ key: '', value: '', enabled: true, description: '' }],
            auth: { type: 'none' },
            bodyType: 'none',
            body: '',
            formdata: [],
            urlencoded: [],
            preRequestScript: '',
            testsScript: ''
          });
          saveCollections();
          renderCollections();
          populateRunnerSelects();
        }
      }
      return;
    }

    // 3. Open collection directly in Collection Runner
    const runCollBtn = target.closest('.btn-run-coll-direct');
    if (runCollBtn) {
      e.stopPropagation();
      const collId = runCollBtn.dataset.id;
      document.getElementById('btn-open-runner').click();
      document.getElementById('runner-select-collection').value = collId;
      return;
    }

    // 4. Delete request is handled by direct event listeners in runner.js

    // 5. Load request from sidebar into workspace tabs
    const reqItem = target.closest('.coll-req-item');
    if (reqItem) {
      const reqId = reqItem.dataset.id;
      const collId = reqItem.dataset.collId;
      const coll = collections.find(c => String(c.id) === String(collId));
      if (coll && coll.requests) {
        const req = coll.requests.find(r => String(r.id) === String(reqId));
        if (req) {
          createNewTab({
            ...req,
            savedCollectionId: coll.id,
            savedRequestId: req.id,
            formdata: req.formdata || req.formData || [],
            description: req.description || ''
          });
        }
      }
    }
  });
}

function exportCollection(collectionId) {
  const collection = collections.find(item => String(item.id) === String(collectionId));
  if (!collection) return;
  const safeCollection = stripCollectionCredentials(collection);
  const blob = new Blob([JSON.stringify(safeCollection, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `${(collection.name || 'collection').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function stripCollectionCredentials(collection) {
  const safeCollection = stripOAuthSecrets(collection);
  const isVariableReference = value => typeof value === 'string' && /^\{\{[^}]+\}\}$/.test(value.trim());
  (safeCollection.requests || []).forEach(request => {
    const auth = request.auth || {};
    if (auth.type === 'bearer' && !isVariableReference(auth.bearerToken)) auth.bearerToken = '';
    if (auth.type === 'basic') auth.password = '';
    if (auth.type === 'apikey' && !isVariableReference(auth.value)) auth.value = '';
    (Array.isArray(request.headers) ? request.headers : []).forEach(header => {
      if (/^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(header.key || '') ||
          /(api[-_]?key|token|secret|password)/i.test(header.key || '')) {
        if (!isVariableReference(header.value)) header.value = '';
      }
    });
  });
  return safeCollection;
}

/**
 * Compatible Parser: Translates Postman Schema (v2.1) to ExpressPost internal structure
 */
function parsePostmanCollection(postmanJson) {
  const coll = {
    id: `coll-imported-${Date.now()}`,
    name: postmanJson.info.name || 'Imported Postman Collection',
    variables: Array.isArray(postmanJson.variable)
      ? postmanJson.variable.reduce((values, variable) => {
        if (variable.disabled !== true && variable.key) {
          values[variable.key] = variable.value == null ? '' : String(variable.value);
        }
        return values;
      }, {})
      : {},
    requests: []
  };

  const readAuth = auth => {
    if (!auth || auth.type === 'noauth') return { type: 'none' };
    const values = (auth[auth.type] || []).reduce((result, item) => {
      result[item.key] = item.value == null ? '' : item.value;
      return result;
    }, {});
    if (auth.type === 'bearer') return { type: 'bearer', bearerToken: values.token || '' };
    if (auth.type === 'basic') return { type: 'basic', username: values.username || '', password: values.password || '' };
    if (auth.type === 'apikey') {
      return { type: 'apikey', key: values.key || '', value: values.value || '', in: values.in || 'header' };
    }
    if (auth.type === 'oauth2') {
      const grantType = values.code_challenge_method
        ? 'authorization_code_pkce'
        : values.grant_type || 'client_credentials';
      return removeOAuthSecrets({
        type: 'oauth2',
        oauthGrantType: grantType,
        oauthClientId: values.clientId || values.client_id || '',
        oauthClientSecret: values.clientSecret || values.client_secret || '',
        oauthTokenUrl: values.accessTokenUrl || values.tokenUrl || values.token_url || '',
        oauthAuthorizationUrl: values.authUrl || values.authorizationUrl || values.auth_url || '',
        oauthScope: values.scope || '',
        oauthUsername: values.username || '',
        oauthPassword: values.password || '',
        oauthAccessToken: values.accessToken || values.access_token || '',
        oauthRefreshToken: values.refreshToken || values.refresh_token || ''
      });
    }
    return { type: 'none' };
  };
  const readEvents = item => (Array.isArray(item.event) ? item.event : []).reduce((scripts, event) => {
    const source = event.script && Array.isArray(event.script.exec) ? event.script.exec.join('\n') : '';
    if (event.listen === 'prerequest' && source) scripts.preRequest.push(source);
    if (event.listen === 'test' && source) scripts.tests.push(source);
    return scripts;
  }, { preRequest: [], tests: [] });
  const combineScripts = (events, key) => events.map(event => event[key]).filter(Boolean).join('\n');

  function traverseItems(itemArray, folderPath = [], inheritedAuth = null, inheritedEvents = []) {
    itemArray.forEach(item => {
      if (item.request) {
        const pmReq = item.request;
        const url = typeof pmReq.url === 'string' ? null : pmReq.url;
        let urlStr = typeof pmReq.url === 'string' ? pmReq.url : url && url.raw || '';
        if (!urlStr && url) {
          const protocol = url.protocol ? `${url.protocol}://` : '';
          const host = Array.isArray(url.host) ? url.host.join('.') : (url.host || '');
          const path = Array.isArray(url.path) ? url.path.join('/') : (url.path || '');
          const query = (url.query || [])
            .filter(parameter => parameter.disabled !== true && parameter.key)
            .map(parameter => `${encodeURIComponent(parameter.key)}=${encodeURIComponent(parameter.value || '')}`)
            .join('&');
          urlStr = `${protocol}${host}${path ? `/${path}` : ''}${query ? `?${query}` : ''}`;
        }
        const headers = (pmReq.header || []).map(header => ({
          key: header.key || '',
          value: header.value || '',
          enabled: header.disabled !== true,
          description: typeof header.description === 'string' ? header.description : (header.description && header.description.content) || ''
        }));
        const body = pmReq.body || {};
        let bodyType = body.mode || 'none';
        let bodyContent = body.raw || '';
        let formdata = [];
        let urlencoded = [];
        if (bodyType === 'formdata') {
          bodyType = 'form-data';
          formdata = (body.formdata || []).map(field => ({
            key: field.key || '',
            value: field.value || '',
            type: field.type === 'file' ? 'file' : 'text',
            fileName: typeof field.src === 'string' ? field.src.split(/[\\/]/).pop() : '',
            fileData: '',
            enabled: field.disabled !== true
          }));
        } else if (bodyType === 'urlencoded') {
          urlencoded = (body.urlencoded || []).map(field => ({
            key: field.key || '',
            value: field.value || '',
            enabled: field.disabled !== true
          }));
        } else if (bodyType !== 'raw') {
          bodyType = 'none';
        }
        const requestEvents = readEvents(item);
        const effectiveAuth = pmReq.auth && pmReq.auth.type !== 'inherit'
          ? readAuth(pmReq.auth)
          : inheritedAuth || readAuth(postmanJson.auth);
        const rawType = body.options && body.options.raw && body.options.raw.language;
        const importedContentType = headers.find(header => header.key.toLowerCase() === 'content-type');
        const bodyRawType = rawType === 'json' ? 'application/json'
          : rawType === 'xml' ? 'application/xml'
            : rawType === 'html' ? 'text/html'
              : importedContentType ? importedContentType.value : 'text/plain';

        coll.requests.push({
          id: `req-imported-${Date.now()}-${Math.random().toString(36).substring(2,6)}`,
          name: item.name || 'Unnamed Request',
          folderPath: folderPath.join('/'),
          description: typeof item.request.description === 'string'
            ? item.request.description
            : (item.request.description && item.request.description.content) || '',
          method: pmReq.method || 'GET',
          url: urlStr,
          headers,
          auth: effectiveAuth,
          bodyType,
          bodyRawType,
          body: bodyContent,
          formdata,
          urlencoded,
          preRequestScript: combineScripts([...inheritedEvents, requestEvents], 'preRequest'),
          testsScript: combineScripts([...inheritedEvents, requestEvents], 'tests')
        });
      } else if (item.item) {
        const folderEvents = readEvents(item);
        const folderAuth = item.auth && item.auth.type !== 'inherit' ? readAuth(item.auth) : inheritedAuth;
        traverseItems(
          item.item,
          [...folderPath, item.name || 'Folder'],
          folderAuth,
          [...inheritedEvents, folderEvents]
        );
      }
    });
  }

  traverseItems(postmanJson.item || [], [], readAuth(postmanJson.auth), [readEvents(postmanJson)]);
  return coll;
}

// --- UI Enhancements: Resizers and Copy Button ---
document.addEventListener('DOMContentLoaded', () => {
  const sidebarResizer = document.getElementById('sidebar-resizer');
  const paneResizer = document.getElementById('pane-resizer');
  const appContainer = document.querySelector('.app-container');
  const workspaceContent = document.querySelector('.workspace-content');
  
  if (sidebarResizer && appContainer) {
    let isResizing = false;
    sidebarResizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      sidebarResizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newWidth = e.clientX;
      if (newWidth > 150 && newWidth < 800) {
        appContainer.style.setProperty('--sidebar-width', `${newWidth}px`);
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        sidebarResizer.classList.remove('dragging');
        document.body.style.cursor = 'default';
      }
    });
  }

  if (paneResizer && workspaceContent) {
    let isResizingPane = false;
    paneResizer.addEventListener('mousedown', (e) => {
      isResizingPane = true;
      paneResizer.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizingPane) return;
      const rect = workspaceContent.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const totalHeight = rect.height;
      if (relativeY > 100 && relativeY < totalHeight - 100) {
        workspaceContent.style.setProperty('--request-height', `${relativeY}px`);
        workspaceContent.style.setProperty('--response-height', `${totalHeight - relativeY - 4}px`);
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizingPane) {
        isResizingPane = false;
        paneResizer.classList.remove('dragging');
        document.body.style.cursor = 'default';
      }
    });
  }

  // Copy Response Button Logic
  const copyBtn = document.getElementById('btn-copy-response');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      let textToCopy = '';
      const rawTextEl = document.getElementById('response-raw-text');
      
      // Try to get from global ace editor if available
      if (window.responseEditor && typeof window.responseEditor.getValue === 'function') {
        textToCopy = window.responseEditor.getValue();
      } else if (rawTextEl) {
        textToCopy = rawTextEl.value;
      }
      
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          const icon = copyBtn.querySelector('i');
          if (icon) icon.className = 'fa-solid fa-check';
          copyBtn.style.color = 'var(--accent)';
          setTimeout(() => {
            if (icon) icon.className = 'fa-solid fa-copy';
            copyBtn.style.color = '';
          }, 1500);
        }).catch(err => console.error('Copy failed', err));
      }
    });
  }
});
