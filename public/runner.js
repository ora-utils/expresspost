/**
 * ExpressPost Collections & Runner Engine
 * Handles Collection structures, folder hierarchies, and coordinates
 * Sequential or Parallel (Multithreaded Web Workers) executions.
 */

// Global collections state
let collections = [];
let environments = [];
let globals = {};
let activeEnvId = 'globals';

// Active run state
let currentRun = {
  active: false,
  workers: [],
  logs: [],
  stats: { passed: 0, failed: 0, totalTests: 0, totalRequests: 0, totalCompleted: 0, totalTime: 0 },
  stopRequested: false
};
let runnerData = []; // Data file content for iterations

// Initialize collections & environments
function initCollectionsAndRunner() {
  loadCollections();
  loadEnvironments();
  renderCollections();
  populateRunnerSelects();
  setupRunnerEventListeners();
}

// Default collections data to wow the user out-of-the-box
const DEFAULT_COLLECTIONS = [
  {
    id: 'coll-default',
    name: 'ExpressPost Showcase API',
    requests: [
      {
        id: 'req-showcase-1',
        name: 'Get Mock Data',
        method: 'GET',
        url: 'https://httpbin.org/get?status=active&userId=456&role={{userRole}}',
        headers: [
          { key: 'Accept', value: 'application/json', enabled: true },
          { key: 'X-App-Client', value: 'ExpressPost-Runner', enabled: true }
        ],
        auth: { type: 'none' },
        bodyType: 'none',
        body: '',
        preRequestScript: `// Pre-request script runs before the HTTP request
console.log("Preparing showcase GET request...");
pm.environment.set("userRole", "administrator");`,
        testsScript: `// Test scripts run assertions on response
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Verify Query Parameters", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.args.status).to.eql("active");
    pm.expect(jsonData.args.role).to.eql("administrator");
});

pm.test("Headers are present", function () {
    pm.response.to.have.header("content-type");
});`
      },
      {
        id: 'req-showcase-2',
        name: 'Create User Profile',
        method: 'POST',
        url: 'https://httpbin.org/post',
        headers: [
          { key: 'Content-Type', value: 'application/json', enabled: true }
        ],
        auth: { type: 'bearer', bearerToken: '{{authToken}}' },
        bodyType: 'raw',
        body: `{\n  "username": "aerodev",\n  "created_at": "${new Date().toISOString()}",\n  "role": "{{userRole}}"\n}`,
        preRequestScript: `// Inject dynamic auth token
console.log("Generating Bearer token...");
pm.environment.set("authToken", "secret_jwt_token_12345");`,
        testsScript: `pm.test("Profile created successfully", function () {
    pm.response.to.be.success();
});

pm.test("Payload echoed back", function () {
    var data = pm.response.json();
    pm.expect(data.json.username).to.eql("aerodev");
    pm.expect(data.json.role).to.eql("administrator");
});

pm.test("Auth header was forwarded", function () {
    var data = pm.response.json();
    pm.expect(data.headers.Authorization).to.eql("Bearer secret_jwt_token_12345");
});`
      },
      {
        id: 'req-showcase-3',
        name: 'Stress Test Headers',
        method: 'GET',
        url: 'https://httpbin.org/headers',
        headers: [
          { key: 'X-Thread-Benchmark', value: 'true', enabled: true }
        ],
        auth: { type: 'none' },
        bodyType: 'none',
        body: '',
        preRequestScript: `console.log("Evaluating stress headers...");`,
        testsScript: `pm.test("Response speed ok", function () {
    pm.expect(pm.response.responseTime).to.be.below(800);
});

pm.test("Includes benchmark header", function () {
    var data = pm.response.json();
    pm.expect(data.headers['X-Thread-Benchmark']).to.eql('true');
});`
      }
    ]
  }
];

function loadCollections() {
  const localData = localStorage.getItem('collections');
  if (localData) {
    try {
      collections = JSON.parse(localData);
    } catch (e) {
      collections = DEFAULT_COLLECTIONS;
    }
  } else {
    collections = DEFAULT_COLLECTIONS;
    saveCollections();
  }
}

function saveCollections() {
  localStorage.setItem('collections', JSON.stringify(stripOAuthSecrets(collections)));
}

function stripOAuthSecrets(value) {
  if (Array.isArray(value)) return value.map(stripOAuthSecrets);
  if (!value || typeof value !== 'object') return value;

  const sanitized = {};
  Object.entries(value).forEach(([key, item]) => {
    if (value.type === 'oauth2' && [
      'oauthClientSecret',
      'oauthUsername',
      'oauthPassword',
      'oauthAccessToken',
      'oauthRefreshToken',
      'oauthExpiresAt'
    ].includes(key)) return;
    sanitized[key] = stripOAuthSecrets(item);
  });
  return sanitized;
}

function loadEnvironments() {
  const localEnv = localStorage.getItem('environments');
  const localGlob = localStorage.getItem('globals');
  
  if (localEnv) {
    try { environments = JSON.parse(localEnv); } catch(e) { environments = []; }
  } else {
    // Default mock environment
    environments = [
      {
        id: 'env-mock-1',
        name: 'Development API',
        variables: [
          { key: 'baseUrl', value: 'https://httpbin.org', enabled: true }
        ]
      }
    ];
    localStorage.setItem('environments', JSON.stringify(environments));
  }

  if (localGlob) {
    try { globals = JSON.parse(localGlob); } catch(e) { globals = {}; }
  } else {
    globals = { userRole: 'guest' };
    localStorage.setItem('globals', JSON.stringify(globals));
  }

  const savedActiveEnv = localStorage.getItem('active_env_id');
  if (savedActiveEnv && (savedActiveEnv === 'globals' || environments.some(e => String(e.id) === String(savedActiveEnv)))) {
    activeEnvId = savedActiveEnv;
  } else {
    activeEnvId = 'globals';
  }
}

