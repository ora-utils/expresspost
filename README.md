# ExpressPost (Postman Clone)

ExpressPost is a premium, multithreaded API client and Collection Runner built with standard web technologies. It is designed to look and feel exactly like Postman while providing powerful concurrency testing features out of the box.

## 🚀 Features

- **Advanced Request Crafting**: Support for GET, POST, PUT, DELETE, PATCH, and more. Easily configure Query Params, Headers, and Request Bodies (JSON, XML, Form-Data).
- **Collection Management**: Organize your API requests into collections and folders just like Postman. 
- **Environment Variables**: Define environments (e.g., Development, Production) and use `{{variable_name}}` syntax throughout your URLs, headers, and bodies.
- **Multithreaded Collection Runner**: Run massive API tests in parallel using Web Workers. You can set execution threads, delays, and iteration counts, and upload CSV/JSON data files for data-driven testing.
- **Pre-request & Test Scripts**: Write Javascript assertions and scripts that execute in a sandboxed environment before and after requests.
- **Electron & Browser Support**: Run it as a lightweight web app in your browser or build it as a standalone Desktop application using Electron.

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
All your configurations, requests, collections, and environments are saved **persistently and locally** in your browser's (or Electron's) `localStorage`. 

- Your data never leaves your machine.
- The `localStorage` engine automatically saves changes in real-time as you type or organize your folders.
- *Note: If you clear your browser's Site Data/Cache, you will lose your local collections! Always export important collections.*

### How to Export Collections
You can easily backup your work or share it with team members:
1. Open the **Sidebar**.
2. Find the collection you want to export.
3. Click the **Export** icon next to the collection name.
4. It will download a structured `.json` file containing all your requests, scripts, and configurations.

### How to Import Collections
1. At the top of the sidebar, click the **Import** button.
2. Select an ExpressPost `.json` collection file from your local machine.
3. The collection and its requests will immediately populate into your local workspace.
