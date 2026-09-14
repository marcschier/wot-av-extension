# Proposed WoT audiovisual vocabulary: offers and workload inputs

## 1. Scope, glossary, and invariants

**Original design, v0.1 proposal, 14 September 2026.** `av:` means the unregistered example namespace `https://example.org/wot/av#`. These terms and constraints are proposals, not upstream requirements. **locators, credentials, protocol options, and native selectors belong in WoT forms/binding profiles, never Offer, Mode, or Need.** Media forms may project to extended xRegistry Endpoints without `message` or `messagegroups`.

| Term | Tight meaning |
|---|---|
| `MediaSource` | Thing representing a physical or logical media origin; not a URL, decoder, or retained artifact. |
| `Connector` | Thing representing the adapter through which a source is acquired or exposed, including native-camera access on its owning host. |
| `Processor` / `Controller` | Thing consuming media / Thing performing matching and admission. These types do not imply particular lifecycle operations. |
| `Offer` | Identified, discoverable collection of alternative complete Modes from one MediaSource. |
| `Mode` | One jointly valid operating tuple: form, simultaneous tracks, capture behavior, timing, and resource configuration. |
| `VideoTrack` / `AudioTrack` | Identified constituent of that tuple, with its actual offered representation and timestamp mappings. |
| `Need` / `InputRequirement` | Workload contract / one named logical input, possibly carrying several required or optional tracks. A Need can contain several inputs. |
| `Assignment` | Accepted input-to-source/plan selection, **not a WoT protocol binding**; its representation belongs to the lifecycle vocabulary. |

`AssignmentStatus`, `MediaAsset`, `InferenceModel`, `ResultContract`, and `ProcessingRun` remain external boundaries: only model/preprocessing/result references are defined here, not schemas, storage, execution, or state machines.

Keep five views distinct: **advertised Mode; requested application contract; negotiated wire representation; observed decoded output; model tensor contract**. An advertised H.264 mode does not assert BGR output. A request for BGR8 1280x720 does not request sensor resizing. A model's RGB 640x640 letterbox preprocessing does not change the requested OpenCV image contract. OpenCV's codec, conversion, and property APIs justify these distinctions [S3, S4].


## 2. Property catalog

Names are `av:` terms. `IRI` is an identifier/reference, not another access locator. Cardinalities apply per subject and **each** grouped name; `0..1` means optional, not zero. Numbers are finite; counts are integers.

### 2.1 Structure, placement, and forms

| Property | Domain -> range | Cardinality; unit / meaning |
|---|---|---|
| `connector` | MediaSource -> Connector IRI | 0..1; required for this profile's native-camera sources. |
| `host`, `backend` | Connector -> IRI | 1 each; host identity and qualified acquisition-backend identity, not a device index. |
| `source`, `modes` | Offer -> MediaSource IRI, Mode | 1, 1..*; identified alternatives, never independent capability axes. |
| `kind`, `form`, `tracks` | Mode -> enum, Form reference, Track | 1, 1, 1..*; `Live`, `Still`, or `Clip`. One form supplies the complete advertised track set. |
| `mediaDirection` | Form -> enum | 1 for media forms; `ToThing` or `FromThing`, relative to the **addressed Thing**. |
| `sessionInitiation` | Form -> enum | 0..1; `PeerInitiated`, `ThingInitiated`, `Either`; independent of media direction. |
| `locality`, `host`, `accessProfile` | Form -> enum, IRI, IRI | 1, 0..1, 1; `HostLocal` requires host; `Network` still requires reachability. Binding profile owns selectors/options. |
| `captureBehavior`, `trigger` | Mode -> enum | 1 each; `Continuous`, `SingleCapture`, `FiniteBurst`, `Playback`; `FreeRun`, `Software`, `ExternalLine`, `NotApplicable`. |
| `captureOwner`, `triggerOwner`, `captureControl` | Mode -> Thing IRI, Thing IRI, Form reference | 0..1 each; explicit authority assertions; control form is conditional on controllable acquisition. |
| `resourceUses` | Mode -> ResourceUse | 1..*; every shared acquisition/configuration resource involved. |
| `resource`, `configuration`, `sharing` | ResourceUse -> IRI, IRI, enum | 1 each; `Exclusive` or `SameConfiguration`; identical configuration IDs denote the same complete resource state. |
| `processor`, `inputs`, `groups`, `preferences` | Need -> Processor IRI, InputRequirement, InputGroup, Preference | 1, 1..*, 0..*, 0..*; preferences are ordered. |
| `model`, `allowedPreprocessing`, `resultContracts` | Need -> external IRIs | 0..1, 0..*, 0..*; exact model/preprocessing/result-contract references only. |

