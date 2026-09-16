import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord, OnvifError } from "../binding/errors.js";
import { assertOperationDescriptor, defineOperationRegistry, type OperationDescriptor } from "../binding/registry.js";
import { assertXmlRegistry } from "../xml/descriptors.js";
import type { CanonicalCatalog } from "./compiler.js";
import { assertRequirementIndex } from "./requirements.js";
import type { ProjectionCatalog } from "../projection/project.js";

const names = ["catalog.json", "requirements-index.json", "models.json", "context.jsonld", "terms.json",
    "payloads.schema.json", "form.schema.json", "snapshot.schema.json", "requirements.schema.json",
    "mapping.schema.json", "binding.schema.json", "model-translation.json", "topic-contracts.json",
    "sources.lock.json", "profile-editions.json", "editorial-decisions.json", "source-policy.json", "coverage.json", "manifest.json"] as const;
export type PackagedArtifact = typeof names[number];

export function packagedArtifactPath(name: PackagedArtifact): string {
    if (!names.includes(name)) throw new OnvifError("InvalidRegistry", "Unknown packaged ONVIF artifact");
    return join(__dirname, "..", "catalog-data", name);
}

function read(name: PackagedArtifact): { bytes: Buffer; value: unknown } {
    const bytes = readFileSync(packagedArtifactPath(name));
    if (bytes.length > 64 * 1024 * 1024) throw new OnvifError("InvalidRegistry", "Packaged catalog resource exceeds 64 MiB");
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

export function readPackagedArtifact(name: Exclude<PackagedArtifact, "manifest.json">): unknown {
    const manifest = read("manifest.json").value;
    if (!isRecord(manifest) || !Array.isArray(manifest.artifacts)) throw new OnvifError("InvalidRegistry", "Invalid packaged catalog manifest");
    const expected = manifest.artifacts.find((entry: unknown) => isRecord(entry) && entry.path === name);
    const loaded = read(name);
    if (!isRecord(expected) || expected.bytes !== loaded.bytes.length
        || expected.sha256 !== createHash("sha256").update(loaded.bytes).digest("hex")) {
        throw new OnvifError("InvalidRegistry", `Packaged artifact integrity mismatch: ${name}`);
    }
    return loaded.value;
}

function assertCatalog(value: unknown): asserts value is CanonicalCatalog {
    if (!isRecord(value) || value.formatVersion !== 1 || value.compilerVersion !== "onvif-canonical-1"
        || typeof value.registryDigest !== "string" || !Array.isArray(value.operations)
        || !Array.isArray(value.types) || !Array.isArray(value.services) || !Array.isArray(value.issues)
        || !isRecord(value.sourcePins)) throw new OnvifError("InvalidRegistry", "Invalid packaged canonical catalog");
    assertXmlRegistry(value.xml);
    const operations: OperationDescriptor[] = [];
    for (const item of value.operations) {
        if (!isRecord(item) || typeof item.id !== "string" || typeof item.serviceNamespace !== "string") {
            throw new OnvifError("InvalidRegistry", "Invalid compiled operation identity");
        }
        assertOperationDescriptor(item);
        operations.push(item);
    }
    if (defineOperationRegistry(operations, value.xml).digest !== value.registryDigest) {
        throw new OnvifError("InvalidRegistry", "Packaged registry digest disagrees with its operation/type descriptors");
    }
}

export function loadPackagedCatalog(): CanonicalCatalog {
    const value = readPackagedArtifact("catalog.json");
    assertCatalog(value);
    const manifest = read("manifest.json").value;
    if (!isRecord(manifest) || manifest.registryDigest !== value.registryDigest
        || manifest.sourceLockDigest !== value.sourcePins.lockDigest) throw new OnvifError("InvalidRegistry", "Packaged source/runtime pins disagree");
    const lockBytes = readFileSync(packagedArtifactPath("sources.lock.json"));
    if (createHash("sha256").update(lockBytes).digest("hex") !== value.sourcePins.lockDigest) {
        throw new OnvifError("InvalidRegistry", "Packaged source lock bytes disagree with the compiler pin");
    }
    return value;
}

export function loadPackagedProjectionCatalog(): ProjectionCatalog {
    const registry = loadPackagedCatalog(), value = readPackagedArtifact("requirements-index.json");
    assertRequirementIndex(value);
    const manifest = read("manifest.json").value;
    if (!isRecord(manifest) || manifest.requirementsDigest !== value.digest) {
        throw new OnvifError("InvalidRegistry", "Packaged requirement pin disagrees with its manifest");
    }
    return { registry, requirements: value };
}
