#!/usr/bin/env python3
"""Build and verify a bounded, exact-byte public documentation artifact."""

from __future__ import annotations

import argparse
import codecs
import contextlib
import hashlib
import html
import http.client
import ipaddress
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
from typing import BinaryIO, Callable, Iterator
from urllib.parse import quote, unquote, urljoin, urlsplit


ROOT = Path(__file__).absolute().parents[3]
POLICY = "av/support/publication/site-policy.json"
FILE_POLICY = "av/support/publication/site-files.json"
PUBLICATION_POLICY = "av/support/publication/publication-policy.json"
CHECKER = "av/tools/publication/check-committed.mjs"
STAGER = "av/tools/publication/stage-site.py"
SOURCE_SEAL = "av/support/publication/source-input-manifest.json"
PUBLICATION_MANIFESTS = (
    "av/support/publication/publication-manifest.json",
    "onvif/support/publication/publication-manifest.json",
)
SOURCE_LOCK = "onvif/sources.lock.json"
CHUNK = 65536
MAX_BYTES = 1_000_000_000
MAX_FILE_BYTES = 67_108_864
MAX_METADATA_BYTES = 8_388_608
MAX_FILES = 10000
GENERATED = {
    ".nojekyll", "artifact-map.json", "download-index.html",
    "index.html", "site-manifest.json",
}
CANONICAL_ROLES = {
    "client-requirement-manifest", "normative-catalog", "normative-schema",
    "normative-vocabulary", "thing-model",
}
CSP = ("default-src 'none'; style-src 'unsafe-inline'; img-src data:; "
       "font-src data:; base-uri 'none'; form-action 'none'")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
BAD_ESCAPE = re.compile(r"%(?![0-9a-fA-F]{2})")
CONTROL = re.compile(r"[\x00-\x20\x7f]")
WINDOWS_RESERVED = re.compile(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", re.I)
PRIVATE_MARKERS = (
    ("host-path", re.compile(r"\b[A-Za-z]:(?:\\+|/)(?!/)")),
    ("user-path", re.compile(r"/(?:Users|home|private|tmp|var/tmp|workspaces?)/", re.I)),
    ("private-input", re.compile(r"(?:\.copilot[/\\]+session-state|local-only[/\\])", re.I)),
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----")),
    ("provider-token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[0-9A-Z]{16})\b")),
    ("credential-url", re.compile(r"\b(?:https?|rtsps?)://[^/\s<>\"']+:[^/\s<>\"']+@", re.I)),
    ("signed-secret", re.compile(r"[?&](?:X-Amz-Signature|sig|access_token)=[A-Za-z0-9_%+/-]{20,}", re.I)),
)


class SiteError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(f"{code}: {message}")


def fail(code: str, message: str) -> None:
    raise SiteError(code, message)


def require(condition: bool, code: str, message: str) -> None:
    if not condition:
        fail(code, message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("ascii")


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=True, indent=4, allow_nan=False) + "\n").encode("ascii")


def strict_json(data: bytes | str) -> object:
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "JSON_DUPLICATE", "duplicate object key")
            result[key] = value
        return result

    def constant(_):
        fail("JSON_SYNTAX", "non-finite number")

    try:
        value = json.loads(data, object_pairs_hook=pairs, parse_float=Decimal,
                           parse_constant=constant)
    except SiteError:
        raise
    except (UnicodeError, ValueError, RecursionError) as error:
        raise SiteError("JSON_SYNTAX", "invalid UTF-8 JSON") from error
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            require(not any(0xD800 <= ord(c) <= 0xDFFF for c in item),
                    "JSON_SYNTAX", "unpaired Unicode surrogate")
        elif isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return value


def object_keys(value, required: set[str], optional: set[str] | None = None) -> None:
    require(isinstance(value, dict), "METADATA", "expected an object")
    keys = set(value)
    require(required <= keys and keys <= required | (optional or set()),
            "METADATA", "unexpected or missing object fields")


def valid_sha(value: object) -> bool:
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def valid_commit(value: object) -> bool:
    return (isinstance(value, str) and COMMIT.fullmatch(value) is not None
            and set(value) != {"0"})


def portable_path(value: str, *, hidden: bool = False) -> str:
    require(isinstance(value, str) and bool(value), "PATH", "empty or non-string path")
    require(value == unicodedata.normalize("NFC", value), "PATH", "non-normalized Unicode path")
    require(not value.startswith("/") and not re.search(r"[:\\%?#\x00-\x1f\x7f<>\"|*]", value),
            "PATH", "nonportable path")
    for part in value.split("/"):
        require(part not in ("", ".", "..") and part == part.rstrip(" ."),
                "PATH", "noncanonical path component")
        require(not WINDOWS_RESERVED.match(part), "PATH", "reserved Windows filename")
        require(hidden or not part.startswith(".") or value == ".nojekyll",
                "PATH", "unapproved hidden path")
    return value


def path_key(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold()


def unique_paths(values: list[str], *, hidden: bool = False) -> None:
    seen = set()
    component_spellings = {}
    for value in values:
        portable_path(value, hidden=hidden)
        key = path_key(value)
        require(key not in seen, "PATH_COLLISION", "duplicate or case/Unicode-colliding path")
        seen.add(key)
        parts = value.split("/")
        for end in range(1, len(parts) + 1):
            prefix = "/".join(parts[:end])
            folded = path_key(prefix)
            require(component_spellings.get(folded, prefix) == prefix,
                    "PATH_COLLISION", "case/Unicode-colliding directory")
            component_spellings[folded] = prefix
    for value in values:
        parts = value.split("/")
        require(not any(path_key("/".join(parts[:end])) in seen for end in range(1, len(parts))),
                "PATH_COLLISION", "file is also a directory")


def admitted_path(value: str) -> str:
    portable_path(value)
    require(value in GENERATED or value.startswith(("av/", "onvif/", "notices/")),
            "ALLOWLIST", "public file is outside approved document roots")
    require(value.endswith((".html", ".json", ".jsonld", ".ttl", ".txt")) or value == ".nojekyll",
            "ALLOWLIST", "unapproved public file extension")
    denied = ("tools", "tests", "test", "history", "archive", "local-only",
              "node_modules", "build", "dist", "samples", "research", "reports",
              "editorial", "migration", "upstream", "inventory")
    require(not any(part.casefold() in denied or part.casefold().startswith("build-")
                    for part in value.split("/")[:-1]),
            "ALLOWLIST", "non-document directory is excluded from the site")
    require(not value.rsplit("/", 1)[-1].casefold().startswith(
        ("readme.", "source-input-manifest.", "publication-manifest.", "render-report.")),
        "ALLOWLIST", "source administration or proof is not a public download")
    return value


def check_ancestors(path: Path, *, missing_leaf: bool = False) -> None:
    path = path.absolute()
    components = [*reversed(path.parents), path]
    for index, component in enumerate(components):
        try:
            info = component.lstat()
        except FileNotFoundError:
            require(missing_leaf and index == len(components) - 1,
                    "FILESYSTEM", "missing path or parent directory")
            return
        require(not stat.S_ISLNK(info.st_mode)
                and not (getattr(info, "st_file_attributes", 0)
                         & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)),
                "LINK", "symlink, junction, or reparse ancestor is forbidden")
        if index < len(components) - 1:
            require(stat.S_ISDIR(info.st_mode), "FILESYSTEM", "parent is not a directory")


@contextlib.contextmanager
def regular_reader(path: Path, limit: int = MAX_FILE_BYTES) -> Iterator[BinaryIO]:
    check_ancestors(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1,
            "LINK", "input must be a single-link regular file")
    require(before.st_size <= limit, "SIZE", "file exceeds its byte limit")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        opened = os.fstat(stream.fileno())
        require((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns)
                == (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                and opened.st_nlink == 1, "RACE", "file changed while opening")
        yield stream
        after = os.fstat(stream.fileno())
        check_ancestors(path)
        current = path.lstat()
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_nlink)
        require(identity(after) == identity(before) == identity(current),
                "RACE", "file changed while reading")


@dataclass(frozen=True)
class Fingerprint:
    bytes: int
    sha256: str


def fingerprint(path: Path, limit: int = MAX_FILE_BYTES) -> Fingerprint:
    count = 0
    hasher = hashlib.sha256()
    with regular_reader(path, limit) as stream:
        while chunk := stream.read(CHUNK):
            count += len(chunk)
            require(count <= limit, "SIZE", "file grew beyond its byte limit")
            hasher.update(chunk)
    return Fingerprint(count, hasher.hexdigest())


def read_bytes(path: Path, limit: int = MAX_FILE_BYTES) -> bytes:
    data = bytearray()
    with regular_reader(path, limit) as stream:
        expected = os.fstat(stream.fileno()).st_size
        while chunk := stream.read(min(CHUNK, limit + 1 - len(data))):
            require(len(data) + len(chunk) <= limit, "SIZE", "file grew beyond its byte limit")
            data.extend(chunk)
        require(len(data) == expected, "RACE", "file size changed while reading")
    return bytes(data)


