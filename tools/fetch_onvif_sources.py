"""Verify locked public ONVIF inputs offline; network retrieval is explicitly opt-in."""

from __future__ import annotations

import argparse
import copy
import hashlib
import http.client
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCK = ROOT / "bindings" / "onvif" / "sources.lock.json"
DEFAULT_PROFILES = ROOT / "bindings" / "onvif" / "catalog" / "profile-editions.json"
HOSTS = frozenset((
    "raw.githubusercontent.com", "www.onvif.org", "www.w3.org",
    "docs.oasis-open.org", "schemas.xmlsoap.org",
))
XML_KINDS = frozenset(("wsdl", "xsd", "xml"))
MAX_XML_BYTES = 2 * 1024 * 1024
MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_SOURCES = 128
FETCH_DEADLINE_SECONDS = 300
REQUEST_TIMEOUT_SECONDS = 15
XS = "{http://www.w3.org/2001/XMLSchema}"
WSDL = "{http://schemas.xmlsoap.org/wsdl/}"
ROOT_ELEMENTS = {
    "wsdl": WSDL + "definitions",
    "xsd": XS + "schema",
    "xml": "{http://docs.oasis-open.org/wsn/t-1}TopicNamespace",
}
IMPORT_KINDS = {
    XS + "import": "xsd:import",
    XS + "include": "xsd:include",
    XS + "redefine": "xsd:redefine",
    XS + "override": "xsd:override",
    WSDL + "import": "wsdl:import",
}
EXPECTED_PROFILES = {
    "A": ("1.0", "2017-06", 25),
    "C": ("1.0", "2013-12", 17),
    "D": ("1.0", "2021-06", 35),
    "G": ("1.1", "2025-10", 19),
    "M": ("1.1", "2024-03", 49),
    "S": ("1.3", "2019-11", 42),
    "T": ("1.0", "2018-09", 77),
}


class SourceError(ValueError):
    """A source, lock, or retrieval policy violation; never a successful fallback."""


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise SourceError(f"duplicate JSON member: {key}")
        result[key] = value
    return result


def _constant(value):
    raise SourceError(f"non-finite JSON number is forbidden: {value}")


def _read_json(path):
    try:
        with Path(path).open("rb") as stream:
            data = stream.read(MAX_XML_BYTES + 1)
        if len(data) > MAX_XML_BYTES:
            raise SourceError(f"JSON exceeds size limit: {path}")
        return json.loads(data, object_pairs_hook=_object, parse_constant=_constant)
    except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise SourceError(f"cannot read JSON {path}: {error}") from error


def _path_parts(relative):
    if not isinstance(relative, str) or not relative or len(relative) > 500:
        raise SourceError("invalid relative path")
    parts = relative.split("/")
    reserved = {"CON", "PRN", "AUX", "NUL"} | {
        f"{prefix}{number}" for prefix in ("COM", "LPT") for number in range(1, 10)
    }
    for part in parts:
        if (not re.fullmatch(r"[A-Za-z0-9_.-]+", part) or part in (".", "..")
                or part.endswith(".") or part.split(".")[0].upper() in reserved):
            raise SourceError(f"unsafe relative path: {relative}")
    return parts


def _safe_path(base, relative):
    base = Path(base).absolute()
    if base.is_symlink() or (hasattr(base, "is_junction") and base.is_junction()):
        raise SourceError(f"symlink or junction in source root: {base}")
    parts = _path_parts(relative)
    cursor = base
    for part in parts:
        cursor = cursor / part
        if cursor.is_symlink() or (hasattr(cursor, "is_junction") and cursor.is_junction()):
            raise SourceError(f"symlink or junction in source path: {cursor}")
    if not cursor.resolve().is_relative_to(base.resolve()):
        raise SourceError(f"source path escapes root: {relative}")
    return cursor


