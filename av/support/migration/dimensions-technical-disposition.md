# AV-D09 image dimensions: technical disposition

**Selected local draft technical resolution, 16 September 2026.** AV-D09 has
no remaining technical choice in processing edition
`2026-09-16-clarifications`. This is an original project-draft decision, not
a named independent/domain review, ONVIF erratum, W3C approval, license grant,
or formal release authorization. Editor/reviewer identities remain unassigned.
The normative contract is [AV-IMAGE-GRID and AV-IMAGE-GRID-EDITION](../../spec.md#image-geometry);
this record explains their provenance and compatibility scope.

## Verified prior contract

The original repository revision is
`1a9216897254fb132ce55065287bcbdd933adf37`. Its `vocabulary/terms.json` has Git
blob `41fa29e947ac8905347c45bbb93e7249a613656f` and SHA-256
`3908db18802c2d1e49ae21f4edbff916fa2754277b83581435946c0bc70ee4db`.
It was read directly with `git show`; neither that object nor a historical
copy was edited.

- Width said **"Actual display/image width, not a sensor maximum, stride or
  tensor dimension."** Height said **"Actual display/image height, not sensor
  maximum or tensor height."** The integer range, minimum one, pixel unit,
  video requiredness and audio prohibition were already explicit.
  Source: `marcschier/wot-av-extension:vocabulary/terms.json:696-753` at
  [the original commit](https://github.com/marcschier/wot-av-extension/blob/1a9216897254fb132ce55065287bcbdd933adf37/vocabulary/terms.json#L696-L753).
- The original root called these **actual image dimensions in pixels**,
  disallowed a sensor-maximum/resize fallback, and described JPEG geometry as
  a publisher-supplied fact about the example output. It did not specify the
  crop/rotation/display pipeline.
  Source: `marcschier/wot-av-extension:spec.md:129-131` and `:180-184` at
  [the original commit](https://github.com/marcschier/wot-av-extension/blob/1a9216897254fb132ce55065287bcbdd933adf37/spec.md#L129-L184).

Thus "display/image" was ambiguous, not a verified display-only contract.
The retained source/live/clip example Track facts remain respectively
1280 by 720, 1280 by 720, and 1920 by 1080, with their original identities.
The demonstrated compatibility cohort is those ordinary raster examples
under the unrotated, no-display-rescale interpretation. Their fictional
descriptions do not establish camera behavior, absence of orientation in
arbitrary media, or the meaning of any third-party deployment.

## Chosen meaning and why

Width counts active raster columns and height counts active raster rows at
the described interface. Encoded media uses the decoded grid remaining after
codec-mandated conformance crop, excluding coded padding, before presentation rotation, mirroring, pixel
aspect scaling, preview resize, or application crop. Raw media describes the
logical pixel grid actually exposed, not stride or a parent sensor/tensor.
An actual producer-side transform that creates the described output changes
that output's grid; a pending presentation instruction on unchanged bytes
does not. Neither count supplies coordinates, orientation, ROI origins,
buffer offsets, allocation, or a camera-write instruction.

This chooses the original root's image-dimension reading and the existing
native-interface ownership boundary. Retaining the proposed public term
meaning within this explicit processing edition is preferable to introducing
an unnecessary `0.3` namespace migration. The release remains `0.2-proposed`,
the namespace remains `https://example.org/wot/av/0.2#`, and the context remains
`https://example.org/wot/av/context/v0.2`. They remain unregistered/unhosted.
No new AV field, decoder, binding, or implicit transform is introduced.

The normative migration procedure distinguishes four cases:

| Earlier description | Disposition for this processing edition |
| --- | --- |
| Known active-raster facts | Retain those values and identify the processing edition in the scoped conformance/description revision. |
| Known display, preview, or coded-padding facts | Re-establish the actual raster through the selected native interface, correct and explicitly revise the description, and reevaluate affected Needs. Do not relabel the old facts as equivalent. |
| Unknown or ambiguous earlier meaning/grid | Withhold or withdraw the concrete video Mode until the facts are established. The native TD can remain available. Do not guess, swap values, multiply by a display ratio, or fill from a sensor maximum. |
| Incompatible deployed contract whose consumers cannot migrate together | Preserve its identified legacy contract rather than claim this edition. A genuinely different public semantic contract needs its own explicit term/edition identity disposition before use; this local draft does not silently redefine that deployment or authorize a replacement IRI. |

Metadata-only validation cannot discover whether plausible integers describe
a real raster or a mislabeled display. It preserves declared facts and
evaluates contracts; truthful publication remains the publisher's obligation.
The migration procedure is not a decoder hidden in the normalizer.

## Public source checks and their limits

The following sources informed the distinction; they do not become new
mandatory AV dependencies or authorize a universal native-field alias.

| Verified primary source | Relevant fact and boundary |
| --- | --- |
| `onvif/specs:wsdl/ver10/schema/onvif.xsd:765-777` and `:1123-1136`, commit `68ee1b540a40f848c9599eba2c55b87547c588d6` ([VideoResolution](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/schema/onvif.xsd#L765-L777), [VideoResolution2](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/schema/onvif.xsd#L1123-L1136)) | Native Width/Height refer to image columns/lines but explicitly reverse that interpretation for 90-degree rotation. A publisher must establish the actual output raster and the native processing stage; blindly copying identically named members is not generally sound. |
| `onvif/specs:wsdl/ver10/schema/onvif.xsd:40-48`, `:359-397`, `:414-435` at the same commit ([bounds and rotation](https://github.com/onvif/specs/blob/68ee1b540a40f848c9599eba2c55b87547c588d6/wsdl/ver10/schema/onvif.xsd#L359-L435)) | Capture bounds carry their own origin/extent; rotation has its own native configuration semantics. AV dimensions neither inherit those coordinates nor authorize those controls. The protected vendored source was read, not changed. |
| `w3c/webcodecs:index.src.html:3721-3790`, commit `725a39c559d69298d6cc16e2dfd49bf752d1c2a2` ([VideoFrame attributes](https://github.com/w3c/webcodecs/blob/725a39c559d69298d6cc16e2dfd49bf752d1c2a2/index.src.html#L3721-L3790)) | Coded extent can contain invisible padding, visibleRect identifies a pixel rectangle, rotation/flip are rendering instructions, and display dimensions include presentation adjustments. These are distinct facts, not synonyms for AV width/height. |
| `w3c/webcodecs:index.src.html:4107-4118`, `:4244-4257` at the same commit ([visible-rectangle initialization](https://github.com/w3c/webcodecs/blob/725a39c559d69298d6cc16e2dfd49bf752d1c2a2/index.src.html#L4107-L4118)) | A caller can override a VideoFrame visible rectangle. Even visibleRect is not a universal AV projection: the publisher must distinguish intrinsic codec crop from a later application view. |

The fetched WebCodecs source identity was Git blob
`278141c8bd57bc1388e4f45e64a79d4ef2cb1c75`, SHA-256
`49f71d2b61e0f3dfaf25b15f8bbc9682daee102606ebcbe537e2c0a52870d915`.
Only these public sources and this repository's original/current draft
material were used; no private framework source was consulted.

## Focused executable evidence

`av/tools/tests/test_specification.py` contains `ImageGridContractTests`.
The source facts are independently stipulated metadata vectors, not values
generated from the term inventory or measurements inferred from a match.
Each complete comparison value is checked against a literal expected value;
alternative display/storage/parent dimensions must not match that contract.
Native hints remain outside the comparison value, and input records remain
unchanged.

| Vector | Expected result / exact test |
| --- | --- |
| Retained ordinary JPEG raster | 1280 by 720; `test_ordinary_raster_example_keeps_its_dimensions` |
| JPEG 4000 by 3000 with EXIF orientation 6 | 4000 by 3000, not rotated display size; `test_exif_orientation_does_not_rotate_jpeg_descriptor` |
| Coded video 1920 by 1088, eight cropped bottom sample rows | 1920 by 1080; `test_codec_conformance_crop_excludes_padded_storage` |
| 720 by 576 samples, 16:15 pixel aspect, scaled preview | 720 by 576, not 768 by 576 or 384 by 288; `test_pixel_aspect_and_preview_do_not_rescale_descriptor` |
| 17 by 13 BGR8 with +56/-56 row stride | Grid unchanged; 51 active octets/row, 663 active octets, 723-octet minimal addressed span at stride magnitude 56; `test_strided_bgr_grid_is_independent_of_scan_direction` |
| Odd 17 by 13 YUV420P | Active planes 221/63/63, total 347 octets; no allocation/offset inference; `test_odd_yuv_grid_is_not_plane_or_allocation_geometry` |
| 640 by 480 output from ROI origin (320, 240) | Output extent only; `test_roi_origin_and_sensor_extent_are_not_image_dimensions` |
| Already-rotated producer output | 720 by 1280 raw output, not its earlier 1280 by 720 image; `test_materialized_rotation_describes_the_new_output_grid` |
| Unknown legacy grid and invented geometry/control fields | Missing required facts or undeclared AV properties are explicit description errors, never inferred values; `test_unknown_legacy_grid_is_not_filled_from_native_hints`, `test_dimensions_do_not_add_orientation_roi_or_control_fields` |

These tests exercise descriptor normalization, exact matching, noninterference
and invalid-description handling. They do not exercise JPEG/H.264 decoding,
camera rotation, native readback, hardware conformance, source truth, or a
general legacy-description detector.

## Remaining gates are not missing technical decisions

The current local technical edition has a selected dimension contract and
migration procedure. External domain/editorial review, first-party and
derivative rights, public hosting/registration, W3C/ONVIF process selection,
submission and formal publication authorization remain ungranted future
gates. No named reviewer or licensing authority is assigned here.

The final coordinator owns complete publication regeneration, hash resealing
and integrated validation after all owners finish. The dimension change
requires only AV core regeneration now; publication artifacts are not
silently declared current by this supporting record.
