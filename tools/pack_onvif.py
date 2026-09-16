"""Pack and prove the private ONVIF tarball in an explicit, unrelated Temp install."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    path.write_text(json.dumps(value, indent=4, ensure_ascii=True) + "\n", encoding="utf8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, required=True, help="New absolute named directory below the system Temp, outside the checkout")
    parser.add_argument("--allow-registry", action="store_true", help="Allow integrity-pinned npm downloads if the local cache is incomplete")
    parser.add_argument("--keep-install", action="store_true", help="Retain the owned node_modules and exported model directories for inspection")
    args = parser.parse_args()
    work = args.work_dir
    if (not work.is_absolute() or work.exists() or work.resolve().is_relative_to(ROOT)
            or not work.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve())
            or work.resolve() == Path(tempfile.gettempdir()).resolve()):
        parser.error("--work-dir must be a NEW named absolute directory below system Temp, outside the repository")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    node, openssl = shutil.which("node"), shutil.which("openssl")
    if not all((npm, node, openssl)):
        parser.error("Existing node, npm and openssl must be on PATH; this tool installs no tools or SDKs")
    work.mkdir(parents=True)
    pack = work / "pack"
    install = work / "install"
    keys = work / "ephemeral-keys"
    for path in (pack, install, keys):
        path.mkdir()
    environment = {key: value for key, value in os.environ.items() if key.upper() not in {"NODE_PATH", "NODE_OPTIONS"}}
    environment.update(NO_COLOR="1", npm_config_audit="false", npm_config_fund="false")
    commands = []

    def run(command, cwd, label, timeout=180):
        actual = command
        if os.name == "nt" and str(command[0]).lower().endswith((".cmd", ".bat")):
            if any(any(char in str(part) for char in '"%\r\n') for part in command):
                raise ValueError("Batch command arguments contain unsupported shell metacharacters")
            batch = " ".join('"' + str(part) + '"' for part in command)
            actual = '"' + os.environ["COMSPEC"] + '" /d /s /v:off /c "' + batch + '"'
        result = subprocess.run(actual, cwd=cwd, env=environment, capture_output=True, text=True, timeout=timeout)
        (work / (label + ".log")).write_text(result.stdout + result.stderr, encoding="utf8")
        commands.append({"command": [str(part) for part in command], "cwd": str(cwd), "exit": result.returncode, "log": label + ".log"})
        write_json(work / "commands.json", commands)
        if result.returncode:
            raise RuntimeError(f"{label} failed with exit {result.returncode}; see {work / (label + '.log')}")
        return result

    try:
        result = run([npm, "pack", "--workspace", "@wot-av/binding-onvif", "--pack-destination", str(pack), "--json"], ROOT, "npm-pack")
        # npm forwards prepack stdout before its top-level JSON array.
        packed_items = json.loads(result.stdout[result.stdout.rfind("\n[") + 1:])
        assert len(packed_items) == 1, "Exactly one local workspace package must be packed"
        packed = packed_items[0]
        tarball = pack / packed["filename"]
        data = tarball.read_bytes()
        assert packed["integrity"] == "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
        with tarfile.open(tarball, "r:gz") as archive:
            members = archive.getmembers()
            assert all(entry.isfile() for entry in members), "Tarball must contain regular files only"
            names = [entry.name.removeprefix("package/") for entry in members]
            assert len(names) == len(set(names)), "Duplicate package members"
            assert all(entry.name.startswith("package/") for entry in members)
            package_json = json.load(archive.extractfile("package/package.json"))
            provenance = json.load(archive.extractfile("package/dist/package-provenance.json"))
            flat = json.load(archive.extractfile("package/dist/catalog-data/manifest.json"))
            allowed = {"package.json", "NOTICE.md", "dist/package-provenance.json", "dist/catalog-data/manifest.json"}
            allowed.update("dist/" + entry["path"] for entry in provenance["files"])
            allowed.update("dist/catalog-data/" + entry["path"] for entry in flat["artifacts"])
            for source in (ROOT / "packages" / "binding-onvif" / "src").rglob("*.ts"):
                relative = source.relative_to(ROOT / "packages" / "binding-onvif" / "src").as_posix()[:-3]
                allowed.update(("dist/" + relative + ".js", "dist/" + relative + ".d.ts"))
            assert set(names) == allowed, f"Package allowlist mismatch: extra={set(names) - allowed}, missing={allowed - set(names)}"
            assert package_json["private"] is True and "license" not in package_json
            assert not set(package_json["scripts"]).intersection({"install", "postinstall", "preinstall"})
            assert provenance["canonicalArtifacts"] == 305 and provenance["sourceDocuments"] == 43
            source_lock = json.load(archive.extractfile("package/dist/source-documents/sources.lock.json"))
            for source in source_lock["sources"]:
                name = "dist/source-documents/" + source["relativePath"]
                if source["storage"] != "vendored":
                    assert name not in names, "Restricted/reference-only source bytes must not be bundled"
        write_json(work / "tarball-audit.json", {
            "tarball": str(tarball), "sha256": hashlib.sha256(data).hexdigest(), "integrity": packed["integrity"],
            "bytes": len(data), "unpackedBytes": packed["unpackedSize"], "files": len(names),
            "canonicalArtifacts": provenance["canonicalArtifacts"], "modelDocuments": provenance["modelDocuments"],
            "sourceDocuments": provenance["sourceDocuments"], "exactAllowlist": True,
            "nativeBinaries": 0, "fixtureFiles": 0, "fetchOnlyXmlFiles": 0, "filesWithPaths": names
        })

        dependency = "file:../pack/" + tarball.name
        package = {"name": "onvif-isolated-local-proof", "version": "0.0.0", "private": True,
            "dependencies": {"@wot-av/binding-onvif": dependency},
            "devDependencies": {name: package_json["devDependencies"][name] for name in ("@types/node", "typescript")}}
        write_json(install / "package.json", package)
        locked = json.loads((ROOT / "package-lock.json").read_bytes())
        seed = {**locked, "name": package["name"], "version": package["version"],
            "packages": {name: value for name, value in locked["packages"].items()
                         if name.startswith("node_modules/") and not value.get("link")}}
        workspace_prefix = "packages/binding-onvif/"
        installed_prefix = "node_modules/@wot-av/binding-onvif/"
        for name, entry in locked["packages"].items():
            if name.startswith(workspace_prefix + "node_modules/"):
                seed["packages"][installed_prefix + name.removeprefix(workspace_prefix)] = entry
        seed["packages"][""] = package
        seed["packages"]["node_modules/@wot-av/binding-onvif"] = {
            "version": package_json["version"], "resolved": dependency, "integrity": packed["integrity"],
            "dependencies": package_json["dependencies"], "engines": package_json["engines"], "bin": package_json["bin"]
        }
        write_json(install / "package-lock.json", seed)
        flags = ["--ignore-scripts", "--no-audit", "--no-fund"]
        if not args.allow_registry:
            flags.append("--offline")
        run([npm, "install", "--package-lock-only", *flags], install, "isolated-lock")
        final_lock = json.loads((install / "package-lock.json").read_bytes())
        for name, entry in final_lock["packages"].items():
            if name in ("", "node_modules/@wot-av/binding-onvif"):
                continue
            original_name = workspace_prefix + name.removeprefix(installed_prefix) if name.startswith(installed_prefix) else name
            if original_name not in locked["packages"]:
                raise ValueError("Installed dependency has no workspace lock pin: " + name)
            original = locked["packages"][original_name]
            for field in ("version", "resolved", "integrity"):
                assert entry.get(field) == original.get(field), f"Workspace dependency pin changed: {name} {field}"
        run([npm, "ci", *flags], install, "isolated-npm-ci", timeout=300)
        shutil.copyfile(ROOT / "tools" / "onvif-installed-smoke.cjs", install / "installed-smoke.cjs")
        for role in ("server", "client"):
            command = [openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
                "-keyout", str(keys / (role + ".key")), "-out", str(keys / (role + ".pem")),
                "-days", "1", "-subj", "/CN=onvif-package-" + role,
                "-addext", "basicConstraints=critical,CA:TRUE",
                "-addext", "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign",
                "-addext", "extendedKeyUsage=" + ("serverAuth" if role == "server" else "clientAuth")]
            if role == "server":
                command.extend(["-addext", "subjectAltName=IP:127.0.0.1"])
            run(command, install, "openssl-" + role)
            environment["ONVIF_PACKAGE_" + role.upper() + "_KEY"] = str(keys / (role + ".key"))
            environment["ONVIF_PACKAGE_" + role.upper() + "_CERT"] = str(keys / (role + ".pem"))
        environment["ONVIF_PACKAGE_DIRECTORY_TOKEN"] = secrets.token_urlsafe(32)
        environment["ONVIF_PACKAGE_REPORT"] = str(work / "installed-proof.json")
        run([node, str(install / "installed-smoke.cjs")], install, "installed-public-api", timeout=180)

        types = """import { createOnvifRuntime, type OnvifRuntime, type OnvifRuntimeOptions } from "@wot-av/binding-onvif";
