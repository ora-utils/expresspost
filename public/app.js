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
window.deleteRequestFromCollection = async function(e, reqId, collId) {
  e.preventDefault();
  e.stopPropagation();
  if (await showConfirmDialog('Remove Request', 'Remove this request from the collection?')) {
    const coll = collections.find(c => String(c.id) === String(collId));
    if (coll) {
      coll.requests = coll.requests.filter(r => String(r.id) !== String(reqId));
      saveCollections();
      renderCollections();
      if (typeof populateRunnerSelects === 'function') populateRunnerSelects();
    }
  }
};

/**
 * In-App Dialogs & Toasts (Replaces native alert/confirm/prompt for full Electron & Windows compatibility)
 */
window.showToast = function(message, variant = 'info') {
  const container = document.getElementById('app-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `app-toast ${variant === 'error' ? 'toast-error' : variant === 'success' ? 'toast-success' : ''}`;
  toast.textContent = String(message || '');
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3200);
};

function openAppDialog({ title = 'ExpressPost', message = '', showInput = false, placeholder = '', defaultValue = '', showCancel = false, okText = 'OK' }) {
  const modal = document.getElementById('modal-app-dialog');
  const titleEl = document.getElementById('app-dialog-title');
  const msgEl = document.getElementById('app-dialog-message');
  const inputEl = document.getElementById('app-dialog-input');
  const cancelBtn = document.getElementById('btn-app-dialog-cancel');
  const okBtn = document.getElementById('btn-app-dialog-ok');
  const closeBtn = document.getElementById('btn-close-app-dialog');

  if (!modal || !titleEl || !msgEl || !inputEl || !cancelBtn || !okBtn) {
    return Promise.resolve(showInput ? null : false);
  }

  titleEl.textContent = title;
  msgEl.textContent = message;
  okBtn.textContent = okText;
  cancelBtn.classList.toggle('hidden', !showCancel);
  inputEl.classList.toggle('hidden', !showInput);
  inputEl.placeholder = placeholder;
  inputEl.value = defaultValue;

  modal.classList.remove('hidden');
  if (showInput) {
    setTimeout(() => { inputEl.focus(); inputEl.select(); }, 0);
  } else {
    setTimeout(() => okBtn.focus(), 0);
  }

  return new Promise(resolve => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
      resolve(result);
    };
    const onOk = () => finish(showInput ? inputEl.value : true);
    const onCancel = () => finish(showInput ? null : false);
    const onBackdrop = (ev) => { if (ev.target === modal) onCancel(); };
    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onCancel();
      } else if (ev.key === 'Enter' && showInput && document.activeElement === inputEl) {
        ev.preventDefault();
        onOk();
      }
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);
  });
}

window.showAlertDialog = function(message, title = 'Notice') {
  return openAppDialog({ title, message: String(message || ''), showInput: false, showCancel: false, okText: 'OK' });
};

window.showConfirmDialog = function(title, message) {
  return openAppDialog({ title, message: String(message || ''), showInput: false, showCancel: true, okText: 'Confirm' });
};