def _url(value, commit, *, fetch=True):
    if (not isinstance(value, str) or len(value) > 2048
            or any(ord(char) < 33 or ord(char) > 126 for char in value)
            or any(char in value for char in ("\\", "%", "?", "#"))):
        raise SourceError(f"unsafe source URL: {value!r}")
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise SourceError(f"invalid source URL: {value!r}") from error
    schemes = ("https",) if fetch else ("http", "https")
    if (parsed.scheme not in schemes or parsed.hostname not in HOSTS or port is not None
            or parsed.username is not None or parsed.password is not None
            or parsed.netloc != parsed.hostname or parsed.query or parsed.fragment
            or any(part in (".", "..") for part in parsed.path.split("/"))):
        raise SourceError(f"unapproved source URL: {value}")
    if parsed.hostname == "raw.githubusercontent.com":
        prefix = f"/onvif/specs/{commit}/"
        if not parsed.path.startswith(prefix):
            raise SourceError(f"source URL does not use locked ONVIF commit: {value}")
        upstream = parsed.path.removeprefix(prefix)
        if upstream != "LICENSE.md" and not upstream.startswith("wsdl/"):
            raise SourceError(f"source URL outside locked WSDL tree: {value}")
    return parsed


def parse_xml_metadata(data):
    """Read syntax and import declarations only; never load a schema, DTD, XSL, or entity."""
    if len(data) > MAX_XML_BYTES:
        raise SourceError("XML exceeds size limit")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeError as error:
        raise SourceError("source XML must use UTF-8") from error
    if "\x00" in text or re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", text, re.IGNORECASE):
        raise SourceError("DTDs and entities are forbidden in source XML")
    declaration = re.match(r"\s*<\?xml\b[^?]*encoding\s*=\s*['\"]([^'\"]+)", text)
    if declaration and declaration[1].lower() not in ("utf-8", "utf8", "us-ascii"):
        raise SourceError("source XML declares an unsupported encoding")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise SourceError(f"invalid source XML: {error}") from error
    if root.tag not in ROOT_ELEMENTS.values():
        raise SourceError(f"unsupported XML root: {root.tag}")
    imports, versions = [], set()
    stack = [(root, root.get("targetNamespace"), 0)]
    count = 0
    while stack:
        element, schema_namespace, depth = stack.pop()
        count += 1
        if count > 100000 or depth > 128:
            raise SourceError("source XML exceeds node/depth limit")
        if element.tag.startswith("{http://www.w3.org/2001/XInclude}"):
            raise SourceError("XInclude is forbidden in source XML")
        if "{http://www.w3.org/XML/1998/namespace}base" in element.attrib:
            raise SourceError("xml:base is not supported for locked source resolution")
        if element.tag == XS + "schema":
            schema_namespace = element.get("targetNamespace")
            if element.get("version") is not None:
                versions.add(element.get("version"))
        if element.tag in IMPORT_KINDS:
            imports.append({
                "kind": IMPORT_KINDS[element.tag],
                "namespace": element.get("namespace"),
                "location": element.get("schemaLocation", element.get("location")),
                "declaringNamespace": schema_namespace,
            })
        stack.extend((child, schema_namespace, depth + 1) for child in reversed(element))
    return {
        "rootElement": root.tag,
        "targetNamespace": root.get("targetNamespace"),
        "schemaVersions": sorted(versions),
        "imports": imports,
    }


