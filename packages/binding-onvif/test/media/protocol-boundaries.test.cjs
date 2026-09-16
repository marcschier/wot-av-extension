"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    IpcFrameDecoder, IpcKind, encodeEnvelope, decodeControl, ipcString,
    MEDIA_PROTOCOL_VERSION, MEDIA_HEADER_BYTES, MEDIA_CONTROL_MAX, MEDIA_DATA_MAX
} = require("./.compiled-unit/media/ipc.js");
const { OnvifError } = require("./.compiled-unit/binding/errors.js");

function hex(text) {
    return Buffer.from(text.replaceAll(" ", ""), "hex");
}

// Headers and bodies are literal wire fixtures; expected records are separate oracles.
const fixtures = {
    F1: {
        channel: "control",
        header: hex("4f4d5047 0002 8001 00000000 00000000 00000000 00000001"),
        body: hex("00"),
        expected: { kind: 0x8001, session: 0, generation: 0, sequence: 0, payload: Buffer.from([0x00]) }
    },
    F2: {
        channel: "control",
        header: hex("4f4d5047 0002 8002 00000001 00000002 00000003 00000002"),
        body: hex("1011"),
        expected: { kind: 0x8002, session: 1, generation: 2, sequence: 3, payload: Buffer.from([0x10, 0x11]) }
    },
    F3: {
        channel: "control",
        header: hex("4f4d5047 0002 8003 80000000 ffffffff 01020304 00000003"),
        body: hex("202122"),
        expected: {
            kind: 0x8003, session: 2147483648, generation: 4294967295, sequence: 16909060,
            payload: Buffer.from([0x20, 0x21, 0x22])
        }
    },
    F4: {
        channel: "control",
        header: hex("4f4d5047 0002 8004 01020304 ffffffff 00000000 00000002"),
        body: hex("7b7d"),
        expected: {
            kind: 0x8004, session: 16909060, generation: 4294967295, sequence: 0,
            payload: Buffer.from([0x7b, 0x7d])
        }
    },
    F5: {
        channel: "control",
        header: hex("4f4d5047 0002 8005 ffffffff 00000000 80000000 00000004"),
        body: hex("30313233"),
        expected: {
            kind: 0x8005, session: 4294967295, generation: 0, sequence: 2147483648,
            payload: Buffer.from([0x30, 0x31, 0x32, 0x33])
        }
    },
    F6: {
        channel: "control",
        header: hex("4f4d5047 0002 8006 00000009 00000008 00000007 00000001"),
        body: hex("ff"),
        expected: { kind: 0x8006, session: 9, generation: 8, sequence: 7, payload: Buffer.from([0xff]) }
    },
    F7: {
        channel: "control",
        header: hex("4f4d5047 0002 8007 0000000a 0000000b 0000000c 00000001"),
        body: hex("70"),
        expected: { kind: 0x8007, session: 10, generation: 11, sequence: 12, payload: Buffer.from([0x70]) }
    },
    F8: {
        channel: "control",
        header: hex("4f4d5047 0002 8008 0000000d 0000000e 0000000f 00000002"),
        body: hex("8081"),
        expected: { kind: 0x8008, session: 13, generation: 14, sequence: 15, payload: Buffer.from([0x80, 0x81]) }
    },
    F9: {
        channel: "control",
        header: hex("4f4d5047 0002 8009 00000010 00000011 00000012 00000001"),
        body: hex("90"),
        expected: { kind: 0x8009, session: 16, generation: 17, sequence: 18, payload: Buffer.from([0x90]) }
    },
    F10: {
        channel: "data",
        header: hex("4f4d5047 0002 9001 00000000 80000000 ffffffff 00000001"),
        body: hex("a1"),
        expected: {
            kind: 0x9001, session: 0, generation: 2147483648, sequence: 4294967295,
            payload: Buffer.from([0xa1])
        }
    },
    F11: {
        channel: "data",
        header: hex("4f4d5047 0002 9002 00000001 00000002 00000003 00000002"),
        body: hex("b1b2"),
        expected: { kind: 0x9002, session: 1, generation: 2, sequence: 3, payload: Buffer.from([0xb1, 0xb2]) }
    },
    F12: {
        channel: "data",
        header: hex("4f4d5047 0002 9003 ffffffff 00000000 80000000 00000003"),
        body: hex("c1c2c3"),
        expected: {
            kind: 0x9003, session: 4294967295, generation: 0, sequence: 2147483648,
            payload: Buffer.from([0xc1, 0xc2, 0xc3])
        }
    },
    F13: {
        channel: "data",
        header: hex("4f4d5047 0002 9004 80000000 ffffffff 00000000 00000001"),
        body: hex("d1"),
        expected: {
            kind: 0x9004, session: 2147483648, generation: 4294967295, sequence: 0,
            payload: Buffer.from([0xd1])
        }
    }
};