window.showPromptDialog = function(title, placeholder = '', defaultValue = '') {
  return openAppDialog({ title, message: '', showInput: true, placeholder, defaultValue, showCancel: true, okText: 'OK' });
};

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
  localStorage.removeItem('expresspost_engine');
  setupAppearanceControls();
  initAceEditors();
  initCollectionsAndRunner();
  loadTabs();
  setupAppEventListeners();
  setupConsoleEventListeners();
  setupEnvironmentModalListeners();
  setupSaveModalListeners();
  setupCurlImportListeners();
  setupMockServerListeners();
  setupCollectionSettingsListeners();
  setupKeyboardShortcuts();
  initVariableQuickEditPopover();

  // Create first tab if empty
  if (tabs.length === 0) {
    createNewTab();
  } else {
    if (!tabs.some(t => t.id === activeTabId)) {
      activeTabId = tabs[0].id;
    }
    renderTabsUI();
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
 * Creates a textarea-backed editor shim if Ace CDN is unavailable (offline/firewall fallback)
 */
function createFallbackEditor(elementId, readOnly = false) {
  const container = document.getElementById(elementId);
  const textarea = document.createElement('textarea');
  textarea.className = 'fallback-code-editor code-font';
  textarea.readOnly = readOnly;
  textarea.spellcheck = false;
  if (container) {
    container.innerHTML = '';
    container.appendChild(textarea);
  }
  const changeListeners = [];
  textarea.addEventListener('input', () => {
    changeListeners.forEach(fn => fn());
  });
  const session = {
    setMode() {},
    getLength() { return textarea.value.split('\n').length; },
    getLine(row) {
      const lines = textarea.value.split('\n');
      return lines[row] || '';
    },
    insert(_pos, text) {
      textarea.value = textarea.value + text;
      changeListeners.forEach(fn => fn());
    },
    setUseWrapMode(wrap) {
      textarea.style.whiteSpace = wrap ? 'pre-wrap' : 'pre';
      textarea.style.wordBreak = wrap ? 'break-word' : 'normal';
    },
    getUseWrapMode() {
      return textarea.style.whiteSpace !== 'pre';
    }
  };
  return {
    session,
    getSession() { return session; },
    setOptions(opts) {
      if (opts && opts.readOnly !== undefined) textarea.readOnly = Boolean(opts.readOnly);
      if (opts && opts.wrap !== undefined) session.setUseWrapMode(Boolean(opts.wrap));
    },
    setTheme() {},
    setReadOnly(ro) { textarea.readOnly = Boolean(ro); },
    getValue() { return textarea.value; },
    setValue(val) {
      textarea.value = val == null ? '' : String(val);
      changeListeners.forEach(fn => fn());
    },
    clearSelection() {},
    resize() {},
    focus() { textarea.focus(); },
    on(evt, fn) { if (evt === 'change' && typeof fn === 'function') changeListeners.push(fn); }
  };
}

/**
 * Initialize Ace Editors via CDN (with offline fallback)
 */
function initAceEditors() {
  const aceOptions = {
    theme: document.documentElement.dataset.theme === 'light' ? 'ace/theme/chrome' : 'ace/theme/tomorrow_night',
    showPrintMargin: false,
    fontSize: '13px',
    tabSize: 2,
    useSoftTabs: true,
    wrap: true,
    highlightActiveLine: false,
    cursorStyle: 'smooth'
  };

  const hasAce = typeof ace !== 'undefined' && typeof ace.edit === 'function';

  // Body Editor
  bodyEditor = hasAce ? ace.edit('body-editor') : createFallbackEditor('body-editor', false);
  bodyEditor.setOptions(aceOptions);
  if (bodyEditor.session && typeof bodyEditor.session.setUseWrapMode === 'function') {
    bodyEditor.session.setUseWrapMode(true);
  }
  bodyEditor.session.setMode('ace/mode/json');

  // Auto-format minified single-line JSON on paste
  if (hasAce && typeof bodyEditor.on === 'function') {
    bodyEditor.on('paste', (e) => {
      const activeTab = getActiveTab();
      if (activeTab && activeTab.bodyType === 'raw' && (!activeTab.bodyRawType || activeTab.bodyRawType === 'application/json')) {
        const text = (e && typeof e.text === 'string' ? e.text : '').trim();
        if (text && !text.includes('\n') && ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) {
          setTimeout(() => {
            const current = bodyEditor.getValue();
            const formatted = formatJSON(current, 2);
            if (formatted && formatted !== current) {
              bodyEditor.setValue(formatted, -1);
              showToast('Auto-formatted pasted JSON body', 'info');
            }
          }, 30);
        }
      }
    });
  }

  bodyEditor.on('change', () => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.body = bodyEditor.getValue();
      saveTabsState();
      updateConfigTabIndicators();
    }
  });

  // Pre-request Script Editor
  preRequestEditor = hasAce ? ace.edit('pre-request-editor') : createFallbackEditor('pre-request-editor', false);
  preRequestEditor.setOptions(aceOptions);
  preRequestEditor.session.setMode('ace/mode/javascript');
  preRequestEditor.on('change', () => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.preRequestScript = preRequestEditor.getValue();
      saveTabsState();
      updateConfigTabIndicators();
    }
  });

  // Test Script Editor
  testsEditor = hasAce ? ace.edit('tests-editor') : createFallbackEditor('tests-editor', false);
  testsEditor.setOptions(aceOptions);
  testsEditor.session.setMode('ace/mode/javascript');
  testsEditor.on('change', () => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.testsScript = testsEditor.getValue();
      saveTabsState();
      updateConfigTabIndicators();
    }
  });

  // Response Code Editor (Read only pretty view)
  responseEditor = hasAce ? ace.edit('response-editor') : createFallbackEditor('response-editor', true);
  responseEditor.setOptions(aceOptions);
  if (responseEditor.session && typeof responseEditor.session.setUseWrapMode === 'function') {
    responseEditor.session.setUseWrapMode(true);
  }
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
  const sanitized = stripOAuthSecrets(tabs);
  try {
    localStorage.setItem('workspace_tabs', JSON.stringify(sanitized));
    localStorage.setItem('workspace_active_tab', activeTabId);
  } catch (err) {
    // Graceful fallback if localStorage quota exceeded (e.g. large response bodies or file uploads)
    try {
      const compact = sanitized.map(t => ({
        ...t,
        response: null,
        formdata: Array.isArray(t.formdata)
          ? t.formdata.map(f => ({ ...f, fileData: '' }))
          : []
      }));
      localStorage.setItem('workspace_tabs', JSON.stringify(compact));
      localStorage.setItem('workspace_active_tab', activeTabId);
    } catch (innerErr) {
      console.warn('Could not persist workspace tabs to localStorage:', innerErr);
    }
  }
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
    engine: 'proxy',
    params: null,
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
  newTabObj.engine = 'proxy';
  if (!Array.isArray(newTabObj.params)) {
    newTabObj.params = parseUrlParams(newTabObj.url);
  }
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
  if (activeBtn) {
    activeBtn.classList.add('active');
    const tabsContainer = document.getElementById('request-tabs');
    if (tabsContainer) {
      const tabLeft = activeBtn.offsetLeft;
      const tabRight = tabLeft + activeBtn.offsetWidth;
      if (tabLeft < tabsContainer.scrollLeft) {
        tabsContainer.scrollLeft = tabLeft;
      } else if (tabRight > tabsContainer.scrollLeft + tabsContainer.clientWidth) {
        tabsContainer.scrollLeft = tabRight - tabsContainer.clientWidth;
      }
    }
  }

  const tab = getActiveTab();
  if (!tab) return;
  updateSendButtonState(id);

  // Address Bar inputs
  document.getElementById('request-method').value = tab.method;
  document.getElementById('request-url').value = tab.url || '';

  // Params table UI (preserve disabled params and descriptions)
  if (!Array.isArray(tab.params) || (tab.params.length === 0 && tab.url && tab.url.includes('?'))) {
    tab.params = parseUrlParams(tab.url);
  }
  renderKeyValueTable('params', tab.params);

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
  const rawType = tab.bodyRawType || 'application/json';
  document.getElementById('body-raw-type').value = rawType;
  if (rawType === 'application/json') bodyEditor.session.setMode('ace/mode/json');
  else if (rawType === 'application/xml') bodyEditor.session.setMode('ace/mode/xml');
  else if (rawType === 'text/html') bodyEditor.session.setMode('ace/mode/html');
  else bodyEditor.session.setMode('ace/mode/text');

  bodyEditor.setValue(tab.body || '', -1);
  if (tab.bodyType === 'form-data') {
    renderKeyValueTable('formdata', tab.formdata || []);
  } else if (tab.bodyType === 'urlencoded') {
    renderKeyValueTable('urlencoded', tab.urlencoded || []);
  }

  // Pre-request script Ace Value
  preRequestEditor.setValue(tab.preRequestScript || '', -1);

  // Test script Ace Value
  testsEditor.setValue(tab.testsScript || '', -1);
  updateConfigTabIndicators();

  // Reset Response area
  if (tab.response) {
    renderResponseUI(tab.response, tab.testResults);
  } else {
    document.getElementById('response-empty-state').classList.remove('hidden');
    document.getElementById('response-content-area').classList.add('hidden');
    document.getElementById('response-metadata').classList.add('hidden');
  }

  if (typeof refreshVariableHighlights === 'function') {
    requestAnimationFrame(() => refreshVariableHighlights());
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
  const items = (list && list.length > 0) ? list.map(item => ({ ...item })) : [];
  const lastItem = items[items.length - 1];
  if (!lastItem || lastItem.key !== '') {
    items.push({ key: '', value: '', enabled: true, description: '' });
  }

  items.forEach((item, index) => {
    const row = document.createElement('tr');
    const isFormData = tableType === 'formdata';
    const isFile = isFormData && item.type === 'file';

    row._fileData = item.fileData || '';
    row._fileName = item.fileName || '';

    row.innerHTML = `
      <td class="checkbox-cell">
        <input type="checkbox" class="row-checkbox" ${item.enabled !== false ? 'checked' : ''}>
      </td>
      <td>
        <input type="text" class="row-key code-font" placeholder="Key" value="${escapeHTML(item.key)}" ${tableType === 'headers' ? 'list="common-http-headers"' : ''} autocomplete="off">
      </td>
      <td>
        ${isFile ? `
          <div style="display: flex; gap: 8px; align-items: center; width: 100%;">
            <input type="file" class="row-file-input">
            <span class="file-info-text text-accent" style="font-size: 11px;">${escapeHTML(item.fileName || '(No file)')}</span>
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
        <button class="icon-btn row-delete-btn" title="Remove row"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    `;

    const checkbox = row.querySelector('.row-checkbox');
    const keyInput = row.querySelector('.row-key');
    const valInput = row.querySelector('.row-value');
    const fileInput = row.querySelector('.row-file-input');
    const typeSelect = row.querySelector('.row-type-select');
    const descInput = row.querySelector('.row-desc');
    const deleteBtn = row.querySelector('.row-delete-btn');

    const maybeAppendRow = () => {
      if (row === tbody.lastElementChild) {
        const hasContent = keyInput.value !== '' || (valInput && valInput.value !== '');
        if (hasContent) {
          const newRowData = { key: '', value: '', enabled: true, description: '' };
          items.push(newRowData);
          const currentData = getRowsDataFromTable(tableType);
          renderKeyValueTable(tableType, currentData);
          // Restore focus to the edited row's input
          const targetRow = tbody.children[index];
          if (targetRow) {
            const focusTarget = document.activeElement === valInput
              ? targetRow.querySelector('.row-value')
              : targetRow.querySelector('.row-key');
            if (focusTarget) {
              focusTarget.focus();
              const len = focusTarget.value.length;
              focusTarget.setSelectionRange(len, len);
            }
          }
        }
      }
    };

    checkbox.addEventListener('change', () => syncRowDataToTab(tableType));
    keyInput.addEventListener('input', () => {
      syncRowDataToTab(tableType);
      maybeAppendRow();
    });

    if (valInput) {
      valInput.addEventListener('input', () => {
        syncRowDataToTab(tableType);
        maybeAppendRow();
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = function(evt) {
            row._fileData = evt.target.result;
            row._fileName = file.name;
            row.querySelector('.file-info-text').innerText = file.name;
            syncRowDataToTab(tableType);
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        const currentRows = getRowsDataFromTable(tableType);
        if (!currentRows[index]) currentRows[index] = { key: keyInput.value.trim(), enabled: checkbox.checked };
        currentRows[index].type = typeSelect.value;
        currentRows[index].value = '';
        currentRows[index].fileData = '';
        currentRows[index].fileName = '';
        renderKeyValueTable(tableType, currentRows);
        syncRowDataToTab(tableType);
      });
    }

    if (descInput) {
      descInput.addEventListener('input', () => syncRowDataToTab(tableType));
    }

    deleteBtn.addEventListener('click', () => {
      row.remove();
      syncRowDataToTab(tableType);
      if (tbody.children.length === 0) {
        renderKeyValueTable(tableType, []);
      }
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

    let value = '';
    let type = 'text';
    let fileData = '';
    let fileName = '';
    let description = '';

    if (typeSelect) {
      type = typeSelect.value;
      if (type === 'file') {
        fileName = tr._fileName || '';
        fileData = tr._fileData || '';
      } else {
        const valElem = tr.querySelector('.row-value');
        value = valElem ? valElem.value : '';
      }
    } else {
      const valElem = tr.querySelector('.row-value');
      value = valElem ? valElem.value : '';
      const descElem = tr.querySelector('.row-desc');
      description = descElem ? descElem.value : '';
    }

    if (key || value || fileName || type === 'file') {
      if (key || value || fileName) {
        rows.push({ key, value, enabled, description, type, fileData, fileName });
      }
    }
  });

  return rows;
}

function syncRowDataToTab(tableType) {
  const activeTab = getActiveTab();
  if (!activeTab) return;

  const data = getRowsDataFromTable(tableType);

  if (tableType === 'params') {
    activeTab.params = data;
    const updatedUrl = rebuildUrlFromParams(document.getElementById('request-url').value, data);
    document.getElementById('request-url').value = updatedUrl;
    activeTab.url = updatedUrl;
  } else if (tableType === 'headers') {
    activeTab.headers = data;
  } else if (tableType === 'formdata') {
    activeTab.formdata = data;
  } else if (tableType === 'urlencoded') {
    activeTab.urlencoded = data;
  }

  updateConfigTabIndicators();
  saveTabsState();
}

function updateHeadersCountBadge() {
  updateConfigTabIndicators();
}

function updateConfigTabIndicators() {
  const activeTab = getActiveTab();
  const headerCount = activeTab && Array.isArray(activeTab.headers)
    ? activeTab.headers.filter(h => h.enabled !== false && h.key !== '').length
    : 0;
  const headerBadge = document.getElementById('header-badge-count');
  if (headerBadge) headerBadge.innerText = headerCount;

  const paramCount = activeTab && Array.isArray(activeTab.params)
    ? activeTab.params.filter(p => p.enabled !== false && p.key !== '').length
    : 0;
  const paramsBadge = document.getElementById('params-badge-count');
  if (paramsBadge) {
    paramsBadge.innerText = paramCount;
    paramsBadge.classList.toggle('hidden', paramCount === 0);
  }

  const authDot = document.getElementById('auth-indicator-dot');
  if (authDot) {
    authDot.classList.toggle('hidden', !activeTab || !activeTab.auth || activeTab.auth.type === 'none');
  }

  const bodyDot = document.getElementById('body-indicator-dot');
  if (bodyDot) {
    bodyDot.classList.toggle('hidden', !activeTab || !activeTab.bodyType || activeTab.bodyType === 'none');
  }

  const preDot = document.getElementById('prescript-indicator-dot');
  if (preDot) {
    preDot.classList.toggle('hidden', !activeTab || !(activeTab.preRequestScript || '').trim());
  }

  const testsDot = document.getElementById('tests-indicator-dot');
  if (testsDot) {
    testsDot.classList.toggle('hidden', !activeTab || !(activeTab.testsScript || '').trim());
  }

  const formatBtn = document.getElementById('btn-format-body-json');
  const wrapBtn = document.getElementById('btn-wrap-body-raw');
  if (formatBtn) {
    const showRawActions = Boolean(activeTab && activeTab.bodyType === 'raw');
    formatBtn.classList.toggle('hidden', !showRawActions);
    if (wrapBtn) wrapBtn.classList.toggle('hidden', !showRawActions);
  }
}

function mergeUrlParamsWithExisting(urlStr, existingParams = []) {
  const parsedEnabled = parseUrlParams(urlStr);
  const disabledExisting = (existingParams || []).filter(p => p.enabled === false);
  const descMap = new Map();
  (existingParams || []).forEach(p => {
    if (p.key && p.description && !descMap.has(p.key)) {
      descMap.set(p.key, p.description);
    }
  });
  const merged = parsedEnabled.map(p => ({
    ...p,
    description: descMap.get(p.key) || ''
  }));
  return [...merged, ...disabledExisting];
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


  // URL edit triggers param parsing (preserving disabled params & descriptions)
  const urlInputEl = document.getElementById('request-url');
  urlInputEl.addEventListener('input', (e) => {
    const activeTab = getActiveTab();
    if (activeTab) {
      activeTab.url = e.target.value;
      activeTab.params = mergeUrlParamsWithExisting(e.target.value, activeTab.params);
      saveTabsState();
      renderKeyValueTable('params', activeTab.params);
      updateConfigTabIndicators();
    }
  });
  urlInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendActiveRequest();
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

      bodyEditor.resize();
      preRequestEditor.resize();
      testsEditor.resize();

      const activeTab = getActiveTab();
      if (tabBtn.dataset.config === 'body' && activeTab) {
        if (activeTab.bodyType === 'form-data') {
          renderKeyValueTable('formdata', activeTab.formdata || []);
        } else if (activeTab.bodyType === 'urlencoded') {
          renderKeyValueTable('urlencoded', activeTab.urlencoded || []);
        }
      }
      if (typeof refreshVariableHighlights === 'function') {
        requestAnimationFrame(() => refreshVariableHighlights());
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
      updateConfigTabIndicators();
    }
  });

  // Auth fields content sync
  const authFields = ['auth-bearer-token', 'auth-basic-username', 'auth-basic-password', 'auth-apikey-key', 'auth-apikey-value', 'auth-apikey-in'];
  authFields.forEach(f => {
    const el = document.getElementById(f);
    const evtType = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evtType, () => {
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
  });

  // OAuth 2.0 fields (attached once, outside authFields loop!)
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
    const el = document.getElementById(elementId);
    const handler = event => {
      const activeTab = getActiveTab();
      if (!activeTab) return;
      activeTab.auth[authKey] = event.target.value;
      ensureOAuthSessionId(activeTab.auth);
      if (authKey === 'oauthGrantType') updateOAuthGrantFields(event.target.value);
      saveTabsState();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
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
      const oauthScopes = {
        globals,
        collectionVariables: getSavedCollectionVariables(activeTab),
        environment: getActiveEnvironmentSnapshot()
      };
      await acquireOAuthToken(activeTab.auth, true, true, undefined, oauthScopes);
      document.getElementById('oauth-token-status').textContent = 'Token acquired for this session';
      saveTabsState();
    } catch (error) {
      document.getElementById('oauth-token-status').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  // Body raw options change
  document.getElementsByName('body-type').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const activeTab = getActiveTab();
      if (activeTab) {
        activeTab.bodyType = e.target.value;
        saveTabsState();
        toggleBodyPane(e.target.value);
        updateConfigTabIndicators();

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
      updateConfigTabIndicators();

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

  const formatBodyBtn = document.getElementById('btn-format-body-json');
  if (formatBodyBtn) {
    formatBodyBtn.addEventListener('click', () => {
      formatRequestBody();
    });
  }

  const wrapBodyBtn = document.getElementById('btn-wrap-body-raw');
  if (wrapBodyBtn) {
    wrapBodyBtn.addEventListener('click', () => {
      toggleEditorLineWrap(bodyEditor, wrapBodyBtn, '#body-editor textarea');
    });
  }

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
      const hasAce = typeof ace !== 'undefined' && typeof ace.edit === 'function';
      snippetEditor = hasAce ? ace.edit("snippet-editor") : createFallbackEditor("snippet-editor", true);
      snippetEditor.setTheme(document.documentElement.dataset.theme === 'light' ? 'ace/theme/chrome' : 'ace/theme/tomorrow_night_eighties');
      snippetEditor.session.setMode("ace/mode/sh");
      snippetEditor.setOptions({ readOnly: true, highlightActiveLine: false, highlightGutterLine: false, showPrintMargin: false });
    }

    document.getElementById('snippet-lang-select').dispatchEvent(new Event('change'));
  });

  document.getElementById('close-snippet-modal').addEventListener('click', () => {
    document.getElementById('snippet-modal').classList.add('hidden');
  });
  document.getElementById('snippet-modal').addEventListener('click', (e) => {
    if (e.target.id === 'snippet-modal') document.getElementById('snippet-modal').classList.add('hidden');
  });

  document.getElementById('snippet-lang-select').addEventListener('change', (e) => {
    const tab = getActiveTab();
    if (!tab || !snippetEditor) return;

    const lang = e.target.value;
    let code = '';

    const snippetTab = { ...tab };
    if (snippetTab.auth && snippetTab.auth.type === 'oauth2') {
      snippetTab.auth = hydrateOAuthAuth(snippetTab.auth);
    }

    if (lang === 'curl' && typeof window.generateCurl === 'function') {
      code = window.generateCurl(snippetTab);
      snippetEditor.session.setMode("ace/mode/sh");
    } else if (lang === 'python' && typeof window.generatePython === 'function') {
      code = window.generatePython(snippetTab);
      snippetEditor.session.setMode("ace/mode/python");
    } else if (lang === 'node' && typeof window.generateNode === 'function') {
      code = window.generateNode(snippetTab);
      snippetEditor.session.setMode("ace/mode/javascript");
    }

    snippetEditor.setValue(code, -1);
  });

  document.getElementById('btn-copy-snippet').addEventListener('click', () => {
    if (snippetEditor) {
      copyTextWithFeedback(snippetEditor.getValue(), document.getElementById('btn-copy-snippet'), '<i class="fa-solid fa-check"></i> Copied!');
    }
  });

  // Snippets click injectors
  document.querySelectorAll('.snippet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const snipType = btn.dataset.snippet;
      const target = btn.dataset.snippetTarget === 'pre-request' ? preRequestEditor : testsEditor;
      let codeToInject = '';

      switch (snipType) {
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
      const lastRow = Math.max(0, session.getLength() - 1);
      const lastLine = session.getLine(lastRow);
      const prefix = lastLine && lastLine.trim() !== '' ? '\n' : '';
      session.insert({ row: lastRow, column: lastLine.length }, prefix + codeToInject);
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

  const respPrettySelect = document.getElementById('resp-pretty-type');
  if (respPrettySelect) {
    respPrettySelect.addEventListener('change', (e) => {
      updateResponsePrettyView(e.target.value);
    });
  }

  const formatRespBtn = document.getElementById('btn-format-response');
  if (formatRespBtn) {
    formatRespBtn.addEventListener('click', () => {
      const type = document.getElementById('resp-pretty-type')?.value || 'auto';
      updateResponsePrettyView(type);
      showToast('Re-formatted response body', 'success');
    });
  }

  const wrapRespBtn = document.getElementById('btn-wrap-response');
  if (wrapRespBtn) {
    wrapRespBtn.addEventListener('click', () => {
      toggleEditorLineWrap(responseEditor, wrapRespBtn, '#response-raw-text');
    });
  }

  // Keyboard shortcut listener for Beautify (Ctrl+B / Cmd+B or Alt+Shift+F)
  window.addEventListener('keydown', (e) => {
    const isCtrlB = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !e.shiftKey && !e.altKey;
    const isAltShiftF = (e.altKey && e.shiftKey && e.key.toLowerCase() === 'f') ||
                        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f');
    if (isCtrlB || isAltShiftF) {
      const activeEl = document.activeElement;
      const isResponseFocus = activeEl && (
        activeEl.closest('#workspace-response-area') ||
        activeEl.closest('.response-panes') ||
        activeEl.id === 'response-editor' ||
        activeEl.id === 'response-raw-text'
      );
      if (isResponseFocus) {
        e.preventDefault();
        const type = document.getElementById('resp-pretty-type')?.value || 'auto';
        updateResponsePrettyView(type);
        showToast('Re-formatted response body', 'info');
      } else {
        const tab = getActiveTab();
        if (tab && tab.bodyType === 'raw') {
          e.preventDefault();
          formatRequestBody();
        }
      }
    }
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
    saveActiveEnvId(e.target.value);
    renderEnvironmentsList();
    populateRunnerSelects();
    if (typeof refreshVariableHighlights === 'function') refreshVariableHighlights();
  });

  // Sidebar Search filters
  const collSearch = document.getElementById('collections-search');
  if (collSearch) {
    collSearch.addEventListener('input', () => renderCollections());
  }
  const histSearch = document.getElementById('history-search');
  if (histSearch) {
    histSearch.addEventListener('input', () => renderHistoryList());
  }

  // Clear History
  const clearHistBtn = document.getElementById('btn-clear-history');
  if (clearHistBtn) {
    clearHistBtn.addEventListener('click', async () => {
      if (await showConfirmDialog('Clear History', 'Are you sure you want to clear your requests history?')) {
        localStorage.removeItem('history');
        renderHistoryList();
      }
    });
  }

  // Bind key elements for modal windows exits
  document.querySelectorAll('.modal-close-btn, .modal-close-action').forEach(b => {
    b.addEventListener('click', () => {
      const modal = b.closest('.modal');
      if (modal) modal.classList.remove('active');
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
  const formatBtn = document.getElementById('btn-format-body-json');
  const wrapBtn = document.getElementById('btn-wrap-body-raw');
  const isRaw = bodyType === 'raw';
  if (rawSelect) rawSelect.classList.toggle('hidden', !isRaw);
  if (formatBtn) formatBtn.classList.toggle('hidden', !isRaw);
  if (wrapBtn) wrapBtn.classList.toggle('hidden', !isRaw);
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
  const allVars = { ...globals, ...envSnapshot, ...localVariables };

  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (Object.prototype.hasOwnProperty.call(allVars, trimmedKey)) return String(allVars[trimmedKey]);
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
    showToast('Please enter a target URL.', 'error');
    document.getElementById('request-url').focus();
    return;
  }
  const engine = 'proxy';
  tab.engine = engine;
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
    const requestBodyRawType = tab.bodyRawType || 'application/json';
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
        info: {
          eventName: 'prerequest',
          requestName: tab.name || '',
          requestId: tab.savedRequestId || tab.id,
          iteration: 1,
          iterationCount: 1
        },
        sendRequest: options => executeScriptRequest(options, engine, controller.signal),
        request: {
          url: requestUrl,
          method: requestMethod,
          headers: requestHeaders,
          body: requestBody,
          bodyType: requestBodyType
        }
      });

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

    // Resolve double curly braces (precedence: local > environment > collection > globals)
    const scopes = {
      globals: requestGlobals,
      collectionVariables: requestCollectionVariables,
      environment: requestEnv,
      localVariables: requestLocalVariables
    };
    let resolvedUrl = resolveVariables(requestUrl, scopes);
    const resolvedHeaders = resolveHeadersObject(requestHeaders, requestEnv, {
      ...requestCollectionVariables,
      ...requestEnv,
      ...requestLocalVariables
    });

    let resolvedBody = null;
    if (requestBodyType === 'raw') {
      resolvedBody = resolveVariables(requestBody, scopes);
    } else if (requestBodyType === 'urlencoded') {
      resolvedBody = getFlatBodyParams(Array.isArray(requestBody) ? requestBody : getRowsDataFromTable('urlencoded'), {
        ...requestGlobals,
        ...requestCollectionVariables,
        ...requestEnv,
        ...requestLocalVariables
      });
    } else if (requestBodyType === 'form-data') {
      resolvedBody = getFlatBodyParams(Array.isArray(requestBody) ? requestBody : getRowsDataFromTable('formdata'), {
        ...requestGlobals,
        ...requestCollectionVariables,
        ...requestEnv,
        ...requestLocalVariables
      });
    }

    try {
      if (tab.auth.type === 'oauth2') {
        const token = await acquireOAuthToken(tab.auth, false, false, controller.signal, scopes);
        resolvedHeaders.Authorization = `Bearer ${token}`;
      } else {
        resolvedUrl = injectAuthorizationToRequest(tab.auth, resolvedHeaders, resolvedUrl, {
          ...requestGlobals,
          ...requestCollectionVariables,
          ...requestEnv,
          ...requestLocalVariables
        });
      }

      if (engine === 'proxy') {
        const proxyPostUrl = `${window.location.origin}/api/proxy`;

        let finalProxyBody = resolvedBody;
        const hasContentType = Object.keys(resolvedHeaders).some(k => k.toLowerCase() === 'content-type');
        if (requestBodyType === 'urlencoded' && Array.isArray(resolvedBody)) {
          const params = new URLSearchParams();
          resolvedBody.forEach(item => params.append(item.key, item.value));
          finalProxyBody = params.toString();
          if (!hasContentType) resolvedHeaders['content-type'] = 'application/x-www-form-urlencoded';
        } else if (requestBodyType === 'raw' && resolvedBody && !hasContentType) {
          resolvedHeaders['content-type'] = requestBodyRawType;
        } else if (requestBodyType === 'form-data' && !hasContentType) {
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

        const parsedProxy = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(parsedProxy.message || parsedProxy.error || `Proxy error: ${response.statusText}`);
        }

        responseData = parsedProxy;
      } else {
        responseData = await executeDirectBrowserRequest(requestMethod, resolvedUrl, resolvedHeaders, resolvedBody, requestBodyType, controller.signal, requestBodyRawType);
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
        responseData = {
          status: 0,
          statusText: 'Connection Error',
          headers: {},
          body: `Error: ${error.message}\nCheck the target URL, network connectivity, and local runtime availability.`,
          time: Date.now() - start,
          size: 0
        };
      }
    }

    // 2. Evaluate Test Assertion Script
    const testResults = preScriptResults.slice();
    if (!controller.signal.aborted && tab.testsScript && tab.testsScript.trim() !== '') {
      appendConsoleLogs([{ type: 'info', message: `=== Test Assertions execution: "${tab.name}" ===`, time: new Date().toLocaleTimeString() }]);

      const testSandboxResult = await runScriptSandbox(tab.testsScript, {
        globals: requestGlobals,
        environment: requestEnv,
        collectionVariables: requestCollectionVariables,
        localVariables: requestLocalVariables,
        info: {
          eventName: 'test',
          requestName: tab.name || '',
          requestId: tab.savedRequestId || tab.id,
          iteration: 1,
          iterationCount: 1
        },
        sendRequest: options => executeScriptRequest(options, engine, controller.signal),
        request: {
          url: resolvedUrl,
          method: requestMethod,
          headers: resolvedHeaders,
          body: resolvedBody
        },
        response: responseData
      });

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
      if (typeof refreshVariableHighlights === 'function') refreshVariableHighlights();
    }

    tab.response = responseData;
    tab.testResults = testResults;
    saveTabsState();

    if (!controller.signal.aborted) {
      logRequestToHistory(requestMethod, resolvedUrl, responseData.status, responseData.time);
    }

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
async function executeDirectBrowserRequest(method, url, headers, body, bodyType, signal, bodyRawType = 'application/json') {
  const fetchOptions = {
    method: method,
    headers: new Headers(headers),
    mode: 'cors',
    signal
  };

  if (bodyType === 'raw' && body) {
    fetchOptions.body = body;
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
      fetchOptions.headers.set('Content-Type', bodyRawType || 'application/json');
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
        const matches = String(item.fileData).match(/^data:([^;,]*)(?:;[^,]*)?;base64,(.+)$/);
        if (matches) {
          const binaryString = atob(matches[2]);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes.buffer], { type: matches[1] || 'application/octet-stream' });
          formData.append(item.key, blob, item.fileName || 'file');
        }
      } else {
        formData.append(item.key, item.value || '');
      }
    });
    fetchOptions.body = formData;
    fetchOptions.headers.delete('Content-Type');
  }

  const start = Date.now();
  const response = await fetch(url, fetchOptions);
  const duration = Date.now() - start;

  const respHeaders = {};
  response.headers.forEach((val, key) => {
    respHeaders[key] = val;
  });

  const responseText = await response.text();
  const size = getByteLength(responseText);

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

async function acquireOAuthToken(auth, allowInteractive = false, force = false, signal, scopes = null) {
  if (!auth || auth.type !== 'oauth2') throw new Error('Select OAuth 2.0 authorization first.');
  moveOAuthSecretsToSession(auth);
  ensureOAuthSessionId(auth);
  const hydrated = hydrateOAuthAuth(auth);
  if (scopes) {
    [
      'oauthTokenUrl',
      'oauthAuthorizationUrl',
      'oauthRedirectUrl',
      'oauthClientId',
      'oauthClientSecret',
      'oauthScope',
      'oauthUsername',
      'oauthPassword'
    ].forEach(field => {
      if (typeof hydrated[field] === 'string' && hydrated[field]) {
        hydrated[field] = resolveVariables(hydrated[field], scopes);
      }
    });
  }
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
  if (!envSnapshot || typeof envSnapshot !== 'object') return;
  if (activeEnvId !== 'globals') {
    const activeEnv = environments.find(e => String(e.id) === String(activeEnvId));
    if (activeEnv) {
      const existingVars = Array.isArray(activeEnv.variables) ? activeEnv.variables : [];
      const disabledVars = existingVars.filter(v => v.enabled === false);
      const existingMap = new Map(existingVars.map(v => [v.key, v]));
      const updatedEnabled = Object.entries(envSnapshot).map(([key, value]) => {
        const prev = existingMap.get(key);
        return {
          key,
          initialValue: prev && prev.initialValue !== undefined ? prev.initialValue : value,
          value: String(value),
          enabled: true
        };
      });
      activeEnv.variables = [...updatedEnabled, ...disabledVars];
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
      try {
        const urlObj = new URL(url);
        urlObj.searchParams.set(key, value);
        url = urlObj.toString();
      } catch (e) {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      }
    }
  }
  return url;
}

/**
 * Toggle word wrapping on an Ace editor instance or fallback textarea
 */
function toggleEditorLineWrap(editor, btnEl, textareaSelector) {
  let isWrapped = true;
  if (editor && editor.session && typeof editor.session.getUseWrapMode === 'function') {
    isWrapped = !editor.session.getUseWrapMode();
    editor.session.setUseWrapMode(isWrapped);
  }
  if (textareaSelector) {
    const el = document.querySelector(textareaSelector);
    if (el) {
      el.style.whiteSpace = isWrapped ? 'pre-wrap' : 'pre';
      el.style.wordBreak = isWrapped ? 'break-word' : 'normal';
    }
  }
  if (btnEl) {
    btnEl.classList.toggle('btn-wrap-active', isWrapped);
    btnEl.title = isWrapped ? 'Line wrap enabled (click to disable)' : 'Line wrap disabled (click to enable)';
  }
  return isWrapped;
}

/**
 * Format current active request body
 */
function formatRequestBody() {
  const activeTab = getActiveTab();
  if (!activeTab || activeTab.bodyType !== 'raw') return;
  const rawType = activeTab.bodyRawType || 'application/json';
  const rawText = bodyEditor.getValue();
  if (!rawText.trim()) return;

  const formatted = prettifyContent(rawText, rawType, 2);
  if (formatted && formatted !== rawText) {
    bodyEditor.setValue(formatted, -1);
    const typeLabel = rawType === 'application/json' ? 'JSON'
      : rawType === 'application/xml' ? 'XML'
      : rawType === 'text/html' ? 'HTML' : 'Text';
    showToast(`Formatted ${typeLabel} body`, 'success');
  } else if (rawType === 'application/json') {
    try {
      JSON.parse(rawText);
      showToast('JSON body is already formatted', 'info');
    } catch (err) {
      showToast(`Cannot format JSON: ${err.message}`, 'error');
    }
  } else {
    showToast('Body is already formatted', 'info');
  }
}

/**
 * Switch/Re-render Response Pretty View by selected language format
 */
function updateResponsePrettyView(type = 'auto') {
  const tab = getActiveTab();
  if (!tab || !tab.response) return;
  const rawBody = typeof tab.response.body === 'string' ? tab.response.body : (tab.response.body ? JSON.stringify(tab.response.body, null, 2) : '');
  if (!rawBody) return;

  const prettySelect = document.getElementById('resp-pretty-type');
  const targetType = type === 'auto' ? (prettySelect ? prettySelect.value : 'auto') : type;

  let effectiveType = targetType;
  if (targetType === 'auto') {
    const trimmed = rawBody.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      effectiveType = 'json';
    } else if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
      effectiveType = trimmed.toLowerCase().startsWith('<!doctype html') || trimmed.toLowerCase().startsWith('<html') ? 'html' : 'xml';
    } else {
      effectiveType = 'text';
    }
  }

  let formatted = rawBody;
  if (effectiveType === 'json') {
    responseEditor.session.setMode('ace/mode/json');
    formatted = formatJSON(rawBody, 2);
  } else if (effectiveType === 'xml') {
    responseEditor.session.setMode('ace/mode/xml');
    formatted = formatXML(rawBody, 2);
  } else if (effectiveType === 'html') {
    responseEditor.session.setMode('ace/mode/html');
    formatted = formatHTML(rawBody, 2);
  } else {
    responseEditor.session.setMode('ace/mode/text');
    formatted = rawBody;
  }

  responseEditor.setValue(formatted, -1);
  responseEditor.resize();
}

/**
 * Render API execution response payloads
 */
function renderResponseUI(resp, testResults) {
  document.getElementById('response-empty-state').classList.add('hidden');
  document.getElementById('response-content-area').classList.remove('hidden');

  const activeRespTab = document.querySelector('.response-tab.active');
  const isBodyTab = !activeRespTab || activeRespTab.dataset.respTab === 'body';
  document.getElementById('resp-body-controls').classList.toggle('hidden', !isBodyTab);

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
  document.getElementById('resp-size').innerText = formatBytes(resp.size || 0);

  // Pretty mode content type formatting
  const rawHeaders = resp.headers || {};
  const contentTypeKey = Object.keys(rawHeaders).find(k => k.toLowerCase() === 'content-type');
  const contentType = contentTypeKey ? String(rawHeaders[contentTypeKey]).toLowerCase() : '';
  const bodyStr = typeof resp.body === 'string' ? resp.body : (resp.body ? JSON.stringify(resp.body, null, 2) : '');
  const trimmedBody = bodyStr.trim();
  const looksLikeJson = (trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) ||
                        (trimmedBody.startsWith('[') && trimmedBody.endsWith(']'));
  const looksLikeXml = trimmedBody.startsWith('<') && trimmedBody.endsWith('>');

  let detectedType = 'text';
  let formattedBody = bodyStr;

  if (contentType.includes('json') || looksLikeJson) {
    detectedType = 'json';
    responseEditor.session.setMode('ace/mode/json');
    formattedBody = formatJSON(bodyStr, 2);
  } else if (contentType.includes('xml') || (!contentType.includes('html') && looksLikeXml)) {
    detectedType = 'xml';
    responseEditor.session.setMode('ace/mode/xml');
    formattedBody = formatXML(bodyStr, 2);
  } else if (contentType.includes('html')) {
    detectedType = 'html';
    responseEditor.session.setMode('ace/mode/html');
    formattedBody = formatHTML(bodyStr, 2);
  } else {
    responseEditor.session.setMode('ace/mode/text');
  }

  responseEditor.setValue(formattedBody, -1);
  responseEditor.resize();

  const prettySelect = document.getElementById('resp-pretty-type');
  if (prettySelect) prettySelect.value = detectedType;

  // Raw & Preview UI frames
  const rawEl = document.getElementById('response-raw-text');
  if (rawEl) rawEl.value = bodyStr;

  const iframe = document.getElementById('response-preview-frame');
  if (iframe) iframe.srcdoc = bodyStr;

  // Headers tables rendering (escaped against XSS)
  const headersBody = document.getElementById('response-headers-body');
  headersBody.innerHTML = '';
  const headerKeys = Object.keys(rawHeaders);
  const respHeadersBadge = document.getElementById('resp-headers-badge-count');
  if (respHeadersBadge) respHeadersBadge.innerText = headerKeys.length;
  headerKeys.forEach(key => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="code-font" style="color: var(--text-muted); font-weight: 500;">${escapeHTML(key)}</td>
      <td class="code-font">${escapeHTML(String(rawHeaders[key]))}</td>
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

  const searchInput = document.getElementById('history-search');
  const filterQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';

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

  const filtered = filterQuery
    ? historyList.filter(item =>
        (item.url || '').toLowerCase().includes(filterQuery) ||
        (item.method || '').toLowerCase().includes(filterQuery) ||
        String(item.status || '').includes(filterQuery)
      )
    : historyList;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-magnifying-glass"></i>
        <p>No history matches "${escapeHTML(filterQuery)}".</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';

    let methodClass = 'method-badge-other';
    const method = (item.method || 'GET').toLowerCase();
    if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
      methodClass = `method-badge-${method}`;
    }

    const safeUrl = escapeHTML(item.url || '');
    const safeMethod = escapeHTML(item.method || 'GET');

    div.innerHTML = `
      <div class="history-details">
        <div style="display: flex; align-items: center; overflow: hidden;">
          <span class="history-method ${methodClass}">${safeMethod}</span>
          <span class="history-url" title="${safeUrl}">${safeUrl}</span>
        </div>
        <span class="history-meta">Status: ${escapeHTML(String(item.status || 'Error'))} • Latency: ${Number(item.time) || 0}ms</span>
      </div>
    `;

    // Click history item restores values to active request tab
    div.addEventListener('click', () => {
      const activeTab = getActiveTab();
      if (activeTab) {
        activeTab.url = item.url;
        activeTab.method = item.method;
        activeTab.params = parseUrlParams(item.url);
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
  saveActiveEnvId(id);
  document.getElementById('active-env-select').value = activeEnvId;
  renderEnvironmentsList();
  populateRunnerSelects();
};

window.deleteEnvironment = async function(id) {
  if (await showConfirmDialog('Delete Environment', 'Are you sure you want to delete this environment?')) {
    environments = environments.filter(e => e.id !== id);
    if (activeEnvId === id) saveActiveEnvId('globals');
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
          const initial = v.initialValue !== undefined ? v.initialValue : (v.value || '');
          const current = v.value !== undefined ? v.value : '';
          appendVariableRowToModal(v.key, initial, current, v.enabled !== false);
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

  const initialInput = row.querySelector('.var-initial');
  const currentInput = row.querySelector('.var-current');
  let currentTouched = currentVal !== '' || initialVal !== '';
  currentInput.addEventListener('input', () => { currentTouched = true; });
  initialInput.addEventListener('input', () => {
    if (!currentTouched) {
      currentInput.value = initialInput.value;
    }
  });

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
    showToast('Environment name is required.', 'error');
    document.getElementById('env-name-input').focus();
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
        globalsUpdate[key] = current !== '' ? current : initial;
      } else {
        variables.push({
          key,
          initialValue: initial,
          value: current !== '' ? current : (initial || ''),
          enabled
        });
      }
    }
  });

  if (editingEnvId === 'globals') {
    globals = globalsUpdate;
    saveGlobals();
  } else if (editingEnvId === null) {
    const newId = `env-${Date.now()}`;
    environments.push({
      id: newId,
      name: nameVal,
      variables
    });
    saveEnvironments();
    saveActiveEnvId(newId);
    document.getElementById('active-env-select').value = newId;
  } else {
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
  if (typeof refreshVariableHighlights === 'function') refreshVariableHighlights();
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
      showToast('Please select a collection first or create one.', 'error');
      return;
    }
    if (!nameVal) {
      showToast('Request name is required.', 'error');
      document.getElementById('save-req-name').focus();
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
          params: activeTab.params,
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
  document.getElementById('btn-new-collection').addEventListener('click', async () => {
    const name = await showPromptDialog('New Collection', 'e.g. Payments API');
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
      showToast(`Collection "${newColl.name}" created`, 'success');
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
          showToast(`Successfully imported collection: "${importedColl.name}"`, 'success');
        } else {
          showAlertDialog('Could not parse JSON. Make sure it is a valid Postman or ExpressPost collection export.', 'Import Failed');
        }
      } catch (err) {
        showAlertDialog(`Error importing file: ${err.message}`, 'Import Error');
      }
    };
    reader.readAsText(file);
    importInput.value = ''; // clear
  });

  // Setup sidebar tree deletions, context menus & request loadings
  const sidebarContainer = document.getElementById('collections-list');

  sidebarContainer.addEventListener('contextmenu', (e) => {
    const header = e.target.closest('.coll-folder-header');
    if (header && header.dataset.id) {
      e.preventDefault();
      openCollectionContextMenu(header.dataset.id, e.clientX, e.clientY);
    }
  });

  sidebarContainer.addEventListener('click', async (e) => {
    const target = e.target;

    const moreCollBtn = target.closest('.btn-coll-more');
    if (moreCollBtn) {
      e.stopPropagation();
      const rect = moreCollBtn.getBoundingClientRect();
      openCollectionContextMenu(moreCollBtn.dataset.id, rect.right, rect.bottom + 4);
      return;
    }

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
      confirmAndDeleteCollection(delCollBtn.dataset.id);
      return;
    }

    // 2. Add empty request directly to collection
    const addReqBtn = target.closest('.btn-add-req-to-coll');
    if (addReqBtn) {
      e.stopPropagation();
      addEmptyRequestToCollection(addReqBtn.dataset.id);
      return;
    }

    // 3. Edit collection settings / variables
    const editCollVarsBtn = target.closest('.btn-edit-coll-vars');
    if (editCollVarsBtn) {
      e.stopPropagation();
      openCollectionSettingsModal(editCollVarsBtn.dataset.id);
      return;
    }

    // 4. Open collection directly in Collection Runner
    const runCollBtn = target.closest('.btn-run-coll-direct');
    if (runCollBtn) {
      e.stopPropagation();
      const collId = runCollBtn.dataset.id;
      document.getElementById('btn-open-runner').click();
      const runnerCollSelect = document.getElementById('runner-select-collection');
      runnerCollSelect.value = collId;
      renderRunnerRequestList(collId);
      return;
    }

    // 5. Load request from sidebar into workspace tabs (or focus existing tab)
    if (target.closest('.coll-req-actions')) return;
    const reqItem = target.closest('.coll-req-item');
    if (reqItem) {
      const reqId = reqItem.dataset.id;
      const collId = reqItem.dataset.collId;
      const existingTab = tabs.find(t =>
        String(t.savedCollectionId) === String(collId) &&
        String(t.savedRequestId) === String(reqId)
      );
      if (existingTab) {
        switchActiveTab(existingTab.id);
        renderTabsUI();
        return;
      }

      const coll = collections.find(c => String(c.id) === String(collId));
      if (coll && coll.requests) {
        const req = coll.requests.find(r => String(r.id) === String(reqId));
        if (req) {
          createNewTab({
            ...req,
            savedCollectionId: coll.id,
            savedRequestId: req.id,
            params: Array.isArray(req.params) ? req.params : parseUrlParams(req.url || ''),
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
      const rawPaneActive = document.getElementById('resp-raw-pane')?.classList.contains('active');
      const rawTextEl = document.getElementById('response-raw-text');
      const textToCopy = rawPaneActive
        ? (rawTextEl ? rawTextEl.value : '')
        : (responseEditor && typeof responseEditor.getValue === 'function' ? responseEditor.getValue() : (rawTextEl ? rawTextEl.value : ''));

      if (textToCopy) {
        copyTextWithFeedback(textToCopy, copyBtn, '<i class="fa-solid fa-check"></i>');
      }
    });
  }

  const downloadRespBtn = document.getElementById('btn-download-response');
  if (downloadRespBtn) {
    downloadRespBtn.addEventListener('click', () => {
      const tab = getActiveTab();
      const resp = tab && tab.response;
      if (!resp) return;
      const headers = resp.headers || {};
      const ctKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
      const ct = ctKey ? String(headers[ctKey]).toLowerCase() : '';
      const ext = ct.includes('json') ? 'json' : ct.includes('html') ? 'html' : ct.includes('xml') ? 'xml' : 'txt';
      const blob = new Blob([resp.body || ''], { type: ct || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `response-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

});

function copyTextWithFeedback(text, buttonEl, successHtml) {
  const applyFeedback = () => {
    if (!buttonEl) return;
    const originalHtml = buttonEl.innerHTML;
    buttonEl.innerHTML = successHtml;
    buttonEl.style.color = 'var(--accent)';
    setTimeout(() => {
      buttonEl.innerHTML = originalHtml;
      buttonEl.style.color = '';
    }, 1500);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(applyFeedback).catch(() => {
      fallbackCopy(text);
      applyFeedback();
    });
  } else {
    fallbackCopy(text);
    applyFeedback();
  }
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    // ignore
  }
  area.remove();
}

