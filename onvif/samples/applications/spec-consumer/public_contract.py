"""Bounded document-derived canonical values; no reference-runtime imports."""

import copy
import hashlib
import json
import re
from pathlib import Path

from jsonschema import Draft202012Validator
from lxml import etree


SOAP = "http://www.w3.org/2003/05/soap-envelope"
WSA2004 = "http://schemas.xmlsoap.org/ws/2004/08/addressing"
WSA2005 = "http://www.w3.org/2005/08/addressing"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
MEDIA = "http://www.onvif.org/ver20/media/wsdl"
PROFILES = "Media2Binding_GetProfiles_95aacf693b24"
SNAPSHOT = "Media2Binding_GetSnapshotUri_c14d66eeeeff"
DEVICE = "DeviceBinding_GetDeviceInformation_80e5d5eeab01"


class ConsumerError(Exception):
    def __init__(self, category, message, certainty="not-sent", detail=None):
        super().__init__(message)
        self.category = category
        self.certainty = certainty
        self.detail = detail


def fail(category, message):
    raise ConsumerError(category, message)


def parse_json(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail("InvalidValue", "Duplicate JSON member: " + key)
            result[key] = value
        return result

    def invalid_constant(value):
        fail("InvalidValue", "Non-JSON numeric constant: " + value)

    try:
        value = json.loads(text, object_pairs_hook=unique, parse_constant=invalid_constant)
    except json.JSONDecodeError as error:
        raise ConsumerError("InvalidValue", "Malformed JSON") from error

    def check_strings(item, depth=0):
        if depth > 64:
            fail("ResourceLimit", "JSON nesting bound")
        if isinstance(item, str):
            if any(0xD800 <= ord(character) <= 0xDFFF for character in item):
                fail("InvalidValue", "Unpaired JSON surrogate")
        elif isinstance(item, dict):
            for key, child in item.items():
                check_strings(key, depth + 1)
                check_strings(child, depth + 1)
        elif isinstance(item, list):
            for child in item:
                check_strings(child, depth + 1)
    check_strings(value)
    return value


def read_json(path):
    return parse_json(Path(path).read_text(encoding="utf-8"))


def expanded(name):
    return "{" + name["namespace"] + "}" + name["localName"] if name["namespace"] else name["localName"]


def operation_key(operation):
    return tuple(operation[name][part] for name in ("bindingQName", "portTypeQName")
                 for part in ("namespace", "localName")) + (operation["operation"],)


def parse_xml(raw):
    if len(raw) > 1024 * 1024:
        fail("ResourceLimit", "XML exceeds the 1 MiB pilot bound")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ConsumerError("InvalidXml", "Invalid UTF-8 XML") from error
    if re.search(r"<!\s*(DOCTYPE|ENTITY)\b", text, re.IGNORECASE):
        fail("InvalidXml", "DTD and entity declarations are forbidden")
    declaration = re.match(r"<\?xml[^?]*encoding\s*=\s*['\"]([^'\"]+)", text)
    if declaration and declaration[1].lower().replace("-", "") != "utf8":
        fail("UnsupportedCapability", "Only UTF-8 XML is supported")
    try:
        root = etree.fromstring(raw, etree.XMLParser(
            resolve_entities=False, no_network=True, load_dtd=False,
            remove_comments=False, remove_pis=False, huge_tree=False))
    except etree.XMLSyntaxError as error:
        raise ConsumerError("InvalidXml", "Malformed XML") from error
    nodes = list(root.iter())
    if len(nodes) > 10000 or any(len(node.attrib) > 64 for node in nodes):
        fail("ResourceLimit", "XML node/attribute bound exceeded")
    for node in nodes:
        if len(list(node.iterancestors())) > 48 or len(node.nsmap) > 64:
            fail("ResourceLimit", "XML depth/namespace bound exceeded")
    return root


class Catalog:
    def __init__(self, root):
        self.root = Path(root)
        self.data = read_json(self.root / "catalog.json")
        self.payloads = read_json(self.root / "payloads.schema.json")
        self.manifest = read_json(self.root / "model-manifest.json")
        self.lock = read_json(self.root / "sources.lock.json")
        self.operations = {op["id"]: op for op in self.data["operations"]}
        self.by_tuple = {operation_key(op): op for op in self.data["operations"]}
        if len(self.by_tuple) != len(self.operations):
            fail("InvalidContract", "Duplicate operation identity")
        for name in ("catalog.json", "payloads.schema.json"):
            artifacts = [a for a in self.manifest["artifacts"]
                         if a.get("physicalPath") == "onvif/" + name]
            if len(artifacts) != 1:
                fail("IntegrityFailure", "Missing unique manifest entry: " + name)
            digest = hashlib.sha256((self.root / name).read_bytes()).hexdigest()
            if digest != artifacts[0]["sha256"]:
                fail("IntegrityFailure", "Manifest digest mismatch: " + name)
        operations = sorted(self.data["operations"],
                            key=lambda op: json.dumps(operation_key(op), separators=(",", ":"), ensure_ascii=False))
        canonical = json.dumps({"operations": operations, "xml": self.data["xml"]},
                               sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if digest != self.data["registryDigest"]:
            fail("IntegrityFailure", "Public registry recipe mismatch")
        self.codec = Codec(self.data["xml"])

    def validate(self, operation_id, direction, value):
        definition = direction + "_" + operation_id
        if definition not in self.payloads["$defs"]:
            fail("InvalidContract", "Missing public payload fragment")
        schema = {
            "$defs": self.payloads["$defs"],
            "$ref": "#/$defs/" + definition
        }
        errors = Draft202012Validator(schema).iter_errors(value)
        error = next(errors, None)
        if error is not None:
            raise ConsumerError("InvalidValue", "Canonical payload schema rejected at " +
                                "/".join(map(str, error.absolute_path)))

    def operation(self, operation_id, form, action):
        if operation_id not in self.operations:
            fail("InvalidContract", "Operation is not in the public catalog")
        op = self.operations[operation_id]
        source = op["input"]["elementSource"]
        records = [item for item in self.lock["sources"] if item["id"] == source["sourceId"]]
        if len(records) != 1 or records[0]["sha256"] != source["sha256"]:
            fail("IntegrityFailure", "Native source/catalog pin disagreement")
        path = self.root / "support" / "upstream" / "onvif"
        path = path.joinpath(*records[0]["relativePath"].split("/"))
        if hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]:
            fail("IntegrityFailure", "Selected native source bytes differ")
        if form.get("onvif:binding") == "soap12-http-v1":
            reference = form.get("onvif:operation")
            if not reference or operation_key(reference) != operation_key(op):
                fail("InvalidContract", "Native tuple mismatch")
            if form.get("onvif:soapAction", op["soapAction"]) != op["soapAction"]:
                fail("InvalidContract", "Native SOAP action mismatch")
        for direction, role in (("input", "request"), ("output", "response")):
            schema = action.get(direction)
            expected = self.payloads["$id"] + "#/$defs/" + direction + "_" + operation_id
            if not schema or schema.get("onvif:sourceDataSchema") != expected:
                fail("InvalidContract", "Canonical root schema is missing or different")
            if schema.get("onvif:xmlQName", op[role]["name"]) != op[role]["name"]:
                fail("InvalidContract", "Canonical root QName mismatch")
        return op


class Codec:
    """Selected scalar/element-sequence dialect, rejecting other present constructs."""

    def __init__(self, registry):
        self.registry = registry

    def resolve(self, descriptor):
        visited = set()
        while descriptor["kind"] == "ref":
            key = descriptor["ref"]
            if key in visited or key not in self.registry["types"]:
                fail("InvalidContract", "Unresolved or cyclic type alias")
            visited.add(key)
            descriptor = self.registry["types"][key]
        return descriptor

    def scalar(self, descriptor, value, decode):
        descriptor = self.resolve(descriptor)
        if descriptor["kind"] == "restriction":
            value = self.scalar(descriptor["base"], value, decode)
            facets = descriptor.get("facets", {})
            supported = {"length", "minLength", "maxLength", "enumeration", "whiteSpace"}
            if set(facets) - supported:
                fail("UnsupportedCapability", "Native facets exceed the pilot dialect")
            if "whiteSpace" in facets:
                if not isinstance(value, str):
                    fail("UnsupportedCapability", "Non-string whitespace restriction")
                normalized = value
                if facets["whiteSpace"] in ("replace", "collapse"):
                    normalized = re.sub(r"[\t\r\n]", " ", value)
                if facets["whiteSpace"] == "collapse":
                    normalized = " ".join(normalized.split(" "))
                    normalized = re.sub(" +", " ", normalized).strip(" ")
                if not decode and normalized != value:
                    fail("InvalidValue", "Canonical whitespace is not normalized")
                value = normalized
            for key, comparison in (
                ("length", lambda size, bound: size == bound),
                ("minLength", lambda size, bound: size >= bound),
                ("maxLength", lambda size, bound: size <= bound)
            ):
                if key in facets and not comparison(len(value), facets[key]):
                    fail("InvalidValue", "Native length restriction")
            if "enumeration" in facets:
                alternatives = [self.scalar(descriptor["base"], item["lexical"], True)
                                for item in facets["enumeration"]]
                if value not in alternatives:
                    fail("InvalidValue", "Native enumeration restriction")
            return value
        if descriptor["kind"] != "scalar":
            fail("UnsupportedCapability", "Simple type exceeds the pilot dialect")
        kind = descriptor["type"]
        if kind in ("string", "anyURI", "token", "normalizedString"):
            if not isinstance(value, str):
                fail("InvalidValue", "Expected canonical string")
            normalized = value
            if kind != "string":
                normalized = re.sub(r"[\t\r\n]", " ", value)
            if kind in ("token", "anyURI"):
                normalized = re.sub(" +", " ", normalized).strip(" ")
            if not decode and normalized != value:
                fail("InvalidValue", "Canonical whitespace is not normalized")
            return normalized
        if kind == "boolean":
            if decode:
                value = value.strip(" \t\r\n")
                if value not in ("true", "false", "1", "0"):
                    fail("InvalidValue", "Invalid native boolean")
                return value in ("true", "1")
            if type(value) is not bool:
                fail("InvalidValue", "Expected canonical boolean")
            return value
        if kind in ("int32", "uint32"):
            if decode:
                if not re.fullmatch(r"[+-]?[0-9]+", value.strip(" \t\r\n")):
                    fail("InvalidValue", "Invalid native integer")
                value = int(value)
            lower, upper = (0, 4294967295) if kind == "uint32" else (-2147483648, 2147483647)
            if type(value) is not int or not lower <= value <= upper:
                fail("InvalidValue", "Expected bounded canonical integer")
            return value
        fail("UnsupportedCapability", "Scalar is outside the selected pilot: " + kind)

    @staticmethod
    def lexical(value):
        if type(value) is bool:
            return "true" if value else "false"
        return str(value)

    def encode(self, element, value, depth=0):
        if depth > 32:
            fail("ResourceLimit", "Canonical depth bound")
        if element.get("unsupported"):
            fail("UnsupportedCapability", "Explicit unsupported element")
        descriptor = self.resolve(element["type"])
        node = etree.Element(expanded(element["name"]))
        if isinstance(value, dict) and "$type" in value:
            fail("UnsupportedCapability", "Derived types are outside the pilot")
        if isinstance(value, dict) and value.get("$nil") is True:
            if not element.get("nillable") or set(value) != {"$nil"}:
                fail("InvalidValue", "Invalid nil value")
            node.set("{" + XSI + "}nil", "true")
            return node
        if value == {"$default": True}:
            if "defaultLexical" not in element:
                fail("InvalidValue", "No declared default")
            return node
        if descriptor["kind"] != "complex":
            node.text = self.lexical(self.scalar(descriptor, value, False))
        else:
            if not isinstance(value, dict):
                fail("InvalidValue", "Expected canonical complex object")
            if descriptor.get("mixed") or descriptor.get("text") or descriptor.get("abstract"):
                fail("UnsupportedCapability", "Complex type exceeds the pilot dialect")
            attributes = value.get("$attributes", {})
            allowed_attributes = {a["key"]: a for a in descriptor.get("attributes", [])}
            if not isinstance(attributes, dict) or set(attributes) - set(allowed_attributes):
                fail("InvalidValue", "Unknown canonical attribute")
            for key, attribute in allowed_attributes.items():
                if key in attributes:
                    attribute_value = self.scalar(attribute["type"], attributes[key], False)
                    if "fixedLexical" in attribute and attribute_value != self.scalar(
                            attribute["type"], attribute["fixedLexical"], True):
                        fail("InvalidValue", "Fixed attribute mismatch")
                    node.set(expanded(attribute["name"]), self.lexical(attribute_value))
                elif attribute.get("required"):
                    fail("InvalidValue", "Missing required attribute")
            allowed = {"$attributes"}
            for particle in descriptor.get("sequence", []):
                if particle["kind"] != "element":
                    fail("UnsupportedCapability", "Particle exceeds the pilot dialect")
                key = particle["key"]
                allowed.add(key)
                maximum = particle.get("maxOccurs", 1)
                repeated = maximum == "unbounded" or maximum > 1
                supplied = value.get(key, []) if repeated else ([value[key]] if key in value else [])
                if not isinstance(supplied, list):
                    fail("InvalidValue", "Repeated value must be an array")
                if len(supplied) < particle.get("minOccurs", 1):
                    fail("InvalidValue", "Missing required element")
                if maximum != "unbounded" and len(supplied) > maximum:
                    fail("InvalidValue", "Too many element occurrences")
                for item in supplied:
                    node.append(self.encode(particle["element"], item, depth + 1))
            if set(value) - allowed:
                fail("InvalidValue", "Unknown canonical fields would be lost")
        if "fixedLexical" in element:
            expected = self.scalar(descriptor, element["fixedLexical"], True)
            if value != expected:
                fail("InvalidValue", "Native fixed value mismatch")
        return node

    def decode(self, element, node, depth=0):
        if depth > 32:
            fail("ResourceLimit", "Canonical depth bound")
        if node.tag != expanded(element["name"]):
            fail("InvalidXml", "Unexpected element QName")
        descriptor = self.resolve(element["type"])
        if node.get("{" + XSI + "}type") is not None:
            fail("UnsupportedCapability", "Derived types are outside the pilot")
        nil = node.get("{" + XSI + "}nil")
        if nil is not None:
            if nil not in ("true", "1", "false", "0"):
                fail("InvalidValue", "Invalid xsi:nil")
            if nil in ("false", "0"):
                fail("UnsupportedCapability", "Explicit false nil is outside the pilot")
            if not element.get("nillable") or len(node) or (node.text or "").strip():
                fail("InvalidValue", "Invalid nil content or non-nillable declaration")
            if set(node.attrib) != {"{" + XSI + "}nil"}:
                fail("UnsupportedCapability", "Attributed nil exceeds the pilot")
            return {"$nil": True}
        if "defaultLexical" in element and not len(node) and not (node.text or ""):
            if node.attrib:
                fail("UnsupportedCapability", "Attributed default exceeds the pilot")
            return {"$default": True}
        if descriptor["kind"] != "complex":
            if len(node) or node.attrib:
                fail("InvalidValue", "Unexpected content on simple value")
            value = self.scalar(descriptor, node.text or "", True)
        else:
            if descriptor.get("mixed") or descriptor.get("text") or descriptor.get("abstract"):
                fail("UnsupportedCapability", "Complex type exceeds the pilot dialect")
            if (node.text or "").strip() or any((child.tail or "").strip() for child in node):
                fail("InvalidValue", "Unexpected mixed content")
            value = {}
            known = {expanded(a["name"]): a for a in descriptor.get("attributes", [])}
            attributes = {}
            for name, lexical in node.attrib.items():
                if name not in known:
                    fail("UnsupportedCapability" if descriptor.get("anyAttributes") else "InvalidValue",
                         "Undeclared attribute")
                attribute = known[name]
                attributes[attribute["key"]] = self.scalar(attribute["type"], lexical, True)
            for attribute in known.values():
                if attribute.get("required") and attribute["key"] not in attributes:
                    fail("InvalidValue", "Missing required attribute")
                if attribute["key"] in attributes and "fixedLexical" in attribute:
                    if attributes[attribute["key"]] != self.scalar(attribute["type"], attribute["fixedLexical"], True):
                        fail("InvalidValue", "Fixed attribute mismatch")
            if attributes:
                value["$attributes"] = attributes
            children = list(node)
            position = 0
            for particle in descriptor.get("sequence", []):
                if particle["kind"] != "element":
                    fail("UnsupportedCapability", "Particle exceeds the pilot dialect")
                maximum = particle.get("maxOccurs", 1)
                items = []
                while position < len(children) and children[position].tag == expanded(particle["element"]["name"]):
                    items.append(self.decode(particle["element"], children[position], depth + 1))
                    position += 1
                if len(items) < particle.get("minOccurs", 1) or (maximum != "unbounded" and len(items) > maximum):
                    fail("InvalidValue", "Element occurrence violation")
                if maximum == "unbounded" or maximum > 1:
                    value[particle["key"]] = items
                elif items:
                    value[particle["key"]] = items[0]
            if position != len(children):
                fail("InvalidValue", "Unconsumed or out-of-order element")
        if "fixedLexical" in element and value != self.scalar(descriptor, element["fixedLexical"], True):
            fail("InvalidValue", "Native fixed value mismatch")
        return value


def native_documents(catalog, origin, logical_address, reference_headers):
    """Create fictional, explicitly configured documents; never discover an endpoint."""
    operations = read_json(catalog.root / "models" / "native" / "operations.tm.json")
    thing_id = "urn:example:implementer:fictional-camera"
    model_id = "urn:example:implementer:fictional-camera-model"
    ids = (DEVICE, PROFILES, SNAPSHOT)
    model = {
        "@context": copy.deepcopy(operations["@context"]),
        "@type": "tm:ThingModel",
        "id": model_id,
        "title": "Fictional configured native camera composite, not a full wrapper",
        "links": [{
            "rel": "tm:extends",
            "href": "https://example.org/wot/onvif/models/DeviceThing.tm.json",
            "type": "application/tm+json"
        }],
        "actions": {
            operation_id: {"tm:ref": operations["id"] + "#/actions/" + operation_id}
            for operation_id in ids
        }
    }
    td = {
        "@context": copy.deepcopy(operations["@context"]),
        "@type": "onvif:DeviceThing",
        "id": thing_id,
        "title": "Fictional T+M-style software endpoint; not hardware",
        "description": "Configured source declarations, not discovery, firmware registration or conformance.",
        "securityDefinitions": {"anonymous": {"scheme": "nosec"}},
        "security": ["anonymous"],
        "links": [{"rel": "type", "href": model_id, "type": "application/tm+json"}],
        "onvif:registryDigest": catalog.data["registryDigest"],
        "onvif:projection": {
            "category": "nativeMapping",
            "status": "observed-interface",
            "mappingEdition": "0.2-proposed",
            "nativeProtocol": True,
            "fullProfile": False,
            "evidence": [{
                "sourceId": "urn:example:implementer:configured-native-software",
                "detail": "Fictional Device/Media2 source; no camera hardware or registered firmware."
            }]
        },
        "onvif:profileClaims": [
            {"profile": profile, "edition": edition, "role": "device",
             "evidence": [{"sourceId": "urn:example:implementer:fictional-badge:" + profile,
                           "detail": "Fictional source badge only; partial interface, not conformance."}]}
            for profile, edition in (("T", "1.0"), ("M", "1.1"))
        ],
        "onvif:profileModels": [
            "https://example.org/wot/onvif/models/profiles/Profile-T-1.0.tm.json",
            "https://example.org/wot/onvif/models/profiles/Profile-M-1.1.tm.json"
        ],
        "actions": {}
    }
    targets = {}
    for operation_id in ids:
        action = copy.deepcopy(operations["actions"][operation_id])
        form = copy.deepcopy(action["forms"][0])
        form["href"] = origin + ("/native/device" if operation_id == DEVICE else "/native/media2")
        form["security"] = ["anonymous"]
        action["forms"] = [form]
        td["actions"][operation_id] = action
        targets[operation_id] = form["href"]
    policy = {
        "thingId": thing_id,
        "principal": "anonymous",
        "targets": targets,
        "imagePrefix": origin + "/images/",
        "imageSecurity": ["anonymous"],
        "epr": {
            "address": logical_address,
            "addressingNamespace": WSA2005,
            "referenceProperties": [],
            "referenceParameters": reference_headers
        },
        "approvedLogicalRoute": True
    }
    return td, model, policy
