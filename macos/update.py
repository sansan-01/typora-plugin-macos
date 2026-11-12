"""Stage upstream plugin changes without replacing the Mac port or user settings."""

import fcntl
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

BASE = "7b3b7918aee89f7d823c3a01aa426e3b05e2bc93"
REPO = "obgnail/typora_plugin"
API = "https://api.github.com/repos/" + REPO
ARCHIVE = "https://codeload.github.com/" + REPO + "/tar.gz/"
LIMIT = 150 * 1024 * 1024


def revision(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ValueError("Invalid upstream revision")
    return value


def fetch(url, limit, target=None):
    # System curl uses the macOS certificate store. Do not follow redirects.
    command = [
        "/usr/bin/curl", "-q", "--fail", "--silent", "--show-error",
        "--proto", "=https", "--max-time", "45", "--max-filesize", str(limit),
        "--user-agent", "Typora-Plugins-Mac",
    ]
    if target is not None:
        command.extend(["--output", str(target)])
    result = subprocess.run([*command, url], capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr.decode(errors="replace").strip() or "GitHub request failed")
    return result.stdout


def api_json(path):
    return json.loads(fetch(API + path, 4 * 1024 * 1024))


def local_files(root):
    # Ignore symlinks, Finder metadata and launcher-generated content.
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in root.rglob("*")
        if p.is_file() and not p.is_symlink() and p.name != ".DS_Store"
    }


def archive_files(archive, sha):
    files = {}
    names = set()
    size = 0
    prefix = f"typora_plugin-{revision(sha)}/plugin/"
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar:
            if not member.name.startswith(prefix):
                continue
            name = member.name[len(prefix):]
            if member.isdir():
                continue
            parts = name.split("/")
            folded = name.casefold()
            if not member.isfile() or any(p in ("", ".", "..") for p in parts) or folded in names:
                raise ValueError(f"Invalid plugin archive member: {name}")
            names.add(folded)
            size += member.size
            if size > LIMIT:
                raise ValueError("Expanded plugin archive is too large")
            with tar.extractfile(member) as data:
                files[name] = data.read()
    if "index.js" not in files or "global/settings/settings.default.toml" not in files:
        raise ValueError("Invalid upstream plugin archive")
    return files


def download(sha, target):
    fetch(ARCHIVE + revision(sha), LIMIT, target)


def merge(base, local, upstream, output, scratch):
    conflicts = []
    for name in sorted(base.keys() | local.keys() | upstream.keys()):
        before, ours, theirs = (tree.get(name) for tree in (base, local, upstream))
        if ours == before:
            result = theirs
        elif theirs == before or ours == theirs:
            result = ours
        elif None not in (before, ours, theirs) and not any(b"\0" in b for b in (before, ours, theirs)):
            operands = [scratch / n for n in ("local", "base", "upstream")]
            for path, content in zip(operands, (ours, before, theirs)):
                path.write_bytes(content)
            process = subprocess.run(
                ["/usr/bin/git", "merge-file", "-p", *operands],
                capture_output=True, check=False,
            )
            if process.returncode:
                conflicts.append(name)
                continue
            result = process.stdout
        else:
            conflicts.append(name)
            continue
        if result is not None:
            path = output / name
            if path.exists() or any(p.is_file() for p in path.parents if p != output):
                conflicts.append(name)
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(result)
    return conflicts


def fingerprint(files):
    sha = hashlib.sha256()
    for name, data in sorted(files.items()):
        sha.update(name.encode("utf-8") + b"\0" + hashlib.sha256(data).digest())
    return sha.hexdigest()


def source_for_launch(local, state):
    marker = state / "upstream.json"
    if not marker.exists():
        return local
    try:
        info = json.loads(marker.read_text())
        digest = fingerprint(local_files(local))
        if info["localFingerprint"] != digest:
            print("工作目录中的插件已变更，本次使用工作目录版本。可在插件菜单中重新检查更新。", flush=True)
            return local
        candidate = state / "upstream" / f'{revision(info["revision"])}-{digest}' / "plugin"
        if (candidate / "index.js").is_file():
            return candidate
    except (KeyError, TypeError, ValueError, OSError):
        pass
    print("无法读取暂存的更新，本次使用工作目录版本。可在插件菜单中重新检查更新。", flush=True)
    return local


def stage(local, state):
    directory = state / "upstream"
    directory.mkdir(exist_ok=True)
    with (directory / "update.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return stage_locked(local, state, directory)


def stage_locked(local, state, directory):
    latest = revision(api_json("/commits/HEAD")["sha"])
    marker = state / "upstream.json"
    try:
        info = json.loads(marker.read_text())
        installed = revision(info["revision"])
    except (FileNotFoundError, KeyError, TypeError, ValueError):
        installed = BASE
    if latest == BASE:
        return {"status": "current" if installed == BASE else "incompatible", "revision": latest}
    local_content = local_files(local)
    digest = fingerprint(local_content)
    destination = directory / f"{latest}-{digest}"
    if installed == latest and (destination / "plugin/index.js").is_file():
        return {"status": "staged", "revision": latest}
    ancestor = installed if installed != latest else BASE
    comparison = api_json(f"/compare/{ancestor}...{latest}?per_page=1")
    if comparison.get("status") != "ahead":
        return {"status": "incompatible", "revision": latest}
    with tempfile.TemporaryDirectory(dir=directory) as temp:
        tmp = Path(temp)
        trees = []
        for sha in (BASE, latest):
            archive = tmp / f"{sha}.tgz"
            download(sha, archive)
            trees.append(archive_files(archive, sha))
        candidate = tmp / "candidate"
        conflicts = merge(trees[0], local_content, trees[1], candidate / "plugin", tmp)
        if conflicts:
            return {"status": "conflict", "revision": latest, "files": conflicts}
        if not (candidate / "plugin/index.js").is_file():
            raise ValueError("Merged update lacks the plugin entry point")
        if not destination.exists():
            candidate.rename(destination)
        pending = tmp / "upstream.json"
        pending.write_text(json.dumps({"revision": latest, "localFingerprint": digest}))
        pending.replace(marker)
        return {"status": "staged", "revision": latest}


if __name__ == "__main__":
    try:
        print(json.dumps(stage(Path(__file__).resolve().parent.parent / "plugin", Path(sys.argv[1]))))
    except (ValueError, OSError, KeyError, tarfile.TarError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
