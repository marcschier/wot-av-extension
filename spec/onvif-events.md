# Native ONVIF events

The `pullpoint-v1` binding implements an owned native PullPoint subscription
through actual node-wot Event dispatch and the canonical SOAP executor. It does
not poll an HTTP control proxy or invent AV properties for subscription state.

## Explicit generated Event contract

`models/events/PullPointSubscription.tm.json` is an opt-in Thing Model.
`eventTemplate(catalog, xaddr)`, exported by the package's `./catalog` module,
creates the same Event affordance for a concrete native endpoint. It carries
source-schema references for creation, notification data and cancellation.
The Form declares `onvif:binding: "pullpoint-v1"` and an
`onvif:subscription` object containing exact registered operation tuples:

| Role | Native binding / port type / operation |
| --- | --- |
| Create | EventBinding / EventPortType / CreatePullPointSubscription |
| Pull | PullPointSubscriptionBinding / PullPointSubscription / PullMessages |
| Cleanup | PullPointSubscriptionBinding / PullPointSubscription / Unsubscribe |
| Conditional renewal | SubscriptionManagerBinding / WS-N SubscriptionManager / Renew |
| Optional synchronization | PullPointSubscriptionBinding / PullPointSubscription / SetSynchronizationPoint |

The WS-N port type is in `http://docs.oasis-open.org/wsn/bw-2`, not the ONVIF
Event namespace. The descriptor may omit renewal/synchronization; requesting a
missing operation fails before creation. WS-N SubscriptionManager Unsubscribe
is also an accepted explicit cleanup tuple.

An Event template is not evidence of service presence, filter support, or
renewal support. Projection/publication must attach it only under the relevant
observed-device and caller policy. A native Form without the descriptor is
rejected. It is not inferred from a name or promoted from every Create Action.

## Consumer APIs

The returned Thing remains a real `ConsumedThing`. Its owned native Event
wrapper calls the original node-wot `subscribeEvent`, protocol client and
canonical codec:

```typescript
const subscription = await thing.subscribeEvent(
    "notifications",
    async (output) => {
        const notification = await output.value();
        await applicationSink(notification);
    },
    (error) => applicationError(error),
    {
        data: {
            InitialTerminationTime: {
                $member: "{http://www.w3.org/2001/XMLSchema}duration",
                $value: "PT60S"
            }
        }
    }
);
await subscription.stop();
```

Standard options are `formIndex` and `data`. Data is canonical native
CreatePullPointSubscription input: Filter, InitialTerminationTime,
SubscriptionPolicy and source-permitted extensions. Nothing is sent as a
made-up JSON subscription body.

`runtime.subscribeEvent(thing, name, listener, errorListener?, options?)`
returns the same managed handle with native controller options:

| Option | Default / boundary |
| --- | --- |
| `input` | Optional canonical creation fields, overriding descriptor defaultInput |
| `topicFilter` | Expression, namespace map, optional qualified dialect |
| `leaseDuration` | PT60S; positive bounded day/time duration |
| `pullTimeoutMs` | 60,000; integer 0..2,147,000,000 |
| `messageLimit` | 16; integer 1..1,024 |
| `minimumPollIntervalMs` | 50; integer 1..60,000 |
| `requestGraceMs` | 5,000; integer 1..300,000 beyond native pull timeout |
| `cleanupTimeoutMs` | 10,000; integer 1..300,000 |
| `synchronize` | false; explicit synchronization tuple required when true |
| `renewal` | Disabled unless `{supported:true, duration?, marginMs?}` is supplied |
| renewal margin | 10,000; integer 1..300,000 |
| `restartOnExpiry` / `maxRestarts` | false / 1; restart bound 0..10 |
| `maxQueuedMessages` | 128; integer 1..4,096, including active delivery |
| `maxQueuedBytes` | 4 MiB; integer 1..16 MiB |
| `deliveryTimeoutMs` | 10,000; integer 1..300,000 |
| `signal` / `formIndex` | Cancellation and selected native Event Form |

There are at most 64 owned subscriptions per consumed Thing, including
concurrent creation reservations. Unknown options, invalid bounds, non-native
Forms and unsupported dialects fail explicitly.

The topic-filter convenience API supports ONVIF ConcreteSet, OASIS Concrete and
OASIS Full. QName prefixes must be bound; namespace maps are retained in the
native expression. Use canonical Filter input for another device-specific
dialect, rather than claiming it is interpreted locally. `input.Filter` and
`topicFilter` cannot both be supplied.