function saveActiveEnvId(id) {
  activeEnvId = id || 'globals';
  localStorage.setItem('active_env_id', activeEnvId);
}

function saveEnvironments() {
  localStorage.setItem('environments', JSON.stringify(environments));
}

function saveGlobals() {
  localStorage.setItem('globals', JSON.stringify(globals));
}

// Render Collection Sidebar Tree
function renderCollections() {
  const listElement = document.getElementById('collections-list');
  if (!listElement) return;

  const searchInput = document.getElementById('collections-search');
  const filterQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';

  if (collections.length === 0) {
    listElement.innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-folder-open"></i>
        <p>No collections yet. Create one to begin.</p>
      </div>`;
    return;
  }

  listElement.innerHTML = '';
  let renderedCount = 0;

  collections.forEach(coll => {
    const collMatches = !filterQuery || (coll.name || '').toLowerCase().includes(filterQuery);
    const matchingRequests = filterQuery
      ? (coll.requests || []).filter(r =>
          (r.name || '').toLowerCase().includes(filterQuery) ||
          (r.url || '').toLowerCase().includes(filterQuery) ||
          (r.method || '').toLowerCase().includes(filterQuery)
        )
      : (coll.requests || []);

    if (filterQuery && !collMatches && matchingRequests.length === 0) {
      return;
    }

    renderedCount++;
    const collDiv = document.createElement('div');
    collDiv.className = 'coll-folder';
    collDiv.id = `folder-${coll.id}`;

    const isExpanded = filterQuery ? true : (coll.isExpanded !== false);
    const iconClass = isExpanded ? 'fa-folder-open' : 'fa-folder';
    const displayStyle = isExpanded ? 'block' : 'none';
    const safeCollName = escapeHTML(coll.name || '');

    collDiv.innerHTML = `
      <div class="coll-folder-header" data-id="${escapeHTML(coll.id)}" style="cursor: pointer; user-select: none;">
        <div class="coll-folder-title">
          <i class="fa-solid ${iconClass}" style="color: #f9d877;"></i>
          <span title="${safeCollName}">${safeCollName}</span>
        </div>
        <div class="coll-folder-actions">
          <button class="icon-btn btn-add-req-to-coll" data-id="${escapeHTML(coll.id)}" title="Add Request"><i class="fa-solid fa-file-circle-plus"></i></button>
          <button class="icon-btn btn-edit-coll-vars" data-id="${escapeHTML(coll.id)}" title="Collection Settings & Variables"><i class="fa-solid fa-sliders"></i></button>
          <button class="icon-btn btn-export-coll" data-id="${escapeHTML(coll.id)}" title="Export Collection (credentials omitted)"><i class="fa-solid fa-file-export"></i></button>
          <button class="icon-btn btn-run-coll-direct" data-id="${escapeHTML(coll.id)}" title="Run Collection"><i class="fa-solid fa-circle-play"></i></button>
          <button class="icon-btn btn-delete-coll" data-id="${escapeHTML(coll.id)}" title="Delete Collection"><i class="fa-solid fa-trash-can"></i></button>
        </div>
        <button type="button" class="icon-btn btn-coll-more" data-id="${escapeHTML(coll.id)}" title="Collection Actions (Add, Rename, Duplicate, Delete)" aria-label="Collection Actions" aria-haspopup="menu">
          <i class="fa-solid fa-ellipsis"></i>
        </button>
      </div>
      <div class="folder-requests" id="requests-list-${escapeHTML(coll.id)}" style="display: ${displayStyle};">
        <!-- Requests will be appended here -->
      </div>
    `;

    const header = collDiv.querySelector('.coll-folder-header');
    header.addEventListener('click', (e) => {
      if (e.target.closest('.coll-folder-actions, .btn-coll-more')) return;
      coll.isExpanded = !isExpanded;
      saveCollections();
      renderCollections();
    });

    const reqsContainer = collDiv.querySelector('.folder-requests');
    const requestsToRender = collMatches ? (coll.requests || []) : matchingRequests;

    if (requestsToRender.length > 0) {
      const folderContainers = new Map();
      requestsToRender.forEach(req => {
        let parentContainer = reqsContainer;
        if (req.folderPath) {
          let currentPath = '';
          req.folderPath.split('/').forEach(folderName => {
            currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
            if (!folderContainers.has(currentPath)) {
              const folder = document.createElement('div');
              folder.className = 'coll-subfolder';
              folder.style.cssText = 'margin-left: 12px; border-left: 1px solid var(--border-color); padding-left: 8px;';
              folder.innerHTML = `<div style="padding: 5px 4px; color: var(--text-muted); font-size: 11px;"><i class="fa-solid fa-folder"></i> ${escapeHTML(folderName)}</div>`;
              parentContainer.appendChild(folder);
              folderContainers.set(currentPath, folder);
            }
            parentContainer = folderContainers.get(currentPath);
          });
        }
        const reqItem = document.createElement('div');
        reqItem.className = 'coll-req-item';
        reqItem.dataset.id = req.id;
        reqItem.dataset.collId = coll.id;

        let methodClass = 'method-badge-other';
        const method = (req.method || 'GET').toLowerCase();
        if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
          methodClass = `method-badge-${method}`;
        }

        const safeReqName = escapeHTML(req.name || '');

        reqItem.innerHTML = `
          <div class="coll-req-title-wrapper">
            <span class="history-method ${methodClass}" style="font-size: 8px; padding: 1px 3px; min-width: 32px;">${escapeHTML(req.method || 'GET')}</span>
            <span class="coll-req-title" title="${safeReqName}">${safeReqName}</span>
          </div>
          <div class="coll-req-actions">
            <button class="icon-btn btn-duplicate-req-from-coll" title="Duplicate Request"><i class="fa-regular fa-copy"></i></button>
            <button class="icon-btn btn-delete-req-from-coll" title="Delete"><i class="fa-solid fa-xmark"></i></button>
          </div>
        `;

        const dupBtn = reqItem.querySelector('.btn-duplicate-req-from-coll');
        dupBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const clone = JSON.parse(JSON.stringify(req));
          clone.id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          clone.name = `${req.name || 'Request'} (Copy)`;
          coll.requests.push(clone);
          saveCollections();
          renderCollections();
          if (typeof populateRunnerSelects === 'function') populateRunnerSelects();
        });

        const delBtn = reqItem.querySelector('.btn-delete-req-from-coll');
        delBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (await showConfirmDialog('Remove Request', 'Remove request from collection?')) {
            coll.requests = coll.requests.filter(r => String(r.id) !== String(req.id));
            saveCollections();
            renderCollections();
            if (typeof populateRunnerSelects === 'function') populateRunnerSelects();
          }
        });

        parentContainer.appendChild(reqItem);
      });
    } else {
      reqsContainer.innerHTML = `<div class="empty-state" style="padding: 10px; font-size: 11px;"><p>Folder empty</p></div>`;
    }

    listElement.appendChild(collDiv);
  });

  if (renderedCount === 0 && filterQuery) {
    listElement.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-magnifying-glass"></i>
        <p>No collections or requests match "${escapeHTML(filterQuery)}".</p>
      </div>`;
  }
}



