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
  localStorage.setItem('collections', JSON.stringify(collections));
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

  if (collections.length === 0) {
    listElement.innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-folder-open"></i>
        <p>No collections yet. Create one to begin.</p>
      </div>`;
    return;
  }

  listElement.innerHTML = '';
  collections.forEach(coll => {
    const collDiv = document.createElement('div');
    collDiv.className = 'coll-folder';
    collDiv.id = `folder-${coll.id}`;

    const isExpanded = coll.isExpanded !== false;
    const iconClass = isExpanded ? 'fa-folder-open' : 'fa-folder';
    const displayStyle = isExpanded ? 'block' : 'none';
    const safeCollName = (coll.name || '').replace(/"/g, '&quot;');

    collDiv.innerHTML = `
      <div class="coll-folder-header" data-id="${coll.id}" style="cursor: pointer; user-select: none;">
        <div class="coll-folder-title">
          <i class="fa-solid ${iconClass}" style="color: #f9d877;"></i>
          <span title="${safeCollName}">${coll.name}</span>
        </div>
        <div class="coll-folder-actions">
          <button class="icon-btn btn-add-req-to-coll" data-id="${coll.id}" title="Add Request"><i class="fa-solid fa-file-circle-plus"></i></button>
          <button class="icon-btn btn-run-coll-direct" data-id="${coll.id}" title="Run Collection"><i class="fa-solid fa-circle-play"></i></button>
          <button class="icon-btn btn-delete-coll" data-id="${coll.id}" title="Delete Collection"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>
      <div class="folder-requests" id="requests-list-${coll.id}" style="display: ${displayStyle};">
        <!-- Requests will be appended here -->
      </div>
    `;

    const header = collDiv.querySelector('.coll-folder-header');
    header.addEventListener('click', (e) => {
      if (e.target.closest('.coll-folder-actions')) return;
      coll.isExpanded = !isExpanded;
      saveCollections();
      renderCollections();
    });

    const reqsContainer = collDiv.querySelector(`#requests-list-${coll.id}`);
    
    if (coll.requests && coll.requests.length > 0) {
      coll.requests.forEach(req => {
        const reqItem = document.createElement('div');
        reqItem.className = 'coll-req-item';
        reqItem.dataset.id = req.id;
        reqItem.dataset.collId = coll.id;
        
        let methodClass = 'method-badge-other';
        const method = (req.method || 'GET').toLowerCase();
        if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
          methodClass = `method-badge-${method}`;
        }
        
        const safeReqName = (req.name || '').replace(/"/g, '&quot;');

        reqItem.innerHTML = `
          <div class="coll-req-title-wrapper">
            <span class="history-method ${methodClass}" style="font-size: 8px; padding: 1px 3px; min-width: 32px;">${req.method}</span>
            <span class="coll-req-title" title="${safeReqName}">${req.name}</span>
          </div>
          <button class="icon-btn btn-delete-req-from-coll" title="Delete"><i class="fa-solid fa-xmark"></i></button>
        `;
        
        // Direct event listener binding to bypass any delegation issues
        const delBtn = reqItem.querySelector('.btn-delete-req-from-coll');
        delBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (confirm('Remove request from collection?')) {
            coll.requests = coll.requests.filter(r => String(r.id) !== String(req.id));
            saveCollections();
            renderCollections();
            if (typeof populateRunnerSelects === 'function') populateRunnerSelects();
          }
        });

        reqsContainer.appendChild(reqItem);
      });
    } else {
      reqsContainer.innerHTML = `<div class="empty-state" style="padding: 10px; font-size: 11px;"><p>Folder empty</p></div>`;
    }

    listElement.appendChild(collDiv);
  });
}



