#!/usr/bin/env python3
"""Install or remove the plugin in an existing macOS Typora application."""
import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

from update import source_for_launch

MAC = Path(__file__).resolve().parent
PROJECT = MAC.parent
EDITOR = Path("Contents/Resources/TypeMark")
DEFAULT_APP = Path("/Applications/Typora.app")
DEFAULT_STATE = Path.home() / "Library/Application Support/Typora Plugin"
CODE = Path("/Applications/Visual Studio Code.app/Contents/MacOS/Code")
TAG = '<script src="./plugin/loader.mac.js" defer></script>'
APPEARANCE = '<link rel="stylesheet" href="./plugin/appearance.mac.css">'
RENAME_HOOK = '<script src="./plugin/rename-hook.mac.js"></script>'
DOMAIN = f"gui/{os.getuid()}"
PLIST_DIR = Path.home() / "Library/LaunchAgents"


def run(*args, **options):
    return subprocess.run(args, check=True, **options)


def swap(first, second):
    # RENAME_SWAP replaces the app at the original path in a single operation.
    fn = ctypes.CDLL(None, use_errno=True).renamex_np
    fn.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(os.fsencode(first), os.fsencode(second), 2):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(first), str(second))


def atomic_write(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        temp = Path(file.name)
        try:
            file.write(data)
            file.flush()
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


def build_file_panel(state):
    source = MAC / "FilePanel.swift"
    digest = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
    panel = state / f"file-panel-{digest}"
    if not panel.exists():
        with tempfile.TemporaryDirectory(dir=state) as directory:
            output = Path(directory) / "file-panel"
            run("/usr/bin/xcrun", "swiftc", "-parse-as-library", "-O",
                "-module-cache-path", str(state / "swift-cache"), str(source), "-o", str(output))
            output.replace(panel)
    return panel


def require_closed(app, panel):
    status = subprocess.run([panel, "running", app]).returncode
    if status == 0:
        raise RuntimeError("请先正常退出 Typora，再运行安装或卸载。")
    if status != 1:
        raise RuntimeError("无法确认 Typora 是否已经退出。")


def runtime():
    path = os.environ.get("PATH", "") + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin"
    node = shutil.which("node", path=path)
    if node:
        return node, {}
    if CODE.is_file():
        return str(CODE), {"ELECTRON_RUN_AS_NODE": "1"}
    raise RuntimeError("需要 Node.js 22 或已安装的 Visual Studio Code。")


def inject(candidate, app, state, plugin, token, port, plist, label):
    resources = candidate / EDITOR
    index = resources / "index.html"
    html = index.read_text()
    if (resources / "plugin").exists() or html.count("</body>") != 1 or html.count("</head>") != 1:
        raise RuntimeError("未找到干净的 Typora 编辑器入口。")
    shutil.copytree(plugin, resources / "plugin")
    loader = (MAC / "loader.js").read_text()
    loader = loader.replace("%%RESOURCE_PATH%%", json.dumps(str(app / EDITOR) + "/"))
    loader = loader.replace("%%BRIDGE_PORT%%", str(port))
    loader = loader.replace("%%STATE_PATH%%", json.dumps(str(state)))
    loader = loader.replace("%%BRIDGE_TOKEN%%", token)
    (resources / "plugin/loader.mac.js").write_text(loader)
    (resources / "plugin/loader.mac.js").chmod(0o600)
    shutil.copyfile(MAC / "appearance.css", resources / "plugin/appearance.mac.css")
    shutil.copyfile(MAC / "rename-hook.js", resources / "plugin/rename-hook.mac.js")
    html = html.replace("</head>", RENAME_HOOK + "\n</head>")
    index.write_text(html.replace("</body>", APPEARANCE + "\n" + TAG + "\n</body>"))
    contents = candidate / "Contents"
    info_path = contents / "Info.plist"
    info = plistlib.loads(info_path.read_bytes())
    executable = info["CFBundleExecutable"]
    launcher = contents / "MacOS" / "TyporaPluginLauncher"
    run("/usr/bin/xcrun", "swiftc", "-parse-as-library", "-O", "-module-cache-path",
        str(state / "swift-cache"), MAC / "LaunchTypora.swift", "-o", launcher)
    info["CFBundleExecutable"] = launcher.name
    info_path.write_bytes(plistlib.dumps(info))
    (contents / "Resources/typora-plugin-launch.json").write_text(json.dumps({
        "label": label, "plist": str(plist), "port": port, "executable": executable,
    }))
    menu_library = contents / "Frameworks/TyporaPluginMenu.dylib"
    run("/usr/bin/xcrun", "clang", "-dynamiclib", "-fobjc-arc", "-O2",
        "-framework", "AppKit", "-framework", "WebKit",
        MAC / "NativeContextMenu.m", "-o", menu_library)
    run("/usr/bin/codesign", "--force", "--sign", "-", menu_library)
    run("/usr/bin/codesign", "--force", "--sign", "-", contents / "MacOS" / executable)
    run("/usr/bin/codesign", "--force", "--sign", "-", candidate)
    verify(candidate)


def verify(app):
    run("/usr/bin/codesign", "--verify", "--deep", app)


def injected(app):
    index = app / EDITOR / "index.html"
    return index.is_file() and TAG in index.read_text()


def agent_loaded(label):
    return subprocess.run(
        ["/bin/launchctl", "print", f"{DOMAIN}/{label}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0


def stop_agent(label):
    if agent_loaded(label):
        run("/bin/launchctl", "bootout", f"{DOMAIN}/{label}")
        for _ in range(40):
            if not agent_loaded(label):
                return
            time.sleep(0.15)
        raise RuntimeError("原有插件服务尚未退出，请稍后重试。")


def start_agent(plist):
    run("/bin/launchctl", "bootstrap", DOMAIN, plist)


def healthy(port, token):
    from urllib.request import Request

    opener = build_opener(ProxyHandler({}))
    request = Request(
        f"http://127.0.0.1:{port}/api",
        data=b'{"method":"process.cwd","params":[]}',
        headers={"Content-Type": "application/json", "X-Bridge-Token": token},
    )
    for _ in range(40):
        try:
            with opener.open(request, timeout=0.5) as response:
                if json.load(response).get("ok"):
                    return True
        except (URLError, TimeoutError, ValueError):
            pass
        time.sleep(0.15)
    return False


def backup_original(app, backup):
    verify(app)
    with tempfile.TemporaryDirectory(dir=backup.parent) as directory:
        archive = Path(directory) / "original.zip"
        run("/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, archive)
        archive.replace(backup)


def restore_copy(backup, directory, app):
    run("/usr/bin/ditto", "-x", "-k", backup, directory)
    candidate = directory / app.name
    verify(candidate)
    return candidate


def install(app, state, plist, label, panel, backup):
    require_closed(app, panel)
    if not injected(app):
        backup_original(app, backup)
    if not backup.is_file():
        raise RuntimeError("缺少未修改的 Typora 备份。请重新安装官方 Typora 后重试。")

    legacy = PROJECT / ".macos-runtime"
    for name in ("settings.user.toml", "user_space"):
        source, destination = legacy / name, state / name
        if source.is_dir() and not destination.exists():
            shutil.copytree(source, destination)
        elif source.is_file() and not destination.exists():
            shutil.copyfile(source, destination)
    (state / "settings.user.toml").touch(exist_ok=True)
    (state / "user_space").mkdir(exist_ok=True)

    plugin = source_for_launch(PROJECT / "plugin", state)
    node, environment = runtime()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    token = secrets.token_hex(32)
    payload = Path(tempfile.mkdtemp(dir=state, prefix="runtime-"))
    changed_agent = False
    succeeded = False
    previous = plist.read_bytes() if plist.is_file() else None
    was_loaded = agent_loaded(label)
    try:
        bridge_dir = payload / "macos"
        bridge_dir.mkdir()
        for name in ("bridge.js", "network.js", "processes.js", "update.py"):
            shutil.copyfile(MAC / name, bridge_dir / name)
        shutil.copytree(PROJECT / "plugin", payload / "plugin")
        key = payload / "token"
        key.write_text(token)
        (state / "bridge.log").touch(exist_ok=True)
        environment.update(
            TYPORA_MAC_PORT=str(port), TYPORA_MAC_TOKEN_FILE=str(key),
            TYPORA_MAC_FILE_PANEL=str(panel), TYPORA_MAC_PYTHON=sys.executable,
            TYPORA_MAC_STATE=str(state),
        )
        spec = {
            "Label": label, "ProgramArguments": [node, str(bridge_dir / "bridge.js")],
            "EnvironmentVariables": environment, "WorkingDirectory": str(payload),
            "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 5,
            "StandardOutPath": str(state / "bridge.log"), "StandardErrorPath": str(state / "bridge.log"),
        }
        PLIST_DIR.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=app.parent, prefix=".typora-plugin-") as directory:
            candidate = restore_copy(backup, Path(directory), app)
            inject(candidate, app, state, plugin, token, port, plist, label)
            require_closed(app, panel)
            stop_agent(label)
            changed_agent = True
            atomic_write(plist, plistlib.dumps(spec))
            start_agent(plist)
            if not healthy(port, token):
                raise RuntimeError(f"插件服务未启动。日志位于 {state / 'bridge.log'}")
            require_closed(app, panel)
            swap(app, candidate)
            succeeded = True
    finally:
        if not succeeded:
            if changed_agent:
                stop_agent(label)
                if previous is None:
                    plist.unlink(missing_ok=True)
                else:
                    atomic_write(plist, previous)
                    if was_loaded:
                        start_agent(plist)
            shutil.rmtree(payload)
    print(f"已安装到 {app}。以后从 Finder 或 Dock 正常打开 Typora。")


def uninstall(app, plist, label, panel, backup):
    require_closed(app, panel)
    if injected(app):
        with tempfile.TemporaryDirectory(dir=app.parent, prefix=".typora-plugin-") as directory:
            candidate = restore_copy(backup, Path(directory), app)
            require_closed(app, panel)
            swap(app, candidate)
    stop_agent(label)
    plist.unlink(missing_ok=True)
    print(f"已恢复 {app}。插件设置和备份仍保留。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--typora", type=Path, default=DEFAULT_APP)
    parser.add_argument("--state", type=Path)
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()
    app = args.typora.resolve(strict=True)
    if app.suffix != ".app" or not (app / EDITOR / "index.html").is_file():
        parser.error("请选择 Typora.app。")
    with (app / "Contents/Info.plist").open("rb") as info:
        if plistlib.load(info).get("CFBundleIdentifier") != "abnerworks.Typora":
            parser.error("请选择 Typora.app。")
    default = app == DEFAULT_APP
    suffix = "" if default else "." + hashlib.sha256(os.fsencode(app)).hexdigest()[:12]
    state = (args.state or DEFAULT_STATE.with_name(DEFAULT_STATE.name + suffix)).resolve()
    label = "local.typora-plugin.bridge" + suffix
    plist = PLIST_DIR / (label + ".plist")
    backup = state / "original.zip"
    os.umask(0o077)
    state.mkdir(parents=True, exist_ok=True)
    with (state / "install.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        panel = build_file_panel(state)
        if args.uninstall:
            uninstall(app, plist, label, panel, backup)
        else:
            install(app, state, plist, label, panel, backup)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError, ValueError) as error:
        sys.exit(str(error))
