"""Synthetic codec references and an independent Python-stdlib RTSP/RTP sender.

Only fixture generation invokes the explicitly supplied, installed gst-launch.
The worker is always RuntimeWorker, and the wire sender is never GStreamer.
Generated sources, elementary streams, caps logs and manifests stay in ignored
build-p0/codec-generated. No media, executables or dependencies are downloaded.

Payload formats: RFC 6184 sections 5.6/5.8 (H264 single NAL/FU-A), RFC 7798
sections 4.4.1/4.4.3 (H265 single NAL/FU, no DON), RFC 6416 section 4 (MP4V-ES),
and RFC 3640 sections 3.2/3.3 (AAC-hbr, one AU, 13/3-bit size/index).
These are deliberately narrow 8-bit 4:2:0 and AAC-LC reference cases, not
claims about every profile or about distribution/licensing approval.
"""

import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import threading
import traceback

from runtime_fixture import NATIVE_ROOT, RuntimeFixture
from rtsp_fixture import START_NTP_NS


GENERATED_ROOT = Path(os.environ.get("ONVIF_MEDIA_BUILD_ROOT", NATIVE_ROOT / "build-p0")) / "codec-generated"
WIDTH, HEIGHT, FPS, SOURCE_FRAMES = 64, 48, 10, 8
AUDIO_RATE, AUDIO_CHANNELS, AAC_SAMPLES = 48000, 1, 1024
# Neutral gray has zero intra-prediction residual. It remains an exact oracle
# even with the BSD OpenH264 encoder, which quantizes a Y=16 black source.
GRAY_I420 = bytes([128]) * (WIDTH * HEIGHT * 3 // 2)
SILENCE_F32LE = bytes(SOURCE_FRAMES * AAC_SAMPLES * AUDIO_CHANNELS * 4)
CODECS = {
    "h264": ("H264", 2, "openh264enc", "h264parse"),
    "h265": ("H265", 4, "x265enc", "h265parse"),
    "mpeg4": ("MP4V-ES", 8, "avenc_mpeg4", "mpeg4videoparse"),
    "aac": ("MPEG4-GENERIC", 32, "avenc_aac", "aacparse"),
}
TOOL_PLUGINS = (
    "gstcoreelements", "gstrawparse", "gstopenh264", "gstx265",
    "gstlibav", "gstaudioparsers", "gstvideoparsersbad", "gsttypefindfunctions",
)


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf8")


def tool_environment(sdk, output):
    plugins = output / "test-tool-plugins"
    gio = output / "test-tool-gio"
    plugins.mkdir(parents=True, exist_ok=True)
    gio.mkdir(parents=True, exist_ok=True)
    expected = {name + ".dll" for name in TOOL_PLUGINS}
    require(not ({path.name for path in plugins.glob("*.dll")} - expected),
        "Unexpected plugin in the private test-tool directory")
    require(not list(gio.glob("*.dll")), "Test encoders require no external GIO modules")
    for name in expected:
        source, destination = sdk / "lib" / "gstreamer-1.0" / name, plugins / name
        if not destination.is_file() or sha256(destination.read_bytes()) != sha256(source.read_bytes()):
            shutil.copyfile(source, destination)
    environment = dict(os.environ)
    for key in (
        "GST_PLUGIN_PATH", "GST_PLUGIN_PATH_1_0", "GST_PLUGIN_FEATURE_RANK",
        "GST_DEBUG_FILE", "GST_DEBUG_DUMP_DOT_DIR", "GST_TRACERS",
    ):
        environment.pop(key, None)
    environment.update(
        PATH=str(sdk / "bin") + os.pathsep + environment.get("PATH", ""),
        GST_PLUGIN_SYSTEM_PATH_1_0=str(plugins),
        GST_PLUGIN_PATH_1_0="",
        GST_REGISTRY_1_0=str(output / "isolated-test-encoder-registry.bin"),
        GIO_MODULE_DIR=str(gio), GIO_EXTRA_MODULES="", GIO_USE_PROXY_RESOLVER="dummy",
        GST_REGISTRY_FORK="no", GST_DEBUG="1", GST_DEBUG_NO_COLOR="1",
    )
    return environment


def run_tool(command, environment, *, timeout=60):
    result = subprocess.run(
        list(map(str, command)), env=environment, capture_output=True,
        timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    stdout = result.stdout.decode("utf8", errors="replace")
    stderr = result.stderr.decode("utf8", errors="replace")
    require(result.returncode == 0,
        f"Test-only native tool exit={result.returncode}; command={command!r}; "
        f"stdout={stdout[-12000:]!r}; stderr={stderr[-12000:]!r}")
    return stdout, stderr


def inspect_factory(sdk, output, factory):
    stdout, stderr = run_tool(
        [sdk / "bin" / "gst-inspect-1.0.exe", factory], tool_environment(sdk, output))
    fields = {}
    plugin = stdout.split("Plugin Details:", 1)[1].split("\n\n", 1)[0]
    for name in ("Name", "Version", "License", "Filename", "Source module"):
        match = re.search(r"^\s*" + re.escape(name) + r"\s+(.+)$", plugin, re.M)
        require(match is not None, f"{factory}: missing plugin inventory field {name}")
        fields[name] = match[1].strip()
    filename = Path(fields["Filename"])
    fields.update(factory=factory, binarySha256=sha256(filename.read_bytes()))
    (output / f"inspect-{factory}.txt").write_text(stdout + stderr, encoding="utf8")
    return fields


def annex_b_nals(encoded):
    starts = list(re.finditer(b"\x00\x00\x00?\x01", encoded))
    require(bool(starts) and starts[0].start() == 0, "Expected Annex B start code")
    result = []
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(encoded)
        nal = encoded[match.end():end]
        require(bool(nal), f"Empty Annex B NAL at {match.start()}")
        result.append(nal)
    return result


def rbsp(nal):
    return re.sub(b"\x00\x00\x03", b"\x00\x00", nal)


def h26x_units(encoded, hevc=False):
    units, pending, has_picture = [], [], False
    for nal in annex_b_nals(encoded):
        require(len(nal) >= (3 if hevc else 2), f"Truncated NAL: {nal.hex()}")
        kind = (nal[0] >> 1) & 63 if hevc else nal[0] & 31
        vcl = kind <= 31 if hevc else kind in (1, 5)
        # first_mb_in_slice=0 is Exp-Golomb '1'; HEVC's first-slice flag
        # is the first RBSP bit. Neither needs a decoder to find AU boundaries.
        first_slice = vcl and bool(nal[2 if hevc else 1] & 0x80)
        prefix = kind in ((32, 33, 34, 35, 39) if hevc else (6, 7, 8, 9))
        if has_picture and (prefix or first_slice):
            units.append(tuple(pending))
            pending, has_picture = [], False
        pending.append(nal)
        has_picture = has_picture or vcl
    require(has_picture, "Encoded stream ends without a picture")
    units.append(tuple(pending))
    require(len(units) == SOURCE_FRAMES,
        f"Expected {SOURCE_FRAMES} encoded pictures, parsed {len(units)}")
    return tuple(units)


def mpeg4_units(encoded):
    starts = list(re.finditer(b"\x00\x00\x01", encoded))
    require(bool(starts) and starts[0].start() == 0, "Missing MPEG4 start code")
    units, pending, has_picture = [], bytearray(), False
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(encoded)
        segment = encoded[match.start():end]
        require(len(segment) >= 4, "Truncated MPEG4 start code")
        code = segment[3]
        if has_picture and (code in (0xB0, 0xB3, 0xB5, 0xB6) or 0x20 <= code <= 0x2F):
            units.append((bytes(pending),))
            pending, has_picture = bytearray(), False
        pending.extend(segment)
        has_picture = has_picture or code == 0xB6
    require(has_picture, "MPEG4 stream ends without a VOP")
    units.append((bytes(pending),))
    require(len(units) == SOURCE_FRAMES,
        f"Expected {SOURCE_FRAMES} MPEG4 VOPs, parsed {len(units)}")
    return tuple(units)


def adts_units(encoded):
    units, configurations, offset = [], set(), 0
    rates = (96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
        16000, 12000, 11025, 8000, 7350)
    while offset < len(encoded):
        head = encoded[offset:offset + 7]
        require(len(head) == 7 and head[0] == 0xFF and head[1] & 0xFE == 0xF0,
            f"Expected MPEG4 ADTS header at byte {offset}: {head.hex()}")
        object_type, frequency = (head[2] >> 6) + 1, (head[2] >> 2) & 15
        channels = ((head[2] & 1) << 2) | (head[3] >> 6)
        length = ((head[3] & 3) << 11) | (head[4] << 3) | (head[5] >> 5)
        header_size = 7 if head[1] & 1 else 9
        require(head[6] & 3 == 0, "Only one raw_data_block per ADTS frame is qualified")
        require(header_size < length <= len(encoded) - offset, "Invalid ADTS frame length")
        require(object_type == 2 and frequency < len(rates) and
            rates[frequency] == AUDIO_RATE and channels == AUDIO_CHANNELS,
            f"Expected AAC-LC {AUDIO_RATE}Hz mono, got AOT={object_type}, "
            f"frequencyIndex={frequency}, channels={channels}")
        config = ((object_type << 11) | (frequency << 7) | (channels << 3)).to_bytes(2, "big")
        configurations.add(config)
        units.append((encoded[offset + header_size:offset + length],))
        offset += length
    require(len(configurations) == 1, f"AAC configuration changed: {configurations!r}")
    # libav AAC has 1024 samples of encoder delay. ADTS/RTP has no edit list
    # to remove it: qualify every decoded sample, including this silent AU.
    require(len(units) == SOURCE_FRAMES + 1,
        f"Expected {SOURCE_FRAMES} input AAC blocks + one priming AU, got {len(units)}")
    return tuple(units), configurations.pop().hex()


@dataclass(frozen=True)
class CodecMedia:
    name: str
    encoding: str
    mask: int
    units: tuple
    fmtp: str
    evidence: dict
    mode: str = "live"
    width: int = WIDTH
    height: int = HEIGHT
    video_oracle: bytes = GRAY_I420

    @property
    def audio(self):
        return self.name == "aac"

    @property
    def track(self):
        return 1 if self.audio else 0

    @property
    def payload_type(self):
        return 26 if self.encoding == "JPEG" else 97 if self.audio else 96

    @property
    def clock_rate(self):
        return AUDIO_RATE if self.audio else 90000


def encoded_description(name, encoded):
    if name in ("h264", "h265"):
        hevc = name == "h265"
        units = h26x_units(encoded, hevc)
        nals = [nal for unit in units for nal in unit]
        def parameter(kind):
            matches = [nal for nal in nals if
                ((nal[0] >> 1) & 63 if hevc else nal[0] & 31) == kind]
            require(bool(matches), f"{name}: missing parameter-set NAL {kind}")
            require(len(set(matches)) == 1, f"{name}: parameter-set changed")
            return matches[0]
        def b64(value):
            return base64.b64encode(value).decode("ascii")
        if not hevc:
            sps, pps = parameter(7), parameter(8)
            profile = sps[1:4].hex()
            require(sps[1] == 66, f"Expected H264 baseline profile, got SPS={sps.hex()}")
            fmtp = f"packetization-mode=1;profile-level-id={profile};sprop-parameter-sets={b64(sps)},{b64(pps)}"
            description = dict(profile="constrained-baseline", profileLevelId=profile,
                spsHex=sps.hex(), ppsHex=pps.hex(), rfc="6184")
        else:
            vps, sps, pps = parameter(32), parameter(33), parameter(34)
            profile = rbsp(sps[2:])
            require(len(profile) >= 13, "Truncated H265 profile_tier_level")
            require(profile[1] & 31 == 1, f"Expected HEVC Main profile: {profile.hex()}")
            fmtp = (f"sprop-max-don-diff=0;sprop-vps={b64(vps)};"
                f"sprop-sps={b64(sps)};sprop-pps={b64(pps)}")
            description = dict(profile="Main", profileId=profile[1] & 31,
                tierFlag=(profile[1] >> 5) & 1, levelId=profile[12],
                vpsHex=vps.hex(), spsHex=sps.hex(), ppsHex=pps.hex(), rfc="7798")
        description["nalUnitTypes"] = [
            [((nal[0] >> 1) & 63) if hevc else (nal[0] & 31) for nal in unit]
            for unit in units]
    elif name == "mpeg4":
        units = mpeg4_units(encoded)
        require(encoded[:4] == b"\x00\x00\x01\xb0", "Missing MPEG4 VisualObjectSequence")
        profile = encoded[4]
        require(profile in (1, 2, 3), f"Expected MPEG4 Simple Profile level 1-3, got {profile}")
        prefix = units[0][0].split(b"\x00\x00\x01\xb6", 1)[0]
        config = prefix.split(b"\x00\x00\x01\xb3", 1)[0]
        fmtp = f"profile-level-id={profile};config={config.hex()}"
        description = dict(profile="Simple Profile", profileLevelId=profile,
            configurationHex=config.hex(), rfc="6416")
    else:
        units, config = adts_units(encoded)
        # RFC3640 uses decimal audioProfileLevelIndication, not AudioObjectType.
        # 0x29 = AAC Profile Level 2 (48 kHz mono is within that level).
        # Public table: github.com/gpac/gpac, src/media_tools/av_parsers.c.
        fmtp = (f"streamtype=5;profile-level-id=41;mode=AAC-hbr;config={config};"
            "sizelength=13;indexlength=3;indexdeltalength=3;constantduration=1024")
        description = dict(profile="AAC-LC", level="2", profileLevelId=41, audioObjectType=2,
            audioSpecificConfig=config, rate=AUDIO_RATE, channels=AUDIO_CHANNELS,
            samplesPerAccessUnit=AAC_SAMPLES, inputSamples=SOURCE_FRAMES * AAC_SAMPLES,
            encodedSamples=len(units) * AAC_SAMPLES, encoderPrimingSamples=AAC_SAMPLES,
            primingPolicy="No RTP edit list; check all samples including the silent priming AU",
            rfc="3640")
    description.update(encodedAccessUnits=len(units),
        accessUnitBytes=[sum(map(len, unit)) for unit in units])
    return units, fmtp, description


def synthesize(name, sdk, output=GENERATED_ROOT):
    output.mkdir(parents=True, exist_ok=True)
    encoding, mask, encoder, parser = CODECS[name]
    audio = name == "aac"
    source = SILENCE_F32LE if audio else GRAY_I420 * SOURCE_FRAMES
    source_path = output / ("silence-48000-mono.f32le" if audio else "gray-64x48.i420")
    if not source_path.exists() or source_path.read_bytes() != source:
        source_path.write_bytes(source)
    encoded_path = output / f"{name}.es"
    inventory = [inspect_factory(sdk, output, factory) for factory in
        ("filesrc", "rawaudioparse" if audio else "rawvideoparse", encoder, parser, "filesink")]
    # Quoting is for GStreamer's pipeline parser, not a shell. Its string
    # literals need backslashes escaped even when subprocess receives argv.
    def location(path):
        return "location=" + json.dumps(str(path))
    if audio:
        pipeline = [
            "filesrc", location(source_path), "blocksize=4096", "!",
            "rawaudioparse", "format=pcm", "pcm-format=f32le",
            "sample-rate=48000", "num-channels=1", "interleaved=true", "!",
            "avenc_aac", "bitrate=64000", "!",
            "aacparse", "!", "audio/mpeg,mpegversion=4,stream-format=adts", "!",
        ]
    else:
        pipeline = ["filesrc", location(source_path), f"blocksize={len(GRAY_I420)}", "!",
            "rawvideoparse", "format=i420", f"width={WIDTH}", f"height={HEIGHT}",
            f"framerate={FPS}/1", "!"]
        if name == "h264":
            pipeline += ["openh264enc", "gop-size=1", "multi-thread=1",
                "rate-control=off", "qp-min=0", "qp-max=0",
                "enable-frame-skip=false", "!",
                "video/x-h264,profile=constrained-baseline", "!", "h264parse", "!",
                "video/x-h264,stream-format=byte-stream,alignment=au", "!"]
        elif name == "h265":
            pipeline += ["x265enc", "speed-preset=ultrafast", "tune=zerolatency",
                "key-int-max=8", "qp=0",
                "option-string=bframes=0:rc-lookahead=0:frame-threads=1:pools=none:aud=1:repeat-headers=1",
                "!", "h265parse", "!",
                "video/x-h265,profile=main,stream-format=byte-stream,alignment=au", "!"]
        else:
            pipeline += ["avenc_mpeg4", "gop-size=1", "max-bframes=0",
                "qmin=2", "qmax=2", "!", "mpeg4videoparse", "!"]
    pipeline += ["filesink", location(encoded_path)]
    recipe = dict(version=1, sourceSha256=sha256(source), pipeline=pipeline,
        plugins=[(row["factory"], row["Version"], row["binarySha256"]) for row in inventory])
    recipe_hash = sha256(json.dumps(recipe, sort_keys=True).encode("utf8"))
    manifest_path = output / f"{name}-generation.json"
    previous = json.loads(manifest_path.read_text(encoding="utf8")) if manifest_path.exists() else {}
    cached = (previous.get("recipeSha256") == recipe_hash and encoded_path.exists()
        and (output / f"encode-{name}.log").exists()
        and sha256(encoded_path.read_bytes()) == previous.get("encodedSha256"))
    if cached:
        log = (output / f"encode-{name}.log").read_text(encoding="utf8")
    else:
        stdout, stderr = run_tool([sdk / "bin" / "gst-launch-1.0.exe", "-e", "-v", *pipeline],
            tool_environment(sdk, output))
        log = stdout + "\nSTDERR:\n" + stderr
        (output / f"encode-{name}.log").write_text(log, encoding="utf8")
    encoded = encoded_path.read_bytes()
    require(0 < len(encoded) <= 1024 * 1024, f"Unbounded/empty synthetic stream: {len(encoded)}")
    units, fmtp, description = encoded_description(name, encoded)
    caps = sorted(set(line.split("caps = ", 1)[1] for line in log.splitlines() if "caps = " in line))
    require(bool(caps), f"Missing actual negotiated generation caps for {name}")
    evidence = dict(
        codec=name, encoding=encoding, recipeSha256=recipe_hash,
        sourceSha256=sha256(source), sourceBytes=len(source),
        sourceFrames=SOURCE_FRAMES, source="Python-defined exact zero F32LE" if audio else
            "Python-defined I420 neutral gray: every Y=U=V=128 (zero intra residual)",
        oracleSha256=sha256(bytes(len(units) * AAC_SAMPLES * 2) if audio else GRAY_I420),
        encodedSha256=sha256(encoded), encodedBytes=len(encoded),
        encodedFile=str(encoded_path), sourceFile=str(source_path), negotiatedCaps=caps,
        rtpFmtp=fmtp,
        generationCommand=[str(sdk / "bin" / "gst-launch-1.0.exe"), "-e", "-v", *pipeline],
        testOnlyPlugins=inventory, gplTestOnly=name == "h265",
        distributionApproved=False, certification=False, **description,
    )
    write_json(manifest_path, evidence)
    return CodecMedia(name, encoding, mask, units, fmtp, evidence)


def jpeg_reference(*, replay=False, output=GENERATED_ROOT):
    """SOF specifies 17px; RFC2435's rounded-up width can only specify 24px.

    ONVIF Streaming 26.06, 5.1.4.1 and 5.1.4.2, pages 15-17:
    https://www.onvif.org/specs/stream/ONVIF-Streaming-Spec.pdf
    Initial FFD8 and continuation FFFF extensions carry JPEG marker segments.
    The supplied SOF overrides the rounded RTP dimensions. This deliberately
    tests meaningful decoding, not successful passthrough of inert extensions.
    """
    name = "onvif-jpeg-sof-replay" if replay else "onvif-jpeg-sof"
    width, height = 17, 16
    # Two 16x16 MCUs: four zero-DC luma blocks and two zero-DC chroma
    # blocks each, using RFC2435's standard Huffman DC=0/EOB codes.
    scan = int(("001010" * 4 + "0000" * 2) * 2, 2).to_bytes(8, "big") + b"\xff\xd9"
    sof = (b"\xff\xc0" + struct.pack("!HBHHB", 17, 8, height, width, 3)
        + b"\x01\x22\x00\x02\x11\x01\x03\x11\x01")
    oracle = bytes([128]) * (width * height + 2 * ((width + 1) // 2) * ((height + 1) // 2))
    evidence = dict(
        codec=name, encoding="JPEG", profile="baseline sequential YCbCr 4:2:0",
        source="Hand-constructed DC=0/EOB entropy, two gray MCUs; no encoder or external image",
        sourceSha256=sha256(oracle * 4), sourceBytes=len(oracle) * 4, sourceFrames=4,
        oracleSha256=sha256(oracle), encodedSha256=sha256(sof + scan),
        encodedBytes=len(sof + scan), encodedAccessUnits=4,
        actualWidth=width, actualHeight=height, rtpRoundedWidth=24, rtpRoundedHeight=16,
        scanHex=scan.hex(), sofHex=sof.hex(), extensionPadding="FF to 32-bit boundary",
        extensionProfiles=["0xffd8", "0xffff"], replayNested=replay,
        reference="ONVIF Streaming 26.06 sections 5.1.4.1/5.1.4.2 pages 15-17; RFC2435",
        referenceUrl="https://www.onvif.org/specs/stream/ONVIF-Streaming-Spec.pdf",
        negotiatedCaps=["application/x-rtp,media=video,encoding-name=JPEG,clock-rate=90000,payload=26"],
        testOnlyPlugins=[], gplTestOnly=False, distributionApproved=False, certification=False,
    )
    output.mkdir(parents=True, exist_ok=True)
    (output / f"{name}-sof.bin").write_bytes(sof)
    (output / f"{name}-scan.bin").write_bytes(scan)
    write_json(output / f"{name}-generation.json", evidence)
    return CodecMedia(name, "JPEG", 1, ((scan,),) * 4, "", evidence,
        mode="recorded" if replay else "live", width=width, height=height, video_oracle=oracle)


def jpeg_packet_plan(media, cseq, start_ns):
    sof = bytes.fromhex(media.evidence["sofHex"])
    sof += b"\xff" * (-len(sof) % 4)
    scan = media.units[0][0]
    plan = []
    for frame in range(len(media.units)):
        packets = []
        for part, entropy in enumerate((scan[:4], scan[4:])):
            profile, extension = (0xFFD8, sof) if part == 0 else (0xFFFF, b"")
            if media.mode == "recorded":
                seconds, ns = divmod(start_ns + frame * 100_000_000, 1_000_000_000)
                ntp = (seconds << 32) | ((ns << 32) // 1_000_000_000)
                flags = (0x80 if part == 0 else 0) | (0x20 if frame == part == 0 else 0)
                if frame == len(media.units) - 1 and part == 1:
                    flags |= 0x50
                extension = (struct.pack("!QBBHHH", ntp, flags, cseq & 255, 0,
                    profile, len(extension) // 4) + extension)
                profile = 0xABAC
            offset = 0 if part == 0 else 4
            jpeg = b"\0" + offset.to_bytes(3, "big") + bytes([1, 255, 3, 2])
            if part == 0:
                jpeg += b"\x00\x00\x00\x80" + bytes([1]) * 128
            header = struct.pack("!BBHII", 0x90, 26 | (0x80 if part else 0),
                1000 + frame * 2 + part, 0x10000000 + frame * 9000, 0x10203040)
            packets.append(header + struct.pack("!HH", profile, len(extension) // 4)
                + extension + jpeg + entropy)
        plan.append(tuple(packets))
    return tuple(plan)


def nal_payloads(nal, *, hevc=False):
    header_size = 2 if hevc else 1
    kind = (nal[0] >> 1) & 63 if hevc else nal[0] & 31
    vcl = kind <= 31 if hevc else kind in (1, 5)
    # Force picture fragmentation even for tiny constant images, while
    # leaving short parameter sets as independent single-NAL packets.
    limit = 8 if vcl else 900
    if len(nal) <= limit + header_size:
        return [nal]
    body = nal[header_size:]
    fragments = [body[offset:offset + limit] for offset in range(0, len(body), limit)]
    result = []
    for index, fragment in enumerate(fragments):
        flags = (0x80 if index == 0 else 0) | (0x40 if index == len(fragments) - 1 else 0)
        header = (bytes([(nal[0] & 0x81) | (49 << 1), nal[1], kind | flags])
            if hevc else bytes([(nal[0] & 0xE0) | 28, kind | flags]))
        result.append(header + fragment)
    return result


def unit_payloads(media, unit):
    if media.name in ("h264", "h265"):
        return [payload for nal in unit for payload in
            nal_payloads(nal, hevc=media.name == "h265")]
    if media.audio:
        require(len(unit) == 1 and len(unit[0]) < 8192, "AAC AU exceeds 13-bit size")
        # AU-headers-length=16 bits; AU-size is in octets, AU-index=0.
        return [struct.pack("!HH", 16, len(unit[0]) << 3) + unit[0]]
    data = unit[0]
    return [data[offset:offset + 32] for offset in range(0, len(data), 32)]


def packet_plan(media, cseq=0, start_ns=START_NTP_NS):
    if media.encoding == "JPEG":
        return jpeg_packet_plan(media, cseq, start_ns)
    sequence = 2000 if media.audio else 1000
    timestamp = 0x20000000 if media.audio else 0x10000000
    step = AAC_SAMPLES if media.audio else 90000 // FPS
    ssrc = 0x20304050 if media.audio else 0x10203040
    plan = []
    for index, unit in enumerate(media.units):
        payloads = unit_payloads(media, unit)
        packets = []
        for part, payload in enumerate(payloads):
            header = struct.pack("!BBHII", 0x80,
                media.payload_type | (0x80 if part == len(payloads) - 1 else 0),
                sequence & 0xFFFF, (timestamp + index * step) & 0xFFFFFFFF, ssrc)
            packets.append(header + payload)
            sequence += 1
        plan.append(tuple(packets))
    return tuple(plan)


class CodecFixture(RuntimeFixture):
    def __init__(self, media):
        super().__init__(transport="tcp", auth="sha256", mode=media.mode)
        self.media = media
        self.plan = packet_plan(media)
        self.media_complete = threading.Event()
        self.negotiated_channels = {}

    def _sdp(self):
        media = self.media
        lines = [
            "v=0", "o=- 1 1 IN IP4 127.0.0.1",
            "s=Owned synthetic native codec reference", "c=IN IP4 127.0.0.1",
            "t=0 0", "a=control:*",
            f"m={'audio' if media.audio else 'video'} 0 RTP/AVP {media.payload_type}",
            f"a=rtpmap:{media.payload_type} {media.encoding}/{media.clock_rate}"
                + ("/1" if media.audio else ""),
            f"a=control:track{media.track}", "a=recvonly",
        ]
        if media.mode == "live":
            lines.insert(6, "a=range:npt=0-")
        if media.fmtp:
            lines.append(f"a=fmtp:{media.payload_type} {media.fmtp}")
        return ("\r\n".join(lines) + "\r\n").encode("ascii")

    def _media_v2(self, connection, send_lock, transports, cseq, ended, session, play, start_ns):
        try:
            require(play == 1, f"Codec baseline expects one PLAY, not {play}")
            require(set(transports) == {self.media.track},
                f"Unexpected negotiated tracks: {transports!r}")
            self.plan = packet_plan(self.media, cseq, start_ns)
            self.negotiated_channels = dict(transports)
            if ended.wait(0.1):
                return
            for packets in self.plan:
                for packet in packets:
                    if ended.is_set() or self.stop.is_set():
                        return
                    self._send_packet(connection, send_lock, transports,
                        self.media.track, packet, session)
                if ended.wait(0.04 if self.media.audio else 1 / FPS):
                    return
            if self.media.mode == "live":
                ssrc = 0x20304050 if self.media.audio else 0x10203040
                cname = b"owned-codec-fixture"
                chunk = struct.pack("!I", ssrc) + bytes([1, len(cname)]) + cname + b"\0"
                chunk += b"\0" * (-len(chunk) % 4)
                bye = (struct.pack("!BBHI", 0x80, 201, 1, ssrc)
                    + struct.pack("!BBH", 0x81, 202, len(chunk) // 4) + chunk
                    + struct.pack("!BBHI", 0x81, 203, 1, ssrc))
                self._send_packet(connection, send_lock, transports,
                    self.media.track, bye, session, rtcp=True)
        except Exception as error:
            if not ended.is_set() and not self.stop.is_set():
                self.errors.append(f"codec-media: {error!r}\n{traceback.format_exc()}")
        finally:
            self.media_complete.set()