// Populate Runner Select Dropdowns
function populateRunnerSelects() {
  const collSelect = document.getElementById('runner-select-collection');
  const envSelect = document.getElementById('runner-select-env');
  const activeEnvSelect = document.getElementById('active-env-select');

  if (!collSelect || !envSelect || !activeEnvSelect) return;

  const prevColl = collSelect.value;
  const prevRunnerEnv = envSelect.value;

  // Collection Options
  collSelect.innerHTML = '';
  if (collections.length === 0) {
    collSelect.innerHTML = `<option value="">-- No Collections --</option>`;
  } else {
    collections.forEach(c => {
      collSelect.innerHTML += `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`;
    });
    if (prevColl && collections.some(c => String(c.id) === String(prevColl))) {
      collSelect.value = prevColl;
    }
  }

  // Environment Options
  envSelect.innerHTML = `<option value="globals">No Environment</option>`;
  activeEnvSelect.innerHTML = `<option value="globals">No Environment</option>`;

  environments.forEach(env => {
    envSelect.innerHTML += `<option value="${escapeHTML(env.id)}">${escapeHTML(env.name)}</option>`;
    activeEnvSelect.innerHTML += `<option value="${escapeHTML(env.id)}">${escapeHTML(env.name)}</option>`;
  });

  if (activeEnvId !== 'globals' && !environments.some(e => String(e.id) === String(activeEnvId))) {
    saveActiveEnvId('globals');
  }
  activeEnvSelect.value = activeEnvId;

  if (prevRunnerEnv && (prevRunnerEnv === 'globals' || environments.some(e => String(e.id) === String(prevRunnerEnv)))) {
    envSelect.value = prevRunnerEnv;
  } else {
    envSelect.value = activeEnvId;
  }

  renderRunnerRequestList(collSelect.value);
}

function updateRunnerToggleAllLabel() {
  const toggleBtn = document.getElementById('btn-runner-toggle-all');
  if (!toggleBtn) return;
  const boxes = Array.from(document.querySelectorAll('.runner-req-checkbox'));
  const allChecked = boxes.length > 0 && boxes.every(cb => cb.checked);
  toggleBtn.textContent = allChecked ? 'Deselect All' : 'Select All';
}

function renderRunnerRequestList(collId) {
  const listContainer = document.getElementById('runner-request-checklist');
  const listWrapper = document.getElementById('runner-request-list');
  if (!listContainer || !listWrapper) return;

  listContainer.innerHTML = '';

  if (!collId) {
    listWrapper.classList.add('hidden');
    return;
  }

  const collection = collections.find(c => String(c.id) === String(collId));
  if (!collection || !collection.requests || collection.requests.length === 0) {
    listWrapper.classList.add('hidden');
    return;
  }

  listWrapper.classList.remove('hidden');

  collection.requests.forEach((req) => {
    let methodClass = 'method-badge-other';
    const method = (req.method || 'GET').toLowerCase();
    if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
      methodClass = `method-badge-${method}`;
    }

    const safeRunnerReqName = escapeHTML(req.name || '');
    const label = document.createElement('label');
    label.className = 'runner-request-item coll-req-item';
    label.innerHTML = `
      <input type="checkbox" class="runner-req-checkbox" value="${escapeHTML(req.id)}" checked>
      <div class="coll-req-title-wrapper">
        <span class="history-method ${methodClass}">${escapeHTML(req.method || 'GET')}</span>
        <span class="coll-req-title" title="${safeRunnerReqName}">${safeRunnerReqName}</span>
      </div>
    `;
    label.querySelector('input').addEventListener('change', updateRunnerToggleAllLabel);
    listContainer.appendChild(label);
  });

  updateRunnerToggleAllLabel();
}