## Native state machine

Creation produces an EPR, not just an address string. Its address, namespace
and reference parameters/properties are validated and retained. Every
subsequent operation targets that owned EPR with the original principal,
declared security and exact target policy. The current native Event WSDL uses
WS-Addressing 2005 for subscription EPRs. Generic native addressed requests also
support August 2004 EPRs; the binding never silently converts between them.

Only one PullMessages request per subscription is in flight. Native
CurrentTime and TerminationTime update the lease; server lexical precision and
timezone are retained. Scheduling uses a conservative local observation of the
server clock. Timezone-free or unrepresentable scheduler instants fail instead
of assuming local time. A permitted nil creation/renewal termination denotes
an indefinite lease, not a fabricated expiration.

PullMessages is the normal keepalive. WS-BaseNotification Renew is invoked only
with explicit supported=true, an actual descriptor tuple, and an approaching
finite expiration. A Renew response may omit CurrentTime and use the previous
server clock basis. Calendar-month/year duration arithmetic is not invented by
the scheduler.

A successful timeout is an empty native NotificationMessage list. It is not a
notification containing `{}`, nor a swallowed SOAP/transport error. An
explicitly rejected typed PullMessagesFaultResponse may lower the timeout and
message limit to native maxima, including zero timeout. Negotiation is bounded
and only retries known rejected requests. A lost stateful drain is not replayed.

Expiry and confirmed ResourceUnknown during pull/renewal can trigger a bounded,
opt-in replacement. Confirmed absent resources are not unsubscribed again.
An expired but not confirmed-absent resource is cleaned up before replacement.
Reboot, expiration, backward server clocks, cancellation and failed/overflowed
delivery produce gap diagnostics; a new generation is not continuous history.

## Delivery and awaited ownership

Each listener receives node-wot `InteractionOutput` for one complete canonical
NotificationMessage. Topic mixed content, namespaces, message XML, attributes,
comments and processing instructions are preserved. GetEventProperties is a
native Action whose full TopicSet and ordered message descriptions use the
same XML parser; neither it nor PullMessages is a generic Property alias.

Node-wot 0.9.2 does not await Event unlink or listener return promises. The
owned wrapper captures listener completion, bounds it, and explicitly awaits
native cleanup before asking core to remove its local subscription. No native
Unsubscribe promise is delegated to core's premature stop result.

The managed handle exposes `active`, `state`, `stopPromise`, `lease`,
`generation`, `diagnostics`, `lastError`, and `delivered`. States are creating,
active, recovering, closing, closed, failed, or uncertain. These are native
controller observations, not properties added to an AV vocabulary.

`stop`/`close` abort a pending pull/renewal, then await a separately bounded
Unsubscribe that does not inherit the aborted request signal. Cancellation
`data` is validated against the native Unsubscribe schema before stopping;
invalid input leaves the active subscription available for a corrected stop.
An explicit cancellation Form index must match the selected subscription Form;
it cannot retarget the owned EPR. URI-template cancellation is unsupported.

Runtime close also accounts for in-flight creation, awaits owned events while
the core client factories are still available, and only then closes transport
and codec resources. Lost cleanup remains uncertain and is not retried by
another stop/close. Repeated successful stop retains closed state.

An asynchronous listener failure or deadline is observable in diagnostics,
`lastError`, and `stopPromise`; error-listener failures are also retained.
Delivery overflow is an explicit gap/failure, not silent oldest-message
replacement. Unprocessed queued messages are diagnosed on shutdown.

A listener may await its own `stop()` to confirm remote cleanup without
deadlocking on its own return. Await `stopPromise` outside that callback for
full delivery completion. A callback that never settles cannot be forcibly
cancelled as arbitrary application code; the configured bound ends the owned
wait and reports failure.

## Qualification and limits

`test/events` uses independent loopback SOAP peers and the real compiled
catalog, generated Event template, node-wot consumer and native executor. The
gates include delayed cleanup/close, serial pulls, exact EPR headers/query,
creation filters/leases, conditional renewal, synchronization, empty/max-limit
responses, cancellation, malformed payloads, reboot/expiry/clock gaps,
asynchronous delivery, capacity and schema validation. Existing native and
catalog suites remain part of the scoped acceptance.

Hardware behavior, all product-specific topics/filter dialects, deployment
networks, full ONVIF profile conformance, and package/distribution clearance are
not established by these fixtures. Bridge publication and native-media
integration have separate owners and acceptance gates.