def run_process(arguments: list[str], cwd: Path, code: str, timeout: int = 180) -> bytes:
    environment = dict(os.environ, GIT_OPTIONAL_LOCKS="0", GIT_TERMINAL_PROMPT="0")
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        try:
            result = subprocess.run(arguments, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                    stdout=out, stderr=err, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise SiteError(code, "required local command unavailable or timed out") from error
        require(result.returncode == 0, code,
                f"required local command rejected the snapshot (exit {result.returncode})")
        require(out.tell() <= 16_777_216 and err.tell() <= 16_777_216,
                "SIZE", "local command output exceeds its limit")
        out.seek(0)
        return out.read()


class SourceTree:
    def __init__(self, root: Path):
        self.root = root.absolute()
        check_ancestors(self.root)
        self.head = self.git("rev-parse", "--verify", "HEAD").decode("ascii").strip()
        require(valid_commit(self.head), "GIT", "HEAD is not a commit")
        self.object_format = self.git("rev-parse", "--show-object-format").decode("ascii").strip()
        require(self.object_format in ("sha1", "sha256"), "GIT", "unsupported Git object format")
        self.tracked = {}
        for entry in self.git("ls-tree", "-rz", "--full-tree", "HEAD").split(b"\0"):
            if not entry:
                continue
            metadata, name = entry.split(b"\t", 1)
            mode, kind, oid = metadata.decode("ascii").split()
            self.tracked[name.decode("utf-8")] = (mode, kind, oid)
        self.index = {}
        for entry in self.git("ls-files", "--stage", "-z").split(b"\0"):
            if not entry:
                continue
            metadata, name = entry.split(b"\t", 1)
            mode, oid, stage = metadata.decode("ascii").split()
            path = name.decode("utf-8")
            require(stage == "0" and path not in self.index, "GIT", "unmerged index")
            self.index[path] = (mode, "blob", oid)

    def git(self, *arguments: str) -> bytes:
        return run_process(["git", "--no-pager", *arguments], self.root, "GIT", 60)

    def path(self, name: str) -> Path:
        portable_path(name, hidden=True)
        result = self.root.joinpath(*name.split("/"))
        current = self.root
        for part in name.split("/"):
            check_ancestors(current)
            require(part in os.listdir(current), "PATH_CASE", "source path is missing or has wrong case")
            current = current / part
        check_ancestors(result)
        return result

    def read(self, name: str, limit: int = MAX_FILE_BYTES) -> bytes:
        return read_bytes(self.path(name), limit)

    def stamp(self, name: str) -> Fingerprint:
        return fingerprint(self.path(name))

    def require_committed(self, names: set[str]) -> None:
        unique_paths(sorted(names), hidden=True)
        for name in sorted(names):
            tracked = self.tracked.get(name)
            require(tracked is not None and tracked[0] in ("100644", "100755")
                    and tracked[1] == "blob" and self.index.get(name) == tracked,
                    "UNCOMMITTED", f"selected input is not a committed regular file: {name}")
            file = self.path(name)
            count = file.stat().st_size
            hasher = hashlib.new(self.object_format)
            hasher.update(f"blob {count}\0".encode("ascii"))
            with regular_reader(file) as stream:
                while chunk := stream.read(CHUNK):
                    hasher.update(chunk)
            require(hasher.hexdigest() == tracked[2], "UNCOMMITTED",
                    f"selected input differs from HEAD: {name}")


@dataclass(frozen=True)
class SourceCertificate:
    source_commit: str
    files: dict[str, Fingerprint]
    proofs: dict[str, Fingerprint] = field(default_factory=dict)


def committed_certificate(tree: SourceTree, node: str | None) -> SourceCertificate:
    """Only a successful real checker invocation authorizes these recorded hashes."""
    expected: dict[str, str] = {}
    proof_bytes = {name: tree.read(name, MAX_METADATA_BYTES) for name in PUBLICATION_MANIFESTS}
    proof_bytes[SOURCE_SEAL] = tree.read(SOURCE_SEAL, MAX_METADATA_BYTES)
    proof_bytes[CHECKER] = tree.read(CHECKER, MAX_METADATA_BYTES)

    def add(name, sha):
        portable_path(name, hidden=True)
        require(valid_sha(sha) and expected.get(name, sha) == sha,
                "SOURCE_PROOF", "conflicting or malformed publication input digest")
        expected[name] = sha

    seal = strict_json(proof_bytes[SOURCE_SEAL])
    require(isinstance(seal, dict) and isinstance(seal.get("inputs"), list)
            and isinstance(seal.get("outputs"), list) and valid_sha(seal.get("digest")),
            "SOURCE_PROOF", "missing producer source-input seal")
    for record in seal["inputs"] + seal["outputs"]:
        require(isinstance(record, dict) and isinstance(record.get("path"), str),
                "SOURCE_PROOF", "invalid sealed source record")
        add(record["path"], record.get("sha256"))

    for name in PUBLICATION_MANIFESTS:
        manifest = strict_json(proof_bytes[name])
        require(isinstance(manifest, dict), "SOURCE_PROOF", "malformed publication manifest")
        try:
            for record in manifest["inputs"] + manifest["artifacts"]:
                add(record["path"], record["sha256"])
            for path, sha in manifest["specification"]["inputs"].items():
                add(path, sha)
        except (KeyError, TypeError, AttributeError) as error:
            raise SiteError("SOURCE_PROOF", "missing publication input or output records") from error
    locked = tree.read(SOURCE_LOCK, MAX_METADATA_BYTES)
    require(expected.get(SOURCE_LOCK) == digest(locked), "SOURCE_PROOF", "source lock is not certified")
    lock = strict_json(locked)
    require(isinstance(lock, dict) and isinstance(lock.get("sources"), list),
            "SOURCE_PROOF", "malformed source lock")
    for source in lock["sources"]:
        if source.get("kind") == "notice" and source.get("storage") == "vendored":
            require(source.get("redistribution", {}).get("status") == "permitted-unchanged",
                    "SOURCE_PROOF", "notice lacks unchanged-copy clearance")
            add("onvif/support/upstream/onvif/" + portable_path(source["relativePath"]),
                source["sha256"])
    stamps = {}
    for name, sha in expected.items():
        stamps[name] = tree.stamp(name)
        require(stamps[name].sha256 == sha, "STALE_SOURCE", f"recorded source bytes differ: {name}")
    if node is None:
        node = shutil.which("node")
        if node is None and os.name == "nt":
            publication = strict_json(tree.read(PUBLICATION_POLICY, MAX_METADATA_BYTES))
            candidate = publication.get("node", {}).get("executable") if isinstance(publication, dict) else None
            if isinstance(candidate, str) and Path(candidate).is_file():
                node = candidate
    require(bool(node), "NODE", "Node is unavailable; supply --node with the qualified executable")
    result = strict_json(run_process([node, str(tree.path(CHECKER))], tree.root, "SOURCE_CHECK", 180))
    require(isinstance(result, dict) and result.get("status") == "verified"
            and result.get("assurance") == "committed-generation-consistency"
            and result.get("browserInvoked") is False and result.get("sourceSealDigest") == seal["digest"],
            "SOURCE_CHECK", "checker did not return a matching read-only source certificate")
    for name, data in proof_bytes.items():
        require(tree.read(name, MAX_METADATA_BYTES) == data, "STALE_CERTIFICATE",
                "publication proof changed during its check")
    return SourceCertificate(tree.head, stamps,
                             {name: Fingerprint(len(data), digest(data))
                              for name, data in proof_bytes.items()})


def scan_private(text: str) -> None:
    text = html.unescape(text)
    for label, pattern in PRIVATE_MARKERS:
        for match in pattern.finditer(text):
            if label == "user-path":
                public_path = False
                for resource in re.finditer(r"\bhttps?://[^\s<>\"'\\]+", text, re.I):
                    if resource.start() <= match.start() and match.end() <= resource.end():
                        try:
                            parsed = urlsplit(resource.group())
                            port = parsed.port
                        except ValueError:
                            continue
                        if (parsed.hostname and parsed.username is None and parsed.password is None
                                and (port is None or 0 < port <= 65535)):
                            public_path = True
                            break
                if public_path:
                    continue
            fail("PUBLIC_CONTENT", f"public content contains a forbidden {label} marker")


def validate_data_file(file: Path, name: str, limit: int) -> None:
    decoder = codecs.getincrementaldecoder("utf-8")("strict")
    tail = ""
    try:
        with regular_reader(file, limit) as stream:
            while chunk := stream.read(CHUNK):
                text = decoder.decode(chunk)
                combined = tail + text
                scan_private(combined)
                tail = combined[-2048:]
            scan_private(tail + decoder.decode(b"", final=True))
    except UnicodeError as error:
        raise SiteError("UTF8", "public document is not UTF-8") from error
    if name.endswith((".json", ".jsonld")):
        value = strict_json(read_bytes(file, limit))
        pending = [value]
        while pending:
            item = pending.pop()
            if isinstance(item, str):
                scan_private(item)
            elif isinstance(item, dict):
                pending.extend(item.keys())
                pending.extend(item.values())
            elif isinstance(item, list):
                pending.extend(item)


def decode_fragment(value: str) -> str:
    require(not BAD_ESCAPE.search(value), "FRAGMENT", "malformed percent escape")
    try:
        decoded = unquote(value, encoding="utf-8", errors="strict")
    except UnicodeError as error:
        raise SiteError("FRAGMENT", "invalid UTF-8 fragment") from error
    require(re.search(r"[\x00-\x1f\x7f]", decoded) is None, "FRAGMENT", "control character in fragment")
    return decoded


def json_pointer(value: object, pointer: str) -> object:
    require(isinstance(pointer, str), "JSON_POINTER", "pointer must be a string")
    if pointer == "":
        return value
    require(pointer.startswith("/"), "JSON_POINTER", "fragment is not a JSON Pointer")
    for encoded in pointer[1:].split("/"):
        require(re.search(r"~(?:[^01]|$)", encoded) is None,
                "JSON_POINTER", "invalid tilde escape")
        key = encoded.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict):
            require(key in value, "JSON_POINTER", "missing object member")
            value = value[key]
        elif isinstance(value, list):
            require(re.fullmatch(r"0|[1-9][0-9]*", key) is not None,
                    "JSON_POINTER", "invalid array index")
            require(len(key) < 12 and int(key) < len(value),
                    "JSON_POINTER", "array index out of bounds")
            value = value[int(key)]
        else:
            fail("JSON_POINTER", "pointer traverses a scalar")
    return value


def validate_external_url(value: str, *, https_only: bool = False) -> None:
    require(isinstance(value, str) and not CONTROL.search(value) and "\\" not in value
            and not BAD_ESCAPE.search(value), "URL", "invalid external URL")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as error:
        raise SiteError("URL", "invalid URL authority") from error
    require(parts.scheme in (("https",) if https_only else ("http", "https"))
            and bool(parts.hostname) and parts.username is None and parts.password is None
            and (port is None or 0 < port <= 65535),
            "URL", "external URL requires a credential-free HTTP authority")
    scan_private(value)


def validate_base_path(value: str) -> str:
    require(isinstance(value, str) and value.startswith("/") and value.endswith("/")
            and value != "/", "BASE_PATH", "expected a project-site path with trailing slash")
    portable_path(value[1:-1])
    return value


