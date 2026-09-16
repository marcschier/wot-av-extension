"""Independent, owned RTSP/UDP/HTTP/TLS fixture using Python standard-library networking."""

import base64
import gzip
import hashlib
import json
from pathlib import Path
import re
import secrets
import select
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

for _parent in Path(__file__).resolve().parents:
    _tools = _parent / "onvif" / "tools" / "native-media"
    if (_tools / "native_paths.py").is_file():
        sys.path.insert(0, str(_tools))
        break
else:
    raise RuntimeError("Cannot locate the scoped native tools.")
from native_paths import NATIVE_ROOT, TEST_ROOT

from rtsp_fixture import (
    END_NTP_NS, JPEG_PAYLOAD, METADATA_XML, PCMU_PAYLOAD, START_NTP, START_NTP_NS,
    RtspFixture, clock_ns, digest_parameters, rtp_packet,
)


class TunnelIO:
    def __init__(self, incoming, outgoing, initial, trace):
        self.incoming = incoming
        self.outgoing = outgoing
        self.encoded = bytearray(initial)
        self.decoded = bytearray()
        self.trace = trace

    def recv(self, count):
        while not self.decoded:
            if len(self.encoded) >= 4:
                quartet = bytes(self.encoded[:4])
                del self.encoded[:4]
                self.decoded.extend(base64.b64decode(quartet, validate=True))
                self.trace["base64Quartets"] += 1
            else:
                chunk = self.incoming.recv(7)
                if not chunk:
                    if self.encoded:
                        raise ValueError("Truncated HTTP tunnel base64")
                    return b""
                self.encoded.extend(byte for byte in chunk if byte not in b" \r\n\t")
                self.trace["splitReads"] += 1
        result = bytes(self.decoded[:count])
        del self.decoded[:count]
        return result

    def sendall(self, data):
        self.outgoing.sendall(data)

    def close(self):
        self.incoming.close()
        self.outgoing.close()


class TlsIO:
    """Serialize the fixture TLS object without holding its lock while waiting."""

    def __init__(self, connection):
        self.connection = connection
        self.lock = threading.Lock()

    def recv(self, count):
        deadline = time.monotonic() + self.connection.gettimeout()
        while True:
            with self.lock:
                if self.connection.pending() or select.select([self.connection], [], [], 0)[0]:
                    return self.connection.recv(count)
            if time.monotonic() >= deadline:
                raise socket.timeout("Fixture TLS receive deadline")
            time.sleep(0.001)

    def sendall(self, data):
        with self.lock:
            self.connection.sendall(data)

    def close(self):
        with self.lock:
            self.connection.close()


