"""Explicit-file CLI for the two document-derived camera workflows."""

import argparse
import copy
import hashlib
import http.client
import json
import os
import ssl
import time
import uuid
from email.message import Message
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from lxml import etree

from public_contract import (
    Catalog, ConsumerError, PROFILES, SNAPSHOT, SOAP, WSA2004, WSA2005,
    expanded, fail, parse_json, parse_xml, read_json
)


def media_type(header, expected):
    message = Message()
    message["content-type"] = header
    if message.get_content_type() != expected:
        fail("InvalidXml", "Unexpected response media type")
    parameters = message.get_params()[1:]
    if len({key.lower() for key, value in parameters}) != len(parameters):
        fail("InvalidXml", "Duplicate response media-type parameter")
    charset = message.get_param("charset")
    if charset is not None and charset.lower().replace("-", "") != "utf8":
        fail("UnsupportedCapability", "Only UTF-8 response charset is supported")
    return message


def http_exchange(method, target, body, headers, deadline, limit):
    parsed = urlsplit(target)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.fragment:
        fail("PolicyDenied", "Invalid physical HTTP target")
    if parsed.scheme == "http" and parsed.hostname != "127.0.0.1":
        fail("PolicyDenied", "Plain HTTP is confined to explicit IPv4 loopback")
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        fail("Timeout", "Invocation budget expired before transmission")
    connection = (http.client.HTTPSConnection(parsed.hostname, parsed.port,
                                               timeout=remaining, context=ssl.create_default_context())
                  if parsed.scheme == "https" else
                  http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=remaining))
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    sent = False
    try:
        sent = True
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        received = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ConsumerError("Timeout", "Response budget expired", "unknown")
            if connection.sock is not None:
                connection.sock.settimeout(remaining)
            chunk = response.read1(min(65536, limit + 1 - len(received)))
            if not chunk:
                break
            received.extend(chunk)
            if len(received) > limit:
                raise ConsumerError("ResourceLimit", "Response exceeds the declared byte limit", "unknown")
        if 300 <= response.status < 400:
            raise ConsumerError("PolicyDenied", "Redirect is not an authorized target", "unknown")
        if response.getheader("Content-Encoding", "identity").lower() != "identity":
            raise ConsumerError("UnsupportedCapability", "Content coding is outside the pilot", "unknown")
        return response.status, response.getheader("Content-Type", ""), bytes(received)
    except (OSError, http.client.HTTPException) as error:
        raise ConsumerError("OutcomeUnknown" if sent else "Timeout",
                            "HTTP exchange did not establish a result",
                            "unknown" if sent else "not-sent") from error
    finally:
        connection.close()


def security_headers(td, names, credentials, policy):
    names = [names] if isinstance(names, str) else names
    if not names or not isinstance(names, list) or len(names) != 1:
        fail("UnsupportedCapability", "Pilot selects exactly one explicit security mechanism")
    definitions = td.get("securityDefinitions", {})
    if names[0] not in definitions:
        fail("InvalidSecurity", "Unresolved security definition")
    scheme = definitions[names[0]].get("scheme")
    if scheme == "nosec":
        if policy.get("principal") != "anonymous":
            fail("PolicyDenied", "Explicit anonymous intent is required")
        return {}
    if scheme == "bearer":
        credential = credentials.get(names[0])
        if not credential or not isinstance(credential, str) or any(c in credential for c in "\r\n"):
            fail("AuthenticationFailed", "Missing out-of-band scoped credential")
        return {"Authorization": "Bearer " + credential}
    fail("UnsupportedCapability", "Selected authentication is outside this pilot: " + str(scheme))


def qname_value(node):
    text = (node.text or "").strip(" \t\r\n")
    pieces = text.split(":")
    if len(pieces) == 1:
        prefix, local = None, pieces[0]
    elif len(pieces) == 2:
        prefix, local = pieces
        if prefix not in node.nsmap:
            fail("InvalidXml", "Unbound QName prefix")
    else:
        fail("InvalidXml", "Malformed lexical QName")
    try:
        etree.QName(local)
    except ValueError as error:
        raise ConsumerError("InvalidXml", "Invalid QName local name") from error
    return {"namespace": node.nsmap.get(prefix, ""), "localName": local}


