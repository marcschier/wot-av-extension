# ONVIF Profile A/C/D requirement ledger

The [A/C/D ledger](../bindings/onvif/catalog/requirements-acd.json) contains
**654 role-specific requirement atoms**, including native operations, events,
schema parameters, capabilities, runtime behavior and process obligations.
It is a project-authored mapping of the selected public profile documents,
not an ONVIF publication, certification, runtime implementation or permission
to operate a device. The [offline vectors](../bindings/onvif/examples/requirements-acd-vectors.json)
contain synthetic data only. Native configuration, credential, user, access,
door and subscription operations are **described, never executed** by this work.

## Sources and coverage boundary

The [source lock](../bindings/onvif/sources.lock.json) is the authority for
source IDs, URLs, hashes and the native specification-set pin. Its ONVIF
release is 26.06 at
`68ee1b540a40f848c9599eba2c55b87547c588d6`; a service's own XSD version is
neither that release number nor a profile edition. See the
[source-layer documentation](onvif-sources.md) for immutable-source and
publication restrictions.

| Profile/source ID | Selected edition | SHA-256 |
| --- | --- | --- |
| `profile-A-1.0` | 1.0, June 2017 | `e3da8695d6bf0303452484ba625c25ca129468e9481e5c90e999175c72659272` |
| `profile-C-1.0` | 1.0, December 2013 | `f41273521eea96eac261553937e5caee1e81fbb493670239c86d533006c2e034` |
| `profile-D-1.0` | 1.0, June 2021 | `13c14ab74512e52778c724258b11bbd0c60576ebb8cad5eb4a25147f8e9c60e9` |

All normative PDF pages were manually read from the verified cache:
**A 6-25, C 4-17, D 6-35**. Physical and printed pagination agree on those
pages; both are nevertheless recorded. Front matter, notices and contents
are separately accounted for. D's cover says June 2021 while its revision
history says June 2020; the locked `profile-d-cover-date` decision preserves
the discrepancy rather than altering the publication. [D, pp.1,3][d]

| Profile | Device atoms | Client atoms | Function/event/auth table role cells | Scope rows | Separate prose atoms | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 108 | 102 | 196 | 1 | 13 | 210 |
| C | 101 | 96 | 182 | 1 | 14 | 197 |
| D | 133 | 114 | 218 | 1 | 28 | 247 |
| **Total** | **342** | **312** | **596** | **3** | **55** | **654** |

`coverage.reviewedTables` accounts for every function/event/auth table cell
by role, original requirement marker, page and atom ID. There are 124
role-specific table views; C's combined device/client tables have two views.
`reviewedScopeTables` accounts for the three additional normative scope rows.
`normativeSectionsReviewed` records 299 numbered headings, including
definitions, enclosing conditions, prose and normative-reference sections.
Overlapping prose and table statements can reference the same atom; a second
operation is not invented merely because a paragraph repeats its table.

**Complete profile-PDF review is not recursively complete normative
dependency coverage.** `coverage.unresolved` retains four gates: exact
referenced policy/process editions; service-body and complete topic-payload
semantics beyond the reviewed contracts; A's client
`StateReportingSupported` wording; and transformed-dataset publication
clearance. The technical-minimum and policy/service-compliance atoms remain
in the manifest with alternative evidence targets. No process clause is
declared satisfied by a valid TD, and `topicns.xml` is not treated as a
complete event registry. [A, sections 1.2,3,5, pp.6-8][a6]
[C, sections 2,5,6, pp.4-5][c4] [D, sections 2,4,5, pp.7-10][d7]

## Reading and consuming an atom

Each atom has exactly one `role`, its selected profile/edition, a PDF source
locator, effective `requirementLevel`, feature, typed condition,
classification, native references, mapping reason, evidence targets and
editorial decision IDs. `sourceRequirementLevel` preserves the literal
function-table `M`, `C`, `O`, `M*`, `C*` or `C**`; `featurePath` preserves
the enclosing feature and function conditions. A mandatory function inside
a conditional feature is effectively conditional, not universally mandatory.
An optional function retains its outer condition and is never interpreted
as unsupported. [A, section 5, p.8][a8] [C, section 6, p.5][c5]
[D, section 5, p.10][d10]