import { loadPackagedProjectionCatalog, packagedArtifactPath } from "@wot-av/binding-onvif/catalog";
import { project, type ProjectionPolicy } from "@wot-av/binding-onvif/projection";
import { DirectoryClient, type DirectoryOptions } from "@wot-av/binding-onvif/publication";
import { MediaExecutor } from "@wot-av/binding-onvif/media";
import { type NativeInvokeOptions } from "@wot-av/binding-onvif/binding/request";
import { decodeMetadata } from "@wot-av/binding-onvif/xml/metadata";
import { createDiscoveryEngine } from "@wot-av/binding-onvif/discovery";
import { NativeEventClient } from "@wot-av/binding-onvif/events";
const runtime: (options: OnvifRuntimeOptions) => Promise<OnvifRuntime> = createOnvifRuntime;
const directory: (options: DirectoryOptions) => DirectoryClient = options => new DirectoryClient(options);
const policy: ProjectionPolicy = { securityDefinitions: { native: { scheme: "cert" } }, security: ["native"] };
const options: NativeInvokeOptions = { timeoutMs: 1000 };
void [runtime, directory, policy, options, loadPackagedProjectionCatalog, packagedArtifactPath,
    project, MediaExecutor, decodeMetadata, createDiscoveryEngine, NativeEventClient];