Pull consumes an offered `FromThing` source form. Push additionally selects `InputContract.sinkForm`, a `ToThing` form on the Processor. Both can involve peer-initiated connections. Neither `read()`, SRT caller/listener, HTTP request direction, nor RTP packet direction substitutes for this distinction. Matching must establish transport compatibility, not merely opposite arrows.

Still describes media shape, not a fresh exposure: a snapshot may return the latest continuously acquired frame [S2]. Observe permits no trigger/configuration changes; RequestCapture needs an authorized captureControl; ConfigureAndCapture additionally needs authority over the exact selected configuration.

### 2.2 Tracks and representations

| Property | Domain -> range | Cardinality; unit / meaning |
|---|---|---|
| `trackId`, `representation`, `clocks` | Track -> string, Representation, TimestampMapping | 1, 1, 0..*; track ID scoped to Mode; not an RTP SSRC or backend stream ordinal. |
| Representation type | Representation -> class | Exactly one: `EncodedVideo`, `RawVideo`, `EncodedAudio`, `PCM`. |
| `codec`, `codecProfile`, `codecLevel` | Encoded representation -> enum, string, string | 1, 0..1, 0..1; codec identity/profile/level constrain decoding independently of application pixels. |
| `width`, `height` | Video representation -> positive integer | 1 each; pixels; display geometry, not maxima. |
| `pixelFormat`, `bufferLayout` | RawVideo -> enum, enum | 1 each; `BGR8`, `RGB8`, `Mono8`, `YUV420P`; `Contiguous` or `Strided`. Pixel term fixes component order/packing. |
| `cadence`, `frameRate` | Video representation -> enum, Rational | 0..1 each; `Constant`, `Variable`, `Triggered`; Constant requires exact frames/second. Still forbids both. |
| `sampleRateHz`, `channels`, `channelLayout` | Audio representation -> positive integer, positive integer, enum | 1 each; samples/second/**channel**; `Mono` requires 1 channel, `StereoLR` requires 2 in left-right order. |
| `sampleFormat`, `bufferLayout` | PCM -> enum, enum | 1 each; `S16LE` or `F32LE`; `Interleaved` or `Planar`. |
| `basis`, `domain`, `timeBase`, `quality` | TimestampMapping -> enum, IRI, Rational, enum | 1 each; `CaptureTime`, `PresentationTime`, `ReceiptTime`; seconds/tick; `Unmapped` or `BoundedMapping`. |
| `referenceDomain`, `mappingProfile`, `uncertaintyMs` | TimestampMapping -> IRI, IRI, nonnegative number | Required for BoundedMapping; profile supplies qualified mapping records; uncertainty is a bound, not a protocol label. |
| `duration`, `timeline`, `seekAccess` | Clip Mode -> Rational, IRI, enum | 1 each; seconds; `SequentialOnly`, `Restartable`, `KeyframeIndexed`. No implied frame-exact seeking. |

`Rational` has integer `n` and positive integer `d`, normalized by their greatest common divisor; rate/time-base numerators must be positive. Compare ratios by exact cross-multiplication. `30000/1001` is not 30. Variable cadence may report a nominal rate only through a future informational property; it cannot masquerade as Constant.

The initial codec values are `H264`, `JPEG`, and `AAC`; raw pixel and PCM identifiers above are separate controlled families. Codec profile/level absence is unknown and cannot satisfy a backend requiring those facts. Native PFNC formats need an explicit mapping profile; matching never equates formats by similar spelling [S7].

## 3. Closed, typed requirement semantics

| Property | Domain -> range | Cardinality; meaning |
|---|---|---|
| `name`, `presence`, `alternatives` | InputRequirement -> string, enum, InputContract | 1, 1, 1..*; unique input name; `Required` or `Optional`; complete permitted alternatives. |
| `source`, `kind`, `sinkForm` | InputContract -> source IRI, enum, Form reference | 0..1, 1, 0..1; source omission permits discovery. |
| `allowedHosts`, `allowedBackends` | InputContract -> IRI sets | 0..*; hard placement/runtime allowlists. |
| `wireTracks`, `deliveredTracks` | InputContract -> TrackRequirement | 0..*, 1..*; optional additional wire filters versus application-output requirements. |
| `name`, `presence`, `representationKind`, `trackId` | TrackRequirement -> string, enum, enum, string | 1, 1, 1, 0..1; VideoRequirement or AudioRequirement; optional source track selector. |
| `widthRange`, `heightRange`, `channelsRange`, `sampleRateRangeHz` | TrackRequirement -> IntRange | 0..1 each; respective pixel/channel/Hz bounds. |
| `frameRateRange`, `cadences` | VideoRequirement -> RationalRange, enum set | 0..1, 0..*; evaluated at its wire/delivery boundary, not assumed from source FPS. |
| `codecs`, `pixelFormats`, `sampleFormats`, `channelLayouts`, `bufferLayouts` | TrackRequirement -> enum sets | 0..* each; only applicable families allowed for selected representation kind. |
| `transformPermissions`, `captureIntent` | InputContract -> enum set, enum | 0..*, 1; allowed transforms; `Observe`, `RequestCapture`, `ConfigureAndCapture`. |
| `resizePolicies` | InputContract -> enum set | 0..*; `Stretch`, `Crop`, `Letterbox`; nonempty exactly when Resize is permitted. |
| `members`, `sync` | InputGroup -> InputRequirement IRIs, SkewConstraint | 2..*, 0..1; all-or-none membership; optional synchronization. |
| `input`, `goal` | TrackPreference -> input IRI, TrackRequirement | 1 each; goal names a delivered track and uses the same typed constraints. |
| `input`, `backend` / `source` | BackendPreference / SourcePreference -> IRIs | 1 each; prefer an exact backend/source identity. |

**Evaluation is bounded, not a DSL.** IntRange has inclusive integer `min`/`max`, at least one present, with `min <= max`; RationalRange substitutes Rational bounds. Equality uses identical bounds. Sets mean membership; alternatives OR; properties within one contract AND. No scripts, coercions, regexes, inferred units, or cross-property arithmetic. Geometry/rate alternatives remain separate contracts.

Each required input must match one complete alternative. Its required tracks must reach the application through that **same candidate path and jointly feasible Mode**; source-wide `hasAudio` is insufficient. Optional inputs/tracks may be explicitly omitted; if included, their constraints remain hard. Track names are unique within a contract. Groups are indivisible: any required member makes all required; otherwise admit all or none. v0.1 groups are disjoint; synchronization covers every included track/member.

Rank hard-feasible plans by Need.preferences as lexicographic Boolean vectors, true before false. Omitted-track goals are false. No weighted sum compensates for hard violations. Stable input/source/mode/plan identifiers break ties; alternatives have no array-order priority.

**Absence rules:** omitted offered facts are unknown, never unsupported/zero. An explicitly complete Mode.tracks enumeration with no audio proves absence for that Mode only. Missing required structural fields invalidate a document. An omitted requirement bound imposes no constraint; empty selection allowlists are invalid, not wildcards. `null`, NaN, sentinel zero frame rates, and unrecognized required enum/profile values are invalid or unsupported. Omitted or explicitly empty transform/preprocessing permissions mean **none permitted**. Unknown evidence cannot discharge a hard predicate, but merely makes a preference false.

`Decode`, `ColorConvert`, `Resize`, `ResampleAudio`, `RemixAudio`, `TemporalSubsample`, `DuplicateFrames`, and `PrerollDecode` are distinct permissions. Qualified plans must match allowed operations, resizePolicies, and output constraints. Queue drops are governed separately, not disguised as TemporalSubsample. No synthetic audio, hidden resampling, or permissions inferred from models. Exact `allowedPreprocessing` references authorize model preprocessing separately.

## 4. Time selectors, age, synchronization, and queues

| Property | Domain -> range | Cardinality; meaning |
|---|---|---|
| `selector` | Clip InputContract -> TimeSelector | 1; finite selection, not frame-number arithmetic. |
| `timeline`, `start`, `end`, `boundary`, `toleranceMs` | TimeSelector -> IRI, Rational, Rational, enum, nonnegative number | 1, 1, 1, 1, 0..1; seconds; `ExactSamples` or `CoveringInterval`; tolerance required for CoveringInterval. |
| `maxAge`, `maxSkew` | InputContract -> AgeConstraint, SkewConstraint | 0..1 each; track-age and within-input synchronization requirements. |
| `basis`, `boundary`, `maxMs` | AgeConstraint -> enum, enum, nonnegative number | 1 each; time basis; `ApplicationIngress` or `InferenceStart`; milliseconds. |
| `basis`, `maxMs` | SkewConstraint -> time-basis enum, nonnegative number | 1 each; milliseconds after proven common-domain mapping. |
| `queuePolicies` | InputContract -> QueuePolicy | 0..*; hard per-stage constraints, never a global drop switch. |
| `stage`, `capacity`, `unit`, `overflow` | QueuePolicy -> enum, positive integer, enum, enum | 1 each; `CaptureIngress`, `EncodedBranch`, `DecodedDelivery`, `ModelInput`; `Frame`, `Bundle`, `Packet`, `Byte`; `DropOldest`, `DropNewest`, `BlockUpstream`, `Fail`. |
| `maxResidenceMs`, `coverage`, `gapResponse` | QueuePolicy -> nonnegative number, enum, enum | 0..1, 1, 0..1; `BestEffort` or `NoIntentionalDrop`; latter requires `Fail` or `Report`. |

Selectors use `[start,end)`, `0 <= start < end <= duration`, in the clip timeline. ExactSamples selects decoded samples with PTS in that interval, including individual audio samples. CoveringInterval permits bounded extra media, not internal omissions. Keyframe seek plus permitted preroll decoding/discard can implement exact selection; keyframe-only remux may not. VFR requires timestamps, not `frameIndex/FPS` [S5]. Finite indexers request Clip, a selector, and explicit coverage.

CaptureTime means exposure midpoint/audio first-sample time; PresentationTime means PTS, not UTC. A mappingProfile must yield incarnation-specific affine records `referenceSeconds = ticks*n/d + offsetSeconds`, bounded uncertainty, and valid tick intervals; resets/wraps require new records, never extrapolation. Actual records belong to negotiated/observed state.

For each delivery Bundle, require worst-case age `delivery-sample+uDelivery+uSample <= maxMs` and every pair's skew `abs(t1-t2)+u1+u2 <= maxMs`, after common-domain conversion, with units converted to milliseconds. Compare video time to the first audio sample in its associated block, not arbitrary dequeued buffers. Unmapped clocks fail cross-domain constraints; RTCP mapping alone does not prove exposure time; NTP/PTP labels are not accuracy bounds [S6].

A qualified plan discloses bounded policies for **every** queue. Stages are unique public boundaries; internal buffers also require qualification. NoIntentionalDrop prohibits planned discards from that stage through application delivery, not sensor/network loss. GapResponse Report marks incomplete coverage, never complete success. BlockUpstream needs a pausable upstream or sufficient bounded spool; it cannot throttle a free-running sensor by declaration. Separate inference/recording branches may use different policies; a shared dropping stage before their split violates the recording obligation.

## 5. Explicit matching algorithm and rejection reasons

1. Validate structure, controlled values, unique names/IDs, complete mode tuples, group disjointness, and permission semantics. Resolve referenced forms/profiles and authorized discovery candidates.
2. Enumerate each input's complete alternatives against individual Modes. Check kind, source, form direction, reachable placement/backend, track selection, capture intent/ownership, and clip bounds.
3. Enumerate a **finite catalog of qualified adapter plans**, with declared wire/decoded signatures, supported audio, permitted transforms, time mapping, queue bounds, and resource costs. Do not synthesize arbitrary pipelines.
4. Evaluate all hard wire/delivery, temporal, selector, transformation, and queue predicates. Missing qualification is a failure to establish feasibility, not a default success.
5. Solve all inputs/groups jointly against existing allocations and capacities supplied by the ownership layer. SameConfiguration sharing requires identical resource configurations; Exclusive conflicts. Check group synchronization and branch isolation.
6. Rank only surviving complete combinations by the Boolean preference vector and stable tie-break. Return selected input/offer/mode/form/track/plan identities, explicit optional omissions, and obligations for later negotiation/observation; lifecycle handling is external.

Reject with a path, candidate identity, required value, actual value/evidence, and one stable code: `InvalidContract`, `UnknownRequiredFact`, `UnsupportedProfile`, `NoJointMode`, `MissingTrack`, `BackendTrackUnsupported`, `UnreachablePlacement`, `CaptureAuthorityRequired`, `SharedConfigurationConflict`, `CapacityExceeded`, `TransformForbidden`, `ClockUnqualified`, `AgeBudgetUnproven`, `SkewBudgetUnproven`, `RangeUnavailable`, `SeekSemanticsUnsupported`, or `QueuePolicyConflict`. A no-match response preserves per-candidate reasons; a preferred backend cannot conceal the hard rejection.

## 6. Complete illustrative Offer and Need JSON-LD

These complete domain examples are **not TDs**. Symbolic forms reference external core forms; annotations add no `href` or invented operation. Foundation research owns core form identity/conformance. Host/backend/clock claims are hypothetical, not measured. The source form addresses camera7. JSON alone does not prove budget satisfaction.

```json
{
  "@context": {"av": "https://example.org/wot/av#", "@vocab": "https://example.org/wot/av#"},
  "@graph": [
    {
      "@id": "urn:example:camera7", "@type": "MediaSource",
      "connector": {"@id": "urn:example:connector7"}
    },
    {
      "@id": "urn:example:connector7", "@type": "Connector",
      "host": {"@id": "urn:example:host:edge1"},
      "backend": {"@id": "urn:example:backend:onvif-rtsp-gateway:v1"}
    },
    {
      "@id": "urn:example:form:camera7-play",
      "mediaDirection": {"@id": "av:FromThing"},
      "sessionInitiation": {"@id": "av:PeerInitiated"},
      "locality": {"@id": "av:Network"},
      "accessProfile": {"@id": "urn:example:profile:rtsp-av:v1"}
    },
    {
      "@id": "urn:example:camera7:inspection", "@type": "Offer",
      "source": {"@id": "urn:example:camera7"},
      "modes": [{
        "@id": "urn:example:camera7:av720p30", "@type": "Mode",
        "kind": {"@id": "av:Live"},
        "form": {"@id": "urn:example:form:camera7-play"},
        "captureBehavior": {"@id": "av:Continuous"},
        "trigger": {"@id": "av:FreeRun"},
        "captureOwner": {"@id": "urn:example:connector7"},
        "triggerOwner": {"@id": "urn:example:connector7"},
        "resourceUses": [{
          "@type": "ResourceUse",
          "resource": {"@id": "urn:example:resource:camera7-acquisition"},
          "configuration": {"@id": "urn:example:config:camera7-av720p30"},
          "sharing": {"@id": "av:SameConfiguration"}
        }],
        "tracks": [
          {
            "@id": "urn:example:camera7:av720p30:v0", "@type": "VideoTrack",
            "trackId": "v0",
            "representation": {
              "@type": "EncodedVideo", "codec": {"@id": "av:H264"},
              "codecProfile": "High", "codecLevel": "3.1",
              "width": 1280, "height": 720,
              "cadence": {"@id": "av:Constant"}, "frameRate": {"n": 30, "d": 1}
            },
            "clocks": [
              {
                "basis": {"@id": "av:CaptureTime"},
                "domain": {"@id": "urn:example:clock:camera7-capture"},
                "timeBase": {"n": 1, "d": 90000},
                "quality": {"@id": "av:BoundedMapping"},
                "referenceDomain": {"@id": "urn:example:clock:utc"},
                "mappingProfile": {"@id": "urn:example:timing:capture-to-utc:v1"},
                "uncertaintyMs": 3
              },
              {
                "basis": {"@id": "av:PresentationTime"},
                "domain": {"@id": "urn:example:clock:camera7-pts"},
                "timeBase": {"n": 1, "d": 90000},
                "quality": {"@id": "av:BoundedMapping"},
                "referenceDomain": {"@id": "urn:example:clock:camera7-av"},
                "mappingProfile": {"@id": "urn:example:timing:pts-to-av:v1"},
                "uncertaintyMs": 2
              }
            ]
          },
          {
            "@id": "urn:example:camera7:av720p30:a0", "@type": "AudioTrack",
            "trackId": "a0",
            "representation": {
              "@type": "EncodedAudio", "codec": {"@id": "av:AAC"},
              "codecProfile": "LC", "sampleRateHz": 48000,
              "channels": 1, "channelLayout": {"@id": "av:Mono"}
            },
            "clocks": [
              {
                "basis": {"@id": "av:CaptureTime"},
                "domain": {"@id": "urn:example:clock:camera7-audio"},
                "timeBase": {"n": 1, "d": 48000},
                "quality": {"@id": "av:BoundedMapping"},
                "referenceDomain": {"@id": "urn:example:clock:utc"},
                "mappingProfile": {"@id": "urn:example:timing:capture-to-utc:v1"},
                "uncertaintyMs": 3
              },
              {
                "basis": {"@id": "av:PresentationTime"},
                "domain": {"@id": "urn:example:clock:camera7-audio-pts"},
                "timeBase": {"n": 1, "d": 48000},
                "quality": {"@id": "av:BoundedMapping"},
                "referenceDomain": {"@id": "urn:example:clock:camera7-av"},
                "mappingProfile": {"@id": "urn:example:timing:pts-to-av:v1"},
                "uncertaintyMs": 2
              }
            ]
          }
        ]
      }]
    }
  ]
}
```

```json
{
  "@context": {"av": "https://example.org/wot/av#", "@vocab": "https://example.org/wot/av#"},
  "@id": "urn:example:need:opencv7", "@type": "Need",
  "processor": {"@id": "urn:example:processor:opencv7"},
  "model": {"@id": "urn:example:model:detector:v3"},
  "allowedPreprocessing": [{"@id": "urn:example:preprocess:rgb640-letterbox:v1"}],
  "resultContracts": [{"@id": "urn:example:result-contract:detections:v1"}],
  "inputs": [{
    "@id": "urn:example:need:opencv7:inspection", "@type": "InputRequirement",
    "name": "inspection", "presence": {"@id": "av:Required"},
    "alternatives": [{
      "@type": "InputContract",
      "source": {"@id": "urn:example:camera7"},
      "kind": {"@id": "av:Live"},
      "allowedHosts": [{"@id": "urn:example:host:edge1"}],
      "allowedBackends": [
        {"@id": "urn:example:backend:opencv-gstreamer-av:v1"},
        {"@id": "urn:example:backend:opencv-ffmpeg-video:v1"}
      ],
      "captureIntent": {"@id": "av:Observe"},
      "transformPermissions": [{"@id": "av:Decode"}, {"@id": "av:ColorConvert"}],
      "deliveredTracks": [
        {
          "@type": "VideoRequirement", "name": "picture",
          "presence": {"@id": "av:Required"}, "trackId": "v0",
          "representationKind": {"@id": "av:RawVideo"},
          "pixelFormats": [{"@id": "av:BGR8"}],
          "bufferLayouts": [{"@id": "av:Contiguous"}],
          "widthRange": {"min": 1280, "max": 1280},
          "heightRange": {"min": 720, "max": 720}
        },
        {
          "@type": "AudioRequirement", "name": "sound",
          "presence": {"@id": "av:Optional"}, "trackId": "a0",
          "representationKind": {"@id": "av:PCM"},
          "sampleFormats": [{"@id": "av:S16LE"}],
          "bufferLayouts": [{"@id": "av:Interleaved"}],
          "sampleRateRangeHz": {"min": 48000, "max": 48000},
          "channelsRange": {"min": 1, "max": 1},
          "channelLayouts": [{"@id": "av:Mono"}]
        }
      ],
      "maxAge": {
        "basis": {"@id": "av:CaptureTime"},
        "boundary": {"@id": "av:ApplicationIngress"}, "maxMs": 250
      },
      "maxSkew": {"basis": {"@id": "av:PresentationTime"}, "maxMs": 40},
      "queuePolicies": [{
        "stage": {"@id": "av:DecodedDelivery"},
        "capacity": 1, "unit": {"@id": "av:Bundle"},
        "overflow": {"@id": "av:DropOldest"}, "maxResidenceMs": 100,
        "coverage": {"@id": "av:BestEffort"}
      }]
    }]
  }],
  "preferences": {"@list": [{
    "@type": "TrackPreference",
    "input": {"@id": "urn:example:need:opencv7:inspection"},
    "goal": {
      "@type": "AudioRequirement", "name": "sound",
      "presence": {"@id": "av:Required"},
      "representationKind": {"@id": "av:PCM"},
      "sampleRateRangeHz": {"min": 48000, "max": 48000}
    }
  }]}
}
```

The application receives contiguous uint8 BGR HWC `[720,1280,3]`, without a constant **delivered** FPS requirement. The referenced preprocessing profile denotes RGB float32 NCHW `[1,3,640,640]`: resize to 640x360, zero-pad 140 pixels above/below, divide by 255. Resolve that exact external profile; never infer it. Model/message details remain behind external contracts. Making sound Required changes admission, not decoder capability.

## 7. Three adversarial cases

**Shared-source conflict.** Suppose camera7 also offers 1920x1080 at 25 beside its 1280x720-at-30 Mode. Inference uses 720p; an archive Need requests 1080p with no resize permission. Same acquisition resource, unequal configuration: `SharedConfigurationConflict`, regardless of archive priority. If both accept 720p, separate encoded archive and latest-decoded inference branches can coexist only when upstream queues/resource budgets support both. A global drop-oldest queue fails archive NoIntentionalDrop.

**VFR clip and seeking.** A 12-second VFR clip advertises KeyframeIndexed access; the Need selects `[2.1,4.2)` ExactSamples. Reported average FPS 29.97 cannot establish endpoints or a frame count. Accept only a qualified timestamp-preserving decode plan with PrerollDecode and sample-accurate audio trimming; otherwise `SeekSemanticsUnsupported`. A CoveringInterval alternative with 500-ms tolerance is a real allowed relaxation, not an implicit fallback. Processing faster than real time does not alter media cadence.

**Required audio.** The sample A/V Mode has AAC mono 48 kHz. A video-only OpenCV FFmpeg capture plan still cannot deliver required PCM audio: `BackendTrackUnsupported`, not successful video with missing sound. A qualified GStreamer A/V plan may match, but the reviewed implementation supports only its first audio stream and must prove timing/layout. Optional sound can be omitted explicitly, scoring false on the audio preference. A microphone input instead requires another named input and an all-or-none synchronized InputGroup; source-wide audio presence is insufficient [S4].

## 8. Minimal v0.1 and explicit extension points

Ship the glossary, closed typed constraints, complete enumerated Modes, finite qualified-plan matching, multi-input groups, timestamped finite selectors, and per-stage policies. Start with 2-D mono/stereo A/V, RTSP A/V and HTTP JPEG/clip profiles, and **specific qualified** host-local UVC or native industrial-camera connectors. Discovery filters on Thing type/source kind/backend/profile find candidates, not guaranteed matches.

Named extension points are `NativeAcquisitionProfile` (GenTL/SFNC/PFNC/vendor feature and trigger mappings), `TransportProfile` (SRT, HLS, WebRTC and additional form bindings), `TimingProfile` (exposure, rolling shutter, clock mapping), `TransformProfile` (additional codecs, demosaic, GPU layouts), and `SelectorProfile` (growing/DVR windows). Tensor preprocessing is an external named profile referenced by permission, not specified here.

GigE Vision and USB3 Vision require appropriate native transport/runtime/control support; USB UVC uses a different driver/API model. GenICam is a family of feature/format/transport-interface standards, not a universal streaming URL [S7]. SRT caller/listener/rendezvous, HLS segment timelines, and WebRTC negotiated codecs/signaling each require qualified form profiles; listing their names promises no implementation. Unknown mandatory profiles reject matching. Parametric mode families, arbitrary channel maps, variable-resolution streams, and multi-form atomic offers are deferred rather than approximated by independent maxima.

## 9. Primary-source mechanisms and limits

The sources below establish mechanisms, **not this original vocabulary**.

- **[S1] WoT extension mechanism:** [w3c/wot-thing-description:index.html:5028-5048](https://github.com/w3c/wot-thing-description/blob/7c0b968f403ecdb9594bd882cafbacf544c41fc0/index.html#L5028-L5048), [5071-5090](https://github.com/w3c/wot-thing-description/blob/7c0b968f403ecdb9594bd882cafbacf544c41fc0/index.html#L5071-L5090), REC1.1 pin; additional namespaces/types/properties. [TD 1.1 section 5.3.4.2, Form](https://www.w3.org/TR/wot-thing-description11/#form) owns access hypermedia.
- **[S2] ONVIF configuration coupling:** [onvif/specs:doc/Media.xml:1639-1640](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Media.xml#L1639-L1640), [1842-1843](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Media.xml#L1842-L1843), shared configuration UseCount; [1947-1948](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Media.xml#L1947-L1948), [1989-1990](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Media.xml#L1989-L1990), profile/configuration-scoped option combinations and permitted quality/rate adaptation; [3501-3502](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Media.xml#L3501-L3502), [3614-3616](https://github.com/onvif/specs/blob/bf3ea360e20247d68c2ae0e9c9a715a948f79d78/doc/Media.xml#L3614-L3616), distinct stream/snapshot URI mechanisms. Complete tuple enumeration is our conservative design, not a claim ONVIF forbids its scoped parameter combinations.
- **[S3] OpenCV representation/property caveats:** [opencv/opencv:modules/videoio/include/opencv2/videoio.hpp:147-160](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L147-L160), [996-1021](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L996-L1021). Setter success and reported values do not prove delivery.
- **[S4] Backend audio boundary:** [opencv/opencv:modules/videoio/src/cap_ffmpeg_impl.hpp:1671-1683](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_ffmpeg_impl.hpp#L1671-L1683), skips nonselected-video packets; [modules/videoio/src/cap_gstreamer.cpp:1382-1385](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_gstreamer.cpp#L1382-L1385), first audio stream only; [modules/videoio/include/opencv2/videoio.hpp:196-209](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/include/opencv2/videoio.hpp#L196-L209), backend/open-time/audio controls.
- **[S5] FPS estimates and seek:** [opencv/opencv:modules/videoio/src/cap_ffmpeg_impl.hpp:2186-2218](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_ffmpeg_impl.hpp#L2186-L2218), [2275-2302](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_ffmpeg_impl.hpp#L2275-L2302); not proof of frame-exact VFR extraction.
- **[S6] Clock mechanism:** [RFC 3550 sections 5.1 and 6.4.1](https://www.rfc-editor.org/rfc/rfc3550.html#section-6.4.1), RTP timestamp domains and RTCP sender-report NTP/RTP pairing; the exposure/uncertainty requirements here are additional.
- **[S7] Native/host boundary:** [EMVA GenICam introduction, GenApi/SFNC/PFNC/GenTL sections](https://www.emva.org/standards-technology/genicam/introduction-new/); [Microsoft UVC driver overview](https://learn.microsoft.com/en-us/windows-hardware/drivers/stream/usb-video-class-driver-overview); [opencv/opencv:modules/videoio/src/cap_msmf.cpp:722-744](https://github.com/opencv/opencv/blob/fe38fc608f6acb8b68953438a62305d8318f4fcd/modules/videoio/src/cap_msmf.cpp#L722-L744), host-enumerated index; [AravisProject/aravis:src/arvgvdevice.c:1874-1878](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvgvdevice.c#L1874-L1878), [2049-2059](https://github.com/AravisProject/aravis/blob/97ff5e330919d7a44b871df4eda669feeafdf342/src/arvgvdevice.c#L2049-L2059), control privilege/acquisition behavior.