function wire(fixture) {
    assert.equal(fixture.header.length, 24);
    return Buffer.concat([fixture.header, fixture.body]);
}

function onvifError(code, message, execution = "not-sent") {
    return (error) => {
        assert.equal(error instanceof OnvifError, true);
        assert.equal(error.name, "OnvifError");
        assert.equal(error.code, code);
        assert.equal(error.message, message);
        assert.equal(error.execution, execution);
        return true;
    };
}

function withClock(run) {
    const original = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        run((value) => { now = value; });
    } finally {
        Date.now = original;
    }
}

function rejectHeader(channel, bytes, code, message) {
    const decoder = new IpcFrameDecoder(channel);
    const observed = [];
    assert.throws(() => decoder.push(bytes, (frame) => observed.push(frame)), onvifError(code, message));
    assert.deepEqual(observed, []);
    assert.equal(decoder.bufferedBytes, 24);
}

function rejectLengthWithoutAllocation(channel, maximum, headerText) {
    const header = hex(headerText);
    const decoder = new IpcFrameDecoder(channel, maximum);
    const observed = [], allocations = [];
    const accept = (frame) => observed.push(frame);
    const allocationSentinel = new Error("Unexpected allocation during invalid header rejection");
    const original = Buffer.alloc;
    let caught;
    assert.equal(header.length, 24);
    try {
        Buffer.alloc = (...args) => {
            allocations.push(args);
            throw allocationSentinel;
        };
        try {
            decoder.push(header, accept);
        } catch (error) {
            caught = error;
        }
    } finally {
        Buffer.alloc = original;
    }
    assert.deepEqual(allocations, [], "Even a small attempted allocation is forbidden for an invalid length");
    onvifError("InvalidValue", "Invalid native IPC payload length")(caught);
    assert.deepEqual(observed, []);
    assert.equal(decoder.bufferedBytes, 24);
}

function controlFrame(payload) {
    return { kind: 0x8004, session: 1, generation: 2, sequence: 3, payload };
}

test("media IPC: every split and bytewise feed preserve one literal v2 frame", { concurrency: false }, () => {
    const bytes = wire(fixtures.F4);
    assert.equal(bytes.length, 26);
    withClock(() => {
        for (let split = 0; split <= 26; split++) {
            const decoder = new IpcFrameDecoder("control");
            const observed = [];
            const accept = (frame) => observed.push(frame);
            decoder.push(bytes.subarray(0, split), accept);
            const partial = split > 0 && split < 26;
            assert.deepEqual(observed, split === 26 ? [fixtures.F4.expected] : [], `prefix ${split}`);
            assert.equal(decoder.bufferedBytes, partial ? split : 0, `prefix ${split}`);
            assert.equal(decoder.incompleteSince, partial ? 1000 : undefined, `prefix ${split}`);
            decoder.push(bytes.subarray(split), accept);
            assert.deepEqual(observed, [fixtures.F4.expected], `completed split ${split}`);
            assert.equal(decoder.bufferedBytes, 0);
            assert.equal(decoder.incompleteSince, undefined);
            assert.doesNotThrow(() => decoder.end());
        }

        const decoder = new IpcFrameDecoder("control");
        const observed = [];
        for (let offset = 0; offset < 26; offset++) {
            decoder.push(bytes.subarray(offset, offset + 1), (frame) => observed.push(frame));
            assert.deepEqual(observed, offset === 25 ? [fixtures.F4.expected] : [], `byte ${offset + 1}`);
            assert.equal(decoder.bufferedBytes, offset === 25 ? 0 : offset + 1);
            assert.equal(decoder.incompleteSince, offset === 25 ? undefined : 1000);
        }
        assert.doesNotThrow(() => decoder.end());
    });
});