Only the requested condition AST is used: `fact` with `equals`, `all`, `any`
and `not`, or `null` for no condition. Evaluation is three-valued. An absent,
unauthorized, unreachable, invalid or uninspected fact is **unknown**.
False native support does not negate unknown proprietary support.
Functionality provided in a proprietary way can activate a conditional
feature. A `not` expression over unknown remains unknown; false dominates
`all`, while true dominates `any`. Boolean `true`, integer `1` and string
`"1"` are not interchangeable canonical fact values.

The 142 entries in `conditionFacts` give role, scope, author/provenance,
native evidence where available and the requirements using each fact.
Device service capabilities, individual access-point/door capabilities
and client implementation abilities are different evidence scopes.
For example, a door's `DoubleLock` flag must not be copied to a different
door. A client fact is authored by its implementer, build declaration or
client-behavior evidence; it is not obtained by pretending the client
exposes a device `GetServiceCapabilities` action. The vectors include
complete true/false/unknown combinations for all 90 distinct requirement
conditions, plus explicit type-equality and negation cases.

Fact `valuePath` strings are explanatory contract locators, not executable
XPath or codec selectors. In particular, legacy `GetCapabilities` exposes
IP-filter support at `Capabilities/Device/Network/IPFilter`, an element,
not the similarly named attribute in a different capability structure.
Resolve real namespaces and shapes from the pinned native contract.

### Alternatives are not exclusive choices

Six `obligationGroups` use `operator: "atLeastN"`, `atLeast: 1` and
`multipleBranchesAllowed: true`: four A client inventory alternatives,
A client time configuration, and D's positive-capacity alternative.
A branch is the conjunction of its `requirementIds`. An atom marked with
`obligationGroupId` is an alternative member, **not a separate universal
M requirement**. Do not change source M* to O, make both alternatives
mandatory, or generate JSON Schema `oneOf`.

Branches may also reference independently applicable dependency atoms.
The A time branches are `SetSystemDateAndTime`, or `SetNTP` **and**
`GetNTP`. `GetNTP` is still independently required when the client supports
`SetNTP`, even if the manual-time branch is also implemented. Group-member
exemption applies only to `alternativeMemberRequirementIds`, not to every
atom referenced by a branch. [A, section 6.9.2-6.9.4, p.19][a19]

### Native contracts and projection

An operation key is `(serviceNamespace, portType, operation)`.
The relevant portTypes are `Device`, `EventPortType`,
`PullPointSubscription`, `AccessRulesPort`, `CredentialPort`,
`SchedulePort`, `PACSPort` and `DoorControlPort`.
Imported WS-Notification `Renew` uses
`{http://docs.oasis-open.org/wsn/bw-2}SubscriptionManager`, with
`endpointServiceNamespace` identifying the ONVIF Event subscription EPR.
Do not demand a separately advertised WSN service or invent an
Event-local `Renew`. [Event WSDL, portTypes/bindings][event-wire]

Wire spelling comes from the locked WSDL: **`SetUser`**, `SystemReboot`,
`PullMessages`, `GetHostname` and `SetHostname`. Original profile labels
remain in source locators and the relevant
[editorial IDs](../bindings/onvif/catalog/editorial-decisions.json) are
retained. `GetIPAddressFilter` and the other IP-filter operations belong
to the **Device** portType; a name containing `Filter` is not an Event
subscription parameter. [Device WSDL][device-wire]

Device SOAP operations map to actions by default, including native reads
and protected writes; no implicit property aliases are introduced.
Device topic obligations map to events. Client operations and topics map
to **client requirement manifests**, not fabricated client-hosted forms.
Capability, behavior and process obligations remain explicit where a TD
cannot express or prove them. Topic paths have expanded namespace identity,
not a required lexical `tns1` prefix. Source/Key/Data payload construction
must retain the unresolved service-specification dependency instead of
guessing a schema from a topic name.

## Profile A: configuration and client asymmetry

Profile A requires the referenced Network Interface Specification Set,
whose minimum is 2.6 in section 1.2. Its configuration services are Access Rules,
Credential and Schedule, alongside Device and Event. This is not a
requirement that every endpoint be a camera. [A, sections 1.2-4, pp.6-8][a6]

