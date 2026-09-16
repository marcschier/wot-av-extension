"""Focused IPCv2 codec gate; see codec_fixture.py for synthesis and wire formats.

Example (from the repository root):
  python -B native\\onvif-media\\test\\codec_gate.py --worker WORKER.exe
      --sdk-root SDK --case all --report native\\onvif-media\\build-p0\\codec-generated\\report.json

--node-executable is accepted for consistency with runtime_gate; this TCP-only
gate does not start Node or need certificates. No new CMake generator target is
needed. Encoders/raw parsers/gst-launch are TEST-ONLY tools from the installed
SDK, never additions to the worker's private plugin directory. In particular,
x265enc is GPL test-only. Passing this gate is NOT a shipping/license approval.
"""

import argparse
from collections import Counter
from pathlib import Path
import struct
import sys
import time
import traceback

from codec_fixture import (
    AAC_SAMPLES, AUDIO_CHANNELS, AUDIO_RATE, CODECS, GENERATED_ROOT,
    CodecFixture, jpeg_reference, require, sha256, synthesize, write_json,
)
from runtime_ipc import CLOSED, DECODED, ERROR, GAP, HELLO, READY, RTP, RuntimeWorker


VIDEO_MAX_ABSOLUTE_ERROR = 0
# Silence is encoded from exact floating-point zeros. One S16 LSB allows
# the native float->integer audioconvert quantization/dither, not audible noise.
AUDIO_MAX_ABSOLUTE_ERROR = 1


class CodecFailure(AssertionError):
    def __init__(self, message, evidence):
        super().__init__(message)
        self.evidence = evidence


def decoded_header(item):
    payload = item["payload"]
    require(len(payload) >= 36, f"Truncated DECODED header: {len(payload)}")
    track, format_id, width, height, rate, channels, reserved, count, pts, size = (
        struct.unpack_from("!HHIIIHHIQI", payload))
    require(reserved == 0 and size == len(payload) - 36,
        f"Invalid DECODED size/reserved: size={size}, bytes={len(payload)}, reserved={reserved}")
    return dict(track=track, format=format_id, width=width, height=height, rate=rate,
        channels=channels, count=count, pts=pts, bytes=size)


def decoded_oracle(media, frames):
    require(len(frames) == len(media.units),
        f"{media.name}: expected {len(media.units)} decoded AUs, got {len(frames)}")
    actual_hashes, per_frame_counts, peak, nonzero = [], [], 0, 0
    previous_pts = None
    for index, item in enumerate(frames):
        header = decoded_header(item)
        data = item["payload"][36:]
        require(item["generation"] == 1 and item["session"] == 1,
            f"Decoded frame {index}: wrong IPC identity {item['session']}/{item['generation']}")
        require(header["track"] == media.track + 1 and header["format"] == media.track + 1,
            f"Decoded frame {index}: wrong track/format {header}")
        if media.audio:
            require((header["width"], header["height"], header["rate"], header["channels"],
                header["count"], header["bytes"]) ==
                (0, 0, AUDIO_RATE, AUDIO_CHANNELS, AAC_SAMPLES, AAC_SAMPLES * 2),
                f"AAC output caps/count mismatch at AU {index}: {header}")
            samples = struct.unpack("<" + "h" * AAC_SAMPLES, data)
            for offset, value in enumerate(samples):
                require(abs(value) <= AUDIO_MAX_ABSOLUTE_ERROR,
                    f"AAC silence mismatch AU={index} sample={offset}: actual={value}, "
                    f"expected=0 +/- {AUDIO_MAX_ABSOLUTE_ERROR} S16 LSB")
            peak = max(peak, max(map(abs, samples)))
            nonzero += sum(value != 0 for value in samples)
        else:
            require((header["width"], header["height"], header["rate"], header["channels"],
                header["count"], header["bytes"]) ==
                (media.width, media.height, 0, 0, 1, len(media.video_oracle)),
                f"{media.name} frame {index}: expected {media.width}x{media.height} "
                f"I420 ({len(media.video_oracle)} bytes), got {header}")
            if data != media.video_oracle:
                mismatch = next(offset for offset, (actual, expected) in
                    enumerate(zip(data, media.video_oracle)) if actual != expected)
                raise AssertionError(
                    f"{media.name} frame={index} byte={mismatch}: actual={data[mismatch]}, "
                    f"expected={media.video_oracle[mismatch]}; full I420 oracle requires exact bytes")
        # Recorded rate-control=no uses the replay extension's NTP clock;
        # GST_CLOCK_TIME_NONE is not a codec failure in that mode.
        if header["pts"] == 0xFFFFFFFFFFFFFFFF:
            require(media.mode == "recorded", f"Live frame {index} has no native PTS")
        else:
            require(previous_pts is None or header["pts"] > previous_pts,
                f"Decoded frame {index}: non-increasing native PTS {header['pts']}")
            previous_pts = header["pts"]
        actual_hashes.append(sha256(data))
        per_frame_counts.append(header["count"])
    return dict(
        decodedFrames=len(frames), decodedSamples=sum(per_frame_counts) if media.audio else 0,
        perAccessUnitCounts=per_frame_counts, decodedSha256=actual_hashes,
        oracle="every S16 sample versus mathematical zero" if media.audio else
            "every I420 Y/U/V byte versus independently defined neutral-gray 128 planes",
        maximumAbsoluteError=peak,
        allowedAbsoluteError=AUDIO_MAX_ABSOLUTE_ERROR if media.audio else VIDEO_MAX_ABSOLUTE_ERROR,
        nonzeroSamples=nonzero if media.audio else None,
    )