test("media IPC: six independent coalesced frames preserve complete order", () => {
    const selected = [fixtures.F1, fixtures.F2, fixtures.F3, fixtures.F4, fixtures.F5, fixtures.F6];
    const bytes = Buffer.concat(selected.map(wire));
    const decoder = new IpcFrameDecoder("control");
    const observed = [];
    assert.equal(bytes.length, 157);
    decoder.push(bytes, (frame) => observed.push(frame));
    assert.deepEqual(observed, selected.map((fixture) => fixture.expected));
    assert.equal(decoder.bufferedBytes, 0);
    assert.doesNotThrow(() => decoder.end());
});

test("media IPC: invalid magic wins before later header checks", () => {
    for (const offset of [0, 1, 2, 3]) {
        const header = Buffer.from(fixtures.F4.header);
        header[offset] = 0;
        rejectHeader("control", header, "InvalidValue", "Invalid native IPC magic");
    }
    rejectHeader("control", hex("00000000 0001 0000 01020304 ffffffff 00000000 00000000"),
        "InvalidValue", "Invalid native IPC magic");
});

test("media IPC: legacy and other non-v2 versions have no fallback", () => {
    for (const version of [[0x00, 0x00], [0x00, 0x01], [0x00, 0x03], [0xff, 0xff]]) {
        const header = Buffer.from(fixtures.F4.header);
        header.set(version, 4);
        rejectHeader("control", header, "UnsupportedCapability",
            "Native media requires IPC version 2; no legacy fallback");
    }
    rejectHeader("control", hex("4f4d5047 0001 0000 01020304 ffffffff 00000000 00000000"),
        "UnsupportedCapability", "Native media requires IPC version 2; no legacy fallback");
});

test("media IPC: unknown and outbound kinds are rejected on incoming channels", () => {
    for (const kind of [
        [0x00, 0x00], [0x00, 0x01], [0x00, 0x10], [0x10, 0x01],
        [0x80, 0x00], [0x80, 0x0a], [0xff, 0xff]
    ]) {
        const header = Buffer.from(fixtures.F4.header);
        header.set(kind, 6);
        rejectHeader("control", header, "UnsupportedCapability", "Unexpected native IPC message kind or channel");
    }
    for (const kind of [[0x90, 0x00], [0x90, 0x05]]) {
        const header = Buffer.from(fixtures.F10.header);
        header.set(kind, 6);
        rejectHeader("data", header, "UnsupportedCapability", "Unexpected native IPC message kind or channel");
    }
    rejectHeader("control", hex("4f4d5047 0002 800a 01020304 ffffffff 00000000 00000000"),
        "UnsupportedCapability", "Unexpected native IPC message kind or channel");
});

test("media IPC: valid incoming kinds reject the wrong channel", () => {
    rejectHeader("control", wire(fixtures.F10), "UnsupportedCapability",
        "Unexpected native IPC message kind or channel");
    rejectHeader("data", wire(fixtures.F1), "UnsupportedCapability",
        "Unexpected native IPC message kind or channel");
});

test("media IPC: zero payload lengths reject before any allocation", { concurrency: false }, () => {
    for (const [channel, header] of [
        ["control", "4f4d5047 0002 8001 00000000 00000000 00000000 00000000"],
        ["data", "4f4d5047 0002 9001 00000000 00000000 00000000 00000000"]
    ]) {
        rejectLengthWithoutAllocation(channel, undefined, header);
    }
});

