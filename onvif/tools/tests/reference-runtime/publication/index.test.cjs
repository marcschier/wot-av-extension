const test = require("node:test");
const assert = require("node:assert/strict");
const publication = require("./.compiled/publication/index.js");

test("publication barrel exposes exactly the supported runtime API and usable typed errors", () => {
    const expected = [
        "DISCOVERY_CONTEXT", "contextEntries", "contextValue", "PublicationError", "boundedInteger", "httpUrl",
        "assertThingDescription", "producerContent", "producerDigest", "matchesProducer", "mergeProducer", "errorCode",
        "isMissing", "assertOwner", "PublicationHttpClient", "responseJson", "expectStatus", "DirectoryClient",
        "readBoundedJson", "atomicJson", "OwnedJsonFile", "OwnedDocumentBundle", "MemoryPublicationStore",
        "JsonFilePublicationStore", "adaptInventory", "projectInventory", "createInspectionRegistry",
        "observationSummary", "currentObservationTime", "versionedThing", "preparePublication", "StaticModelPublisher",
        "FilePublication", "PublicationBatchError", "DirectoryPublisher"
    ].sort();
    assert.deepEqual(Object.keys(publication).sort(), expected);
    assert.equal(publication.boundedInteger(7, "items", 7), 7);
    const error = new publication.PublicationError("PublicationConflict", "owned revision");
    assert.equal(publication.errorCode(error), "PublicationConflict");
    assert.equal(error.retryable, false);
});
