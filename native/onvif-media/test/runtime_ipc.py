"""Test-only v2 pipe adapter. All principals below belong to synthetic fixtures."""

from collections import Counter
import json
import msvcrt
import os
import queue
import struct
import subprocess
import threading
import time
from urllib.parse import urlsplit

from rtsp_fixture import START_NTP_NS, END_NTP_NS


HEADER = struct.Struct("!4sHHIIII")
OPEN, CLOSE, PAUSE, PLAY, SEEK, CREDIT = range(1, 7)
SECURITY = 0x10
HELLO, READY, CLOSED, ERROR, RESPONSE, GAP, DIAGNOSTIC, CONTROL = range(0x8001, 0x8009)
END = 0x8009
RTP, DECODED, METADATA, RTCP = range(0x9001, 0x9005)
BACKCHANNEL = 0x1001
DEFAULT_CODECS = 0x3F


def text(value):
    value = value.encode("utf-8")
    if len(value) > 65535 or b"\0" in value:
        raise ValueError("Invalid test IPC string")
    return struct.pack("!H", len(value)) + value


def origin(uri):
    parsed = urlsplit(uri)
    scheme = {"rtsph": "rtsp", "rtspsh": "rtsp", "rtsps": "rtsps"}.get(parsed.scheme, parsed.scheme)
    return f"{scheme}://{parsed.hostname}:{parsed.port}"


def security_payload(fixture, *, principal="media-fixture", target_ref="owned-camera",
                     allow_md5=False, realm=None, ca_pem="", username=None, password=None,
                     outer_realm=None, outer_origin=None):
    authenticated = fixture.auth != "none"
    outer_auth = getattr(fixture, "outer_auth", "none") != "none"
    native_origin = origin(fixture.uri)
    values = [
        target_ref, principal, native_origin,
        (realm or getattr(fixture, "realm", "onvif-p0")) if authenticated else "",
        (username or getattr(fixture, "username", "fixture")) if authenticated else "",
        (password or getattr(fixture, "password", "not-a-camera-password")) if authenticated else "",
        (outer_origin or getattr(fixture, "outer_origin", "")) if outer_auth else "",
        (outer_realm or getattr(fixture, "outer_realm", "outer-fixture")) if outer_auth else "",
        getattr(fixture, "outer_username", "tunnel-fixture") if outer_auth else "",
        getattr(fixture, "outer_password", "not-an-http-password") if outer_auth else "",
        ca_pem,
    ]
    return struct.pack("!IIB3x", int(authenticated), 1, int(allow_md5)) + b"".join(map(text, values))


def open_payload(fixture, *, transport=1, tracks=7, principal="media-fixture",
                 target_ref="owned-camera", allowed_origins=None, redirects=(),
                 local_address="127.0.0.1", wire_max=2 * 1024 * 1024,
                 inflated_max=8 * 1024 * 1024, metadata_deadline=2000,
                 queue_bytes=32 * 1024 * 1024, queue_frames=64, codecs=DEFAULT_CODECS,
                 packet_output=True, max_width=4096, max_height=2160,
                 decoded_max=32 * 1024 * 1024):
    recorded = fixture.mode == "recorded"
    allowed = allowed_origins if allowed_origins is not None else [origin(fixture.uri)]
    prefix = struct.pack("!BBBBIIQQ9I", int(recorded), transport, tracks,
        int(packet_output) | (2 if fixture.auth == "none" else 0),
        int(fixture.auth != "none"), 1,
        START_NTP_NS if recorded else 0, END_NTP_NS if recorded else 0,
        wire_max, inflated_max, metadata_deadline, queue_bytes, queue_frames,
        max_width, max_height, decoded_max, codecs)
    return (prefix + b"".join(map(text, [fixture.uri, target_ref, principal, local_address]))
        + struct.pack("!H", len(allowed)) + b"".join(map(text, allowed))
        + struct.pack("!H", len(redirects)) + b"".join(map(text, redirects)))


def read_exact(stream, count, allow_eof=False):
    data = bytearray()
    while len(data) < count:
        chunk = stream.read(count - len(data))
        if not chunk:
            if allow_eof and not data:
                return None
            raise EOFError("Truncated worker frame")
        data.extend(chunk)
    return bytes(data)