test("media IPC: excessive payload lengths reject before any allocation", { concurrency: false }, () => {
    for (const [channel, maximum, header] of [
        ["control", undefined, "4f4d5047 0002 8001 00000000 00000000 00000000 00010001"],
        ["data", undefined, "4f4d5047 0002 9001 00000000 00000000 00000000 04000041"],
        ["control", 2, "4f4d5047 0002 8001 00000000 00000000 00000000 00000003"],
        ["data", 3, "4f4d5047 0002 9001 00000000 00000000 00000000 00000004"],
        ["control", undefined, "4f4d5047 0002 8001 00000000 00000000 00000000 ffffffff"],
        ["control", 2, "4f4d5047 0002 8001 00000000 00000000 00000000 ffffffff"],
        ["data", undefined, "4f4d5047 0002 9001 00000000 00000000 00000000 ffffffff"],
        ["data", 3, "4f4d5047 0002 9001 00000000 00000000 00000000 ffffffff"]
    ]) {
        rejectLengthWithoutAllocation(channel, maximum, header);
    }
});

test("media IPC: every proper header prefix fails truncated EOF", () => {
    for (let length = 1; length <= 23; length++) {
        const decoder = new IpcFrameDecoder("control");
        const observed = [];
        decoder.push(fixtures.F4.header.subarray(0, length), (frame) => observed.push(frame));
        assert.equal(decoder.bufferedBytes, length);
        assert.deepEqual(observed, []);
        for (let attempt = 0; attempt < 2; attempt++) {
            assert.throws(() => decoder.end(), onvifError("TransportError", "Truncated native IPC frame", "unknown"));
            assert.equal(decoder.bufferedBytes, length);
            assert.deepEqual(observed, []);
        }
    }
});

test("media IPC: zero and partial body bytes fail truncated EOF", () => {
    for (const [bodyBytes, receivedBytes] of [[0, 24], [1, 25], [2, 26], [3, 27]]) {
        const decoder = new IpcFrameDecoder("control");
        const observed = [];
        decoder.push(Buffer.concat([fixtures.F5.header, fixtures.F5.body.subarray(0, bodyBytes)]),
            (frame) => observed.push(frame));
        assert.equal(decoder.bufferedBytes, receivedBytes);
        assert.deepEqual(observed, []);
        assert.throws(() => decoder.end(), onvifError("TransportError", "Truncated native IPC frame", "unknown"));
        assert.equal(decoder.bufferedBytes, receivedBytes);
        assert.deepEqual(observed, []);
    }
});

test("media IPC: all EOF outcomes reject later empty and nonempty pushes", () => {
    const bytes = wire(fixtures.F4);
    for (const [input, buffered, expected] of [
        [Buffer.alloc(0), 0, []],
        [bytes, 0, [fixtures.F4.expected]],
        [bytes.subarray(0, 7), 7, []],
        [bytes.subarray(0, 25), 25, []]
    ]) {
        const decoder = new IpcFrameDecoder("control");
        const observed = [];
        const accept = (frame) => observed.push(frame);
        const checkEnd = () => {
            if (buffered === 0) assert.doesNotThrow(() => decoder.end());
            else assert.throws(() => decoder.end(), onvifError("TransportError", "Truncated native IPC frame", "unknown"));
            assert.equal(decoder.bufferedBytes, buffered);
            assert.deepEqual(observed, expected);
        };
        decoder.push(input, accept);
        checkEnd();
        for (const late of [Buffer.alloc(0), bytes]) {
            assert.throws(() => decoder.push(late, accept), onvifError("InvalidValue", "Native IPC data after EOF"));
            assert.deepEqual(observed, expected);
            assert.equal(decoder.bufferedBytes, buffered);
        }
        checkEnd();
    }
});

test("media IPC: real invalid UTF-8 control bytes reject before JSON acceptance", () => {
    for (const payloadHex of [
        "7b2278223a22c328227d", "7b2278223a22c0af227d",
        "7b2278223a2280227d", "7b2278223a22f09f98"
    ]) {
        const frame = controlFrame(hex(payloadHex));
        assert.throws(() => decodeControl(frame), onvifError("InvalidValue", "Native control is not finite UTF-8 JSON"));
        assert.deepEqual(frame.payload, hex(payloadHex));
    }
});

test("media IPC: valid non-object JSON rejects every top-level partition", () => {
    for (const text of ["null", "[]", "[1]", '""', '"text"', "true", "false", "0", "-1", "1.5"]) {
        const frame = controlFrame(Buffer.from(text, "utf8"));
        assert.throws(() => decodeControl(frame), onvifError("InvalidValue", "Native control must be a JSON object"));
        assert.deepEqual(frame.payload, Buffer.from(text, "utf8"));
    }
});