def resolve_link(document: str, href: str, policy: dict) -> tuple[str, str] | None:
    require(isinstance(href, str) and not CONTROL.search(href) and "\\" not in href
            and not BAD_ESCAPE.search(href) and not href.startswith("//"),
            "URL", "unsafe or malformed hyperlink")
    try:
        parts = urlsplit(href)
    except ValueError as error:
        raise SiteError("URL", "malformed hyperlink") from error
    origin = urlsplit(policy["siteUrl"])
    if parts.scheme or parts.netloc:
        validate_external_url(href)
        if (parts.scheme, parts.netloc) != (origin.scheme, origin.netloc):
            return None
    raw_path = parts.path
    require(not re.search(r"%(?:2f|5c|25|0[0-9a-f]|1[0-9a-f]|7f)", raw_path, re.I),
            "URL", "encoded separator, escape, or control in URL path")
    try:
        decoded = unquote(raw_path, encoding="utf-8", errors="strict")
    except UnicodeError as error:
        raise SiteError("URL", "invalid UTF-8 URL path") from error
    require(not ("%" in raw_path and any(p in (".", "..") for p in decoded.split("/"))),
            "URL", "encoded dot segment")
    base = policy["basePath"]
    relative = decoded
    if parts.scheme:
        relative = f"{parts.scheme}://{parts.netloc}{decoded}"
    joined = urlsplit(urljoin(f"{origin.scheme}://{origin.netloc}{base}{document}", relative))
    require((joined.scheme, joined.netloc) == (origin.scheme, origin.netloc)
            and joined.path.startswith(base), "URL", "hyperlink escapes the project site")
    path = joined.path[len(base):]
    if not path or path.endswith("/"):
        path += "index.html"
    portable_path(path)
    return path, decode_fragment(parts.fragment)


@dataclass(frozen=True)
class Configuration:
    policy: dict
    files: dict
    publication: dict
    controls: dict[str, Fingerprint]


def load_configuration(tree: SourceTree) -> Configuration:
    raw = {name: tree.read(name, MAX_METADATA_BYTES)
           for name in (POLICY, FILE_POLICY, PUBLICATION_POLICY)}
    policy, files, publication = (strict_json(raw[name])
                                  for name in (POLICY, FILE_POLICY, PUBLICATION_POLICY))
    object_keys(policy, {"schemaVersion", "audience", "sourceVisibility", "repository", "siteUrl",
                        "basePath", "packageSourceRole", "publicationPolicy", "filePolicy",
                        "limits", "supportingSources", "identityRetrieval",
                        "externalDependencies", "smoke"})
    require(policy["schemaVersion"] == 1 and policy["audience"] == "public"
            and policy["sourceVisibility"] == "public", "POLICY", "only the approved public-source site is supported")
    require(policy["publicationPolicy"] == PUBLICATION_POLICY and policy["filePolicy"] == FILE_POLICY,
            "POLICY", "policy cannot redirect input configuration")
    require(isinstance(policy["repository"], str), "POLICY", "repository URL must be a string")
    repository = re.fullmatch(r"https://github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+)", policy["repository"])
    require(repository is not None, "POLICY", "expected a plain GitHub repository URL")
    owner, project = repository.groups()
    validate_base_path(policy["basePath"])
    require(policy["basePath"] == f"/{project}/"
            and policy["siteUrl"] == f"https://{owner.lower()}.github.io/{project}/",
            "POLICY", "site URL must be the owner's exact HTTPS project site")
    object_keys(policy["limits"], {"files", "fileBytes", "metadataBytes", "siteBytes", "archiveBytes"})
    caps = {"files": MAX_FILES, "fileBytes": MAX_FILE_BYTES, "metadataBytes": MAX_METADATA_BYTES,
            "siteBytes": MAX_BYTES, "archiveBytes": MAX_BYTES}
    for key, maximum in caps.items():
        value = policy["limits"][key]
        require(type(value) is int and 0 < value <= maximum, "POLICY", "invalid resource limit")
    require(isinstance(publication, dict) and publication.get("schemaVersion") == 1,
            "POLICY", "missing publication policy")
    status = publication.get("publication", {})
    require(isinstance(status, dict) and all(isinstance(status.get(key), str)
            for key in ("status", "editorialOwnership", "rights")),
            "POLICY", "missing publication status and rights text")
    require(status.get("specStatus") == "unofficial" and status.get("publish") is False
            and "Independent" in status.get("status", "")
            and "Unassigned" in status.get("editorialOwnership", "")
            and "no new rights" in status.get("rights", ""),
            "POLICY", "independent-draft status and rights must remain explicit")
    approvals = status.get("releaseApprovals")
    object_keys(approvals, {"editors", "firstPartyLicense", "distribution", "publicIdentifiers"})
    require(all(v is False for v in approvals.values()), "POLICY", "this stager has no formal-release mode")
    require(isinstance(publication.get("sourceDate"), str)
            and re.fullmatch(r"\d{4}-\d{2}-\d{2}", publication["sourceDate"]) is not None
            and type(publication.get("sourceDateEpoch")) is int,
            "POLICY", "missing reproducible source date")
    object_keys(files, {"schemaVersion", "scope", "canonical", "files", "generated", "sourceAttribution"})
    require(files["schemaVersion"] == 1 and isinstance(files["files"], list)
            and isinstance(files["generated"], list) and all(isinstance(v, str) for v in files["generated"])
            and set(files["generated"]) == GENERATED
            and len(files["generated"]) == len(GENERATED),
            "POLICY", "unapproved generated output set")
    canonical = files["canonical"]
    object_keys(canonical, {"manifest", "roles", "membershipSha256", "membershipEncoding", "excluded"})
    require(canonical["manifest"] == "onvif/model-manifest.json"
            and isinstance(canonical["roles"], list) and all(isinstance(v, str) for v in canonical["roles"])
            and isinstance(canonical["excluded"], list)
            and set(canonical["roles"]) == CANONICAL_ROLES
            and len(canonical["roles"]) == len(CANONICAL_ROLES)
            and valid_sha(canonical["membershipSha256"]), "POLICY", "invalid canonical selection contract")
    require(isinstance(policy["supportingSources"], list), "POLICY", "missing supporting-source decisions")
    for item in policy["supportingSources"]:
        object_keys(item, {"document", "href", "sourcePath"})
        portable_path(item["sourcePath"])
        require(item["document"] in ("av/index.html", "onvif/index.html"),
                "POLICY", "supporting-source document is not approved")
        target = resolve_link(item["document"], item["href"], policy)
        require(target is not None and target[0] == item["sourcePath"],
                "POLICY", "supporting-source decision does not match its original path")
    supporting_keys = [(item["document"], item["href"]) for item in policy["supportingSources"]]
    require(len(supporting_keys) == len(set(supporting_keys)), "POLICY", "duplicate supporting-source decision")
    require(isinstance(files["sourceAttribution"], list)
            and isinstance(policy["externalDependencies"], list)
            and isinstance(policy["identityRetrieval"], list)
            and isinstance(policy["smoke"], list) and bool(policy["smoke"]),
            "POLICY", "missing attribution, identity, or smoke policy")
    for item in files["sourceAttribution"]:
        object_keys(item, {"label", "url", "note"})
        require(isinstance(item["label"], str) and isinstance(item["note"], str),
                "POLICY", "source attribution must be text")
        validate_external_url(item["url"], https_only=True)
    for value in policy["externalDependencies"]:
        validate_external_url(value, https_only=True)
    require(isinstance(policy["packageSourceRole"], str), "POLICY", "missing source-role explanation")
    scan_private(policy["packageSourceRole"])
    return Configuration(policy, files, publication,
                         {name: Fingerprint(len(data), digest(data)) for name, data in raw.items()})


@dataclass(frozen=True)
class SourceItem:
    source: str
    path: str
    role: str
    logical_id: str | None = None
    dependencies: tuple[str, ...] = ()
    canonical_stamp: Fingerprint | None = None


@dataclass(frozen=True)
class Selection:
    items: dict[str, SourceItem]
    omitted: list[dict]


def select_sources(tree: SourceTree, config: Configuration) -> Selection:
    items = {}
    for record in config.files["files"]:
        object_keys(record, {"source", "path", "role"})
        portable_path(record["source"])
        admitted_path(record["path"])
        require(isinstance(record["role"], str)
                and record["role"] in CANONICAL_ROLES | {"specification", "canonical-manifest",
                                                   "complete-example", "notice"},
                "ALLOWLIST", "unknown public source role")
        require(record["source"] == record["path"]
                or (record["role"] == "notice" and record["path"].startswith("notices/")
                    and record["path"].endswith(".txt")),
                "ALLOWLIST", "only unchanged notices may have text-download aliases")
        require(record["path"] not in items, "ALLOWLIST", "duplicate explicit file")
        items[record["path"]] = SourceItem(**record)
    canonical = config.files["canonical"]
    manifest = strict_json(tree.read(canonical["manifest"], MAX_METADATA_BYTES))
    require(isinstance(manifest, dict) and isinstance(manifest.get("artifacts"), list),
            "CANONICAL", "canonical artifact records are missing")
    excluded = {}
    for entry in canonical["excluded"]:
        object_keys(entry, {"path", "role", "reason"})
        portable_path(entry["path"])
        require(entry["role"] == "informative-evidence" and entry["path"] not in excluded,
                "ALLOWLIST", "invalid informative omission")
        excluded[entry["path"]] = entry
    membership, omitted, seen_excluded, all_paths, all_ids = [], [], set(), [], set()
    for entry in manifest["artifacts"]:
        try:
            path, role, identity = entry["physicalPath"], entry["role"], entry["logicalId"]
            portable_path(path)
            validate_external_url(identity, https_only=True)
            require(identity not in all_ids, "CANONICAL", "duplicate canonical identity")
            all_ids.add(identity)
            all_paths.append(path)
            if path in excluded:
                require(role == excluded[path]["role"], "ALLOWLIST", "omission role changed")
                seen_excluded.add(path)
                omitted.append({"logicalId": identity, "role": role,
                                "reason": excluded[path]["reason"], "staged": False})
                continue
            admitted_path(path)
            require(role in canonical["roles"] and path not in items,
                    "ALLOWLIST", "unreviewed canonical role or duplicate source")
            require(valid_sha(entry["sha256"]) and type(entry["bytes"]) is int
                    and 0 <= entry["bytes"] <= config.policy["limits"]["fileBytes"],
                    "CANONICAL", "invalid canonical fingerprint")
            dependencies = entry["dependencies"]
            require(isinstance(dependencies, list) and all(isinstance(v, str) for v in dependencies),
                    "CANONICAL", "invalid canonical dependencies")
            membership.append({"path": path, "role": role, "logicalId": identity})
            items[path] = SourceItem(path, path, role, identity, tuple(dependencies),
                                     Fingerprint(entry["bytes"], entry["sha256"]))
        except (KeyError, TypeError) as error:
            raise SiteError("CANONICAL", "incomplete canonical artifact record") from error
    unique_paths(all_paths)
    require(seen_excluded == set(excluded), "ALLOWLIST", "reviewed omission disappeared")
    membership.sort(key=lambda row: row["path"])
    require(digest(canonical_bytes(membership)) == canonical["membershipSha256"],
            "ALLOWLIST", "canonical path/role/identity membership changed; explicit review is required")
    unique_paths([*items, *GENERATED])
    require(len(items) + len(GENERATED) <= config.policy["limits"]["files"],
            "SIZE", "public file count exceeds its limit")
    identities = {item.logical_id for item in items.values() if item.logical_id is not None}
    for record in config.policy["identityRetrieval"]:
        object_keys(record, {"logicalId", "path"})
        validate_external_url(record["logicalId"], https_only=True)
        require(record["path"] in items and record["logicalId"] not in identities,
                "ALLOWLIST", "invalid additional identity mapping")
        identities.add(record["logicalId"])
    for item in items.values():
        for dependency in item.dependencies:
            require(dependency in identities or dependency in config.policy["externalDependencies"],
                    "CANONICAL", "canonical dependency has no admitted retrieval mapping")
    for record in config.policy["smoke"]:
        object_keys(record, {"path", "requestPath", "contentTypes"}, {"title"})
        require(record["path"] in set(items) | GENERATED and record["path"] != "site-manifest.json",
                "POLICY", "smoke target is not an admitted payload")
        require(resolve_link("index.html", record["requestPath"], config.policy) == (record["path"], ""),
                "POLICY", "smoke request does not map to its admitted file")
        require(record["contentTypes"] in (["text/html"], ["application/json"], ["application/ld+json"]),
                "POLICY", "unexpected smoke content type")
        require(not record["path"].endswith(".html")
                or (isinstance(record.get("title"), str) and bool(record["title"])),
                "POLICY", "HTML smoke probes require exact titles")
    require(config.policy["smoke"][0]["path"] == "index.html"
            and {"av/index.html", "onvif/index.html"} <= {record["path"] for record in config.policy["smoke"]},
            "POLICY", "landing and both specifications must be smoke targets")
    return Selection(items, omitted)