| Feature and source | Device obligations | Client obligations |
| --- | --- | --- |
| Authentication, section 6.1.1, p.9 | HTTP Digest | HTTP Digest |
| Capabilities, section 6.2, pp.9-10 | `GetServices`, WSDL URL and Device/Event/AccessRules/Credential/Schedule capabilities; advertise at least two pull points | `GetServices` M; capability and WSDL URL calls O |
| Access profiles, section 6.3, pp.10-11 | All seven listed inventory/configuration calls M; Changed/Removed events M | List or info-list, at least one; full configuration retrieval and CRUD C; info-by-token O; both events M |
| Credentials, section 6.4, pp.11-13 | All 17 listed functions M; configuration and Enabled events M | Full credential retrieval, create/modify/delete and supported-format retrieval M; list or info-list, at least one; identifier/access-profile suboperations O; enable/disable and state C |
| Schedules, section 6.5, pp.14-15 | Inventory and CRUD M; state and Active event gated by state-reporting capability; configuration events M | List or info-list, at least one; full configuration retrieval and CRUD C; info-by-token O; state/Active condition retained separately |
| Events, section 6.6, pp.15-16 | Real-time pull-point interface and all listed functions M; actual concurrent subscriptions at least two; topic filtering | Create/pull M; synchronization, Renew, unsubscribe, properties and topic-filter parameter O |
| Discovery, section 6.7, pp.16-17 | WS-Discovery and six mode/scope calls M; Profile/A scope | WS-Discovery M; mode/scope calls O |
| Network, section 6.8, pp.17-18 | Ten hostname/DNS/interface/protocol/gateway calls M | Conditional feature; interface and gateway get/set M inside it, other calls O |
| System, section 6.9, pp.18-19 | Information, time, NTP, factory defaults and reboot M | Conditional feature; information/current time M, time-setting alternatives and NTP implication, defaults/reboot O |
| Users, section 6.10, pp.19-20 | Four user functions M; signal maximum users | Four user functions M, unlike the C/D conditional client user feature |
| Antipassback, section 7.1, pp.21-22 | Conditional reset and violation event | Conditional reset and violation reception |
| Special days, section 7.2, pp.22-23 | Conditional inventory/configuration and Changed/Removed events | Conditional full retrieval/CRUD/events; list or info-list at least one; info-by-token O |
| Persistent events, section 7.3, pp.23-24 | Conditional Seek and delivery of stored events | Conditional seeking of stored events |
| IP filtering, section 7.4, pp.24-25 | Conditional four Device operations and `GetCapabilities` IPFilter=true | Conditional four Device operations |

The table above summarizes the individual cited rows, not a substitute for
their conditions. [A, pp.9-20][a9] [A, pp.21-25][a21]
In particular, A's **client credential CRUD is mandatory**, whereas its
access-profile and schedule configuration functions are conditional.
Current WSDLs also contain `SetAccessProfile`, `SetCredential` and
`SetSchedule`; their presence in the source set does not add those operations
to the A 1.0 profile function tables. [A, pp.10-15][a10]

A section 6.5.2 says a *client* with `StateReportingSupported` capability must get
schedule state. The actual required native attribute belongs to the
device's Schedule `ServiceCapabilities`, with **no default**.
The ledger therefore retains a separate client-attestation fact and a
visible interpretation issue; it does not copy a server flag into the
client role or invent a client capability endpoint.
[A, pp.14-15][a14] [Schedule WSDL, lines 130-137][schedule-state]

The Schedule payload's `Standard` value is iCalendar text, not a generic
Boolean schedule. Extended recurrence and special-day support remain
native capabilities; Access Rules `AccessPolicy` associates a schedule
with an entity, and multiple schedules for the same access point form a
union. Preserve those references and capability-dependent native semantics.
[Schedule WSDL, lines 101-218][schedule-wire]
[Access Rules WSDL, lines 111-146][access-policy]

## Profile C: state, control and conditional extensions

C requires Core 2.3 or later. Its mandatory device/client intersection
includes HTTP Digest, service discovery through `GetServices`,
access-point/door/area inventories, access-point and door state, basic
door control, access decisions and pull-point event handling. Hybrid
software aggregators can have both roles; the roles are not merged into
one conformance result. [C, sections 4-7, pp.5-10][c5]