/**
 * Import from cURL Modal
 */
function setupCurlImportListeners() {
  const openBtn = document.getElementById('btn-import-curl');
  const modal = document.getElementById('modal-import-curl');
  const input = document.getElementById('curl-import-input');
  const errorEl = document.getElementById('curl-import-error');
  const closeBtn = document.getElementById('btn-close-curl-modal');
  const cancelBtn = document.getElementById('btn-cancel-curl-import');
  const importNewBtn = document.getElementById('btn-confirm-curl-new');
  const importCurrentBtn = document.getElementById('btn-confirm-curl-current');

  if (!openBtn || !modal) return;

  const closeModal = () => {
    modal.classList.add('hidden');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }
  };

  openBtn.addEventListener('click', () => {
    if (errorEl) errorEl.classList.add('hidden');
    modal.classList.remove('hidden');
    if (input) input.focus();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  const handleImport = (intoNewTab) => {
    try {
      const parsed = parseCurlCommand(input ? input.value : '');
      const params = parseUrlParams(parsed.url);
      if (intoNewTab) {
        createNewTab({
          ...parsed,
          params
        });
      } else {
        const activeTab = getActiveTab();
        if (!activeTab) {
          createNewTab({ ...parsed, params });
        } else {
          activeTab.name = parsed.name;
          activeTab.method = parsed.method;
          activeTab.url = parsed.url;
          activeTab.params = params;
          activeTab.headers = parsed.headers.length > 0 ? parsed.headers : [{ key: '', value: '', enabled: true, description: '' }];
          activeTab.auth = {
            type: 'none',
            bearerToken: '',
            username: '',
            password: '',
            key: '',
            value: '',
            in: 'header',
            ...(parsed.auth || {})
          };
          activeTab.bodyType = parsed.bodyType || 'none';
          activeTab.bodyRawType = parsed.bodyRawType || 'application/json';
          activeTab.body = parsed.body || '';
          activeTab.formdata = parsed.formdata || [];
          activeTab.urlencoded = parsed.urlencoded || [];
          saveTabsState();
          renderTabsUI();
          switchActiveTab(activeTab.id);
        }
      }
      if (input) input.value = '';
      closeModal();
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      } else {
        showToast(err.message, 'error');
      }
    }
  };

  if (importNewBtn) importNewBtn.addEventListener('click', () => handleImport(true));
  if (importCurrentBtn) importCurrentBtn.addEventListener('click', () => handleImport(false));
}