// Populate Runner Select Dropdowns
function populateRunnerSelects() {
  const collSelect = document.getElementById('runner-select-collection');
  const envSelect = document.getElementById('runner-select-env');
  const activeEnvSelect = document.getElementById('active-env-select');

  if (!collSelect || !envSelect || !activeEnvSelect) return;

  // Collection Options
  collSelect.innerHTML = '';
  if (collections.length === 0) {
    collSelect.innerHTML = `<option value="">-- No Collections --</option>`;
  } else {
    collections.forEach(c => {
      collSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
  }

  // Environment Options
  envSelect.innerHTML = `<option value="globals">No Environment</option>`;
  activeEnvSelect.innerHTML = `<option value="globals">No Environment</option>`;

  environments.forEach(env => {
    envSelect.innerHTML += `<option value="${env.id}">${env.name}</option>`;
    activeEnvSelect.innerHTML += `<option value="${env.id}">${env.name}</option>`;
  });

  activeEnvSelect.value = activeEnvId;

  if (collSelect.value) {
    renderRunnerRequestList(collSelect.value);
  }
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
  
  const collection = collections.find(c => c.id === collId);
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

    const safeRunnerReqName = (req.name || '').replace(/"/g, '&quot;');
    listContainer.innerHTML += `
      <label class="runner-request-item coll-req-item" style="padding: 4px 8px;">
        <input type="checkbox" class="runner-req-checkbox" value="${req.id}" checked>
        <div class="coll-req-title-wrapper">
          <span class="history-method ${methodClass}" style="font-size: 8px; padding: 1px 3px; min-width: 32px;">${req.method}</span>
          <span class="coll-req-title" title="${safeRunnerReqName}">${req.name}</span>
        </div>
      </label>
    `;
  });
}

function setupRunnerEventListeners() {
  const openRunnerBtn = document.getElementById('btn-open-runner');
  const closeRunnerBtn = document.getElementById('btn-close-runner');
  const runnerView = document.getElementById('runner-view');
  
  if (openRunnerBtn && runnerView) {
    openRunnerBtn.addEventListener('click', () => {
      populateRunnerSelects();
      runnerView.classList.remove('hidden');
    });
  }

  const collSelect = document.getElementById('runner-select-collection');
  if (collSelect) {
    collSelect.addEventListener('change', (e) => {
      renderRunnerRequestList(e.target.value);
    });
  }

  if (closeRunnerBtn && runnerView) {
    closeRunnerBtn.addEventListener('click', () => {
      if (currentRun.active) {
        if (confirm('A collection run is currently in progress. Do you want to stop it and exit?')) {
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
      stopRunBtn.innerText = 'Stopping...';
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
      if (e.target.tagName !== 'BUTTON') return;
      const filter = e.target.dataset.filter;
      
      // Update active state
      Array.from(logFilters.children).forEach(btn => btn.classList.remove('active'));
      e.target.classList.add('active');

      // Apply filter
      logList.className = `runner-log-list filter-${filter}`;
    });
  }

  // Export report action
  const exportBtn = document.getElementById('btn-export-run');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportRunReport);
  }

  // Data File Upload
  const dataFileInput = document.getElementById('runner-data-file');
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
        if (file.name.endsWith('.json')) {
          runnerData = JSON.parse(text);
          if (!Array.isArray(runnerData)) throw new Error('JSON file must contain an array of objects');
        } else if (file.name.endsWith('.csv')) {
          const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
          if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
          
          const headers = lines[0].split(',').map(h => h.trim());
          runnerData = lines.slice(1).map(line => {
            const values = line.split(',');
            const obj = {};
            headers.forEach((h, i) => {
              obj[h] = values[i] ? values[i].trim() : '';
            });
            return obj;
          });
        } else {
          throw new Error('Unsupported file format');
        }
        
        // Update UI
        filenameSpan.innerText = file.name;
        rowsSpan.innerText = runnerData.length;
        infoDiv.classList.remove('hidden');
        
        // Force iterations count to match data rows
        if (iterInput) {
          iterInput.value = runnerData.length;
          iterInput.disabled = true;
        }
      } catch (err) {
        alert('Error parsing data file: ' + err.message);
        runnerData = [];
        infoDiv.classList.add('hidden');
        if (iterInput) iterInput.disabled = false;
        dataFileInput.value = ''; // Reset
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
    stopBtn.innerText = 'Stop Run';
    stopBtn.disabled = false;
  }
}

/**
 * Collection Runner Orchestrator
 */
