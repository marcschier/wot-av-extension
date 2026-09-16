"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const { resolve }=require("node:path");
const { createOnvifRuntime }=require("./.compiled/binding/runtime.js");
const { MediaExecutor,openMedia }=require("./.compiled/media/index.js");
const { generated,generatedThing,soapFixture }=require("../../../fixtures/reference-runtime/media/generated.cjs");
const { MemoryWorker }=require("../../../fixtures/reference-runtime/media/memory-worker.cjs");

test("media resolver: generated Media1 action invokes actual node-wot without mutating its TD",{ timeout: 20000 },async (t) => {
    const uri="rtsp://127.0.0.1:1/opaque-unit-only?value=a%2Fb";
    const wire=await soapFixture(uri);
    t.after(() => wire.close());
    const fixture=generatedThing(wire.target);
    const original=JSON.stringify(fixture.description);
    const runtime=await createOnvifRuntime({ registry: fixture.registry,trust: { allowedOrigins: [wire.origin] } });
    t.after(() => runtime.close());
    const spawns=[];
    const executor=new MediaExecutor({
        registry: fixture.registry,worker: { executable: process.execPath },
        security: async (scope) => ({
            thingId: scope.thingId,principal: scope.principal,
            targetRef: scope.targetRef,origin: scope.origin
        }),
        processFactory: (workerOptions) => { spawns.push(workerOptions); return new MemoryWorker(); }
    });
    t.after(() => executor.close());
    const thing=await executor.consume(runtime,fixture.description,{
        principal: "explicit-consumer",targetRef: "owned-synthetic-camera",
        trust: {
            serviceTargets: [wire.target],allowedOrigins: ["rtsp://127.0.0.1:1"],
            transports: ["tcp-interleaved"],authentication: { kind: "none" }
        }
    });
    const session=await openMedia(runtime,thing,{
        action: fixture.action,input: fixture.input,transport: "tcp-interleaved",
        tracks: { video: ["JPEG"],audio: ["PCMU"],metadata: true },localAddress: "127.0.0.1"
    });
    assert.equal(wire.records.length,1);
    assert.equal(wire.records[0].method,"POST");
    assert.equal(wire.records[0].rootCount,1);
    assert.equal(wire.records[0].input.getElementsByTagNameNS(fixture.operation.request.name.namespace,"ProfileToken")[0].textContent,"profile-0007");
    assert.match(wire.records[0].contentType,/application\/soap\+xml/u);
    assert.equal(session.selection.uri,uri);
    assert.equal(session.selection.serviceTarget,wire.target);
    assert.equal(session.selection.principal,"explicit-consumer");
    assert.deepEqual(spawns,[{ executable: process.execPath }]);
    assert.equal(JSON.stringify(fixture.description),original);
    assert.equal((await session.close()).remote,"acknowledged");
});

async function associated(t,{ variant="media1",uri="rtsp://127.0.0.1:1/scoped",delay=0,
    security,prepare=() => { },document=false,digest=false }={}) {
    const wire=await soapFixture(uri,{ variant,delay });
    t.after(() => wire.close());
    const source=generatedThing(wire.target,variant);
    const location=`${wire.origin}/catalog/camera.td.json`;
    prepare(source,location);
    const original=JSON.stringify(source.description);
    const runtime=await createOnvifRuntime({ registry: source.registry,trust: { allowedOrigins: [wire.origin] } });
    t.after(() => runtime.close());
    const spawns=[],scopes=[];
    const material=(scope) => ({
        thingId: scope.thingId,targetRef: scope.targetRef,principal: scope.principal,origin: scope.origin,
        ...(digest? {
            native: {
                origin: scope.origin,principal: scope.principal,realm: "scoped-test",
                username: "only-unit-user",password: "only-unit-password"
            }
        }:{})
    });
    const executor=new MediaExecutor({
        worker: { executable: process.execPath },registry: source.registry,
        security: async (scope,signal) => {
            scopes.push(scope);
            return security===undefined? material(scope):security(scope,signal,material(scope));
        },processFactory: () => { const process=new MemoryWorker(); spawns.push(process); return process; }
    });
    t.after(() => executor.close());
    const context={
        principal: "scoped-principal",targetRef: "scoped-target",
        ...(document? { document: location }:{}),
        trust: {
            serviceTargets: [wire.target],allowedOrigins: ["rtsp://127.0.0.1:1"],
            transports: ["tcp-interleaved"],
            authentication: digest? { kind: "digest",realm: "scoped-test" }:{ kind: "none" }
        }
    };
    const thing=await executor.consume(runtime,source.description,context);
    const request={
        action: source.action,input: source.input,transport: "tcp-interleaved",
        tracks: { video: ["JPEG"],audio: ["PCMU"],metadata: true },localAddress: "127.0.0.1",
        ...(variant==="replay"? { replay: { startNtpNs: 3998462400250000000n,endNtpNs: 3998462402250000000n } }:{})
    };
    return { runtime,executor,thing,wire,source,request,scopes,spawns,context,location,original };
}