/**
 * Mock Server Management & Server Sync
 */
let mocks = [];
let editingMockId = null;

function setupMockServerListeners() {
  const stored = localStorage.getItem('expresspost_mocks');
  if (stored) {
    try {
      mocks = JSON.parse(stored);
      if (!Array.isArray(mocks)) mocks = [];
    } catch (e) {
      mocks = [];
    }
  } else {
    mocks = [
      {
        id: 'mock-sample-1',
        method: 'GET',
        path: '/hello',
        status: 200,
        contentType: 'application/json',
        delay: 0,
        enabled: true,
        headers: [{ key: 'X-Mock-Source', value: 'ExpressPost', enabled: true }],
        body: JSON.stringify({ message: 'Hello from ExpressPost Mock Server!', ok: true }, null, 2)
      }
    ];
    localStorage.setItem('expresspost_mocks', JSON.stringify(mocks));
  }

  renderMocksList();
  syncMocksToServer(false);

  const newMockBtn = document.getElementById('btn-new-mock');
  const syncBtn = document.getElementById('btn-sync-mocks');
  const modal = document.getElementById('modal-mock');
  const closeBtn = document.getElementById('btn-close-mock-modal');
  const cancelBtn = document.getElementById('btn-cancel-mock-modal');
  const saveBtn = document.getElementById('btn-save-mock');
  const addHeaderBtn = document.getElementById('btn-add-mock-header');

  if (newMockBtn) newMockBtn.addEventListener('click', () => openMockModal(null));
  if (syncBtn) syncBtn.addEventListener('click', () => syncMocksToServer(true));
  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }
  if (addHeaderBtn) {
    addHeaderBtn.addEventListener('click', () => appendMockHeaderRow('', '', true));
  }
  if (saveBtn) saveBtn.addEventListener('click', saveMockFromModal);
}