def rtp_oracle(media, fixture, frames):
    expected = [packet for unit in fixture.plan for packet in unit]
    sent = [packet for _, track, packet in fixture.sent_packets if track == media.track + 1]
    observed = [item for item in frames if item["kind"] == RTP]
    require(sent == expected, f"Fixture did not send its exact plan: {len(sent)}/{len(expected)}")
    require(len(observed) == len(expected),
        f"Expected {len(expected)} native RTP observations, got {len(observed)}")
    for index, (item, packet) in enumerate(zip(observed, expected)):
        payload = item["payload"]
        require(len(payload) >= 40, f"Truncated RTP observation {index}")
        track, pt, marker, ssrc, sequence, replay_flags, cseq, timestamp, receipt, ntp, flags, size = (
            struct.unpack_from("!HBBIHBBIQQII", payload))
        first, second, expected_sequence, expected_stamp, expected_ssrc = struct.unpack_from("!BBHII", packet)
        require(first == (0x90 if media.encoding == "JPEG" else 0x80),
            f"Unexpected RTP header {first:x}")
        require((track, pt, marker, ssrc, sequence, timestamp) ==
            (media.track + 1, second & 127, second >> 7, expected_ssrc, expected_sequence, expected_stamp),
            f"Native RTP header observation changed at packet {index}")
        expected_replay_flags, expected_cseq, expected_ntp, expected_flags = 0, 0, 0, 0
        if media.encoding == "JPEG":
            profile, words = struct.unpack_from("!HH", packet, 12)
            extension = packet[16:16 + words * 4]
            require(len(extension) == words * 4, f"JPEG extension truncated at packet {index}")
            if media.mode == "recorded":
                require(profile == 0xABAC, f"Missing outer replay extension at packet {index}")
                expected_ntp, expected_replay_flags, expected_cseq, reserved, profile, jpeg_words = (
                    struct.unpack_from("!QBBHHH", extension))
                require(reserved == 0 and jpeg_words + 4 == words,
                    f"Malformed nested JPEG extension at packet {index}")
                expected_flags = 1
            require(profile == (0xFFD8 if index % 2 == 0 else 0xFFFF),
                f"Wrong initial/continuation JPEG extension at packet {index}")
            expected_flags |= 2
        require((replay_flags, cseq, ntp, flags) ==
            (expected_replay_flags, expected_cseq, expected_ntp, expected_flags) and receipt > 0,
            f"Unexpected RTP extension/receipt at packet {index}")
        require(size == len(packet) and payload[40:] == packet,
            f"Native RTP bytes changed at packet {index}: size={size}, expected={len(packet)}")
        require(item["session"] == 1 and item["generation"] == 1,
            f"RTP observation {index} has wrong session/generation")
    require(fixture.negotiated_channels and
        fixture.negotiated_channels[media.track][0] != media.track * 2,
        f"Fixture did not exercise dynamically remapped channels: {fixture.negotiated_channels}")
    return dict(packets=len(expected), markers=sum(bool(packet[1] & 128) for packet in expected),
        packetPlanSha256=sha256(b"".join(struct.pack("!I", len(p)) + p for p in expected)),
        channels={str(key): list(value) for key, value in fixture.negotiated_channels.items()})