SAFE_TAGS = set("""html head meta title style body main header footer div span h1 h2 h3 h4 h5 h6
p time details summary dl dt dd hr aside strong section code a nav ol li bdi ul cite sup sub em
figure svg desc g marker path circle rect text tspan foreignobject figcaption table caption
thead tr th tbody td tfoot defs pre abbr line symbol polygon polyline ellipse small blockquote
br b i u s kbd samp var wbr""".split())
VOID_TAGS = {"meta", "hr", "br", "wbr"}
CSS_ESCAPE = re.compile(r"\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?|\\([^\r\n])")
CSS_URL = re.compile(r"url\s*\(\s*(?:\"([^\"\r\n]*)\"|'([^'\r\n]*)'|([^)\s]*))\s*\)", re.I)


def css_links(value: str) -> list[str]:
    def unescape(match):
        if not match.group(1):
            return match.group(2)
        codepoint = int(match.group(1), 16)
        require(0 < codepoint <= 0x10FFFF and not 0xD800 <= codepoint <= 0xDFFF,
                "HTML_RESOURCE", "invalid CSS escape")
        return chr(codepoint)

    value = re.sub(r"\\\r?\n", "", value)
    value = CSS_ESCAPE.sub(unescape, value)
    value = re.sub(r"/\*.*?\*/", "", value, flags=re.S)
    scan_private(value)
    require("/*" not in value and re.search(
        r"@import|@namespace|expression\s*\(|behavior\s*:|-moz-binding|image-set\s*\(|(?:https?|file|data):|//",
        value, re.I) is None, "HTML_RESOURCE", "active or external CSS is forbidden")
    references = []
    for match in CSS_URL.finditer(value):
        target = next(v for v in match.groups() if v is not None)
        require(target.startswith("#") and len(target) > 1,
                "HTML_RESOURCE", "CSS resources must be same-document fragments")
        references.append(target)
    require(re.search(r"url\s*\(", CSS_URL.sub("", value), re.I) is None,
            "HTML_RESOURCE", "unparsed CSS resource")
    return references


@dataclass
class Anchor:
    href: str
    href_start: int
    href_end: int
    closing_start: int | None
    tag_index: int
    line: int
    column: int


class HTMLAudit(HTMLParser):
    def __init__(self, text: str):
        super().__init__(convert_charrefs=True)
        self.text = text
        self.lines = [0, *(match.end() for match in re.finditer("\n", text))]
        self.ids: set[str] = set()
        self.links: list[str] = []
        self.anchors: list[Anchor] = []
        self.stack: list[tuple[str, Anchor | None]] = []
        self.metadata: dict[str, str] = {}
        self.styles: list[str] = []
        self.title_parts: list[str] = []
        self.tag_index = self.csp_count = self.doctype_count = self.head_titles = self.h1_count = 0
        self.feed(text)
        self.close()
        require(not self.stack and self.csp_count == 1 and self.doctype_count == 1
                and self.head_titles == 1 and self.h1_count == 1,
                "HTML_STRUCTURE", "expected a complete script-free document, CSP, title, and one H1")
        for style in self.styles:
            self.links.extend(css_links(style))
        self.title = "".join(self.title_parts).strip()

    def character_offset(self) -> int:
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def handle_decl(self, decl):
        require(decl.lower() == "doctype html", "HTML_STRUCTURE", "unexpected HTML declaration")
        self.doctype_count += 1

    def handle_pi(self, data):
        fail("HTML_STRUCTURE", "processing instructions are forbidden")

    def unknown_decl(self, data):
        fail("HTML_STRUCTURE", "unknown declaration")

    def handle_starttag(self, tag, attributes):
        require(tag in SAFE_TAGS, "HTML_ACTIVE", "unapproved or executable HTML element")
        self.tag_index += 1
        attrs = dict(attributes)
        require(len(attrs) == len(attributes), "HTML_STRUCTURE", "duplicate HTML attribute")
        for name, value in attributes:
            require(not name.startswith("on") and name not in
                    {"src", "srcset", "srcdoc", "action", "formaction", "ping", "background",
                     "data", "poster", "codebase", "manifest", "is"},
                    "HTML_ACTIVE", "executable or externally loaded HTML attribute")
            if value is not None:
                scan_private(value)
            if name == "style":
                self.links.extend(css_links(value or ""))
            elif name in {"marker-start", "marker-mid", "marker-end", "fill", "stroke", "filter", "clip-path", "mask"}:
                self.links.extend(css_links(value or ""))
            elif name in {"aria-labelledby", "aria-describedby"}:
                self.links.extend("#" + target for target in (value or "").split())
        if "id" in attrs:
            identity = attrs["id"]
            require(bool(identity) and not CONTROL.search(identity) and identity not in self.ids,
                    "HTML_ID", "invalid or duplicate HTML ID")
            self.ids.add(identity)
        if tag == "meta":
            if "http-equiv" in attrs:
                require(attrs["http-equiv"].lower() == "content-security-policy"
                        and attrs.get("content") == CSP
                        and any(t == "head" for t, _ in self.stack),
                        "HTML_CSP", "unexpected or weakened HTML content security policy")
                self.csp_count += 1
            if "name" in attrs:
                require(attrs["name"] not in self.metadata, "HTML_STRUCTURE", "duplicate metadata name")
                self.metadata[attrs["name"]] = attrs.get("content", "")
        if tag == "title" and any(t == "head" for t, _ in self.stack):
            self.head_titles += 1
        if tag == "h1":
            self.h1_count += 1
        anchor = None
        for name in ("href", "xlink:href"):
            if name in attrs:
                value = attrs[name]
                require(isinstance(value, str), "HTML_STRUCTURE", "valueless hyperlink")
                if tag != "a":
                    require(tag in ("use", "image") and value.startswith("#"),
                            "HTML_RESOURCE", "non-navigation resources must be local SVG fragments")
                self.links.append(value)
                if tag == "a":
                    require(name == "href", "HTML_STRUCTURE", "unexpected anchor namespace")
                    raw = self.get_starttag_text()
                    matches = list(re.finditer(r"(?<![\w:-])href\s*=\s*([\"'])(.*?)\1", raw, re.I | re.S))
                    require(len(matches) == 1 and html.unescape(matches[0].group(2)) == value,
                            "HTML_STRUCTURE", "anchor href must be exactly one quoted attribute")
                    match = matches[0]
                    line, column = self.getpos()
                    anchor = Anchor(value, self.character_offset() + match.start(2),
                                    self.character_offset() + match.end(2), None,
                                    self.tag_index, line, column)
                    self.anchors.append(anchor)
        if tag not in VOID_TAGS:
            self.stack.append((tag, anchor))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        require(bool(self.stack) and self.stack[-1][0] == tag,
                "HTML_STRUCTURE", "malformed HTML element nesting")
        _, anchor = self.stack.pop()
        if anchor is not None:
            anchor.closing_start = self.character_offset()

    def handle_data(self, data):
        scan_private(data)
        if self.stack and self.stack[-1][0] == "style":
            self.styles.append(data)
        if self.stack and self.stack[-1][0] == "title" and any(t == "head" for t, _ in self.stack):
            self.title_parts.append(data)

    def handle_comment(self, data):
        scan_private(html.unescape(data))


def transform_html(data: bytes, name: str, tree: SourceTree, config: Configuration) -> tuple[bytes, list[dict]]:
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeError as error:
        raise SiteError("UTF8", "specification HTML must be UTF-8") from error
    audit = HTMLAudit(text)
    edits, records = [], []
    for item in config.policy["supportingSources"]:
        if item["document"] != name:
            continue
        matches = [anchor for anchor in audit.anchors if anchor.href == item["href"]]
        require(len(matches) == 1 and matches[0].closing_start is not None,
                "HTML_TRANSFORM", "approved supporting anchor must occur exactly once")
        anchor = matches[0]
        target = tree.read(item["sourcePath"])
        fragment = decode_fragment(urlsplit(item["href"]).fragment)
        if fragment:
            require(item["sourcePath"].endswith(".json"), "HTML_TRANSFORM", "unsupported source fragment")
            json_pointer(strict_json(target), fragment)
        suffix = " (supporting source" + (f"; JSON Pointer {fragment}" if fragment else "") + ")"
        href = f"{config.policy['repository']}/blob/{tree.head}/{quote(item['sourcePath'], safe='/')}"
        edits.append((anchor.href_start, anchor.href_end, html.escape(href, quote=True)))
        edits.append((anchor.closing_start, anchor.closing_start, html.escape(suffix)))
        records.append({
            "document": name, "sourceSha256": digest(data), "nodeStartTag": anchor.tag_index,
            "sourceLine": anchor.line, "sourceColumn": anchor.column,
            "sourceHrefByteOffset": len(text[:anchor.href_start].encode("utf-8")),
            "hrefBefore": anchor.href, "hrefAfter": href,
            "sourceFragment": fragment, "labelSuffix": suffix,
        })
    for start, end, replacement in sorted(edits, reverse=True):
        text = text[:start] + replacement + text[end:]
    result = text.encode("utf-8")
    HTMLAudit(text)
    return result, records