function saveMocksLocal() {
  localStorage.setItem('expresspost_mocks', JSON.stringify(mocks));
}

async function syncMocksToServer(showFeedback = false) {
  const syncBtn = document.getElementById('btn-sync-mocks');
  try {
    const response = await fetch(`${window.location.origin}/api/mocks/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mocks })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);

    if (showFeedback && syncBtn) {
      const orig = syncBtn.innerHTML;
      syncBtn.innerHTML = `<i class="fa-solid fa-check"></i> Synced (${data.count || 0})`;
      setTimeout(() => { syncBtn.innerHTML = orig; }, 1800);
    }
  } catch (err) {
    if (showFeedback) {
      showToast(`Failed to sync mocks with server: ${err.message}`, 'error');
    }
  }
}

function renderMocksList() {
  const hintEl = document.getElementById('mock-base-url-hint');
  if (hintEl) {
    hintEl.innerHTML = `Base: <code>${escapeHTML(window.location.origin)}/mock/...</code>`;
  }

  const container = document.getElementById('mocks-list');
  if (!container) return;

  if (mocks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-server"></i>
        <p>No mocks configured yet</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  mocks.forEach(mock => {
    const div = document.createElement('div');
    div.className = 'mock-list-item';
    if (mock.enabled === false) div.style.opacity = '0.6';

    const method = (mock.method || 'GET').toUpperCase();
    const methodLower = method.toLowerCase();
    const methodClass = ['get', 'post', 'put', 'delete', 'patch'].includes(methodLower)
      ? `method-badge-${methodLower}`
      : 'method-badge-other';
    const cleanPath = (mock.path || '/').startsWith('/') ? mock.path : `/${mock.path}`;
    const fullMockPath = `/mock${cleanPath}`;
    const fullMockUrl = `${window.location.origin}${fullMockPath}`;

    div.innerHTML = `
      <div class="mock-route-info" title="Click to open in new request tab">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="history-method ${methodClass}">${escapeHTML(method)}</span>
          <span class="mock-route-path">${escapeHTML(fullMockPath)}</span>
        </div>
        <div class="mock-route-meta">
          <span>Status: ${Number(mock.status) || 200}</span>
          <span>${escapeHTML(mock.contentType || 'application/json')}</span>
          ${mock.enabled === false ? '<span style="color: var(--warning);">Disabled</span>' : ''}
        </div>
      </div>
      <div class="mock-item-actions" style="display: flex; gap: 2px; flex-shrink: 0;">
        <button class="icon-btn btn-copy-mock-url" title="Copy Mock URL"><i class="fa-regular fa-copy"></i></button>
        <button class="icon-btn btn-test-mock" title="Open in Request Tab"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
        <button class="icon-btn btn-edit-mock" title="Edit Mock"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="icon-btn btn-delete-mock" title="Delete Mock"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;

    const openInTab = () => {
      createNewTab({
        name: `Mock: ${method} ${cleanPath}`,
        method,
        url: fullMockUrl,
        engine: 'proxy'
      });
    };

    div.querySelector('.mock-route-info').addEventListener('click', openInTab);
    div.querySelector('.btn-copy-mock-url').addEventListener('click', (e) => {
      e.stopPropagation();
      copyTextWithFeedback(fullMockUrl, e.currentTarget, '<i class="fa-solid fa-check"></i>');
      showToast('Copied mock URL to clipboard', 'success');
    });
    div.querySelector('.btn-test-mock').addEventListener('click', (e) => {
      e.stopPropagation();
      openInTab();
    });
    div.querySelector('.btn-edit-mock').addEventListener('click', (e) => {
      e.stopPropagation();
      openMockModal(mock.id);
    });
    div.querySelector('.btn-delete-mock').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await showConfirmDialog('Delete Mock', `Delete mock ${method} ${fullMockPath}?`)) {
        mocks = mocks.filter(m => String(m.id) !== String(mock.id));
        saveMocksLocal();
        renderMocksList();
        syncMocksToServer(false);
      }
    });

    container.appendChild(div);
  });
}

function appendMockHeaderRow(key = '', value = '', enabled = true) {
  const tbody = document.getElementById('mock-headers-body');
  if (!tbody) return;
  const row = document.createElement('tr');
  row.innerHTML = `
    <td class="checkbox-cell"><input type="checkbox" class="mock-header-enabled" ${enabled ? 'checked' : ''}></td>
    <td><input type="text" class="mock-header-key code-font" placeholder="Header Key" value="${escapeHTML(key)}"></td>
    <td><input type="text" class="mock-header-value code-font" placeholder="Header Value" value="${escapeHTML(value)}"></td>
    <td><button type="button" class="icon-btn mock-header-del"><i class="fa-solid fa-trash-can"></i></button></td>
  `;
  row.querySelector('.mock-header-del').addEventListener('click', () => row.remove());
  tbody.appendChild(row);
}

function openMockModal(mockId) {
  editingMockId = mockId;
  const modal = document.getElementById('modal-mock');
  const title = document.getElementById('mock-modal-title');
  const headersBody = document.getElementById('mock-headers-body');
  headersBody.innerHTML = '';

  const mock = mockId ? mocks.find(m => String(m.id) === String(mockId)) : null;
  if (mock) {
    title.textContent = 'Edit Mock Endpoint';
    document.getElementById('mock-method').value = mock.method || 'GET';
    document.getElementById('mock-path').value = mock.path || '/';
    document.getElementById('mock-status').value = mock.status || 200;
    document.getElementById('mock-content-type').value = mock.contentType || 'application/json';
    document.getElementById('mock-delay').value = mock.delay || 0;
    document.getElementById('mock-enabled').checked = mock.enabled !== false;
    document.getElementById('mock-body').value = mock.body || '';
    (mock.headers || []).forEach(h => appendMockHeaderRow(h.key, h.value, h.enabled !== false));
  } else {
    title.textContent = 'New Mock Endpoint';
    document.getElementById('mock-method').value = 'GET';
    document.getElementById('mock-path').value = '/users';
    document.getElementById('mock-status').value = 200;
    document.getElementById('mock-content-type').value = 'application/json';
    document.getElementById('mock-delay').value = 0;
    document.getElementById('mock-enabled').checked = true;
    document.getElementById('mock-body').value = '{\n  "ok": true\n}';
  }

  modal.classList.remove('hidden');
  document.getElementById('mock-path').focus();
}

function saveMockFromModal() {
  let pathVal = document.getElementById('mock-path').value.trim();
  if (!pathVal) {
    showToast('Mock endpoint path is required.', 'error');
    document.getElementById('mock-path').focus();
    return;
  }
  if (!pathVal.startsWith('/')) pathVal = '/' + pathVal;

  const method = document.getElementById('mock-method').value.toUpperCase();
  const status = Math.min(Math.max(parseInt(document.getElementById('mock-status').value, 10) || 200, 100), 599);
  const contentType = document.getElementById('mock-content-type').value;
  const delay = Math.min(Math.max(parseInt(document.getElementById('mock-delay').value, 10) || 0, 0), 10000);
  const enabled = document.getElementById('mock-enabled').checked;
  const body = document.getElementById('mock-body').value;

  const headers = [];
  document.querySelectorAll('#mock-headers-body tr').forEach(tr => {
    const key = tr.querySelector('.mock-header-key').value.trim();
    const value = tr.querySelector('.mock-header-value').value;
    const hEnabled = tr.querySelector('.mock-header-enabled').checked;
    if (key) headers.push({ key, value, enabled: hEnabled });
  });

  if (editingMockId) {
    const existing = mocks.find(m => String(m.id) === String(editingMockId));
    if (existing) {
      Object.assign(existing, { method, path: pathVal, status, contentType, delay, enabled, headers, body });
    }
  } else {
    mocks.push({
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      method,
      path: pathVal,
      status,
      contentType,
      delay,
      enabled,
      headers,
      body
    });
  }

  saveMocksLocal();
  renderMocksList();
  syncMocksToServer(true);
  document.getElementById('modal-mock').classList.add('hidden');
}

