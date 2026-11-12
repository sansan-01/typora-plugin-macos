// ============================================================
// obgnail/typora_plugin macOS 适配器 / Adapter v2
// 通过 <script defer> 注入 index.html
// Requires: Node.js bridge (bridge.js) on localhost:45678
// Provides: reqnode (CommonJS), path, fs, os, process, Buffer
// ============================================================
(function() {
    "use strict";

    var BASE = %%RESOURCE_PATH%%;
    var PLUGIN = BASE + "plugin/";
    var _modCache = {};

    // ════════════════════════════════════════════════════════
    // Bridge — localhost Node.js backend
    // Token is embedded by install.sh at install time
    // ════════════════════════════════════════════════════════
    var BRIDGE = "http://127.0.0.1:%%BRIDGE_PORT%%";
    var _token = "%%BRIDGE_TOKEN%%";
    var _ready = _token && _token.indexOf("%%") < 0;
    // Keep the browser fetch for localhost bridge RPC. External plugin
    // resources are routed through Node so file:// WKWebView pages avoid CORS.
    var _nativeFetch = window.fetch && window.fetch.bind(window);


    function call(method, params) {
        if (!_ready || !_token) throw new Error("Bridge not available — start bridge.js first");
        var x = new XMLHttpRequest();
        x.open("POST", BRIDGE + "/api", false);
        x.setRequestHeader("Content-Type", "application/json");
        x.setRequestHeader("X-Bridge-Token", _token);
        try { x.send(JSON.stringify({ method: method, params: params || [] })); }
        catch(e) { throw new Error("Bridge connection failed: " + (e.message || "unknown")); }
        // WKWebView may return status 0 for cross-origin from file://
        if (x.status !== 200 && x.status !== 0) {
            var errBody = {};
            try { errBody = JSON.parse(x.responseText || "{}"); } catch(e2) {}
            throw new Error(errBody.error || ("Bridge HTTP " + x.status));
        }
        var r = JSON.parse(x.responseText || x.response || "{}");
        if (!r.ok) throw new Error(r.error || "Bridge error");
        return r.result;
    }

    function callAsync(method, params) {
        if (!_ready || !_token) return Promise.reject(new Error("Bridge not available"));
        return _nativeFetch(BRIDGE + "/api", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Bridge-Token": _token },
            body: JSON.stringify({ method: method, params: params || [] })
        }).then(function(r) {
            if (!r.ok) throw new Error("Bridge HTTP " + r.status);
            return r.json();
        }).then(function(r) {
            if (!r.ok) throw new Error(r.error || "Bridge error");
            return r.result;
        });
    }

    // Network adapter used by the bundled plugin utilities. It deliberately
    // exposes the small Fetch Response surface PlantUML needs while Node.js
    // performs the actual request in the bridge process.
    function _bridgeFetch(url, options) {
        options = options || {};
        var body = options.body;
        if (body && typeof body !== "string") {
            if (body._chunks) body = body._chunks.map(function(c) { return c && c.toString ? c.toString("utf8") : String(c); }).join("");
            else body = String(body);
        }
        var safeOptions = { method: options.method || "GET", headers: options.headers || {}, body: body || undefined, redirect: options.redirect };
        return callAsync("fetch", [{ url: url, options: safeOptions, timeout: options.timeout || 0 }]).then(function(result) {
            var binary = atob(result.body || ""), bytes = new Uint8Array(binary.length), i;
            for (i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            var responseHeaders = {
                get: function(name) { return result.headers[String(name).toLowerCase()] || null; }
            };
            return {
                ok: result.ok, status: result.status, statusText: result.statusText,
                url: url,
                headers: responseHeaders,
                arrayBuffer: function() { return Promise.resolve(bytes.buffer); },
                text: function() { return Promise.resolve(_decodeText(bytes)); },
                json: function() { return this.text().then(function(text) { return JSON.parse(text); }); },
                clone: function() { return this; },
            };
        });
    }

    // WKWebView gives flex children an intrinsic SVG height, which can push
    // the Markmap drawing below the visible panel. Constrain the drawing to
    // the panel's actual box while preserving the upstream layout.
    var _markmapStyle = document.createElement("style");
    _markmapStyle.textContent = "#plugin-markmap{box-sizing:border-box;overflow:hidden;}#plugin-markmap-svg{display:block;min-width:0;min-height:0;width:100%;height:100%;overflow:hidden;}#plugin-markmap .plugin-markmap-header{flex:0 0 auto;}#write .md-diagram-panel{box-sizing:border-box;max-width:100%;width:100%;overflow-x:hidden;}#write .md-diagram-panel svg,#write .md-diagram-panel canvas{box-sizing:border-box;max-width:100%!important;width:100%;height:auto;}";
    (document.head || document.documentElement).appendChild(_markmapStyle);

    // ════════════════════════════════════════════════════════
    // path polyfill (pure JS, always works)
    // ════════════════════════════════════════════════════════
    var _path = {
        join: function() {
            var p = [], a = arguments;
            for (var i = 0; i < a.length; i++) {
                var s = String(a[i]); if (!s) continue;
                if (s[0] === "/") { p = s.split("/").filter(function(x) { return x; }); }
                else {
                    var segs = s.split("/");
                    for (var si = 0; si < segs.length; si++) {
                        var seg = segs[si];
                        if (!seg || seg === ".") continue;
                        if (seg === "..") { if (p.length > 0) p.pop(); }
                        else p.push(seg);
                    }
                }
            }
            var result = p.join("/");
            var first = a[0] ? String(a[0]) : "";
            return (first[0] === "/" ? "/" : "") + result || ".";
        },
        dirname: function(x) {
            var isAbs = x[0] === "/";
            var parts = x.split("/"), out = [];
            for (var pi = 0; pi < parts.length; pi++) {
                if (parts[pi] === "." || parts[pi] === "") continue;
                if (parts[pi] === "..") { out.pop(); continue; }
                out.push(parts[pi]);
            }
            var clean = (isAbs ? "/" : "") + out.join("/");
            var idx = clean.lastIndexOf("/");
            return idx >= 0 ? (clean.substring(0, idx) || "/") : ".";
        },
        basename: function(x, e) { var b = x.split("/").pop(); return e && b.endsWith(e) ? b.slice(0,-e.length) : b; },
        extname: function(x) { var b = x.split("/").pop(), i = b.lastIndexOf("."); return i > 0 ? b.substring(i) : ""; },
        resolve: function() {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
                var seg = String(arguments[i]); if (!seg) continue;
                if (seg[0] === "/") parts = seg.split("/").filter(function(x) { return x; });
                else seg.split("/").forEach(function(p) {
                    if (!p || p === ".") return;
                    if (p === "..") { if (parts.length > 0) parts.pop(); }
                    else parts.push(p);
                });
            }
            return "/" + parts.join("/");
        },
        normalize: function(x) {
            var isAbs = x[0] === "/";
            var parts = x.split("/"), out = [];
            for (var i = 0; i < parts.length; i++) {
                if (!parts[i] || parts[i] === ".") continue;
                if (parts[i] === "..") { if (out.length > 0) out.pop(); continue; }
                out.push(parts[i]);
            }
            return (isAbs ? "/" : "") + out.join("/") || ".";
        },
        relative: function(from, to) {
            var fa = from.split("/").filter(function(x) { return x; });
            var ta = to.split("/").filter(function(x) { return x; });
            var i = 0;
            while (i < fa.length && i < ta.length && fa[i] === ta[i]) i++;
            var up = fa.length - i, rel = [];
            for (var j = 0; j < up; j++) rel.push("..");
            for (var j = i; j < ta.length; j++) rel.push(ta[j]);
            return rel.join("/") || ".";
        },
        isAbsolute: function(x) { return x && x[0] === "/"; },
        parse: function(x) {
            var parts = x.split("/"), file = parts.pop() || "";
            var ext = "", base = file;
            var di = file.lastIndexOf(".");
            if (di > 0) { ext = file.substring(di); base = file.substring(0, di); }
            return { root: x[0] === "/" ? "/" : "", dir: parts.join("/") || (x[0] === "/" ? "/" : ""), base: file, name: base, ext: ext };
        },
        format: function(obj) {
            var dir = obj.dir || obj.root || "";
            var base = obj.name || "";
            if (obj.ext && !base.endsWith(obj.ext)) base += obj.ext;
            if (obj.base) base = obj.base;
            return dir ? dir.replace(/\/$/, "") + "/" + base : base;
        },
        delimiter: "/",
        sep: "/"
    };

    // ════════════════════════════════════════════════════════
    // XHR: read plugin bundle files from app bundle
    // This is ALWAYS needed for module loading, regardless of bridge.
    // ════════════════════════════════════════════════════════
    function _readBundle(fp) {
        var rel = fp.indexOf(BASE) === 0 ? fp.substring(BASE.length) : fp;
        var parts = rel.split("/"), out = [];
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === "." || parts[i] === "") continue;
            if (parts[i] === "..") { out.pop(); continue; }
            out.push(parts[i]);
        }
        var cleanRel = "./" + out.join("/");
        var x = new XMLHttpRequest();
        x.open("GET", cleanRel, false);
        try { x.send(); } catch(e) { throw new Error("XHR: " + cleanRel + " - " + e.message); }
        if (x.status !== 0 && x.status !== 200) throw new Error("XHR status " + x.status + ": " + cleanRel);
        var text = x.responseText || "";
        if (/^\s*<!doctype/i.test(text) || /^\s*<html/i.test(text)) throw new Error("Got HTML for: " + cleanRel);
        return text;
    }


            // Run the upstream Markdownlint worker protocol inside the editor.
    // WKWebView does not give file-based workers access to the plugin modules.
    var NativeWorker = window.Worker;
    window.Worker = function(scriptURL, options) {
        if (scriptURL === "plugin/markdownlint/worker.js") {
            return createMarkdownlintWorker();
        }
        return new NativeWorker(scriptURL, options);
    };
    window.Worker.prototype = NativeWorker.prototype;

    function createMarkdownlintWorker() {
        var closed = false;
        var scope = { close: function() { closed = true; } };
        var worker = {
            onmessage: null,
            onerror: null,
            postMessage: function(data) {
                setTimeout(function() {
                    if (closed) return;
                    Promise.resolve().then(function() {
                        return scope.onmessage({ data: data });
                    }).catch(function(error) {
                        if (!closed && worker.onerror) worker.onerror({ message: error.message });
                    });
                }, 0);
            },
            terminate: scope.close
        };
        var dispatch = function(data) {
            if (!closed && worker.onmessage) worker.onmessage({ data: data });
        };
        var source = _readBundle(PLUGIN + "markdownlint/worker.js");
        new Function("self", "postMessage", "require", source)(scope, dispatch, window.reqnode);
        return worker;
    }

    function _isPluginPath(fp) {
        return fp.indexOf(BASE) === 0 || fp.indexOf("/plugin/") >= 0;
    }

    // ════════════════════════════════════════════════════════
    // fs — bridge for real I/O, XHR for plugin bundle files
    // ════════════════════════════════════════════════════════
    // Wrap stat objects from bridge: convert _isFile/_isDirectory booleans to methods
    function _wrapStat(st) {
        if (!st) return st;
        if (st && st._isFile !== undefined) {
            st.isFile = function() { return st._isFile; };
            st.isDirectory = function() { return st._isDirectory; };
            st.isBlockDevice = function() { return st._isBlockDevice; };
            st.isCharacterDevice = function() { return st._isCharacterDevice; };
            st.isSymbolicLink = function() { return st._isSymbolicLink; };
            st.isFIFO = function() { return st._isFIFO; };
            st.isSocket = function() { return st._isSocket; };
        }
        return st;
    }

    function fileEncoding(options) {
        return typeof options === "string" ? options : options && options.encoding;
    }

    function decodeFile(data, encoding) {
        return encoding ? data : window.Buffer.from(data, "base64");
    }

    function fileWriteParams(filepath, data, options) {
        if (window.Buffer.isBuffer(data) || ArrayBuffer.isView(data)) {
            return [filepath, window.Buffer.from(data).toString("base64"), "base64"];
        }
        return [filepath, data, fileEncoding(options) || "utf8"];
    }

    var _fs = {
        promises: {},

        readFileSync: function(fp, opts) {
            var encoding = fileEncoding(opts);
            return decodeFile(call("fs.readFileSync", [fp, encoding]), encoding);
        },
        readFile: function(fp, opts) {
            var encoding = fileEncoding(opts);
            return callAsync("fs.readFile", [fp, encoding]).then(function(data) {
                return decodeFile(data, encoding);
            });
        },

        writeFileSync: function(fp, data, opts) {
            call("fs.writeFileSync", fileWriteParams(fp, data, opts));
        },
        writeFile: function(fp, data, opts) {
            return callAsync("fs.writeFile", fileWriteParams(fp, data, opts));
        },

        readJson: function(fp) {
            return callAsync("fs.readJson", [fp]).catch(function(e) {
                if (_isPluginPath(fp)) {
                    try { return JSON.parse(_readBundle(fp)); } catch(e2) { throw e; }
                }
                throw e;
            });
        },
        readJsonSync: function(fp) {
            try { return call("fs.readJsonSync", [fp]); }
            catch(e) {
                if (_isPluginPath(fp)) return JSON.parse(_readBundle(fp));
                throw e;
            }
        },

        writeJson: function(fp, data, spaces) {
            return callAsync("fs.writeJson", [fp, data, spaces || 2]);
        },
        writeJsonSync: function(fp, data, spaces) {
            call("fs.writeJsonSync", [fp, data, spaces || 2]);
        },
        outputJson: function(fp, data, options) {
            return callAsync("fs.outputJson", [fp, data, options]);
        },

        appendFileSync: function(fp, data, opts) {
            call("fs.appendFileSync", [fp, data, (opts && opts.encoding) || "utf8"]);
        },
        appendFile: function(fp, data, opts) {
            return callAsync("fs.appendFile", [fp, data, (opts && opts.encoding) || "utf8"]);
        },

        existsSync: function(fp) {
            try { return call("fs.existsSync", [fp]); }
            catch(e) {
                if (_isPluginPath(fp)) {
                    try { _readBundle(fp); return true; } catch(e2) { return false; }
                }
                return false;
            }
        },
        access: function(fp) {
            return callAsync("fs.access", [fp]).catch(function(e) {
                if (_isPluginPath(fp)) {
                    try { _readBundle(fp); return; } catch(e2) { throw e; }
                }
                throw e;
            });
        },
        accessSync: function(fp, mode) {
            call("fs.accessSync", [fp, mode == null ? 0 : mode]);
        },

        statSync: function(fp) {
            return _wrapStat(call("fs.statSync", [fp]));
        },
        stat: function(fp) {
            return callAsync("fs.stat", [fp]).then(_wrapStat);
        },
        lstatSync: function(fp) {
            return _wrapStat(call("fs.lstatSync", [fp]));
        },
        lstat: function(fp) {
            return callAsync("fs.lstat", [fp]).then(_wrapStat);
        },

        mkdirSync: function(p, opts) {
            call("fs.mkdirSync", [p, opts || { recursive: true }]);
        },
        ensureDirSync: function(p) {
            call("fs.ensureDirSync", [p]);
        },
        ensureDir: function(p) {
            return callAsync("fs.ensureDir", [p]);
        },
        readdirSync: function(p, opts) {
            return call("fs.readdirSync", [p, opts || {}]).map(_wrapStat);
        },
        readdir: function(p, opts) {
            return callAsync("fs.readdir", [p, opts || {}]).then(function(entries) { return entries.map(_wrapStat); });
        },

        copySync: function(src, dest) {
            call("fs.copySync", [src, dest]);
        },
        copy: function(src, dest) {
            return callAsync("fs.copy", [src, dest]);
        },
        renameSync: function(src, dest) {
            call("fs.rename", [src, dest]);
        },
        rename: function(src, dest) {
            return callAsync("fs.rename", [src, dest]);
        },
        removeSync: function(p) {
            call("fs.removeSync", [p]);
        },
        remove: function(p) {
            return callAsync("fs.remove", [p]);
        },
        emptyDirSync: function(p) {
            call("fs.emptyDirSync", [p]);
        },
        emptyDir: function(p) {
            return callAsync("fs.emptyDir", [p]);
        },

        chmodSync: function(p, mode) {
            call("fs.chmodSync", [p, mode]);
        },
        chmod: function(p, mode) {
            return callAsync("fs.chmod", [p, mode]);
        },

        createReadStream: function() { return { on: function(){}, pipe: function(){} }; },
        createWriteStream: function() { return { on: function(){}, end: function(){}, write: function(){} }; },
    };

    _fs.promises = {
        readFile: function(fp, opts) { return _fs.readFile(fp, opts); },
        writeFile: function(fp, data, opts) { return _fs.writeFile(fp, data, opts); },
        access: function(fp) { return _fs.access(fp); },
        stat: function(fp) { return _fs.stat(fp); },
        lstat: function(fp) { return _fs.lstat(fp); },
        readdir: function(p, opts) { return _fs.readdir(p, opts); },
        mkdir: function(p, opts) { return _fs.ensureDir(p); },
        copyFile: function(src, dest) { return _fs.copy(src, dest); },
        rename: function(src, dest) { return _fs.rename(src, dest); },
        rm: function(p, opts) { return _fs.remove(p); },
        chmod: function(p, mode) { return _fs.chmod(p, mode); },
        appendFile: function(fp, data, opts) { return _fs.appendFile(fp, data, opts); },
    };

    // ════════════════════════════════════════════════════════
    // Node.js globals on window
    // ════════════════════════════════════════════════════════
    window.process = {
        env: {},  // populated from bridge at init
        cwd: function() { return _ready ? call("process.cwd", []) : "/"; },
        argv: ["typora"], platform: "darwin",
        version: "v18.0.0", versions: { node: "18.0.0" },
        stderr: { write: function(){} }, stdout: { write: function(){} },
        stdin: { on: function(){}, read: function(){} },
        exit: function() {}, nextTick: function(f) { setTimeout(f, 0); },
        on: function() {}
    };
    // A small browser-side Buffer compatibility layer.  PlantUML only needs
    // `from`, `concat`, `length`, and `toString`; keeping those semantics here
    // is safer than pretending every Buffer is a plain string.
    var _encodeText = typeof TextEncoder !== "undefined"
        ? function(text) { return new TextEncoder().encode(text); }
        : function(text) { var out = [], i; for (i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 255); return new Uint8Array(out); };
    var _decodeText = typeof TextDecoder !== "undefined"
        ? function(bytes) { return new TextDecoder().decode(bytes); }
        : function(bytes) { var out = "", i; for (i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]); return out; };
    function MacBuffer(value, encoding) {
        if (value instanceof MacBuffer) return value;
        if (typeof value === "string") {
            this._bytes = encoding === "base64"
                ? Uint8Array.from(atob(value), function(c) { return c.charCodeAt(0); })
                : _encodeText(value);
            this._text = encoding === "base64" ? _decodeText(this._bytes) : value;
        } else if (value instanceof ArrayBuffer) {
            this._bytes = new Uint8Array(value);
            this._text = _decodeText(this._bytes);
        } else if (value && value.buffer instanceof ArrayBuffer) {
            this._bytes = new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
            this._text = _decodeText(this._bytes);
        } else if (Array.isArray(value)) {
            this._bytes = new Uint8Array(value);
            this._text = _decodeText(this._bytes);
        } else {
            this._text = value == null ? "" : String(value);
            this._bytes = _encodeText(this._text);
        }
        this.length = this._bytes.length;
    }
    MacBuffer.prototype.subarray = function(start, end) {
        return new MacBuffer(this._bytes.subarray(start, end));
    };
    MacBuffer.prototype.toString = function(encoding, start, end) {
        var bytes = this._bytes.subarray(start, end);
        if (encoding === "base64") {
            var binary = "";
            for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        }
        return encoding === "hex"
            ? Array.prototype.map.call(bytes, function(b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("")
            : _decodeText(bytes);
    };
    MacBuffer.prototype.valueOf = function() { return this._text; };
    window.Buffer = {
        from: function(value, enc) { return new MacBuffer(value, enc); },
        alloc: function(n) { return new MacBuffer(new Uint8Array(n)); },
        concat: function(arrs) {
            var bytes = [], i, j;
            for (i = 0; i < arrs.length; i++) for (j = 0; j < arrs[i].length; j++) bytes.push(arrs[i]._bytes ? arrs[i]._bytes[j] : arrs[i][j]);
            return new MacBuffer(bytes);
        },
        isBuffer: function(value) { return value instanceof MacBuffer; },
        byteLength: function(value) { return new MacBuffer(value).length;
        }
    };
    window.setImmediate = function(f) { setTimeout(f, 0); };
    window.clearImmediate = function() {};
    window.global = window;

    // ════════════════════════════════════════════════════════
    // reqnode — module loader (bridge-backed)
    // ════════════════════════════════════════════════════════
    window.reqnode = function(id) {
        if (id === "fs-plus/node_modules/minimatch") {
            return {
                Minimatch: class {
                    constructor(pattern) { this.pattern = pattern; }
                    match(filepath) { return call("path.matchesGlob", [filepath, this.pattern]); }
                }
            };
        }
        // Replace the heavyweight bundled node-fetch transport with one RPC
        // call. The plugin API and Response shape remain unchanged.
        if (String(id).indexOf("node-fetch-commonjs") >= 0) return _bridgeFetch;
        if (id === "path") return _path;
        if (id === "fs" || id === "fs-extra") return _fs;

        // ── os ──
        if (id === "os") {
            return {
                homedir: function() { return call("os.homedir", []); },
                platform: function() { return call("os.platform", []); },
                arch: function() { return call("os.arch", []); },
                tmpdir: function() { return call("os.tmpdir", []); },
                cpus: function() { try { return call("os.cpus", []); } catch(e) { return []; } },
                networkInterfaces: function() { try { return call("os.networkInterfaces", []); } catch(e) { return {}; } },
                EOL: "\n"
            };
        }

        // ── child_process ──
        if (id === "child_process") {
            return {
                execSync: function(cmd, opts) {
                    return call("child_process.execSync", [cmd, opts || {}]);
                },
                exec: function(cmd, opts, cb) {
                    if (typeof opts === "function") { cb = opts; opts = {}; }
                    callAsync("child_process.exec", [cmd, opts || {}])
                        .then(function(r) { if (cb) cb(r.error, r.stdout, r.stderr); })
                        .catch(function(e) { if (cb) cb(e, "", e.message); });
                },
                spawn: function(cmd, args, opts) {
                    // Commander supplies its script before returning to the event loop.
                    // Ripgrep uses ignored stdin. Both consume UTF-8 output.
                    var input = "", inputEnded = false, id, closed = false;
                    var listeners = Object.create(null);
                    function emit(event) {
                        var values = Array.prototype.slice.call(arguments, 1);
                        (listeners[event] || []).forEach(function(fn) { fn.apply(null, values); });
                    }
                    function stream(name) {
                        return {
                            on: function(event, fn) { child.on(name + "_" + event, fn); return this; },
                            setEncoding: function() { return this; }
                        };
                    }
                    function finish(code, signal, error) {
                        if (closed) return;
                        closed = true;
                        if (error) emit("error", error);
                        emit("close", code, signal);
                    }
                    function cancel() {
                        if (id) callAsync("child_process.kill", [id]).catch(function() {});
                    }
                    function poll() {
                        callAsync("child_process.poll", [id]).then(function(result) {
                            result.output.forEach(function(entry) { emit(entry[0] + "_data", entry[1]); });
                            if (result.closed) finish(result.code, result.signal, result.error && new Error(result.error));
                            else setTimeout(poll, 60);
                        }).catch(function(error) { finish(-1, null, error); });
                    }
                    var child = {
                        killed: false,
                        on: function(event, fn) {
                            (listeners[event] || (listeners[event] = [])).push(fn);
                            return this;
                        },
                        kill: function() {
                            if (closed || this.killed) return false;
                            this.killed = true;
                            cancel();
                            return true;
                        },
                        stdin: {
                            write: function(data) { if (!inputEnded) input += String(data); },
                            end: function(data) {
                                if (data != null) this.write(data);
                                inputEnded = true;
                            }
                        },
                        stdout: stream("stdout"),
                        stderr: stream("stderr")
                    };
                    Promise.resolve().then(function() {
                        if (child.killed) return finish(null, "SIGTERM");
                        inputEnded = true;
                        return callAsync("child_process.start", [cmd, args || [], opts || {}, input])
                            .then(function(jobId) {
                                id = jobId;
                                if (child.killed) cancel();
                                poll();
                            });
                    }).catch(function(error) { finish(-1, null, error); });
                    return child;
                },
            };
        }

        // ── crypto ──
        if (id === "crypto") {
            return {
                randomUUID: function() { return call("crypto.randomUUID", []); },
                randomBytes: function(size) {
                    return Buffer.from(window.crypto.getRandomValues(new Uint8Array(size)));
                }
            };
        }

        // ── util ──
        if (id === "util") {
            return {
                promisify: function(fn) {
                    return function() {
                        var a = arguments, s = this;
                        return new Promise(function(res, rej) {
                            fn.apply(s, Array.prototype.slice.call(a).concat(function(err, r) {
                                if (err) rej(err); else res(r);
                            }));
                        });
                    };
                },
                isDeepStrictEqual: function(a, b) {
                    if (a === b) return true;
                    if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
                    var ka = Object.keys(a), kb = Object.keys(b);
                    if (ka.length !== kb.length) return false;
                    for (var i = 0; i < ka.length; i++) {
                        if (!this.isDeepStrictEqual(a[ka[i]], b[ka[i]])) return false;
                    }
                    return true;
                },
                inspect: function(obj) { return JSON.stringify(obj); },
                inherits: function(ctor, superCtor) {
                    ctor.super_ = superCtor;
                    ctor.prototype = Object.create(superCtor.prototype, { constructor: { value: ctor, enumerable: false, writable: true, configurable: true } });
                },
                types: { isPromise: function(v) { return v && typeof v.then === "function"; } },
                debuglog: function() { return function() {}; },
                format: function() { return Array.prototype.join.call(arguments, " "); },
                deprecate: function(fn) { return fn; },
            };
        }

        // ── zlib ──
        if (id === "zlib") {
            return {
                deflateRawSync: function(input) {
                    var b64 = call("zlib.deflateRawSync", [String(input)]);
                    return { toString: function() { return b64; } };
                },
                inflateRawSync: function(input) {
                    var str = call("zlib.inflateRawSync", [String(input)]);
                    return { toString: function() { return str; } };
                },
                deflateSync: function(input) {
                    var b64 = call("zlib.deflateSync", [String(input)]);
                    return { toString: function() { return b64; } };
                },
                inflateSync: function(input) {
                    var str = call("zlib.inflateSync", [String(input)]);
                    return { toString: function() { return str; } };
                },
            };
        }

        // ── electron (shell stubs via bridge) ──
        if (id === "electron") {
            return {
                shell: {
                    openExternal: function(url) { callAsync("shell.openExternal", [url]).catch(function() {}); },
                    openPath: function(p) { callAsync("shell.openPath", [p]).catch(function() {}); },
                    showItemInFolder: function(p) { callAsync("shell.openPath", [p]).catch(function() {}); },
                    beep: function() {},
                },
                ipcRenderer: { on: function() {}, send: function() {}, invoke: function() { return Promise.resolve({}); }, once: function() {}, removeListener: function() {} },
                remote: { dialog: { showOpenDialog: function() { return Promise.resolve({ canceled: true }); }, showSaveDialog: function() { return Promise.resolve({ canceled: true }); } }, BrowserWindow: { getAllWindows: function() { return []; }, fromId: function() { return null; } } },
                app: { getPath: function() { return "/tmp"; }, getVersion: function() { return "1.0.0"; }, getName: function() { return "Typora"; } },
                clipboard: { readText: function() { return ""; }, writeText: function() {} },
                nativeImage: { createFromPath: function() { return {}; } },
                Menu: { buildFromTemplate: function() { return {}; }, setApplicationMenu: function() {} },
                crashReporter: { start: function() {} },
            };
        }

        // ── http/https ──
        // The bundled node-fetch expects Node's ClientRequest interface. The
        // old no-op stub made every utils.fetch() silently fail, including
        // PlantUML. Adapt that small interface to WKWebView XMLHttpRequest.
        if (id === "http" || id === "https") {
            function browserRequest(input, options, callback) {
                options = options || {};
                var listeners = {}, requestHeaders = {}, chunks = [], ended = false;
                var target = typeof input === "string" ? input : (input && input.href) || options.href || "";
                var method = options.method || "GET";
                function emit(event) {
                    var args = Array.prototype.slice.call(arguments, 1);
                    (listeners[event] || []).slice().forEach(function(fn) { fn.apply(null, args); });
                }
                var req = {
                    on: function(event, fn) { (listeners[event] || (listeners[event] = [])).push(fn); return this; },
                    once: function(event, fn) { return this.on(event, fn); },
                    setHeader: function(name, value) { requestHeaders[name] = value; },
                    removeHeader: function(name) { delete requestHeaders[name]; },
                    write: function(chunk) { chunks.push(chunk); return true; },
                    end: function(chunk) {
                        if (ended) return this;
                        ended = true; if (chunk != null) chunks.push(chunk);
                        var xhr = new XMLHttpRequest();
                        xhr.open(method, target, true);
                        Object.keys(requestHeaders).forEach(function(name) { try { xhr.setRequestHeader(name, requestHeaders[name]); } catch (_) {} });
                        xhr.responseType = "arraybuffer";
                        xhr.onload = function() {
                            var bytes = xhr.response || new ArrayBuffer(0);
                            var responseListeners = {};
                            var response = {
                                statusCode: xhr.status,
                                headers: { get: function(name) { return xhr.getResponseHeader(name); } },
                                on: function(event, fn) { (responseListeners[event] || (responseListeners[event] = [])).push(fn); return this; },
                                once: function(event, fn) { return this.on(event, fn); },
                                resume: function() { return this; },
                            };
                            if (callback) callback(response);
                            var chunk = window.Buffer.from(bytes);
                            (responseListeners.data || []).forEach(function(fn) { fn(chunk); });
                            (responseListeners.end || []).forEach(function(fn) { fn(); });
                        };
                        xhr.onerror = function() { emit("error", new Error("Network request failed: " + target)); };
                        xhr.ontimeout = function() { emit("error", new Error("Network request timed out: " + target)); };
                        var body = chunks.map(function(c) { return c && c.toString ? c.toString("utf8") : String(c); }).join("");
                        xhr.send(body || null);
                        return this;
                    },
                    abort: function() { emit("error", new Error("Request aborted")); },
                };
                return req;
            }
            return {
                request: browserRequest,
                get: function(input, options, callback) {
                    if (typeof options === "function") { callback = options; options = {}; }
                    options = options || {}; options.method = "GET";
                    var req = browserRequest(input, options, callback); req.end(); return req;
                },
                createServer: function(handler) {
                    var name, timer;
                    var server = {
                        listening: false,
                        listen: function(port, host, callback) {
                            if (host !== "127.0.0.1") {
                                callback(new Error("Only the loopback address is supported"));
                                return;
                            }
                            callAsync("http.createServer", [port]).then(function(info) {
                                name = info.name;
                                server.listening = true;
                                timer = setInterval(poll, 120);
                                callback();
                            }, callback);
                        },
                        close: function(callback) {
                            clearInterval(timer);
                            server.listening = false;
                            if (!name) return callback && callback();
                            callAsync("http.closeServer", [name]).then(
                                function() { if (callback) callback(); },
                                function(error) { if (callback) callback(error); }
                            );
                        }
                    };
                    var polling = false;
                    async function poll() {
                        if (polling || !server.listening) return;
                        polling = true;
                        try {
                            var requests = await callAsync("http.getRequests", [name]);
                            requests.forEach(dispatch);
                        } catch (error) {
                            if (server.listening) console.error("[Typora Plugin for Mac]", error);
                        } finally {
                            polling = false;
                        }
                    }
                    function dispatch(request) {
                        var status = 200, headers = {};
                        var req = {
                            method: request.method, url: request.url, headers: request.headers,
                            socket: { remoteAddress: request.remoteAddress },
                            async *[Symbol.asyncIterator]() {
                                yield window.Buffer.from(request.body, "base64");
                            }
                        };
                        var res = {
                            writeHead: function(code, nextHeaders) { status = code; headers = nextHeaders; },
                            end: function(body) {
                                callAsync("http.sendResponse", [name, request.id, status, headers, body])
                                    .catch(function(error) { console.error("[Typora Plugin for Mac]", error); });
                            }
                        };
                        Promise.resolve().then(function() { return handler(req, res); }).catch(function() {
                            res.writeHead(500, {});
                            res.end();
                        });
                    }
                    window.addEventListener("pagehide", function() {
                        if (server.listening) server.close();
                    }, { once: true });
                    return server;
                },

            };
        }

        // ── Stub modules ──
        if (id === "net") return { createServer: function() { return { listen: function(){} }; }, connect: function() { return { on: function(){}, end: function(){} }; } };
        if (id === "tls") return { connect: function() { return { on: function(){}, end: function(){} }; } };
        if (id === "url") return {
            parse: function(u) {
                try { var a = document.createElement("a"); a.href = u; return { protocol: a.protocol, host: a.host, hostname: a.hostname, port: a.port, pathname: a.pathname, search: a.search, hash: a.hash, href: a.href }; }
                catch(e) { return {}; }
            },
            fileURLToPath: function(u) {
                var value = String(u || "");
                return value.indexOf("file://") === 0 ? decodeURIComponent(value.slice(7)) : value;
            },
            pathToFileURL: function(p) { return { href: "file://" + encodeURI(String(p || "")) }; }
        };
        if (id === "querystring") return {
            parse: function(s) { var o = {}; if (!s) return o; s.split("&").forEach(function(p) { var kv = p.split("="); o[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ""); }); return o; },
            stringify: function(o) { return Object.keys(o).map(function(k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&"); }
        };
        // PlantUML's POST renderer uses Readable.from([Buffer.from(text)]).
        // Implement the small readable contract used by node-fetch instead of
        // returning a no-op object (which silently drops the request body).
        if (id === "stream") {
            function Readable(options) {
                this._listeners = {};
                this._chunks = [];
                this.readable = true;
                if (options && typeof options.read === "function") this._read = options.read;
            }
            Readable.prototype.on = function(event, fn) {
                (this._listeners[event] || (this._listeners[event] = [])).push(fn);
                return this;
            };
            Readable.prototype.once = function(event, fn) {
                var self = this;
                function once() { self.removeListener(event, once); fn.apply(self, arguments); }
                return this.on(event, once);
            };
            Readable.prototype.removeListener = function(event, fn) {
                var list = this._listeners[event] || [], i = list.indexOf(fn);
                if (i >= 0) list.splice(i, 1);
                return this;
            };
            Readable.prototype.emit = function(event) {
                var args = Array.prototype.slice.call(arguments, 1), list = this._listeners[event] || [];
                list.slice().forEach(function(fn) { fn.apply(this, args); }, this);
                return list.length > 0;
            };
            Readable.prototype.push = function(chunk) {
                if (chunk === null) { this.emit("end"); return false; }
                this._chunks.push(chunk); this.emit("data", chunk); return true;
            };
            Readable.prototype.pipe = function(destination) {
                this.on("data", function(chunk) { destination.write(chunk); });
                this.on("end", function() { if (destination.end) destination.end(); });
                return destination;
            };
            Readable.prototype.resume = function() { return this; };
            Readable.prototype.read = function() { return this._chunks.length ? this._chunks.shift() : null; };
            if (typeof Symbol !== "undefined") {
                Readable.prototype[Symbol.iterator] = function() {
                    var chunks = this._chunks.slice(), index = 0;
                    return { next: function() { return index < chunks.length ? { value: chunks[index++], done: false } : { done: true }; } };
                };
                Readable.prototype[Symbol.asyncIterator] = function() {
                    var self = this;
                    return { next: function() { return Promise.resolve({ value: self.read(), done: self._chunks.length === 0 }); } };
                };
            }
            Readable.from = function(iterable) {
                var stream = new Readable();
                // Keep the source synchronously available for transports that
                // serialize a request body immediately (our Node bridge does).
                stream._chunks = Array.prototype.slice.call(iterable);
                setTimeout(function() {
                    try {
                        stream._chunks.slice().forEach(function(chunk) { stream.emit("data", chunk); });
                        stream.emit("end");
                    } catch (e) { stream.emit("error", e); }
                }, 0);
                return stream;
            };
            function Transform() { Readable.call(this); }
            Transform.prototype = Object.create(Readable.prototype);
            Transform.prototype.constructor = Transform;
            Transform.prototype.write = function(chunk) { this.push(chunk); return true; };
            Transform.prototype.end = function(chunk) { if (chunk) this.write(chunk); this.push(null); };
            return { Readable: Readable, Transform: Transform, PassThrough: Transform };
        }
        if (["events","buffer","assert","string_decoder","tty","worker_threads","supports-color"].indexOf(id) >= 0) return {};

        // ── vscode-ripgrep stub: return system rg path ──
        // ripgrep plugin does: reqnode("vscode-ripgrep").rgPath
        // We ask bridge to locate the system-installed rg binary
        if (id === "vscode-ripgrep") {
            var rgPath = null;
            try { rgPath = call("util.which", ["rg"]); } catch(e) {}
            if (!rgPath) {
                // Fallback: check common macOS paths synchronously
                var candidates = ["/opt/homebrew/bin/rg", "/usr/local/bin/rg", "/usr/bin/rg"];
                for (var ci = 0; ci < candidates.length; ci++) {
                    try { if (call("fs.existsSync", [candidates[ci]])) { rgPath = candidates[ci]; break; } } catch(e) {}
                }
            }
            return { rgPath: rgPath };
        }

        // ── Resolve and load plugin module ──
        var fp = id;
        if (fp[0] === ".") fp = _path.join(PLUGIN, fp);
        else if (fp.indexOf("/") < 0) return {};

        var tryList = !/\.(js|json|node|toml|css)$/.test(fp) ? [fp + "/index.js"] : [];
        tryList.push(fp + ".js", fp);
        var src = null, resolved = null;
        for (var ti = 0; ti < tryList.length; ti++) {
            try { var _ts = _readBundle(tryList[ti]); if (_ts && _ts.trim().length > 0) { src = _ts; resolved = tryList[ti]; break; } } catch(e2) {}
        }
        if (resolved === null) throw new Error("Cannot find: " + id);
        if (_modCache[resolved]) return _modCache[resolved];

        // JSON files: parse as JSON instead of eval
        if (/\.json$/i.test(resolved)) {
            try {
                var parsed = JSON.parse(src);
                _modCache[resolved] = parsed;
                return parsed;
            } catch(e) {
                throw new Error("Module '" + resolved.replace(BASE, "") + "' (JSON) failed: " + e.message);
            }
        }

        var mod = { exports: {} };
        var __d = _path.dirname(resolved);
        var __req = function(p) {
            var full = p[0] === "." ? _path.join(__d, p) : p;
            return window.reqnode(full);
        };

        var shortName = resolved.substring(BASE.length);
        var fn = new Function("module","exports","require","reqnode","__dirname","__filename","global","console","process","Buffer","setTimeout","setInterval","setImmediate","clearImmediate", src);
        try {
            fn(mod, mod.exports, __req, window.reqnode, __d, resolved, window, console, window.process, window.Buffer, setTimeout, setInterval, window.setImmediate, window.clearImmediate);
        } catch(ex) {
            var fn2 = new Function("module","exports","require","reqnode","__dirname","__filename","global","console","process","Buffer","setTimeout","setInterval", src);
            try {
                fn2(mod, mod.exports, __req, window.reqnode, __d, resolved, window, console, window.process, window.Buffer, setTimeout, setInterval);
            } catch(ex2) {
                var firstMessage = ex && (ex.stack || ex.message) || String(ex);
                var secondMessage = ex2 && (ex2.stack || ex2.message) || String(ex2);
                console.error("[loader] module failed", shortName, firstMessage, secondMessage);
                throw new Error("Module '" + shortName + "' failed: " + secondMessage + " (initial: " + firstMessage + ")");
            }
        }
        _modCache[resolved] = mod.exports;
        return mod.exports;
    };

    // ════════════════════════════════════════════════════════
    // Global dirname
    // ════════════════════════════════════════════════════════
    document.documentElement.classList.add("typora-plugin-macos");
    window.__typoraPluginMacState = %%STATE_PATH%%;
    window.dirname = BASE;
    window.__dirname = BASE;

    // ════════════════════════════════════════════════════════
    // Init on window.load
    // ════════════════════════════════════════════════════════

window.addEventListener("load", function() {
        try { call("debug.log", ["Editor loaded at " + location.protocol]); } catch (error) {}
        // Bridge connectivity check
        if (_ready) {
            try {
                window.process.env = call("process.env", []);
                window.process.cwd = function() { try { return call("process.cwd", []); } catch(e) { return "/"; } };
            } catch(e) {
                _ready = false;
            }
        }

        if (window.JSBridge && typeof JSBridge.invoke === "function") {
            var nativeInvoke = JSBridge.invoke;
            JSBridge.invoke = function(action, options) {
                if (action === "plugin.stageMacUpdate") return callAsync("update.stage", [options]);
                if (action === "plugin.listMacFonts") return callAsync("fonts.list", []);
                var mode = {
                    "dialog.showOpenDialog": "open",
                    "dialog.showSaveDialog": "save",
                    "dialog.showMessageBox": "alert",
                    "dialog.typoraPluginMenu": "menu"
                }[action];
                if (mode) return callAsync("dialog.filePanel", [mode, options]);
                return nativeInvoke.apply(this, arguments);
            };
        }

        // Load plugin, then force code block re-scan after init
        try {
            _modCache = {};
            var core = window.reqnode(PLUGIN + "global/core");
            if (typeof core === "function") {
                var p = core();
                if (p && p.then) p.then(function() {
                    try {
                        var state = window.reqnode(PLUGIN + "global/core/container").getAllPlugins();
                        call("debug.log", ["Plugin framework ready: " + Object.keys(state).join(", ")]);
                    } catch (e) { call("debug.log", ["Plugin framework returned: " + e.message]); }
                    // Hook search_multi: fallback to current file dir when no mount folder
                    try {
                        var _container = window.reqnode(PLUGIN + "global/core/container");
                        var _sm = _container.getPlugin("search_multi");
                        if (_sm && _sm.search) {
                            var _origSearch = _sm.search;
                            _sm.search = function(rootPath, input) {
                                if (!rootPath) {
                                    rootPath = this.utils.getFilePath()
                                        ? this.utils.getCurrentDirPath()
                                        : this.utils.getMountFolder();
                                }
                                return _origSearch.call(this, rootPath, input);
                            };
                        }
                    } catch(e) {}

                    // Re-fire code block events that may have been missed during loading
                    setTimeout(function() {
                        try {
                            if (typeof File !== "undefined" && File.editor && File.editor.fences) {
                                var q = File.editor.fences.queue || {};
                                Object.keys(q).forEach(function(cid) {
                                    try { File.editor.fences.addCodeBlock(cid); } catch(e) {}
                                });
                            }
                        } catch(e) {}
                    }, 300);
                }).catch(reportStartupError);
            }
        } catch(e) { reportStartupError(e); }
    });

    function reportStartupError(error) {
        console.error("[Typora Plugin for Mac]", error);
        try { call("debug.log", [error.stack || String(error)]); } catch (bridgeError) {}
    }

})();