function setupRunnerEventListeners() {
  const openRunnerBtn = document.getElementById('btn-open-runner');
  const closeRunnerBtn = document.getElementById('btn-close-runner');
  const runnerView = document.getElementById('runner-view');

  if (openRunnerBtn && runnerView) {
    openRunnerBtn.addEventListener('click', () => {
      populateRunnerSelects();
      const envSelect = document.getElementById('runner-select-env');
      if (envSelect) envSelect.value = activeEnvId;
      runnerView.classList.remove('hidden');
    });
  }

  const collSelect = document.getElementById('runner-select-collection');
  if (collSelect) {
    collSelect.addEventListener('change', (e) => {
      renderRunnerRequestList(e.target.value);
    });
  }

  const toggleAllBtn = document.getElementById('btn-runner-toggle-all');
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', () => {
      const boxes = Array.from(document.querySelectorAll('.runner-req-checkbox'));
      const shouldCheck = !boxes.every(cb => cb.checked);
      boxes.forEach(cb => { cb.checked = shouldCheck; });
      updateRunnerToggleAllLabel();
    });
  }

  if (closeRunnerBtn && runnerView) {
    closeRunnerBtn.addEventListener('click', async () => {
      if (currentRun.active) {
        if (await showConfirmDialog('Stop Runner', 'A collection run is currently in progress. Do you want to stop it and exit?')) {
          stopActiveRunner();
        } else {
          return;
        }
      }
      runnerView.classList.add('hidden');
    });
  }

  // Setup runner mode radio toggles
  const modeRadios = document.getElementsByName('runner-mode');
  const threadsSettings = document.getElementById('runner-thread-setting');
  modeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'parallel') {
        threadsSettings.classList.remove('hidden');
      } else {
        threadsSettings.classList.add('hidden');
      }
    });
  });

  // Thread slider sync
  const threadSlider = document.getElementById('runner-threads');
  const threadVal = document.getElementById('runner-threads-val');
  if (threadSlider && threadVal) {
    threadSlider.addEventListener('input', (e) => {
      threadVal.innerText = `${e.target.value} Threads`;
    });
  }

  // Add event listener for start run
  const startRunBtn = document.getElementById('btn-start-run');
  if (startRunBtn) {
    startRunBtn.addEventListener('click', startCollectionRun);
  }

  // Stop Run action
  const stopRunBtn = document.getElementById('btn-stop-run');
  if (stopRunBtn) {
    stopRunBtn.addEventListener('click', () => {
      currentRun.stopRequested = true;
      stopRunBtn.textContent = 'Stopping...';
      stopRunBtn.disabled = true;
    });
  }

  // Pause Run action
  const pauseRunBtn = document.getElementById('btn-pause-run');
  if (pauseRunBtn) {
    pauseRunBtn.addEventListener('click', () => {
      if (!currentRun.active) return;
      currentRun.paused = !currentRun.paused;
      if (currentRun.paused) {
        pauseRunBtn.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
        document.getElementById('runner-progress-status').innerText = 'Paused...';
      } else {
        pauseRunBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
        document.getElementById('runner-progress-status').innerText = 'Resuming...';
      }
    });
  }

  // Log Filters
  const logFilters = document.getElementById('runner-log-filters');
  const logList = document.getElementById('runner-execution-logs');
  if (logFilters && logList) {
    logFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const filter = btn.dataset.filter;

      Array.from(logFilters.children).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      logList.className = `runner-log-list filter-${filter}`;
    });
  }

  // Export report action
  const exportBtn = document.getElementById('btn-export-run');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportRunReport);
  }

  // Data File Upload & Clear
  const dataFileInput = document.getElementById('runner-data-file');
  const clearDataBtn = document.getElementById('btn-clear-runner-data');
  const clearDataFileState = () => {
    runnerData = [];
    const infoDiv = document.getElementById('runner-data-info');
    const iterInput = document.getElementById('runner-iterations');
    if (infoDiv) infoDiv.classList.add('hidden');
    if (clearDataBtn) clearDataBtn.classList.add('hidden');
    if (iterInput) {
      iterInput.disabled = false;
      iterInput.value = 1;
    }
    if (dataFileInput) dataFileInput.value = '';
  };

  if (clearDataBtn) {
    clearDataBtn.addEventListener('click', clearDataFileState);
  }

  if (dataFileInput) {
    dataFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const filenameSpan = document.getElementById('runner-data-filename');
      const rowsSpan = document.getElementById('runner-data-rows');
      const infoDiv = document.getElementById('runner-data-info');
      const iterInput = document.getElementById('runner-iterations');

      try {
        const text = await file.text();
        if (file.name.toLowerCase().endsWith('.json')) {
          runnerData = JSON.parse(text);
          if (!Array.isArray(runnerData) || runnerData.length === 0) {
            throw new Error('JSON file must contain a non-empty array of objects');
          }
        } else if (file.name.toLowerCase().endsWith('.csv')) {
          runnerData = parseCSV(text);
        } else {
          throw new Error('Unsupported file format. Please select a .csv or .json file.');
        }

        filenameSpan.innerText = file.name;
        rowsSpan.innerText = runnerData.length;
        infoDiv.classList.remove('hidden');
        if (clearDataBtn) clearDataBtn.classList.remove('hidden');

        if (iterInput) {
          iterInput.value = runnerData.length;
          iterInput.disabled = true;
        }
      } catch (err) {
        showAlertDialog('Error parsing data file: ' + err.message, 'Data File Error');
        clearDataFileState();
      }
    });
  }
}

/**
 * Stop active runner workers and clean up running states
 */