test("media IPC: malformed and BOM-prefixed JSON reject distinctly from object shape", () => {
    const payloads = ["", " \n\t", "{", '{"x":}', '{"x":1,}', "{}x"].map((text) => Buffer.from(text, "utf8"));
    payloads.push(hex("efbbbf7b7d"));
    for (const payload of payloads) {
        const original = Buffer.from(payload);
        assert.throws(() => decodeControl(controlFrame(payload)),
            onvifError("InvalidValue", "Native control is not finite UTF-8 JSON"));
        assert.deepEqual(payload, original);
    }
});

test("media IPC: unsigned wire boundaries and arbitrary outbound kinds preserve exact bytes", () => {
    for (const [args, expected, length] of [
        [[0, 0, 0, 0], "4f4d5047 0002 0000 00000000 00000000 00000000 00000000", 24],
        [[65535, 4294967295, 4294967295, 4294967295, Uint8Array.of(0xa5)],
            "4f4d5047 0002 ffff ffffffff ffffffff ffffffff 00000001 a5", 25],
        [[0x1234, 16909060, 2147483648, 4294967295, Uint8Array.of(0xaa, 0xbb)],
            "4f4d5047 0002 1234 01020304 80000000 ffffffff 00000002 aabb", 26]
    ]) {
        const encoded = encodeEnvelope(...args);
        assert.deepEqual(encoded, hex(expected));
        assert.equal(encoded.length, length);
    }
    for (const fixture of [fixtures.F1, fixtures.F3, fixtures.F5, fixtures.F10]) {
        const decoder = new IpcFrameDecoder(fixture.channel);
        const observed = [];
        decoder.push(wire(fixture), (frame) => observed.push(frame));
        assert.deepEqual(observed, [fixture.expected]);
        assert.equal(decoder.bufferedBytes, 0);
        assert.doesNotThrow(() => decoder.end());
    }
});

test("media IPC: illegal integers reject and the payload bound is inclusive", () => {
    const payload = Uint8Array.of(0xa5);
    for (let argument = 0; argument < 4; argument++) {
        const invalid = [-1, 1.5, NaN, Infinity, -Infinity, 9007199254740992,
            argument === 0 ? 65536 : 4294967296];
        for (const value of invalid) {
            const args = [0x1234, 0x01020304, 5, 6];
            args[argument] = value;
            assert.throws(() => encodeEnvelope(...args, payload), onvifError("InvalidValue", "Invalid native IPC integer"),
                `argument ${argument}, value ${String(value)}`);
            assert.deepEqual(payload, Uint8Array.of(0xa5));
        }
    }

    // One real input and one output; scan the zero interior without a duplicate large oracle.
    const large = new Uint8Array(67108929);
    large[0] = 0x11;
    large[67108927] = 0x22;
    large[67108928] = 0x33;
    const encoded = encodeEnvelope(0x1234, 1, 2, 3, large.subarray(0, 67108928));
    assert.equal(encoded.length, 67108952);
    assert.deepEqual(encoded.subarray(0, 24), hex("4f4d5047 0002 1234 00000001 00000002 00000003 04000040"));
    assert.equal(encoded[24], 0x11);
    assert.equal(encoded[67108951], 0x22);
    assert.equal(encoded.subarray(25, 67108951).every((byte) => byte === 0), true);
    assert.throws(() => encodeEnvelope(0x1234, 1, 2, 3, large),
        onvifError("InvalidValue", "Native IPC payload exceeds its bound"));
    assert.equal(large[67108928], 0x33);
});

test("media IPC: counted UTF-8 strings match complete independent byte vectors", () => {
    for (const [value, maximum, expected, length] of [
        ["", 0, "0000", 2],
        ["A", 1, "000141", 3],
        ["ONVIF", 5, "00054f4e564946", 7],
        ["Aé😀", 7, "000741c3a9f09f9880", 9]
    ]) {
        const encoded = ipcString(value, maximum, "track");
        assert.deepEqual(encoded, hex(expected));
        assert.equal(encoded.length, length);
    }
});

