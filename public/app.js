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

/**
 * Initialize Ace Editors via CDN
 */
function initAceEditors() {
  const aceOptions = {
    theme: 'ace/theme/tomorrow_night',
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
  localStorage.setItem('workspace_tabs', JSON.stringify(tabs));
  localStorage.setItem('workspace_active_tab', activeTabId);
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
    formData: [{ key: '', value: '', type: 'text', fileData: null, fileName: '', enabled: true }],
    urlencoded: [{ key: '', value: '', enabled: true }],
    preRequestScript: '',
    testsScript: '',
    response: null,
    testResults: null
  };

  const newTabObj = initialData ? { ...defaultTab, ...initialData, id } : defaultTab;
  
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

function switchActiveTab(id) {
  activeTabId = id;
  saveTabsState();

  // Active UI highlights
  document.querySelectorAll('.workspace-tab').forEach(t => t.classList.remove('active'));
  const activeBtn = document.getElementById(`btn-${id}`);
  if (activeBtn) activeBtn.classList.add('active');

  const tab = getActiveTab();
  if (!tab) return;

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
      let codeToInject = '';
      
      switch(snipType) {
        case 'status-200':
          codeToInject = `pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});\n`;
          break;
        case 'json-val':
          codeToInject = `pm.test("Response body matches JSON values", function () {\n    var jsonData = pm.response.json();\n    pm.expect(jsonData.id).to.eql(100);\n});\n`;
          break;
        case 'contains-string':
          codeToInject = `pm.test("Body matches string check", function () {\n    pm.expect(pm.response.text()).to.include("success_token");\n});\n`;
          break;
        case 'set-env':
          codeToInject = `pm.environment.set("jwt_token", pm.response.json().token);\n`;
          break;
        case 'response-time':
          codeToInject = `pm.test("Response latency is less than 200ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(200);\n});\n`;
          break;
      }
      
      const session = testsEditor.getSession();
      session.insert({ row: session.getLength(), column: 0 }, codeToInject);
      testsEditor.focus();
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

function resolveTextVariables(text, envSnapshot) {
  if (typeof text !== 'string') return text;
  
  // Combines environment snapshot + globals snapshot for matching
  const allVars = { ...globals, ...envSnapshot };

  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (trimmedKey in allVars) return allVars[trimmedKey];
    return match;
  });
}

/**
 * API Requests Dispatch Engine
 */