"""
        (install / "public-types.ts").write_text(types, encoding="utf8")
        write_json(install / "tsconfig.json", {"compilerOptions": {"strict": True, "noEmit": True, "skipLibCheck": True,
            "target": "ES2022", "module": "Node16", "moduleResolution": "Node16", "types": ["node"]}, "files": ["public-types.ts"]})
        run([node, str(install / "node_modules" / "typescript" / "bin" / "tsc"), "-p", str(install / "tsconfig.json")], install, "installed-types")
        bin_path = install / "node_modules" / ".bin" / ("onvif-bridge.cmd" if os.name == "nt" else "onvif-bridge")
        assert bin_path.is_file(), "npm must create the actual CLI bin shim"
        assert "inspect|export|run" in run([str(bin_path), "--help"], install, "installed-cli-help").stdout
        snapshot = {"schemaVersion": 1, "revision": 7, "capturedAt": 1, "truncated": False, "devices": [], "seeds": [], "diagnostics": []}
        write_json(install / "inventory.json", snapshot)
        for name in ("cli-models", "cli-things"):
            (install / name).mkdir()
        write_json(install / "bridge.json", {"schemaVersion": 1,
            "input": {"mode": "fixture", "path": str(install / "inventory.json")},
            "projection": {"securityDefinitions": {"native": {"scheme": "cert"}}, "security": ["native"]},
            "output": {"mode": "file", "owner": "installed-package-proof", "directory": str(install / "cli-things"),
                "models": {"directory": str(install / "cli-models"), "baseUrl": "https://models.example.invalid/onvif/"}}})
        assert json.loads(run([str(bin_path), "inspect", "--config", str(install / "bridge.json")], install, "installed-cli-inspect").stdout) == snapshot
        assert not list((install / "cli-models").iterdir()), "Inspect must not publish"
        exported = json.loads(run([str(bin_path), "export", "--config", str(install / "bridge.json")], install, "installed-cli-export").stdout)
        assert exported["nativeControlGateway"] is False and exported["conformanceEstablished"] is False
        exported_files = [path for path in (install / "cli-models").rglob("*") if path.is_file()]
        assert len(exported_files) >= 298, "Offline CLI must export the complete packed model/schema/context library"
        write_json(work / "result.json", {"result": "passed", "workDirectory": str(work), "installation": str(install),
            "tarball": str(tarball), "sha256": hashlib.sha256(data).hexdigest(), "tarballFiles": len(names),
            "cliBin": str(bin_path), "cliExportFiles": len(exported_files), "publicTypes": True,
            "dependencyPinsMatchWorkspace": True, "registryDownloadsAllowed": args.allow_registry,
            "nodePathInherited": False, "distributionApproved": False, "installRetained": args.keep_install})
        print(json.dumps({"result": "passed", "evidence": str(work / "result.json"), "tarball": str(tarball)}))
    finally:
        for name in ("server.key", "server.pem", "client.key", "client.pem"):
            (keys / name).unlink(missing_ok=True)
        keys.rmdir()
        if not args.keep_install:
            for name in ("node_modules", "cli-models", "cli-things"):
                owned = install / name
                if owned.is_dir() and not owned.is_symlink():
                    shutil.rmtree(owned)


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
        print(f"ONVIF package proof failed: {error}", file=sys.stderr)
        raise SystemExit(1)
