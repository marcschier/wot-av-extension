"""Build and check a compact, codec-only publication of the formal AV proposal."""

from __future__ import annotations

import copy
import hashlib
import html
import json
import re
from collections import Counter, defaultdict
from importlib.metadata import version
from math import gcd
from pathlib import Path

from pyld import jsonld
from rdflib import BNode, Graph, Literal, Namespace, URIRef
from rdflib.compare import isomorphic, to_canonical_graph
from rdflib.namespace import DCTERMS, OWL, RDF, RDFS, SH, XSD

PREFIX = Path(__file__).with_name("wot-av-release-v0.1")
SOURCE = PREFIX.with_name("wot-av-formal-v0.1")
SOURCE_HASHES = {
    ".terms.json": "bd8d7b56cb95fdef0b372a5cbf1741d607e945fc29a00ac100580e5e59751151",
    ".context.jsonld": "7f8773169709682ff39f1cc18a793221044fb909890963913b6117b660212057",
    ".ttl": "e807d0ca1eafb98a830fea8635aad382fb53de87fdd854cb7c915176d026065e",
    ".shacl.ttl": "c8fa9ce24fb5a8036a925cca9be6bc977fce1eddbf6867a256f39524591c5e3f",
    ".md": "6b5ecc317497277e9bb55cc90e9782d74032d6626cecffd823e8757250164e11",
    ".build.py": "6c5d9edee8adce3a14052219f1b10e7f9a57f674b2093a19287d22c4e4869e5e",
}
OUTPUTS = (
    ".context.jsonld", ".ttl", ".catalog.md", ".terms.json", ".shacl.ttl",
    ".examples.jsonld", ".md", ".checks.json", ".build.py", ".publication.json",
)
AV = Namespace("https://example.org/wot/av#")
TD_PIN = "87808f1644ba79eb0a58d238385a8bd4a2236853"
ONNX_PIN = "c9f169adac34bd690bf0d628e9aae7fde3d4be85"
XREGISTRY_PIN = "16483bb564586423de9c128db89f3b61d360f4e3"
CODECS = {
    "H265": {
        "meaning": (
            "ITU-T H.265 / ISO/IEC 23008-2 High Efficiency Video Coding (HEVC) "
            "bitstream family, used with EncodedVideo. The exact standard edition, "
            "profile, tier, level, compatibility/constraint flags and VPS/SPS/PPS "
            "initialization belong to a recognized pinned codec configuration. "
            "This is not H.264, a container, RTP packetization or a WebRTC capability "
            "claim; the family IRI alone implies no encoding or decoding support."
        ),
        "representation": "av:EncodedVideo",
        "media_type_reference": "video/H265",
        "sources": [
            "https://www.itu.int/rec/T-REC-H.265-202309-S/en",
            "https://www.rfc-editor.org/rfc/rfc7798.html#section-1.1",
            "https://www.rfc-editor.org/rfc/rfc7798.html#section-7.1",
            "https://www.iana.org/assignments/media-types/video/H265",
        ],
    },
    "Opus": {
        "meaning": (
            "IETF Opus interactive speech and audio coding family defined by "
            "RFC 6716, used with EncodedAudio. The exact codec configuration, "
            "channel semantics, sampling, framing and negotiated transport "
            "parameters belong to recognized pinned codec/binding profiles. "
            "This is not PCM, a container or RTP packetization; the family IRI "
            "alone implies no encoding, decoding or WebRTC implementation support."
        ),
        "representation": "av:EncodedAudio",
        "media_type_reference": "audio/opus",
        "sources": [
            "https://www.rfc-editor.org/rfc/rfc6716.html#section-2",
            "https://www.rfc-editor.org/rfc/rfc7587.html#section-4.1",
            "https://www.rfc-editor.org/rfc/rfc7587.html#section-6.1",
            "https://www.iana.org/assignments/media-types/audio/opus",
        ],
    },
}
EXTENSION_POLICY = (
    "Controlled sets are closed under the explicitly selected, recognized and "
    "content-pinned vocabulary/profile release. This release adds only H265 and "
    "Opus to Codec; older pinned releases retain their original sets. A future "
    "recognized versioned profile may declare an explicit additive set of absolute "
    "IRIs, each with a stable definition, primary sources, representation/field "
    "applicability, exact configuration/schema dependencies and matching rules. "
    "AV-namespace additions require a corresponding future authored AV inventory; "
    "profile-owned IRIs use that profile's declared namespace. Publish and pin the "
    "extended inventory, context dependencies and validator/shape set together. "
    "Existing IRI meanings, coercions, property cardinalities and native TD "
    "operations cannot be redefined. New values are usable only after the admission "
    "implementation explicitly recognizes that exact profile and has qualified "
    "the complete selected plan. Namespace expansion, a family name, a media type "
    "or an advertised profile URI is not recognition, parameter evidence or codec "
    "support. Unknown codecs, codec parameters or required profiles cannot satisfy "
    "a hard requirement; never drop them, substitute a nearest codec or silently "
    "widen an older controlled set. Detailed profiles refine family semantics "
    "without changing the family IRI's meaning."
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def path(suffix: str, source: bool = False) -> Path:
    require(suffix in (SOURCE_HASHES if source else OUTPUTS), f"Unexpected suffix: {suffix}")
    prefix = SOURCE if source else PREFIX
    return prefix.with_name(prefix.name + suffix)


def digest(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()


def verify_sources() -> None:
    for suffix, expected in SOURCE_HASHES.items():
        require(digest(path(suffix, True)) == expected, f"Source changed: {suffix}")


def unique_pairs(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(file: Path) -> dict:
    return json.loads(file.read_text(encoding="utf-8"), object_pairs_hook=unique_pairs)


def packed(value: object, readable: bool = False) -> str:
    separators = (", ", ": ") if readable else (",", ":")
    return json.dumps(value, ensure_ascii=True, separators=separators, allow_nan=False)


def write(suffix: str, text: str) -> None:
    path(suffix).write_text(text.rstrip("\n") + "\n", encoding="utf-8", newline="\n")


def compact_json(value: dict) -> str:
    lines = ["{"]
    for index, (key, item) in enumerate(value.items()):
        comma = "," if index + 1 < len(value) else ""
        if isinstance(item, dict) and item:
            lines.append("  " + packed(key) + ":{")
            for child_index, (child, definition) in enumerate(item.items()):
                tail = "," if child_index + 1 < len(item) else ""
                lines.append("    " + packed(child) + ":" + packed(definition) + tail)
            lines.append("  }" + comma)
        else:
            lines.append("  " + packed(key) + ":" + packed(item) + comma)
    return "\n".join([*lines, "}"])


def context_text(context: dict) -> str:
    entries = list(context["@context"].items())
    lines = ['{', '  "@context": {']
    for index, (key, value) in enumerate(entries):
        comma = "," if index + 1 < len(entries) else ""
        lines.append("    " + packed(key) + ": " + packed(value, True) + comma)
    return "\n".join([*lines, "  }", "}"])


def expand_iri(value: str, terms: dict) -> URIRef:
    prefix, local = value.split(":", 1)
    return URIRef(terms["prefixes"][prefix] + local) if prefix in terms["prefixes"] else URIRef(value)


def make_terms(original: dict) -> dict:
    terms = copy.deepcopy(original)
    for name, details in CODECS.items():
        require(name not in terms["enums"]["Codec"], f"Codec already exists: {name}")
        terms["enums"]["Codec"][name] = details["meaning"]
    terms["codec_publication"] = {
        "additions": {name: {k: v for k, v in details.items() if k != "meaning"}
                      for name, details in CODECS.items()},
        "representation_codec_sets": {
            "av:EncodedVideo": ["av:H264", "av:JPEG", "av:H265"],
            "av:EncodedAudio": ["av:AAC", "av:Opus"],
        },
        "media_type_scope": (
            "IANA media-type references identify registered RTP media-type mechanisms, "
            "not equivalent RDF resources or generic Form contentType defaults. Native "
            "signaling content types do not identify negotiated media codecs."
        ),
        "opus_clock_scope": (
            "RFC 7587 sections 4.1 and 7 use a 48000 Hz RTP timestamp clock and "
            "opus/48000/2 SDP signaling for all Opus modes; these do not prove "
            "48000 samples/second at an application boundary or two actual media "
            "channels. Track sampleRate/channels/channelLayout describe the stated "
            "media signature; clock ticks use TimestampMapping/timeBase separately."
        ),
        "extension_policy": EXTENSION_POLICY,
    }
    terms["publication"] = {
        "status": "Compact original publication proposal; not a registered or deployed standard.",
        "date": "2026-09-14",
        "source_inventory": str(path(".terms.json", True)),
        "release_inventory": str(path(".terms.json")),
        "namespace_status": "Unregistered original namespace: https://example.org/wot/av#",
        "external_context_status": "Unhosted placeholder: https://example.org/wot/av/context/v0.1",
        "dependency_pins": terms["baseline"],
        "native_td_source_pin": {
            "repository": "w3c/wot-thing-description",
            "commit": TD_PIN,
            "context_path": "context/td-context-1.1.jsonld",
            "form_context_lines": [380, 451],
            "context_sha256": "9298ddacce1d023e584dcd4b0e639baa228fb9fa8743dcad6d9c9c29db6ca069",
            "form_schema_path": "validation/td-json-schema-validation.json",
            "form_schema_lines": [335, 412],
        },
        "research_pins": {
            "onnx": {"repository": "onnx/onnx", "commit": ONNX_PIN,
                     "path": "docs/IR.md", "lines": [[69, 119], [222, 251], [382, 386]]},
            "xregistry": {"repository": "xregistry/spec", "commit": XREGISTRY_PIN,
                          "files": {"core/spec.md": [[1206, 1246]],
                                    "core/http.md": [[2881, 2905]],
                                    "core/model.md": [[754, 771]]}},
        },
        "reference_mechanism": (
            "namedForms remains canonical: absolute native Form @id, av:form, "
            "one TD pin and an existing TD operation on FormReference. An optional "
            "av:jsonPointer must agree with that Form in the original pinned JSON. "
            "namedForms is a reference-profile label, not an added JSON-LD term. "
            "Native href exists only on native Forms; there is no competing AV endpoint."
        ),
        "control_roles": (
            "The existing control-v0.1 profile, once recognized and pinned with its "
            "actual schemas, maps semantic role identifiers/labels to named native "
            "affordances/FormReferences and standard TD operations. No new core AV "
            "action classes, operation values or controller-envelope aliases are added."
        ),
        "context_contract": (
            "Exact original context mappings; 105 AV and 17 reused external properties. "
            "All 38 class IRIs and controlled individuals resolve through the av prefix, "
            "without adding class aliases or changing native TD keys, @vocab, @set, "
            "@list or scalar coercions."
        ),
        "shape_status": (
            "Candidate structural SHACL only. The original graph is retained except "
            "for appending the new codecs to its three codec sh:in lists. No SHACL "
            "engine, full shape-syntax, admission or runtime conformance is claimed; "
            "independent validation of the original shapes remains separate."
        ),
        "example_status": (
            "Synthetic H.265 and WebRTC H.264+Opus description fragments only, not "
            "complete TDs or admitted assignments. Named native Forms and configuration "
            "pins are unresolved intentionally. No device, decoder, profile, transport "
            "or hardware capability is evidenced."
        ),
        "webrtc_sources": [
            "https://www.rfc-editor.org/rfc/rfc7742.html#section-5",
            "https://www.rfc-editor.org/rfc/rfc7742.html#section-6.2",
            "https://www.rfc-editor.org/rfc/rfc7874.html#section-3",
            "https://www.rfc-editor.org/rfc/rfc7587.html#section-7",
        ],
    }
    return terms


def codec_graph(terms: dict) -> Graph:
    graph = Graph()
    for name, details in CODECS.items():
        graph.add((AV[name], RDF.type, RDFS.Resource))
        graph.add((AV[name], RDFS.label, Literal(name, lang="en")))
        graph.add((AV[name], RDFS.comment, Literal(terms["enums"]["Codec"][name], lang="en")))
        for source in details["sources"]:
            graph.add((AV[name], DCTERMS.references, URIRef(source)))
    return graph


def compact_turtle(graph: Graph, terms: dict, header: list[str]) -> str:
    if any(isinstance(node, BNode) for triple in graph for node in triple):
        graph = to_canonical_graph(graph)
    nodes = sorted({node for triple in graph for node in triple if isinstance(node, BNode)}, key=str)
    blank_names = {node: f"_:b{index:04d}" for index, node in enumerate(nodes, 1)}
    prefixes = {**terms["prefixes"], "owl": str(OWL), "sh": str(SH)}
    used = set()

    def token(node) -> str:
        if isinstance(node, BNode):
            return blank_names[node]
        if isinstance(node, Literal):
            result = packed(str(node))
            if node.language:
                return result + "@" + node.language
            return result + "^^" + token(node.datatype) if node.datatype else result
        value = str(node)
        for prefix, namespace in prefixes.items():
            if value.startswith(namespace):
                local = value[len(namespace):]
                if not local or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", local):
                    used.add(prefix)
                    return prefix + ":" + local
        return "<" + value + ">"

    statements = []
    for subject in sorted(set(graph.subjects()), key=token):
        clauses = []
        predicates = sorted(set(graph.predicates(subject)), key=lambda p: (p != RDF.type, str(p)))
        for predicate in predicates:
            objects = ", ".join(sorted(token(obj) for obj in graph.objects(subject, predicate)))
            clauses.append(("a" if predicate == RDF.type else token(predicate)) + " " + objects)
        statements.append(token(subject) + " " + " ; ".join(clauses) + " .")
    declarations = [f"@prefix {prefix}: <{prefixes[prefix]}> ." for prefix in sorted(used)]
    return "\n".join([*header, *declarations, "", *statements])


def codec_lists(graph: Graph) -> dict[tuple[str, ...], tuple[BNode, BNode]]:
    result = {}
    for owner, head in graph.subject_objects(SH["in"]):
        if (owner, SH.path, AV.codec) in graph:
            values = tuple(str(item).removeprefix(str(AV)) for item in graph.items(head))
            require(values not in result, f"Unexpected duplicate codec list: {values}")
            result[values] = (owner, head)
    return result


def candidate_shapes(original: Graph) -> Graph:
    graph = Graph()
    graph += original
    lists = codec_lists(graph)
    additions = {
        ("H264", "JPEG", "AAC"): ["H265", "Opus"],
        ("H264", "JPEG"): ["H265"],
        ("AAC",): ["Opus"],
    }
    require(set(lists) == set(additions), "Original codec shapes differ from the inspected baseline")
    for values, names in additions.items():
        _, current = lists[values]
        while graph.value(current, RDF.rest) != RDF.nil:
            current = graph.value(current, RDF.rest)
        for name in names:
            following = BNode()
            graph.remove((current, RDF.rest, RDF.nil))
            graph.add((current, RDF.rest, following))
            graph.add((following, RDF.first, AV[name]))
            graph.add((following, RDF.rest, RDF.nil))
            current = following
    return graph


def remove_added_shape_members(candidate: Graph) -> Graph:
    restored = Graph()
    restored += candidate
    for _, head in codec_lists(candidate).values():
        previous = None
        current = head
        while current != RDF.nil:
            following = restored.value(current, RDF.rest)
            if restored.value(current, RDF.first) in {AV.H265, AV.Opus}:
                require(previous is not None, "A new codec unexpectedly replaced a list head")
                restored.remove((previous, RDF.rest, current))
                restored.add((previous, RDF.rest, following))
                restored.remove((current, None, None))
            else:
                previous = current
            current = following
    return restored


def escape(value: object) -> str:
    return html.escape(str(value), quote=False).replace("|", "&#124;").replace("\n", "<br>")


def code(value: object) -> str:
    return "`" + escape(value) + "`"


def catalogue(terms: dict) -> str:
    lines = [
        "# WoT AV v0.1 - complete compact term catalogue",
        "**Original, unregistered proposal; external context unhosted.** "
        f"38 classes, 105 AV properties, 17 reused properties; authoritative release inventory: {code(path('.terms.json'))}.",
        "Domains below are alternatives, not global RDFS intersections; listed superclass uses inherit, "
        "with more-specific profile uses taking precedence. Cardinalities count RDF values, except "
        "preferences count list items; * is unbounded. Default JSON container is not a scalar-only "
        "restriction. Fixed units, lexical restrictions and full meanings are retained. Enum/set labels "
        "are catalogue labels, not classes. Conditional, admission and lifecycle rules remain complete in "
        "the machine catalogue; local cardinalities alone do not prove feasibility.",
        "## Classes and glossary",
        "| Class | Module | Identity | Superclasses | Meaning |",
        "|---|---|---|---|---|",
    ]
    for name, definition in terms["classes"].items():
        bases = ", ".join(code(base) for base in definition["superclasses"]) or "-"
        lines.append(f"| {code('av:' + name)} | {definition['module']} | "
                     f"{definition['identity']} | {bases} | {escape(definition['meaning'])} |")
    lines.extend([
        "## Property uses by domain",
        "| Property | Module | Domain | Range | Cardinality | Units | JSON value/container; lexical limits | Meaning |",
        "|---|---|---|---|---|---|---|---|",
    ])
    properties = {**{"av:" + key: item for key, item in terms["properties"].items()},
                  **terms["external_properties"]}
    for name, prop in properties.items():
        domains, ranges, cards = [], [], []
        for domain, usage in prop["uses"].items():
            domains.append(code(domain))
            values = usage["range"] if isinstance(usage["range"], list) else [usage["range"]]
            ranges.append(" OR ".join(code(value) for value in values))
            maximum = "*" if usage["max"] is None else str(usage["max"])
            cards.append(f"{usage['min']}..{maximum}")
        lexical = prop["value"] + "/" + prop.get("container", "default")
        if "minimum" in prop:
            lexical += "; minimum=" + str(prop["minimum"])
        if "pattern" in prop:
            lexical += "; pattern=" + prop["pattern"]
        lines.append(
            f"| {code(name)} | {prop.get('module', 'external reuse')} | {'<br>'.join(domains)} | "
            f"{'<br>'.join(ranges)} | {'<br>'.join(cards)} | {escape(prop.get('unit', '-'))} | "
            f"{escape(lexical)} | {escape(prop['meaning'])} |"
        )
    lines.extend([
        "## Controlled IRI glossary",
        "| Set label | Complete members and meanings |",
        "|---|---|",
    ])
    for name, values in terms["enums"].items():
        if isinstance(values, dict):
            members = []
            for value, meaning in values.items():
                entry = code("av:" + value) + ": " + escape(meaning)
                if value in CODECS:
                    citations = [f"[{index}]({url})" for index, url in enumerate(CODECS[value]["sources"], 1)]
                    entry += " Primary sources: " + ", ".join(citations) + "."
                members.append(entry)
        else:
            members = [code(value) for value in values]
        lines.append("| " + code(name) + " | " + "<br>".join(members) + " |")
    lines.extend([
        "## Existing pinned-profile contracts",
        "| Profile IRI | Document kind; profile-owned labels | Complete required meaning |",
        "|---|---|---|",
    ])
    for definition in terms["profiles"].values():
        labels = "; ".join(key + ": " + value for key, value in definition.get("controlled_values", {}).items())
        kind = code("av:" + definition["kind"]) + ("; " + escape(labels) if labels else "")
        lines.append(f"| {code(definition['iri'])} | {kind} | {escape(definition['required_meaning'])} |")
    return "\n".join(lines)


def examples(terms: dict) -> dict:
    base = "https://example.org/wot/av/release-example/"

    def ident(local: str) -> str:
        return base + local

    def mode(name: str, track_names: list[str]) -> dict:
        return {
            "@id": ident(name + "-mode"), "@type": "av:Mode",
            "av:kind": "av:Live", "av:form": ident("native-forms/" + name),
            "av:configuration": ident("unresolved-pins/" + name + "-acquisition"),
            "av:track": [ident(track) for track in track_names],
            "av:resourceUses": [{
                "@type": "av:ResourceUse", "av:resource": ident(name + "-resource"),
                "av:configuration": ident("unresolved-pins/" + name + "-resource"),
                "av:sharing": "av:Exclusive",
            }],
        }

    return {
        "@context": terms["context_url"],
        "@graph": [
            {"@id": ident("h265-offer"), "@type": "av:Offer",
             "av:source": ident("unresolved-source"),
             "av:mode": [ident("h265-mode")]},
            {"@id": ident("webrtc-offer"), "@type": "av:Offer",
             "av:source": ident("unresolved-source"),
             "av:mode": [ident("webrtc-mode")]},
            mode("h265", ["h265-video"]),
            mode("webrtc", ["webrtc-video", "webrtc-audio"]),
            {"@id": ident("h265-video"), "@type": "av:Track",
             "dcterms:identifier": "video", "av:representation": "av:EncodedVideo",
             "av:codec": "av:H265", "av:width": 1920, "av:height": 1080,
             "av:cadence": "av:Constant",
             "av:frameRate": {"@type": "av:Rational", "av:numerator": 30, "av:denominator": 1},
             "av:configuration": ident("unresolved-pins/h265-codec")},
            {"@id": ident("webrtc-video"), "@type": "av:Track",
             "dcterms:identifier": "video", "av:representation": "av:EncodedVideo",
             "av:codec": "av:H264", "av:width": 1280, "av:height": 720,
             "av:cadence": "av:Variable",
             "av:configuration": ident("unresolved-pins/webrtc-h264-codec")},
            {"@id": ident("webrtc-audio"), "@type": "av:Track",
             "dcterms:identifier": "audio", "av:representation": "av:EncodedAudio",
             "av:codec": "av:Opus", "av:sampleRate": 48000, "av:channels": 2,
             "av:channelLayout": "av:StereoLR",
             "av:configuration": ident("unresolved-pins/webrtc-opus-codec"),
             "av:timing": [{
                 "@type": "av:TimestampMapping",
                 "av:clock": ident("opus-rtp-clock"), "av:basis": "av:PresentationTime",
                 "av:timeBase": {"@type": "av:Rational", "av:numerator": 1, "av:denominator": 48000},
             }]},
        ],
    }


def example_text(document: dict) -> str:
    lines = ["{", '  "@context": ' + packed(document["@context"]) + ",", '  "@graph": [']
    for index, item in enumerate(document["@graph"]):
        comma = "," if index + 1 < len(document["@graph"]) else ""
        lines.append("    " + packed(item, True) + comma)
    return "\n".join([*lines, "  ]", "}"])


def offline_loader(context: dict, context_url: str):
    def load(url: str, options: dict | None = None) -> dict:
        require(url == context_url, f"No offline context supplied; network disabled: {url}")
        return {"contextUrl": None, "documentUrl": url, "document": context}
    return load


def rdf_from_jsonld(document: dict | list, loader) -> Graph:
    nquads = jsonld.to_rdf(document, {"documentLoader": loader, "format": "application/n-quads"})
    return Graph().parse(data=nquads, format="nt")


def runtime_sets(terms: dict) -> tuple[set, set, set]:
    classes = {AV[name] for name in terms["classes"]}
    properties = {AV[name] for name in terms["properties"]}
    individuals = {AV[name] for values in terms["enums"].values()
                   if isinstance(values, dict) for name in values}
    return classes, properties, individuals


def audit_av_graph(graph: Graph, terms: dict, support: set | None = None) -> set:
    classes, properties, individuals = runtime_sets(terms)
    allowed = classes | properties | individuals | (support or set()) | {URIRef(str(AV))}
    used = {node for triple in graph for node in triple
            if isinstance(node, URIRef) and str(node).startswith(str(AV))}
    require(not used - allowed, f"Unknown AV IRIs: {sorted(map(str, used - allowed))}")
    for _, predicate, obj in graph:
        if str(predicate).startswith(str(AV)):
            require(predicate in properties, f"Non-property used as an AV predicate: {predicate}")
        if predicate == RDF.type and str(obj).startswith(str(AV)):
            require(obj in classes, f"Non-class used as an AV type: {obj}")
    return used


def expect_rejected(graph: Graph, terms: dict) -> bool:
    try:
        audit_av_graph(graph, terms)
    except ValueError:
        return True
    raise ValueError("The AV-term detector accepted an intentionally invalid graph")


def verify(terms: dict, original_terms: dict, original_ontology: Graph, original_shapes: Graph) -> dict:
    context = read_json(path(".context.jsonld"))
    original_context = read_json(path(".context.jsonld", True))
    require(context == original_context, "Context mappings changed, rather than formatting only")
    require(read_json(path(".terms.json")) == terms, "Machine catalogue JSON round trip changed data")
    restored_terms = copy.deepcopy(terms)
    del restored_terms["publication"]
    del restored_terms["codec_publication"]
    for name in CODECS:
        del restored_terms["enums"]["Codec"][name]
    require(restored_terms == original_terms, "An existing inventory definition changed")
    require((len(terms["classes"]), len(terms["properties"])) == (38, 105), "Core inventory size changed")

    ontology = Graph().parse(path(".ttl"), format="turtle")
    shapes = Graph().parse(path(".shacl.ttl"), format="turtle")
    delta = codec_graph(terms)
    expected = original_ontology + delta
    require(isomorphic(ontology, expected), "Ontology is not the original graph plus the declared codec delta")
    require(isomorphic(ontology - delta, original_ontology), "Removing the codec delta did not restore the original")
    require(not set(original_ontology) - set(ontology), "An original ontology triple was lost")
    require(isomorphic(remove_added_shape_members(shapes), original_shapes), "Unrelated structural shapes changed")
    require(len(shapes) == len(original_shapes) + 8, "Unexpected candidate SHACL triple delta")

    classes, av_properties, individuals = runtime_sets(terms)
    require(set(ontology.subjects(RDF.type, RDFS.Class)) == classes, "Ontology class coverage differs")
    require(set(ontology.subjects(RDF.type, RDF.Property)) == av_properties, "Ontology property coverage differs")
    require(set(ontology.subjects(RDF.type, RDFS.Resource)) == individuals, "Controlled individual coverage differs")
    all_properties = {**{"av:" + key: item for key, item in terms["properties"].items()},
                      **terms["external_properties"]}
    mappings = {key: value for key, value in context["@context"].items()
                if isinstance(value, dict) and not value.get("@prefix")}
    require(set(mappings) == set(all_properties), "Context has missing or extra property mappings")
    catalogue_property_iris = {expand_iri(key, terms) for key in all_properties}
    context_property_iris = {URIRef(value["@id"]) for value in mappings.values()}
    require(context_property_iris == catalogue_property_iris, "Context/catalogue property IRI coverage differs")
    require(len(context_property_iris) == len(mappings) == 122, "Duplicate context target IRI")

    loader = offline_loader(context, terms["context_url"])
    probe = {"@context": terms["context_url"], "@id": "urn:release-probe:all-mappings",
             "@type": ["av:" + name for name in terms["classes"]]}
    expected_values = {}
    for index, (name, prop) in enumerate(all_properties.items()):
        value_kind = prop["value"]
        raw = {
            "node": [f"urn:release-probe:value:{index}:1", f"urn:release-probe:value:{index}:2"],
            "integer": [5, 6], "number": [1.5, 2.5], "string": ["first", "second"],
            "dateTime": ["2026-09-14T12:00:00Z", "2026-09-14T12:01:00Z"],
        }[value_kind]
        container = prop.get("container")
        samples = raw if container in ("set", "list") else raw[:1]
        probe[name] = samples if container in ("set", "list") else samples[0]
        expanded_values = []
        for sample in samples:
            if value_kind == "node":
                entry = {"@id": sample}
            else:
                entry = {"@value": sample}
                if value_kind in ("string", "dateTime"):
                    entry["@type"] = str(XSD.string if value_kind == "string" else XSD.dateTime)
            expanded_values.append(entry)
        expected_values[str(expand_iri(name, terms))] = (
            [{"@list": expanded_values}] if container == "list" else expanded_values
        )
    expanded = jsonld.expand(probe, {"documentLoader": loader})
    require(len(expanded) == 1, "Coverage probe unexpectedly split into multiple nodes")
    require(set(expanded[0]["@type"]) == {str(iri) for iri in classes}, "Class IRIs do not all resolve")
    actual_values = {key: value for key, value in expanded[0].items() if not key.startswith("@")}
    require(actual_values == expected_values, "A context coercion or set/list mapping did not expand as specified")
    old_loader = offline_loader(original_context, terms["context_url"])
    old_expanded = jsonld.expand(probe, {"documentLoader": old_loader})
    require(expanded == old_expanded, "Compact and original contexts expand differently")
    probe_graph = rdf_from_jsonld(expanded, loader)
    audit_av_graph(probe_graph, terms)
    list_head = probe_graph.value(URIRef(probe["@id"]), AV.preferences)
    preference_index = list(all_properties).index("av:preferences")
    require(list(probe_graph.items(list_head)) == [
        URIRef(f"urn:release-probe:value:{preference_index}:1"),
        URIRef(f"urn:release-probe:value:{preference_index}:2"),
    ], "RDF preference list order changed")

    example_document = read_json(path(".examples.jsonld"))
    expanded_examples = jsonld.expand(example_document, {"documentLoader": loader})
    example_graph = rdf_from_jsonld(expanded_examples, loader)
    example_av_terms = audit_av_graph(example_graph, terms)
    require(set(example_graph.objects(None, AV.codec)) == {AV.H265, AV.H264, AV.Opus}, "Example codec coverage differs")
    permitted = terms["codec_publication"]["representation_codec_sets"]
    for subject in example_graph.subjects(RDF.type, AV.Track):
        representation = example_graph.value(subject, AV.representation)
        codec = example_graph.value(subject, AV.codec)
        key = "av:" + str(representation).removeprefix(str(AV))
        require(codec in {expand_iri(name, terms) for name in permitted[key]}, "Example codec/representation mismatch")
    mode_id = URIRef("https://example.org/wot/av/release-example/webrtc-mode")
    selected_tracks = set(example_graph.objects(mode_id, AV.track))
    require(len(selected_tracks) == 2, "WebRTC example is not a joint A/V Mode")
    require({example_graph.value(track, AV.representation) for track in selected_tracks}
            == {AV.EncodedVideo, AV.EncodedAudio}, "WebRTC example lost a media component")
    for subject in example_graph.subjects(RDF.type, AV.Rational):
        numerator = int(example_graph.value(subject, AV.numerator))
        denominator = int(example_graph.value(subject, AV.denominator))
        require(denominator > 0 and gcd(numerator, denominator) == 1, "Noncanonical example Rational")
    hctl_target = URIRef(terms["prefixes"]["hctl"] + "hasTarget")
    require(not list(example_graph.triples((None, hctl_target, None))), "Example unexpectedly duplicates a native href")
    require(not list(example_graph.subjects(RDF.type, AV.Assignment)), "Example claims an accepted assignment")
    compacted = jsonld.compact(expanded_examples, context["@context"], {"documentLoader": loader})
    require(isomorphic(example_graph, rdf_from_jsonld(compacted, loader)), "Example JSON-LD round trip changed its graph")

    ontology_terms = audit_av_graph(ontology, terms)
    original_support = {subject for subject in original_shapes.subjects(RDF.type, SH.NodeShape)
                        if isinstance(subject, URIRef) and str(subject).startswith(str(AV))}
    shape_terms = audit_av_graph(shapes, terms, original_support)
    require({subject for subject in shapes.subjects(RDF.type, SH.NodeShape) if isinstance(subject, URIRef)}
            == original_support, "New named support shapes were introduced")
    for value in context["@context"].values():
        if isinstance(value, dict) and not value.get("@prefix"):
            target = URIRef(value["@id"])
            require(not str(target).startswith(str(AV)) or target in av_properties, "Unknown context AV term")
    negative_results = {}
    for label, triple in {
        "unknown_property_detected": (URIRef("urn:probe:subject"), AV.UndeclaredPropertyProbe, Literal(1)),
        "unknown_class_detected": (URIRef("urn:probe:subject"), RDF.type, AV.UndeclaredClassProbe),
        "enum_as_class_detected": (URIRef("urn:probe:subject"), RDF.type, AV.EncodedVideo),
        "unknown_av_codec_detected": (URIRef("urn:probe:subject"), AV.codec, AV.UndeclaredCodecProbe),
    }.items():
        graph = Graph()
        graph.add(triple)
        negative_results[label] = expect_rejected(graph, terms)
    codec_members = {AV[name] for name in terms["enums"]["Codec"]}
    require(URIRef("urn:probe:unrecognized-external-codec") not in codec_members, "Unknown codec admitted to closed set")
    require(set(codec_lists(shapes)) == {
        ("H264", "JPEG", "AAC", "H265", "Opus"),
        ("H264", "JPEG", "H265"), ("AAC", "Opus"),
    }, "Candidate shapes do not have the exact intended codec sets")

    markdown = path(".catalog.md").read_text(encoding="utf-8")
    for name, definition in terms["classes"].items():
        require(escape(definition["meaning"]) in markdown, f"Class definition truncated: {name}")
        require(sum(line.startswith("| " + code("av:" + name) + " |") for line in markdown.splitlines()) == 1,
                f"Class catalogue row missing or duplicated: {name}")
    for name, prop in all_properties.items():
        require(escape(prop["meaning"]) in markdown, f"Property meaning truncated: {name}")
        require(sum(line.startswith("| " + code(name) + " |") for line in markdown.splitlines()) == 1,
                f"Property catalogue row missing or duplicated: {name}")
    for values in terms["enums"].values():
        if isinstance(values, dict):
            for name, meaning in values.items():
                require(escape(meaning) in markdown, f"Controlled meaning truncated: {name}")
    for name, profile in terms["profiles"].items():
        require(escape(profile["required_meaning"]) in markdown, f"Profile meaning truncated: {name}")
    note = path(".md").read_text(encoding="utf-8")
    require(len(note.split()) <= 1000, "Release note exceeds 1000 words")
    require("/blob/main/" not in note and "/blob/master/" not in note, "Moving research citation remains")
    require(all(pin in note for pin in (TD_PIN, ONNX_PIN, XREGISTRY_PIN)), "A required source pin is missing")
    require("namedForms" in note and "candidate" in note.lower(), "Publication boundary labels are missing")
    for suffix, limit in ((".context.jsonld", 160), (".ttl", 350), (".catalog.md", 220)):
        require(len(path(suffix).read_bytes().splitlines()) < limit, f"Compact presentation target exceeded: {suffix}")
    for suffix in (".context.jsonld", ".ttl", ".catalog.md", ".terms.json"):
        text = path(suffix).read_text(encoding="utf-8")
        require("..." not in text and "\u2026" not in text, f"Ellipsis in complete artifact: {suffix}")
    verify_sources()
    return {
        "keys": {
            "context_catalogue_exact_coverage": True,
            "original_graph_preserved_except_codec_additions": True,
            "no_unknown_av_runtime_terms": True,
        },
        "scope": "Publication/structure and vocabulary checks, not admission or SHACL engine conformance.",
        "libraries": {"PyLD": version("PyLD"), "rdflib": version("rdflib")},
        "context_coverage": {
            "av_property_iris": len(av_properties), "reused_external_property_iris": 17,
            "exact_distinct_property_mappings": len(mappings), "class_iris_expanded_via_prefix": len(classes),
            "missing_iris": [], "extra_iris": [], "context_json_object_unchanged": True,
            "all_property_value_coercions_checked": len(expected_values),
            "ordered_list_rdf_roundtrip": True, "set_containers_preserved": True,
        },
        "graph_preservation": {
            "original_ontology_triples": len(original_ontology), "release_ontology_triples": len(ontology),
            "added_codec_triples": len(delta), "removed_original_triples": 0,
            "original_restored_isomorphically": True, "original_inventory_definitions_unchanged": True,
            "codec_delta_subjects": [str(AV[name]) for name in CODECS],
            "added_triples": sorted(" ".join(term.n3() for term in triple) + " ." for triple in delta),
        },
        "runtime_term_audit": {
            "classes": len(classes), "av_properties": len(av_properties), "controlled_individuals": len(individuals),
            "ontology_av_iris_including_namespace_metadata": len(ontology_terms),
            "example_av_iris": len(example_av_terms), "shape_graph_av_iris": len(shape_terms),
            "original_named_shape_support_iris": sorted(map(str, original_support)),
            "support_scope": "These 39 inherited shape identifiers are support nodes, not context/runtime vocabulary.",
            "unknown_iris": [], "negative_detector_probes": negative_results,
            "unknown_external_codec_excluded_from_closed_set": True,
        },
        "examples": {
            "jsonld_expansion": True, "rdf_roundtrip_isomorphic": True,
            "h265_video": True, "joint_webrtc_h264_opus": True, "canonical_rationals": True,
            "unresolved_named_forms_and_configuration_pins": True, "admission_claim": False,
        },
        "candidate_shacl": {
            "original_triples": len(original_shapes), "release_triples": len(shapes),
            "only_three_codec_lists_extended": True, "original_graph_restored_isomorphically": True,
            "shacl_engine_executed": False, "full_shape_syntax_validated": False,
            "conformance_claim": False,
        },
        "presentation": {
            "catalogue_class_rows": 38, "catalogue_property_rows": 122,
            "catalogue_enum_set_rows": len(terms["enums"]), "catalogue_profile_rows": len(terms["profiles"]),
            "all_definitions_preserved": True, "release_note_words": len(note.split()),
            "source_artifacts_unchanged": True,
        },
    }


def main() -> None:
    verify_sources()
    original_terms = read_json(path(".terms.json", True))
    terms = make_terms(original_terms)
    original_ontology = Graph().parse(path(".ttl", True), format="turtle")
    original_shapes = Graph().parse(path(".shacl.ttl", True), format="turtle")
    write(".terms.json", compact_json(terms))
    write(".context.jsonld", context_text(read_json(path(".context.jsonld", True))))
    write(".ttl", compact_turtle(original_ontology + codec_graph(terms), terms, [
        "# Original unregistered vocabulary: https://example.org/wot/av#",
        "# External context https://example.org/wot/av/context/v0.1 is unhosted.",
        "# Original graph retained; only H265 and Opus controlled individuals/citations added.",
    ]))
    write(".shacl.ttl", compact_turtle(candidate_shapes(original_shapes), terms, [
        "# CANDIDATE structural SHACL; not SHACL-engine or admission conformance.",
        "# Original shapes retained except three codec sh:in lists; independent review remains separate.",
        "# Namespace unregistered; external AV context unhosted. No network/runtime checks.",
    ]))
    write(".catalog.md", catalogue(terms))
    write(".examples.jsonld", example_text(examples(terms)))
    checks = verify(terms, original_terms, original_ontology, original_shapes)
    write(".checks.json", compact_json(checks))
    artifacts = {}
    for suffix in OUTPUTS:
        if suffix == ".publication.json":
            continue
        file = path(suffix)
        artifacts[suffix] = {
            "path": str(file), "lines": len(file.read_bytes().splitlines()),
            "bytes": file.stat().st_size, "sha256": digest(file),
        }
    publication = {
        "status": terms["publication"]["status"], "prefix": str(PREFIX),
        "namespace": {"iri": str(AV), "registered": False},
        "context": {"iri": terms["context_url"], "hosted": False},
        "dependency_pins": terms["baseline"],
        "machine_checked_keys": checks["keys"],
        "source_artifacts": {suffix: {"path": str(path(suffix, True)), "sha256": sha}
                             for suffix, sha in SOURCE_HASHES.items()},
        "artifacts": artifacts,
        "manifest_scope": (
            "SHA-256 covers exact file bytes. This manifest intentionally excludes its "
            "own hash; no file embeds its own hash. Hashes establish integrity, not authenticity."
        ),
    }
    write(".publication.json", compact_json(publication))
    verify_sources()
    for suffix, item in artifacts.items():
        require(digest(path(suffix)) == item["sha256"], f"Output changed after hashing: {suffix}")
    print(json.dumps({"keys": checks["keys"], "note_words": checks["presentation"]["release_note_words"],
                      "artifacts": [{"path": str(path(suffix)),
                                     "lines": len(path(suffix).read_bytes().splitlines())}
                                    for suffix in OUTPUTS]}, indent=2))


if __name__ == "__main__":
    main()