SITE_CSS = """\
:root { color-scheme: light dark; font: 17px/1.6 system-ui, sans-serif; }
body { max-width: 76rem; margin: auto; padding: 1.4rem; background: #fff; color: #17212b; }
h1, h2 { line-height: 1.25; } a { color: #064b9c; }
a:focus-visible { outline: 3px solid #a83b00; outline-offset: 3px; }
code { font-family: ui-monospace, Consolas, monospace; overflow-wrap: anywhere; }
nav a { display: inline-block; margin: .3rem 1rem .3rem 0; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: .55rem; border: 1px solid #aeb9c2; text-align: left; overflow-wrap: anywhere; }
.notice { border-left: .3rem solid #7b4400; padding: 1rem; background: #fff5e4; }
.table-panel { max-width: 100%; overflow: auto; } footer { margin-top: 2rem; }
@media (prefers-color-scheme: dark) {
        body { background: #15191e; color: #edf1f5; } a { color: #94caff; }
        .notice { background: #30281a; border-color: #e4ba70; }
}
@media (max-width: 600px) { body { padding: .8rem; } th, td { padding: .35rem; } }
@media print { body { max-width: none; color: #000; background: #fff; } }
"""


def page(title: str, body: str, commit: str, mode: str) -> bytes:
    return (f"<!DOCTYPE html>\n<html lang=\"en\"><head>"
            f"<meta http-equiv=\"Content-Security-Policy\" content=\"{html.escape(CSP, quote=True)}\">"
            "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<meta name=\"source-commit\" content=\"{commit}\">"
            f"<meta name=\"site-provenance\" content=\"{mode}\">"
            f"<title>{html.escape(title)}</title><style>{SITE_CSS}</style></head>"
            f"<body><header><h1>{html.escape(title)}</h1></header><main>{body}</main>"
            f"<footer><p>Source commit: <code>{commit}</code>. "
            f"Provenance: <strong>{mode}</strong>.</p></footer></body></html>\n").encode("utf-8")


def rights_notice(config: Configuration, mode: str) -> str:
    publication = config.publication["publication"]
    preview = ("<p><strong>PREVIEW - uncommitted working-tree snapshot; not deployable.</strong></p>"
               if mode == "preview-uncommitted" else "")
    return (f"<aside class=\"notice\">{preview}<p><strong>Independent Editor's Draft.</strong> "
            "Not a W3C Recommendation, W3C group publication, ONVIF publication, or certification.</p>"
            f"<p>{html.escape(publication['editorialOwnership'])}. "
            f"{html.escape(publication['rights'])}</p>"
            "<p>Formal publication approvals remain false: editors, first-party license, "
            "distribution, and public identifiers. Public documentation hosting is a separate "
            "audience decision and grants no new rights.</p></aside>")


def identity_note() -> str:
    return ("Canonical namespace IRIs, model IDs, TD contexts, and embedded references are unchanged. "
            "The example.org identifiers remain provisional identities, not Pages retrieval URLs. "
            "Use artifact-map.json with an explicit document loader; hosting these copies does not "
            "make unchanged remote @context, tm:ref, or tm:extends identifiers dereference.")


def navigation(config: Configuration, selection: Selection, stamps: dict[str, Fingerprint],
               commit: str, mode: str) -> dict[str, bytes]:
    title = config.policy["smoke"][0].get("title", "WoT AV and ONVIF independent drafts")
    repository = html.escape(config.policy["repository"], quote=True)
    landing = (rights_notice(config, mode)
               + "<nav aria-label=\"Specifications and downloads\">"
               "<a href=\"av/\">AV specification</a><a href=\"onvif/\">ONVIF specification</a>"
               "<a href=\"download-index.html\">Complete download index</a>"
               "<a href=\"artifact-map.json\">Identity-to-retrieval map</a>"
               "<a href=\"site-manifest.json\">Site manifest</a></nav>"
               f"<p>Source date: <time datetime=\"{config.publication['sourceDate']}\">"
               f"{config.publication['sourceDate']}</time>. "
               f"<a href=\"{repository}\">Public GitHub source repository</a>.</p>"
               "<p>This Pages bundle is deliberately smaller than the public repository: "
               "specifications, the complete normative machine-artifact set, four selected "
               "complete examples, and applicable notices. It is not a source checkout or release.</p>"
               f"<p>{html.escape(config.policy['packageSourceRole'])}</p>"
               "<h2>Identifiers and retrieval</h2>"
               f"<p>{html.escape(identity_note())}</p>"
               "<p><a href=\"av/context.jsonld\">AV context</a> and "
               "<a href=\"onvif/context.jsonld\">ONVIF context</a> are available as explicit downloads. "
               "The complete index includes every selected model, schema, catalog, vocabulary, and example.</p>")
    rows = []
    for path, item in sorted(selection.items.items()):
        stamp = stamps[path]
        rows.append(f"<tr><td><a href=\"{html.escape(quote(path, safe='/'))}\">{html.escape(path)}</a></td>"
                    f"<td>{html.escape(item.role)}</td><td>{stamp.bytes}</td>"
                    f"<td><code>{stamp.sha256}</code></td></tr>")
    citations = "".join(f"<li><a href=\"{html.escape(item['url'], quote=True)}\">"
                        f"{html.escape(item['label'])}</a>: {html.escape(item['note'])}</li>"
                        for item in config.files["sourceAttribution"])
    downloads = (rights_notice(config, mode)
                 + "<p><a href=\"index.html\">Site home</a> | "
                 "<a href=\"artifact-map.json\">Machine-readable retrieval map</a></p>"
                 f"<p>{html.escape(identity_note())}</p>"
                 "<p>The canonical model manifest is copied unchanged, including its informative "
                 "coverage entry. That informative evidence is not staged; it is explicitly marked "
                 "as omitted in the retrieval map, not offered as a broken download.</p>"
                 "<p>Notice downloads retain their original bytes. Original HTML notices are served "
                 "with a .txt suffix as inert source text, not executed or restyled web pages. "
                 "The ONVIF contributor agreement is not a blanket license for this project.</p>"
                 "<div class=\"table-panel\"><table><caption>Approved public downloads</caption>"
                 "<thead><tr><th scope=\"col\">Path</th><th scope=\"col\">Role</th>"
                 "<th scope=\"col\">Bytes</th><th scope=\"col\">SHA-256</th></tr></thead>"
                 f"<tbody>{''.join(rows)}</tbody></table></div>"
                 f"<h2>Source-specific attribution</h2><ul>{citations}</ul>"
                 "<p>No original upstream XML, reference-only profile PDF, fetch-only legacy input, "
                 "SDK, native binary, or unrelated license collection is included.</p>")
    mappings = []
    for path, item in sorted(selection.items.items()):
        if item.logical_id is not None:
            mappings.append({"logicalId": item.logical_id, "path": path,
                             "retrievalPath": config.policy["basePath"] + quote(path, safe="/"),
                             "role": item.role, "bytes": stamps[path].bytes,
                             "sha256": stamps[path].sha256, "dependencies": list(item.dependencies)})
    for item in config.policy["identityRetrieval"]:
        path = item["path"]
        mappings.append({"logicalId": item["logicalId"], "path": path,
                         "retrievalPath": config.policy["basePath"] + quote(path, safe="/"),
                         "role": selection.items[path].role, "bytes": stamps[path].bytes,
                         "sha256": stamps[path].sha256, "dependencies": []})
    mappings.sort(key=lambda item: item["logicalId"])
    return {
        ".nojekyll": b"",
        "index.html": page(title, landing, commit, mode),
        "download-index.html": page("Public document download index", downloads, commit, mode),
        "artifact-map.json": json_bytes({"schemaVersion": 1, "basePath": config.policy["basePath"],
                                         "identityPolicy": identity_note(), "artifacts": mappings,
                                         "omitted": selection.omitted}),
    }


def generated_role(path: str) -> str:
    return "navigation" if path.endswith(".html") else "site-metadata"


def manifest_content_sha(manifest: dict) -> str:
    return digest(canonical_bytes({key: value for key, value in manifest.items() if key != "contentSha256"}))


@dataclass
class SitePlan:
    tree: SourceTree
    config: Configuration
    selection: Selection
    stamps: dict[str, Fingerprint]
    replacements: dict[str, bytes]
    manifest: dict

    @property
    def content_sha256(self) -> str:
        return self.manifest["contentSha256"]


CertificateReader = Callable[[SourceTree, str | None], SourceCertificate]


