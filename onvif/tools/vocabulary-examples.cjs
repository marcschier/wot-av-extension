"use strict";

const { actionTemplate, eventTemplate, context } = require("../samples/reference-runtime/dist/catalog/models.js");
const { assertVocabularyInventory } = require("../samples/reference-runtime/dist/catalog/vocabulary.js");
const { formatTDExcerpt } = require("../../av/tools/publication/lib.mjs");

const hosts = Object.freeze({
    td: "", tm: "", action: "/actions/getProfiles", form: "/actions/getProfiles/forms/0",
    "event-form": "/events/notifications/forms/0", "data-schema": "/properties/value",
    security: "/securityDefinitions/example"
});
const escape = value => value.replaceAll("~", "~0").replaceAll("/", "~1");

function buildVocabularyExamples(catalog, inventory) {
    assertVocabularyInventory(inventory, catalog);
    const operation = catalog.operations.find(entry => entry.serviceNamespace === "http://www.onvif.org/ver20/media/wsdl"
        && entry.bindingQName.localName === "Media2Binding" && entry.operation === "GetProfiles");
    if (!operation) throw new Error("Vocabulary examples require the exact Media2 GetProfiles source contract");
    return Object.fromEntries(inventory.terms.map(term => {
        const document = {
            "@context": context(),
            ...(term.exampleHost === "tm" ? { "@type": "tm:ThingModel" } : {}),
            title: `Illustrative onvif:${term.name} ${term.exampleHost === "tm" ? "TM" : "TD"}`,
            ...(term.exampleHost === "tm" ? {} : {
                securityDefinitions: { example: { scheme: "nosec" } }, security: ["example"]
            })
        };
        if (["td", "tm"].includes(term.exampleHost)) Object.assign(document, structuredClone(term.example));
        else if (term.exampleHost === "security") document.securityDefinitions.example = structuredClone(term.example);
        else if (term.exampleHost === "data-schema") {
            const schema = structuredClone(term.example);
            if (["CanonicalXmlValue", "sourceDataSchema", "canonicalType", "validation"].includes(term.name)) {
                Object.assign(schema, structuredClone(actionTemplate(operation, catalog, "").input), term.example);
            }
            document.properties = { value: {
                ...schema, readOnly: true,
                forms: [{ href: "https://adapter.example.invalid/properties/value", op: "readproperty", contentType: "application/json" }]
            } };
        } else if (term.exampleHost === "event-form") {
            document.events = { notifications: eventTemplate(catalog, "https://camera.example.invalid/events") };
            Object.assign(document.events.notifications.forms[0], structuredClone(term.example));
        } else {
            const action = actionTemplate(operation, catalog, "https://camera.example.invalid/media2");
            Object.assign(term.exampleHost === "form" ? action.forms[0] : action, structuredClone(term.example));
            document.actions = { getProfiles: action };
        }
        return [term.name, document];
    }));
}

function excerptMetadata(term) {
    const host = hosts[term.exampleHost];
    if (host === undefined) throw new Error(`Undeclared vocabulary example host: ${term.name}`);
    const retain = ["/@context"];
    if (term.exampleHost === "tm") retain.push("/@type");
    if (term.exampleHost.endsWith("form")) retain.push(`${host}/href`, `${host}/op`);
    if (term.exampleHost === "security") retain.push("/security");
    retain.push(...Object.keys(term.example).map(key => `${host}/${escape(key)}`));
    return { source: `examples/vocabulary-examples.json#/${escape(term.name)}`, retain };
}

function renderVocabularyExample(term, documents) {
    const metadata = excerptMetadata(term);
    const label = term.exampleHost === "tm" ? "Thing Model" : "Thing Description";
    return [
        `${label} excerpt; \`// ...\` marks omitted members. [Complete ${label} example](${metadata.source}).`,
        "",
        `<!-- td-excerpt: ${JSON.stringify(metadata)} -->`,
        "```jsonc",
        formatTDExcerpt(JSON.stringify(documents), `/${escape(term.name)}`, metadata.retain),
        "```"
    ].join("\n");
}

module.exports = { buildVocabularyExamples, excerptMetadata, renderVocabularyExample, hosts };
