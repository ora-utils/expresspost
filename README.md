# ExpressPost (Postman Clone)

ExpressPost is a premium, multithreaded API client and Collection Runner built with standard web technologies. It is designed to look and feel exactly like Postman while providing powerful concurrency testing features out of the box.

## 🚀 Features

- **Advanced Request Crafting**: Support for GET, POST, PUT, DELETE, PATCH, and more. Easily configure Query Params, Headers, and Request Bodies (JSON, XML, Form-Data).
- **Collection Management**: Organize your API requests into collections and folders just like Postman. 
- **Environment Variables**: Define environments (e.g., Development, Production) and use `{{variable_name}}` syntax throughout your URLs, headers, and bodies.
- **Multithreaded Collection Runner**: Run massive API tests in parallel using Web Workers. You can set execution threads, delays, and iteration counts, and upload CSV/JSON data files for data-driven testing.
- **Pre-request & Post-response Scripts**: Update request URL, method, headers, and body before dispatch; assert response status, headers, JSON, and timing afterward. Script snippets and environment, collection, global, local, and iteration data helpers are included.
- **OAuth 2.0**: Client Credentials, Password (legacy), Authorization Code, and Authorization Code with PKCE. Access tokens can be refreshed when a refresh token is returned.
- **Postman-style scripting**: `pm.sendRequest()` supports promise and callback styles in request and response scripts. Sequential runs propagate variables between requests; parallel runs use independent snapshots.
- **Collection import/export**: Import Postman v2 collections with nested folder paths, inherited auth/scripts, query parameters, and supported body types. Export an ExpressPost collection JSON backup from the collection list.
- **Appearance settings**: Choose Dark, Midnight, or Light themes, set an accent color, and switch between comfortable and compact layouts. Preferences are saved locally in the browser.
- **Electron & Browser Support**: Run it as a lightweight web app in your browser or build it as a standalone Desktop application using Electron.

**Direct Mode and CORS:** Direct Mode sends requests from the browser, so the API server must allow the app's origin and any preflight method/headers. Enterprise APIs such as Oracle Fusion may restrict these origins; use Proxy Mode unless the API's CORS configuration explicitly allows this app.

---

## 🛠️ Developer Documentation

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Local Setup & Installation

1. **Clone the repository** (if hosted on Git):
   ```bash
   git clone <repository_url>
   cd ExpressPost
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Start the Application**:
   You can run the app in two ways:
   
   **Option A: Browser Mode (Express Server)**
   ```bash
   npm start
   ```
   This starts the Node.js backend server and a CORS proxy. Open your browser and navigate to: `http://localhost:3000`.

   **Option B: Desktop Mode (Electron)**
   ```bash
   npm run desktop
   ```
   This launches the fully-featured standalone desktop application.

### Building for Production
To package the app into a Windows portable executable (.exe):
```bash
npm run build-win
```
The output will be found in the `/dist` directory.

---

## 💾 Data Persistence & Storage

### Where is my data saved?
Requests, collections, and environments are saved locally in the browser's (or Electron's) `localStorage`. OAuth client secrets, passwords, and issued tokens are kept in `sessionStorage` and are removed when the browser session ends. Other saved auth types (Bearer, Basic, and API Key) remain part of the locally stored request configuration.

- The `localStorage` engine automatically saves changes in real-time as you type or organize your folders.
- *Note: If you clear your browser's Site Data/Cache, you will lose your local collections! Always export important collections.*
- Saving a request already in a collection updates that record. Changing its collection moves the existing record instead of creating a duplicate.
- API requests and OAuth token requests are sent to the configured remote servers. Exported collections omit built-in auth credentials and sensitive headers; re-enter credentials after importing. Secrets embedded in request bodies, scripts, or ordinary variables cannot be detected automatically.

### OAuth 2.0 setup
Choose **OAuth 2.0**, select the grant, and enter the issuer's token URL and client details. Authorization Code flows also need an authorization URL and a redirect URI registered with the identity provider. The default redirect is `<app-origin>/oauth/callback`; use **Get New Access Token** to complete sign-in. Token requests use Proxy Mode. The Password grant is legacy and should only be used when the identity provider requires it.

### Request Scripts
Pre-request scripts can use `pm.request.url`, `pm.request.method`, `pm.request.headers` (`get`, `set`, `add`, `remove`, and `toObject`), `pm.request.body.update()`, and `pm.sendRequest()`. `pm.sendRequest()` accepts a URL or request object and may be awaited or called with a callback. Variables are available through `pm.variables`, `pm.environment`, `pm.collectionVariables`, `pm.globals`, and `pm.iterationData`.

Post-response scripts can use `pm.response.text()`, `pm.response.json()`, response headers/status/timing, `pm.test()`, and `pm.expect()` assertions such as `eql`, `include`, `property`, `above`, and `below`. Scripts execute locally as JavaScript; only run scripts you trust.

### How to Export Collections
You can easily backup your work or share it with team members:
1. Open the **Sidebar**.
2. Find the collection you want to export.
3. Click the **Export** icon next to the collection name.
4. It will download a structured `.json` file containing all your requests, scripts, and configurations.

### How to Import Collections
1. At the top of the sidebar, click the **Import** button.
2. Select an ExpressPost or Postman v2 `.json` collection file from your local machine.
3. The collection and its requests will immediately populate into your local workspace.
4. Imported form-data file references do not contain the original file bytes; select the files again before sending those requests.
