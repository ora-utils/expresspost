// Code snippet generation module

function getActiveHeaders(headers) {
    if (!headers || !Array.isArray(headers)) return {};
    const h = {};
    headers.forEach(header => {
        if (header.enabled && header.key.trim() !== '') {
            h[header.key.trim()] = header.value;
        }
    });
    return h;
}

function escapeQuote(str) {
    if (!str) return '';
    return str.replace(/'/g, "'\\''");
}

function escapeDoubleQuote(str) {
    if (!str) return '';
    return str.replace(/"/g, '\\"');
}

window.generateCurl = function(request) {
    let method = request.method || 'GET';
    let url = request.url || '';
    if (!url) return 'curl --request ' + method + " ''";

    let curl = `curl --request ${method} \\\n  --url '${url}'`;
    
    const headersObj = getActiveHeaders(request.headers);
    if (request.auth) {
        if (request.auth.type === 'bearer' && request.auth.bearerToken) {
            headersObj['Authorization'] = 'Bearer ' + request.auth.bearerToken;
        } else if (request.auth.type === 'basic' && request.auth.username) {
            const encoded = btoa((request.auth.username) + ':' + (request.auth.password || ''));
            headersObj['Authorization'] = 'Basic ' + encoded;
        } else if (request.auth.type === 'apikey' && request.auth.in === 'header' && request.auth.key) {
            headersObj[request.auth.key] = request.auth.value;
        }
    }

    for (const [key, value] of Object.entries(headersObj)) {
        curl += ` \\\n  --header '${key}: ${escapeQuote(value)}'`;
    }

    if (request.bodyType === 'raw' && request.body) {
        if (!headersObj['Content-Type']) {
            curl += ` \\\n  --header 'Content-Type: ${request.bodyRawType || 'application/json'}'`;
        }
        curl += ` \\\n  --data '${escapeQuote(request.body)}'`;
    } else if (request.bodyType === 'form-data' && Array.isArray(request.formData)) {
        request.formData.forEach(item => {
            if (item.enabled && item.key) {
                if (item.type === 'file' && item.fileName) {
                    curl += ` \\\n  --form '${item.key}=@"/path/to/${item.fileName}"'`;
                } else {
                    curl += ` \\\n  --form '${item.key}="${escapeQuote(item.value || '')}"'`;
                }
            }
        });
    } else if (request.bodyType === 'urlencoded' && Array.isArray(request.urlencoded)) {
        if (!headersObj['Content-Type']) {
            curl += ` \\\n  --header 'Content-Type: application/x-www-form-urlencoded'`;
        }
        request.urlencoded.forEach(item => {
            if (item.enabled && item.key) {
                curl += ` \\\n  --data-urlencode '${item.key}=${escapeQuote(item.value || '')}'`;
            }
        });
    }

    return curl;
};

window.generatePython = function(request) {
    let method = request.method || 'GET';
    let url = request.url || '';
    
    let py = `import requests\n\nurl = "${url}"\n\n`;

    const headersObj = getActiveHeaders(request.headers);
    if (request.auth) {
        if (request.auth.type === 'bearer' && request.auth.bearerToken) {
            headersObj['Authorization'] = 'Bearer ' + request.auth.bearerToken;
        } else if (request.auth.type === 'apikey' && request.auth.in === 'header' && request.auth.key) {
            headersObj[request.auth.key] = request.auth.value;
        }
    }

    if (Object.keys(headersObj).length > 0) {
        py += `headers = {\n`;
        for (const [key, value] of Object.entries(headersObj)) {
            py += `  "${key}": "${escapeDoubleQuote(value)}",\n`;
        }
        py += `}\n\n`;
    }

    let dataArg = "";
    if (request.bodyType === 'raw' && request.body) {
        py += `payload = """${request.body}"""\n\n`;
        dataArg = `data=payload`;
    } else if (request.bodyType === 'urlencoded' && Array.isArray(request.urlencoded)) {
        py += `payload = {\n`;
        request.urlencoded.forEach(item => {
            if (item.enabled && item.key) {
                py += `  "${item.key}": "${escapeDoubleQuote(item.value || '')}",\n`;
            }
        });
        py += `}\n\n`;
        dataArg = `data=payload`;
    } else if (request.bodyType === 'form-data' && Array.isArray(request.formData)) {
        py += `payload = {}\nfiles = []\n`;
        request.formData.forEach(item => {
            if (item.enabled && item.key) {
                if (item.type === 'file' && item.fileName) {
                    py += `files.append(("${item.key}", open("/path/to/${item.fileName}", "rb")))\n`;
                } else {
                    py += `payload["${item.key}"] = "${escapeDoubleQuote(item.value || '')}"\n`;
                }
            }
        });
        py += `\n`;
        dataArg = `data=payload, files=files`;
    }

    let reqLine = `response = requests.request("${method}", url`;
    if (Object.keys(headersObj).length > 0) reqLine += `, headers=headers`;
    if (dataArg) reqLine += `, ${dataArg}`;
    if (request.auth && request.auth.type === 'basic' && request.auth.username) {
        reqLine += `, auth=("${request.auth.username}", "${request.auth.password || ''}")`;
    }
    reqLine += `)\n\nprint(response.text)`;
    return py;
};

window.generateNode = function(request) {
    let method = request.method || 'GET';
    let url = request.url || '';
    
    let js = `const axios = require('axios');\n`;
    if (request.bodyType === 'form-data') {
        js += `const FormData = require('form-data');\nconst fs = require('fs');\n`;
    }
    js += `\nlet config = {\n  method: '${method.toLowerCase()}',\n  maxBodyLength: Infinity,\n  url: '${url}',\n`;

    const headersObj = getActiveHeaders(request.headers);
    if (request.auth) {
        if (request.auth.type === 'bearer' && request.auth.bearerToken) {
            headersObj['Authorization'] = 'Bearer ' + request.auth.bearerToken;
        } else if (request.auth.type === 'apikey' && request.auth.in === 'header' && request.auth.key) {
            headersObj[request.auth.key] = request.auth.value;
        }
    }

    if (request.bodyType === 'raw' && request.body) {
        js += `let data = JSON.stringify(${request.body});\n\n`;
        config += `  data : data,\n`;
        if (!headersObj['Content-Type']) headersObj['Content-Type'] = request.bodyRawType || 'application/json';
    } else if (request.bodyType === 'urlencoded' && Array.isArray(request.urlencoded)) {
        js += `const qs = require('qs');\nlet data = qs.stringify({\n`;
        request.urlencoded.forEach(item => {
            if (item.enabled && item.key) js += `  '${item.key}': '${escapeQuote(item.value || '')}', \n`;
        });
        js += `});\n\n`;
        config += `  data : data,\n`;
        headersObj['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (request.bodyType === 'form-data' && Array.isArray(request.formData)) {
        js += `let data = new FormData();\n`;
        request.formData.forEach(item => {
            if (item.enabled && item.key) {
                if (item.type === 'file' && item.fileName) {
                    js += `data.append('${item.key}', fs.createReadStream('/path/to/${item.fileName}'));\n`;
                } else {
                    js += `data.append('${item.key}', '${escapeQuote(item.value || '')}');\n`;
                }
            }
        });
        js += `\n`;
        config += `  data : data,\n`;
    }

    if (Object.keys(headersObj).length > 0) {
        config += `  headers: {\n`;
        for (const [key, value] of Object.entries(headersObj)) {
            config += `    '${key}': '${escapeQuote(value)}',\n`;
        }
        if (request.bodyType === 'form-data') config += `    ...data.getHeaders()\n`;
        config += `  },\n`;
    }

    if (request.auth && request.auth.type === 'basic' && request.auth.username) {
        config += `  auth: {\n    username: '${request.auth.username}',\n    password: '${request.auth.password || ''}'\n  },\n`;
    }

    config += `};\n\n`;
    js += config;
    js += `axios.request(config)\n.then((response) => {\n  console.log(JSON.stringify(response.data));\n})\n.catch((error) => {\n  console.log(error);\n});\n`;
    return js;
};