test("media IPC: counted strings reject NUL and non-string values early", () => {
    for (const value of ["\0", "\0ab", "a\0b", "ab\0", undefined, null, 42, true, {}, [], Buffer.from([0x61])]) {
        assert.throws(() => ipcString(value, 16, "track"), onvifError("InvalidConfiguration", "Invalid track"));
    }
    assert.throws(() => ipcString("a\0b", 1, "track"), onvifError("InvalidConfiguration", "Invalid track"));
});

test("media IPC: unpaired surrogates reject while valid pairs retain their bytes", () => {
    for (const value of ["\ud800", "\udc00", "a\ud800b", "a\udc00b"]) {
        assert.throws(() => ipcString(value, 16, "track"),
            onvifError("InvalidConfiguration", "Invalid UTF-8 or excessive track"));
    }
    assert.deepEqual(ipcString("😀", 4, "track"), hex("0004f09f9880"));
    assert.deepEqual(ipcString("A😀B", 6, "track"), hex("000641f09f988042"));
});

test("media IPC: counted-string limits distinguish bytes and the uint16 cap", () => {
    assert.deepEqual(ipcString("Aé😀", 7, "track"), hex("000741c3a9f09f9880"));
    assert.throws(() => ipcString("Aé😀", 6, "track"),
        onvifError("InvalidConfiguration", "Invalid UTF-8 or excessive track"));
    assert.deepEqual(ipcString("", 0, "track"), hex("0000"));
    assert.throws(() => ipcString("A", 0, "track"),
        onvifError("InvalidConfiguration", "Invalid UTF-8 or excessive track"));
    const exact = "x".repeat(65535), excessive = "x".repeat(65536);
    for (const maximum of [65535, 100000]) {
        const encoded = ipcString(exact, maximum, "track");
        assert.equal(encoded.length, 65537);
        assert.deepEqual(encoded.subarray(0, 2), Buffer.from([0xff, 0xff]));
        assert.equal(encoded.subarray(2).every((byte) => byte === 0x78), true);
        assert.throws(() => ipcString(excessive, maximum, "track"),
            onvifError("InvalidConfiguration", "Invalid UTF-8 or excessive track"));
    }
});

test("media IPC: exports fixed v2 limits and the frozen kind map", () => {
    assert.equal(MEDIA_PROTOCOL_VERSION, 2);
    assert.equal(MEDIA_HEADER_BYTES, 24);
    assert.equal(MEDIA_CONTROL_MAX, 65536);
    assert.equal(MEDIA_DATA_MAX, 67108928);
    assert.deepEqual(IpcKind, {
        OPEN: 1, CLOSE: 2, PAUSE: 3, PLAY: 4, SEEK: 5, CREDIT: 6,
        SECURITY: 16, BACKCHANNEL: 4097,
        HELLO: 0x8001, READY: 0x8002, CLOSED: 0x8003, ERROR: 0x8004,
        RESPONSE: 0x8005, GAP: 0x8006, DIAGNOSTIC: 0x8007, CONTROL: 0x8008, END: 0x8009,
        RTP: 0x9001, DECODED: 0x9002, METADATA: 0x9003, RTCP: 0x9004
    });
    assert.equal(Object.isFrozen(IpcKind), true);
});