def make_plan(root: Path, base_path: str, *, preview: bool = False, expected_commit: str | None = None,
              node: str | None = None, certificate_reader: CertificateReader = committed_certificate) -> SitePlan:
    tree = SourceTree(root)
    if expected_commit is not None:
        require(valid_commit(expected_commit) and tree.head == expected_commit,
                "SOURCE_COMMIT", "HEAD does not match the expected source commit")
    config = load_configuration(tree)
    require(validate_base_path(base_path) == config.policy["basePath"],
            "BASE_PATH", "base path differs from the approved project site")
    selection = select_sources(tree, config)
    certificate = certificate_reader(tree, node)
    require(isinstance(certificate, SourceCertificate) and certificate.source_commit == tree.head,
            "STALE_CERTIFICATE", "source certificate does not describe HEAD")
    controls = dict(config.controls)
    controls[STAGER] = tree.stamp(STAGER)
    for entry in config.policy["supportingSources"]:
        controls[entry["sourcePath"]] = tree.stamp(entry["sourcePath"])
    require(bool(certificate.proofs), "SOURCE_PROOF", "certificate has no checked proof inputs")
    if not preview:
        tree.require_committed(set(certificate.files) | set(certificate.proofs) | set(controls)
                               | {item.source for item in selection.items.values()})
    originals, stamps, replacements, transformations = {}, {}, {}, []
    for path, item in sorted(selection.items.items()):
        stamp = tree.stamp(item.source)
        require(certificate.files.get(item.source) == stamp,
                "STALE_CERTIFICATE", f"selected source lacks a matching verified certificate: {path}")
        if item.canonical_stamp is not None:
            require(item.canonical_stamp == stamp, "CANONICAL", f"canonical artifact bytes differ: {path}")
        validate_data_file(tree.path(item.source), path, config.policy["limits"]["fileBytes"])
        originals[path] = stamp
        stamps[path] = stamp
        if item.role == "specification":
            original = tree.read(item.source)
            require(Fingerprint(len(original), digest(original)) == stamp,
                    "STALE_CERTIFICATE", "HTML changed after source certification")
            output, changes = transform_html(original, path, tree, config)
            replacements[path] = output
            stamps[path] = Fingerprint(len(output), digest(output))
            transformations.extend(changes)
    require(len(transformations) == len(config.policy["supportingSources"]),
            "HTML_TRANSFORM", "not every approved supporting anchor was transformed")
    mode = "preview-uncommitted" if preview else "committed"
    replacements.update(navigation(config, selection, stamps, tree.head, mode))
    for path, data in replacements.items():
        require(len(data) <= config.policy["limits"]["fileBytes"],
                "SIZE", "generated public file exceeds its limit")
        stamps[path] = Fingerprint(len(data), digest(data))
    snapshot = [{"path": path, "bytes": value.bytes, "sha256": value.sha256}
                for path, value in sorted(originals.items())]
    records = [{"path": path, "role": selection.items[path].role if path in selection.items else generated_role(path),
                "bytes": stamp.bytes, "sha256": stamp.sha256}
               for path, stamp in sorted(stamps.items())]
    manifest = {
        "schemaVersion": 1, "sourceRepository": config.policy["repository"], "sourceVisibility": "public",
        "sourceCommit": tree.head, "basePath": base_path, "sourceDate": config.publication["sourceDate"],
        "provenance": {"mode": mode, "sourceSnapshotSha256": digest(canonical_bytes(snapshot))},
        "files": records, "transformations": transformations, "payloadBytes": sum(s.bytes for s in stamps.values()),
    }
    manifest["contentSha256"] = manifest_content_sha(manifest)
    metadata = json_bytes(manifest)
    require(len(metadata) <= config.policy["limits"]["metadataBytes"], "SIZE", "site manifest exceeds its limit")
    replacements["site-manifest.json"] = metadata
    stamps["site-manifest.json"] = Fingerprint(len(metadata), digest(metadata))
    require(sum(s.bytes for s in stamps.values()) < config.policy["limits"]["siteBytes"],
            "SIZE", "site reaches or exceeds its byte limit")
    for name, stamp in {**certificate.proofs, **controls}.items():
        require(tree.stamp(name) == stamp, "STALE_CERTIFICATE", "source control or proof changed during preparation")
    require(tree.git("rev-parse", "--verify", "HEAD").decode("ascii").strip() == tree.head,
            "SOURCE_COMMIT", "HEAD changed during preparation")
    return SitePlan(tree, config, selection, stamps, replacements, manifest)


def outside_repository(path: Path, root: Path) -> Path:
    require(".." not in path.parts, "OUTPUT", "output path contains parent traversal")
    path, root = path.absolute(), root.absolute()
    try:
        common = Path(os.path.commonpath((path, root)))
    except ValueError:
        common = None
    require(common not in (path, root), "OUTPUT", "site must be outside the repository and its ancestors")
    return path


def write_new(path: Path, chunks: Iterator[bytes], expected: Fingerprint) -> None:
    check_ancestors(path, missing_leaf=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags, 0o644)
    count, hasher = 0, hashlib.sha256()
    with os.fdopen(descriptor, "wb") as output:
        for chunk in chunks:
            count += len(chunk)
            require(count <= expected.bytes, "RACE", "source grew while copying")
            output.write(chunk)
            hasher.update(chunk)
    require(Fingerprint(count, hasher.hexdigest()) == expected, "RACE", "copied bytes differ from verified source")


def source_chunks(path: Path, limit: int) -> Iterator[bytes]:
    with regular_reader(path, limit) as stream:
        while chunk := stream.read(CHUNK):
            yield chunk


def parent_paths(paths: set[str]) -> set[str]:
    return {"/".join(path.split("/")[:end])
            for path in paths for end in range(1, len(path.split("/")))}


def inspect_site(site: Path, plan: SitePlan) -> None:
    check_ancestors(site)
    allowed = set(plan.stamps)
    directories = parent_paths(allowed)
    actual, total = {}, 0
    pending = [(site, "")]
    while pending:
        directory, prefix = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                name = prefix + entry.name
                portable_path(name)
                path = directory / entry.name
                check_ancestors(path)
                info = path.lstat()
                if stat.S_ISDIR(info.st_mode):
                    require(name in directories, "SITE_MEMBERS", "unexpected site directory")
                    pending.append((path, name + "/"))
                else:
                    require(name in allowed and name not in actual, "SITE_MEMBERS", "unexpected site file")
                    stamp = fingerprint(path, plan.config.policy["limits"]["fileBytes"])
                    total += stamp.bytes
                    require(total < plan.config.policy["limits"]["siteBytes"], "SIZE", "site byte limit exceeded")
                    actual[name] = stamp
                    require(stamp == plan.stamps[name], "SITE_DIGEST", f"site bytes differ from approved source: {name}")
    require(actual == plan.stamps, "SITE_MEMBERS", "missing approved public file")
    unique_paths(list(actual))
    audits, json_documents = {}, {}
    for name in sorted(actual):
        path = site.joinpath(*name.split("/"))
        validate_data_file(path, name, plan.config.policy["limits"]["fileBytes"])
        if name.endswith(".html"):
            audits[name] = HTMLAudit(read_bytes(path).decode("utf-8"))
    for document, audit in audits.items():
        for href in audit.links:
            target = resolve_link(document, href, plan.config.policy)
            if target is None:
                continue
            name, fragment = target
            require(name in actual, "LOCAL_LINK", f"local hyperlink has no staged target: {name}")
            if not fragment:
                continue
            if name.endswith(".html"):
                require(fragment in audits[name].ids, "HTML_FRAGMENT", f"missing fragment in {name}")
            elif name.endswith((".json", ".jsonld")):
                if name not in json_documents:
                    json_documents[name] = strict_json(read_bytes(site.joinpath(*name.split("/"))))
                json_pointer(json_documents[name], fragment)
            else:
                fail("FRAGMENT", "fragment target has no supported local fragment semantics")
    for probe in plan.config.policy["smoke"]:
        if probe["path"].endswith(".html"):
            audit = audits[probe["path"]]
            require(audit.title == probe["title"], "HTML_TITLE", "staged specification title differs from policy")
            if probe["path"] == "index.html":
                require(audit.metadata.get("source-commit") == plan.manifest["sourceCommit"]
                        and audit.metadata.get("site-provenance") == plan.manifest["provenance"]["mode"],
                        "HTML_PROVENANCE", "landing provenance differs from the source plan")


def prepare(root: Path, base_path: str, output: Path, *, preview: bool = False,
            expected_commit: str | None = None, node: str | None = None,
            certificate_reader: CertificateReader = committed_certificate) -> SitePlan:
    output = outside_repository(output, root)
    check_ancestors(output, missing_leaf=True)
    require(not output.exists(), "OUTPUT", "staging output must be a new directory; nothing is overwritten")
    plan = make_plan(root, base_path, preview=preview, expected_commit=expected_commit,
                     node=node, certificate_reader=certificate_reader)
    output.mkdir(mode=0o700)
    for directory in sorted(parent_paths(set(plan.stamps)), key=lambda value: (value.count("/"), value)):
        target = output.joinpath(*directory.split("/"))
        check_ancestors(target, missing_leaf=True)
        target.mkdir(mode=0o755)
    for name in sorted(plan.stamps, key=lambda value: (value == "site-manifest.json", value)):
        target = output.joinpath(*name.split("/"))
        if name in plan.replacements:
            chunks = iter((plan.replacements[name],))
        else:
            chunks = source_chunks(plan.tree.path(plan.selection.items[name].source),
                                   plan.config.policy["limits"]["fileBytes"])
        write_new(target, chunks, plan.stamps[name])
    inspect_site(output, plan)
    return plan


def check(root: Path, site: Path, *, node: str | None = None,
          certificate_reader: CertificateReader = committed_certificate,
          deployable: bool = False) -> SitePlan:
    site = outside_repository(site, root)
    manifest = strict_json(read_bytes(site / "site-manifest.json", MAX_METADATA_BYTES))
    require(isinstance(manifest, dict), "MANIFEST", "site manifest must be an object")
    require(isinstance(manifest.get("provenance"), dict), "MANIFEST", "missing site provenance")
    mode = manifest["provenance"].get("mode")
    require(mode in ("committed", "preview-uncommitted"), "MANIFEST", "unknown provenance mode")
    require(not deployable or mode == "committed", "PREVIEW", "preview artifacts cannot be uploaded or deployed")
    plan = make_plan(root, manifest.get("basePath"), preview=mode == "preview-uncommitted",
                     expected_commit=manifest.get("sourceCommit"), node=node, certificate_reader=certificate_reader)
    require(manifest == plan.manifest, "MANIFEST", "manifest differs from the independently reconstructed source plan")
    inspect_site(site, plan)
    return plan


def tar_name(value: str, *, metadata: bool = False) -> str:
    # GNU tar's root-directory PAX marker is metadata, never a payload path.
    if metadata and value in ("././@PaxHeader", "./@PaxHeader", "./PaxHeaders/."):
        return "@PaxHeader"
    # A GNU PAX marker can be truncated at the 100-byte header name boundary.
    if (metadata and value.startswith("./") and len(value.encode("utf-8")) == 100
            and value.endswith(".") and value.split("/")[-2] == "PaxHeaders"):
        portable_path(value[2:-1], hidden=True)
        return "@PaxHeader"
    if value in (".", "./"):
        return ""
    if value.startswith("./"):
        value = value[2:]
    if value.endswith("/"):
        value = value[:-1]
    return portable_path(value, hidden=metadata)


def exact_read(stream: BinaryIO, count: int) -> bytes:
    require(0 <= count <= CHUNK, "ARCHIVE_SIZE", "unbounded archive metadata read")
    data = stream.read(count)
    require(len(data) == count, "ARCHIVE_TRUNCATED", "truncated archive")
    return data