for(const variant of ["media2","replay"]) {
    test(`media resolver: actual generated ${variant} action preserves its canonical URI variant and mode`,async (t) => {
        const client=await associated(t,{ variant,digest: true });
        const session=await openMedia(client.runtime,client.thing,client.request);
        assert.equal(session.selection.uri,"rtsp://127.0.0.1:1/scoped");
        assert.equal(session.selection.mode,variant==="replay"? "recorded":"live");
        assert.equal(client.wire.records.length,1);
        assert.equal(client.wire.records[0].rootCount,1);
        assert.equal(client.scopes[0].principal,"scoped-principal");
        assert.equal(client.scopes[0].targetRef,"scoped-target");
        assert.equal(client.scopes[0].serviceTarget,client.wire.target);
        assert.equal(client.scopes[0].authentication.realm,"scoped-test");
        assert.equal(client.wire.records[0].body.includes("only-unit-password"),false);
        if(variant==="replay") {
            const payload=client.spawns[0].received.find((entry) => entry.kind===1).payload;
            assert.equal(payload.readBigUInt64BE(12),3998462400250000000n);
            assert.equal(payload.readBigUInt64BE(20),3998462402250000000n);
        }
        assert.equal(JSON.stringify(client.source.description),client.original);
        await session.close();
    });
}

test("media resolver: the real source compiler and packaged default retain all 579 operations",() => {
    const { catalog,registry }=generated();
    assert.equal(catalog.operations.length,579);
    assert.equal(catalog.operations.filter((operation) => operation.mappingSupport === "compiled").length, 579);
    assert.equal(catalog.operations.every((operation) => operation.source.kind==="generated"),true);
    const { packagedArtifactPath }=require("./.compiled/catalog/packaged.js");
    if(packagedArtifactPath("manifest.json")===resolve(__dirname, ".compiled/catalog-data/manifest.json")) {
        require("./.compiled/catalog/artifacts.js").stagePackagedArtifacts(resolve(__dirname, "../../../../.."));
    }
    const { loadMediaRegistry }=require("./.compiled/media/index.js");
    const packaged=loadMediaRegistry();
    assert.equal(packaged.digest,registry.digest);
    assert.equal(Object.keys(packaged.xml.types).length,Object.keys(registry.xml.types).length);
    assert.ok(Object.keys(packaged.xml.types).length>=3426);
});

for(const key of ["thingId","targetRef","principal","origin","native.principal","native.origin","native.realm"]) {
    test(`media resolver: ${key} credential substitution is rejected before any native process`,async (t) => {
        const client=await associated(t,{
            digest: true,security: (_scope,_signal,material) => {
                if(key.startsWith("native.")) material.native[key.slice(7)]="not-this-scope";
                else material[key]="not-this-scope";
                return material;
            }
        });
        await assert.rejects(openMedia(client.runtime,client.thing,client.request),{ code: "PolicyDenied" });
        assert.equal(client.wire.records.length,1);
        assert.equal(client.scopes.length,1);
        assert.deepEqual(client.spawns,[]);
    });
}

test("media resolver: another executor or an unassociated consumed object cannot borrow the principal",async (t) => {
    const client=await associated(t);
    const other=new MediaExecutor({
        worker: { executable: process.execPath },registry: client.source.registry,
        security: async () => { throw new Error("Unowned resolver must never run"); },
        processFactory: () => { throw new Error("Unowned process must never spawn"); }
    });
    t.after(() => other.close());
    await assert.rejects(other.openMedia(client.runtime,client.thing,client.request),{ code: "PolicyDenied" });
    const unassociated=await client.runtime.consume(client.source.description,{ principal: "unassociated" });
    await assert.rejects(openMedia(client.runtime,unassociated,client.request),{ code: "PolicyDenied" });
    assert.deepEqual(client.wire.records,[]);
    assert.deepEqual(client.spawns,[]);
});

test("media resolver: native target outside the independent allowlist never reaches the security resolver",async (t) => {
    const client=await associated(t,{ uri: "rtsp://127.0.0.1:2/not-authorized" });
    await assert.rejects(openMedia(client.runtime,client.thing,client.request),{ code: "PolicyDenied" });
    assert.equal(client.wire.records.length,1);
    assert.deepEqual(client.scopes,[]);
    assert.deepEqual(client.spawns,[]);
});

test("media resolver: an arbitrary extractionUri cannot replace the declared generated action result",async (t) => {
    const client=await associated(t);
    await assert.rejects(openMedia(client.runtime,client.thing,
        { ...client.request,extractionUri: "rtsp://127.0.0.1:1/looked-like-a-uri" }),{ code: "InvalidConfiguration" });
    assert.deepEqual(client.wire.records,[]);
    assert.deepEqual(client.spawns,[]);
});

