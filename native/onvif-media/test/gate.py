"""Run the bounded native P0 gate against independent, owned loopback fixtures."""

import argparse
from collections import Counter
import hashlib
import json
import msvcrt
import os
from pathlib import Path
import queue
import struct
import subprocess
import threading
import time
import xml.etree.ElementTree as ET

from rtsp_fixture import (
    END_NTP_NS, JPEG_I420, METADATA_XML, PCM_S16LE, START_NTP, START_NTP_NS,
    RtspFixture, fixture_hashes,
)


HEADER = struct.Struct("!4sHHIIII")
OPEN, CLOSE = 1, 2
HELLO, READY, CLOSED, ERROR, RESPONSE, GAP = range(0x8001, 0x8007)
RTP, DECODED, METADATA = range(0x9001, 0x9004)


def read_exact(stream, size, *, allow_eof=False):
    output = bytearray()
    while len(output) < size:
        chunk = stream.read(size - len(output))
        if not chunk:
            if not output and allow_eof:
                return None
            raise EOFError(f"Truncated private IPC frame ({len(output)}/{size})")
        output.extend(chunk)
    return bytes(output)


def frame(stream, limit):
    head = read_exact(stream, HEADER.size, allow_eof=True)
    if head is None:
        return None
    magic, version, kind, session, generation, sequence, length = HEADER.unpack(head)
    if magic != b"OMPG" or version != 1 or length > limit:
        raise ValueError("Invalid/beyond-limit worker IPC header")
    payload = read_exact(stream, length)
    return {"kind": kind, "session": session, "generation": generation,
        "sequence": sequence, "payload": payload}


