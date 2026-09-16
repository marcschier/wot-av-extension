"""Independent Python-stdlib RTSP/RTP fixture; no GStreamer or media server library."""

from datetime import datetime, timezone
import hashlib
import re
import secrets
import socket
import struct
import threading
import time
from urllib.parse import urlsplit


START_UNIX = int(datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc).timestamp())
START_NTP_NS = (START_UNIX + 2208988800) * 1_000_000_000 + 250_000_000
END_NTP_NS = START_NTP_NS + 2_000_000_000
START_NTP = ((START_UNIX + 2208988800) << 32) | 0x40000000

# RFC 2435 type 1: one 16x16 MCU, four zero-DC luma blocks and two
# zero-DC chroma blocks. Standard Huffman DC=0/EOB codes; quantizers are one.
# The independent decoded oracle is exactly 384 I420 bytes of value 128.
JPEG_SCAN = int("001010" * 4 + "0000" * 2, 2).to_bytes(4, "big") + b"\xff\xd9"
JPEG_PAYLOAD = b"\x00\x00\x00\x00\x01\xff\x02\x02" + b"\x00\x00\x00\x80" + bytes([1]) * 128 + JPEG_SCAN
JPEG_I420 = bytes([128]) * 384
PCMU_PAYLOAD = bytes([0xFF, 0x7F, 0x80, 0x00]) * 40
PCM_S16LE = struct.pack("<hhhh", 0, 0, 32124, -32124) * 40
METADATA_XML = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<tt:MetadataStream xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:p="urn:example:p0">'
    '<tt:VideoAnalytics><tt:Frame UtcTime="2026-09-15T12:00:00.25Z">'
    '<tt:Object ObjectId="7"><tt:Extension><p:Label>caf\u00e9</p:Label>'
    '</tt:Extension></tt:Object></tt:Frame></tt:VideoAnalytics></tt:MetadataStream>'
).encode("utf-8")


def fixture_hashes():
    return {
        name: hashlib.sha256(value).hexdigest()
        for name, value in {
            "rtpJpegPayload": JPEG_PAYLOAD,
            "decodedI420": JPEG_I420,
            "rtpPcmuPayload": PCMU_PAYLOAD,
            "decodedPcmS16LE": PCM_S16LE,
            "metadataXml": METADATA_XML,
        }.items()
    }


def digest_parameters(value):
    if not value.startswith("Digest "):
        raise ValueError("The fixture accepts Digest, never Basic")
    expression = re.compile(r'\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s]+))\s*(?:,|$)')
    result = {}
    text = value[7:]
    while text:
        match = expression.match(text)
        if not match:
            raise ValueError("Malformed Digest authorization")
        name = match[1].lower()
        if name in result:
            raise ValueError("Duplicate Digest authorization parameter")
        result[name] = re.sub(r"\\(.)", r"\1", match[2]) if match[2] is not None else match[3]
        text = text[match.end():]
    return result


def clock_ns(value):
    match = re.fullmatch(r"(\d{8})T(\d{6})(?:\.(\d{1,9}))?Z", value)
    if not match:
        raise ValueError(f"Invalid replay clock lexical form: {value}")
    seconds = int(datetime.strptime(match[1] + match[2], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).timestamp())
    fraction = int((match[3] or "").ljust(9, "0"))
    return (seconds + 2208988800) * 1_000_000_000 + fraction


def rtp_packet(payload_type, sequence, timestamp, ssrc, payload, marker=True, replay=None):
    header = struct.pack("!BBHII", 0x90 if replay else 0x80,
        payload_type | (0x80 if marker else 0), sequence & 0xFFFF, timestamp & 0xFFFFFFFF, ssrc)
    if replay:
        ntp, flags, cseq = replay
        header += struct.pack("!HHQBBH", 0xABAC, 3, ntp, flags, cseq & 0xFF, 0)
    return header + payload