class SourceRegistry:
    """The lock is the sole URL/import authority; namespaces alone are not file identities."""

    def __init__(self, lock):
        if (not isinstance(lock, dict) or type(lock.get("schemaVersion")) is not int
                or lock["schemaVersion"] != 1):
            raise SourceError("unsupported source-lock schemaVersion")
        self.lock = copy.deepcopy(lock)
        baseline = self.lock.get("baseline", {})
        if not isinstance(baseline, dict):
            raise SourceError("invalid immutable ONVIF baseline")
        self.commit = baseline.get("commit", "")
        if (baseline.get("repository") != "onvif/specs"
                or not isinstance(self.commit, str)
                or not re.fullmatch(r"[0-9a-f]{40}", self.commit)):
            raise SourceError("invalid immutable ONVIF baseline")
        records = self.lock.get("sources")
        if not isinstance(records, list) or not 1 <= len(records) <= MAX_SOURCES:
            raise SourceError("invalid source count")
        self.sources, self.urls = {}, {}
        paths, total = set(), 0
        for source in records:
            if not isinstance(source, dict):
                raise SourceError("invalid source record")
            identifier = source.get("id")
            if not isinstance(identifier, str) or not identifier or len(identifier) > 200:
                raise SourceError("invalid source id")
            if identifier in self.sources:
                raise SourceError(f"duplicate source id: {identifier}")
            self.sources[identifier] = source
            relative = source.get("relativePath")
            _path_parts(relative)
            if relative.casefold() in paths:
                raise SourceError(f"duplicate source path: {relative}")
            paths.add(relative.casefold())
            kind = source.get("kind")
            if not isinstance(kind, str) or kind not in XML_KINDS | {"pdf", "notice"}:
                raise SourceError(f"unsupported source kind: {identifier}")
            limit = MAX_XML_BYTES if kind in XML_KINDS else MAX_DOCUMENT_BYTES
            size = source.get("bytes")
            if type(size) is not int or not 0 < size <= limit:
                raise SourceError(f"invalid source byte limit: {identifier}")
            total += size
            if total > MAX_TOTAL_BYTES:
                raise SourceError("source set exceeds total byte limit")
            if not re.fullmatch(r"[0-9a-f]{64}", str(source.get("sha256", ""))):
                raise SourceError(f"invalid SHA-256: {identifier}")
            if source.get("storage") not in ("vendored", "fetch-only", "reference-only"):
                raise SourceError(f"invalid storage policy: {identifier}")
            permission = source.get("redistribution", {})
            if (not isinstance(permission, dict)
                    or permission.get("status") not in ("permitted-unchanged", "review-required")):
                raise SourceError(f"missing redistribution decision: {identifier}")
            if source["storage"] == "vendored" and permission["status"] != "permitted-unchanged":
                raise SourceError(f"uncleared redistribution in vendored source: {identifier}")
            for field in ("noticeIds", "requiredMarkers"):
                if (not isinstance(permission.get(field), list)
                        or not all(isinstance(item, str) and item for item in permission[field])):
                    raise SourceError(f"invalid notice requirements: {identifier}")
            url = source.get("url")
            _url(url, self.commit)
            aliases = source.get("aliases", [])
            if not isinstance(aliases, list):
                raise SourceError(f"invalid source URL aliases: {identifier}")
            for value in [url, *aliases]:
                _url(value, self.commit, fetch=value == url)
                if value in self.urls:
                    raise SourceError(f"duplicate source URL: {value}")
                self.urls[value] = identifier
            if kind in XML_KINDS:
                if (not isinstance(source.get("imports"), list)
                        or not isinstance(source.get("schemaVersions"), list)
                        or not all(isinstance(version, str) for version in source["schemaVersions"])
                        or not isinstance(source.get("targetNamespace"), str)):
                    raise SourceError(f"missing XML metadata: {identifier}")
                if source.get("rootElement") != ROOT_ELEMENTS[kind]:
                    raise SourceError(f"XML root/source kind mismatch: {identifier}")
            elif source.get("imports"):
                raise SourceError(f"non-XML source declares imports: {identifier}")
        groups = self.lock.get("sourceGroups", {})
        if not isinstance(groups, dict):
            raise SourceError("invalid source groups")
        for group, members in groups.items():
            if (not isinstance(members, list)
                    or not all(isinstance(member, str) and member in self.sources for member in members)):
                raise SourceError(f"unresolved source group: {group}")
        for source in self.sources.values():
            for notice_id in source["redistribution"]["noticeIds"]:
                if notice_id not in self.sources:
                    raise SourceError(f"unresolved notice dependency: {notice_id}")
                if self.sources[notice_id]["kind"] != "notice":
                    raise SourceError(f"notice dependency is not a notice: {notice_id}")
            for dependency in source.get("imports", []):
                self._check_import(source, dependency)

    def _check_import(self, source, dependency):
        if not isinstance(dependency, dict) or dependency.get("kind") not in IMPORT_KINDS.values():
            raise SourceError(f"invalid import record: {source['id']}")
        target_id = dependency.get("sourceId")
        if not isinstance(target_id, str) or target_id not in self.sources:
            raise SourceError(f"unresolved import dependency: {target_id} in {source['id']}")
        target = self.sources[target_id]
        location = dependency.get("location")
        if location is not None:
            if (not isinstance(location, str) or not location or location.startswith("//")
                    or any(char in location for char in ("\\", "%", "?", "#"))
                    or any(ord(char) < 33 for char in location)):
                raise SourceError(f"unsafe import location: {source['id']}")
            if urllib.parse.urlsplit(location).scheme:
                resolved = location
            else:
                resolved = urllib.parse.urljoin(source["url"], location)
                original = urllib.parse.urlsplit(source["url"])
                if original.hostname == "raw.githubusercontent.com":
                    required = f"https://raw.githubusercontent.com/onvif/specs/{self.commit}/wsdl/"
                    if not resolved.startswith(required):
                        raise SourceError(f"import escapes pinned source tree: {source['id']}")
            _url(resolved, self.commit, fetch=False)
            if self.urls.get(resolved) != target_id:
                raise SourceError(f"unresolved or mismatched import URL: {source['id']} -> {location}")
        elif dependency["kind"] != "xsd:import" or not dependency.get("namespace"):
            raise SourceError(f"import requires an explicit location: {source['id']}")
        expected_kind = "wsdl" if dependency["kind"] == "wsdl:import" else "xsd"
        if target["kind"] != expected_kind:
            raise SourceError(f"import target kind mismatch: {source['id']} -> {target_id}")
        namespace = dependency.get("namespace")
        if dependency["kind"] in ("xsd:include", "xsd:redefine", "xsd:override"):
            namespace = dependency.get("declaringNamespace")
        if namespace != target.get("targetNamespace"):
            raise SourceError(f"import namespace mismatch: {source['id']} -> {target_id}")

    def selected(self, scope="xml", source_ids=None):
        if scope not in ("xml", "vendored", "profiles", "all"):
            raise SourceError(f"unknown source scope: {scope}")
        if source_ids is not None:
            seeds = list(source_ids)
            if not seeds:
                raise SourceError("empty source selection")
        else:
            seeds = [
                key for key, source in self.sources.items()
                if scope == "all"
                or (scope == "xml" and source["kind"] in XML_KINDS)
                or (scope == "vendored" and source["storage"] == "vendored")
                or (scope == "profiles" and source["kind"] == "pdf")
            ]
        selected, pending = set(), list(seeds)
        while pending:
            key = pending.pop()
            if key not in self.sources:
                raise SourceError(f"unknown source id: {key}")
            if key in selected:
                continue
            selected.add(key)
            source = self.sources[key]
            pending.extend(source["redistribution"]["noticeIds"])
            pending.extend(item["sourceId"] for item in source.get("imports", []))
        return sorted(selected)

    def resolve_import(self, source_id, location, namespace):
        source = self.sources.get(source_id)
        if source is None:
            raise SourceError(f"unknown source id: {source_id}")
        matches = [
            item["sourceId"] for item in source.get("imports", [])
            if item["location"] == location and item["namespace"] == namespace
        ]
        if not matches or len(set(matches)) != 1:
            raise SourceError(f"unresolved or ambiguous import: {source_id} -> {location}")
        return self.sources[matches[0]]