def native_fault(node):
    code = node.find(expanded({"namespace": SOAP, "localName": "Code"}))
    if code is None or code.find("{" + SOAP + "}Value") is None:
        fail("InvalidXml", "Fault is missing its Code")
    result = {"code": qname_value(code.find("{" + SOAP + "}Value")), "subcodes": []}
    subcode = code.find("{" + SOAP + "}Subcode")
    while subcode is not None:
        value = subcode.find("{" + SOAP + "}Value")
        if value is None:
            fail("InvalidXml", "Fault Subcode lacks Value")
        result["subcodes"].append(qname_value(value))
        subcode = subcode.find("{" + SOAP + "}Subcode")
    result["reasons"] = [
        {"language": reason.get("{http://www.w3.org/XML/1998/namespace}lang"),
         "text": reason.text or ""}
        for reason in node.findall("{" + SOAP + "}Reason/{" + SOAP + "}Text")
    ]
    if not result["reasons"] or any(not reason["language"] for reason in result["reasons"]):
        fail("InvalidXml", "Fault Reason requires language")
    for key in ("Node", "Role"):
        value = node.find("{" + SOAP + "}" + key)
        result[key.lower()] = None if value is None else value.text
    detail = node.find("{" + SOAP + "}Detail")
    result["detailXml"] = None if detail is None else etree.tostring(detail, encoding="unicode")
    certainty = "rejected" if result["code"] == {"namespace": SOAP, "localName": "Sender"} else "unknown"
    raise ConsumerError("NativeFault", "Native SOAP fault", certainty, result)


