"""Linux-only protocol/real Aravis Fake checks. Never selects a real transport."""
import argparse
import json
import pathlib
import struct
import subprocess
import sys


def unpack(data):
    packets = []
    at = 0
    while at < len(data):
        if len(data) - at < 8:
            raise AssertionError("partial header")
        metadata_size, payload_size = struct.unpack_from("<II", data, at)
        at += 8
        assert 2 <= metadata_size <= 65536 and payload_size <= 16777216
        assert metadata_size + payload_size <= len(data) - at
        metadata = json.loads(data[at:at + metadata_size].decode("utf8", errors="strict"))
        at += metadata_size
        payload = data[at:at + payload_size]
        at += payload_size
        assert metadata["kind"] == "frame" or not payload
        packets.append((metadata, payload))
    return packets


def run(worker, commands, good=True):
    result = subprocess.run([worker, "--stdio"], input=commands.encode("ascii"),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False)
    assert not result.stderr, "unexpected native diagnostics"
    packets = unpack(result.stdout)
    assert packets[0][0]["protocol"] == "capture-v1"
    assert packets[0][0]["automaticDiscovery"] is False
    assert packets[-1][0]["kind"] == "closed"
    assert packets[-1][0]["resources"] == "released"
    assert packets[-1][0]["faults"] == []
    assert (result.returncode == 0) == good
    return packets


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", required=True)
    parser.add_argument("--fake", action="store_true")
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("requires approved Linux execution; Windows is not Linux proof")
    packets = run(args.worker, "close\n")
    assert packets[-1][0]["acquisitionStop"] == "not-started"
    for bad in ["open\n", "next\n", "discover\tpermit-discovery\n", "describe\tx\t00\tx\tpermit-native-read\n",
                "close\textra\n", "close", "\x00\n", "x"*32769 + "\n"]:
        assert any(p[0]["kind"] == "fault" for p in run(args.worker, bad, good=False))
    if not args.fake:
        if "aravis-fake" not in packets[0][0]["nativeBackends"]:
            disabled = run(args.worker, "describe\taravis-fake\t7b7d\t" + "0"*64 + "\tpermit-control-probe\n", good=False)
            assert any(m.get("code") == "MissingDependency" for m, _ in disabled)
        print("Linux protocol checks passed; no device target was selected")
        return
    fixture = pathlib.Path(__file__).resolve().parents[3] / "fixtures" / "adapters" / "linux" / "aravis-fake.json"
    selector = json.dumps(json.loads(fixture.read_text(encoding="utf8")), separators=(",", ":")).encode("utf8").hex()
    packets = run(args.worker, f"identify\taravis-fake\t{selector}\tpermit-control-probe\nclose\n")
    evidence = next(p[0] for p in packets if p[0]["kind"] == "evidence")
    assert evidence["evidenceKind"] == "synthetic"
    mode = evidence["modes"][0]
    assert evidence["identity"]["scope"] == "synthetic-aravis"
    assert mode["nativeSubtype"] == "Mono8" and mode["stride"] == 512
    assert mode["cadence"] is None and mode["interlace"] == "progressive"
    assert mode["width"] == 512 and mode["height"] == 512
    denied = run(args.worker, f"describe\taravis-fake\t{selector}\t{evidence['identity']['fingerprint']}\tpermit-native-read\n",
                 good=False)
    assert any(m.get("code") == "PolicyDenied" for m, _ in denied)
    for output in ["JPEG", "I420"]:
        fields = ["open", "aravis-fake", selector, evidence["identity"]["fingerprint"], evidence["digest"],
                  mode["modeId"], output, "4096", "4096", "33554432", "16777216", "1950", "10000",
                  "permit-acquisition"]
        for index, value, code in [(3, "0"*64, "IdentityChanged"), (4, "0"*64, "IdentityChanged"),
                                    (5, "arv-" + "0"*32, "InvalidSelection"),
                                    (6, "RGB", "UnsupportedFormat"), (7, "1", "ResourceLimit"),
                                    (10, "16", "ResourceLimit"), (11, "2001", "ResourceLimit"),
                                    (13, "permit-native-read", "PolicyDenied")]:
            invalid = fields.copy()
            invalid[index] = value
            failed = run(args.worker, "\t".join(invalid) + "\nnext\nclose\n", good=False)
            assert any(m.get("code") == code for m, _ in failed)
            assert not any(m["kind"] == "frame" for m, _ in failed)
        command = "\t".join(fields)
        packets = run(args.worker, command + "\nnext\nnext\nclose\n")
        frames = [(m, p) for m, p in packets if m["kind"] == "frame"]
        assert len(frames) == 2
        assert [m["sequence"] for m, _ in frames] == ["1", "2"]
        for metadata, payload in frames:
            assert metadata["width"] == 512 and metadata["height"] == 512
            assert metadata["payloadBytes"] == len(payload) and len(payload) > 0
            assert metadata["format"] == output and metadata["modeId"] == mode["modeId"]
            assert metadata["generation"] == "1"
            assert metadata["timing"]["pipelinePtsNs"] is None and metadata["timing"]["source"] is None
            for key in ["hostReceiptMonotonicNs", "cameraTimestampNs", "sdkSystemTimestampNs", "nativeFrameId"]:
                value = metadata["timing"][key]
                assert value == str(int(value)) and 0 <= int(value) <= 2**64 - 1
            if output == "JPEG":
                assert payload[:2] == b"\xff\xd8" and payload[-2:] == b"\xff\xd9"
            else:
                assert len(payload) == 512 * 512 * 3 // 2
        assert int(frames[1][0]["timing"]["hostReceiptMonotonicNs"]) >= int(frames[0][0]["timing"]["hostReceiptMonotonicNs"])
        assert packets[-1][0]["acquisitionStop"] == "acknowledged"
    print("Actual Aravis SDK Fake buffers captured; all real transports excluded; no hardware qualified")


if __name__ == "__main__":
    main()