/**
 * Collection Settings & Collection Variables Modal
 */
let editingCollId = null;

function setupCollectionSettingsListeners() {
  const modal = document.getElementById('modal-collection-vars');
  const closeBtn = document.getElementById('btn-close-coll-vars');
  const cancelBtn = document.getElementById('btn-cancel-coll-vars');
  const addBtn = document.getElementById('btn-add-coll-var');
  const saveBtn = document.getElementById('btn-save-coll-vars');
  const deleteBtn = document.getElementById('btn-delete-coll-modal');

  if (!modal) return;

  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
  if (addBtn) addBtn.addEventListener('click', () => appendCollectionVarRow('', ''));
  if (saveBtn) saveBtn.addEventListener('click', saveCollectionSettingsModal);
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const targetId = editingCollId;
      modal.classList.add('hidden');
      if (targetId != null) {
        await confirmAndDeleteCollection(targetId);
      }
    });
  }
}

async function addEmptyRequestToCollection(collId) {
  const name = await showPromptDialog('New Request', 'e.g. Get User Profile');
  if (!name || !name.trim()) return;
  const coll = collections.find(c => String(c.id) === String(collId));
  if (!coll) return;
  coll.isExpanded = true;
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

async function renameCollectionById(collId) {
  const coll = collections.find(c => String(c.id) === String(collId));
  if (!coll) return;
  const nextName = await showPromptDialog('Rename Collection', 'Collection name', coll.name || '');
  if (!nextName || !nextName.trim()) return;
  coll.name = nextName.trim();
  saveCollections();
  renderCollections();
  populateRunnerSelects();
  showToast(`Renamed collection to "${coll.name}".`, 'success');
}

function duplicateCollectionById(collId) {
  const coll = collections.find(c => String(c.id) === String(collId));
  if (!coll) return;
  const copy = JSON.parse(JSON.stringify(coll));
  copy.id = `coll-${Date.now()}`;
  copy.name = `${coll.name} (Copy)`;
  if (Array.isArray(copy.requests)) {
    copy.requests = copy.requests.map((r, idx) => ({ ...r, id: `req-${Date.now()}-${idx}` }));
  }
  collections.push(copy);
  saveCollections();
  renderCollections();
  populateRunnerSelects();
  showToast(`Duplicated "${coll.name}".`, 'success');
}

async function confirmAndDeleteCollection(collId) {
  const coll = collections.find(c => String(c.id) === String(collId));
  if (!coll) return;
  const confirmed = await showConfirmDialog(
    'Delete Collection',
    `Delete "${coll.name}" and all ${Array.isArray(coll.requests) ? coll.requests.length : 0} request(s)?`
  );
  if (!confirmed) return;
  collections = collections.filter(c => String(c.id) !== String(collId));
  tabs.forEach(t => {
    if (String(t.savedCollectionId) === String(collId)) {
      t.savedCollectionId = null;
      t.savedRequestId = null;
    }
  });
  saveTabsState();
  saveCollections();
  renderCollections();
  populateRunnerSelects();
  showToast(`Deleted collection "${coll.name}".`, 'info');
}

function closeCollectionContextMenu() {
  const menu = document.getElementById('collection-context-menu');
  if (menu) menu.classList.add('hidden');
}

function openCollectionContextMenu(collId, clientX, clientY) {
  const menu = document.getElementById('collection-context-menu');
  const coll = collections.find(c => String(c.id) === String(collId));
  if (!menu || !coll) return;

  menu.innerHTML = `
    <button type="button" class="coll-menu-item" data-action="add-req"><i class="fa-solid fa-file-circle-plus"></i><span>Add Request</span></button>
    <button type="button" class="coll-menu-item" data-action="run"><i class="fa-solid fa-circle-play"></i><span>Run Collection</span></button>
    <button type="button" class="coll-menu-item" data-action="settings"><i class="fa-solid fa-sliders"></i><span>Settings & Variables</span></button>
    <button type="button" class="coll-menu-item" data-action="rename"><i class="fa-solid fa-pen"></i><span>Rename</span></button>
    <button type="button" class="coll-menu-item" data-action="duplicate"><i class="fa-regular fa-copy"></i><span>Duplicate</span></button>
    <button type="button" class="coll-menu-item" data-action="export"><i class="fa-solid fa-file-export"></i><span>Export JSON</span></button>
    <div class="coll-menu-divider"></div>
    <button type="button" class="coll-menu-item danger" data-action="delete"><i class="fa-solid fa-trash-can"></i><span>Delete Collection</span></button>
  `;

  menu.querySelectorAll('.coll-menu-item').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const action = btn.dataset.action;
      closeCollectionContextMenu();
      if (action === 'add-req') addEmptyRequestToCollection(collId);
      else if (action === 'run') {
        document.getElementById('btn-open-runner').click();
        const runnerCollSelect = document.getElementById('runner-select-collection');
        runnerCollSelect.value = collId;
        renderRunnerRequestList(collId);
      } else if (action === 'settings') openCollectionSettingsModal(collId);
      else if (action === 'rename') renameCollectionById(collId);
      else if (action === 'duplicate') duplicateCollectionById(collId);
      else if (action === 'export') exportCollection(collId);
      else if (action === 'delete') confirmAndDeleteCollection(collId);
    });
  });

  menu.classList.remove('hidden');
  const margin = 10;
  const w = menu.offsetWidth || 200;
  const h = menu.offsetHeight || 240;
  const left = Math.max(margin, Math.min(clientX - 12, window.innerWidth - w - margin));
  const top = Math.max(margin, Math.min(clientY, window.innerHeight - h - margin));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('collection-context-menu');
  if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !e.target.closest('.btn-coll-more')) {
    closeCollectionContextMenu();
  }
});

