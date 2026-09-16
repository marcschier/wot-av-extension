"""Independent literal-SOAP loopback source; never imports the consumer codec."""

import io
import json
import threading
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote
from xml.sax.saxutils import escape, quoteattr

from PIL import Image


SOAP = "http://www.w3.org/2003/05/soap-envelope"
MEDIA = "http://www.onvif.org/ver20/media/wsdl"
DEVICE = "http://www.onvif.org/ver10/device/wsdl"
WSA2005 = "http://www.w3.org/2005/08/addressing"


class CameraFixture:
    def __init__(self, declaration):
        self.declaration = declaration
        self.requests = []
        self.reply_mode = "normal"
        image = Image.new("RGB", (declaration["jpeg"]["width"], declaration["jpeg"]["height"]),
                          tuple(declaration["jpeg"]["rgb"]))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=95)
        self.jpeg = buffer.getvalue()
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, format_string, *args):
                pass

            def respond(self, status, content_type, body):
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                fixture.requests.append({"method": "GET", "path": self.path})
                issued = {"/images/" + p["token"] + ".jpg" for p in fixture.declaration["profiles"]}
                if unquote(self.path) not in issued:
                    self.respond(404, "application/json", b'{"error":"unknown-image"}')
                    return
                self.respond(200, "image/jpeg", fixture.jpeg)

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 65536:
                    self.respond(413, "application/json", b'{"error":"bounded-request-required"}')
                    return
                raw = self.rfile.read(length)
                root = ET.fromstring(raw)
                header = root.find("{" + SOAP + "}Header")
                body = root.find("{" + SOAP + "}Body")
                operation = list(body)[0]
                namespace = next(child.tag[1:].split("}", 1)[0] for child in header
                                 if child.tag.endswith("}MessageID"))
                message_id = header.find("{" + namespace + "}MessageID").text
                name = operation.tag.split("}", 1)[1]
                fixture.requests.append({
                    "method": "POST", "path": self.path, "operation": name,
                    "contentType": self.headers.get("Content-Type"),
                    "soapActionHeader": self.headers.get("SOAPAction"),
                    "xml": raw.decode("utf-8")
                })
                prefix = '<m:GetProfilesResponse xmlns:m="' + MEDIA + '">'
                status = 201
                if operation.tag == "{" + MEDIA + "}GetProfiles":
                    token = operation.find("{" + MEDIA + "}Token")
                    profiles = fixture.declaration["profiles"]
                    selected = profiles if token is None else [p for p in profiles if p["token"] == token.text]
                    if token is not None and not selected:
                        payload, status = self.fault(), 400
                    elif operation.find("{" + MEDIA + "}Type") is not None:
                        self.respond(422, "application/json", b'{"error":"fixture-configuration-detail-not-implemented"}')
                        return
                    else:
                        items = []
                        for profile in selected:
                            fixed = (' fixed="' + str(profile["fixed"]).lower() + '"') if "fixed" in profile else ""
                            items.append("<m:Profiles token=" + quoteattr(profile["token"]) + fixed +
                                         "><m:Name>" + escape(profile["name"]) + "</m:Name></m:Profiles>")
                        payload = prefix + "".join(items) + "</m:GetProfilesResponse>"
                elif operation.tag == "{" + MEDIA + "}GetSnapshotUri":
                    token = operation.find("{" + MEDIA + "}ProfileToken")
                    if token is None or token.text not in {p["token"] for p in fixture.declaration["profiles"]}:
                        payload, status = self.fault(), 400
                    else:
                        uri = fixture.origin + "/images/" + token.text + ".jpg"
                        payload = '<m:GetSnapshotUriResponse xmlns:m="' + MEDIA + '"><m:Uri>' + escape(uri) + \
                                  "</m:Uri></m:GetSnapshotUriResponse>"
                        if fixture.reply_mode == "missing-uri":
                            payload = '<m:GetSnapshotUriResponse xmlns:m="' + MEDIA + '"/>'
                        elif fixture.reply_mode == "nil-uri":
                            payload = '<m:GetSnapshotUriResponse xmlns:m="' + MEDIA + \
                                      '" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><m:Uri xsi:nil="true"/>' + \
                                      "</m:GetSnapshotUriResponse>"
                        elif fixture.reply_mode == "wrong-root":
                            payload = payload.replace("GetSnapshotUriResponse", "GetStreamUriResponse")
                elif operation.tag == "{" + DEVICE + "}GetDeviceInformation":
                    fields = {
                        "Manufacturer": "Fictional software source",
                        "Model": "Independent literal-SOAP fixture",
                        "FirmwareVersion": "fixture-not-firmware",
                        "SerialNumber": "not-hardware",
                        "HardwareId": "software-only"
                    }
                    payload = '<d:GetDeviceInformationResponse xmlns:d="' + DEVICE + '">' + "".join(
                        "<d:" + key + ">" + escape(value) + "</d:" + key + ">" for key, value in fields.items()
                    ) + "</d:GetDeviceInformationResponse>"
                else:
                    self.respond(403, "application/json", b'{"error":"operation-not-allowed"}')
                    return
                extra = ('<r:Required xmlns:r="urn:example:implementer:unknown" s:mustUnderstand="true"/>'
                         if fixture.reply_mode == "must-understand" else "")
                reply = '<s:Envelope xmlns:s="' + SOAP + '" xmlns:w="' + namespace + '">' + \
                        "<s:Header><w:RelatesTo>" + escape(message_id) + "</w:RelatesTo>" + extra + \
                        "</s:Header><s:Body>" + payload + "</s:Body></s:Envelope>"
                charset = "iso-8859-1" if fixture.reply_mode == "charset" else "utf-8"
                self.respond(status, "application/soap+xml; charset=" + charset, reply.encode("utf-8"))

            @staticmethod
            def fault():
                return (
                    '<s:Fault xmlns:s="' + SOAP + '" xmlns:ter="http://www.onvif.org/ver10/error">'
                    "<s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:InvalidArgVal</s:Value>"
                    "<s:Subcode><s:Value>ter:NoProfile</s:Value></s:Subcode></s:Subcode></s:Code>"
                    '<s:Reason><s:Text xml:lang="en">The requested profile token does not exist.</s:Text></s:Reason>'
                    "<s:Node>urn:example:implementer:fault-node</s:Node>"
                    "<s:Role>urn:example:implementer:fault-role</s:Role>"
                    '<s:Detail><d:MissingProfile xmlns:d="urn:example:implementer:detail" token="not-issued"/></s:Detail>'
                    "</s:Fault>"
                )

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = "http://127.0.0.1:" + str(self.server.server_address[1])
        self.thread = threading.Thread(target=self.server.serve_forever, name="implementer-native-loopback")

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, kind, value, traceback):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        if self.thread.is_alive():
            raise RuntimeError("Owned native HTTP fixture did not close naturally")