class WorkerClient:
    def __init__(self, worker, sdk, session=1, *, read_data=True):
        self.session = session
        self.controls = []
        self.frames = []
        self.reader_errors = []
        self.control_queue = queue.Queue(maxsize=256)
        self.condition = threading.Condition()
        self.data_fd, write_fd = os.pipe()
        os.set_inheritable(write_fd, True)
        write_handle = msvcrt.get_osfhandle(write_fd)
        startup = subprocess.STARTUPINFO()
        startup.lpAttributeList = {"handle_list": [write_handle]}
        environment = dict(os.environ, PATH=str(sdk / "bin") + os.pathsep + os.environ.get("PATH", ""))
        self.process = subprocess.Popen(
            [str(worker), "--data-handle", str(write_handle)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            startupinfo=startup, close_fds=True, env=environment,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        os.close(write_fd)
        self.threads = [threading.Thread(target=self._controls, daemon=True)]
        if read_data:
            self.threads.append(threading.Thread(target=self._data, daemon=True))
        self.read_data = read_data
        for thread in self.threads:
            thread.start()
        hello = self.wait(HELLO, timeout=8)
        self.hello = hello["json"]
        if self.hello["gstreamer"] != "1.28.7" or self.hello["nativeCredentialInput"]:
            raise AssertionError("Startup inventory does not match the bounded gate")

    def _controls(self):
        try:
            while True:
                item = frame(self.process.stdout, 4096)
                if item is None:
                    return
                item["json"] = json.loads(item.pop("payload"))
                self.controls.append(item)
                self.control_queue.put(item, timeout=2)
        except (EOFError, OSError, ValueError, queue.Full) as error:
            self.reader_errors.append(f"control: {error}")

    def _data(self):
        try:
            with os.fdopen(self.data_fd, "rb", buffering=0) as stream:
                while True:
                    item = frame(stream, 65536)
                    if item is None:
                        return
                    with self.condition:
                        if len(self.frames) >= 256:
                            raise ValueError("Fixture data consumer limit")
                        self.frames.append(item)
                        self.condition.notify_all()
        except (EOFError, OSError, ValueError) as error:
            self.reader_errors.append(f"data: {error}")
            with self.condition:
                self.condition.notify_all()

    def send(self, kind, sequence, payload=b"", generation=1, *, fragmented=False):
        message = HEADER.pack(b"OMPG", 1, kind, self.session, generation, sequence, len(payload)) + payload
        if fragmented:
            for start, stop in ((0, 5), (5, 17), (17, len(message))):
                self.process.stdin.write(message[start:stop])
                self.process.stdin.flush()
                time.sleep(0.003)
        else:
            self.process.stdin.write(message)
            self.process.stdin.flush()

    def open(self, fixture, *, fragmented=False, transport=1):
        uri = fixture.uri.encode("utf-8")
        recorded = fixture.mode == "recorded"
        payload = struct.pack("!BBBBQQH", int(recorded), transport, int(fixture.auth != "none"),
            7, START_NTP_NS if recorded else 0, END_NTP_NS if recorded else 0, len(uri)) + uri
        self.send(OPEN, 1, payload, generation=0, fragmented=fragmented)

    def wait(self, kind, timeout=8):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                item = self.control_queue.get(timeout=min(0.2, max(0.01, deadline - time.monotonic())))
            except queue.Empty:
                if self.process.poll() is not None:
                    stderr = self.process.stderr.read(16384).decode("utf-8", errors="replace")
                    history = [entry for entry in self.controls if entry["kind"] != HELLO]
                    raise AssertionError(f"Worker exited {self.process.returncode}; wanted {kind:x}; controls={history}; readers={self.reader_errors}; stderr={stderr}")
                continue
            if item["kind"] == kind:
                return item
            if item["kind"] == ERROR and kind not in {ERROR, CLOSED}:
                history = [entry for entry in self.controls if entry["kind"] != HELLO]
                raise AssertionError(f"Native worker error: {item['json']}; controls={history}")
        history = [entry for entry in self.controls if entry["kind"] != HELLO]
        raise AssertionError(f"Deadline waiting for {kind:x}; controls={history}; readerErrors={self.reader_errors}")

    def wait_media(self, videos, audios, documents, timeout=6):
        deadline = time.monotonic() + timeout
        with self.condition:
            while time.monotonic() < deadline:
                counts = Counter(
                    (item["kind"], struct.unpack_from("!H", item["payload"])[0])
                    for item in self.frames
                )
                if counts[(DECODED, 1)] >= videos and counts[(DECODED, 2)] >= audios and counts[(METADATA, 3)] >= documents:
                    return
                self.condition.wait(timeout=0.05)
        history = [entry for entry in self.controls if entry["kind"] != HELLO]
        raise AssertionError(f"Decoded/metadata deadline: {counts}; controls={history}; readerErrors={self.reader_errors}")

    def close(self):
        started = time.monotonic()
        self.send(CLOSE, 2)
        receipt = self.wait(CLOSED, timeout=8)
        self.process.wait(timeout=4)
        receipt["elapsedSeconds"] = time.monotonic() - started
        return receipt

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
                self.reader_errors.append("Owned worker PID required forced termination; remote cleanup uncertain")
        for thread in self.threads:
            thread.join(timeout=2)
        if not self.read_data:
            os.close(self.data_fd)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream and not stream.closed:
                stream.close()


def verify_media(client, fixture, expected_documents):
    counts = Counter()
    replay = []
    for item in client.frames:
        if (item["session"], item["generation"]) != (client.session, 1):
            raise AssertionError("Session/generation crossed IPC ownership")
        payload = item["payload"]
        track = struct.unpack_from("!H", payload)[0]
        counts[(item["kind"], track)] += 1
        if item["kind"] == DECODED:
            track, encoding, width, height, rate, channels, reserved, count, pts, size = struct.unpack_from("!HHIIIHHIQI", payload)
            if len(payload) != 36 + size or reserved:
                raise AssertionError("Malformed complete-frame envelope")
            if track == 1:
                if (encoding, width, height, count, payload[36:]) != (1, 16, 16, 1, JPEG_I420):
                    raise AssertionError("JPEG decoded pixels differ from the synthetic exact I420 oracle")
            elif track == 2:
                if (encoding, rate, channels, count, payload[36:]) != (2, 8000, 1, 160, PCM_S16LE):
                    raise AssertionError("G.711 decoded samples differ from the exact PCM oracle")
            else:
                raise AssertionError("Undeclared decoded track")
        elif item["kind"] == METADATA:
            size = struct.unpack_from("!I", payload, 28)[0]
            if size != len(METADATA_XML) or payload[32:] != METADATA_XML:
                raise AssertionError("Native XML RTP assembly lost bytes/UTF-8/extensions")
            root = ET.fromstring(payload[32:])
            if root.find("{http://www.onvif.org/ver10/schema}VideoAnalytics/{http://www.onvif.org/ver10/schema}Frame") is None:
                raise AssertionError("Wrong real ONVIF metadata frame path")
            first_ts, last_ts = struct.unpack_from("!II", payload, 12)
            if first_ts == last_ts:
                raise AssertionError("Fixture did not test changing RTP timestamps inside a document")
        elif item["kind"] == RTP:
            track, pt, marker, ssrc, sequence, flags, cseq_low, timestamp, receipt_ns, ntp, options, size = struct.unpack_from("!HBBIHBBIQQII", payload)
            if len(payload) != 40 + size or not receipt_ns:
                raise AssertionError("Invalid native packet envelope")
            raw = payload[40:]
            if struct.unpack_from("!HII", raw, 2) != (sequence, timestamp, ssrc) or (raw[1] & 127) != pt:
                raise AssertionError("Native packet metadata does not match actual RTP bytes")
            if (raw[1] >> 7) != marker:
                raise AssertionError("Native marker was not preserved")
            if track == 3 and pt != fixture.metadata_pt:
                raise AssertionError("Metadata payload identity was hardcoded")
            if fixture.mode == "recorded":
                if not options & 1 or struct.unpack_from("!Q", raw, 16)[0] != ntp:
                    raise AssertionError("Native replay NTP was lost or fabricated")
                plays = [item["json"]["cseq"] for item in client.controls
                    if item["kind"] == RESPONSE and item["json"]["method"] == "PLAY" and item["json"]["status"] == 200]
                if not plays or cseq_low != (plays[-1] & 0xFF):
                    raise AssertionError("Native replay did not retain low-byte PLAY CSeq association")
                replay.append((ntp, flags, cseq_low))
    if counts[(DECODED, 1)] != fixture.cycles or counts[(DECODED, 2)] != fixture.cycles:
        raise AssertionError(f"Unexpected decoded fixture frame/sample counts: {counts}")
    if counts[(METADATA, 3)] != expected_documents:
        raise AssertionError(f"Unexpected complete metadata document count: {counts}")
    if fixture.mode == "recorded":
        if not any(ntp == START_NTP for ntp, _, _ in replay) or not any(flags & 0x10 for _, flags, _ in replay):
            raise AssertionError("Replay NTP/fraction/terminal access unit was not exercised")
        if not any(flags & 0x20 for _, flags, _ in replay) or not any(flags & 0x40 for _, flags, _ in replay):
            raise AssertionError("Replay discontinuity/end flags were not preserved")
    return {"decodedVideoFrames": counts[(DECODED, 1)],
        "decodedAudioSamples": counts[(DECODED, 2)] * 160,
        "metadataDocuments": counts[(METADATA, 3)], "nativeRtpPackets": sum(value for (kind, _), value in counts.items() if kind == RTP)}


def positive(worker, sdk, mode, auth, *, loss=False):
    result = {}
    with RtspFixture(mode=mode, auth=auth, metadata_loss=loss, metadata_pt=119 if auth == "md5" else 110) as fixture:
        with WorkerClient(worker, sdk) as client:
            client.open(fixture, fragmented=True)
            client.wait(READY)
            expected = fixture.cycles - int(loss)
            client.wait_media(fixture.cycles, fixture.cycles, expected)
            # All finite fixture packets must be visible before normal cancellation.
            time.sleep(0.08)
            receipt = client.close()
            result.update(verify_media(client, fixture, expected))
            if receipt["json"]["remote"] != "acknowledged" or not receipt["json"]["localCleanup"]:
                raise AssertionError(f"Native TEARDOWN was not acknowledged: {receipt}")
            if client.process.returncode or client.reader_errors:
                raise AssertionError(f"Worker/IPC failure: {client.process.returncode}, {client.reader_errors}")
            if loss and not any(item["kind"] == GAP and item["json"]["code"] == "RtpSequenceGap" for item in client.controls):
                raise AssertionError("Lost metadata was not explicitly invalidated")
            result["close"] = receipt["json"]
            result["nativeMethods"] = [record["method"] for record in fixture.records]
            result["auth"] = sorted({record["algorithm"] for record in fixture.records if "algorithm" in record})
            result["range"] = next(record["range"] for record in fixture.records if record["method"] == "PLAY")
            result["inventory"] = client.hello
            result["nativeTiming"] = [item["json"] for item in client.controls
                if item["kind"] == 0x8007 and item["json"].get("code") == "ReplayTiming"]
            result["nativeStderr"] = client.process.stderr.read(16384).decode("utf-8", errors="replace")
        if fixture.errors:
            raise AssertionError(f"Independent fixture rejected native wire: {fixture.errors}")
    return result


def unsupported_auth(worker, sdk, auth):
    with RtspFixture(auth=auth) as fixture:
        with WorkerClient(worker, sdk) as client:
            client.open(fixture)
            error = client.wait(ERROR)
            closed = client.wait(CLOSED)
            client.process.wait(timeout=4)
            if not client.process.returncode:
                raise AssertionError("Unsupported authentication returned success")
            if any(record["authorizationPresent"] for record in fixture.records):
                raise AssertionError("Credentials disclosed before rejecting unsupported authentication")
            if closed["json"]["remote"] != "not-created":
                raise AssertionError("Unsupported authentication created a media session")
        if fixture.errors:
            raise AssertionError(fixture.errors)
    return {"error": error["json"], "credentialDisclosure": False, "requests": len(fixture.records)}


def close_case(worker, sdk, kind, *, recorded=False):
    options = {"teardown_status": 500} if kind == "uncertain-teardown" else {}
    if kind == "teardown-timeout":
        options["teardown_delay"] = 3
    if kind == "cancel-setup":
        options["setup_delay"] = 2.5
    with RtspFixture(mode="recorded" if recorded else "live", **options) as fixture:
        with WorkerClient(worker, sdk, read_data=kind != "stalled-data") as client:
            client.open(fixture)
            if kind == "cancel-setup":
                deadline = time.monotonic() + 3
                while not any(record["method"] == "SETUP" for record in fixture.records):
                    if time.monotonic() >= deadline:
                        raise AssertionError("Cancellation did not reach pending native SETUP")
                    time.sleep(0.01)
            else:
                client.wait(READY)
                time.sleep(0.15)
            receipt = client.close()
            if not receipt["json"]["localCleanup"] or receipt["elapsedSeconds"] >= 7:
                raise AssertionError(f"Owned cancellation failed: {receipt}")
            expected = "acknowledged" if kind == "stalled-data" else "uncertain"
            if receipt["json"]["remote"] != expected:
                raise AssertionError(f"Remote/local cleanup were conflated: {receipt}")
            if receipt["json"]["dataQueuePeakBytes"] > 1024 * 1024:
                raise AssertionError("Data queue exceeded its declared bound")
    return {"close": receipt["json"], "elapsedSeconds": receipt["elapsedSeconds"]}


def ipc_rejection(worker, sdk, kind):
    with RtspFixture() as fixture:
        with WorkerClient(worker, sdk) as client:
            if kind == "unsupported-transport":
                client.open(fixture, transport=2)
            elif kind == "unsupported-tls":
                fixture.uri = fixture.uri.replace("rtsp:", "rtsps:", 1)
                client.open(fixture)
            else:
                header = HEADER.pack(b"OMPG", 2 if kind == "version" else 1,
                    OPEN, 1, 0, 1, 4097 if kind == "oversized" else 0)
                if kind == "truncated":
                    client.process.stdin.write(header[:13])
                    client.process.stdin.close()
                else:
                    client.process.stdin.write(header)
                    client.process.stdin.flush()
            error = client.wait(ERROR)
            closed = client.wait(CLOSED)
            client.process.wait(timeout=4)
            if not client.process.returncode or fixture.records:
                raise AssertionError("Invalid/unsupported IPC reached the network or returned success")
            if closed["json"]["remote"] != "not-created" or not closed["json"]["localCleanup"]:
                raise AssertionError("Invalid IPC cleanup was misreported")
    return {"error": error["json"], "networkRequests": 0}


def isolated_sessions(worker, sdk):
    with RtspFixture(auth="sha256") as fixture:
        with WorkerClient(worker, sdk, session=17) as first, WorkerClient(worker, sdk, session=29) as second:
            first.open(fixture)
            second.open(fixture)
            first.wait(READY)
            second.wait(READY)
            first.wait_media(4, 4, 4)
            second.wait_media(4, 4, 4)
            first_close = first.close()
            second_close = second.close()
            verify_media(first, fixture, 4)
            verify_media(second, fixture, 4)
            sessions = {record["session"] for record in fixture.records if record["method"] == "PLAY"}
            if len(sessions) != 2 or first.process.pid == second.process.pid:
                raise AssertionError("Same URI shared native session ownership")
            if any(close["json"]["remote"] != "acknowledged" for close in (first_close, second_close)):
                raise AssertionError("One session close lost independent remote ownership")
        if fixture.errors:
            raise AssertionError(fixture.errors)
    return {"independentWorkers": 2, "nativeSessions": 2, "sameUri": True}


def owned_worker_failure(worker, sdk):
    with RtspFixture(stall_media=True) as fixture:
        with WorkerClient(worker, sdk) as client:
            client.open(fixture)
            client.wait(READY)
            pid = client.process.pid
            client.process.kill()
            client.process.wait(timeout=4)
            if not client.process.returncode or any(record["method"] == "TEARDOWN" for record in fixture.records):
                raise AssertionError("Unexpected successful teardown after forced owned-worker termination")
    return {"ownedPidTerminated": pid, "remote": "uncertain", "closedReceipt": False}


def node_ipc(worker, sdk, node_executable, *, recorded=False):
    with RtspFixture(mode="recorded" if recorded else "live", auth="sha256") as fixture:
        descriptor = {
            "uri": fixture.uri, "auth": True, "recorded": recorded,
            "startNtpNs": str(START_NTP_NS if recorded else 0),
            "endNtpNs": str(END_NTP_NS if recorded else 0),
            "cycles": fixture.cycles, "hashes": fixture_hashes(),
        }
        result = subprocess.run(
            [node_executable, str(Path(__file__).with_name("node-ipc-smoke.cjs")), str(worker), str(sdk)],
            input=json.dumps(descriptor), text=True, capture_output=True, timeout=20,
        )
        if result.returncode:
            raise AssertionError(f"Real Node fd3 IPC failed: {result.stderr}; {result.stdout}")
        if fixture.errors:
            raise AssertionError(fixture.errors)
    return json.loads(result.stdout)


def binary_inventory(worker):
    build = worker.parent.parent
    files = [worker, build / "bin" / "gstrtsp-1.0-0.dll", *sorted((build / "plugins").glob("*.dll"))]
    result = {}
    for filename in files:
        data = filename.read_bytes()
        if data[:2] != b"MZ":
            raise ValueError(f"Not a native PE image: {filename}")
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        if data[pe:pe + 4] != b"PE\0\0":
            raise ValueError(f"Invalid PE header: {filename}")
        machine = struct.unpack_from("<H", data, pe + 4)[0]
        if machine != 0x8664:
            raise ValueError(f"Non-x64 native artifact: {filename}")
        result[str(filename.relative_to(build))] = {
            "machine": "8664/x64", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
        }
    return result


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--sdk-root", type=Path, required=True)
    parser.add_argument("--node-executable", default="node")
    parser.add_argument("--case", choices=["baseline", "replay", "matrix", "negative", "ipc", "all"], default="all")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    worker, sdk = args.worker.resolve(strict=True), args.sdk_root.resolve(strict=True)
    results = {"scope": "native-p0-owned-loopback-only", "selection": args.case, "productionReady": False,
        "distributionReady": False, "fixtureSha256": fixture_hashes(),
        "workerSha256": hashlib.sha256(worker.read_bytes()).hexdigest(),
        "nativeBinaries": binary_inventory(worker), "cases": {}}
    cases = []
    if args.case == "baseline":
        cases.append(("live/explicit-none/tcp", lambda: positive(worker, sdk, "live", "none")))
    if args.case == "replay":
        cases.append(("recorded/sha256/tcp", lambda: positive(worker, sdk, "recorded", "sha256")))
    if args.case in {"matrix", "all"}:
        for mode in ("live", "recorded"):
            for auth in ("none", "legacy", "md5", "sha256", "stale"):
                cases.append((f"{mode}/{auth}/tcp",
                    lambda mode=mode, auth=auth: positive(worker, sdk, mode, auth)))
        cases.append(("live/prefer-sha256-over-md5-basic/tcp", lambda: positive(worker, sdk, "live", "mixed")))
        cases.append(("live/metadata-loss-recovery/tcp", lambda: positive(worker, sdk, "live", "none", loss=True)))
    if args.case in {"negative", "all"}:
        for auth in ("basic", "sha512", "sess", "auth-int"):
            cases.append((f"reject-auth/{auth}", lambda auth=auth: unsupported_auth(worker, sdk, auth)))
        for kind in ("stalled-data", "cancel-setup", "uncertain-teardown", "teardown-timeout"):
            cases.append((kind, lambda kind=kind: close_case(worker, sdk, kind)))
        cases.append(("recorded/cancel-setup", lambda: close_case(worker, sdk, "cancel-setup", recorded=True)))
    if args.case in {"ipc", "all"}:
        for kind in ("version", "oversized", "truncated", "unsupported-transport", "unsupported-tls"):
            cases.append((f"reject-ipc/{kind}", lambda kind=kind: ipc_rejection(worker, sdk, kind)))
        cases.append(("same-uri-isolated-sessions", lambda: isolated_sessions(worker, sdk)))
        cases.append(("owned-worker-failure", lambda: owned_worker_failure(worker, sdk)))
        cases.append(("node-fd3/live-sha256", lambda: node_ipc(worker, sdk, args.node_executable)))
        cases.append(("node-fd3/replay-sha256", lambda: node_ipc(worker, sdk, args.node_executable, recorded=True)))
    failures = []
    for name, operation in cases:
        try:
            results["cases"][name] = {"status": "pass", **operation()}
            print(f"PASS {name}", flush=True)
        except (AssertionError, OSError, ValueError, subprocess.TimeoutExpired) as error:
            results["cases"][name] = {"status": "fail", "error": str(error)}
            failures.append(name)
            print(f"FAIL {name}: {error}", flush=True)
    results["functionalGate"] = "pass" if not failures else "fail"
    results["workerStable"] = hashlib.sha256(worker.read_bytes()).hexdigest() == results["workerSha256"]
    if args.report:
        report = args.report.resolve()
        native_root = Path(__file__).resolve().parents[1]
        if not report.is_relative_to(native_root):
            parser.error("Report must remain in the owned native tree")
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(results, indent=4) + "\n", encoding="utf-8")
        print(f"Report: {report}")
    return 1 if failures or not results["workerStable"] else 0


if __name__ == "__main__":
    raise SystemExit(run())
