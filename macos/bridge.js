#!/usr/bin/env node
// ============================================================
// obgnail/typora_plugin — Node.js Bridge Server
// 为 WKWebView 沙箱提供真实的 Node.js API
// Provides real Node.js APIs to the WKWebView sandbox.
//
// Usage: node bridge.js [--port PORT] [--token TOKEN]
// ============================================================
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const cp = require("child_process");
const zlib = require("zlib");
const crypto = require("crypto");
const { createFetchHandler } = require("./network");
const { createProcessRoutes } = require("./processes");
const processes = createProcessRoutes();

// ── Enrich PATH for launchd context (homebrew, etc.) ────────
// launchd starts with minimal PATH, so homebrew binaries are missing
(function() {
    var extraPaths = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/opt/homebrew/opt/node/bin",
    ];
    var currentPath = (process.env.PATH || "").split(":");
    var newPath = currentPath.slice();
    extraPaths.forEach(function(p) {
        if (newPath.indexOf(p) === -1) {
            try { if (fs.existsSync(p)) newPath.push(p); } catch(e) {}
        }
    });
    process.env.PATH = newPath.join(":");
})();

// ── Config ─────────────────────────────────────────────────
const PORT = Number(process.env.TYPORA_MAC_PORT);
const TOKEN = fs.readFileSync(process.env.TYPORA_MAC_TOKEN_FILE, "utf8").trim();
if (!/^[0-9a-f]{64}$/.test(TOKEN) || !Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
    throw new Error("Invalid bridge configuration");
}

function log(level, msg) {
    console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);
}

// ── Security: check token ──────────────────────────────────
function checkToken(req) {
    const provided = (req.headers["x-bridge-token"] || "").trim();
    return provided.length === TOKEN.length && Buffer.byteLength(provided) === TOKEN.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(TOKEN));
}

// ── CORS headers (localhost only, but still) ───────────────
function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "null",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Token",
        "Content-Type": "application/json",
    };
}

// ── Response helpers ───────────────────────────────────────
function ok(res, result) {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ ok: true, result }));
}

function err(res, message, code) {
    // Business errors (missing file, etc.) return 200 with ok:false
    // so the loader can read the error message from the body
    var httpCode = (code === 401 || code === 404) ? code : 200;
    res.writeHead(httpCode, corsHeaders());
    res.end(JSON.stringify({ ok: false, error: message }));
}

function parseBody(req) {
    return new Promise(function (resolve) {
        var chunks = [];
        req.on("data", function (c) { chunks.push(c); });
        req.on("end", function () {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch (e) { resolve(null); }
        });
    });
}

const panelProcesses = new Set();