| Feature and source | Required interpretation |
| --- | --- |
| Capabilities, section 7.2, p.6 | `GetServices` M/M; Device/Event/AccessControl/DoorControl capabilities and WSDL URL M/O; device advertises at least two pull points |
| Inventories, sections 7.3-7.5, pp.6-7 | Each info-list M/M; specific info retrieval M/O |
| Access-point state, section 7.6, pp.7-8 | `GetAccessPointState` and Enabled event M/M |
| Door state, section 7.7, p.8 | `GetDoorState` and DoorMode M/M; physical/lock/double-lock/alarm/tamper/fault events C for relevant device functionality, M for client consumption |
| Door control, section 7.8, p.9 | `AccessDoor`, `LockDoor`, `UnlockDoor` M/M; double-lock, block, lockdown/release and lock-open/release each C/C |
| Access decisions, section 7.9, pp.9-10 | Credential grant/deny M/M; anonymous, unknown-card and taken/not-taken variants have device conditions and client M |
| Events, section 7.10, p.10 | Synchronization, create, pull, **Renew and unsubscribe M/M**; properties/topic filtering M/O; two actual concurrent device subscriptions |
| Configuration events, sections 8.1-8.3, pp.11-12 | Access-point, door and area Changed/Removed rows; preserve the enclosing conditional feature and device support-in-any-way footnotes |
| Access-point control, section 8.4, pp.12-13 | Conditional enable/disable for both roles |
| External authorization, section 8.5, p.13 | Conditional client-to-device decision operation; Credential request and Timeout topics; Anonymous request has an additional device anonymous-access condition |
| Duress, section 8.6, pp.13-14 | Conditional device notification and client reception |
| Persistent storage, section 8.7, p.14 | Conditional Seek and stored-notification behavior |
| IP filtering, section 8.8, p.14 | Conditional four Device operations and device IPFilter=true advertisement |
| Device-core features, sections 9.1-9.4, pp.15-17 | Device discovery/network/system/users M; client feature conditions remain, including conditional discovery and user management |

These locators cover the full C feature sequence. [C, pp.6-10][c6]
[C, pp.11-14][c11] [C, pp.15-17][c15]
The heading of section 8 explicitly scopes conditional features to the device
or client supporting the feature. An inner client M cell is retained as
M **inside** that feature; a device M* support footnote is not an
at-least-one choice.

Door mode, sensed door position and sensed lock position are distinct.
`DoorMode` is required in the native `DoorState`; physical state fields
depend on the corresponding per-door monitoring/alarm/tamper/fault
capability. Missing optional sensor state is not the Boolean value false.
[Door WSDL, lines 262-442][door-state]

`AccessDoor` grants timed momentary access and returns to the previous
mode; it is not a synonym for `UnlockDoor`. Lockdown and lock-open have
distinct release operations and mode restrictions. Native faults and
device-adjusted timing must be preserved; a requested duration does not
prove an observed physical action. The vectors describe these transitions
without calling an endpoint. [Door WSDL, lines 1451-1585][door-behavior]

## Profile D: readers, door outputs, or both

D requires Network Interface Specification Set 21.06 or later and describes
a peripheral, not necessarily an ACU with local access rules, schedules
or a Profile A credential database. Both AccessControl and DoorControl
capability/list surfaces remain mandatory. The device reports
`MaxAccessPoints` and `MaxDoors`; **at least one is positive**, while both
may be positive. `0/0` fails the capacity obligation.
[D, sections 4,6,7.2, pp.9,11,13][d9]

