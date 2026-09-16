"""Explicitly gated, loopback-only server for the TypeScript/native composition tests."""

import base64
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from urllib.parse import urlsplit

for ROOT in Path(__file__).resolve().parents:
    if (ROOT / "publication-ownership.json").is_file():
        break
else:
    raise RuntimeError("Cannot locate the specification repository.")
sys.path.insert(0, str(ROOT / "onvif" / "tools" / "tests" / "native-media"))
sys.path.insert(0, str(ROOT / "onvif" / "tools" / "fixtures" / "native-media"))

from rtsp_fixture import RtspFixture, digest_parameters, START_NTP_NS, END_NTP_NS
from runtime_fixture import RuntimeFixture


class NodeFixture(RuntimeFixture):
    def __init__(self, accounts, forbidden_control=None, **options):
        self.accounts = accounts
        self.forbidden_control = forbidden_control
        super().__init__(**options)

    def _authorize(self, headers, method, uri, nonce, nonce_counts):
        authorization = headers.get("authorization")
        if not authorization:
            return super()._authorize(headers, method, uri, nonce, nonce_counts)
        username = digest_parameters(authorization).get("username")
        if username not in self.accounts:
            raise ValueError("Unapproved independent fixture account")
        scope = SimpleNamespace(auth=self.auth, realm=self.realm, username=username, password=self.accounts[username])
        accepted, evidence = RtspFixture._authorize(scope, headers, method, uri, nonce, nonce_counts)
        return accepted, {**evidence, "account": username}

    def _sdp(self):
        value = super()._sdp()
        if self.forbidden_control:
            value = value.replace(b"a=control:track0", b"a=control:" + self.forbidden_control.encode("ascii"), 1)
        return value


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def snapshot(fixture):
    return {
        "requests": list(fixture.records),
        "outerRequests": list(fixture.outer_records),
        "errors": list(fixture.errors),
        "tlsErrors": list(fixture.tls_errors),
        "tlsConnections": list(fixture.tls_connections),
        "playRanges": [[str(start), str(end)] for start, end in fixture.play_ranges],
        "sentPackets": [
            {"session": session, "track": track, "bytes": base64.b64encode(packet).decode("ascii")}
            for session, track, packet in fixture.sent_packets
        ],
        "backchannelPackets": [base64.b64encode(packet).decode("ascii") for packet in fixture.backchannel_packets],
        "stalePackets": [base64.b64encode(packet).decode("ascii") for packet in fixture.stale_packets],
    }


def main():
    if os.environ.get("ONVIF_MEDIA_NATIVE_TEST") != "1":
        raise ValueError("ExplicitNativeLoopbackFlagRequired")
    line = sys.stdin.readline(65537)
    if len(line) > 65536 or not line.endswith("\n"):
        raise ValueError("BoundedPrivateFixtureConfigurationRequired")
    options = json.loads(line)
    allowed = {
        "allowLoopbackTest", "node", "transport", "mode", "accounts", "realm", "outerAuth",
        "wrongHost", "gzip", "documents", "metadataLoss", "stallMedia", "cycles",
        "setupDelay", "teardownStatus", "teardownDelay", "expectedRanges", "backchannel",
        "forbiddenControl", "redirect",
        "controlDelay", "wrongTransportSource", "metadataReorder", "gzipCorrupt", "staleReplay",
    }
    if not isinstance(options, dict) or set(options) - allowed:
        raise ValueError("UnknownFixtureConfiguration")
    if options.get("allowLoopbackTest") is not True:
        raise ValueError("ExplicitNativeLoopbackConfigurationRequired")
    accounts = options.get("accounts")
    if not isinstance(accounts, dict) or not 1 <= len(accounts) <= 4:
        raise ValueError("ExplicitSyntheticAccountsRequired")
    if any(not isinstance(name, str) or not isinstance(secret, str) or not name or not secret
           or len(name) > 1024 or len(secret) > 1024 for name, secret in accounts.items()):
        raise ValueError("InvalidSyntheticAccounts")
    for name in ("forbiddenControl", "redirect"):
        target = options.get(name)
        if target and (urlsplit(target).hostname != "127.0.0.1" or not urlsplit(target).port):
            raise ValueError("LoopbackOnlyNativeTestTarget")
    documents = options.get("documents")
    if documents is not None:
        if not isinstance(documents, list) or not 1 <= len(documents) <= 8:
            raise ValueError("BoundedTestDocumentsRequired")
        documents = [base64.b64decode(value, validate=True) for value in documents]
        if any(len(value) > 65536 for value in documents):
            raise ValueError("FixtureMetadataDocumentLimit")
    username, password = next(iter(accounts.items()))
    expected_ranges = options.get("expectedRanges")
    fixture = NodeFixture(
        accounts=accounts, forbidden_control=options.get("forbiddenControl"),
        auth="sha256", username=username, password=password, realm=options.get("realm", "node-native-test"),
        transport=options.get("transport", "tcp"), mode=options.get("mode", "live"), node=options["node"],
        outer_auth=options.get("outerAuth", "none"), wrong_host=options.get("wrongHost", False),
        gzip_metadata=options.get("gzip", False), documents=documents,
        metadata_loss=options.get("metadataLoss", False), stall_media=options.get("stallMedia", False),
        cycles=options.get("cycles", 4), setup_delay=options.get("setupDelay", 0),
        teardown_status=options.get("teardownStatus", 200), teardown_delay=options.get("teardownDelay", 0),
        expected_ranges=None if expected_ranges is None else [tuple(map(int, pair)) for pair in expected_ranges],
        backchannel=options.get("backchannel", False), redirect=options.get("redirect"),
        sender_reports=options.get("mode", "live") == "live",
        control_delay=options.get("controlDelay", 0),
        wrong_transport_source=options.get("wrongTransportSource", False),
        metadata_reorder=options.get("metadataReorder", False),
        gzip_corrupt=options.get("gzipCorrupt", False),
        stale_replay=options.get("staleReplay", False),
    )
    stop_id = 0
    with fixture:
        emit({"event": "ready", "uri": fixture.uri, "port": fixture.port, "caPem": fixture.ca_pem,
              "range": {"startNtpNs": str(START_NTP_NS), "endNtpNs": str(END_NTP_NS)}})
        while True:
            line = sys.stdin.readline(65537)
            if not line:
                break
            if len(line) > 65536 or not line.endswith("\n"):
                raise ValueError("FixtureCommandLimit")
            command = json.loads(line)
            if command.get("command") == "snapshot":
                emit({"event": "snapshot", "id": command["id"], "report": snapshot(fixture)})
            elif command.get("command") == "stop":
                stop_id = command["id"]
                break
            else:
                raise ValueError("UnknownFixtureCommand")
    report = snapshot(fixture)
    live = [thread.name for thread in fixture.threads if thread.is_alive()]
    if live:
        report["errors"].append("FixtureThreadsDidNotStop")
    emit({"event": "closed", "id": stop_id, "report": report})
    return 0 if not live else 2


if __name__ == "__main__":
    try:
        result = main()
    except (KeyError, OSError, ValueError, TypeError) as error:
        emit({"event": "error", "code": type(error).__name__})
        result = 2
    raise SystemExit(result)