function stopActiveRunner() {
  if (currentRun.workers) {
    currentRun.workers.forEach(w => w.terminate());
  }
  currentRun.active = false;
  currentRun.workers = [];

  const stopBtn = document.getElementById('btn-stop-run');
  if (stopBtn) {
    stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Run';
    stopBtn.disabled = false;
  }
}

/**
 * Collection Runner Orchestrator
 */
async function startCollectionRun() {
  const collId = document.getElementById('runner-select-collection').value;
  const envId = document.getElementById('runner-select-env').value;
  const iterations = Math.max(1, parseInt(document.getElementById('runner-iterations').value, 10) || 1);
  const delay = Math.max(0, parseInt(document.getElementById('runner-delay').value, 10) || 0);

  const mode = document.querySelector('input[name="runner-mode"]:checked').value;
  const threads = Math.max(1, parseInt(document.getElementById('runner-threads').value, 10) || 4);

  if (!collId) {
    showToast('Please select a collection to run.', 'error');
    return;
  }

  const collection = collections.find(c => String(c.id) === String(collId));
  if (!collection || !collection.requests || collection.requests.length === 0) {
    showToast('The selected collection contains no requests to execute.', 'error');
    return;
  }

  // Filter requests based on UI selection
  const checkedBoxes = document.querySelectorAll('.runner-req-checkbox:checked');
  const selectedReqIds = Array.from(checkedBoxes).map(cb => cb.value);
  const collectionVariables = Array.isArray(collection.variables)
    ? collection.variables.reduce((values, variable) => {
      if (variable.enabled !== false && variable.key) values[variable.key] = variable.value || '';
      return values;
    }, {})
    : { ...(collection.variables || {}) };
  const requestsToRun = collection.requests
    .filter(req => selectedReqIds.includes(String(req.id)))
    .map(req => ({ ...req, collectionId: collection.id, collectionVariables }));

  if (requestsToRun.length === 0) {
    showToast('Please select at least one request to run from the list.', 'error');
    return;
  }

  // Load environment variables for the run
  const runEnv = {};
  if (envId !== 'globals') {
    const selectedEnv = environments.find(e => String(e.id) === String(envId));
    if (selectedEnv && selectedEnv.variables) {
      selectedEnv.variables.forEach(v => {
        if (v.enabled !== false && v.key) runEnv[v.key] = v.value || '';
      });
    }
  }

  const runGlobals = { ...globals };

  for (const request of requestsToRun) {
    if (request.auth && request.auth.type === 'oauth2') {
      try {
        const oauthScopes = { globals: runGlobals, collectionVariables, environment: runEnv };
        const token = await acquireOAuthToken(request.auth, true, false, undefined, oauthScopes);
        request.auth = { ...request.auth, oauthAccessToken: token };
      } catch (error) {
        showAlertDialog(`Could not prepare OAuth for "${request.name}": ${error.message}`, 'OAuth Error');
        return;
      }
    }
  }

  // Clean Workers and set up running state
  stopActiveRunner();
  currentRun.active = true;
  currentRun.stopRequested = false;
  currentRun.paused = false;
  currentRun.logs = [];
  currentRun.stats = { passed: 0, failed: 0, totalTests: 0, totalRequests: 0, totalCompleted: 0, totalTime: 0 };

  // UI Updates
  document.getElementById('runner-results-empty').classList.add('hidden');
  document.getElementById('runner-results-workspace').classList.remove('hidden');
  document.getElementById('runner-execution-logs').innerHTML = '';
  document.getElementById('btn-export-run').classList.add('hidden');
  document.getElementById('btn-stop-run').classList.remove('hidden');
  document.getElementById('btn-pause-run').classList.remove('hidden');
  const pauseBtn = document.getElementById('btn-pause-run');
  if (pauseBtn) pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';

  const tasks = [];
  for (let iter = 1; iter <= iterations; iter++) {
    requestsToRun.forEach((req, idx) => {
      tasks.push({
        request: req,
        iteration: iter,
        iterationData: runnerData.length > 0 ? runnerData[iter - 1] : null,
        index: idx,
        id: `${req.id}-iter-${iter}-${Math.random().toString(36).substring(2, 6)}`
      });
    });
  }

  currentRun.stats.totalRequests = tasks.length;
  updateRunnerUIStats();

  const proxyUrl = `${window.location.origin}/api/proxy`;
  const engine = 'proxy';

  if (mode === 'sequential') {
    runSequential(requestsToRun, runGlobals, runEnv, proxyUrl, engine, envId, delay, iterations, runnerData);
  } else {
    runParallel(tasks, runGlobals, runEnv, proxyUrl, engine, threads);
  }
}

/**
 * Sequential execution (1 worker) propagating variables and supporting postman.setNextRequest
 */