| Feature and source | Device | Client |
| --- | --- | --- |
| Authentication, section 7.1, p.12 | HTTP Digest M; RTSP and tunneled RTSP Digest if RTSP supported | Same role-local condition; HTTP tunnel authentication does not replace RTSP authentication |
| Capabilities, section 7.2, pp.13-14 | Device/Event/AccessControl/DoorControl M; Credential C; both resource maxima and Event MaxPullPoints>=2 | `GetServices` M; listed capability calls O |
| Discovery/network, sections 7.3-7.4, pp.14-17 | WS-Discovery, scope/mode and all ten network functions M | Discovery and interface/gateway get/set M; remaining mode/scope/network functions O |
| System/users, sections 7.5-7.6, pp.17-19 | Listed system and user functions M | Conditional features; system information M within its feature, remaining system calls O; user functions M within theirs |
| Events, section 7.7, pp.19-20 | Synchronize/create/pull, properties, unsubscribe, topic/content filtering and ItemFilter M; at least two concurrent subscriptions | Synchronize/create/pull M; other listed functions O; ItemFilter C if content filtering supported |
| Access-point information, section 7.8, pp.20-21 | All four inventory calls M even at zero; configuration events have change/remove conditions | Info-list M, other retrieval O; Changed/Removed M |
| Access-point state, section 7.9, p.22 | Conditional on access-point support; Enabled event additionally depends on state-change functionality | State call and Enabled reception M |
| Access control, section 7.10, pp.22-24 | With access points: external grant/deny for at least one point, required decision/identifier-request/timeout events; Feedback C; anonymous request has its own condition | All listed operations/topics M, including Feedback and anonymous request reception |
| Access taken, section 7.11, pp.24-25 | Access-point and access-taken conditions; anonymous variants add anonymous-access support | Identifier and anonymous taken/not-taken reception M |
| Door information, section 7.12, pp.25-26 | All four inventory calls M even at zero; change/remove events conditional | Info-list M, other retrieval O; Changed/Removed M |
| Door state, section 7.13, pp.26-28 | Door-support condition plus individual sensor conditions | All eight listed state call/topic obligations M |
| Door control, section 7.14, pp.28-29 | Door-support condition; three basic commands M within it, six extended commands C | Three basic commands M; extended commands O |
| Access-point management, section 8.1, pp.30-31 | Conditional CRUD/events; `SetAccessPoint` additionally gated by client-supplied-token support | Conditional CRUD/events; `SetAccessPoint` O within feature |
| Access-point control, section 8.2, p.31 | Conditional enabling/disabling | Conditional enabling/disabling |
| Door management, section 8.3, pp.32-33 | Conditional CRUD/events; `SetDoor` additionally gated by client-supplied-token support | Conditional CRUD/events; `SetDoor` O within feature |
| Format types, section 8.4, p.33 | Required if whitelisting **or** blacklisting supported | Same role-local OR condition |
| Whitelist/blacklist, sections 8.5-8.6, pp.34-35 | Conditional four management operations per list plus Identifier grant/deny event | Conditional matching operations and event reception |

The table retains the distinct mandatory, conditional and optional role
columns from the detailed source. [D, pp.12-20][d12]
[D, pp.21-29][d21] [D, pp.30-35][d30]

At zero capacity, all four operations for that resource kind return empty
lists, including the specific-token operations. Removing the service,
returning `ActionNotSupported`, or fabricating an empty response after
HTTP 401 does not satisfy the rule. In particular,
`AccessPointManagementSupported=false` does not remove the profile's
mandatory `GetAccessPoints` or `GetAccessPointList`.
The analogous distinction applies to door management.
[D, section 7.8.1, pp.20-21][d20] [D, section 7.12.1, p.25][d25]

D's client requirements remain implementation requirements even when a
particular peer is reader-only or door-only. Do not gate a mandatory client
`GetDoorState`, `ExternalAuthorization` or `Feedback` implementation on
that peer having the corresponding hardware. Conversely, the device's
per-resource conditions must not be promoted to mandatory features of
every D peripheral.

### Decision direction and identifiers

For external authorization the **client invokes the device**:
`{http://www.onvif.org/ver10/accesscontrol/wsdl}PACSPort/ExternalAuthorization`.
The request has `AccessPointToken`, optional `CredentialToken`, optional
`Reason`, and `Decision` (`Granted` or `Denied`). There is no `RequestID`.
A D `AccessControl/Request/Identifier` event can lead to an anonymous
decision if the client cannot identify a credential holder; its
anonymous grant/deny notifications are not gated like anonymous request
generation. C's `Request/Credential` and D's `Request/Identifier` remain
different topics. [C, section 8.5, p.13][c13] [D, section 7.10, pp.22-24][d22]
[AccessControl WSDL, lines 1148-1179][authorization-wire]