// ── Router ─────────────────────────────────────────────────
var ROUTES = {
    "update.stage": function ([proxy]) {
        const env = { ...process.env };
        if (proxy) {
            const url = new URL(proxy);
            if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
                throw new Error("Invalid updater proxy");
            }
            env.https_proxy = url.href;
            env.no_proxy = "";
            delete env.NO_PROXY;
        }
        return new Promise(function (resolve, reject) {
            cp.execFile(process.env.TYPORA_MAC_PYTHON,
                ["-B", path.join(__dirname, "update.py"), process.env.TYPORA_MAC_STATE],
                { env, timeout: 180000 }, function (error, stdout, stderr) {
                    if (error) return reject(new Error(stderr.trim() || error.message));
                    try { resolve(JSON.parse(stdout)); }
                    catch (error) { reject(error); }
                });
        });
    },
    "fonts.list": function () {
        return new Promise(function (resolve, reject) {
            cp.execFile(process.env.TYPORA_MAC_FILE_PANEL, ["fonts"], { timeout: 5000 }, (error, stdout) => {
                if (error) return reject(error);
                try { resolve(JSON.parse(stdout)); }
                catch (error) { reject(error); }
            });
        });
    },
    "dialog.filePanel": function ([mode, options]) {
        if (!["open", "save", "alert", "menu"].includes(mode)) throw new Error("Unknown dialog mode");
        return new Promise(function (resolve, reject) {
            const child = cp.execFile(process.env.TYPORA_MAC_FILE_PANEL, [mode], function (error, stdout) {
                panelProcesses.delete(child);
                if (error) return reject(error);
                try {
                    const result = JSON.parse(stdout);
                    if (mode === "menu") log("DEBUG", result.canceled ? "Native plugin menu dismissed" : "Native plugin menu item selected");
                    resolve(result);
                }
                catch (error) { reject(error); }
            });
            panelProcesses.add(child);
            if (mode === "menu") log("DEBUG", "Opening native plugin menu");
            child.stdin.on("error", reject);
            child.stdin.end(JSON.stringify(options || {}));
        });
    },
    // ── fs ──
    "fs.readFile": function (params) {
        return fsp.readFile(params[0], params[1] || "base64");
    },
    "fs.readFileSync": function (params) {
        return fs.readFileSync(params[0], params[1] || "base64");
    },
    "fs.writeFile": function (params) {
        var filepath = params[0];
        var data = params[1];
        var encoding = params[2] || "utf8";
        return fsp.writeFile(filepath, data, encoding);
    },
    "fs.writeFileSync": function (params) {
        var filepath = params[0];
        var data = params[1];
        var encoding = params[2] || "utf8";
        return fs.writeFileSync(filepath, data, encoding);
    },
    "fs.access": function (params) {
        return fsp.access(params[0]);
    },
    "fs.accessSync": function ([filepath, mode]) {
        return fs.accessSync(filepath, mode);
    },
    "path.matchesGlob": function ([filepath, pattern]) {
        return path.matchesGlob(filepath, pattern);
    },
    "fs.outputJson": async function ([filepath, data, options]) {
        await fsp.mkdir(path.dirname(filepath), { recursive: true });
        await fsp.writeFile(filepath, JSON.stringify(data, null, options?.spaces) + "\n", "utf8");
    },
    "fs.existsSync": function (params) {
        return fs.existsSync(params[0]);
    },
    "fs.readdir": function (params) {
        var p = params[0];
        if (!p) return Promise.reject(new Error("ENOENT: empty path"));
        return fsp.readdir(p, params[1] || {}).then(serializeEntries);
    },
    "fs.readdirSync": function (params) {
        return serializeEntries(fs.readdirSync(params[0], params[1] || {}));
    },
    "fs.stat": function (params) {
        var p = params[0];
        if (!p) return Promise.reject(new Error("ENOENT: empty path"));
        return fsp.stat(p).then(serializeStat);
    },
    "fs.statSync": function (params) {
        var s = fs.statSync(params[0]);
        return serializeStat(s);
    },
    "fs.lstat": function (params) {
        var p = params[0];
        if (!p) return Promise.reject(new Error("ENOENT: empty path"));
        return fsp.lstat(p).then(serializeStat);
    },
    "fs.lstatSync": function (params) {
        var s = fs.lstatSync(params[0]);
        return serializeStat(s);
    },
    "fs.mkdir": function (params) {
        return fsp.mkdir(params[0], params[1] || { recursive: true });
    },
    "fs.mkdirSync": function (params) {
        return fs.mkdirSync(params[0], params[1] || { recursive: true });
    },
    "fs.ensureDirSync": function (params) {
        return fs.mkdirSync(params[0], { recursive: true });
    },
    "fs.ensureDir": function (params) {
        return fsp.mkdir(params[0], { recursive: true });
    },
    "fs.copyFile": function (params) {
        return fsp.copyFile(params[0], params[1]);
    },
    "fs.copySync": function (params) {
        var src = params[0];
        var dest = params[1];
        var stat = fs.statSync(src);
        if (stat.isDirectory()) {
            fs.mkdirSync(dest, { recursive: true });
            fs.readdirSync(src).forEach(function (f) {
                fs.cpSync(path.join(src, f), path.join(dest, f), { recursive: true });
            });
        } else {
            fs.copyFileSync(src, dest);
        }
    },
    "fs.copy": function (params) {
        // fs-extra style copy (async)
        var src = params[0];
        var dest = params[1];
        return fsp.stat(src).then(function (stat) {
            if (stat.isDirectory()) {
                return fsp.mkdir(dest, { recursive: true }).then(function () {
                    return fsp.readdir(src);
                }).then(function (files) {
                    return Promise.all(files.map(function (f) {
                        return fsp.cp(path.join(src, f), path.join(dest, f), { recursive: true });
                    }));
                });
            } else {
                return fsp.copyFile(src, dest);
            }
        });
    },
    "fs.rename": function (params) {
        return fsp.rename(params[0], params[1]);
    },
    "fs.removeSync": function (params) {
        return fs.rmSync(params[0], { recursive: true, force: true });
    },
    "fs.remove": function (params) {
        return fs.promises.rm(params[0], { recursive: true, force: true });
    },
    "fs.emptyDir": function (params) {
        return fsp.readdir(params[0]).then(function (files) {
            return Promise.all(files.map(function (f) {
                return fs.promises.rm(path.join(params[0], f), { recursive: true, force: true });
            }));
        });
    },
    "fs.emptyDirSync": function (params) {
        var dir = params[0];
        fs.readdirSync(dir).forEach(function (f) {
            fs.rmSync(path.join(dir, f), { recursive: true, force: true });
        });
    },
    "fs.chmod": function (params) {
        return fsp.chmod(params[0], params[1]);
    },
    "fs.chmodSync": function (params) {
        return fs.chmodSync(params[0], params[1]);
    },
    "fs.appendFileSync": function (params) {
        return fs.appendFileSync(params[0], params[1], params[2] || "utf8");
    },
    "fs.appendFile": function (params) {
        return fsp.appendFile(params[0], params[1], params[2] || "utf8");
    },
    "fs.readJson": function (params) {
        return fsp.readFile(params[0], "utf8").then(function (d) { return JSON.parse(d); });
    },
    "fs.readJsonSync": function (params) {
        return JSON.parse(fs.readFileSync(params[0], "utf8"));
    },
    "fs.writeJson": function (params) {
        return fsp.writeFile(params[0], JSON.stringify(params[1], null, params[2] || 2), "utf8");
    },
    "fs.writeJsonSync": function (params) {
        return fs.writeFileSync(params[0], JSON.stringify(params[1], null, params[2] || 2), "utf8");
    },

    // ── child_process ──
    "child_process.exec": function (params) {
        var cmd = params[0];
        var opts = params[1] || {};
        return new Promise(function (resolve) {
            cp.exec(cmd, opts, function (error, stdout, stderr) {
                resolve({ error: error ? { message: error.message, code: error.code } : null, stdout: stdout, stderr: stderr });
            });
        });
    },
    "child_process.execSync": function (params) {
        var cmd = params[0];
        var opts = params[1] || { encoding: "utf8" };
        try {
            return cp.execSync(cmd, opts).toString();
        } catch (e) {
            throw new Error(e.stderr ? e.stderr.toString() : e.message);
        }
    },
    ...processes.routes,

    // ── os ──
    "os.tmpdir": function () { return os.tmpdir(); },
    "os.homedir": function () { return os.homedir(); },
    "os.platform": function () { return os.platform(); },
    "os.arch": function () { return os.arch(); },
    "os.EOL": function () { return os.EOL; },
    "os.cpus": function () { return os.cpus(); },
    "os.networkInterfaces": function () { return os.networkInterfaces(); },

    // ── process ──
    "process.env": function () { return { PATH: process.env.PATH, HOME: os.homedir(), SHELL: process.env.SHELL }; },
    "process.cwd": function () { return process.cwd(); },
    "process.platform": function () { return process.platform; },
    "process.arch": function () { return process.arch; },
    "process.version": function () { return process.version; },
    "process.versions": function () { return process.versions; },

    // ── zlib ──
    "zlib.deflateRawSync": function (params) {
        var input = typeof params[0] === "string" ? Buffer.from(params[0]) : params[0];
        return zlib.deflateRawSync(input).toString("base64");
    },
    "zlib.inflateRawSync": function (params) {
        var input = Buffer.from(params[0], "base64");
        return zlib.inflateRawSync(input).toString("utf8");
    },
    "zlib.deflateSync": function (params) {
        var input = typeof params[0] === "string" ? Buffer.from(params[0]) : params[0];
        return zlib.deflateSync(input).toString("base64");
    },
    "zlib.inflateSync": function (params) {
        var input = Buffer.from(params[0], "base64");
        return zlib.inflateSync(input).toString("utf8");
    },

    // ── network fetch ──
    "fetch": createFetchHandler(globalThis.fetch, log),

    // ── crypto ──
    "crypto.randomUUID": function () { return crypto.randomUUID(); },

    // ── util ──
    "util.promisify": function () { return null; /* not needed — bridge handles it */ },

    // ── dns (for network detection) ──
    "dns.lookup": function (params) {
        var dns = require("dns");
        return new Promise(function (resolve) {
            dns.lookup(params[0], function (err, address) {
                resolve({ address: address, error: err ? err.message : null });
            });
        });
    },

    // ── net (for proxy detection / basic socket) ──
    "net.connect_check": function (params) {
        var net = require("net");
        return new Promise(function (resolve) {
            var socket = new net.Socket();
            socket.setTimeout(3000);
            socket.on("connect", function () { socket.destroy(); resolve({ ok: true }); });
            socket.on("error", function (e) { resolve({ ok: false, error: e.message }); });
            socket.on("timeout", function () { socket.destroy(); resolve({ ok: false, error: "timeout" }); });
            socket.connect(params[0], params[1]);
        });
    },

    // ── util ──
    "util.which": function (params) {
        var cmd = params[0];
        try {
            var result = cp.execFileSync("/usr/bin/which", [cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
            if (result) return result;
        } catch (e) {}
        // Fallback: check common paths
        var paths = [
            "/usr/local/bin/" + cmd,
            "/opt/homebrew/bin/" + cmd,
            "/usr/bin/" + cmd,
            "/bin/" + cmd,
        ];
        if (cmd === "rg" && ["arm64", "x64"].includes(process.arch)) {
            paths.push("/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/darwin-" + process.arch + "/rg");
        }
        for (var i = 0; i < paths.length; i++) {
            try { if (fs.existsSync(paths[i]) && fs.accessSync(paths[i], fs.constants.X_OK) === undefined) return paths[i]; } catch (e) {}
        }
        return null;
    },
    "util.whichSync": function (params) {
        return ROUTES["util.which"](params);
    },
};

// ── server managers (for http.createServer) ──
const dynamicServers = new Map();

ROUTES.health = function () {
    return {
        status: "ok",
        version: "2.0.0",
        port: PORT,
        uptime: process.uptime(),
        platform: os.platform(),
    };
};

ROUTES["http.createServer"] = function ([port]) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
    const name = crypto.randomUUID();
    const queue = [];
    const pending = new Map();
    const server = http.createServer(function (req, res) {
        if (req.method !== "POST") {
            res.writeHead(405, { Allow: "POST" }).end();
            return;
        }
        if (pending.size >= 32) {
            res.writeHead(503).end();
            return;
        }
        const id = crypto.randomUUID();
        pending.set(id, res);
        res.on("close", () => {
            pending.delete(id);
            const index = queue.findIndex(request => request.id === id);
            if (index >= 0) queue.splice(index, 1);
        });
        res.setTimeout(15000, () => {
            if (!res.headersSent) res.writeHead(504).end();
        });
        const chunks = [];
        let length = 0;
        req.on("data", chunk => {
            length += chunk.length;
            if (length > 1024 * 1024) {
                res.writeHead(413).end();
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("error", () => res.destroy());
        req.on("end", () => {
            if (res.writableEnded || res.destroyed) return;
            queue.push({
                id, method: req.method, url: req.url, headers: req.headers,
                body: Buffer.concat(chunks).toString("base64"),
                remoteAddress: req.socket.remoteAddress,
            });
        });
    });
    return new Promise(function (resolve, reject) {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", function () {
            server.removeListener("error", reject);
            server.on("error", error => log("ERROR", error.message));
            dynamicServers.set(name, { server, queue, pending });
            resolve({ name, port: server.address().port });
        });
    });
};

ROUTES["http.getRequests"] = function ([name]) {
    const entry = dynamicServers.get(name);
    if (!entry) throw new Error("RPC server is closed");
    return entry.queue.splice(0);
};

ROUTES["http.sendResponse"] = function ([name, id, statusCode, headers, body]) {
    const res = dynamicServers.get(name)?.pending.get(id);
    if (!res || res.writableEnded || res.destroyed) return;
    res.writeHead(statusCode, headers);
    res.end(body);
};

function closeDynamicServer(name) {
    const entry = dynamicServers.get(name);
    if (!entry) return;
    dynamicServers.delete(name);
    for (const response of entry.pending.values()) {
        if (!response.writableEnded) response.writeHead(503).end();
    }
    return new Promise((resolve, reject) => {
        entry.server.close(error => error ? reject(error) : resolve());
        entry.server.closeAllConnections();
    });
}

ROUTES["http.closeServer"] = function ([name]) {
    return closeDynamicServer(name);
};

// ── Shell helpers ──
ROUTES["shell.openExternal"] = function (params) {
    var url = params[0];
    cp.exec("open '" + url.replace(/'/g, "'\\''") + "'", function () {});
    return undefined;
};

ROUTES["shell.openPath"] = function (params) {
    var filepath = params[0];
    cp.exec("open -R '" + filepath.replace(/'/g, "'\\''") + "'", function () {});
    return undefined;
};

ROUTES["debug.log"] = function (params) {
    var msg = params[0] || "";
    log("DEBUG", msg);
    return { ok: true };
};

// ── Stats serializer (Stat objects don't JSON-serialize) ──
function serializeEntries(entries) {
    return entries.map(function (entry) {
        if (!(entry instanceof fs.Dirent)) return entry;
        return {
            name: entry.name,
            parentPath: entry.parentPath,
            ...serializeStat(entry),
        };
    });
}

function serializeStat(st) {
    if (!st) return null;
    // JSON can't transfer functions, so we return boolean properties.
    // The loader wraps them into methods on the client side.
    return {
        dev: st.dev, ino: st.ino, mode: st.mode, nlink: st.nlink,
        uid: st.uid, gid: st.gid, rdev: st.rdev, size: st.size,
        blksize: st.blksize, blocks: st.blocks,
        atimeMs: st.atimeMs, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs,
        birthtimeMs: st.birthtimeMs,
        _isFile: st.isFile(),
        _isDirectory: st.isDirectory(),
        _isBlockDevice: st.isBlockDevice(),
        _isCharacterDevice: st.isCharacterDevice(),
        _isSymbolicLink: st.isSymbolicLink(),
        _isFIFO: st.isFIFO(),
        _isSocket: st.isSocket(),
    };
}

// ── Server ─────────────────────────────────────────────────
var server = http.createServer(function (req, res) {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders());
        return res.end();
    }

    // Health check — GET, no auth required
    if (req.method === "GET" && req.url === "/health") {
        return ok(res, ROUTES["health"]());
    }

    // Health check alias
    if (req.method === "GET" && req.url === "/") {
        return ok(res, { message: "Typora Plugin Bridge v2.0.0", health: "/health", api: "POST /api" });
    }

    // API endpoint
    if (req.method === "POST" && req.url === "/api") {
        if (!checkToken(req)) {
            return err(res, "Unauthorized: invalid or missing X-Bridge-Token", 401);
        }
        return parseBody(req).then(function (body) {
            if (!body || !body.method) {
                return err(res, "Missing 'method' in request body", 400);
            }
            var handler = ROUTES[body.method];
            if (!Object.hasOwn(ROUTES, body.method) || typeof handler !== "function") {
                return err(res, "Unknown method: " + body.method, 404);
            }
            try {
                var result = handler(body.params || []);
                if (result && typeof result.then === "function") {
                    return result.then(
                        function (r) { ok(res, r); },
                        function (e) { err(res, e.message || String(e)); }
                    );
                } else {
                    return ok(res, result);
                }
            } catch (e) {
                return err(res, e.message || String(e));
            }
        }).catch(function (e) {
            return err(res, "Internal error: " + (e.message || String(e)));
        });
    }

    // Unknown
    res.writeHead(404, corsHeaders());
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", function () {
    log("INFO", "Typora Plugin Bridge started on 127.0.0.1:" + PORT);
    console.log("Typora Plugin Bridge v2.0.0");
    console.log("Listening on 127.0.0.1:" + PORT);
});

// Graceful shutdown
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
    log("INFO", "Shutting down...");
    for (const child of panelProcesses) child.kill();
    processes.shutdown();
    for (const name of dynamicServers.keys()) {
        closeDynamicServer(name).catch(error => log("ERROR", error.message));
    }
    server.close(function () {
        process.exit(0);
    });
    setTimeout(function () { process.exit(0); }, 2000);
}
