#!/usr/bin/env python3
"""Check the source directory or exact staged contents before publication."""

import argparse
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", "node_modules", "dist"}
PRIVATE_DIRS = {".local", ".trigger-tree", ".codex", ".aws", ".ssh", ".gnupg", "test-results", "coverage"}
PRIVATE_FILES = re.compile(r"^(?:\.env(?:\..*)?|\.npmrc|auth\.json|credentials|projects\.json|id_(?:rsa|ecdsa|ed25519)|.*\.(?:pem|key|p12|pfx|log))$", re.IGNORECASE)
MACHINE_PATH = re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+/|[A-Za-z]:\\Users\\[^\\\s]+\\")
SECRET = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b")
UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)
SYNTHETIC_UUID = re.compile(r"00000000-0000-4000-8000-[0-9a-f]{12}", re.IGNORECASE)


def directory_files(directory):
    for path in sorted(directory.iterdir()):
        relative = path.relative_to(ROOT)
        if path.name in SKIP and (len(relative.parts) == 1):
            continue
        if path.is_symlink():
            yield path
        elif path.is_dir():
            yield from directory_files(path)
        else:
            yield path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true")
    args = parser.parse_args()
    if args.staged:
        result = subprocess.run(["git", "ls-files", "--cached", "-z"], cwd=ROOT, check=True, capture_output=True)
        paths = [ROOT / path for path in result.stdout.decode().split("\0") if path]
    else:
        paths = list(directory_files(ROOT))
    findings = []
    for path in paths:
        relative = path.relative_to(ROOT)
        parts = relative.parts
        if parts[0] == "todo" or any(part in PRIVATE_DIRS for part in parts) or any(part in {"node_modules", ".git"} for part in parts):
            findings.append(f"{relative}: private/generated directory")
        if PRIVATE_FILES.fullmatch(path.name) and path.name != ".env.example":
            findings.append(f"{relative}: private filename")
        if path.is_symlink() or not path.is_file():
            findings.append(f"{relative}: symlink or nonregular file")
            continue
        data = subprocess.run(["git", "show", f":{relative.as_posix()}"], cwd=ROOT, check=True, capture_output=True).stdout if args.staged else path.read_bytes()
        try:
            text = data.decode("utf8")
        except UnicodeDecodeError:
            findings.append(f"{relative}: binary file requires manual review")
            continue
        for name, pattern in [("machine-specific path", MACHINE_PATH), ("credential pattern", SECRET)]:
            if pattern.search(text):
                findings.append(f"{relative}: {name}")
        if any(value.lower() not in {"00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"} and not SYNTHETIC_UUID.fullmatch(value) for value in UUID.findall(text)):
            findings.append(f"{relative}: nonsynthetic UUID requires privacy review")
    if findings:
        print("Publication check failed (content redacted):")
        print("\n".join(findings))
        return 1
    print(f"Publication check passed: {len(paths)} files; no private paths, runtime data, binaries, or credential patterns.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