def diagnostics(client, fixture):
    decoded = [item for item in client.frames if item["kind"] == DECODED]
    summaries = []
    for item in decoded:
        try:
            summaries.append(dict(**decoded_header(item), sha256=sha256(item["payload"][36:])))
        except Exception as error:
            summaries.append(dict(error=repr(error)))
    return dict(
        controls=client.controls, workerErrors=client.errors, fixtureErrors=fixture.errors,
        workerExit=client.process.poll(), decoded=summaries,
        frameCounts={hex(kind): count for kind, count in Counter(
            item["kind"] for item in client.frames).items()},
        sentPackets=len(fixture.sent_packets), rtsp=fixture.records,
        stderr=client.stderr.decode("utf8", errors="replace"),
    )


def native_codec_case(worker, sdk, media, *, deny=False):
    evidence = dict(reference=media.evidence, denied=deny,
        expectedDecodedAccessUnits=0 if deny else len(media.units),
        allowedAbsoluteError=AUDIO_MAX_ABSOLUTE_ERROR if media.audio else VIDEO_MAX_ABSOLUTE_ERROR)
    fixture, client = CodecFixture(media), None
    try:
        with fixture, RuntimeWorker(worker, sdk) as client:
            hello = client.wait(HELLO)["json"]
            evidence["hello"] = hello
            require(hello["protocol"] == 2, f"Expected native IPCv2, got {hello!r}")
            require(media.encoding in hello.get("availableDecoders", []),
                f"Required native decoder not in HELLO inventory: {media.encoding}")
            allowed = 0x3F & ~media.mask if deny else media.mask
            evidence["allowedCodecMask"] = allowed
            client.open(fixture, tracks=2 if media.audio else 1, codecs=allowed)
            if deny:
                error = client.wait(ERROR)["json"]
                closed = client.wait(CLOSED)["json"]
                client.process.wait(timeout=4)
                require(error.get("code") in ("NoDecoder", "Unsupported"),
                    f"Codec mask denial must be NoDecoder/Unsupported, got {error!r}")
                require(not any(item["kind"] == DECODED for item in client.frames),
                    "Disallowed codec produced decoded output")
                require(not any(item["kind"] == READY for item in client.controls),
                    "Disallowed codec was incorrectly declared READY")
                require(client.process.returncode != 0 and closed.get("localCleanup") is True,
                    f"Codec denial must terminate and clean up: exit={client.process.returncode}; {closed!r}")
                require(not fixture.sent_packets, "Disallowed codec reached media transmission")
                evidence.update(error=error, close=closed, decodedFrames=0, decodedSamples=0)
            else:
                ready = client.wait(READY)
                require(ready["generation"] == 1 and ready["json"].get("protocolReady") is True,
                    f"Native READY is not protocol-ready generation 1: {ready!r}")
                tracks = ready["json"].get("tracks", [])
                require(len(tracks) == 1 and
                    (tracks[0].get("id"), tracks[0].get("encoding"), tracks[0].get("payloadType"),
                        tracks[0].get("clockRate")) ==
                    (media.track + 1, media.encoding, media.payload_type, media.clock_rate),
                    f"Native READY advertised the wrong codec/track: {tracks!r}")
                evidence["ready"] = ready
                client.wait_media(
                    videos=0 if media.audio else len(media.units),
                    audios=len(media.units) if media.audio else 0, documents=0, timeout=10)
                require(fixture.media_complete.wait(3), "Fixture sender did not finish")
                if media.mode == "live":
                    ended = client.wait(0x8009)
                    require(ended["json"].get("reason") == "native-eos" and
                        ended["json"].get("lastDataSequence") == max(item["sequence"] for item in client.frames),
                        f"Finite native stream did not drain via observed EOS: {ended}")
                time.sleep(0.15)
                closed = client.close()
                require(closed["json"].get("remote") == "acknowledged" and
                    closed["json"].get("localCleanup") is True and client.process.returncode == 0,
                    f"Native close/cleanup failed: {closed!r}; exit={client.process.returncode}")
                for thread in client.threads:
                    thread.join(timeout=2)
                require(not any(thread.is_alive() for thread in client.threads),
                    "Native IPC readers did not drain after process exit")
                decoded = [item for item in client.frames if item["kind"] == DECODED]
                evidence["rtp"] = rtp_oracle(media, fixture, client.frames)
                evidence.update(decoded_oracle(media, decoded))
                evidence["close"] = closed
                require(not any(item["kind"] in (ERROR, GAP) for item in client.controls),
                    f"Native codec path reported ERROR/GAP: {client.controls!r}")
        require(not fixture.errors and not client.errors,
            f"Fixture/IPC errors: {fixture.errors!r}; {client.errors!r}")
        evidence["diagnostics"] = diagnostics(client, fixture)
        return evidence
    except Exception as error:
        if client is not None:
            evidence["diagnostics"] = diagnostics(client, fixture)
            actual = [item for item in client.frames if item["kind"] == DECODED]
            evidence["decodedFrames"] = len(actual)
            evidence["decodedSamples"] = sum(
                struct.unpack_from("!I", item["payload"], 20)[0] for item in actual
                if media.audio and len(item["payload"]) >= 36)
            if fixture.media_complete.is_set() and not deny:
                try:
                    evidence["rtp"] = rtp_oracle(media, fixture, client.frames)
                except Exception as wire_error:
                    evidence["rtpError"] = repr(wire_error)
            evidence["exactVideoFrames"] = sum(
                item["payload"][36:] == media.video_oracle for item in actual if not media.audio)
        else:
            evidence["fixtureErrors"] = fixture.errors
        raise CodecFailure(f"{type(error).__name__}: {str(error) or repr(error)}", evidence) from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--sdk-root", type=Path, required=True)
    parser.add_argument("--node-executable", type=Path)
    parser.add_argument("--case", default="all",
        help="all, or comma-separated h264,h265,mpeg4,aac,deny-h264-mask,...")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    cases = {name: (name, False) for name in CODECS}
    cases.update({f"deny-{name}-mask": (name, True) for name in CODECS})
    cases.update({name: (name, False) for name in ("onvif-jpeg-sof", "onvif-jpeg-sof-replay")})
    selected = list(cases) if args.case == "all" else args.case.split(",")
    unknown = set(selected) - cases.keys()
    if unknown:
        parser.error(f"Unknown codec case(s): {sorted(unknown)}; choices={list(cases)}")
    worker, sdk = args.worker.resolve(), args.sdk_root.resolve()
    worker_hash = sha256(worker.read_bytes()) if worker.is_file() else None
    references, results = {}, {}
    for case in selected:
        started = time.monotonic()
        name, deny = cases[case]
        try:
            if name not in references:
                references[name] = (jpeg_reference(replay=name.endswith("-replay"))
                    if name.startswith("onvif-jpeg") else synthesize(name, sdk))
            evidence = native_codec_case(worker, sdk, references[name], deny=deny)
            results[case] = dict(pass_=True, evidence=evidence)
            print(f"PASS {case}: decoded={evidence['decodedFrames']} samples={evidence['decodedSamples']}", flush=True)
        except Exception as error:
            detail = traceback.format_exc()
            results[case] = dict(pass_=False, error=repr(error), traceback=detail)
            if hasattr(error, "evidence"):
                results[case]["evidence"] = error.evidence
            print(f"FAIL {case}: {error!r}", flush=True)
            print(detail, file=sys.stderr, flush=True)
        results[case]["pass"] = results[case].pop("pass_")
        results[case]["seconds"] = round(time.monotonic() - started, 3)
    report = dict(protocol=2, fixture="independent-python-stdlib-rtsp-rtp", selection=args.case,
        generation="Installed native encoders, synthetic local files only",
        worker=str(worker), workerSha256=worker_hash,
        workerStable=worker.is_file() and sha256(worker.read_bytes()) == worker_hash,
        generatedDirectory=str(GENERATED_ROOT),
        nodeUsed=False, cases=results, passed=sum(row["pass"] for row in results.values()),
        total=len(results), certification=False, distributionApproved=False,
        licensing={
            "runtimePluginBundleModified": False,
            "testOnly": "openh264enc: BSD; x265enc: GPL; avenc_mpeg4/avenc_aac and rawparse: LGPL (installed plugin declarations)",
            "shippingGate": "No maintainer, private-patch, codec-patent or distribution approval is implied. "
                "Do not bundle test-only tools/encoders; x265 testing remains a separate GPL dependency.",
        },
        integration={
            "newCMakeTargetRequired": False,
            "suggestedCTestName": "media.codec",
            "suggestedCTestTimeoutSeconds": 180,
            "suggestedCTestRunSerial": True,
            "command": [sys.executable, "-B", str(Path(__file__).resolve()),
                "--worker", str(worker), "--sdk-root", str(sdk), "--case", "all",
                "--report", str(GENERATED_ROOT / "report.json")],
        })
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        write_json(args.report, report)
    print(f"{report['passed']}/{report['total']} codec cases passed", flush=True)
    return 0 if report["passed"] == report["total"] and report["workerStable"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