class Consumer:
    def __init__(self, catalog, td, policy, document_uri, credentials=None):
        self.catalog = catalog
        self.td = copy.deepcopy(td)
        self.policy = copy.deepcopy(policy)
        self.document_uri = document_uri
        self.credentials = dict(credentials or {})
        if td.get("id") != policy.get("thingId"):
            fail("PolicyDenied", "Policy does not authorize this actual Thing")

    def invoke(self, operation_id, value=None):
        deadline = time.monotonic() + 5
        action = self.td.get("actions", {}).get(operation_id)
        if action is None:
            fail("InvalidContract", "TD does not expose the selected canonical operation")
        forms = [form for form in action.get("forms", [])
                 if "invokeaction" in ([form.get("op", "invokeaction")]
                                       if isinstance(form.get("op", "invokeaction"), str) else form["op"])]
        if len(forms) != 1:
            fail("InvalidContract", "Select one unambiguous Action Form")
        form = forms[0]
        operation = self.catalog.operation(operation_id, form, action)
        target = urljoin(self.td.get("base", self.document_uri), form["href"])
        if "{" in target or target != self.policy.get("targets", {}).get(operation_id):
            fail("PolicyDenied", "Exact operation and expanded target are not authorized")
        if form.get("htv:methodName", "POST") != "POST":
            fail("InvalidContract", "Camera Action requires POST")
        headers = security_headers(self.td, form.get("security", self.td.get("security")),
                                   self.credentials, self.policy)
        value = {} if value is None else value
        self.catalog.validate(operation_id, "input", value)
        native = form.get("onvif:binding") == "soap12-http-v1"
        if "onvif:binding" in form and not native:
            fail("UnsupportedCapability", "Unknown selected binding")
        if native:
            declared = media_type(form.get("contentType", "application/soap+xml"), "application/soap+xml")
            if declared.get_param("action") not in (None, operation["soapAction"]):
                fail("InvalidContract", "Form media-type action differs from the native catalog")
            payload = self.catalog.codec.encode(operation["request"], value)
            body, message_id, namespace = self.envelope(operation, target, payload)
            headers["Content-Type"] = 'application/soap+xml; charset=utf-8; action="' + operation["soapAction"] + '"'
        else:
            media_type(form.get("contentType", "application/json"), "application/json")
            body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        status, content_type, raw = http_exchange("POST", target, body, headers, deadline, 1024 * 1024)
        try:
            if status in (401, 403):
                raise ConsumerError("AuthenticationFailed" if status == 401 else "PolicyDenied",
                                    "HTTP authentication or authorization rejected", "rejected",
                                    {"httpStatus": status})
            if native:
                media_type(content_type, "application/soap+xml")
                result = self.soap_response(operation, raw, message_id, namespace)
            else:
                media_type(content_type, "application/json")
                if not 200 <= status < 300:
                    raise ConsumerError("NativeFault", "Adapter rejected the operation", "rejected",
                                        {"httpStatus": status})
                try:
                    result = parse_json(raw.decode("utf-8"))
                except UnicodeDecodeError as error:
                    raise ConsumerError("InvalidValue", "Invalid UTF-8 JSON response", "unknown") from error
            if not 200 <= status < 300:
                raise ConsumerError("OutcomeUnknown", "Non-success HTTP response without native rejection", "unknown")
            self.catalog.validate(operation_id, "output", result)
            if not native:
                self.catalog.codec.encode(operation["response"], result)
            return result
        except ConsumerError as error:
            if error.certainty == "not-sent":
                error.certainty = "unknown"
            raise

    def envelope(self, operation, target, payload):
        epr = self.policy.get("epr", {
            "address": target, "addressingNamespace": WSA2005,
            "referenceProperties": [], "referenceParameters": []
        })
        namespace = epr["addressingNamespace"]
        if namespace not in (WSA2004, WSA2005):
            fail("InvalidContract", "Unsupported EPR addressing version")
        if namespace == WSA2005 and epr["referenceProperties"]:
            fail("InvalidContract", "WSA2005 cannot carry reference properties")
        if (epr["address"] != target or epr["referenceProperties"] or epr["referenceParameters"]):
            if self.policy.get("approvedLogicalRoute") is not True:
                fail("PolicyDenied", "Independent exact logical-route grant is missing")
        envelope = etree.Element("{" + SOAP + "}Envelope", nsmap={"s": SOAP, "w": namespace})
        header = etree.SubElement(envelope, "{" + SOAP + "}Header")
        for name, text in (("Action", operation["addressingAction"]), ("To", epr["address"])):
            node = etree.SubElement(header, "{" + namespace + "}" + name)
            node.text = text
            node.set("{" + SOAP + "}mustUnderstand", "true")
        message_id = "urn:uuid:" + str(uuid.uuid4())
        etree.SubElement(header, "{" + namespace + "}MessageID").text = message_id
        reply = etree.SubElement(header, "{" + namespace + "}ReplyTo")
        anonymous = namespace + ("/anonymous" if namespace == WSA2005 else "/role/anonymous")
        etree.SubElement(reply, "{" + namespace + "}Address").text = anonymous
        for collection in ("referenceProperties", "referenceParameters"):
            for xml in epr[collection]:
                parameter = parse_xml(xml.encode("utf-8"))
                if etree.QName(parameter).namespace in (SOAP, WSA2004, WSA2005,
                        "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"):
                    fail("PolicyDenied", "Reference header cannot replace protocol control")
                if namespace == WSA2005:
                    parameter.set("{" + WSA2005 + "}IsReferenceParameter", "true")
                header.append(parameter)
        etree.SubElement(envelope, "{" + SOAP + "}Body").append(payload)
        return etree.tostring(envelope, encoding="utf-8", xml_declaration=True), message_id, namespace

    def soap_response(self, operation, raw, message_id, namespace):
        envelope = parse_xml(raw)
        if envelope.tag != "{" + SOAP + "}Envelope":
            fail("InvalidXml", "Not a SOAP 1.2 Envelope")
        headers = envelope.findall("{" + SOAP + "}Header")
        bodies = envelope.findall("{" + SOAP + "}Body")
        if len(headers) != 1 or len(bodies) != 1 or len(bodies[0]) != 1 or len(envelope) != 2:
            fail("InvalidXml", "Unexpected SOAP Envelope/Body structure")
        header = headers[0]
        for item in header:
            qname = etree.QName(item)
            understood = qname.namespace == namespace and qname.localname in ("Action", "RelatesTo", "To", "MessageID")
            if qname.namespace in (WSA2004, WSA2005) and qname.namespace != namespace:
                fail("InvalidXml", "Response changed addressing version")
            if not understood and item.get("{" + SOAP + "}mustUnderstand") in ("true", "1"):
                fail("UnsupportedCapability", "Unknown mandatory SOAP header")
        related = header.findall("{" + namespace + "}RelatesTo")
        if len(related) != 1 or related[0].text != message_id:
            fail("InvalidXml", "Missing, duplicate or unrelated response correlation")
        relationship = related[0].get("RelationshipType")
        if relationship is not None:
            required = namespace + "/reply" if namespace == WSA2005 else None
            if relationship != required:
                fail("UnsupportedCapability", "Unsupported correlation relationship")
        actions = header.findall("{" + namespace + "}Action")
        if len(actions) > 1:
            fail("InvalidXml", "Duplicate response Action")
        payload = bodies[0][0]
        if payload.tag == "{" + SOAP + "}Fault":
            native_fault(payload)
        if operation.get("responseAction") and (len(actions) != 1 or actions[0].text != operation["responseAction"]):
            fail("InvalidXml", "Wrong response Action")
        return self.catalog.codec.decode(operation["response"], payload)

    def jpeg(self, uri):
        prefix = self.policy.get("imagePrefix")
        if not prefix or not uri.startswith(prefix) or urlsplit(uri).netloc != urlsplit(prefix).netloc:
            fail("PolicyDenied", "Returned image URI was not independently authorized")
        security = self.policy.get("imageSecurity")
        if security is None:
            fail("PolicyDenied", "Separate image security selection is required")
        headers = security_headers(self.td, security, self.credentials, self.policy)
        status, content_type, raw = http_exchange("GET", uri, None, headers,
                                                time.monotonic() + 5, 16 * 1024 * 1024)
        if status != 200 or content_type.split(";")[0].strip().lower() != "image/jpeg":
            raise ConsumerError("NativeFault", "JPEG acquisition did not succeed", "rejected",
                                {"httpStatus": status})
        return raw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--onvif-root", required=True, type=Path)
    parser.add_argument("--td", required=True, type=Path)
    parser.add_argument("--policy", required=True, type=Path,
                        help="Independently trusted exact target/principal/EPR policy, not supplied by the TD")
    parser.add_argument("--profiles-input", required=True, type=Path)
    parser.add_argument("--document-uri", required=True)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--all-profiles", action="store_true")
    selection.add_argument("--profile-token")
    parser.add_argument("--image-directory", type=Path, help="Explicitly opt into HTTP JPEG GET and file output")
    parser.add_argument("--credential-env", action="append", default=[], metavar="SECURITY_NAME=ENV_NAME")
    args = parser.parse_args()
    try:
        credentials = {}
        for assignment in args.credential_env:
            name, variable = assignment.split("=", 1)
            credentials[name] = os.environ.get(variable)
        client = Consumer(Catalog(args.onvif_root), read_json(args.td), read_json(args.policy),
                          args.document_uri, credentials)
        profiles = client.invoke(PROFILES, read_json(args.profiles_input))
        tokens = [profile["$attributes"]["token"] for profile in profiles["Profiles"]]
        selected = tokens if args.all_profiles else [args.profile_token]
        if any(token not in tokens for token in selected):
            fail("InvalidValue", "Caller-selected profile was not returned by GetProfiles")
        results = []
        for index, token in enumerate(selected):
            output = client.invoke(SNAPSHOT, {"ProfileToken": token})
            item = {"ProfileToken": token, "result": output}
            if args.image_directory is not None:
                raw = client.jpeg(output["Uri"])
                args.image_directory.mkdir(parents=True, exist_ok=True)
                path = args.image_directory / ("snapshot-" + str(index) + ".jpg")
                with path.open("xb") as stream:
                    stream.write(raw)
                item["image"] = {"path": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
            results.append(item)
        print(json.dumps({"profiles": profiles, "snapshots": results}, indent=4))
    except ConsumerError as error:
        print(json.dumps({"error": error.category, "certainty": error.certainty,
                          "message": str(error), "detail": error.detail}, indent=4))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