async function runSequential(requestsToRun, globalsSnapshot, envSnapshot, proxyUrl, engine, envId, delay, iterations, runnerData) {
  let activeGlobals = { ...globalsSnapshot };
  let activeEnv = { ...envSnapshot };
  let activeCollectionVariables = { ...(requestsToRun[0].collectionVariables || {}) };

  const worker = new Worker('runner-worker.js');
  currentRun.workers.push(worker);

  currentRun.stats.totalRequests = requestsToRun.length * iterations;
  let completed = 0;

  for (let iter = 1; iter <= iterations; iter++) {
    if (currentRun.stopRequested) break;

    const iterationData = runnerData.length > 0 ? runnerData[iter - 1] : null;
    let reqIdx = 0;
    let stepsInIteration = 0;
    const maxStepsPerIteration = Math.max(requestsToRun.length * 10, 500);

    while (reqIdx >= 0 && reqIdx < requestsToRun.length) {
      while (currentRun.paused && !currentRun.stopRequested) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (currentRun.stopRequested) break;

      if (++stepsInIteration > maxStepsPerIteration) {
        console.warn('Maximum steps per iteration exceeded (possible setNextRequest loop). Stopping iteration.');
        break;
      }

      const req = requestsToRun[reqIdx];
      const task = {
        request: { ...req, collectionVariables: activeCollectionVariables },
        iteration: iter,
        iterationData: iterationData,
        index: reqIdx,
        id: `${req.id}-iter-${iter}-${stepsInIteration}-${Math.random().toString(36).substring(2, 6)}`
      };

      document.getElementById('runner-progress-status').innerText = `Running: Iteration ${task.iteration} - ${task.request.name}...`;

      const executePromise = new Promise((resolve) => {
        worker.onmessage = function(e) {
          if (e.data.status === 'success') {
            resolve(e.data.result);
          } else {
            resolve({
              requestId: task.request.id,
              requestName: task.request.name,
              method: task.request.method,
              url: task.request.url,
              globals: activeGlobals,
              environment: activeEnv,
              collectionVariables: activeCollectionVariables,
              logs: [{ type: 'error', message: `Execution error: ${e.data.error}`, time: new Date().toLocaleTimeString() }],
              testResults: [{ name: 'Request resolution', passed: false, error: e.data.error }],
              response: { status: 0, statusText: 'Error', headers: {}, body: e.data.error, time: 0, size: 0 }
            });
          }
        };
        worker.onerror = function(err) {
          resolve({
            requestId: task.request.id,
            requestName: task.request.name,
            method: task.request.method,
            url: task.request.url,
            globals: activeGlobals,
            environment: activeEnv,
            collectionVariables: activeCollectionVariables,
            logs: [{ type: 'error', message: `Worker error: ${err.message || 'Unknown worker failure'}`, time: new Date().toLocaleTimeString() }],
            testResults: [{ name: 'Worker execution', passed: false, error: err.message || 'Worker crashed' }],
            response: { status: 0, statusText: 'Worker Error', headers: {}, body: err.message || 'Worker crashed', time: 0, size: 0 }
          });
        };
      });

      worker.postMessage({
        action: 'run_request',
        request: task.request,
        globals: activeGlobals,
        environment: activeEnv,
        iterationData: task.iterationData || {},
        meta: { iteration: iter, iterationCount: iterations },
        proxyUrl,
        engine
      });

      const result = await executePromise;
      completed++;
      if (completed > currentRun.stats.totalRequests) {
        currentRun.stats.totalRequests = completed;
      }

      // Propagate mutated variables sequentially (iterationData never pollutes activeEnv)
      activeGlobals = result.globals || activeGlobals;
      activeEnv = result.environment || activeEnv;
      activeCollectionVariables = result.collectionVariables || activeCollectionVariables;

      globals = activeGlobals;
      saveGlobals();
      updateActiveEnvironmentVariables(activeEnv, envId);

      const activeCollection = collections.find(item => String(item.id) === String(req.collectionId));
      if (activeCollection) {
        activeCollection.variables = activeCollectionVariables;
        saveCollections();
      }

      logTaskResult(task, result);

      // Determine next request index (supports postman.setNextRequest)
      let nextIdx = reqIdx + 1;
      if (result.nextRequest === null) {
        nextIdx = requestsToRun.length; // Stop remaining requests in this iteration
      } else if (typeof result.nextRequest === 'string' && result.nextRequest.trim() !== '') {
        const target = result.nextRequest.trim();
        const foundIdx = requestsToRun.findIndex(r =>
          String(r.id) === target || (r.name || '').trim().toLowerCase() === target.toLowerCase()
        );
        nextIdx = foundIdx !== -1 ? foundIdx : requestsToRun.length;
      }

      const hasMoreSteps = nextIdx < requestsToRun.length || iter < iterations;
      if (delay > 0 && hasMoreSteps && !currentRun.stopRequested) {
        document.getElementById('runner-progress-status').innerText = `Waiting for delay (${delay}ms)...`;
        await new Promise(r => setTimeout(r, delay));
      }

      reqIdx = nextIdx;
    }
  }

  finalizeRunnerRun();
}

/**
 * Parallel multithreaded execution distributing tasks concurrently
 */