async function sendActiveRequest() {
  const tab = getActiveTab();
  if (!tab) return;

  const urlInput = document.getElementById('request-url').value.trim();
  if (!urlInput) {
    alert('Please enter a target URL.');
    return;
  }

  // Update button UI loading state
  const sendBtn = document.getElementById('btn-send-request');
  const originalHtml = sendBtn.innerHTML;
  sendBtn.innerHTML = `<span>Sending...</span> <i class="fa-solid fa-spinner fa-spin"></i>`;
  sendBtn.disabled = true;

  // Clear previous response panels
  document.getElementById('response-empty-state').classList.add('hidden');
  document.getElementById('response-content-area').classList.add('hidden');
  document.getElementById('response-metadata').classList.add('hidden');

  // Load environment states
  const envSnapshot = getActiveEnvironmentSnapshot();
  let requestGlobals = { ...globals };
  let requestEnv = { ...envSnapshot };

  // 1. Evaluate Pre-request scripts
  if (tab.preRequestScript && tab.preRequestScript.trim() !== '') {
    appendConsoleLogs([{ type: 'info', message: `=== Pre-request Script execution: "${tab.name}" ===`, time: new Date().toLocaleTimeString() }]);
    
    const preSandboxResult = runScriptSandbox(tab.preRequestScript, {
      globals: requestGlobals,
      environment: requestEnv,
      request: {
        url: urlInput,
        method: tab.method,
        headers: getFlatHeadersObject(tab.headers),
        body: tab.body
      }
    });

    // Capture outputs
    requestGlobals = preSandboxResult.globals;
    requestEnv = preSandboxResult.environment;
    appendConsoleLogs(preSandboxResult.logs);
  }

  // Resolve double curly braces
  const resolvedUrl = resolveTextVariables(urlInput, requestEnv);
  const resolvedHeaders = resolveHeadersObject(tab.headers, requestEnv);
  
  // Format body parameters
  let resolvedBody = null;
  if (tab.bodyType === 'raw') {
    resolvedBody = resolveTextVariables(tab.body, requestEnv);
  } else if (tab.bodyType === 'urlencoded') {
    // Form data row resolution
    resolvedBody = getFlatBodyParams(getRowsDataFromTable('urlencoded'), requestEnv);
  } else if (tab.bodyType === 'form-data') {
    resolvedBody = getFlatBodyParams(getRowsDataFromTable('formdata'), requestEnv);
  }

  // Inject Authorization
  injectAuthorizationToRequest(tab.auth, resolvedHeaders, resolvedUrl, requestEnv);

  const engine = document.getElementById('request-engine').value;
  const start = Date.now();
  let responseData = null;

  try {
    if (engine === 'proxy') {
      const proxyPostUrl = `${window.location.origin}/api/proxy`;
      
      // Form fields format sync if sending form-data through proxy
      let finalProxyBody = resolvedBody;
      const hasContentType = Object.keys(resolvedHeaders).some(k => k.toLowerCase() === 'content-type');
      if (tab.bodyType === 'urlencoded' && Array.isArray(resolvedBody)) {
        const params = new URLSearchParams();
        resolvedBody.forEach(item => params.append(item.key, item.value));
        finalProxyBody = params.toString();
        resolvedHeaders['content-type'] = 'application/x-www-form-urlencoded';
      } else if (tab.bodyType === 'raw' && resolvedBody && !hasContentType) {
        resolvedHeaders['content-type'] = tab.bodyRawType || 'application/json';
      } else if (tab.bodyType === 'form-data' && !hasContentType) {
        // Must explicitly set to trigger multipart handler in proxy
        resolvedHeaders['content-type'] = 'multipart/form-data';
      }

      const response = await fetch(proxyPostUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: resolvedUrl,
          method: tab.method,
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
      responseData = await executeDirectBrowserRequest(tab.method, resolvedUrl, resolvedHeaders, resolvedBody, tab.bodyType);
    }
  } catch (error) {
    responseData = {
      status: 0,
      statusText: 'Connection Error',
      headers: {},
      body: `Error: ${error.message}\nThis request could not be completed. If testing external APIs, please ensure you are in "Proxy Mode" to bypass CORS browser blocks.`,
      time: Date.now() - start,
      size: 0
    };
  }

  // 2. Evaluate Test Assertion Script
  let testResults = [];
  if (tab.testsScript && tab.testsScript.trim() !== '') {
    appendConsoleLogs([{ type: 'info', message: `=== Test Assertions execution: "${tab.name}" ===`, time: new Date().toLocaleTimeString() }]);

    const testSandboxResult = runScriptSandbox(tab.testsScript, {
      globals: requestGlobals,
      environment: requestEnv,
      request: {
        url: resolvedUrl,
        method: tab.method,
        headers: resolvedHeaders,
        body: tab.body
      },
      response: responseData
    });

    // Capture mutations
    requestGlobals = testSandboxResult.globals;
    requestEnv = testSandboxResult.environment;
    testResults = testSandboxResult.testResults;
    appendConsoleLogs(testSandboxResult.logs);
  }

  // Update variables in main memory
  globals = requestGlobals;
  saveGlobals();
  updateEnvironmentVariablesMemory(requestEnv);

  // Cache response object to tab history
  tab.response = responseData;
  tab.testResults = testResults;
  saveTabsState();

  // Save successful trigger to History Panel
  logRequestToHistory(tab.method, urlInput, responseData.status, responseData.time);

  // Render response panels
  renderResponseUI(responseData, testResults);

  // Reset button UI
  sendBtn.innerHTML = originalHtml;
  sendBtn.disabled = false;
}

/**
 * Handle direct fetch dispatch from app.js main thread context
 */
async function executeDirectBrowserRequest(method, url, headers, body, bodyType) {
  const fetchOptions = {
    method: method,
    headers: new Headers(headers),
    mode: 'cors'
  };

  if (bodyType === 'raw' && body) {
    fetchOptions.body = body;
    if (!headers['content-type']) {
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

function resolveHeadersObject(headersArray, envSnapshot) {
  const headers = {};
  headersArray.forEach(h => {
    if (h.enabled && h.key) {
      const resolvedKey = resolveTextVariables(h.key, envSnapshot);
      const resolvedVal = resolveTextVariables(h.value || '', envSnapshot);
      headers[resolvedKey] = resolvedVal;
    }
  });
  return headers;
}

function getFlatBodyParams(fieldsArray, envSnapshot) {
  return fieldsArray.map(item => {
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
  if (!auth || auth.type === 'none') return;

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
    }
    // Note: query parameters injection would require modifying URL in caller scope.
    // In sendActiveRequest resolvedUrl is computed. For api key in query params,
    // we handled it in address bar or will inject it directly in url before query.
  }
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
    select.innerHTML = '';
    
    if (collections.length === 0) {
      select.innerHTML = `<option value="">(No Collections Available)</option>`;
    } else {
      collections.forEach(c => {
        select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
      });
    }

    document.getElementById('save-req-name').value = activeTab.name || 'New Request';
    document.getElementById('save-req-desc').value = '';


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

    const coll = collections.find(c => c.id === collId);
    if (coll) {
      const activeTab = getActiveTab();
      if (activeTab) {
        // Sync URL bar values back to tab memory before saving
        activeTab.url = document.getElementById('request-url').value;
        activeTab.method = document.getElementById('request-method').value;
        activeTab.headers = getRowsDataFromTable('headers');
        
        // Formulate request object
        const requestToSave = {
          id: `req-${Date.now()}`,
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
        coll.requests.push(requestToSave);
        saveCollections();
        
        // Update active tab name to saved value
        activeTab.name = nameVal;
        renderTabsUI();
        renderCollections();
        populateRunnerSelects();
        
        modal.classList.remove('active');
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
      console.log("[DEBUG] reqItem activated instead!");
      const reqId = reqItem.dataset.id;
      const collId = reqItem.dataset.collId;
      const coll = collections.find(c => c.id === collId);
      if (coll && coll.requests) {
        const req = coll.requests.find(r => r.id === reqId);
        if (req) {
          createNewTab(req);
        }
      }
    }
  });
}

/**
 * Compatible Parser: Translates Postman Schema (v2.1) to ExpressPost internal structure
 */
function parsePostmanCollection(postmanJson) {
  const coll = {
    id: `coll-imported-${Date.now()}`,
    name: postmanJson.info.name || 'Imported Postman Collection',
    requests: []
  };

  function traverseItems(itemArray) {
    itemArray.forEach(item => {
      if (item.request) {
        // It's a request item
        const pmReq = item.request;
        
        // Parse URL
        let urlStr = '';
        if (typeof pmReq.url === 'string') {
          urlStr = pmReq.url;
        } else if (pmReq.url && pmReq.url.raw) {
          urlStr = pmReq.url.raw;
        }

        // Parse Headers
        const headers = [];
        if (Array.isArray(pmReq.header)) {
          pmReq.header.forEach(h => {
            headers.push({
              key: h.key,
              value: h.value || '',
              enabled: h.disabled !== true,
              description: h.description || ''
            });
          });
        }

        // Parse Body
        let bodyType = 'none';
        let bodyContent = '';
        if (pmReq.body) {
          bodyType = pmReq.body.mode === 'raw' ? 'raw' : pmReq.body.mode;
          if (pmReq.body.raw) {
            bodyContent = pmReq.body.raw;
          }
        }

        // Parse scripts
        let preRequestScript = '';
        let testsScript = '';
        if (Array.isArray(item.event)) {
          item.event.forEach(ev => {
            if (ev.listen === 'prerequest' && ev.script && Array.isArray(ev.script.exec)) {
              preRequestScript = ev.script.exec.join('\n');
            } else if (ev.listen === 'test' && ev.script && Array.isArray(ev.script.exec)) {
              testsScript = ev.script.exec.join('\n');
            }
          });
        }

        coll.requests.push({
          id: `req-imported-${Date.now()}-${Math.random().toString(36).substring(2,6)}`,
          name: item.name || 'Unnamed Request',
          method: pmReq.method || 'GET',
          url: urlStr,
          headers: headers,
          auth: { type: 'none' }, // fallback
          bodyType: bodyType === 'raw' ? 'raw' : 'none',
          body: bodyContent,
          preRequestScript: preRequestScript,
          testsScript: testsScript
        });
      } else if (item.item) {
        // Recursive folder traversal
        traverseItems(item.item);
      }
    });
  }

  traverseItems(postmanJson.item || []);
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