class RuntimeWorker:
    def __init__(self, worker, sdk, *, read_data=True, auto_credit=True, session=1):
        self.session = session
        self.generation = 0
        self.sequence = 0
        self.audio_sequence = 0
        self.frames = []
        self.controls = []
        self.errors = []
        self.stderr = bytearray()
        self.control_queue = queue.Queue(maxsize=4096)
        self.changed = threading.Condition()
        self.write_lock = threading.Lock()
        self.auto_credit = auto_credit
        self.closed = False
        data_read, data_write = os.pipe()
        secret_read, secret_write = os.pipe()
        audio_read, audio_write = os.pipe()
        handles = [msvcrt.get_osfhandle(fd) for fd in (data_write, secret_read, audio_read)]
        for fd in (data_write, secret_read, audio_read):
            os.set_inheritable(fd, True)
        startup = subprocess.STARTUPINFO()
        startup.lpAttributeList = {"handle_list": handles}
        environment = dict(os.environ, PATH=str(sdk / "bin") + os.pathsep + os.environ.get("PATH", ""))
        self.process = subprocess.Popen([
            str(worker), "--data-handle", str(handles[0]),
            "--secret-handle", str(handles[1]), "--input-handle", str(handles[2]),
        ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            startupinfo=startup, close_fds=True, env=environment,
            creationflags=subprocess.CREATE_NO_WINDOW)
        for fd in (data_write, secret_read, audio_read):
            os.close(fd)
        self.data = os.fdopen(data_read, "rb", buffering=0)
        self.secrets = os.fdopen(secret_write, "wb", buffering=0)
        self.audio = os.fdopen(audio_write, "wb", buffering=0)
        self.threads = [
            threading.Thread(target=self._read, args=(self.process.stdout, False), daemon=True),
            threading.Thread(target=self._stderr, daemon=True),
        ]
        if read_data:
            self.threads.append(threading.Thread(target=self._read, args=(self.data, True), daemon=True))
        for thread in self.threads:
            thread.start()

    def _stderr(self):
        while True:
            chunk = self.process.stderr.read1(4096)
            if not chunk:
                return
            if len(self.stderr) + len(chunk) <= 128 * 1024:
                self.stderr.extend(chunk)
            elif "DiagnosticLimit" not in self.errors:
                self.errors.append("DiagnosticLimit")

    def _read(self, stream, data):
        try:
            while True:
                head = read_exact(stream, HEADER.size, True)
                if head is None:
                    return
                magic, version, kind, session, generation, sequence, size = HEADER.unpack(head)
                if magic != b"OMPG" or version != 2 or size > (64 * 1024 * 1024 + 64 if data else 65536):
                    raise ValueError("Invalid v2 worker envelope")
                payload = read_exact(stream, size)
                item = dict(kind=kind, session=session, generation=generation, sequence=sequence)
                if data:
                    item["payload"] = payload
                    with self.changed:
                        if len(self.frames) >= 4096:
                            raise ValueError("Independent test data capture limit")
                        self.frames.append(item)
                        self.changed.notify_all()
                    if self.auto_credit and not self.closed:
                        self.send(CREDIT, struct.pack("!II", HEADER.size + size, 1), generation=generation)
                else:
                    item["json"] = json.loads(payload)
                    if kind in (READY, CONTROL):
                        self.generation = generation
                    if kind == CLOSED:
                        self.closed = True
                    self.controls.append(item)
                    self.control_queue.put(item, timeout=2)
        except (EOFError, OSError, ValueError, queue.Full) as error:
            if not self.closed:
                self.errors.append(f"{'data' if data else 'control'}: {error}")
            with self.changed:
                self.changed.notify_all()

    def send(self, kind, payload=b"", *, generation=None):
        with self.write_lock:
            self.sequence += 1
            self.process.stdin.write(HEADER.pack(b"OMPG", 2, kind, self.session,
                self.generation if generation is None else generation, self.sequence, len(payload)) + payload)
            self.process.stdin.flush()
            return self.sequence

    def open(self, fixture, *, security=None, **options):
        secret = security_payload(fixture, **(security or {}))
        self.secrets.write(HEADER.pack(b"OMPG", 2, SECURITY, self.session, 0, 1, len(secret)) + secret)
        self.secrets.close()
        self.send(OPEN, open_payload(fixture, **options), generation=0)

    def send_audio(self, pcm, *, rate=8000, generation=None):
        self.audio_sequence += 1
        payload = struct.pack("!HHIHHI", 4, 2, rate, 1, 0, len(pcm) // 2) + pcm
        self.audio.write(HEADER.pack(b"OMPG", 2, BACKCHANNEL, self.session,
            self.generation if generation is None else generation, self.audio_sequence, len(payload)) + payload)

    def wait(self, kind, timeout=8):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                item = self.control_queue.get(timeout=0.1)
            except queue.Empty:
                if self.process.poll() is not None:
                    break
                continue
            if item["kind"] == kind:
                return item
            if item["kind"] == ERROR and kind not in (ERROR, CLOSED):
                raise AssertionError(f"Native v2 error: {item}; history={self.controls[1:]}")
        raise AssertionError(f"Missing {kind:x}; exit={self.process.poll()}; errors={self.errors}; "
            f"history={self.controls[1:]}; stderr={self.stderr.decode('utf8', errors='replace')}")

    def wait_media(self, videos=4, audios=4, documents=4, timeout=8, generation=None):
        deadline = time.monotonic() + timeout
        with self.changed:
            while time.monotonic() < deadline:
                counts = Counter((item["kind"], struct.unpack_from("!H", item["payload"])[0])
                    for item in self.frames if generation is None or item["generation"] == generation)
                if (counts[(DECODED, 1)] >= videos and counts[(DECODED, 2)] >= audios
                        and counts[(METADATA, 3)] >= documents):
                    return counts
                self.changed.wait(timeout=0.05)
        raise AssertionError(f"Decoded media deadline: {counts}; controls={self.controls[1:]}; "
            f"errors={self.errors}; stderr={self.stderr.decode('utf8', errors='replace')}")

    def close(self):
        self.closed = True
        started = time.monotonic()
        self.send(CLOSE)
        result = self.wait(CLOSED)
        self.process.wait(timeout=4)
        result["elapsedSeconds"] = time.monotonic() - started
        return result

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
                self.errors.append("Owned PID terminated; remote OutcomeUnknown")
        for thread in self.threads:
            thread.join(timeout=2)
        for stream in (self.data, self.secrets, self.audio, self.process.stdin,
                       self.process.stdout, self.process.stderr):
            if not stream.closed:
                stream.close()