class RtspFixture:
    def __init__(self, *, mode="live", auth="none", cycles=4, metadata_pt=110,
                 teardown_status=200, teardown_delay=0.0, setup_delay=0.0,
                 metadata_loss=False, stall_media=False, username="fixture",
                 password="not-a-camera-password", realm="onvif-p0"):
        self.mode = mode
        self.auth = auth
        self.cycles = cycles
        self.metadata_pt = metadata_pt
        self.teardown_status = teardown_status
        self.teardown_delay = teardown_delay
        self.setup_delay = setup_delay
        self.metadata_loss = metadata_loss
        self.stall_media = stall_media
        self.username = username
        self.password = password
        self.realm = realm
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.records = []
        self.errors = []
        self.connections = []
        self.threads = []
        self.sent_packets = []
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.server.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(4)
        self.server.settimeout(0.1)
        self.port = self.server.getsockname()[1]
        self.path = "/p0/" + secrets.token_hex(8)
        self.base_uri = f"rtsp://127.0.0.1:{self.port}{self.path}"
        self.uri = self.base_uri + "?literal=a%2Fb"

    def __enter__(self):
        thread = threading.Thread(target=self._accept, name="owned-p0-rtsp", daemon=True)
        self.threads.append(thread)
        thread.start()
        return self

    def _accept(self):
        while not self.stop.is_set():
            try:
                connection, peer = self.server.accept()
            except socket.timeout:
                continue
            except OSError as error:
                if not self.stop.is_set():
                    self.errors.append(f"accept: {error}")
                return
            if peer[0] != "127.0.0.1":
                connection.close()
                self.errors.append("Unexpected non-loopback peer")
                continue
            connection.settimeout(0.2)
            with self.lock:
                self.connections.append(connection)
            thread = threading.Thread(target=self._serve, args=(connection,), daemon=True)
            self.threads.append(thread)
            thread.start()

    def _response(self, connection, send_lock, cseq, status=200, headers=(), body=b""):
        reason = {200: "OK", 401: "Unauthorized", 454: "Session Not Found", 500: "Internal Server Error"}.get(status, "Rejected")
        lines = [f"RTSP/1.0 {status} {reason}", f"CSeq: {cseq}", *headers, f"Content-Length: {len(body)}", "", ""]
        message = "\r\n".join(lines).encode("ascii") + body
        with send_lock:
            # Split even the status line; a TCP read is not an RTSP frame.
            connection.sendall(message[:7])
            connection.sendall(message[7:29])
            connection.sendall(message[29:])

    def _challenge(self, nonce, stale=False):
        suffix = ', stale=true' if stale else ""
        common = f'realm="{self.realm}", nonce="{nonce}", opaque="fixture-opaque"{suffix}'
        if self.auth == "basic":
            return ['WWW-Authenticate: Basic realm="onvif-p0"']
        algorithm = {
            "legacy": None, "md5": "MD5", "sha256": "SHA-256",
            "stale": "SHA-256", "mixed": "SHA-256",
            "sha512": "SHA-512-256", "sess": "MD5-sess", "auth-int": "SHA-256",
        }[self.auth]
        qop = "auth-int" if self.auth == "auth-int" else "auth, auth-int"
        challenge = "WWW-Authenticate: Digest " + common
        if algorithm:
            challenge += f', algorithm={algorithm}, qop="{qop}"'
        if self.auth == "mixed":
            return [challenge, 'WWW-Authenticate: Basic realm="onvif-p0"',
                "WWW-Authenticate: Digest " + common + ", algorithm=MD5"]
        return [challenge]

    def _authorize(self, headers, method, uri, nonce, nonce_counts):
        value = headers.get("authorization")
        if self.auth == "none":
            if value:
                raise ValueError("Unrequested credential disclosure on explicit no-auth fixture")
            return True, {}
        if not value:
            return False, {}
        values = digest_parameters(value)
        if self.auth in {"basic", "sha512", "sess", "auth-int"}:
            raise ValueError("Credentials disclosed for an unsupported challenge")
        algorithm = "SHA-256" if self.auth in {"sha256", "stale", "mixed"} else "MD5"
        if values.get("algorithm", "MD5").upper() != algorithm:
            raise ValueError("Wrong Digest algorithm / silent downgrade")
        if values.get("username") != self.username or values.get("realm") != self.realm:
            raise ValueError("Wrong scoped fixture principal/realm")
        if values.get("uri") != uri or values.get("nonce") != nonce:
            raise ValueError("Digest used a different URI or nonce")
        if values.get("opaque") != "fixture-opaque":
            raise ValueError("Digest opaque was not preserved")
        hash_name = "sha256" if algorithm == "SHA-256" else "md5"
        def h(text):
            return hashlib.new(hash_name, text.encode("utf-8")).hexdigest()
        ha1 = h(f"{self.username}:{self.realm}:{self.password}")
        ha2 = h(method + ":" + uri)
        if self.auth == "legacy":
            if any(name in values for name in ("qop", "nc", "cnonce")):
                raise ValueError("Invented qop in legacy Digest")
            expected = h(ha1 + ":" + nonce + ":" + ha2)
            count = None
        else:
            if values.get("qop") != "auth" or not re.fullmatch(r"[0-9a-f]{8}", values.get("nc", "")):
                raise ValueError("Wrong qop/nc syntax")
            if not re.fullmatch(r"[0-9a-f]{32}", values.get("cnonce", "")):
                raise ValueError("Missing 128-bit native cnonce")
            count = int(values["nc"], 16)
            if count != nonce_counts.get(nonce, 0) + 1:
                raise ValueError("Nonce count was reused, skipped, or shared across sessions")
            nonce_counts[nonce] = count
            expected = h(":".join((ha1, nonce, values["nc"], values["cnonce"], "auth", ha2)))
        if not secrets.compare_digest(expected, values.get("response", "")):
            raise ValueError("Independent Digest response mismatch")
        return True, {"algorithm": algorithm, "qop": values.get("qop"), "nc": count}

    def _sdp(self):
        lines = [
            "v=0", "o=- 1 1 IN IP4 127.0.0.1", "s=Owned synthetic P0",
            "c=IN IP4 127.0.0.1", "t=0 0", "a=control:*",
            "m=video 0 RTP/AVP 26", "a=rtpmap:26 JPEG/90000",
            "a=control:track0", "a=x-onvif-track:VIDEO001",
            "m=audio 0 RTP/AVP 0", "a=rtpmap:0 PCMU/8000/1",
            "a=control:track1", "a=x-onvif-track:AUDIO001",
            f"m=application 0 RTP/AVP {self.metadata_pt}",
            f"a=rtpmap:{self.metadata_pt} vnd.onvif.metadata/90000",
            "a=control:track2", "a=x-onvif-track:META001", "",
        ]
        if self.mode == "live":
            lines.insert(6, "a=range:npt=0-10")
        return "\r\n".join(lines).encode("ascii")

    def _media(self, connection, send_lock, channels, cseq, ended, session):
        if self.stall_media:
            return
        cut = METADATA_XML.index(b"\xc3\xa9") + 1
        fragments = [METADATA_XML[:cut], METADATA_XML[cut:-31], METADATA_XML[-31:]]
        try:
            if ended.wait(0.05):
                return
            for cycle in range(self.cycles):
                if ended.is_set() or self.stop.is_set():
                    return
                flags = 0x80 | (0x20 if cycle == 0 else 0) | (0x50 if cycle == self.cycles - 1 else 0)
                replay = (START_NTP + cycle * 0x01000000, flags, cseq) if self.mode == "recorded" else None
                packets = [
                    (0, rtp_packet(26, 1000 + cycle, 0x10000000 + cycle * 9000, 0x10203040, JPEG_PAYLOAD, replay=replay)),
                    (1, rtp_packet(0, 2000 + cycle, 0x20000000 + cycle * 160, 0x20304050, PCMU_PAYLOAD, replay=replay)),
                ]
                for index, fragment in enumerate(fragments):
                    if self.metadata_loss and cycle == 1 and index == 1:
                        continue
                    metadata_replay = (replay[0], flags if index == 0 else 0, cseq) if replay else None
                    packets.append((2, rtp_packet(self.metadata_pt,
                        65534 + cycle * 3 + index, 0xFFFFFFFE + cycle * 300 + index * 37,
                        0x30405060, fragment, marker=index == 2, replay=metadata_replay)))
                for track, packet in packets:
                    if ended.is_set() or self.stop.is_set():
                        return
                    frame = struct.pack("!BBH", 0x24, channels[track], len(packet)) + packet
                    with send_lock:
                        connection.sendall(frame[:2])
                        connection.sendall(frame[2:9])
                        connection.sendall(frame[9:])
                    with self.lock:
                        self.sent_packets.append((session, track + 1, packet))
                if ended.wait(0.06):
                    return
        except OSError as error:
            if not ended.is_set() and not self.stop.is_set():
                with self.lock:
                    self.errors.append(f"media: {error}")

    def _serve(self, connection):
        pending = bytearray()
        send_lock = threading.Lock()
        ended = threading.Event()
        session = "p0-" + secrets.token_hex(5)
        nonce = secrets.token_hex(16)
        nonce_counts = {}
        stale_done = False
        channels = {}
        last_cseq = -1
        try:
            while not self.stop.is_set() and not ended.is_set():
                try:
                    chunk = connection.recv(4096)
                except socket.timeout:
                    continue
                if not chunk:
                    break
                pending.extend(chunk)
                if len(pending) > 32768:
                    raise ValueError("RTSP request exceeded fixture limit")
                while pending:
                    if pending[0] == 0x24:
                        if len(pending) < 4:
                            break
                        size = struct.unpack_from("!H", pending, 2)[0] + 4
                        if len(pending) < size:
                            break
                        del pending[:size]
                        continue
                    boundary = pending.find(b"\r\n\r\n")
                    if boundary < 0:
                        break
                    lines = pending[:boundary].decode("ascii").split("\r\n")
                    method, uri, version = lines[0].split(" ")
                    if version != "RTSP/1.0":
                        raise ValueError("Only the declared RTSP/1.0 gate is accepted")
                    headers = {}
                    for line in lines[1:]:
                        name, value = line.split(":", 1)
                        name = name.lower()
                        if name in headers:
                            raise ValueError("Duplicate request header")
                        headers[name] = value.strip()
                    length = int(headers.get("content-length", "0"))
                    if not 0 <= length <= 1024:
                        raise ValueError("RTSP request body limit")
                    if len(pending) < boundary + 4 + length:
                        break
                    del pending[:boundary + 4 + length]
                    if not re.fullmatch(r"\d+", headers.get("cseq", "")):
                        raise ValueError("Missing/invalid CSeq")
                    cseq = int(headers["cseq"])
                    if cseq <= last_cseq:
                        raise ValueError("RTSP CSeq did not advance independently")
                    last_cseq = cseq
                    target = urlsplit(uri)
                    if target.hostname != "127.0.0.1" or target.port != self.port or not target.path.startswith(self.path):
                        raise ValueError("Unexpected native target")
                    record = {"session": session, "method": method, "cseq": cseq,
                        "authorizationPresent": "authorization" in headers,
                        "path": target.path, "range": headers.get("range"),
                        "require": headers.get("require"), "transport": headers.get("transport")}
                    with self.lock:
                        if len(self.records) >= 256:
                            raise ValueError("Fixture request limit")
                        self.records.append(record)
                    authorized, auth_info = self._authorize(headers, method, uri, nonce, nonce_counts)
                    record.update(auth_info)
                    if not authorized:
                        self._response(connection, send_lock, cseq, 401, self._challenge(nonce))
                        continue
                    if self.auth == "stale" and method == "DESCRIBE" and not stale_done:
                        nonce = secrets.token_hex(16)
                        stale_done = True
                        self._response(connection, send_lock, cseq, 401, self._challenge(nonce, stale=True))
                        continue
                    if method == "OPTIONS":
                        self._response(connection, send_lock, cseq,
                            headers=["Public: OPTIONS, DESCRIBE, SETUP, PLAY, PAUSE, GET_PARAMETER, TEARDOWN"])
                    elif method == "DESCRIBE":
                        self._response(connection, send_lock, cseq,
                            headers=["Content-Type: application/sdp", f"Content-Base: {self.base_uri}/"], body=self._sdp())
                    elif method == "SETUP":
                        track = int(target.path[-1])
                        if track not in range(3) or not headers.get("transport", "").startswith("RTP/AVP/TCP"):
                            raise ValueError("Unexpected track or transport")
                        if ended.wait(self.setup_delay) or self.stop.is_set():
                            break
                        channels[track] = (6, 10, 14)[track]
                        self._response(connection, send_lock, cseq, headers=[
                            f"Session: {session};timeout=10",
                            f"Transport: RTP/AVP/TCP;unicast;interleaved={channels[track]}-{channels[track]+1}",
                        ])
                    elif method == "PLAY":
                        if len(channels) != 3:
                            raise ValueError("PLAY before all three independent SETUPs")
                        native_range = headers.get("range", "")
                        if self.mode == "recorded":
                            if headers.get("require") != "onvif-replay" or headers.get("rate-control") != "no":
                                raise ValueError("Missing ONVIF replay headers")
                            if headers.get("frames") != "all" or float(headers.get("scale", "0")) != 1:
                                raise ValueError("Wrong declared forward replay policy")
                            if not native_range.startswith("clock="):
                                raise ValueError("Replay did not use absolute native clock range")
                            start, end = native_range[6:].split("-")
                            if (clock_ns(start), clock_ns(end)) != (START_NTP_NS, END_NTP_NS):
                                raise ValueError("Wrong GStreamer 1900 epoch / fractional clock conversion")
                        info = ",".join(
                            f"url={self.base_uri}/track{i};seq={seq};rtptime={stamp}"
                            for i, seq, stamp in [(0, 1000, 0x10000000), (1, 2000, 0x20000000), (2, 65534, 0xFFFFFFFE)]
                        )
                        self._response(connection, send_lock, cseq, headers=[
                            f"Session: {session}", "Range: " + (native_range or "npt=0-10"), "RTP-Info: " + info,
                        ])
                        thread = threading.Thread(target=self._media,
                            args=(connection, send_lock, dict(channels), cseq, ended, session), daemon=True)
                        self.threads.append(thread)
                        thread.start()
                    elif method == "TEARDOWN":
                        ended.set()
                        if self.teardown_delay:
                            self.stop.wait(self.teardown_delay)
                        if not self.stop.is_set():
                            self._response(connection, send_lock, cseq, self.teardown_status,
                                [f"Session: {session}"])
                        break
                    elif method == "GET_PARAMETER":
                        self._response(connection, send_lock, cseq, headers=[f"Session: {session}"])
                    elif method == "PAUSE":
                        raise ValueError("P0 close must suppress transitional PAUSE")
                    else:
                        raise ValueError(f"Unimplemented fixture method: {method}")
        except (OSError, ValueError) as error:
            if not self.stop.is_set() and not ended.is_set():
                with self.lock:
                    self.errors.append(f"control: {error}")
        finally:
            ended.set()
            connection.close()

    def __exit__(self, exc_type, exc, traceback):
        self.stop.set()
        self.server.close()
        with self.lock:
            connections = list(self.connections)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError as error:
                if error.errno not in {9, 22, 57, 10038, 10057, 10054}:
                    self.errors.append(f"cleanup: {error}")
            connection.close()
        for thread in list(self.threads):
            thread.join(timeout=3)
            if thread.is_alive():
                self.errors.append("Owned fixture thread did not finish")