A `CredentialToken` is an opaque reference, while
`CredentialIdentifier.Value` and `CredentialIdentifierItem.Value` are
`xs:hexBinary` identifier data. Preserve leading zero octets, type name,
format type and, for the full identifier, the required
`ExemptedFromAuthentication` field. A token that happens to look like hex
must remain a token. Recognition classes do not imply a universal
biometric-image transfer requirement; every example uses synthetic values,
and biometric classes appear only as labels.
[Credential WSDL, lines 280-335 and 498-521][credential-wire]

## Evidence, defaults and resource identity

| Input | Author/scope | Default handling |
| --- | --- | --- |
| AccessControl `MaxAccessPoints`, DoorControl `MaxDoors` | Device service capacity response | XSD default 10 only after a valid applicable response; explicit zero wins |
| Access/door management and client-supplied-token flags | Device service response | XSD default false after valid response; does not negate proprietary support |
| Credential whitelist/blacklist maxima | Device Credential response | XSD default zero; do not infer a full Profile A credential database |
| Schedule `StateReportingSupported` | Device Schedule response | Required boolean, no XSD default; missing is invalid, not false |
| Door monitor/lock/alarm/tamper/fault flags | Individual door capabilities | No invented false for an absent optional attribute |
| Access-point capabilities and feedback types | Individual access-point information | Respect the specific point; some attributes are required, others have no default |
| Conditional client functionality | Client implementer/build evidence | No automatic default from a remote device, profile label or WSDL catalog |
| Registered conformance | Applicable issuer/product/firmware evidence | Unknown until independently established |

These values and defaults come from the pinned native contracts, not
universal A/C/D requirements. Their declared scope must survive projection.
[AccessControl WSDL, lines 43-104 and 229-332][access-wire]
[Door WSDL, lines 43-87 and 262-374][door-wire]
[Credential WSDL, lines 39-145][credential-wire]
[Schedule WSDL, lines 40-148][schedule-wire]

Use `(stable EPR, service namespace, resource kind, native token, applicable
parent identity)` for canonical identity. Include relevant EPR reference
parameters; changing an XAddr must not change identity. Parent-scoped
identifier type names can recur under different credentials. PACS tokens
have a native length range of 0-64; the recommendation to generate local
tokens within 36 characters is not a replacement schema maximum.
`DataEntity.token` is service-unique: canonical kind separation must
preserve and report a same-service token violation, not declare it valid.
[PACS XSD, lines 34-61][pacs-wire]

Two directional access points may reference one door. Preserve `AreaFrom`,
`AreaTo` and the entity QName/reference instead of duplicating the door.
An omitted access-point `EntityType` has the documented Door assumption;
an omitted access-policy `EntityType` has the different AccessPoint
assumption. Neither is a generic "everything is a door" rule.
[AccessControl WSDL, lines 130-181][access-wire]
[Access Rules WSDL, lines 121-146][access-policy]

**AuthenticationBehavior is optional/separate**, not universally mandated
by A, C or D. The optional `AuthenticationProfileToken` relationship
does not change that. Keep HTTP authentication, physical recognition,
credential authorization and optional authentication-profile/security-level
configuration distinct. The source lock deliberately lists
AuthenticationBehavior outside its canonical service-entry-point group,
as a separate optional service. [AccessControl WSDL, lines 199-218][access-wire]
[source groups](../bindings/onvif/sources.lock.json)

Publication uses a separate sensitive-data policy. Discovery metadata
must not publish credential tokens/values, passwords, PINs, holder data,
biometrics, access histories or unreviewed vendor extensions.
The redaction vector is an allowlisted public-metadata projection, not a
change to native device data or a reason to remove protected input/output
schemas. Native schemas remain available for explicitly authorized clients.

## Offline evidence and compiler handoff

The vector file contains 29 named test families, six group instances,
3,018 condition combinations and an evidence entry for every atom.
Cases cover source spelling and qualified operations, nested/proprietary
conditions, role projection, all choice outcomes, the NTP implication,
reader/door/both capacities, eight zero-capacity inventory calls, native
defaults, event synchronization/Renew/filter differences, external
authorization shape/direction, scoped token reuse, redaction, and
unfulfilled process/service evidence. These are **mapping fixtures**, not
live interoperability results.