async function startCollectionRun() {
  const collId = document.getElementById('runner-select-collection').value;
  const envId = document.getElementById('runner-select-env').value;
  const iterations = parseInt(document.getElementById('runner-iterations').value) || 1;
  const delay = parseInt(document.getElementById('runner-delay').value) || 0;
  
  const mode = document.querySelector('input[name="runner-mode"]:checked').value;
  const threads = parseInt(document.getElementById('runner-threads').value) || 4;

  if (!collId) {
    alert('Please select a collection to run.');
    return;
  }

  const collection = collections.find(c => c.id === collId);
  if (!collection || !collection.requests || collection.requests.length === 0) {
    alert('The selected collection contains no requests to execute.');
    return;
  }

  // Filter requests based on UI selection
  const checkedBoxes = document.querySelectorAll('.runner-req-checkbox:checked');
  const selectedReqIds = Array.from(checkedBoxes).map(cb => cb.value);
  const requestsToRun = collection.requests.filter(req => selectedReqIds.includes(req.id));
  
  if (requestsToRun.length === 0) {
    alert('Please select at least one request to run from the list.');
    return;
  }

  // Set up running states
  currentRun.active = true;
  currentRun.stopRequested = false;
  currentRun.paused = false;
  currentRun.logs = [];
  currentRun.stats = { passed: 0, failed: 0, totalTests: 0, totalRequests: 0, totalCompleted: 0, totalTime: 0 };
  
  // Clean Workers
  stopActiveRunner();
  currentRun.active = true; // reset to active since stopActiveRunner sets to false

  // UI Updates
  document.getElementById('runner-results-empty').classList.add('hidden');
  document.getElementById('runner-results-workspace').classList.remove('hidden');
  document.getElementById('runner-execution-logs').innerHTML = '';
  document.getElementById('btn-export-run').classList.add('hidden');
  document.getElementById('btn-stop-run').classList.remove('hidden');
  document.getElementById('btn-pause-run').classList.remove('hidden');
  const pauseBtn = document.getElementById('btn-pause-run');
  if (pauseBtn) pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
  
  updateRunnerUIStats();

  // Load environment variables for the run
  let runEnv = {};
  if (envId !== 'globals') {
    const selectedEnv = environments.find(e => e.id === envId);
    if (selectedEnv && selectedEnv.variables) {
      selectedEnv.variables.forEach(v => {
        if (v.enabled !== false) runEnv[v.key] = v.value || '';
      });
    }
  }

  // Load global variables snapshot
  let runGlobals = { ...globals };

  // Generate Queue of Task Tasks
  // Each task has a request, iteration index, and index within collection
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

  // Create absolute Proxy URL
  const proxyUrl = `${window.location.origin}/api/proxy`;
  // Determine engine
  // Use proxy mode for all external routes, or get it from active settings
  const engine = 'proxy'; // Always use proxy in runner to secure CORS bypass on requests

  // Orchestrate execution based on mode
  if (mode === 'sequential') {
    runSequential(requestsToRun, runGlobals, runEnv, proxyUrl, engine, delay, iterations, runnerData);
  } else {
    runParallel(tasks, runGlobals, runEnv, proxyUrl, engine, threads);
  }
}

/**
 * Sequential execution (1 worker) propagating variables and supporting postman.setNextRequest
 */