def load_lock(path=DEFAULT_LOCK):
    return SourceRegistry(_read_json(path))


def _verify_bytes(source, data):
    identifier = source["id"]
    if len(data) != source["bytes"]:
        raise SourceError(f"byte length mismatch: {identifier}")
    if hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise SourceError(f"SHA-256 mismatch: {identifier}")
    for marker in source["redistribution"]["requiredMarkers"]:
        if marker.encode("utf-8") not in data:
            raise SourceError(f"required copyright/license notice missing: {identifier}")
    if source["kind"] in XML_KINDS:
        actual = parse_xml_metadata(data)
        for field in ("rootElement", "targetNamespace", "schemaVersions"):
            if actual[field] != source[field]:
                raise SourceError(f"XML metadata mismatch ({field}): {identifier}")
        expected = [{key: value for key, value in item.items() if key != "sourceId"}
                    for item in source["imports"]]
        if actual["imports"] != expected:
            raise SourceError(f"XML import declarations differ from lock: {identifier}")
    elif source["kind"] == "pdf" and not data.startswith(b"%PDF-"):
        raise SourceError(f"locked profile is not a PDF: {identifier}")


def _read_source(source, root, cache):
    candidates = []
    if source["storage"] == "vendored":
        candidates.append(_safe_path(root, "third_party/onvif/" + source["relativePath"]))
    if cache is not None:
        candidates.append(_safe_path(cache, source["relativePath"]))
    for path in candidates:
        if not path.exists():
            continue
        if not path.is_file():
            raise SourceError(f"source is not a regular file: {path}")
        with path.open("rb") as stream:
            data = stream.read(source["bytes"] + 1)
        _verify_bytes(source, data)
        return data
    return None