def pax_fields(data: bytes) -> dict[str, str]:
    allowed = {"path", "size", "mtime", "atime", "ctime", "uid", "gid", "uname", "gname"}
    result, offset = {}, 0
    while offset < len(data):
        separator = data.find(b" ", offset)
        require(separator > offset, "ARCHIVE_PAX", "invalid PAX record length")
        length_text = data[offset:separator]
        require(length_text.isdigit() and len(length_text) < 8, "ARCHIVE_PAX", "invalid PAX length")
        length = int(length_text)
        end = offset + length
        require(separator + 1 < end <= len(data) and data[end - 1:end] == b"\n",
                "ARCHIVE_PAX", "truncated PAX record")
        record = data[separator + 1:end - 1]
        require(b"=" in record, "ARCHIVE_PAX", "missing PAX key")
        try:
            key, value = (part.decode("utf-8", errors="strict") for part in record.split(b"=", 1))
        except UnicodeError as error:
            raise SiteError("ARCHIVE_PAX", "invalid UTF-8 PAX metadata") from error
        require(key in allowed and key not in result and "\0" not in value,
                "ARCHIVE_PAX", "duplicate or unapproved PAX metadata")
        if key == "path":
            tar_name(value)
        elif key == "size":
            require(value.isdigit() and len(value) <= 10 and int(value) < MAX_BYTES,
                    "ARCHIVE_SIZE", "invalid PAX payload size")
        elif key in {"uid", "gid"}:
            require(value.isdigit() and len(value) <= 20,
                    "ARCHIVE_PAX", "invalid PAX owner identifier")
        elif key in {"mtime", "atime", "ctime"}:
            require(re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", value) is not None and len(value) <= 40,
                    "ARCHIVE_PAX", "invalid PAX numeric metadata")
        else:
            require(re.fullmatch(r"[A-Za-z0-9_.-]{0,128}", value) is not None,
                    "ARCHIVE_PAX", "unsafe PAX owner metadata")
        result[key] = value
        offset = end
    return result


def inspect_archive(archive: Path, plan: SitePlan) -> None:
    require(plan.manifest["provenance"]["mode"] == "committed", "PREVIEW",
            "preview artifacts cannot be uploaded or deployed")
    allowed, directories = set(plan.stamps), parent_paths(set(plan.stamps)) | {""}
    seen, seen_directories, local_pax, global_pax = set(), set(), {}, {}
    count = total = 0
    with regular_reader(archive, plan.config.policy["limits"]["archiveBytes"] - 1) as stream:
        while True:
            block = exact_read(stream, 512)
            if block == bytes(512):
                require(exact_read(stream, 512) == bytes(512), "ARCHIVE_END", "missing second tar end marker")
                require(not local_pax, "ARCHIVE_PAX", "orphaned PAX metadata")
                while trailing := stream.read(CHUNK):
                    require(not any(trailing), "ARCHIVE_END", "nonzero data after tar end markers")
                break
            count += 1
            require(count <= plan.config.policy["limits"]["files"] * 4,
                    "ARCHIVE_SIZE", "archive header count exceeds its limit")
            try:
                info = tarfile.TarInfo.frombuf(block, "utf-8", "strict")
            except (tarfile.HeaderError, UnicodeError, ValueError) as error:
                raise SiteError("ARCHIVE_HEADER", "invalid tar header or checksum") from error
            require(0 <= info.size < plan.config.policy["limits"]["siteBytes"],
                    "ARCHIVE_SIZE", "tar size reaches or exceeds its limit")
            if info.type in (tarfile.XHDTYPE, tarfile.XGLTYPE):
                tar_name(info.name, metadata=True)
                require(info.size <= CHUNK, "ARCHIVE_PAX", "PAX header exceeds its metadata bound")
                fields = pax_fields(exact_read(stream, info.size))
                require(not any(exact_read(stream, -info.size % 512)),
                        "ARCHIVE_PADDING", "nonzero PAX padding")
                if info.type == tarfile.XGLTYPE:
                    require(not ({"path", "size"} & fields.keys()), "ARCHIVE_PAX", "global PAX cannot rename payloads")
                    global_pax.update(fields)
                else:
                    require(not local_pax, "ARCHIVE_PAX", "stacked local PAX headers")
                    local_pax = fields
                continue
            require(info.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE)
                    and not info.linkname and not info.issparse(),
                    "ARCHIVE_TYPE", "links, sparse files, devices, and extension payloads are forbidden")
            tar_name(info.name)
            effective = {**global_pax, **local_pax}
            name = tar_name(effective.get("path", info.name))
            size = int(effective.get("size", info.size))
            local_pax = {}
            if info.type == tarfile.DIRTYPE:
                require(size == 0 and name in directories and name not in seen_directories,
                        "ARCHIVE_MEMBERS", "unexpected, duplicated, or nonempty tar directory")
                seen_directories.add(name)
                continue
            require(name in allowed and name not in seen, "ARCHIVE_MEMBERS", "unexpected or duplicate tar payload")
            expected = plan.stamps[name]
            require(size == expected.bytes, "ARCHIVE_SIZE", "tar size differs from the verified stage")
            total += size
            require(total < plan.config.policy["limits"]["siteBytes"], "ARCHIVE_SIZE", "tar payload exceeds site limit")
            remaining, hasher = size, hashlib.sha256()
            while remaining:
                chunk = exact_read(stream, min(CHUNK, remaining))
                hasher.update(chunk)
                remaining -= len(chunk)
            require(hasher.hexdigest() == expected.sha256, "ARCHIVE_DIGEST", "tar bytes differ from the verified stage")
            require(not any(exact_read(stream, -size % 512)), "ARCHIVE_PADDING", "nonzero tar payload padding")
            seen.add(name)
    require(seen == allowed, "ARCHIVE_MEMBERS", "archive is missing approved payloads")


def verify_archive(root: Path, archive: Path, site: Path, *, node: str | None = None,
                   certificate_reader: CertificateReader = committed_certificate) -> SitePlan:
    plan = check(root, site, node=node, certificate_reader=certificate_reader, deployable=True)
    inspect_archive(archive, plan)
    return plan


def validate_public_manifest(manifest: object, config: Configuration, selection: Selection,
                             expected_commit: str, content_sha: str) -> dict[str, Fingerprint]:
    object_keys(manifest, {"schemaVersion", "sourceRepository", "sourceVisibility", "sourceCommit",
                           "basePath", "sourceDate", "provenance", "files", "transformations",
                           "payloadBytes", "contentSha256"})
    require(manifest["schemaVersion"] == 1 and manifest["sourceRepository"] == config.policy["repository"]
            and manifest["sourceVisibility"] == "public" and manifest["sourceCommit"] == expected_commit
            and manifest["basePath"] == config.policy["basePath"]
            and manifest["sourceDate"] == config.publication["sourceDate"],
            "SMOKE_CONTENT", "served manifest identifies a different source or site")
    object_keys(manifest["provenance"], {"mode", "sourceSnapshotSha256"})
    require(manifest["provenance"]["mode"] == "committed"
            and valid_sha(manifest["provenance"]["sourceSnapshotSha256"]),
            "SMOKE_CONTENT", "served manifest is not committed deployment provenance")
    expected_paths = set(selection.items) | (GENERATED - {"site-manifest.json"})
    require(isinstance(manifest["files"], list) and len(manifest["files"]) == len(expected_paths),
            "SMOKE_CONTENT", "served file count differs from the trusted policy")
    paths, stamps, total = [], {}, 0
    for record in manifest["files"]:
        object_keys(record, {"path", "role", "bytes", "sha256"})
        name = admitted_path(record["path"])
        require(name in expected_paths and type(record["bytes"]) is int
                and 0 <= record["bytes"] <= config.policy["limits"]["fileBytes"]
                and valid_sha(record["sha256"]), "SMOKE_CONTENT", "unapproved served file metadata")
        role = selection.items[name].role if name in selection.items else generated_role(name)
        require(record["role"] == role, "SMOKE_CONTENT", "served role differs from the policy")
        paths.append(name)
        stamps[name] = Fingerprint(record["bytes"], record["sha256"])
        total += record["bytes"]
    unique_paths(paths)
    require(paths == sorted(paths) and set(paths) == expected_paths
            and type(manifest["payloadBytes"]) is int and total == manifest["payloadBytes"]
            and total < config.policy["limits"]["siteBytes"],
            "SMOKE_CONTENT", "served payload membership or total is invalid")
    require(isinstance(manifest["transformations"], list)
            and len(manifest["transformations"]) == len(config.policy["supportingSources"]),
            "SMOKE_CONTENT", "served presentation transformations differ from policy")
    approved = {(entry["document"], entry["href"]): entry for entry in config.policy["supportingSources"]}
    seen = set()
    for record in manifest["transformations"]:
        object_keys(record, {"document", "sourceSha256", "nodeStartTag", "sourceLine", "sourceColumn",
                             "sourceHrefByteOffset", "hrefBefore", "hrefAfter", "sourceFragment", "labelSuffix"})
        require(isinstance(record["document"], str) and isinstance(record["hrefBefore"], str),
                "SMOKE_CONTENT", "invalid served transformation key")
        key = (record["document"], record["hrefBefore"])
        require(key in approved and key not in seen and valid_sha(record["sourceSha256"]),
                "SMOKE_CONTENT", "unapproved served hyperlink transformation")
        seen.add(key)
        for name in ("nodeStartTag", "sourceLine", "sourceColumn", "sourceHrefByteOffset"):
            require(type(record[name]) is int and 0 <= record[name] <= MAX_FILE_BYTES,
                    "SMOKE_CONTENT", "invalid source position")
        entry = approved[key]
        fragment = decode_fragment(urlsplit(entry["href"]).fragment)
        suffix = " (supporting source" + (f"; JSON Pointer {fragment}" if fragment else "") + ")"
        require(record["sourceFragment"] == fragment and record["labelSuffix"] == suffix
                and record["hrefAfter"] == f"{config.policy['repository']}/blob/{expected_commit}/{quote(entry['sourcePath'], safe='/')}",
                "SMOKE_CONTENT", "served supporting-source target is not the approved pinned view")
    require(valid_sha(manifest["contentSha256"]) and manifest["contentSha256"] == content_sha
            and manifest_content_sha(manifest) == content_sha,
            "SMOKE_CONTENT", "served manifest content hash differs from the verified archive")
    return stamps