async function runParallel(tasks, globalsSnapshot, envSnapshot, proxyUrl, engine, threadCount) {
  let taskIndex = 0;
  const total = tasks.length;
  let activeWorkersCount = 0;

  const limit = Math.min(threadCount, total);
  document.getElementById('runner-progress-status').innerText = `Spawning ${limit} parallel worker threads...`;

  const workerPool = [];
  for (let i = 0; i < limit; i++) {
    const worker = new Worker('runner-worker.js');
    currentRun.workers.push(worker);
    workerPool.push(worker);
  }

  let isFinalizing = false;

  const executeNextTask = async (worker) => {
    while (currentRun.paused && !currentRun.stopRequested) {
      await new Promise(r => setTimeout(r, 200));
    }

    if (taskIndex >= total || currentRun.stopRequested) {
      worker.terminate();
      if (activeWorkersCount <= 0 && !isFinalizing) {
        isFinalizing = true;
        finalizeRunnerRun();
      }
      return;
    }

    const currentTaskIdx = taskIndex++;
    const task = tasks[currentTaskIdx];
    activeWorkersCount++;

    const handleTaskDone = (result) => {
      activeWorkersCount--;
      logTaskResult(task, result);
      const statusEl = document.getElementById('runner-progress-status');
      if (statusEl && currentRun.active && !currentRun.paused) {
        statusEl.innerText = `Running parallel (${limit} threads): ${currentRun.stats.totalCompleted} / ${total} completed...`;
      }
      executeNextTask(worker);
    };

    worker.onmessage = function(e) {
      if (e.data.status === 'success') {
        handleTaskDone(e.data.result);
      } else {
        handleTaskDone({
          requestId: task.request.id,
          requestName: task.request.name,
          method: task.request.method,
          url: task.request.url,
          globals: globalsSnapshot,
          environment: envSnapshot,
          logs: [{ type: 'error', message: `Execution error: ${e.data.error}`, time: new Date().toLocaleTimeString() }],
          testResults: [{ name: 'Request resolution', passed: false, error: e.data.error }],
          response: { status: 0, statusText: 'Error', headers: {}, body: e.data.error, time: 0, size: 0 }
        });
      }
    };

    worker.onerror = function(err) {
      handleTaskDone({
        requestId: task.request.id,
        requestName: task.request.name,
        method: task.request.method,
        url: task.request.url,
        globals: globalsSnapshot,
        environment: envSnapshot,
        logs: [{ type: 'error', message: `Worker error: ${err.message || 'Worker crashed'}`, time: new Date().toLocaleTimeString() }],
        testResults: [{ name: 'Worker execution', passed: false, error: err.message || 'Worker crashed' }],
        response: { status: 0, statusText: 'Worker Error', headers: {}, body: err.message || 'Worker crashed', time: 0, size: 0 }
      });
    };

    worker.postMessage({
      action: 'run_request',
      request: {
        ...task.request,
        collectionVariables: task.request.collectionVariables || {}
      },
      globals: globalsSnapshot,
      environment: envSnapshot,
      iterationData: task.iterationData || {},
      meta: { iteration: task.iteration, iterationCount: Math.ceil(total / Math.max(1, tasks.filter(t => t.iteration === 1).length)) },
      proxyUrl,
      engine
    });
  };

  workerPool.forEach(w => executeNextTask(w));
}

/**
 * Handle logging and visualization of finished request
 */
function logTaskResult(task, result) {
  currentRun.logs.push({ task, result });

  let passedCount = 0;
  let failedCount = 0;

  if (result.testResults) {
    result.testResults.forEach(t => {
      if (t.passed) passedCount++; else failedCount++;
    });
  }

  currentRun.stats.passed += passedCount;
  currentRun.stats.failed += failedCount;
  currentRun.stats.totalTests += (passedCount + failedCount);
  currentRun.stats.totalCompleted++;
  currentRun.stats.totalTime += (result.response.time || 0);

  renderRunnerLogRow(task, result, passedCount, failedCount);
  updateRunnerUIStats();
}

/**
 * Add log item container to runner panel
 */
