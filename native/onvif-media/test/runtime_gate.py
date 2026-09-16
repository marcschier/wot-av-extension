"""Phase 5 tests use an independent stdlib server, never a GStreamer server."""

import argparse
from collections import Counter
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import struct
import time
import traceback

from rtsp_fixture import JPEG_I420, PCM_S16LE, METADATA_XML, RtspFixture, START_NTP_NS, END_NTP_NS
from runtime_fixture import RuntimeFixture
from runtime_ipc import (
    RuntimeWorker, HELLO, READY, CLOSED, ERROR, DECODED, METADATA, RTCP, RTP, END,
    OPEN, CLOSE, PAUSE, PLAY, SEEK, CREDIT, CONTROL, GAP, RESPONSE, HEADER, SECURITY,
    open_payload, security_payload, origin,
)

TRANSPORTS = {"tcp": 1, "udp": 2, "http": 3, "https": 4, "tls": 5}


def wait_for(predicate, message, timeout=4):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError(message)
        time.sleep(0.01)


def memory_usage(client):
    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "peakWorkingSet", "workingSet", "quotaPeakPaged", "quotaPaged",
                "quotaPeakNonPaged", "quotaNonPaged", "pageFile", "peakPageFile", "privateBytes")]
    value = Counters()
    value.cb = ctypes.sizeof(value)
    query = ctypes.WinDLL("psapi", use_last_error=True).GetProcessMemoryInfo
    query.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    query.restype = wintypes.BOOL
    if not query(wintypes.HANDLE(int(client.process._handle)), ctypes.byref(value), value.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    return {name: getattr(value, name) for name in ("peakWorkingSet", "workingSet", "privateBytes")}


def lifecycle_case(worker, sdk, kind, *, mode="live"):
    delayed = kind == "cancel-setup"
    pressured = kind in ("stalled", "credit", "credit-limit")
    configuration = {"setup_delay": 6} if delayed else (
        {"control_delay": 6} if kind == "cancel-seek" else
        {"teardown_status": 500} if kind == "teardown-error" else
        {"teardown_status": 454} if kind == "teardown-ended" else
        {"teardown_delay": 6} if kind == "teardown-timeout" else {})
    with RuntimeFixture(auth="sha256", mode=mode, cycles=40 if pressured else 4,
            **configuration) as fixture, RuntimeWorker(worker, sdk, read_data=kind != "stalled",
                auto_credit=not pressured) as client:
        client.wait(HELLO)
        client.open(fixture, queue_bytes=65536, queue_frames=4 if kind.startswith("credit") else 64)
        if delayed:
            wait_for(lambda: any(row["method"] == "SETUP" for row in fixture.records),
                "Cancellation did not reach pending native SETUP")
        else:
            client.wait(READY)
        if pressured:
            time.sleep(0.6)
        if kind.startswith("credit"):
            assert len(client.frames) == 4, f"Replay exceeded initial frame credit: {len(client.frames)}"
            if kind == "credit-limit":
                client.send(CREDIT, struct.pack("!II", 65537, 5))
                error = client.wait(ERROR)["json"]
                assert error["code"] == "InvalidMediaCredit", error
                closed = client.wait(CLOSED)["json"]
                client.process.wait(timeout=4)
                assert closed["localCleanup"] and client.process.returncode != 0
                return dict(error=error, close=closed)
            grant = sum(HEADER.size + len(row["payload"]) for row in client.frames)
            client.send(CREDIT, struct.pack("!II", grant, 4))
            wait_for(lambda: len(client.frames) >= 8, "Replenished replay credit did not resume native delivery")
            time.sleep(0.15)
            assert len(client.frames) == 8, "Native replay exceeded replenished credit"
        if kind == "cancel-seek":
            client.wait_media()
            client.send(SEEK, struct.pack("!QQ", START_NTP_NS + 5_000_000_000, END_NTP_NS + 5_000_000_000))
            wait_for(lambda: sum(row["method"] == "PLAY" for row in fixture.records) == 2,
                "Cancellation did not reach the pending native seek PLAY")
        memory = memory_usage(client)
        assert memory["peakWorkingSet"] < 256 * 1024 * 1024, memory
        started = time.monotonic()
        client.closed = True
        sequence = client.send(CLOSE)
        closed = client.wait(CLOSED, timeout=8)
        client.process.wait(timeout=4)
        elapsed = time.monotonic() - started
        assert closed["sequence"] == sequence, f"Native did not consume the cancellation command: {closed}"
        assert closed["json"]["localCleanup"] and client.process.returncode == 0, closed
        assert elapsed < 5, (kind, elapsed, closed)
        assert closed["json"]["dataQueuePeakBytes"] <= 65536
        expected = ("already-ended" if kind == "teardown-ended" else "uncertain"
            if kind in ("cancel-setup", "cancel-seek", "teardown-error", "teardown-timeout") else "acknowledged")
        assert closed["json"]["remote"] == expected, closed
        if kind == "stalled":
            assert closed["json"]["dataDiscardedFrames"] > 0, closed
        assert not any(row["kind"] == ERROR for row in client.controls), client.controls
        return dict(kind=kind, mode=mode, memory=memory, close=closed["json"], seconds=round(elapsed, 3),
            nativeResponses=[row["json"] for row in client.controls if row["kind"] == RESPONSE])


def rejected_auth(worker, sdk, node, auth=None, outer_field=None):
    with RuntimeFixture(auth=auth or "sha256", transport="https" if outer_field else "tcp",
            outer_auth="sha256" if outer_field else "none", node=node) as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        security = {"ca_pem": fixture.ca_pem}
        if outer_field:
            security[outer_field] = "wrong-outer-realm" if outer_field == "outer_realm" else "https://127.0.0.1:1"
        client.open(fixture, transport=4 if outer_field else 1, security=security)
        error = client.wait(ERROR)["json"]
        closed = client.wait(CLOSED)["json"]
        client.process.wait(timeout=4)
        assert error["code"] in ("UnsupportedAuthentication", "NativeRtspOrDecodeFailure"), error
        assert closed["localCleanup"] and closed["remote"] == "not-created" and client.process.returncode != 0
        assert not any(row["authorizationPresent"] for row in fixture.records + fixture.outer_records)
        if outer_field:
            assert not fixture.records
        return dict(error=error, close=closed, credentialDisclosure=False)


def target_case(worker, sdk, node, kind):
    tls = kind in ("tls-scheme", "tls-downgrade")
    with RuntimeFixture(auth="none") as sentinel, RuntimeFixture(auth="none",
            transport="tls" if tls else "udp" if kind == "udp-source" else "tcp", node=node,
            wrong_transport_source=kind == "udp-source") as fixture, RuntimeWorker(worker, sdk) as client:
        if kind == "sdp":
            fixture.control_uri = sentinel.base_uri + "/track0"
        elif kind in ("redirect", "tls-downgrade"):
            fixture.redirect = sentinel.uri
        elif kind == "redirect-allowed":
            fixture.redirect = fixture.base_uri + "?declared-redirect=yes"
        allowed = [origin(fixture.uri)]
        redirects = []
        if kind == "tls-downgrade":
            allowed.append(origin(sentinel.uri))
            redirects = allowed[:]
        elif kind == "redirect-allowed":
            redirects = allowed[:]
        client.wait(HELLO)
        client.open(fixture, transport=1 if kind == "tls-scheme" else TRANSPORTS[fixture.transport],
            allowed_origins=allowed, redirects=redirects, security={"ca_pem": fixture.ca_pem})
        if kind == "redirect-allowed":
            client.wait(READY)
            client.wait_media()
            closed = client.close()["json"]
            assert closed["remote"] == "acknowledged"
            assert sum(row["method"] == "DESCRIBE" for row in fixture.records) == 2, fixture.records
            assert not fixture.errors, fixture.errors
            return dict(close=closed, followedDeclaredRedirect=True)
        error = client.wait(ERROR)["json"]
        closed = client.wait(CLOSED)["json"]
        client.process.wait(timeout=4)
        assert not sentinel.records, "Native requests escaped the declared origin/transport policy"
        assert not any(row["kind"] == READY for row in client.controls)
        assert error["code"] in ("InvalidOrUnauthorizedOpen", "ForbiddenTarget", "ForbiddenOrUnsupportedSdpControl"), error
        assert closed["localCleanup"] and client.process.returncode != 0
        if kind == "tls-scheme":
            assert not fixture.records and not fixture.tls_connections
        return dict(error=error, close=closed, forbiddenTargetRequests=0)


def udp_sender_case(worker, sdk, kind):
    with RuntimeFixture(transport="udp", auth="sha256", udp_sender_fault=kind,
            sender_reports=kind.startswith("rtcp-")) as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        client.open(fixture, transport=2, tracks=1)
        error = client.wait(ERROR)["json"]
        closed = client.wait(CLOSED)["json"]
        client.process.wait(timeout=4)
        assert error["code"] == "ForbiddenTarget", error
        assert fixture.injected_packets and fixture.injected_senders, "No actual foreign UDP sender was injected"
        assert all(row["declared"] != row["actual"] for row in fixture.injected_senders)
        if kind.startswith("rtcp-"):
            assert not any(row["kind"] == RTCP for row in client.frames), "Foreign RTCP reached the clock mapper"
        else:
            assert not client.frames, "Foreign RTP reached raw or decoded output"
        assert closed["localCleanup"] and closed["remote"] == "acknowledged"
        assert client.process.returncode != 0 and not fixture.errors, fixture.errors
        return dict(error=error, close=closed, injectedSenders=fixture.injected_senders,
            rejectedPackets=len(fixture.injected_packets), foreignOutputPackets=0)


def metadata_guard_case(worker, sdk, kind):
    document = METADATA_XML
    configuration, options = {}, {}
    if kind == "reorder":
        configuration.update(transport="udp", metadata_reorder=True)
    elif kind == "gzip-crc":
        configuration.update(gzip_metadata=True, gzip_corrupt=True)
    elif kind == "gzip-bomb":
        document = (b'<m:MetadataStream xmlns:m="http://www.onvif.org/ver10/schema">'
            + b" " * 100000 + b"</m:MetadataStream>")
        configuration["gzip_metadata"] = True
    elif kind == "xxe":
        document = (b'<!DOCTYPE m:MetadataStream [<!ENTITY x SYSTEM "file:///never-read-by-fixture">]>'
            b'<m:MetadataStream xmlns:m="http://www.onvif.org/ver10/schema">&x;</m:MetadataStream>')
    elif kind == "utf8":
        document = METADATA_XML.replace(b"\xc3\xa9", b"\xc3(")
    elif kind == "wire-limit":
        options["wire_max"] = 160
    elif kind == "inflated-limit":
        configuration["gzip_metadata"] = True
        options["inflated_max"] = 128
    elif kind == "exi":
        configuration["metadata_encoding"] = "vnd.onvif.metadata.exi"
    expected = 4 if kind == "reorder" else 0
    with RuntimeFixture(auth="sha256", documents=[document], **configuration) as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        client.open(fixture, transport=2 if kind == "reorder" else 1, **options)
        if kind == "exi":
            error = client.wait(ERROR)["json"]
            assert error["code"] == "UnsupportedMetadataEncoding", error
            closed = client.wait(CLOSED)["json"]
            client.process.wait(timeout=4)
            assert not client.frames and client.process.returncode != 0
            return dict(error=error, close=closed, claimedExiSupport=False)
        client.wait(READY)
        client.wait_media(documents=expected)
        assert fixture.media_finished.wait(3), "Independent metadata sender did not finish"
        if not expected:
            wait_for(lambda: sum(row["kind"] == GAP and row["json"].get("track") == 3
                for row in client.controls) >= 4, "Native metadata guard did not report all four rejected documents")
        closed = client.close()["json"]
        actual = [row["payload"][32:] for row in client.frames if row["kind"] == METADATA]
        assert actual == [document] * expected, (kind, len(actual))
        assert closed["remote"] == "acknowledged" and closed["localCleanup"]
        assert not fixture.errors, fixture.errors
        return dict(kind=kind, documents=len(actual), close=closed,
            gaps=[row["json"] for row in client.controls if row["kind"] == GAP])


def private_pipe_case(worker, sdk, kind):
    with RuntimeFixture(auth="sha256", username="private-ipc-probe-user",
            password="private-ipc-probe-not-a-camera-secret") as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        if kind == "await-security-eof":
            secret = security_payload(fixture)
            client.secrets.write(HEADER.pack(b"OMPG", 2, SECURITY, client.session, 0, 1, len(secret)) + secret)
            client.send(OPEN, open_payload(fixture), generation=0)
            time.sleep(0.15)
            assert not fixture.records, "OPEN ran before the private SECURITY pipe completed"
            closed = client.close()
            assert closed["sequence"] == client.sequence and closed["json"]["remote"] == "not-created"
            return dict(close=closed["json"], requestsBeforeSecurityEof=0)
        client.open(fixture)
        client.wait(READY)
        if kind == "owned-crash":
            pid = client.process.pid
            client.process.kill()
            client.process.wait(timeout=4)
            for thread in client.threads:
                thread.join(timeout=2)
            assert client.process.returncode != 0 and not any(row["kind"] == CLOSED for row in client.controls)
            return dict(ownedPid=pid, closeReceipt=False, remote="uncertain")
        client.wait_media()
        closed = client.close()["json"]
        output = json.dumps(client.controls) + client.stderr.decode("utf8", errors="replace") + repr(client.process.args)
        assert fixture.username not in output and fixture.password not in output
        assert closed["localCleanup"] and closed["remote"] == "acknowledged"
        return dict(close=closed, credentialInArgvControlOrDiagnostics=False)


def input_guard_case(worker, sdk, kind):
    with RuntimeFixture(auth="sha256") as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        options = {
            "missing-target": {"target_ref": ""},
            "missing-principal": {"principal": ""},
            "wildcard-interface": {"local_address": "0.0.0.0"},
            "missing-origins": {"allowed_origins": []},
            "too-many-origins": {"allowed_origins": [origin(fixture.uri)] * 17},
            "wire-max": {"wire_max": 8 * 1024 * 1024 + 1},
            "inflated-max": {"inflated_max": 32 * 1024 * 1024 + 1},
            "deadline-max": {"metadata_deadline": 10001},
            "queue-bytes-max": {"queue_bytes": 128 * 1024 * 1024 + 1},
            "queue-frames-max": {"queue_frames": 257},
            "width-max": {"max_width": 8193},
            "height-max": {"max_height": 8193},
            "decoded-min": {"decoded_max": 383},
            "decoded-max": {"decoded_max": 64 * 1024 * 1024 + 1},
            "codec-mask": {"codecs": 64},
            "actual-width": {"max_width": 15},
            "actual-encoded-limit": {"wire_max": 8},
        }
        if kind in options:
            client.open(fixture, tracks=1 if kind.startswith("actual-") else 7, **options[kind])
        else:
            secret = security_payload(fixture)
            client.secrets.write(HEADER.pack(b"OMPG", 2, SECURITY, client.session, 0, 1, len(secret)) + secret)
            client.secrets.close()
            header = HEADER.pack(b"OMPG", 1 if kind == "version" else 2,
                OPEN, client.session, 0, 1, 65537 if kind == "oversized" else 0)
            client.process.stdin.write(header[:13] if kind == "truncated" else header)
            client.process.stdin.flush()
            if kind == "truncated":
                client.process.stdin.close()
        error = client.wait(ERROR)["json"]
        closed = client.wait(CLOSED)["json"]
        client.process.wait(timeout=4)
        actual = kind.startswith("actual-")
        expected = ("DecoderAllocationPolicy" if kind == "actual-width" else
            "EncodedFrameLimit" if actual else "InvalidOrUnauthorizedOpen" if kind in options else "InvalidIpcFrame")
        assert error["code"] == expected, (kind, error)
        assert closed["localCleanup"] and client.process.returncode != 0
        if actual:
            assert any(row["method"] == "PLAY" for row in fixture.records)
            assert not any(row["kind"] == DECODED for row in client.frames), "Allocation/encoded limit was enforced too late"
            assert closed["remote"] == "acknowledged"
        else:
            assert not fixture.records and not client.frames and closed["remote"] == "not-created"
        return dict(error=error, close=closed, nativeRequests=len(fixture.records),
            decodedFrames=0, optionValues=options.get(kind, {}))


def isolated_runtime_sessions(worker, sdk):
    with RuntimeFixture(auth="sha256", cycles=40) as fixture, RuntimeWorker(worker, sdk, session=101) as first, RuntimeWorker(worker, sdk, session=102) as second:
        first.wait(HELLO)
        second.wait(HELLO)
        first.open(fixture)
        second.open(fixture)
        identities = [first.wait(READY)["json"]["nativeSessionId"], second.wait(READY)["json"]["nativeSessionId"]]
        assert len(set(identities)) == 2
        first.wait_media()
        second.wait_media()
        first.close()
        second.wait_media(videos=6, audios=6, documents=6)
        assert second.process.poll() is None
        second.close()
        assert all(row["session"] == 101 for row in first.frames)
        assert all(row["session"] == 102 for row in second.frames)
        assert not fixture.errors, fixture.errors
        return dict(nativeSessionIds=identities, siblingSurvivedClose=True)

def verify_cohorts(client, fixture, generations=1):
    plays = [row["json"] for row in client.controls if row["kind"] == RESPONSE
        and row["json"]["method"] == "PLAY" and 200 <= row["json"]["status"] < 300]
    assert len(plays) == generations, plays
    expected = Counter((track, raw) for _, track, raw in fixture.sent_packets
        if track > 0 and raw not in fixture.stale_packets)
    observed = Counter()
    for generation in range(1, generations + 1):
        cohort = [row for row in client.frames if row["generation"] == generation]
        video, audio, documents, packets = [], [], [], 0
        for row in cohort:
            assert row["session"] == client.session
            payload = row["payload"]
            track = struct.unpack_from("!H", payload)[0]
            if row["kind"] == DECODED:
                track, fmt, width, height, rate, channels, reserved, count, pts, size = struct.unpack_from("!HHIIIHHIQI", payload)
                assert reserved == 0 and len(payload) == 36 + size
                if track == 1:
                    assert (fmt, width, height, rate, channels, count) == (1, 16, 16, 0, 0, 1)
                    video.append(payload[36:])
                else:
                    assert (track, fmt, width, height, rate, channels, count) == (2, 2, 0, 0, 8000, 1, 160)
                    audio.append(payload[36:])
            elif row["kind"] == METADATA:
                assert track == 3 and struct.unpack_from("!I", payload, 28)[0] == len(payload) - 32
                documents.append(payload[32:])
            elif row["kind"] == RTP:
                track, pt, marker, ssrc, seq, flags, cseq, stamp, receipt, ntp, valid, size = struct.unpack_from("!HBBIHBBIQQII", payload)
                raw = payload[40:]
                assert len(raw) == size and receipt > 0
                assert struct.unpack_from("!HII", raw, 2) == (seq, stamp, ssrc)
                assert (raw[1] & 127, raw[1] >> 7) == (pt, marker)
                if fixture.mode == "recorded":
                    assert valid & 1 and cseq == plays[generation - 1]["cseq"] & 255
                    assert struct.unpack_from("!QBB", raw, 16) == (ntp, flags, cseq)
                else:
                    assert (flags, cseq, ntp, valid) == (0, 0, 0, 0)
                observed[(track, raw)] += 1
                packets += 1
        assert video == [JPEG_I420] * 4, (generation, len(video))
        assert audio == [PCM_S16LE] * 4, (generation, len(audio))
        assert documents == [METADATA_XML] * 4, (generation, len(documents))
        assert packets == 20, (generation, packets)
    assert observed == expected, "Native packet observations differ from the complete independent wire cohort"
    assert all(row["generation"] in range(1, generations + 1) for row in client.frames)
    return dict(generations=generations, exactRtpPackets=sum(observed.values()),
        playCseqs=[row["cseq"] for row in plays])


def backchannel_case(worker, sdk, node, transport, *, enabled=True, invalid=None):
    with RuntimeFixture(transport=transport, auth="sha256", node=node, backchannel=True,
            expect_backchannel=enabled, outer_auth="sha256" if transport in ("http", "https") else "none") as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        client.open(fixture, transport=TRANSPORTS[transport], tracks=15 if enabled else 7,
            security={"ca_pem": fixture.ca_pem})
        ready = client.wait(READY)["json"]
        tracks = ready["tracks"]
        assert [track["id"] for track in tracks] == ([1, 2, 3, 4] if enabled else [1, 2, 3]), tracks
        assert ready["nativeSessionId"] == fixture.records[-1]["session"]
        if enabled:
            assert tracks[-1]["direction"] == "send" and tracks[-1]["encoding"] == "PCMU", tracks
        if invalid:
            client.send_audio(PCM_S16LE, rate=16000 if invalid == "format" else 8000)
            error = client.wait(ERROR)["json"]
            assert error["code"] == ("UnsupportedBackchannelFormat" if enabled else "UnsupportedBackchannel"), error
            closed = client.wait(CLOSED)["json"]
            client.process.wait(timeout=4)
            assert closed["localCleanup"] and client.process.returncode != 0
            assert not fixture.backchannel_packets, "Invalid/disabled input reached the native send track"
            return dict(error=error, close=closed, packets=0)
        if enabled:
            for _ in range(4):
                client.send_audio(PCM_S16LE)
                time.sleep(0.025)
            deadline = time.monotonic() + 4
            while len(fixture.backchannel_packets) < 4 and time.monotonic() < deadline:
                time.sleep(0.01)
        client.wait_media()
        closed = client.close()["json"]
        assert closed["localCleanup"] and closed["remote"] == "acknowledged"
        assert client.process.returncode == 0 and not client.errors, client.errors
        packets = fixture.backchannel_packets
        assert len(packets) == (4 if enabled else 0), (len(packets), fixture.errors, client.controls)
        samples = []
        headers = []
        for raw in packets:
            first, second, sequence, stamp, ssrc = struct.unpack_from("!BBHII", raw)
            assert first == 0x80 and second & 127 == 97 and len(raw) == 172, raw.hex()
            headers.append((sequence, stamp, ssrc))
            for octet in raw[12:]:
                value = ~octet & 255
                magnitude = (((value & 15) << 3) + 132) << ((value >> 4) & 7)
                samples.append(132 - magnitude if value & 128 else magnitude - 132)
        assert samples == ([0, 0, 32124, -32124] * 160 if enabled else []), samples[:16]
        for before, after in zip(headers, headers[1:]):
            assert after == ((before[0] + 1) & 65535, (before[1] + 160) & 0xFFFFFFFF, before[2])
        assert closed["backchannelPackets"] == len(packets) and closed["backchannelSamples"] == len(samples)
        assert not fixture.errors, fixture.errors
        return dict(transport=transport, optedIn=enabled, packets=len(packets),
            exactPcmSamples=len(samples), nativeSessionId=ready["nativeSessionId"], close=closed,
            stderr=client.stderr.decode("utf8", errors="replace"))


def scoped_tcp(worker, sdk):
    with RtspFixture(auth="sha256") as fixture, RuntimeWorker(worker, sdk) as client:
        hello = client.wait(HELLO)["json"]
        assert hello["protocol"] == 2 and hello["nativeCredentialInput"] is True
        client.open(fixture)
        ready = client.wait(READY)
        assert ready["generation"] == 1 and ready["json"]["protocolReady"] is True
        client.wait_media()
        result = client.close()
        assert result["json"]["remote"] == "acknowledged"
        assert result["json"]["localCleanup"] is True and client.process.returncode == 0
        video, audio, documents = [], [], []
        for item in client.frames:
            if item["kind"] == DECODED:
                track = struct.unpack_from("!H", item["payload"])[0]
                (video if track == 1 else audio).append(item["payload"][36:])
            elif item["kind"] == METADATA:
                documents.append(item["payload"][32:])
        assert video == [JPEG_I420] * 4 and audio == [PCM_S16LE] * 4
        assert documents == [METADATA_XML] * 4
        assert not fixture.errors and not client.errors
        return dict(close=result["json"], decodedVideoFrames=len(video),
            decodedAudioSamples=len(audio) * 160, metadataDocuments=len(documents),
            stderr=client.stderr.decode("utf8", errors="replace"))


def denied_scope(worker, sdk, field):
    with RtspFixture(auth="sha256") as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        options = {
            "origin": {"allowed_origins": ["rtsp://127.0.0.1:1"]},
            "principal": {"principal": "not-the-credential-owner"},
            "targetRef": {"target_ref": "not-the-credential-resource"},
            "realm": {"security": {"realm": "not-the-camera-realm"}},
        }[field]
        client.open(fixture, **options)
        error = client.wait(ERROR)["json"]
        closed = client.wait(CLOSED)["json"]
        client.process.wait(timeout=4)
        assert client.process.returncode != 0 and closed["remote"] == "not-created"
        assert not any(record["authorizationPresent"] for record in fixture.records)
        if field != "realm":
            assert not fixture.records
        return dict(error=error, remote=closed["remote"])


def md5_opt_in(worker, sdk, permitted):
    with RtspFixture(auth="md5") as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        client.open(fixture, security={"allow_md5": permitted})
        if permitted:
            client.wait(READY)
            client.wait_media()
            result = client.close()["json"]
            assert result["remote"] == "acknowledged"
        else:
            result = client.wait(ERROR)["json"]
            client.wait(CLOSED)
            client.process.wait(timeout=4)
            assert not any(record["authorizationPresent"] for record in fixture.records)
        assert not fixture.errors
        return result


def transport_case(worker, sdk, node, transport, *, mode="live", auth="sha256", outer="none",
                   allow_md5=False, injected=False):
    with RuntimeFixture(transport=transport, mode=mode, auth=auth, outer_auth=outer, node=node,
            sender_reports=mode == "live") as fixture, RuntimeWorker(worker, sdk) as client:
        if injected:
            fixture.username, fixture.password, fixture.realm = (
                "injected-native-user", "synthetic-native-private-value", "injected-native-realm")
            fixture.outer_username, fixture.outer_password, fixture.outer_realm = (
                "injected-outer-user", "synthetic-outer-private-value", "injected-outer-realm")
        client.wait(HELLO)
        client.open(fixture, transport={"tcp": 1, "udp": 2, "http": 3, "https": 4, "tls": 5}[transport],
            security={"ca_pem": fixture.ca_pem, "allow_md5": allow_md5})
        client.wait(READY)
        client.wait_media()
        time.sleep(0.1)
        result = client.close()
        assert result["json"]["remote"] == "acknowledged" and client.process.returncode == 0
        video = [row["payload"][36:] for row in client.frames
            if row["kind"] == DECODED and struct.unpack_from("!H", row["payload"])[0] == 1]
        audio = [row["payload"][36:] for row in client.frames
            if row["kind"] == DECODED and struct.unpack_from("!H", row["payload"])[0] == 2]
        documents = [row["payload"][32:] for row in client.frames if row["kind"] == METADATA]
        assert video == [JPEG_I420] * 4, f"Not four exact JPEG frames: {len(video)}"
        assert audio == [PCM_S16LE] * 4, f"Not four exact PCM chunks: {len(audio)}"
        assert documents == [METADATA_XML] * 4
        if transport in ("http", "https"):
            assert fixture.tunnel_trace["base64Quartets"] > 100
            assert fixture.tunnel_trace["splitReads"] > 100
            assert [r["method"] for r in fixture.outer_records if r["authorizationPresent"]] == (
                ["GET", "POST"] if outer != "none" else [])
        if transport in ("tls", "https"):
            assert fixture.tls_connections and not fixture.tls_errors
        rtcp = [row for row in client.frames if row["kind"] == RTCP]
        if mode == "live":
            assert len(rtcp) >= 3, f"Missing actual RTCP sender report observations: {rtcp}"
        assert not fixture.errors, fixture.errors
        assert not client.errors, client.errors
        if injected:
            public = json.dumps(client.controls) + client.stderr.decode("utf8", errors="replace") + repr(client.process.args)
            assert all(value not in public for value in
                (fixture.username, fixture.password, fixture.outer_username, fixture.outer_password))
            assert any(row["authorizationPresent"] for row in fixture.records)
            if outer != "none":
                assert all(row["algorithm"] == "SHA-256" and row["realm"] == fixture.outer_realm
                    for row in fixture.outer_records if row["authorizationPresent"])
        cohort = verify_cohorts(client, fixture)
        return dict(mode=mode, transport=transport, innerAuth=auth, outerAuth=outer,
            videoFrames=len(video), pcmSamples=len(audio) * 160, metadataDocuments=len(documents),
            senderReports=len(rtcp), close=result["json"], tunnel=fixture.tunnel_trace,
            tls=fixture.tls_connections, cohort=cohort, privateCredentialsInjected=injected,
            stderr=client.stderr.decode("utf8", errors="replace"))


def tls_rejection(worker, sdk, node, wrong_host):
    with RuntimeFixture(transport="https", auth="sha256", node=node, wrong_host=wrong_host) as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        client.open(fixture, transport=4, security={"ca_pem": fixture.ca_pem if wrong_host else ""})
        error = client.wait(ERROR)["json"]
        closed = client.wait(CLOSED)["json"]
        client.process.wait(timeout=5)
        assert fixture.tls_closed.wait(2), "TLS fixture did not observe connection closure"
        assert not fixture.records and not fixture.outer_records, "TLS validation must precede either credential-bearing protocol"
        assert closed["remote"] == "not-created" and client.process.returncode != 0
        assert fixture.tls_errors, f"Missing TLS peer rejection evidence: {fixture.errors}"
        assert error["code"] == "TlsCertificateRejected", error
        diagnostics = [row["json"] for row in client.controls
            if row["kind"] == 0x8007 and row["json"].get("code") == "TlsCertificateRejected"]
        assert diagnostics and diagnostics[0]["certificateErrors"] & (2 if wrong_host else 1), diagnostics
        assert not fixture.errors, fixture.errors
        return dict(error=error, tlsErrors=fixture.tls_errors, remote=closed["remote"],
            stderr=client.stderr.decode("utf8", errors="replace"))


def metadata_case(worker, sdk, *, gzip=False, loss=False, empty=False):
    document = (b'<m:MetadataStream xmlns:m="http://www.onvif.org/ver10/schema">'
        b'<m:VideoAnalytics><m:Frame UtcTime="2026-09-15T12:00:00.2500Z"/>'
        b'</m:VideoAnalytics></m:MetadataStream>') if empty else METADATA_XML
    with RuntimeFixture(auth="sha256", gzip_metadata=gzip, metadata_loss=loss,
            documents=[document]) as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        client.open(fixture)
        client.wait(READY)
        client.wait_media(documents=4 - int(loss))
        result = client.close()["json"]
        observed = [row["payload"][32:] for row in client.frames if row["kind"] == METADATA]
        assert observed == [document] * (4 - int(loss))
        if loss:
            assert any(row["kind"] == GAP for row in client.controls)
        assert not fixture.errors
        return dict(documents=len(observed), gzip=gzip, corruptDropped=int(loss), emptyFrame=empty, close=result)


def replay_controls(worker, sdk, node, transport, *, stale=False):
    ranges = [(START_NTP_NS, END_NTP_NS), (START_NTP_NS, END_NTP_NS),
        (START_NTP_NS + 5_000_000_000, END_NTP_NS + 5_000_000_000),
        (START_NTP_NS + 10_000_000_000, END_NTP_NS + 10_000_000_000)]
    with RuntimeFixture(transport=transport, mode="recorded", auth="sha256",
            outer_auth="sha256" if transport in ("http", "https") else "none", node=node,
            expected_ranges=ranges, stale_replay=stale) as fixture, RuntimeWorker(worker, sdk) as client:
        client.wait(HELLO)
        client.open(fixture, transport=TRANSPORTS[transport], security={"ca_pem": fixture.ca_pem})
        ready = client.wait(READY)
        assert ready["json"]["nativeSessionId"] == fixture.records[-1]["session"]
        client.wait_media(generation=1)
        ended = client.wait(END)
        assert ended["generation"] == 1 and ended["json"]["reason"] == "native-eos"
        sequence = client.send(PAUSE)
        receipt = client.wait(CONTROL)
        assert receipt["sequence"] == sequence and receipt["json"]["state"] == "paused" and receipt["generation"] == 1
        for generation, (start, end) in enumerate(ranges[1:], 2):
            kind = PLAY if generation == 2 else SEEK
            sequence = client.send(kind, b"" if kind == PLAY else struct.pack("!QQ", start, end))
            receipt = client.wait(CONTROL)
            assert receipt["generation"] == generation and receipt["json"]["state"] == "playing"
            assert receipt["sequence"] == sequence and receipt["json"]["command"] == kind
            assert any(row["kind"] == RESPONSE and row["sequence"] == sequence and
                row["json"]["method"] == "PLAY" and row["json"]["status"] == 200 for row in client.controls)
            client.wait_media(generation=generation)
            ended = client.wait(END)
            assert ended["generation"] == generation
            assert ended["json"]["lastDataSequence"] == max(row["sequence"] for row in client.frames)
            if generation == 2:
                sequence = client.send(PAUSE)
                assert client.wait(CONTROL)["sequence"] == sequence
        closed = client.close()["json"]
        assert fixture.play_ranges == ranges
        assert len({row["session"] for row in fixture.records}) == 1, "Controls must reuse the owned native RTSP session"
        assert any(row["kind"] == RESPONSE and row["json"]["method"] == "PAUSE" for row in client.controls)
        assert closed["remote"] == "acknowledged"
        assert not fixture.errors, fixture.errors
        if stale:
            gaps = [row for row in client.controls if row["kind"] == GAP and
                row["json"]["code"] == "ReplayGenerationMismatch"]
            assert len(gaps) == 3 and len(fixture.stale_packets) == 3, gaps
        cohort = verify_cohorts(client, fixture, generations=4)
        return dict(generations=4, ranges=ranges, transport=transport, close=closed, cohort=cohort,
            stderr=client.stderr.decode("utf8", errors="replace"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--sdk-root", type=Path, required=True)
    parser.add_argument("--case", default="all")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--node-executable", type=Path, default=Path("node"))
    args = parser.parse_args()
    args.worker, args.sdk_root = args.worker.resolve(strict=True), args.sdk_root.resolve(strict=True)
    worker_hash = hashlib.sha256(args.worker.read_bytes()).hexdigest()
    started_utc = datetime.now(timezone.utc).isoformat()
    cases = {
        "scoped-tcp": lambda: scoped_tcp(args.worker, args.sdk_root),
        **{f"deny-{field}": lambda field=field: denied_scope(args.worker, args.sdk_root, field)
           for field in ("origin", "principal", "targetRef", "realm")},
        "deny-md5-default": lambda: md5_opt_in(args.worker, args.sdk_root, False),
        "explicit-md5": lambda: md5_opt_in(args.worker, args.sdk_root, True),
        **{f"live-{transport}": lambda transport=transport: transport_case(
            args.worker, args.sdk_root, args.node_executable, transport,
            outer="sha256" if transport in ("http", "https") else "none")
            for transport in ("tcp", "udp", "http", "https", "tls")},
        **{f"replay-{transport}": lambda transport=transport: transport_case(
            args.worker, args.sdk_root, args.node_executable, transport, mode="recorded",
            outer="sha256" if transport in ("http", "https") else "none")
            for transport in ("tcp", "http", "https", "tls")},
        "tls-untrusted": lambda: tls_rejection(args.worker, args.sdk_root, args.node_executable, False),
        "tls-wrong-host": lambda: tls_rejection(args.worker, args.sdk_root, args.node_executable, True),
        "metadata-gzip": lambda: metadata_case(args.worker, args.sdk_root, gzip=True),
        "metadata-loss": lambda: metadata_case(args.worker, args.sdk_root, loss=True),
        "metadata-empty-frame": lambda: metadata_case(args.worker, args.sdk_root, empty=True),
        "replay-controls-tcp": lambda: replay_controls(args.worker, args.sdk_root, args.node_executable, "tcp"),
        "replay-controls-https": lambda: replay_controls(args.worker, args.sdk_root, args.node_executable, "https"),
        "replay-controls-http": lambda: replay_controls(args.worker, args.sdk_root, args.node_executable, "http"),
        "replay-controls-tls": lambda: replay_controls(args.worker, args.sdk_root, args.node_executable, "tls"),
        "replay-stale-generations": lambda: replay_controls(args.worker, args.sdk_root, args.node_executable, "tcp", stale=True),
        **{f"backchannel-{transport}": lambda transport=transport: backchannel_case(
            args.worker, args.sdk_root, args.node_executable, transport)
            for transport in ("tcp", "udp", "http", "https", "tls")},
        "backchannel-opt-out": lambda: backchannel_case(args.worker, args.sdk_root,
            args.node_executable, "tcp", enabled=False),
        "backchannel-deny-unrequested": lambda: backchannel_case(args.worker, args.sdk_root,
            args.node_executable, "tcp", enabled=False, invalid="disabled"),
        "backchannel-deny-format": lambda: backchannel_case(args.worker, args.sdk_root,
            args.node_executable, "tcp", invalid="format"),
        **{f"reject-auth-{auth}": lambda auth=auth: rejected_auth(args.worker, args.sdk_root,
            args.node_executable, auth=auth) for auth in ("basic", "sha512", "sess", "auth-int")},
        **{f"deny-{field}": lambda field=field: rejected_auth(args.worker, args.sdk_root,
            args.node_executable, outer_field=field) for field in ("outer_realm", "outer_origin")},
        **{f"auth-{auth}": lambda auth=auth: transport_case(args.worker, args.sdk_root,
            args.node_executable, "tcp", auth=auth) for auth in ("stale", "mixed", "none")},
        **{f"target-{kind}": lambda kind=kind: target_case(args.worker, args.sdk_root,
            args.node_executable, kind) for kind in
            ("sdp", "redirect", "redirect-allowed", "tls-scheme", "tls-downgrade", "udp-source")},
        **{f"udp-sender-{kind}": lambda kind=kind: udp_sender_case(args.worker, args.sdk_root, kind)
            for kind in ("address", "port", "rtcp-address")},
        **{f"metadata-{kind}": lambda kind=kind: metadata_guard_case(args.worker, args.sdk_root, kind)
            for kind in ("reorder", "gzip-crc", "gzip-bomb", "xxe", "utf8", "wire-limit", "inflated-limit", "exi")},
        **{f"{mode}-{kind}": lambda mode=mode, kind=kind: lifecycle_case(
            args.worker, args.sdk_root, kind, mode=mode)
            for mode in ("live", "recorded") for kind in ("stalled", "cancel-setup")},
        **{f"lifecycle-{kind}": lambda kind=kind: lifecycle_case(args.worker, args.sdk_root, kind,
            mode="recorded" if kind in ("credit", "credit-limit", "cancel-seek") else "live")
            for kind in ("credit", "credit-limit", "cancel-seek", "teardown-error", "teardown-ended", "teardown-timeout")},
        **{f"private-{kind}": lambda kind=kind: private_pipe_case(args.worker, args.sdk_root, kind)
            for kind in ("await-security-eof", "secret-redaction", "owned-crash")},
        "same-uri-isolated-runtime-sessions": lambda: isolated_runtime_sessions(args.worker, args.sdk_root),
        **{f"p0-runtime-{mode}-{auth}": lambda mode=mode, auth=auth: transport_case(
            args.worker, args.sdk_root, args.node_executable, "tcp", mode=mode, auth=auth,
            allow_md5=auth in ("legacy", "md5"))
            for mode in ("live", "recorded") for auth in ("none", "legacy", "md5", "sha256", "stale")},
        **{f"input-{kind}": lambda kind=kind: input_guard_case(args.worker, args.sdk_root, kind)
            for kind in ("version", "oversized", "truncated", "missing-target", "missing-principal",
                "wildcard-interface", "missing-origins", "too-many-origins", "wire-max", "inflated-max",
                "deadline-max", "queue-bytes-max", "queue-frames-max", "width-max", "height-max",
                "decoded-min", "decoded-max", "codec-mask", "actual-width", "actual-encoded-limit")},
        **{f"private-injected-{transport}": lambda transport=transport: transport_case(
            args.worker, args.sdk_root, args.node_executable, transport, injected=True,
            outer="sha256" if transport == "https" else "none") for transport in ("tcp", "https")},
    }
    unknown = set(args.case.split(",")) - cases.keys() if args.case != "all" else set()
    if unknown:
        parser.error(f"Unknown runtime cases: {sorted(unknown)}")
    selected = cases if args.case == "all" else {
        key: cases[key] for key in args.case.split(",")
    }
    results = {}
    for name, run in selected.items():
        started = time.monotonic()
        try:
            results[name] = {"pass": True, "evidence": run()}
            print(f"PASS {name}", flush=True)
        except (AssertionError, OSError, ValueError, EOFError) as error:
            results[name] = {"pass": False, "error": str(error) or repr(error)}
            print(f"FAIL {name}: {error}", flush=True)
            traceback.print_exc()
        results[name]["seconds"] = round(time.monotonic() - started, 3)
    report = {"protocol": 2, "fixture": "independent-python-stdlib", "selection": args.case,
        "startedUtc": started_utc, "workerSha256": worker_hash,
        "workerStable": hashlib.sha256(args.worker.read_bytes()).hexdigest() == worker_hash,
        "cases": results, "passed": sum(row["pass"] for row in results.values()),
        "total": len(results), "certification": False}
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    return 0 if report["passed"] == report["total"] and report["workerStable"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