def smoke_origin(site_url: str, policy: dict, allow_test_origin: str | None) -> str:
    require(isinstance(site_url, str) and not CONTROL.search(site_url) and "\\" not in site_url
            and "%" not in site_url, "SMOKE_ORIGIN", "invalid site URL")
    try:
        parts = urlsplit(site_url)
        port = parts.port
    except ValueError as error:
        raise SiteError("SMOKE_ORIGIN", "invalid site authority") from error
    require(parts.username is None and parts.password is None and not parts.query and not parts.fragment,
            "SMOKE_ORIGIN", "site URL must not contain credentials, query, or fragment")
    origin = f"{parts.scheme}://{parts.netloc}"
    if allow_test_origin is None:
        expected = urlsplit(policy["siteUrl"])
        require(parts.scheme == "https" and parts.netloc == expected.netloc and port is None,
                "SMOKE_ORIGIN", "only the approved GitHub owner host may be requested")
    else:
        try:
            loopback = ipaddress.ip_address(parts.hostname).is_loopback
        except ValueError as error:
            raise SiteError("SMOKE_ORIGIN", "test origin requires a literal loopback address") from error
        require(origin == allow_test_origin and parts.scheme == "http" and loopback and port is not None,
                "SMOKE_ORIGIN", "test origin is not the explicitly owned loopback server")
    require(parts.path in (policy["basePath"], policy["basePath"][:-1]),
            "SMOKE_ORIGIN", "site URL is outside the approved project base path")
    return origin


def fetch_public(url: str, *, base_path: str, limit: int, deadline: float,
                 clock: Callable[[], float] = time.monotonic) -> tuple[bytes, str]:
    original = urlsplit(url)
    request_deadline = min(deadline, clock() + 10)
    for redirect in range(2):
        parts = urlsplit(url)
        remaining = request_deadline - clock()
        require(remaining > 0, "HTTP_UNAVAILABLE", "public request deadline expired")
        connection_class = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
        connection = connection_class(parts.hostname, parts.port, timeout=min(10, remaining))
        response = None
        try:
            target = parts.path + ("?" + parts.query if parts.query else "")
            connection.request("GET", target, headers={
                "Accept": "text/html, application/json, application/ld+json",
                "Accept-Encoding": "identity", "Cache-Control": "no-cache", "Pragma": "no-cache",
                "User-Agent": "wot-public-site-smoke/1",
            })
            transport = connection.sock
            if transport is not None:
                remaining = request_deadline - clock()
                require(remaining > 0, "HTTP_UNAVAILABLE", "public request deadline expired")
                transport.settimeout(min(10, remaining))
            response = connection.getresponse()
            if response.status in (301, 308):
                location = response.getheader("Location", "")
                require(not CONTROL.search(location) and "\\" not in location and "%" not in location,
                        "SMOKE_REDIRECT", "unsafe public redirect")
                destination = urlsplit(urljoin(url, location))
                require(redirect == 0 and (destination.scheme, destination.netloc) == (original.scheme, original.netloc)
                        and not parts.path.endswith("/") and destination.path == parts.path + "/"
                        and destination.path.startswith(base_path)
                        and destination.query in ("", original.query) and not destination.fragment,
                        "SMOKE_REDIRECT", "only same-origin canonical trailing-slash redirects are permitted")
                url = f"{destination.scheme}://{destination.netloc}{destination.path}?{original.query}"
                continue
            require(response.status == 200, "HTTP_UNAVAILABLE", f"public endpoint returned HTTP {response.status}")
            require(response.getheader("Content-Encoding", "identity").lower() == "identity",
                    "SMOKE_CONTENT", "unexpected content encoding")
            length = response.getheader("Content-Length")
            if length is not None:
                require(length.isdigit() and len(length) < 12 and int(length) <= limit,
                        "SMOKE_CONTENT", "public response exceeds its expected byte bound")
            data = bytearray()
            while True:
                if response.isclosed():
                    break
                remaining = request_deadline - clock()
                require(remaining > 0, "HTTP_UNAVAILABLE", "public request deadline expired")
                if transport is not None:
                    transport.settimeout(min(10, remaining))
                chunk = response.read(min(CHUNK, limit + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
                require(len(data) <= limit, "SMOKE_CONTENT", "public body exceeds its byte bound")
            require(clock() < request_deadline, "HTTP_UNAVAILABLE", "public request deadline expired")
            return bytes(data), response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
        except (OSError, socket.timeout, http.client.HTTPException) as error:
            raise SiteError("HTTP_UNAVAILABLE", "public HTTP request failed or timed out") from error
        finally:
            if response is not None:
                response.close()
            connection.close()
    fail("SMOKE_REDIRECT", "redirect limit exceeded")


def smoke(root: Path, *, site_url: str, base_path: str, expected_commit: str, content_sha: str,
          allow_test_origin: str | None = None, deadline_seconds: float = 180,
          retry_seconds: float = 5, clock: Callable[[], float] = time.monotonic,
          sleep: Callable[[float], None] = time.sleep) -> str:
    require(valid_commit(expected_commit) and valid_sha(content_sha),
            "SMOKE_INPUT", "expected commit and archive content SHA-256 are required")
    require(0 < deadline_seconds <= 180 and 0 < retry_seconds <= 10,
            "SMOKE_INPUT", "invalid bounded smoke timing")
    tree = SourceTree(root)
    config = load_configuration(tree)
    require(validate_base_path(base_path) == config.policy["basePath"], "BASE_PATH", "smoke base path differs from policy")
    selection = select_sources(tree, config)
    origin = smoke_origin(site_url, config.policy, allow_test_origin)
    deadline, reached, last_code = clock() + deadline_seconds, False, "HTTP_UNAVAILABLE"
    while clock() < deadline:
        try:
            manifest_bytes, content_type = fetch_public(
                f"{origin}{base_path}site-manifest.json?content_sha256={content_sha}",
                base_path=base_path, limit=config.policy["limits"]["metadataBytes"], deadline=deadline, clock=clock)
            reached = True
            require(content_type == "application/json", "SMOKE_CONTENT", "site manifest is not served as JSON")
            manifest = strict_json(manifest_bytes)
            stamps = validate_public_manifest(manifest, config, selection, expected_commit, content_sha)
            for probe in config.policy["smoke"]:
                name = probe["path"]
                expected = stamps[name]
                body, content_type = fetch_public(
                    f"{origin}{base_path}{probe['requestPath']}?content_sha256={content_sha}",
                    base_path=base_path, limit=expected.bytes, deadline=deadline, clock=clock)
                require(content_type in probe["contentTypes"] and Fingerprint(len(body), digest(body)) == expected,
                        "SMOKE_CONTENT", f"public response does not match the verified payload: {name}")
                if name.endswith(".html"):
                    audit = HTMLAudit(body.decode("utf-8", errors="strict"))
                    require(audit.title == probe["title"], "SMOKE_CONTENT", "public document has an unexpected title")
                    if name == "index.html":
                        require(audit.metadata.get("source-commit") == expected_commit
                                and audit.metadata.get("site-provenance") == "committed",
                                "SMOKE_CONTENT", "public landing does not identify the committed deployment")
                else:
                    strict_json(body)
            require(clock() < deadline, "HTTP_UNAVAILABLE", "public verification deadline expired")
            return content_sha
        except SiteError as error:
            if error.code in {"SMOKE_REDIRECT", "SMOKE_ORIGIN", "SMOKE_INPUT"}:
                raise
            reached = reached or error.code != "HTTP_UNAVAILABLE"
            last_code = error.code
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(retry_seconds, remaining))
    code = "DEPLOYED_CONTENT_MISMATCH" if reached else "SITE_UNAVAILABLE"
    fail(code, f"public verification expired ({last_code}); deployment status is separate; no rollback was attempted")


def emit_digest(value: str, *, github_output: bool = False) -> None:
    require(valid_sha(value), "OUTPUT", "verified digest is malformed")
    line = f"content_sha256={value}\n"
    name = os.environ.get("GITHUB_OUTPUT") if github_output else None
    if name:
        output = Path(name)
        check_ancestors(output)
        before = output.lstat()
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == 0,
                "OUTPUT", "GITHUB_OUTPUT must be an empty single-link runner file")
        flags = os.O_WRONLY | os.O_APPEND | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(output, flags)
        with os.fdopen(descriptor, "wb") as stream:
            opened = os.fstat(stream.fileno())
            require((opened.st_dev, opened.st_ino, opened.st_size, opened.st_nlink)
                    == (before.st_dev, before.st_ino, 0, 1),
                    "OUTPUT", "GITHUB_OUTPUT changed before writing")
            stream.write(line.encode("ascii"))
    print(line, end="")


def smoke_environment() -> dict[str, str]:
    digests = [os.environ[name] for name in ("CONTENT_SHA", "EXPECTED_CONTENT_SHA", "EXPECTED_CONTENT_SHA256")
               if name in os.environ]
    require(len(set(digests)) <= 1, "SMOKE_INPUT", "content SHA environment values disagree")
    base = os.environ.get("BASE_PATH")
    configured = os.environ.get("SITE_BASE_PATH")
    if configured is not None:
        configured += "" if configured.endswith("/") else "/"
        require(base is None or base == configured, "SMOKE_INPUT", "base-path environment values disagree")
        base = configured if base is None else base
    return {"site_url": os.environ.get("SITE_URL", ""), "base_path": base or "",
            "expected_commit": os.environ.get("EXPECTED_COMMIT", ""), "content_sha": digests[0] if digests else ""}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("prepare")
    build.add_argument("--base-path", required=True)
    build.add_argument("--output", required=True, type=Path)
    build.add_argument("--preview", action="store_true")
    build.add_argument("--expected-commit")
    build.add_argument("--node")
    validate = commands.add_parser("check")
    validate.add_argument("--site", required=True, type=Path)
    validate.add_argument("--node")
    archive = commands.add_parser("verify-archive")
    archive.add_argument("--archive", required=True, type=Path)
    archive.add_argument("--site", required=True, type=Path)
    archive.add_argument("--node")
    commands.add_parser("smoke")
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "prepare":
            expected = arguments.expected_commit
            github_sha = os.environ.get("GITHUB_SHA")
            if github_sha is not None:
                require(valid_commit(github_sha) and (expected is None or expected == github_sha),
                        "SOURCE_COMMIT", "expected commit and GITHUB_SHA disagree or are invalid")
                expected = github_sha
            result = prepare(ROOT, arguments.base_path, arguments.output, preview=arguments.preview,
                             expected_commit=expected, node=arguments.node).content_sha256
        elif arguments.command == "check":
            result = check(ROOT, arguments.site, node=arguments.node).content_sha256
        elif arguments.command == "verify-archive":
            result = verify_archive(ROOT, arguments.archive, arguments.site, node=arguments.node).content_sha256
        else:
            result = smoke(ROOT, **smoke_environment())
        emit_digest(result, github_output=arguments.command == "verify-archive"
                    or (arguments.command == "prepare" and not arguments.preview))
        return 0
    except SiteError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, UnicodeError) as error:
        print(f"FILESYSTEM: local I/O or encoding failure ({type(error).__name__})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