class RuntimeFixture(RtspFixture):
    def __init__(self, *, transport="tcp", outer_auth="none", node=None,
                 wrong_host=False, gzip_metadata=False, documents=None,
                 sender_reports=False, backchannel=False, expected_ranges=None,
                 wrong_transport_source=False, metadata_incarnation=False,
                 redirect=None, expect_backchannel=None, metadata_reorder=False,
                 metadata_encoding=None, stale_replay=False, gzip_corrupt=False,
                 control_uri=None, control_delay=0, pause_status=200,
                 udp_sender_fault=None, **kwargs):
        super().__init__(**kwargs)
        self.transport = transport
        self.outer_auth = outer_auth
        self.outer_realm = "outer-native-fixture"
        self.outer_username = "tunnel-fixture"
        self.outer_password = "not-an-http-password"
        self.outer_nonce = secrets.token_hex(16)
        self.outer_counts = {}
        self.outer_records = []
        self.tunnels = {}
        self.tunnel_condition = threading.Condition()
        self.tunnel_trace = {"base64Quartets": 0, "splitReads": 0}
        self.gzip_metadata = gzip_metadata
        self.documents = documents
        self.sender_reports = sender_reports
        self.backchannel_enabled = backchannel
        self.expect_backchannel = backchannel if expect_backchannel is None else expect_backchannel
        self.backchannel_packets = []
        self.expected_ranges = expected_ranges
        self.wrong_transport_source = wrong_transport_source
        self.metadata_incarnation = metadata_incarnation
        self.metadata_reorder = metadata_reorder
        self.metadata_encoding = metadata_encoding
        self.gzip_corrupt = gzip_corrupt
        self.control_uri = control_uri
        self.control_delay = control_delay
        self.pause_status = pause_status
        self.stale_replay = stale_replay
        self.previous_play_cseq = None
        self.stale_packets = []
        self.media_finished = threading.Event()
        self.redirect = redirect
        self.redirected = False
        self.play_ranges = []
        self.udp_sockets = []
        self.udp_sender_fault = udp_sender_fault
        self.fault_sockets = {}
        self.injected_senders = []
        self.injected_packets = []
        self.tls_errors = []
        self.tls_connections = []
        self.tls_closed = threading.Event()
        self.tls_context = None
        self.certificate_directory = None
        self.ca_pem = ""
        self.outer_origin = f"{'https' if transport == 'https' else 'http'}://127.0.0.1:{self.port}"
        if transport == "tls":
            self.base_uri = self.base_uri.replace("rtsp:", "rtsps:", 1)
            self.uri = self.uri.replace("rtsp:", "rtsps:", 1)
        if transport in ("https", "tls"):
            if not node:
                raise ValueError("Use an explicit existing Node executable for ephemeral test certificate generation")
            command = [str(node), str(TEST_ROOT / "make-test-certificate.cjs")]
            if wrong_host:
                command.append("--wrong-host")
            generated = subprocess.run(command, check=True, capture_output=True, timeout=30)
            identity = json.loads(generated.stdout)
            self.certificate_directory = tempfile.TemporaryDirectory(prefix="onvif-media-tls-fixture-")
            directory = Path(self.certificate_directory.name)
            certificate, key = directory / "certificate.pem", directory / "private-key.pem"
            certificate.write_text(identity["cert"], encoding="ascii")
            key.write_text(identity["key"], encoding="ascii")
            self.ca_pem = identity["cert"]
            self.tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            self.tls_context.minimum_version = ssl.TLSVersion.TLSv1_2
            self.tls_context.load_cert_chain(certificate, key)

    def _sdp(self):
        lines = [
            "v=0", "o=- 1 1 IN IP4 127.0.0.1", "s=Owned independent native fixture",
            "c=IN IP4 127.0.0.1", "t=0 0", "a=control:*",
            "m=video 0 RTP/AVP 26", "a=rtpmap:26 JPEG/90000",
            f"a=control:{self.control_uri or 'track0'}", "a=x-onvif-track:VIDEO001", "a=recvonly",
            "m=audio 0 RTP/AVP 0", "a=rtpmap:0 PCMU/8000/1",
            "a=control:track1", "a=x-onvif-track:AUDIO001", "a=recvonly",
            f"m=application 0 RTP/AVP {self.metadata_pt}",
            f"a=rtpmap:{self.metadata_pt} {self.metadata_encoding or ('vnd.onvif.metadata' + ('.gzip' if self.gzip_metadata else ''))}/90000",
            "a=control:track2", "a=x-onvif-track:META001", "a=recvonly",
        ]
        if self.backchannel_enabled:
            lines.extend(["m=audio 0 RTP/AVP 97", "a=rtpmap:97 PCMU/8000/1",
                "a=control:track3", "a=sendonly"])
        if self.mode == "live":
            lines.insert(6, "a=range:npt=0-")
        return ("\r\n".join(lines) + "\r\n").encode("ascii")

    def _outer_authorize(self, headers, method, target):
        authorization = headers.get("authorization")
        record = {"method": method, "authorizationPresent": authorization is not None,
            "path": target, "cookie": headers.get("x-sessioncookie")}
        self.outer_records.append(record)
        if self.outer_auth == "none":
            if authorization:
                raise ValueError("Unrequested outer HTTP credential disclosure")
            return True
        if not authorization:
            return False
        params = digest_parameters(authorization)
        algorithm = "SHA-256" if self.outer_auth == "sha256" else "MD5"
        if (params.get("algorithm") != algorithm or params.get("realm") != self.outer_realm
                or params.get("username") != self.outer_username or params.get("uri") != target
                or params.get("nonce") != self.outer_nonce or params.get("qop") != "auth"):
            raise ValueError("Outer HTTP principal/realm/URI/algorithm mismatch")
        if not re.fullmatch(r"[a-f0-9]{32}", params.get("cnonce", "")):
            raise ValueError("Outer native cnonce is not 128 bits")
        nonce_key = (self.outer_nonce, params["cnonce"])
        nc = int(params.get("nc", "0"), 16)
        if nc != self.outer_counts.get(nonce_key, 0) + 1:
            raise ValueError("Outer nonce count is shared with inner RTSP or another session")
        self.outer_counts[nonce_key] = nc
        def h(value):
            return hashlib.new("sha256" if algorithm == "SHA-256" else "md5", value.encode("utf8")).hexdigest()
        expected = h(":".join([
            h(f"{self.outer_username}:{self.outer_realm}:{self.outer_password}"),
            self.outer_nonce, params["nc"], params["cnonce"], "auth", h(f"{method}:{target}"),
        ]))
        if not secrets.compare_digest(params.get("response", ""), expected):
            raise ValueError("Independent outer HTTP Digest mismatch")
        record.update(algorithm=algorithm, realm=self.outer_realm, nc=nc)
        return True

    def _tunnel(self, connection):
        pending = bytearray()
        while b"\r\n\r\n" not in pending:
            try:
                chunk = connection.recv(31)
            except ConnectionResetError:
                if not self.tls_context or pending:
                    raise
                self.tls_errors.append("PeerResetBeforeHttp")
                return None
            if not chunk:
                if self.tls_context:
                    self.tls_errors.append("PeerClosedBeforeHttp")
                return None
            pending.extend(chunk)
            if len(pending) > 16384:
                raise ValueError("Outer HTTP fixture header limit")
        header, _, initial = pending.partition(b"\r\n\r\n")
        lines = header.decode("ascii").split("\r\n")
        method, target, version = lines[0].split(" ")
        if method not in ("GET", "POST") or version not in ("HTTP/1.0", "HTTP/1.1") or not target.startswith(self.path):
            raise ValueError("Invalid native outer tunnel request")
        headers = {}
        for line in lines[1:]:
            name, value = line.split(":", 1)
            if name.lower() in headers:
                raise ValueError("Duplicate outer HTTP header")
            headers[name.lower()] = value.strip()
        if not self._outer_authorize(headers, method, target):
            challenge = (f'HTTP/1.0 401 Unauthorized\r\nWWW-Authenticate: Digest realm="{self.outer_realm}", '
                f'nonce="{self.outer_nonce}", algorithm={"SHA-256" if self.outer_auth == "sha256" else "MD5"}, '
                'qop="auth"\r\nContent-Length: 0\r\n\r\n').encode("ascii")
            connection.sendall(challenge[:13])
            connection.sendall(challenge[13:])
            return None
        cookie = headers.get("x-sessioncookie")
        if not cookie or not re.fullmatch("[a-z]{23}", cookie):
            raise ValueError("Native tunnel has no valid pairing cookie")
        if method == "GET":
            if headers.get("accept") != "application/x-rtsp-tunnelled" or initial:
                raise ValueError("Invalid GET tunnel contract")
            ended = threading.Event()
            with self.tunnel_condition:
                if cookie in self.tunnels:
                    raise ValueError("Duplicate tunnel GET owner")
                self.tunnels[cookie] = (connection, ended)
                self.tunnel_condition.notify_all()
            response = b"HTTP/1.0 200 OK\r\nContent-Type: application/x-rtsp-tunnelled\r\nCache-Control: no-cache\r\n\r\n"
            connection.sendall(response[:11])
            connection.sendall(response[11:23])
            connection.sendall(response[23:])
            while not self.stop.is_set() and not ended.wait(0.1):
                pass
            return None
        if headers.get("content-type") != "application/x-rtsp-tunnelled":
            raise ValueError("Invalid POST tunnel content type")
        with self.tunnel_condition:
            if cookie not in self.tunnels:
                raise ValueError("POST did not attach to an owned GET")
            outgoing, ended = self.tunnels[cookie]
        return TunnelIO(connection, outgoing, initial, self.tunnel_trace), ended

    def _serve(self, connection):
        tunnel_end = None
        try:
            if self.tls_context:
                try:
                    connection = self.tls_context.wrap_socket(connection, server_side=True)
                except (ssl.SSLError, TimeoutError) as error:
                    self.tls_errors.append(type(error).__name__)
                    return
                connection.settimeout(0.2)
                self.tls_connections.append(connection.cipher())
                with self.lock:
                    self.connections.append(connection)
                connection = TlsIO(connection)
            if self.transport in ("http", "https"):
                tunnel = self._tunnel(connection)
                if tunnel is None:
                    return
                connection, tunnel_end = tunnel
            self._rtsp(connection)
        except ssl.SSLError as error:
            self.tls_errors.append(type(error).__name__)
        except (OSError, ValueError) as error:
            if not self.stop.is_set():
                self.errors.append(f"tunnel: {error}")
        finally:
            if tunnel_end:
                tunnel_end.set()
            connection.close()
            if self.tls_context:
                self.tls_closed.set()

    def _server_udp(self, client_ports):
        pair = []
        for _ in range(2):
            stream = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            stream.bind(("127.0.0.1", 0))
            stream.settimeout(0.1)
            self.udp_sockets.append(stream)
            pair.append(stream)
        return {"client": client_ports, "sockets": pair}

    def _receive_backchannel_udp(self, transport):
        while not self.stop.is_set():
            try:
                packet, address = transport["sockets"][0].recvfrom(65536)
            except socket.timeout:
                continue
            except OSError as error:
                if not self.stop.is_set():
                    self.errors.append(f"backchannel-udp: {error}")
                return
            if address != ("127.0.0.1", transport["client"][0]):
                self.errors.append("Backchannel UDP source differs from its negotiated client port/interface")
                return
            self.backchannel_packets.append(packet)

    def _send_packet(self, connection, send_lock, transports, track, packet, session, rtcp=False):
        transport = transports[track]
        if isinstance(transport, dict):
            sender = transport["sockets"][int(rtcp)]
            if self.udp_sender_fault and rtcp == self.udp_sender_fault.startswith("rtcp-"):
                key = (track, rtcp)
                if key not in self.fault_sockets:
                    forged = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    forged.bind(("127.0.0.2" if self.udp_sender_fault.endswith("address") else "127.0.0.1",
                        sender.getsockname()[1] if self.udp_sender_fault.endswith("address") else 0))
                    self.udp_sockets.append(forged)
                    self.fault_sockets[key] = forged
                    self.injected_senders.append({"declared": sender.getsockname(), "actual": forged.getsockname()})
                sender = self.fault_sockets[key]
                self.injected_packets.append(packet)
            sender.sendto(packet, ("127.0.0.1", transport["client"][int(rtcp)]))
        else:
            frame = struct.pack("!BBH", 0x24, transport[int(rtcp)], len(packet)) + packet
            with send_lock:
                connection.sendall(frame[:2])
                connection.sendall(frame[2:9])
                connection.sendall(frame[9:])
        with self.lock:
            self.sent_packets.append((session, track + 1 if not rtcp else -(track + 1), packet))

    def _media_v2(self, connection, send_lock, transports, cseq, ended, session, play, start_ns):
        if self.stall_media:
            return
        try:
            previous_cseq = self.previous_play_cseq
            self.previous_play_cseq = cseq
            if ended.wait(0.05):
                return
            if self.stale_replay and previous_cseq is not None:
                stale = rtp_packet(26, 999 + (play - 1) * 100, 0x10000000,
                    0x10203040, JPEG_PAYLOAD, replay=(START_NTP, 0x90, previous_cseq))
                self.stale_packets.append(stale)
                self._send_packet(connection, send_lock, transports, 0, stale, session)
            for cycle in range(self.cycles):
                if ended.is_set() or self.stop.is_set():
                    return
                document = self.documents[cycle % len(self.documents)] if self.documents else METADATA_XML
                wire = gzip.compress(document, mtime=0) if self.gzip_metadata else document
                if self.gzip_corrupt:
                    wire = wire[:-1] + bytes([wire[-1] ^ 1])
                cut = wire.index(b"\xc3\xa9") + 1 if b"\xc3\xa9" in wire else len(wire) // 2
                fragments = [wire[:cut], wire[cut:-17], wire[-17:]]
                flags = 0x80 | (0x20 if cycle == 0 else 0) | (0x50 if cycle == self.cycles - 1 else 0)
                seconds, fraction_ns = divmod(start_ns, 1_000_000_000)
                ntp = (seconds << 32) | ((fraction_ns << 32) // 1_000_000_000)
                replay = (ntp + cycle * 0x01000000, flags, cseq) if self.mode == "recorded" else None
                offset = (play - 1) * 100
                packets = [
                    (0, rtp_packet(26, 1000 + offset + cycle, 0x10000000 + offset * 9000 + cycle * 9000,
                        0x10203040, JPEG_PAYLOAD, replay=replay)),
                    (1, rtp_packet(0, 2000 + offset + cycle, 0x20000000 + offset * 160 + cycle * 160,
                        0x20304050, PCMU_PAYLOAD, replay=replay)),
                ]
                for index, fragment in enumerate(fragments):
                    if self.metadata_loss and cycle == 1 and index == 1:
                        continue
                    metadata_replay = (replay[0], flags if index == 0 else 0, cseq) if replay else None
                    ssrc = 0x30405060 + int(self.metadata_incarnation and cycle >= 1)
                    packets.append((2, rtp_packet(self.metadata_pt, 65534 + offset + cycle * 3 + index,
                        0xFFFFFFFE + offset * 300 + cycle * 300 + index * 37, ssrc, fragment,
                        marker=index == 2, replay=metadata_replay)))
                if self.metadata_reorder and cycle > 0 and len(packets) == 5:
                    packets[3], packets[4] = packets[4], packets[3]
                for track, packet in packets:
                    if track not in transports or ended.is_set() or self.stop.is_set():
                        continue
                    self._send_packet(connection, send_lock, transports, track, packet, session)
                if self.sender_reports:
                    for track, packet in packets[:2] + packets[2:3]:
                        timestamp, ssrc = struct.unpack_from("!II", packet, 4)
                        base = (0x10000000, 0x20000000, 0xFFFFFFFE)[track]
                        rate = 8000 if track == 1 else 90000
                        ntp = START_NTP + (((timestamp - base) & 0xFFFFFFFF) << 32) // rate
                        report = struct.pack("!BBHIQIII", 0x80, 200, 6, ssrc, ntp, timestamp, cycle + 1, 160)
                        cname = b"owned-fixture"
                        chunk = struct.pack("!I", ssrc) + bytes([1, len(cname)]) + cname + b"\0"
                        chunk += b"\0" * (-len(chunk) % 4)
                        report += struct.pack("!BBH", 0x81, 202, len(chunk) // 4) + chunk
                        if track in transports:
                            self._send_packet(connection, send_lock, transports, track, report, session, rtcp=True)
                if ended.wait(0.06):
                    return
        except OSError as error:
            if not ended.is_set() and not self.stop.is_set():
                self.errors.append(f"media-v2: {error}")
        finally:
            self.media_finished.set()

    def _rtsp(self, connection):
        pending = bytearray()
        send_lock = threading.Lock()
        ended = threading.Event()
        playing = None
        session = "native-" + secrets.token_hex(5)
        nonce = secrets.token_hex(16)
        nonce_counts, transports = {}, {}
        stale_done = False
        last_cseq, play = -1, 0
        try:
            while not self.stop.is_set() and not ended.is_set():
                try:
                    chunk = connection.recv(4096)
                except socket.timeout:
                    continue
                if not chunk:
                    break
                pending.extend(chunk)
                if len(pending) > 65536:
                    raise ValueError("Native fixture request framing limit")
                while pending:
                    if pending[0] == 0x24:
                        if len(pending) < 4:
                            break
                        size = 4 + struct.unpack_from("!H", pending, 2)[0]
                        if len(pending) < size:
                            break
                        channel = pending[1]
                        body = bytes(pending[4:size])
                        if self.backchannel_enabled and 3 in transports and channel == transports[3][0]:
                            self.backchannel_packets.append(body)
                        elif not any(isinstance(pair, tuple) and channel == pair[1] for pair in transports.values()):
                            raise ValueError("Client used an unnegotiated interleaved channel")
                        del pending[:size]
                        continue
                    boundary = pending.find(b"\r\n\r\n")
                    if boundary < 0:
                        break
                    lines = pending[:boundary].decode("utf8").split("\r\n")
                    method, uri, version = lines[0].split(" ")
                    if version != "RTSP/1.0":
                        raise ValueError("Invalid native RTSP version")
                    headers = {}
                    for line in lines[1:]:
                        name, value = line.split(":", 1)
                        if name.lower() in headers:
                            raise ValueError("Duplicate native request header")
                        headers[name.lower()] = value.strip()
                    length = int(headers.get("content-length", "0"))
                    if not 0 <= length <= 8192:
                        raise ValueError("Native request body bound")
                    if len(pending) < boundary + 4 + length:
                        break
                    del pending[:boundary + 4 + length]
                    if not re.fullmatch(r"\d+", headers.get("cseq", "")):
                        raise ValueError("Invalid native CSeq")
                    cseq = int(headers["cseq"])
                    if cseq <= last_cseq:
                        raise ValueError("Native CSeq did not advance")
                    last_cseq = cseq
                    target = urlsplit(uri)
                    if target.hostname != "127.0.0.1" or target.port != self.port or not target.path.startswith(self.path):
                        raise ValueError("Unexpected native RTSP target")
                    record = {"session": session, "method": method, "cseq": cseq,
                        "receivedSession": headers.get("session"),
                        "authorizationPresent": "authorization" in headers,
                        "path": target.path, "range": headers.get("range"), "require": headers.get("require"),
                        "transport": headers.get("transport")}
                    self.records.append(record)
                    authorized, auth_info = self._authorize(headers, method, uri, nonce, nonce_counts)
                    record.update(auth_info)
                    if not authorized:
                        self._response(connection, send_lock, cseq, 401, self._challenge(nonce))
                        continue
                    if method in ("PLAY", "PAUSE", "TEARDOWN", "GET_PARAMETER") or (
                            method == "SETUP" and transports):
                        if headers.get("session", "").split(";", 1)[0] != session:
                            raise ValueError("Native control did not reuse the server-issued RTSP Session")
                    if self.auth == "stale" and method == "DESCRIBE" and not stale_done:
                        nonce = secrets.token_hex(16)
                        stale_done = True
                        self._response(connection, send_lock, cseq, 401, self._challenge(nonce, stale=True))
                        continue
                    if method == "OPTIONS":
                        self._response(connection, send_lock, cseq, headers=[
                            "Public: OPTIONS, DESCRIBE, SETUP, PLAY, PAUSE, GET_PARAMETER, TEARDOWN"])
                    elif method == "DESCRIBE":
                        if self.redirect and not self.redirected:
                            self.redirected = True
                            self._response(connection, send_lock, cseq, 302, [f"Location: {self.redirect}"])
                        else:
                            if self.expect_backchannel and headers.get("require") != "www.onvif.org/ver20/backchannel":
                                raise ValueError("Missing native backchannel Require")
                            if not self.expect_backchannel and "backchannel" in headers.get("require", ""):
                                raise ValueError("Backchannel requested without the fixture's explicit opt-in")
                            self._response(connection, send_lock, cseq, headers=[
                                "Content-Type: application/sdp", f"Content-Base: {self.base_uri}/"], body=self._sdp())
                    elif method == "SETUP":
                        track = int(target.path[-1])
                        if track not in range(4 if self.backchannel_enabled else 3):
                            raise ValueError("Unadvertised SETUP target")
                        if track == 3 and not self.expect_backchannel:
                            raise ValueError("Backchannel SETUP without explicit opt-in")
                        if ended.wait(self.setup_delay) or self.stop.is_set():
                            return
                        native = headers.get("transport", "")
                        if self.transport == "udp":
                            match = re.search(r"(?:^|;)client_port=(\d+)-(\d+)(?:;|$)", native)
                            if not match or "/TCP" in native:
                                raise ValueError("Missing independently negotiated UDP client ports")
                            ports = tuple(map(int, match.groups()))
                            if not all(1024 <= port <= 65535 for port in ports) or ports[0] == ports[1]:
                                raise ValueError("Unsafe UDP client port pair")
                            transport = transports[track] = self._server_udp(ports)
                            if track == 3:
                                receiver = threading.Thread(target=self._receive_backchannel_udp,
                                    args=(transport,), daemon=True)
                                self.threads.append(receiver)
                                receiver.start()
                            server_ports = [sock.getsockname()[1] for sock in transport["sockets"]]
                            source = "127.0.0.2" if self.wrong_transport_source else "127.0.0.1"
                            value = (f"RTP/AVP;unicast;client_port={ports[0]}-{ports[1]};"
                                f"server_port={server_ports[0]}-{server_ports[1]};source={source}")
                        else:
                            if not native.startswith("RTP/AVP/TCP"):
                                raise ValueError("Expected actual interleaved RTSP transport")
                            transports[track] = (6 + track * 8, 9 + track * 8)
                            value = f"RTP/AVP/TCP;unicast;interleaved={transports[track][0]}-{transports[track][1]}"
                        self._response(connection, send_lock, cseq, headers=[
                            f"Session: {session};timeout=4", f"Transport: {value}"])
                    elif method == "PLAY":
                        if play and self.control_delay and self.stop.wait(self.control_delay):
                            return
                        if playing:
                            playing.set()
                        playing = threading.Event()
                        play += 1
                        native_range = headers.get("range", "")
                        start_ns = START_NTP_NS
                        if self.mode == "recorded":
                            if (headers.get("require") != "onvif-replay" or headers.get("rate-control") != "no"
                                    or headers.get("frames") != "all" or headers.get("scale") != "1.0"
                                    or not native_range.startswith("clock=")):
                                raise ValueError("Missing exact forward ONVIF replay headers")
                            start, stop = native_range[6:].split("-")
                            observed = clock_ns(start), clock_ns(stop)
                            expected = (self.expected_ranges[play - 1] if self.expected_ranges
                                else (START_NTP_NS, END_NTP_NS))
                            if observed != expected:
                                raise ValueError(f"Incorrect absolute 1900 epoch/generation range: {observed} != {expected}")
                            self.play_ranges.append(observed)
                            start_ns = observed[0]
                        offset = (play - 1) * 100
                        info = ",".join(f"url={self.base_uri}/track{i};seq={sequence + offset};rtptime={(stamp + offset * step) & 0xffffffff}"
                            for i, sequence, stamp, step in [
                                (0, 1000, 0x10000000, 9000), (1, 2000, 0x20000000, 160), (2, 65534, 0xFFFFFFFE, 300)
                            ] if i in transports)
                        self._response(connection, send_lock, cseq, headers=[
                            f"Session: {session}", "Range: " + (native_range or "npt=0-"), "RTP-Info: " + info])
                        thread = threading.Thread(target=self._media_v2,
                            args=(connection, send_lock, dict(transports), cseq, playing, session, play, start_ns), daemon=True)
                        self.threads.append(thread)
                        thread.start()
                    elif method == "PAUSE":
                        if playing:
                            playing.set()
                        self._response(connection, send_lock, cseq, self.pause_status, headers=[f"Session: {session}"])
                    elif method == "TEARDOWN":
                        ended.set()
                        if playing:
                            playing.set()
                        if self.teardown_delay:
                            self.stop.wait(self.teardown_delay)
                        if not self.stop.is_set():
                            self._response(connection, send_lock, cseq, self.teardown_status, [f"Session: {session}"])
                        return
                    elif method == "GET_PARAMETER":
                        self._response(connection, send_lock, cseq, headers=[f"Session: {session}"])
                    else:
                        raise ValueError(f"Unexpected method {method}")
        except (OSError, ValueError) as error:
            if not ended.is_set() and not self.stop.is_set():
                self.errors.append(f"native-control: {error}")
        finally:
            ended.set()
            if playing:
                playing.set()

    def __exit__(self, *args):
        super().__exit__(*args)
        for stream in self.udp_sockets:
            stream.close()
        if self.certificate_directory:
            self.certificate_directory.cleanup()