function renderRunnerLogRow(task, result, passed, failed) {
  const container = document.getElementById('runner-execution-logs');
  if (!container) return;

  const logId = `run-log-${task.id}`;
  const logItem = document.createElement('div');
  const hasTests = Array.isArray(result.testResults) && result.testResults.length > 0;
  const status = Number(result.response && result.response.status) || 0;
  const isFailed = hasTests ? (failed > 0 || status === 0) : (status === 0 || status >= 400);
  logItem.className = `runner-log-item ${isFailed ? 'log-item-fail' : 'log-item-pass'}`;
  logItem.id = logId;

  let methodClass = 'method-badge-other';
  const method = (task.request.method || 'GET').toLowerCase();
  if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
    methodClass = `method-badge-${method}`;
  }

  const safeUrl = escapeHTML(result.url || '');
  const safeReqName = escapeHTML(task.request.name || '');
  const safeMethod = escapeHTML(task.request.method || 'GET');
  const safeStatusText = escapeHTML((result.response && result.response.statusText) || '');

  logItem.innerHTML = `
    <div class="runner-log-header" onclick="toggleRunnerLogDetails('${logId}')">
      <div class="runner-log-left">
        <span class="runner-badge" style="background-color: #1a1e2f; color: var(--text-muted); font-size: 11px;">Iter ${task.iteration}</span>
        <span class="history-method ${methodClass}" style="min-width: 45px; text-align: center;">${safeMethod}</span>
        <span class="runner-log-title" title="${safeUrl}">${safeReqName}</span>
      </div>
      <div class="runner-log-right">
        <span class="runner-log-time">${(result.response && result.response.time) || 0} ms</span>
        <span class="runner-badge ${status >= 200 && status < 300 ? 'pass' : 'fail'}" style="font-family: var(--font-mono);">${status} ${safeStatusText}</span>
        <div class="runner-log-badge-container">
          ${passed > 0 || failed > 0 ? `
            <span class="runner-badge pass">${passed} Passed</span>
            <span class="runner-badge ${failed > 0 ? 'fail' : 'pass'}" style="opacity: ${failed > 0 ? 1 : 0.4};">${failed} Failed</span>
          ` : `<span class="runner-badge" style="color: var(--text-muted);">No Tests</span>`}
        </div>
        <i class="fa-solid fa-chevron-down toggle-icon" style="color: var(--text-muted); transition: var(--transition);"></i>
      </div>
    </div>
    <div class="runner-log-details hidden">
      <div class="runner-detail-section">
        <h5>Request URL</h5>
        <div class="runner-code-block">${safeUrl}</div>
      </div>

      ${result.testResults && result.testResults.length > 0 ? `
        <div class="runner-detail-section">
          <h5>Test Assertions</h5>
          <div class="runner-detail-tests">
            ${result.testResults.map(tr => `
              <div class="runner-detail-test ${tr.passed ? 'pass' : 'fail'}">
                <i class="fa-solid ${tr.passed ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
                <span><strong>${tr.passed ? 'PASS' : 'FAIL'}</strong>: ${escapeHTML(tr.name)} ${tr.error ? ` - ${escapeHTML(tr.error)}` : ''}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${result.logs && result.logs.length > 0 ? `
        <div class="runner-detail-section">
          <h5>Console Logs</h5>
          <div class="runner-code-block" style="color: var(--text-muted); font-size: 11px;">
            ${result.logs.map(log => `[${escapeHTML(log.time)}] [${escapeHTML((log.type || 'info').toUpperCase())}] ${escapeHTML(log.message)}`).join('\n')}
          </div>
        </div>
      ` : ''}

      ${result.requestBody ? `
        <div class="runner-detail-section">
          <h5>Request Body</h5>
          <pre class="runner-code-block">${escapeHTML(result.requestBody)}</pre>
        </div>
      ` : ''}
      <div class="runner-detail-section">
        <h5>Response Body</h5>
        <pre class="runner-code-block">${escapeHTML((result.response && result.response.body) || '(No response body)')}</pre>
      </div>
    </div>
  `;

  container.appendChild(logItem);

  while (container.children.length > 250) {
    container.removeChild(container.firstChild);
  }
}

window.toggleRunnerLogDetails = function(logId) {
  const item = document.getElementById(logId);
  if (!item) return;

  const details = item.querySelector('.runner-log-details');
  const icon = item.querySelector('.toggle-icon');

  if (details.classList.contains('hidden')) {
    details.classList.remove('hidden');
    icon.style.transform = 'rotate(180deg)';
  } else {
    details.classList.add('hidden');
    icon.style.transform = 'rotate(0deg)';
  }
};

function updateRunnerUIStats() {
  document.getElementById('run-stat-passed').innerText = currentRun.stats.passed;
  document.getElementById('run-stat-failed').innerText = currentRun.stats.failed;

  const avg = currentRun.stats.totalCompleted > 0 ? Math.round(currentRun.stats.totalTime / currentRun.stats.totalCompleted) : 0;
  document.getElementById('run-stat-avg-time').innerText = `${avg} ms`;

  document.getElementById('run-stat-total-req').innerText = `${currentRun.stats.totalCompleted} / ${currentRun.stats.totalRequests}`;

  const pct = currentRun.stats.totalRequests > 0 ? Math.min(100, Math.round((currentRun.stats.totalCompleted / currentRun.stats.totalRequests) * 100)) : 0;
  const progressFill = document.getElementById('runner-progress-fill');
  if (progressFill) {
    progressFill.style.width = `${pct}%`;
    if (currentRun.stats.failed > 0) {
      progressFill.classList.add('fail-red');
    } else {
      progressFill.classList.remove('fail-red');
    }
  }
}

function finalizeRunnerRun() {
  currentRun.active = false;

  document.getElementById('runner-progress-status').innerText = currentRun.stopRequested ? 'Execution stopped by user.' : 'Execution run completed.';
  document.getElementById('btn-stop-run').classList.add('hidden');
  document.getElementById('btn-pause-run').classList.add('hidden');
  document.getElementById('btn-export-run').classList.remove('hidden');

  const progressFill = document.getElementById('runner-progress-fill');
  if (progressFill && !currentRun.stopRequested) {
    progressFill.style.width = '100%';
  }

  stopActiveRunner();
}

/**
 * Update system variables snapshot in memory if mutated inside worker run
 */
function updateActiveEnvironmentVariables(envSnapshot, envId = activeEnvId) {
  if (!envSnapshot || typeof envSnapshot !== 'object') return;
  if (envId === 'globals') {
    globals = { ...envSnapshot };
    saveGlobals();
  } else {
    const activeEnv = environments.find(e => String(e.id) === String(envId));
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
 * Export completed test report as JSON file
 */
function exportRunReport() {
  if (currentRun.logs.length === 0) return;

  const reportData = {
    appName: 'ExpressPost Collection Runner Report',
    timestamp: new Date().toISOString(),
    stats: currentRun.stats,
    runs: currentRun.logs.map(log => ({
      iteration: log.task.iteration,
      requestName: log.task.request.name,
      method: log.task.request.method,
      url: log.result.url,
      responseTime: log.result.response.time,
      statusCode: log.result.response.status,
      statusText: log.result.response.statusText,
      assertionsTotal: log.result.testResults ? log.result.testResults.length : 0,
      assertionsPassed: log.result.testResults ? log.result.testResults.filter(t => t.passed).length : 0,
      assertionsFailed: log.result.testResults ? log.result.testResults.filter(t => !t.passed).length : 0,
      assertions: log.result.testResults || [],
      consoleLogs: log.result.logs || []
    }))
  };

  const jsonStr = JSON.stringify(reportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `ExpressPost-run-report-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Sidebar Resizer Logic for Runner
const runnerSidebarResizer = document.getElementById('runner-sidebar-resizer');
let isRunnerResizing = false;

if (runnerSidebarResizer) {
  runnerSidebarResizer.addEventListener('mousedown', (e) => {
    isRunnerResizing = true;
    document.body.style.cursor = 'col-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isRunnerResizing) return;
    
    // Calculate new width based on mouse position
    let newWidth = e.clientX;
    
    // Constrain width between 250px and 600px
    if (newWidth < 250) newWidth = 250;
    if (newWidth > 600) newWidth = 600;
    
    document.documentElement.style.setProperty('--runner-sidebar-width', `${newWidth}px`);
  });

  document.addEventListener('mouseup', () => {
    if (isRunnerResizing) {
      isRunnerResizing = false;
      document.body.style.cursor = 'default';
    }
  });
}