function namedForms(source) {
    const form=source.description.actions[source.action].forms[0];
    source.description.actions[source.action].forms=[
        { ...form,"@id": "urn:media:form:not-selected",href: "/not-selected" },
        { ...form,"@id": "urn:media:form:selected",href: "../onvif/media" }
    ];
}
const formRef=(client) => ({
    document: client.location,form: "urn:media:form:selected",
    operation: "https://www.w3.org/2019/wot/td#invokeAction"
});

test("media resolver: explicit FormReference selects unique non-first membership using the actual retrieval base",async (t) => {
    const client=await associated(t,{ document: true,prepare: namedForms });
    const session=await openMedia(client.runtime,client.thing,{ ...client.request,formRef: formRef(client) });
    assert.equal(session.selection.formIndex,1);
    assert.equal(session.selection.serviceTarget,client.wire.target);
    assert.equal(client.wire.records.length,1);
    assert.equal(client.wire.records[0].url,"/onvif/media");
    assert.equal(client.scopes[0].serviceTarget,client.wire.target);
    assert.equal(JSON.stringify(client.source.description),client.original);
    assert.equal(client.source.description.base,undefined,"The caller's TD was not rewritten");
    await session.close();
});

for(const mismatch of ["document","href-as-identity","index","duplicate","operation"]) {
    test(`media resolver: explicit FormReference rejects ${mismatch} without first-Form fallback`,async (t) => {
        const client=await associated(t,{
            document: true,prepare: (source) => {
                namedForms(source);
                if(mismatch==="duplicate") source.description.actions[source.action].forms[0]["@id"]="urn:media:form:selected";
            }
        });
        const selected=formRef(client);
        if(mismatch==="document") selected.document=`${client.wire.origin}/other-document`;
        if(mismatch==="href-as-identity") selected.form=client.wire.target;
        if(mismatch==="operation") selected.operation="https://www.w3.org/2019/wot/td#readProperty";
        await assert.rejects(openMedia(client.runtime,client.thing,{
            ...client.request,formRef: selected,
            ...(mismatch==="index"? { formIndex: 0 }:{})
        }),
            { code: mismatch==="operation"? "UnsupportedCapability":"PolicyDenied" });
        assert.deepEqual(client.wire.records,[]);
        assert.deepEqual(client.spawns,[]);
    });
}

test("media resolver: unresolved native URI templates fail explicitly instead of inventing their target",async (t) => {
    const client=await associated(t,{
        prepare: (source) => {
            source.description.actions[source.action].forms[0].href+="/{unresolved}";
        }
    });
    await assert.rejects(openMedia(client.runtime,client.thing,client.request),{ code: "UnsupportedCapability" });
    assert.deepEqual(client.wire.records,[]);
    assert.deepEqual(client.spawns,[]);
});

async function until(predicate) {
    const deadline=performance.now()+3000;
    while(!predicate()) {
        assert.ok(performance.now()<deadline,"Owned resolver did not reach the expected boundary");
        await new Promise((resolve) => setTimeout(resolve,5));
    }
}

test("media resolver: cancellation during actual SOAP resolution starts no worker",async (t) => {
    const client=await associated(t,{ delay: 1000 }),controller=new AbortController();
    const pending=openMedia(client.runtime,client.thing,{ ...client.request,signal: controller.signal });
    const rejected=assert.rejects(pending,{ code: "TransportError" });
    await until(() => client.wire.records.length===1);
    controller.abort();
    await rejected;
    assert.deepEqual(client.scopes,[]);
    assert.deepEqual(client.spawns,[]);
});

test("media resolver: cancellation during out-of-band credentials prevents a late credential result from spawning",async (t) => {
    let release,observedSignal;
    const client=await associated(t,{
        security: (_scope,signal,material) => {
            observedSignal=signal;
            return new Promise((resolve) => { release=() => resolve(material); });
        }
    });
    const controller=new AbortController();
    const pending=openMedia(client.runtime,client.thing,{ ...client.request,signal: controller.signal });
    const rejected=assert.rejects(pending,{ code: "TransportError" });
    await until(() => release!==undefined);
    controller.abort();
    await rejected;
    assert.equal(observedSignal.aborted,true);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(client.spawns,[]);
});

test("media resolver: pre-aborted requests and the total resolver deadline cannot become ready sessions",async (t) => {
    const client=await associated(t,{ delay: 1000 }),controller=new AbortController();
    controller.abort();
    await assert.rejects(openMedia(client.runtime,client.thing,{ ...client.request,signal: controller.signal }),
        { code: "TransportError",execution: "not-sent" });
    assert.deepEqual(client.wire.records,[]);
    await assert.rejects(openMedia(client.runtime,client.thing,{ ...client.request,timeoutMs: 30 }),
        { code: "TransportError" });
    assert.deepEqual(client.spawns,[]);
    assert.deepEqual(await client.executor.close(),[]);
    await assert.rejects(openMedia(client.runtime,client.thing,client.request),{ code: "RuntimeClosed" });
});
