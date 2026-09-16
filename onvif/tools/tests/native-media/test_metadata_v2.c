#include "metadata.h"
#include <gio/gio.h>
#include <string.h>

static const gchar empty[] =
    "<m:MetadataStream xmlns:m=\"http://www.onvif.org/ver10/schema\"/>";
static const gchar frame[] =
    "<m:MetadataStream xmlns:m=\"http://www.onvif.org/ver10/schema\">"
    "<m:VideoAnalytics><m:Frame UtcTime=\"2026-09-15T12:00:00.2500Z\"/>"
    "</m:VideoAnalytics></m:MetadataStream>";

static void
init(MediaMetadata *state, gboolean gzip)
{
    media_metadata_init(state, 2 * 1024 * 1024, 8 * 1024 * 1024, 2000, gzip);
}

static void
test_empty_and_invalid(void)
{
    static const gchar wrong[] = "<m:MetadataStream xmlns:m=\"wrong\"/>";
    static const gchar dtd[] = "<!DOCTYPE x [<!ENTITY a SYSTEM \"file:///forbidden\">]><x>&a;</x>";
    g_assert_true(media_metadata_xml((const guint8 *) empty, sizeof(empty) - 1));
    g_assert_true(media_metadata_xml((const guint8 *) frame, sizeof(frame) - 1));
    g_assert_false(media_metadata_xml((const guint8 *) wrong, sizeof(wrong) - 1));
    g_assert_false(media_metadata_xml((const guint8 *) dtd, sizeof(dtd) - 1));
    g_assert_false(media_metadata_xml((const guint8 *) "", 0));
}

static void
test_assembly(void)
{
    MediaMetadata state;
    MediaRtp packet = {.ssrc = 7, .sequence = 65535, .timestamp = 0xfffffff0};
    init(&state, FALSE);
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame, 80, 100), ==, MEDIA_META_MORE);
    packet.sequence = 0;
    packet.timestamp = 11;
    packet.marker = TRUE;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame + 80,
        sizeof(frame) - 1 - 80, 200), ==, MEDIA_META_COMPLETE);
    g_assert_cmpmem(state.xml->data, state.xml->len, frame, sizeof(frame) - 1);
    g_assert_cmpuint(state.first_timestamp, !=, state.last_timestamp);
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame + 80,
        sizeof(frame) - 1 - 80, 201), ==, MEDIA_META_MORE);
    packet.sequence = 1;
    packet.marker = FALSE;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame, 80, 300), ==, MEDIA_META_MORE);
    packet.sequence = 3;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame, 10, 400), ==, MEDIA_META_GAP);
    packet.sequence = 4;
    packet.marker = TRUE;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame, sizeof(frame) - 1, 500), ==, MEDIA_META_MORE);
    packet.sequence = 5;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) empty, sizeof(empty) - 1, 600), ==, MEDIA_META_COMPLETE);
    media_metadata_clear(&state);
}

static void
test_limits_and_incarnation(void)
{
    MediaMetadata state;
    MediaRtp packet = {.ssrc = 8, .sequence = 1};
    init(&state, FALSE);
    state.wire_max = 16;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame, 20, 1), ==, MEDIA_META_LIMIT);
    packet.sequence = 2;
    packet.marker = TRUE;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) empty, sizeof(empty) - 1, 2), ==, MEDIA_META_MORE);
    media_metadata_reset(&state, FALSE);
    state.wire_max = 2 * 1024 * 1024;
    packet.sequence = 3;
    packet.marker = FALSE;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame, 20, 3), ==, MEDIA_META_MORE);
    g_assert_true(media_metadata_expire(&state, 2000004));
    packet.sequence = 4;
    packet.marker = TRUE;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) empty, sizeof(empty) - 1, 2000005), ==, MEDIA_META_MORE);
    packet.sequence = 5;
    packet.marker = FALSE;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame, 20, 2000006), ==, MEDIA_META_MORE);
    packet.ssrc = 9;
    packet.sequence = 1;
    g_assert_cmpint(media_metadata_push(&state, &packet, (const guint8 *) frame, 20, 2000007), ==, MEDIA_META_GAP);
    media_metadata_clear(&state);
}

static void
test_gzip(void)
{
    MediaMetadata state;
    MediaRtp packet = {.ssrc = 3, .sequence = 1, .marker = TRUE};
    GZlibCompressor *compressor = g_zlib_compressor_new(G_ZLIB_COMPRESSOR_FORMAT_GZIP, 6);
    guint8 compressed[1024];
    gsize read = 0, written = 0;
    GError *error = NULL;
    GConverterResult result = g_converter_convert(G_CONVERTER(compressor), frame, sizeof(frame) - 1,
        compressed, sizeof(compressed), G_CONVERTER_INPUT_AT_END, &read, &written, &error);
    g_assert_no_error(error);
    g_assert_cmpint(result, ==, G_CONVERTER_FINISHED);
    init(&state, TRUE);
    g_assert_cmpint(media_metadata_push(&state, &packet, compressed, (guint) written, 1), ==, MEDIA_META_COMPLETE);
    g_assert_cmpmem(state.xml->data, state.xml->len, frame, sizeof(frame) - 1);
    media_metadata_reset(&state, FALSE);
    state.inflated_max = 32;
    g_assert_cmpint(media_metadata_push(&state, &packet, compressed, (guint) written, 2), ==, MEDIA_META_LIMIT);
    media_metadata_reset(&state, FALSE);
    state.inflated_max = 8 * 1024 * 1024;
    compressed[written - 1] ^= 1;
    g_assert_cmpint(media_metadata_push(&state, &packet, compressed, (guint) written, 3), ==, MEDIA_META_INVALID);
    media_metadata_clear(&state);
    g_object_unref(compressor);
}

int
main(int argc, char **argv)
{
    gst_init(&argc, &argv);
    g_test_init(&argc, &argv, NULL);
    g_test_add_func("/v2/metadata/empty-distinct-from-invalid", test_empty_and_invalid);
    g_test_add_func("/v2/metadata/sequence-wrap-marker-drain", test_assembly);
    g_test_add_func("/v2/metadata/limits-deadline-incarnation", test_limits_and_incarnation);
    g_test_add_func("/v2/metadata/gzip-crc-inflation-limits", test_gzip);
    return g_test_run();
}