test("media IPC: decoder configuration accepts exact bounds and rejects invalid limits", () => {
    for (const [channel, cap] of [["control", 65536], ["data", 67108928]]) {
        const defaults = [new IpcFrameDecoder(channel), new IpcFrameDecoder(channel, undefined),
            new IpcFrameDecoder(channel, null)];
        for (const decoder of defaults) {
            assert.equal(decoder.channel, channel);
            assert.equal(decoder.maximum, cap);
            assert.equal(decoder.bufferedBytes, 0);
            assert.doesNotThrow(() => decoder.end());
        }
        for (const maximum of [1, cap]) {
            const decoder = new IpcFrameDecoder(channel, maximum);
            assert.equal(decoder.channel, channel);
            assert.equal(decoder.maximum, maximum);
            assert.equal(decoder.bufferedBytes, 0);
            assert.doesNotThrow(() => decoder.end());
        }
        for (const maximum of [0, -1, 1.5, NaN, Infinity, -Infinity, 9007199254740992, cap + 1]) {
            assert.throws(() => new IpcFrameDecoder(channel, maximum),
                onvifError("InvalidConfiguration", "IPC payload limit must be a positive integer within its supported bound"));
        }
    }
    for (const [fixture, maximum] of [[fixtures.F1, 1], [fixtures.F10, 1], [fixtures.F4, 2], [fixtures.F12, 3]]) {
        const decoder = new IpcFrameDecoder(fixture.channel, maximum);
        const observed = [];
        decoder.push(wire(fixture), (frame) => observed.push(frame));
        assert.deepEqual(observed, [fixture.expected]);
        assert.equal(decoder.bufferedBytes, 0);
        assert.doesNotThrow(() => decoder.end());
    }
});

test("media IPC: all thirteen incoming kinds accept Buffer and Uint8Array literals", () => {
    for (const [id, fixture] of Object.entries(fixtures)) {
        for (const asBuffer of [true, false]) {
            const bytes = asBuffer ? wire(fixture) : new Uint8Array(wire(fixture));
            assert.equal(Buffer.isBuffer(bytes), asBuffer);
            const decoder = new IpcFrameDecoder(fixture.channel);
            const observed = [];
            decoder.push(bytes, (frame) => observed.push(frame));
            assert.deepEqual(observed, [fixture.expected], `${id}, Buffer=${asBuffer}`);
            assert.equal(decoder.bufferedBytes, 0);
            assert.doesNotThrow(() => decoder.end());
        }
    }
});

test("media IPC: empty and complete-plus-partial input preserve deterministic parser state", { concurrency: false }, () => {
    withClock((setNow) => {
        const decoder = new IpcFrameDecoder("control");
        const observed = [];
        const accept = (frame) => observed.push(frame);
        const first = wire(fixtures.F4), second = wire(fixtures.F2);
        assert.equal(decoder.bufferedBytes, 0);
        assert.equal(decoder.incompleteSince, undefined);
        decoder.push(Buffer.alloc(0), accept);
        assert.equal(decoder.bufferedBytes, 0);
        assert.equal(decoder.incompleteSince, undefined);
        assert.deepEqual(observed, []);
        decoder.push(first.subarray(0, 5), accept);
        assert.equal(decoder.bufferedBytes, 5);
        assert.equal(decoder.incompleteSince, 1000);
        assert.deepEqual(observed, []);
        setNow(2000);
        decoder.push(first.subarray(5, 12), accept);
        assert.equal(decoder.bufferedBytes, 12);
        assert.equal(decoder.incompleteSince, 1000);
        decoder.push(Buffer.alloc(0), accept);
        assert.equal(decoder.bufferedBytes, 12);
        assert.equal(decoder.incompleteSince, 1000);
        assert.deepEqual(observed, []);
        setNow(3000);
        decoder.push(Buffer.concat([first.subarray(12), second.subarray(0, 9)]), accept);
        assert.deepEqual(observed, [fixtures.F4.expected]);
        assert.equal(decoder.bufferedBytes, 9);
        assert.equal(decoder.incompleteSince, 3000);
        setNow(4000);
        decoder.push(second.subarray(9), accept);
        assert.deepEqual(observed, [fixtures.F4.expected, fixtures.F2.expected]);
        assert.equal(decoder.bufferedBytes, 0);
        assert.equal(decoder.incompleteSince, undefined);
        decoder.push(Buffer.alloc(0), accept);
        assert.deepEqual(observed, [fixtures.F4.expected, fixtures.F2.expected]);
        assert.equal(decoder.bufferedBytes, 0);
        assert.equal(decoder.incompleteSince, undefined);
        assert.doesNotThrow(() => decoder.end());
        assert.doesNotThrow(() => decoder.end());

        const empty = new IpcFrameDecoder("control");
        assert.doesNotThrow(() => empty.end());
        assert.doesNotThrow(() => empty.end());
        assert.equal(empty.bufferedBytes, 0);
        assert.equal(empty.incompleteSince, undefined);
    });
});

