#!/usr/bin/env python3
"""Check the source directory or exact staged contents before publication."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", "node_modules", "dist"}
PRIVATE_DIRS = {".local", ".trigger-tree", ".codex", ".aws", ".ssh", ".gnupg", "test-results", "coverage"}
PRIVATE_FILES = re.compile(r"^(?:\.env(?:\..*)?|\.npmrc|auth\.json|credentials|projects\.json|id_(?:rsa|ecdsa|ed25519)|.*\.(?:pem|key|p12|pfx|log))$", re.IGNORECASE)
MACHINE_PATH = re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+/|[A-Za-z]:\\Users\\[^\\\s]+\\")
SECRET = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b")
UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)
SYNTHETIC_UUID = re.compile(r"00000000-0000-4000-8000-[0-9a-f]{12}", re.IGNORECASE)
SCREENSHOT_APPROVALS = Path("docs/screenshots/reviewed.json")


def candidate_bytes(relative, staged):
    if staged:
        return subprocess.run(["git", "show", f":{relative.as_posix()}"], cwd=ROOT, check=True, capture_output=True).stdout
    return (ROOT / relative).read_bytes()


def screenshot_approvals(staged):
    try:
        approvals = json.loads(candidate_bytes(SCREENSHOT_APPROVALS, staged))
    except (FileNotFoundError, subprocess.CalledProcessError):
        return {}
    if not isinstance(approvals, dict) or any(
        not re.fullmatch(r"docs/screenshots/[a-z0-9-]+\.png", path)
        or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)
        for path, digest in approvals.items()
    ):
        raise ValueError("Invalid screenshot approval manifest")
    return approvals


def reviewed_png(data, digest):
    if hashlib.sha256(data).hexdigest() != digest or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    offset = 8
    chunks = []
    while offset + 12 <= len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        end = offset + length + 12
        if end > len(data):
            return False
        kind = data[offset + 4:offset + 8]
        if kind in {b"tEXt", b"zTXt", b"iTXt", b"eXIf"}:
            return False
        checksum = struct.unpack_from(">I", data, end - 4)[0]
        if zlib.crc32(data[offset + 4:end - 4]) != checksum:
            return False
        chunks.append(kind)
        offset = end
    return offset == len(data) and chunks[:1] == [b"IHDR"] and b"IDAT" in chunks and chunks[-1:] == [b"IEND"]


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
    try:
        approvals = screenshot_approvals(args.staged)
    except (ValueError, TypeError):
        print("Publication check failed: invalid screenshot approval manifest (content redacted).")
        return 1
    approved_images = 0
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
        data = candidate_bytes(relative, args.staged)
        if relative.as_posix() in approvals:
            if reviewed_png(data, approvals[relative.as_posix()]):
                approved_images += 1
            else:
                findings.append(f"{relative}: screenshot changed, invalid PNG, or embedded metadata; review again")
            continue
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
    print(f"Publication check passed: {len(paths)} files, {approved_images} reviewed screenshots; no private paths, runtime data, unreviewed binaries, or credential patterns.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