async function runSequential(requestsToRun, globalsSnapshot, envSnapshot, proxyUrl, engine, delay, iterations, runnerData) {
  let activeGlobals = { ...globalsSnapshot };
  let activeEnv = { ...envSnapshot };

  const worker = new Worker('runner-worker.js');
  currentRun.workers.push(worker);

  currentRun.stats.totalRequests = requestsToRun.length * iterations;
  let completed = 0;

  for (let iter = 1; iter <= iterations; iter++) {
    if (currentRun.stopRequested) break;
    
    const iterationData = runnerData.length > 0 ? runnerData[iter - 1] : null;

    for (let reqIdx = 0; reqIdx < requestsToRun.length; reqIdx++) {
      while (currentRun.paused && !currentRun.stopRequested) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (currentRun.stopRequested) break;

      const req = requestsToRun[reqIdx];
      const task = {
        request: req,
        iteration: iter,
        iterationData: iterationData,
        index: reqIdx,
        id: `${req.id}-iter-${iter}-${Math.random().toString(36).substring(2, 6)}`
      };
      
      // Update progress description
      document.getElementById('runner-progress-status').innerText = `Running: Iteration ${task.iteration} - ${task.request.name}...`;

      const taskEnv = task.iterationData ? { ...activeEnv, ...task.iterationData } : activeEnv;

      // Execute through worker
      const executePromise = new Promise((resolve) => {
        worker.onmessage = function(e) {
          if (e.data.status === 'success') {
            resolve(e.data.result);
          } else {
            // Failure
            resolve({
              requestId: task.request.id,
              requestName: task.request.name,
              method: task.request.method,
              url: task.request.url,
              globals: activeGlobals,
              environment: taskEnv,
              logs: [{ type: 'error', message: `Execution error: ${e.data.error}`, time: new Date().toLocaleTimeString() }],
              testResults: [{ name: 'Request resolution', passed: false, error: e.data.error }],
              response: { status: 0, statusText: 'Error', headers: {}, body: e.data.error, time: 0, size: 0 }
            });
          }
        };
      });

      worker.postMessage({
        action: 'run_request',
        request: task.request,
        globals: activeGlobals,
        environment: taskEnv,
        proxyUrl,
        engine
      });

      const result = await executePromise;
      completed++;
      currentRun.stats.totalCompleted = completed;
      updateRunnerUIStats();

      // Propagate mutated variables sequentially
      activeGlobals = result.globals;
      activeEnv = result.environment;

      // Save run log
      logTaskResult(task, result);
      updateActiveEnvironmentVariables(result.environment);

      // Apply delay
      if (delay > 0 && reqIdx < requestsToRun.length && !currentRun.stopRequested) {
        document.getElementById('runner-progress-status').innerText = `Waiting for delay (${delay}ms)...`;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  finalizeRunnerRun();
}

/**
 * Parallel multithreaded execution distributing tasks concurrently
 */
async function runParallel(tasks, globalsSnapshot, envSnapshot, proxyUrl, engine, threadCount) {
  // Concurrency scheduler variables
  let taskIndex = 0;
  const total = tasks.length;
  let activeWorkersCount = 0;

  // We limit workers count to the lower of task count or slider setting
  const limit = Math.min(threadCount, total);

  document.getElementById('runner-progress-status').innerText = `Spawning ${limit} parallel workers threads...`;

  const workerPool = [];
  for (let i = 0; i < limit; i++) {
    const worker = new Worker('runner-worker.js');
    currentRun.workers.push(worker);
    workerPool.push(worker);
  }

  let isFinalizing = false;

  // Queue process promise
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

    worker.onmessage = function(e) {
      activeWorkersCount--;
      let result;
      if (e.data.status === 'success') {
        result = e.data.result;
      } else {
        result = {
          requestId: task.request.id,
          requestName: task.request.name,
          method: task.request.method,
          url: task.request.url,
          globals: globalsSnapshot,
          environment: envSnapshot,
          logs: [{ type: 'error', message: `Execution error: ${e.data.error}`, time: new Date().toLocaleTimeString() }],
          testResults: [{ name: 'Request resolution', passed: false, error: e.data.error }],
          response: { status: 0, statusText: 'Error', headers: {}, body: e.data.error, time: 0, size: 0 }
        };
      }

      // Log results immediately
      logTaskResult(task, result);

      // Re-trigger worker on next queue item
      executeNextTask(worker);
    };

    const taskEnv = task.iterationData ? { ...envSnapshot, ...task.iterationData } : envSnapshot;

    worker.postMessage({
      action: 'run_request',
      request: task.request,
      globals: globalsSnapshot, // in parallel, all get initial snapshot
      environment: taskEnv,
      proxyUrl,
      engine
    });
  };

  // Kickoff workers
  workerPool.forEach(w => executeNextTask(w));
}

/**
 * Handle logging and visualization of finished request
 */
function logTaskResult(task, result) {
  currentRun.logs.push({ task, result });
  
  // Calculate test counters
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

  // Render log row
  renderRunnerLogRow(task, result, passedCount, failedCount);
  
  // Update aggregate metric dashboards
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
  const isFailed = failed > 0 || result.response.status === 0 || result.response.status >= 400;
  logItem.className = `runner-log-item ${isFailed ? 'log-item-fail' : 'log-item-pass'}`;
  logItem.id = logId;

  const isSuccess = failed === 0 && result.response.status >= 200 && result.response.status < 400;
  let statusClass = 'runner-badge pass';
  if (failed > 0 || result.response.status === 0 || result.response.status >= 400) {
    statusClass = 'runner-badge fail';
  }

  // Method Badge formatting
  let methodClass = 'method-badge-other';
  const method = (task.request.method || 'GET').toLowerCase();
  if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
    methodClass = `method-badge-${method}`;
  }

  logItem.innerHTML = `
    <div class="runner-log-header" onclick="toggleRunnerLogDetails('${logId}')">
      <div class="runner-log-left">
        <span class="runner-badge" style="background-color: #1a1e2f; color: var(--text-muted); font-size: 11px;">Iter ${task.iteration}</span>
        <span class="history-method ${methodClass}" style="min-width: 45px; text-align: center;">${task.request.method}</span>
        <span class="runner-log-title" title="${result.url}">${task.request.name}</span>
      </div>
      <div class="runner-log-right">
        <span class="runner-log-time">${result.response.time || 0} ms</span>
        <span class="runner-badge ${result.response.status >= 200 && result.response.status < 300 ? 'pass' : 'fail'}" style="font-family: var(--font-mono);">${result.response.status} ${result.response.statusText}</span>
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
      <!-- Expanded contents: headers, payload, response logs -->
      <div class="runner-detail-section">
        <h5>Request URL</h5>
        <div class="runner-code-block">${result.url}</div>
      </div>
      
      ${result.testResults && result.testResults.length > 0 ? `
        <div class="runner-detail-section">
          <h5>Test Assertions</h5>
          <div class="runner-detail-tests">
            ${result.testResults.map(tr => `
              <div class="runner-detail-test ${tr.passed ? 'pass' : 'fail'}">
                <i class="fa-solid ${tr.passed ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
                <span><strong>${tr.passed ? 'PASS' : 'FAIL'}</strong>: ${tr.name} ${tr.error ? ` - ${tr.error}` : ''}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${result.logs && result.logs.length > 0 ? `
        <div class="runner-detail-section">
          <h5>Console Logs</h5>
          <div class="runner-code-block" style="color: var(--text-muted); font-size: 11px;">
            ${result.logs.map(log => `[${log.time}] [${log.type.toUpperCase()}] ${log.message}`).join('\n')}
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
        <pre class="runner-code-block">${escapeHTML(result.response.body || '(No response body)')}</pre>
      </div>
    </div>
  `;

  container.appendChild(logItem);

  // Enforce Max 100 logs in DOM to prevent browser freeze during massive bulk tests
  while (container.children.length > 100) {
    container.removeChild(container.firstChild);
  }
}

// Toggle detail block display
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

/**
 * Refresh top aggregations metrics and progress bar
 */
function updateRunnerUIStats() {
  document.getElementById('run-stat-passed').innerText = currentRun.stats.passed;
  document.getElementById('run-stat-failed').innerText = currentRun.stats.failed;
  
  const avg = currentRun.stats.totalCompleted > 0 ? Math.round(currentRun.stats.totalTime / currentRun.stats.totalCompleted) : 0;
  document.getElementById('run-stat-avg-time').innerText = `${avg} ms`;
  
  document.getElementById('run-stat-total-req').innerText = `${currentRun.stats.totalCompleted} / ${currentRun.stats.totalRequests}`;

  // Fill Progress Bar
  const pct = currentRun.stats.totalRequests > 0 ? Math.round((currentRun.stats.totalCompleted / currentRun.stats.totalRequests) * 100) : 0;
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

/**
 * Handle termination metrics and buttons swap
 */
function finalizeRunnerRun() {
  currentRun.active = false;
  
  document.getElementById('runner-progress-status').innerText = currentRun.stopRequested ? 'Execution stopped by user.' : 'Execution run completed.';
  document.getElementById('btn-stop-run').classList.add('hidden');
  document.getElementById('btn-pause-run').classList.add('hidden');
  document.getElementById('btn-export-run').classList.remove('hidden');
  
  // Clean up workers pool
  stopActiveRunner();
}

/**
 * Update system variables snapshot in memory if mutated inside worker run
 */
function updateActiveEnvironmentVariables(envSnapshot) {
  if (activeEnvId === 'globals') {
    // Globals update
    Object.keys(envSnapshot).forEach(key => {
      globals[key] = envSnapshot[key];
    });
    saveGlobals();
  } else {
    // Selected Environment update
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

// Helpers
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