def verify_sources(registry, root=ROOT, *, cache=None, scope="xml", source_ids=None):
    selected = registry.selected(scope, source_ids)
    for identifier in selected:
        source = registry.sources[identifier]
        if _read_source(source, root, cache) is None:
            raise SourceError(
                f"missing locked source: {identifier} ({source['storage']}); "
                "supply its verified cache or explicitly use --fetch --cache"
            )
    return selected


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SourceError("source download redirect refused; review and relock the canonical URL")


def _download(source, deadline):
    request = urllib.request.Request(
        source["url"], headers={"Accept-Encoding": "identity", "User-Agent": "onvif-source-lock/1"},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SourceError("source fetch deadline exceeded")
    try:
        with opener.open(request, timeout=min(REQUEST_TIMEOUT_SECONDS, remaining)) as response:
            if response.status != 200 or response.geturl() != source["url"]:
                raise SourceError(f"unexpected HTTP status or redirect: {source['id']}")
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise SourceError(f"encoded source response refused: {source['id']}")
            declared = response.headers.get("Content-Length")
            if declared is not None and (
                not re.fullmatch(r"[0-9]+", declared) or int(declared) != source["bytes"]
            ):
                raise SourceError(f"HTTP byte length mismatch: {source['id']}")
            chunks, length = [], 0
            while True:
                if time.monotonic() >= deadline:
                    raise SourceError("source fetch deadline exceeded")
                chunk = response.read1(min(65536, source["bytes"] + 1 - length))
                if not chunk:
                    break
                chunks.append(chunk)
                length += len(chunk)
                if length > source["bytes"]:
                    raise SourceError(f"source download exceeds locked byte limit: {source['id']}")
            data = b"".join(chunks)
    except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as error:
        raise SourceError(f"source download failed: {source['id']}: {error}") from error
    _verify_bytes(source, data)
    return data


def _write_exact(base, relative, data):
    target = _safe_path(base, relative)
    if target.exists():
        if not target.is_file() or target.read_bytes() != data:
            raise SourceError(f"refusing to overwrite different source bytes: {target}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    _safe_path(base, relative)
    descriptor, temporary = tempfile.mkstemp(prefix=".onvif-source-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, target)
        except FileExistsError as error:
            raise SourceError(f"source destination appeared during copy: {target}") from error
    finally:
        Path(temporary).unlink(missing_ok=True)


def fetch_sources(registry, root, cache, *, allow_network=False, scope="xml", source_ids=None):
    if not allow_network or cache is None:
        raise SourceError("network fetch requires explicit consent and an explicit cache directory")
    if Path(cache).resolve().is_relative_to(Path(root).resolve()):
        raise SourceError("fetch cache must be outside the repository, not a publication directory")
    selected = registry.selected(scope, source_ids)
    deadline = time.monotonic() + FETCH_DEADLINE_SECONDS
    for identifier in selected:
        source = registry.sources[identifier]
        if _read_source(source, root, cache) is not None:
            continue
        data = _download(source, deadline)
        _write_exact(cache, source["relativePath"], data)
    return verify_sources(registry, root, cache=cache, scope=scope, source_ids=source_ids)


def export_sources(registry, root, destination, *, cache=None, scope="xml", source_ids=None):
    selected = registry.selected(scope, source_ids)
    for identifier in selected:
        if registry.sources[identifier]["redistribution"]["status"] != "permitted-unchanged":
            raise SourceError(f"redistribution review required; export refused: {identifier}")
    subset = {**registry.lock, "sources": [registry.sources[key] for key in selected]}
    if "sourceGroups" in subset:
        subset["sourceGroups"] = {
            group: [key for key in members if key in selected]
            for group, members in subset["sourceGroups"].items()
            if any(key in selected for key in members)
        }
    subset["exportSelection"] = {
        "completeBaseline": len(selected) == len(registry.sources),
        "sourceIds": selected,
    }
    files = {}
    for key in selected:
        source = registry.sources[key]
        data = _read_source(source, root, cache)
        if data is None:
            raise SourceError(f"missing locked source for export: {key}")
        files[source["relativePath"]] = data
    files["sources.lock.json"] = (json.dumps(subset, indent=4, ensure_ascii=True) + "\n").encode()
    for relative, data in files.items():
        target = _safe_path(destination, relative)
        if target.exists() and (not target.is_file() or target.read_bytes() != data):
            raise SourceError(f"export destination has different bytes: {target}")
    for relative, data in files.items():
        _write_exact(destination, relative, data)
    return selected


def validate_profile_catalog(path, registry):
    catalog = _read_json(path)
    if not isinstance(catalog, dict) or catalog.get("schemaVersion") != 1:
        raise SourceError("invalid profile catalog schemaVersion")
    profiles = catalog.get("profiles")
    if not isinstance(profiles, list) or len(profiles) != len(EXPECTED_PROFILES):
        raise SourceError("profile catalog must contain all seven released public profiles")
    seen = set()
    for profile in profiles:
        identifier = profile.get("profileId")
        if identifier in seen or identifier not in EXPECTED_PROFILES:
            raise SourceError(f"duplicate or unknown active profile: {identifier}")
        seen.add(identifier)
        expected = EXPECTED_PROFILES[identifier]
        if (profile.get("edition"), profile.get("documentDate"), profile.get("pageCount")) != expected:
            raise SourceError(f"profile edition metadata mismatch: {identifier}")
        if (profile.get("roles") != ["device", "client"]
                or profile.get("establishesProductConformance") is not False
                or profile.get("publicationState") != "released"):
            raise SourceError(f"profile roles/conformance scope mismatch: {identifier}")
        source = registry.sources.get(profile.get("documentSourceId"))
        if (source is None or source["kind"] != "pdf" or source["storage"] != "reference-only"
                or source["url"] != profile.get("documentUrl")
                or source["sha256"] != profile.get("documentSha256")
                or (source.get("edition"), source.get("documentDate"), source.get("pageCount")) != expected):
            raise SourceError(f"profile document source mismatch: {identifier}")
        anchors = profile.get("sourceAnchors")
        if not isinstance(anchors, list) or not anchors:
            raise SourceError(f"profile clause anchors missing: {identifier}")
        for anchor in anchors:
            if (not isinstance(anchor, dict) or not anchor.get("clause")
                    or type(anchor.get("pdfPage")) is not int
                    or not 1 <= anchor["pdfPage"] <= profile["pageCount"]
                    or "printedPage" not in anchor):
                raise SourceError(f"invalid profile source anchor: {identifier}")
    return catalog


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--check", action="store_true", help="offline verification (the default)")
    action.add_argument("--fetch", action="store_true", help="explicitly retrieve missing locked bytes into --cache")
    action.add_argument("--export", type=Path, metavar="DIRECTORY", help="offline export of a permission-cleared closure and notices")
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root for vendored sources")
    parser.add_argument("--cache", type=Path, help="explicit cache root; never automatically published")
    parser.add_argument("--scope", choices=("xml", "vendored", "profiles", "all"), default="xml")
    parser.add_argument("--source", action="append", dest="source_ids", help="locked source id; repeatable; dependencies included")
    args = parser.parse_args(argv)
    try:
        registry = load_lock(args.lock)
        if args.lock.resolve() == DEFAULT_LOCK.resolve():
            validate_profile_catalog(DEFAULT_PROFILES, registry)
        options = {"scope": args.scope, "source_ids": args.source_ids}
        if args.fetch:
            verified = fetch_sources(registry, args.root, args.cache, allow_network=True, **options)
        elif args.export is not None:
            verified = export_sources(registry, args.root, args.export, cache=args.cache, **options)
        else:
            verified = verify_sources(registry, args.root, cache=args.cache, **options)
        gates = [
            source["id"] for source in registry.sources.values()
            if source["redistribution"]["status"] == "review-required"
        ]
        print(json.dumps({
            "status": "verified-selected-sources",
            "scope": args.scope,
            "verifiedCount": len(verified),
            "verifiedSourceIds": verified,
            "redistributionReviewRequired": gates,
            "productConformanceClaim": False,
        }, indent=4))
        return 0
    except (SourceError, OSError) as error:
        print(f"ONVIF source error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