Request/identifier objects in these vectors are semantic field maps relative
to the stated native operation/type, not an alternative canonical SOAP/XML
codec format. A compiler must use its locked namespace-aware codec contract
for actual messages. Native references in capability/behavior atoms identify
where evidence is obtained; operation availability alone cannot satisfy a
capacity bound, empty-result rule, concurrent-subscription requirement or
state transition.

A consumer must validate IDs, source pins/locators, raw role markers,
condition fact references, native QNames, group branches and evidence
pointers. It must preserve independent dependency atoms and unresolved
records, separate client manifests from device model affordances, and
keep non-TD runtime/process obligations in its output. If its evaluator
does not implement a group, resource-scoped fact, imported subscription
contract or interpretation gate, it must report that limitation rather
than silently declaring the profile satisfied.

No runtime, projection engine, discovery implementation, generated model
index, source lock or vendored native contract is changed by this ledger.

[a]: https://www.onvif.org/wp-content/uploads/2017/06/ONVIF_Profile_A_Specification_v1-0.pdf
[a6]: https://www.onvif.org/wp-content/uploads/2017/06/ONVIF_Profile_A_Specification_v1-0.pdf#page=6
[a8]: https://www.onvif.org/wp-content/uploads/2017/06/ONVIF_Profile_A_Specification_v1-0.pdf#page=8
[a9]: https://www.onvif.org/wp-content/uploads/2017/06/ONVIF_Profile_A_Specification_v1-0.pdf#page=9
[a10]: https://www.onvif.org/wp-content/uploads/2017/06/ONVIF_Profile_A_Specification_v1-0.pdf#page=10
[a14]: https://www.onvif.org/wp-content/uploads/2017/06/ONVIF_Profile_A_Specification_v1-0.pdf#page=14
[a19]: https://www.onvif.org/wp-content/uploads/2017/06/ONVIF_Profile_A_Specification_v1-0.pdf#page=19
[a21]: https://www.onvif.org/wp-content/uploads/2017/06/ONVIF_Profile_A_Specification_v1-0.pdf#page=21
[c4]: https://www.onvif.org/wp-content/uploads/2017/01/2013_12_ONVIF_Profile_C_Specification_v1-0.pdf#page=4
[c5]: https://www.onvif.org/wp-content/uploads/2017/01/2013_12_ONVIF_Profile_C_Specification_v1-0.pdf#page=5
[c6]: https://www.onvif.org/wp-content/uploads/2017/01/2013_12_ONVIF_Profile_C_Specification_v1-0.pdf#page=6
[c11]: https://www.onvif.org/wp-content/uploads/2017/01/2013_12_ONVIF_Profile_C_Specification_v1-0.pdf#page=11
[c13]: https://www.onvif.org/wp-content/uploads/2017/01/2013_12_ONVIF_Profile_C_Specification_v1-0.pdf#page=13
[c15]: https://www.onvif.org/wp-content/uploads/2017/01/2013_12_ONVIF_Profile_C_Specification_v1-0.pdf#page=15
[d]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf
[d7]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf#page=7
[d9]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf#page=9
[d10]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf#page=10
[d12]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf#page=12
[d20]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf#page=20
[d21]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf#page=21
[d22]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf#page=22
[d25]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf#page=25
[d30]: https://www.onvif.org/wp-content/uploads/2021/06/onvif-profile-d-specification-v1-0.pdf#page=30
[device-wire]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/device/wsdl/devicemgmt.wsdl#L3115-L3553
[event-wire]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/events/wsdl/event.wsdl#L472-L749
[access-wire]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/pacs/accesscontrol.wsdl#L43-L332
[authorization-wire]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/pacs/accesscontrol.wsdl#L1148-L1179
[door-wire]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/pacs/doorcontrol.wsdl#L43-L374
[door-state]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/pacs/doorcontrol.wsdl#L262-L442
[door-behavior]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/pacs/doorcontrol.wsdl#L1451-L1585
[credential-wire]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/credential/wsdl/credential.wsdl#L39-L521
[schedule-wire]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/schedule/wsdl/schedule.wsdl#L40-L218
[schedule-state]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/schedule/wsdl/schedule.wsdl#L130-L137
[access-policy]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/accessrules/wsdl/accessrules.wsdl#L111-L146
[pacs-wire]: https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/pacs/types.xsd#L34-L61