function appendCollectionVarRow(key = '', value = '') {
  const tbody = document.getElementById('coll-vars-body');
  if (!tbody) return;
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="text" class="coll-var-key code-font" placeholder="Variable Key" value="${escapeHTML(key)}"></td>
    <td><input type="text" class="coll-var-val code-font" placeholder="Value" value="${escapeHTML(value)}"></td>
    <td><button type="button" class="icon-btn coll-var-del"><i class="fa-solid fa-trash-can"></i></button></td>
  `;
  row.querySelector('.coll-var-del').addEventListener('click', () => row.remove());
  tbody.appendChild(row);
}

function openCollectionSettingsModal(collId) {
  const coll = collections.find(c => String(c.id) === String(collId));
  if (!coll) return;
  editingCollId = coll.id;

  document.getElementById('coll-settings-name').value = coll.name || '';
  const tbody = document.getElementById('coll-vars-body');
  tbody.innerHTML = '';

  const vars = coll.variables;
  if (Array.isArray(vars)) {
    vars.forEach(v => appendCollectionVarRow(v.key || '', v.value || ''));
  } else if (vars && typeof vars === 'object') {
    Object.entries(vars).forEach(([k, v]) => appendCollectionVarRow(k, v));
  }
  if (tbody.children.length === 0) appendCollectionVarRow('', '');

  document.getElementById('modal-collection-vars').classList.remove('hidden');
}

function saveCollectionSettingsModal() {
  const coll = collections.find(c => String(c.id) === String(editingCollId));
  if (!coll) return;

  const newName = document.getElementById('coll-settings-name').value.trim();
  if (!newName) {
    showToast('Collection name is required.', 'error');
    document.getElementById('coll-settings-name').focus();
    return;
  }

  const newVars = {};
  document.querySelectorAll('#coll-vars-body tr').forEach(tr => {
    const key = tr.querySelector('.coll-var-key').value.trim();
    const val = tr.querySelector('.coll-var-val').value;
    if (key) newVars[key] = val;
  });

  coll.name = newName;
  coll.variables = newVars;
  saveCollections();
  renderCollections();
  populateRunnerSelects();
  document.getElementById('modal-collection-vars').classList.add('hidden');
  if (typeof refreshVariableHighlights === 'function') refreshVariableHighlights();
}

/**
 * Global Keyboard Shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
      ['modal-import-curl', 'modal-mock', 'modal-collection-vars', 'snippet-modal', 'variable-popover', 'variable-autocomplete', 'collection-context-menu'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendActiveRequest();
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      document.getElementById('btn-save-request')?.click();
    }
  });
}

/**
 * Postman-style Inline {{variable}} Highlighter, Hover/Click Inspector, & {{ Autocomplete
 */
let variableTextMeasureCtx = null;
const aceVariableMarkerIds = new WeakMap();

function getVariableMeasureContext(el) {
  if (!variableTextMeasureCtx) {
    const canvas = document.createElement('canvas');
    variableTextMeasureCtx = canvas.getContext('2d');
  }
  const style = window.getComputedStyle(el);
  const font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  variableTextMeasureCtx.font = font;
  return { ctx: variableTextMeasureCtx, style };
}

function inspectVariableAcrossScopes(varName) {
  const activeEnv = activeEnvId !== 'globals'
    ? environments.find(e => String(e.id) === String(activeEnvId))
    : null;
  const activeTab = typeof getActiveTab === 'function' ? getActiveTab() : null;
  const activeColl = activeTab && activeTab.savedCollectionId
    ? collections.find(c => String(c.id) === String(activeTab.savedCollectionId))
    : null;

  let resolvedScope = null;
  let resolvedValue = '';
  let initialValue = undefined;
  let scopeSourceName = '';

  if (activeEnv && Array.isArray(activeEnv.variables)) {
    const found = activeEnv.variables.find(v => v.key === varName && v.enabled !== false);
    if (found) {
      resolvedScope = 'env';
      resolvedValue = found.value ?? '';
      initialValue = found.initialValue !== undefined ? String(found.initialValue) : String(resolvedValue);
      scopeSourceName = activeEnv.name || 'Environment';
    }
  }

  if (!resolvedScope && activeColl && activeColl.variables) {
    const vars = activeColl.variables;
    if (Array.isArray(vars)) {
      const found = vars.find(v => v.key === varName && v.enabled !== false);
      if (found) {
        resolvedScope = 'collection';
        resolvedValue = found.value ?? '';
        scopeSourceName = activeColl.name || 'Collection';
      }
    } else if (typeof vars === 'object' && Object.prototype.hasOwnProperty.call(vars, varName)) {
      resolvedScope = 'collection';
      resolvedValue = vars[varName] ?? '';
      scopeSourceName = activeColl.name || 'Collection';
    }
  }

  if (!resolvedScope && Object.prototype.hasOwnProperty.call(globals, varName)) {
    resolvedScope = 'globals';
    resolvedValue = globals[varName] ?? '';
    scopeSourceName = 'Globals';
  }

  return {
    varName,
    resolvedScope,
    resolvedValue: resolvedValue == null ? '' : String(resolvedValue),
    initialValue,
    scopeSourceName,
    activeEnv,
    activeColl
  };
}

function collectAllAvailableVariables() {
  const seen = new Map();
  const activeEnv = activeEnvId !== 'globals'
    ? environments.find(e => String(e.id) === String(activeEnvId))
    : null;
  const activeTab = typeof getActiveTab === 'function' ? getActiveTab() : null;
  const activeColl = activeTab && activeTab.savedCollectionId
    ? collections.find(c => String(c.id) === String(activeTab.savedCollectionId))
    : null;

  if (activeEnv && Array.isArray(activeEnv.variables)) {
    activeEnv.variables.forEach(v => {
      if (v.enabled !== false && v.key && !seen.has(v.key)) {
        seen.set(v.key, { key: v.key, value: String(v.value ?? ''), scope: 'env', badge: 'E', source: activeEnv.name });
      }
    });
  }

  if (activeColl && activeColl.variables) {
    const vars = activeColl.variables;
    if (Array.isArray(vars)) {
      vars.forEach(v => {
        if (v.enabled !== false && v.key && !seen.has(v.key)) {
          seen.set(v.key, { key: v.key, value: String(v.value ?? ''), scope: 'collection', badge: 'C', source: activeColl.name });
        }
      });
    } else if (typeof vars === 'object') {
      Object.entries(vars).forEach(([k, val]) => {
        if (k && !seen.has(k)) {
          seen.set(k, { key: k, value: String(val ?? ''), scope: 'collection', badge: 'C', source: activeColl.name });
        }
      });
    }
  }

  Object.entries(globals || {}).forEach(([k, val]) => {
    if (k && !seen.has(k)) {
      seen.set(k, { key: k, value: String(val ?? ''), scope: 'globals', badge: 'G', source: 'Globals' });
    }
  });

  return Array.from(seen.values());
}

function saveVariableValueToScope(varName, scope, value) {
  if (scope === 'env') {
    const activeEnv = activeEnvId !== 'globals'
      ? environments.find(e => String(e.id) === String(activeEnvId))
      : null;
    if (!activeEnv) return null;
    if (!Array.isArray(activeEnv.variables)) activeEnv.variables = [];
    const existing = activeEnv.variables.find(v => v.key === varName);
    if (existing) {
      existing.value = value;
      existing.enabled = true;
      if (existing.initialValue === undefined) existing.initialValue = value;
    } else {
      activeEnv.variables.push({
        key: varName,
        initialValue: value,
        value,
        enabled: true
      });
    }
    saveEnvironments();
    renderEnvironmentsList();
    populateRunnerSelects();
    return `Environment "${activeEnv.name}"`;
  }

  if (scope === 'collection') {
    const activeTab = typeof getActiveTab === 'function' ? getActiveTab() : null;
    const activeColl = activeTab && activeTab.savedCollectionId
      ? collections.find(c => String(c.id) === String(activeTab.savedCollectionId))
      : null;
    if (!activeColl) return null;
    if (Array.isArray(activeColl.variables)) {
      const existing = activeColl.variables.find(v => v.key === varName);
      if (existing) {
        existing.value = value;
        existing.enabled = true;
      } else {
        activeColl.variables.push({ key: varName, value, enabled: true });
      }
    } else {
      if (!activeColl.variables || typeof activeColl.variables !== 'object') {
        activeColl.variables = {};
      }
      activeColl.variables[varName] = value;
    }
    saveCollections();
    renderCollections();
    populateRunnerSelects();
    return `Collection "${activeColl.name}"`;
  }

  globals[varName] = value;
  saveGlobals();
  renderEnvironmentsList();
  return 'Globals';
}

function isVariableEditableInput(el) {
  if (!el || el.readOnly || el.disabled) return false;
  if (el.closest('#variable-popover, #variable-autocomplete, #modal-env, #modal-collection-vars, #modal-app-dialog, #modal-appearance, .sidebar-search')) {
    return false;
  }
  if (el.tagName === 'INPUT') {
    return ['text', 'url', 'search', 'password', ''].includes((el.type || '').toLowerCase());
  }
  return el.tagName === 'TEXTAREA' && !el.classList.contains('ace_text-input');
}

function computeInputVariableTokens(el) {
  const val = el.value || '';
  if (!val.includes('{{') || el.clientWidth <= 0) return [];
  const { ctx, style } = getVariableMeasureContext(el);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const scrollLeft = el.scrollLeft || 0;
  const minX = Math.max(2, padLeft - 2);
  const maxX = Math.max(minX, el.clientWidth - padRight + 2);

  const tokens = [];
  const regex = /\{\{([^{}]+?)\}\}/g;
  let match;
  while ((match = regex.exec(val)) !== null) {
    const name = match[1].trim();
    if (!name) continue;
    const rawStartX = padLeft + ctx.measureText(val.slice(0, match.index)).width - scrollLeft;
    const rawEndX = padLeft + ctx.measureText(val.slice(0, match.index + match[0].length)).width - scrollLeft;
    const visLeft = Math.max(minX, rawStartX - 1);
    const visRight = Math.min(maxX, rawEndX + 1);
    const info = inspectVariableAcrossScopes(name);
    tokens.push({
      name,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
      rawStartX,
      rawEndX,
      left: Math.round(visLeft),
      width: Math.max(0, Math.round(visRight - visLeft)),
      resolved: Boolean(info.resolvedScope)
    });
  }
  return tokens;
}

let openVariablePopoverBridge = null;

function syncAceVariableMarkers(editor) {
  if (!editor || typeof ace === 'undefined' || !ace.require || !editor.session || typeof editor.session.addMarker !== 'function') {
    return;
  }
  const { Range } = ace.require('ace/range') || {};
  if (!Range) return;

  const prevIds = aceVariableMarkerIds.get(editor) || [];
  prevIds.forEach(id => editor.session.removeMarker(id));

  const nextIds = [];
  const lineCount = editor.session.getLength();
  const regex = /\{\{([^{}]+?)\}\}/g;

  for (let row = 0; row < lineCount; row++) {
    const line = editor.session.getLine(row);
    if (!line || !line.includes('{{')) continue;
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const name = match[1].trim();
      if (!name) continue;
      const info = inspectVariableAcrossScopes(name);
      const cls = info.resolvedScope ? 'ace-ep-var-resolved' : 'ace-ep-var-unresolved';
      const range = new Range(row, match.index, row, match.index + match[0].length);
      nextIds.push(editor.session.addMarker(range, cls, 'text', false));
    }
  }
  aceVariableMarkerIds.set(editor, nextIds);
}

function renderUrlVariablePills() {
  const container = document.getElementById('url-var-pills');
  if (!container) return;

  const urlInput = document.getElementById('request-url');
  const val = urlInput ? urlInput.value || '' : '';
  const regex = /\{\{([^{}]+?)\}\}/g;
  const found = [];
  const seen = new Set();
  let m;

  while ((m = regex.exec(val)) !== null) {
    const name = m[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  }

  if (found.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  container.innerHTML = '';
  found.forEach(name => {
    const info = inspectVariableAcrossScopes(name);
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `url-var-pill ${info.resolvedScope ? '' : 'is-unresolved'}`;
    pill.dataset.varName = name;
    const badgeCls = info.resolvedScope ? `scope-${info.resolvedScope}` : 'scope-unresolved';
    const badgeChar = info.resolvedScope === 'env' ? 'E' : (info.resolvedScope === 'collection' ? 'C' : (info.resolvedScope === 'globals' ? 'G' : 'U'));
    const displayVal = info.resolvedScope ? (info.resolvedValue || '(empty)') : 'Set value';

    pill.innerHTML = `
      <span class="var-scope-badge ${badgeCls}">${badgeChar}</span>
      <span class="url-var-pill-name">${escapeHTML(name)}</span>
      <span class="url-var-pill-val">${escapeHTML(displayVal)}</span>
    `;

    pill.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (typeof openVariablePopoverBridge === 'function') {
        const rect = pill.getBoundingClientRect();
        openVariablePopoverBridge(name, {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        }, { focus: true, pin: true });
      }
    });

    container.appendChild(pill);
  });

  container.classList.remove('hidden');
}

function refreshVariableHighlights() {
  renderUrlVariablePills();
  [bodyEditor, preRequestEditor, testsEditor].forEach(syncAceVariableMarkers);
}

function initVariableQuickEditPopover() {
  const popover = document.getElementById('variable-popover');
  const arrowEl = document.getElementById('var-popover-arrow');
  const badgeEl = document.getElementById('var-popover-badge');
  const nameEl = document.getElementById('var-popover-name');
  const metaEl = document.getElementById('var-popover-meta');
  const initialRow = document.getElementById('var-popover-initial-row');
  const initialEl = document.getElementById('var-popover-initial');
  const resetBtn = document.getElementById('btn-reset-var-popover');
  const valueEl = document.getElementById('var-popover-value');
  const scopeEl = document.getElementById('var-popover-scope');
  const closeBtn = document.getElementById('btn-close-var-popover');
  const saveBtn = document.getElementById('btn-save-var-popover');
  const autocompleteEl = document.getElementById('variable-autocomplete');

  if (!popover || !badgeEl || !nameEl || !metaEl || !valueEl || !scopeEl) return;

  let activeVarName = null;
  let activeInitialValue = '';
  let isPinned = false;
  let hoverOpenTimer = null;
  let hoverCloseTimer = null;
  let pendingHoverKey = null;
  let ignoreOutsideClickUntil = 0;

  let acState = null; // { mode: 'dom'|'ace', target, range, items, activeIndex }

  function clearHoverTimers() {
    if (hoverOpenTimer) {
      clearTimeout(hoverOpenTimer);
      hoverOpenTimer = null;
    }
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
  }

  function closePopover() {
    clearHoverTimers();
    popover.classList.add('hidden');
    activeVarName = null;
    isPinned = false;
    pendingHoverKey = null;
    ignoreOutsideClickUntil = 0;
  }

  function scheduleHoverClose() {
    if (isPinned) return;
    if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
    hoverCloseTimer = setTimeout(() => {
      if (!isPinned) closePopover();
    }, 240);
  }

  function autoResizeValueInput() {
    valueEl.style.height = 'auto';
    const nextHeight = Math.min(130, Math.max(30, valueEl.scrollHeight));
    valueEl.style.height = `${nextHeight}px`;
  }

  function positionPopover(anchorRect) {
    const margin = 12;
    const width = popover.offsetWidth || 326;
    const height = popover.offsetHeight || 175;
    const anchorCenter = (anchorRect.left || 0) + Math.min(40, Math.max(12, ((anchorRect.right || anchorRect.left) - anchorRect.left) / 2));

    let left = Math.max(margin, Math.min(anchorCenter - 26, window.innerWidth - width - margin));
    let top = anchorRect.bottom + 8;
    let placedAbove = false;

    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, anchorRect.top - height - 8);
      placedAbove = true;
    }

    popover.classList.toggle('placed-above', placedAbove);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;

    if (arrowEl) {
      const arrowLeft = Math.max(14, Math.min(width - 24, anchorCenter - left - 5));
      arrowEl.style.left = `${Math.round(arrowLeft)}px`;
    }
  }

  function openPopoverForVariable(varName, anchorRect, { focus = false, pin = false } = {}) {
    const info = inspectVariableAcrossScopes(varName);
    activeVarName = varName;
    activeInitialValue = info.initialValue ?? '';
    isPinned = Boolean(pin);
    ignoreOutsideClickUntil = Date.now() + 140;

    nameEl.textContent = varName;
    badgeEl.className = 'var-scope-badge';
    metaEl.classList.remove('is-unresolved');

    if (info.resolvedScope === 'env') {
      badgeEl.textContent = 'E';
      badgeEl.classList.add('scope-env');
      metaEl.textContent = info.scopeSourceName;
    } else if (info.resolvedScope === 'collection') {
      badgeEl.textContent = 'C';
      badgeEl.classList.add('scope-collection');
      metaEl.textContent = info.scopeSourceName;
    } else if (info.resolvedScope === 'globals') {
      badgeEl.textContent = 'G';
      badgeEl.classList.add('scope-globals');
      metaEl.textContent = 'Globals';
    } else {
      badgeEl.textContent = 'U';
      badgeEl.classList.add('scope-unresolved');
      metaEl.textContent = 'Unresolved';
      metaEl.classList.add('is-unresolved');
    }

    if (info.resolvedScope === 'env' && initialRow && initialEl && resetBtn) {
      initialRow.classList.remove('hidden');
      initialEl.textContent = activeInitialValue !== '' ? activeInitialValue : '—';
      initialEl.title = activeInitialValue;
      resetBtn.classList.toggle('hidden', info.resolvedValue === activeInitialValue);
    } else if (initialRow) {
      initialRow.classList.add('hidden');
    }

    scopeEl.innerHTML = '';
    const envOpt = document.createElement('option');
    envOpt.value = 'env';
    if (info.activeEnv) {
      envOpt.textContent = `Env: ${info.activeEnv.name}`;
    } else {
      envOpt.textContent = 'Env (none active)';
      envOpt.disabled = true;
    }
    scopeEl.appendChild(envOpt);

    const collOpt = document.createElement('option');
    collOpt.value = 'collection';
    if (info.activeColl) {
      collOpt.textContent = `Collection: ${info.activeColl.name}`;
    } else {
      collOpt.textContent = 'Collection (save first)';
      collOpt.disabled = true;
    }
    scopeEl.appendChild(collOpt);

    const globalsOpt = document.createElement('option');
    globalsOpt.value = 'globals';
    globalsOpt.textContent = 'Globals';
    scopeEl.appendChild(globalsOpt);

    scopeEl.value = info.resolvedScope
      || (info.activeEnv ? 'env' : (info.activeColl ? 'collection' : 'globals'));

    valueEl.value = info.resolvedValue;
    if (saveBtn) {
      saveBtn.textContent = info.resolvedScope ? 'Update' : 'Set';
    }

    popover.classList.remove('hidden');
    autoResizeValueInput();
    positionPopover(anchorRect);

    if (focus) {
      setTimeout(() => {
        if (!popover.classList.contains('hidden')) {
          valueEl.focus();
          valueEl.select();
        }
      }, 0);
    }
  }

  function handleSave() {
    if (!activeVarName) return;
    const savedTo = saveVariableValueToScope(activeVarName, scopeEl.value, valueEl.value);
    if (!savedTo) {
      showToast('Selected scope is unavailable.', 'error');
      return;
    }
    const savedName = activeVarName;
    closePopover();
    refreshVariableHighlights();
    showToast(`Saved {{${savedName}}} in ${savedTo}.`, 'success');
  }

  function closeAutocomplete() {
    if (autocompleteEl) autocompleteEl.classList.add('hidden');
    acState = null;
  }

  function applyAutocompleteSelection(index) {
    if (!acState || !acState.items[index]) return;
    const picked = acState.items[index];
    const insertText = `{{${picked.key}}}`;

    if (acState.mode === 'dom') {
      const el = acState.target;
      const before = el.value.slice(0, acState.start);
      const afterRaw = el.value.slice(acState.end);
      const after = afterRaw.startsWith('}}') ? afterRaw.slice(2) : afterRaw;
      el.value = before + insertText + after;
      const nextCaret = before.length + insertText.length;
      el.focus();
      try { el.setSelectionRange(nextCaret, nextCaret); } catch {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (el.id === 'request-url') renderUrlVariablePills();
    } else if (acState.mode === 'ace') {
      const editor = acState.target;
      const { Range } = ace.require('ace/range');
      const line = editor.session.getLine(acState.row);
      const tail = line.slice(acState.end);
      const endCol = tail.startsWith('}}') ? acState.end + 2 : acState.end;
      editor.session.replace(new Range(acState.row, acState.start, acState.row, endCol), insertText);
      editor.focus();
      syncAceVariableMarkers(editor);
    }

    closeAutocomplete();
  }

  function renderAutocomplete(items, anchorRect, meta) {
    if (!autocompleteEl) return;
    autocompleteEl.innerHTML = '';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'var-ac-empty';
      empty.textContent = meta.query
        ? `No variable matching "${meta.query}" — finish with }} then click to set`
        : 'No variables defined yet — type name}} then click to set';
      autocompleteEl.appendChild(empty);
      acState = null;
    } else {
      acState = { ...meta, items, activeIndex: 0 };
      items.forEach((item, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `var-ac-item ${idx === 0 ? 'active' : ''}`;
        btn.innerHTML = `
          <span class="var-scope-badge scope-${item.scope}">${item.badge}</span>
          <span class="var-ac-name">${escapeHTML(item.key)}</span>
          <span class="var-ac-val">${escapeHTML(item.value)}</span>
        `;
        btn.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          applyAutocompleteSelection(idx);
        });
        autocompleteEl.appendChild(btn);
      });
    }

    autocompleteEl.classList.remove('hidden');
    const margin = 12;
    const width = autocompleteEl.offsetWidth || 300;
    const height = autocompleteEl.offsetHeight || 160;
    let left = Math.max(margin, Math.min(anchorRect.left, window.innerWidth - width - margin));
    let top = anchorRect.bottom + 4;
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, anchorRect.top - height - 4);
    }
    autocompleteEl.style.left = `${Math.round(left)}px`;
    autocompleteEl.style.top = `${Math.round(top)}px`;
  }

  function updateDomAutocomplete(el) {
    if (!autocompleteEl || !isVariableEditableInput(el)) {
      closeAutocomplete();
      return;
    }
    let pos = null;
    try { pos = el.selectionStart; } catch { pos = null; }
    if (typeof pos !== 'number' || pos !== el.selectionEnd) {
      closeAutocomplete();
      return;
    }
    const partial = getPartialVariableQueryAtOffset(el.value, pos);
    if (!partial) {
      closeAutocomplete();
      return;
    }
    const q = partial.query.toLowerCase();
    const matches = collectAllAvailableVariables().filter(v => v.key.toLowerCase().includes(q)).slice(0, 8);
    const rect = el.getBoundingClientRect();
    const { ctx, style } = getVariableMeasureContext(el);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const caretX = rect.left + padLeft + ctx.measureText(el.value.slice(0, pos)).width - (el.scrollLeft || 0);
    renderAutocomplete(matches, {
      left: Math.max(rect.left, Math.min(caretX - 12, rect.right - 40)),
      top: rect.top,
      bottom: rect.bottom
    }, { mode: 'dom', target: el, start: partial.start, end: partial.end, query: partial.query });
  }

  closeBtn?.addEventListener('click', closePopover);
  saveBtn?.addEventListener('click', handleSave);
  resetBtn?.addEventListener('click', () => {
    valueEl.value = activeInitialValue;
    autoResizeValueInput();
    resetBtn.classList.add('hidden');
    valueEl.focus();
  });

  popover.addEventListener('mouseenter', () => {
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
  });
  popover.addEventListener('mouseleave', () => {
    scheduleHoverClose();
  });
  popover.addEventListener('mousedown', () => {
    isPinned = true;
  });

  valueEl.addEventListener('input', () => {
    isPinned = true;
    autoResizeValueInput();
    if (resetBtn && !initialRow.classList.contains('hidden')) {
      resetBtn.classList.toggle('hidden', valueEl.value === activeInitialValue);
    }
  });
  valueEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePopover();
    }
  });

  openVariablePopoverBridge = openPopoverForVariable;

  // Live URL variable chips + autocomplete on input (never hijacking typing)
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (isVariableEditableInput(el)) {
      if (el.id === 'request-url') renderUrlVariablePills();
      if (!popover.classList.contains('hidden')) closePopover();
      updateDomAutocomplete(el);
    }
  });

  // Capture-phase keyboard navigation when autocomplete is open (must run before URL Enter-to-send!)
  document.addEventListener('keydown', (e) => {
    if (!autocompleteEl || autocompleteEl.classList.contains('hidden') || !acState || !acState.items.length) {
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      acState.activeIndex = (acState.activeIndex + 1) % acState.items.length;
      autocompleteEl.querySelectorAll('.var-ac-item').forEach((node, idx) => {
        node.classList.toggle('active', idx === acState.activeIndex);
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      acState.activeIndex = (acState.activeIndex - 1 + acState.items.length) % acState.items.length;
      autocompleteEl.querySelectorAll('.var-ac-item').forEach((node, idx) => {
        node.classList.toggle('active', idx === acState.activeIndex);
      });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      applyAutocompleteSelection(acState.activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAutocomplete();
    }
  }, true);

  // Hover-to-peek over {{var}} in <input> fields
  document.addEventListener('mousemove', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT' || !isVariableEditableInput(el) || !(el.value || '').includes('{{')) {
      if (hoverOpenTimer) {
        clearTimeout(hoverOpenTimer);
        hoverOpenTimer = null;
        pendingHoverKey = null;
      }
      if (!popover.classList.contains('hidden') && !popover.contains(el) && !el?.closest?.('.ace_editor')) {
        scheduleHoverClose();
      }
      return;
    }

    const tokens = computeInputVariableTokens(el);
    const rect = el.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const hit = tokens.find(t => relX >= t.rawStartX - 2 && relX <= t.rawEndX + 2);

    if (hit) {
      if (hoverCloseTimer) {
        clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
      }
      const key = `input:${el.id || ''}:${hit.name}:${hit.start}`;
      if (pendingHoverKey !== key) {
        if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
        pendingHoverKey = key;
        hoverOpenTimer = setTimeout(() => {
          if (isPinned && !popover.classList.contains('hidden')) return;
          const anchorLeft = Math.max(rect.left, rect.left + hit.rawStartX);
          const anchorRight = Math.min(rect.right, rect.left + hit.rawEndX);
          openPopoverForVariable(hit.name, {
            left: anchorLeft,
            right: anchorRight,
            top: rect.top,
            bottom: rect.bottom
          }, { focus: false, pin: false });
        }, 220);
      }
    } else {
      if (hoverOpenTimer) {
        clearTimeout(hoverOpenTimer);
        hoverOpenTimer = null;
        pendingHoverKey = null;
      }
      if (!popover.classList.contains('hidden')) {
        scheduleHoverClose();
      }
    }
  });

  // Click on {{var}} in <input> / <textarea> (pins & focuses immediately)
  document.addEventListener('click', (e) => {
    if (autocompleteEl && !autocompleteEl.contains(e.target)) {
      const targetEl = e.target;
      if (!isVariableEditableInput(targetEl) && !targetEl?.closest?.('.ace_editor')) {
        closeAutocomplete();
      }
    }
    if (popover.contains(e.target)) return;

    const el = e.target;
    if (isVariableEditableInput(el)) {
      let start = null;
      let end = null;
      try {
        start = el.selectionStart;
        end = el.selectionEnd;
      } catch {
        start = null;
      }

      if (typeof start === 'number' && start === end) {
        const match = findVariableAtOffset(el.value, start);
        if (match) {
          const rect = el.getBoundingClientRect();
          let anchorLeft = rect.left + 12;
          let anchorRight = anchorLeft + 60;
          if (el.tagName === 'INPUT') {
            const tokens = computeInputVariableTokens(el);
            const hit = tokens.find(t => t.start === match.start) || null;
            if (hit) {
              anchorLeft = Math.max(rect.left, rect.left + hit.rawStartX);
              anchorRight = Math.min(rect.right, rect.left + hit.rawEndX);
            } else if (e.clientX > 0) {
              anchorLeft = e.clientX;
              anchorRight = e.clientX + 20;
            }
          } else if (e.clientX > 0) {
            anchorLeft = e.clientX;
            anchorRight = e.clientX + 20;
          }
          const top = el.tagName === 'TEXTAREA' && e.clientY > 0 ? Math.max(rect.top, e.clientY - 12) : rect.top;
          const bottom = el.tagName === 'TEXTAREA' && e.clientY > 0 ? Math.min(e.clientY + 14, rect.bottom) : rect.bottom;
          // Keep keyboard focus inside the URL/input so text editing is never interrupted
          openPopoverForVariable(match.name, { left: anchorLeft, right: anchorRight, top, bottom }, { focus: false, pin: true });
          return;
        }
      }
    }

    if (Date.now() < ignoreOutsideClickUntil) return;
    if (!popover.classList.contains('hidden')) closePopover();
  });

  // Ace Editor integration (Markers, Hover-to-Peek, Click-to-Edit, & {{ Autocomplete)
  [bodyEditor, preRequestEditor, testsEditor].forEach(editor => {
    if (!editor || typeof editor.on !== 'function') return;

    editor.on('change', () => {
      syncAceVariableMarkers(editor);
      if (!editor.renderer || typeof editor.getCursorPosition !== 'function') return;
      if (editor.isFocused && !editor.isFocused()) return;
      const pos = editor.getCursorPosition();
      const line = editor.session.getLine(pos.row) || '';
      const partial = getPartialVariableQueryAtOffset(line, pos.column);
      if (!partial) {
        if (acState?.mode === 'ace' && acState.target === editor) closeAutocomplete();
        return;
      }
      const q = partial.query.toLowerCase();
      const matches = collectAllAvailableVariables().filter(v => v.key.toLowerCase().includes(q)).slice(0, 8);
      const coords = editor.renderer.textToScreenCoordinates(pos.row, pos.column);
      const lineHeight = editor.renderer.lineHeight || 18;
      renderAutocomplete(matches, {
        left: coords.pageX,
        top: coords.pageY,
        bottom: coords.pageY + lineHeight
      }, { mode: 'ace', target: editor, row: pos.row, start: partial.start, end: partial.end, query: partial.query });
    });

    if (!editor.renderer) return;

    editor.on('mousemove', (aceEvent) => {
      const pos = editor.renderer.screenToTextCoordinates(aceEvent.clientX, aceEvent.clientY);
      const line = editor.session.getLine(pos.row) || '';
      const match = pos.column <= line.length ? findVariableAtOffset(line, pos.column) : null;
      const contentEl = editor.renderer.content;

      if (match) {
        if (contentEl) contentEl.style.cursor = 'pointer';
        if (hoverCloseTimer) {
          clearTimeout(hoverCloseTimer);
          hoverCloseTimer = null;
        }
        const key = `ace:${editor.container?.id || ''}:${pos.row}:${match.start}`;
        if (pendingHoverKey !== key) {
          if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
          pendingHoverKey = key;
          hoverOpenTimer = setTimeout(() => {
            if (isPinned && !popover.classList.contains('hidden')) return;
            const startCoords = editor.renderer.textToScreenCoordinates(pos.row, match.start);
            const endCoords = editor.renderer.textToScreenCoordinates(pos.row, match.end);
            const lineHeight = editor.renderer.lineHeight || 18;
            openPopoverForVariable(match.name, {
              left: startCoords.pageX,
              right: endCoords.pageX,
              top: startCoords.pageY,
              bottom: startCoords.pageY + lineHeight
            }, { focus: false, pin: false });
          }, 170);
        }
      } else {
        if (contentEl) contentEl.style.cursor = '';
        if (hoverOpenTimer) {
          clearTimeout(hoverOpenTimer);
          hoverOpenTimer = null;
          pendingHoverKey = null;
        }
        if (!popover.classList.contains('hidden')) scheduleHoverClose();
      }
    });

    editor.on('click', (aceEvent) => {
      if (editor.getSelectionRange && !editor.getSelectionRange().isEmpty()) return;
      const pos = aceEvent.getDocumentPosition && aceEvent.getDocumentPosition();
      if (!pos || !editor.session || typeof editor.session.getLine !== 'function') return;

      const line = editor.session.getLine(pos.row);
      const match = findVariableAtOffset(line, pos.column);
      if (!match) return;

      const startCoords = editor.renderer.textToScreenCoordinates(pos.row, match.start);
      const endCoords = editor.renderer.textToScreenCoordinates(pos.row, match.end);
      const lineHeight = editor.renderer.lineHeight || 18;
      openPopoverForVariable(match.name, {
        left: startCoords.pageX,
        right: endCoords.pageX,
        top: startCoords.pageY,
        bottom: startCoords.pageY + lineHeight
      }, { focus: true, pin: true });
    });
  });

  refreshVariableHighlights();
}