test("media IPC: decoder owns copied bytes and resets before accept throws", { concurrency: false }, () => {
    const mutable = new Uint8Array(wire(fixtures.F4));
    const decoder = new IpcFrameDecoder("control");
    const observed = [];
    const accept = (frame) => observed.push(frame);
    decoder.push(mutable.subarray(0, 8), accept);
    mutable.fill(0, 0, 8);
    decoder.push(mutable.subarray(8, 25), accept);
    mutable[24] = 0;
    assert.equal(decoder.bufferedBytes, 25);
    assert.deepEqual(observed, []);
    decoder.push(mutable.subarray(25), accept);
    assert.deepEqual(observed, [fixtures.F4.expected]);
    assert.equal(decoder.bufferedBytes, 0);
    mutable.fill(0);
    decoder.push(wire(fixtures.F1), accept);
    assert.deepEqual(observed, [fixtures.F4.expected, fixtures.F1.expected]);
    assert.equal(decoder.bufferedBytes, 0);
    assert.doesNotThrow(() => decoder.end());

    withClock(() => {
        const throwingDecoder = new IpcFrameDecoder("control");
        const sentinel = new Error("accept-stop");
        const accepted = [];
        assert.throws(() => throwingDecoder.push(wire(fixtures.F4), (frame) => {
            accepted.push(frame);
            assert.deepEqual(frame, fixtures.F4.expected);
            assert.equal(throwingDecoder.bufferedBytes, 0);
            assert.equal(throwingDecoder.incompleteSince, undefined);
            throw sentinel;
        }), (error) => {
            assert.equal(error, sentinel);
            return true;
        });
        assert.deepEqual(accepted, [fixtures.F4.expected]);
        assert.equal(throwingDecoder.bufferedBytes, 0);
        assert.equal(throwingDecoder.incompleteSince, undefined);
        throwingDecoder.push(wire(fixtures.F1), (frame) => accepted.push(frame));
        assert.deepEqual(accepted, [fixtures.F4.expected, fixtures.F1.expected]);
        assert.equal(throwingDecoder.bufferedBytes, 0);
        assert.equal(throwingDecoder.incompleteSince, undefined);
        assert.doesNotThrow(() => throwingDecoder.end());
    });
});

test("media IPC: encoder empty and copied payloads match independent literal bytes", () => {
    const expectedEmpty = hex("4f4d5047 0002 1234 01020304 80000000 ffffffff 00000000");
    assert.deepEqual(encodeEnvelope(0x1234, 16909060, 2147483648, 4294967295), expectedEmpty);
    assert.deepEqual(encodeEnvelope(0x1234, 16909060, 2147483648, 4294967295, new Uint8Array(0)), expectedEmpty);
    const backing = Uint8Array.of(0xff, 0xaa, 0xbb, 0xee);
    const encoded = encodeEnvelope(0x1234, 16909060, 2147483648, 4294967295, backing.subarray(1, 3));
    const expected = hex("4f4d5047 0002 1234 01020304 80000000 ffffffff 00000002 aabb");
    assert.deepEqual(encoded, expected);
    assert.equal(encoded.length, 26);
    backing.fill(0);
    assert.deepEqual(encoded, expected);
});

test("media IPC: control objects retain nested values regardless of frame metadata", () => {
    const empty = { kind: 0, session: 4294967295, generation: 0, sequence: 2147483648, payload: hex("7b7d") };
    assert.deepEqual(decodeControl(empty), {});
    assert.deepEqual(empty.payload, Buffer.from([0x7b, 0x7d]));
    const text = '{"nested":{"a":[1,null,true,false,{"text":"é😀"}],"empty":{}},"empty":[],"zero":0,"negative":-2,"fraction":1.5}';
    const nested = { kind: 0x9001, session: 1, generation: 2, sequence: 3, payload: Buffer.from(text, "utf8") };
    assert.deepEqual(decodeControl(nested), {
        nested: { a: [1, null, true, false, { text: "é😀" }], empty: {} },
        empty: [], zero: 0, negative: -2, fraction: 1.5
    });
    assert.deepEqual(nested.payload, Buffer.from(text, "utf8"));
});
