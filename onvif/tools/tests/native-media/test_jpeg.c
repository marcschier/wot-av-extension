#include "jpeg.h"

#include <string.h>

static const guint8 sof[] = {
    0xff, 0xc0, 0x00, 0x11, 8, 0, 16, 0, 17, 3,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1
};
static const guint8 tail[] = {
    0xff, 0xda, 0, 12, 3, 0, 0, 1, 0x11, 2, 0x11, 0, 63, 0,
    0x13, 0xff, 0, 0x24, 0xff, 0xd9
};

static GstBuffer *
picture(const guint8 *tables, guint length)
{
    GByteArray *bytes = g_byte_array_new();
    guint8 native_sof[sizeof(sof)];
    static const guint8 start[] = {0xff, 0xd8};
    GstBuffer *buffer;
    memcpy(native_sof, sof, sizeof(sof));
    native_sof[8] = 24;
    native_sof[10] = 0;
    native_sof[13] = 1;
    native_sof[16] = 2;
    g_byte_array_append(bytes, start, sizeof(start));
    g_byte_array_append(bytes, tables, length);
    g_byte_array_append(bytes, native_sof, sizeof(native_sof));
    g_byte_array_append(bytes, tail, sizeof(tail));
    buffer = gst_buffer_new_allocate(NULL, bytes->len, NULL);
    gst_buffer_fill(buffer, 0, bytes->data, bytes->len);
    GST_BUFFER_PTS(buffer) = 1234;
    GST_BUFFER_DTS(buffer) = GST_CLOCK_TIME_NONE;
    g_byte_array_unref(bytes);
    return buffer;
}

static void
assert_bytes(GstBuffer *buffer, const guint8 *expected, guint length)
{
    GstMapInfo map;
    g_assert_true(gst_buffer_map(buffer, &map, GST_MAP_READ));
    g_assert_cmpmem(map.data, map.size, expected, length);
    gst_buffer_unmap(buffer, &map);
}

static void
test_sof_and_scan(void)
{
    MediaJpeg state;
    MediaRtp packet = {.ssrc = 7, .timestamp = 10, .sequence = 65535,
        .jpeg_profile = 0xffd8, .jpeg_extension = sof, .jpeg_length = sizeof(sof)};
    GstBuffer *input = picture(NULL, 0), *output;
    guint width, height;
    GByteArray *expected = g_byte_array_new();
    guint8 mapped_tail[sizeof(tail)];
    static const guint8 start[] = {0xff, 0xd8};
    media_jpeg_init(&state);
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_MORE);
    packet.sequence = 0;
    packet.jpeg_profile = 0xffff;
    packet.jpeg_length = 0;
    packet.marker = TRUE;
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_COMPLETE);
    g_assert_cmpint(media_jpeg_rewrite(&state, input, 4096, 17, 16,
        &output, &width, &height), ==, MEDIA_JPEG_COMPLETE);
    g_assert_cmpuint(width, ==, 17);
    g_assert_cmpuint(height, ==, 16);
    g_byte_array_append(expected, start, sizeof(start));
    g_byte_array_append(expected, sof, sizeof(sof));
    memcpy(mapped_tail, tail, sizeof(tail));
    mapped_tail[5] = 1;
    mapped_tail[7] = 2;
    mapped_tail[9] = 3;
    g_byte_array_append(expected, mapped_tail, sizeof(mapped_tail));
    assert_bytes(output, expected->data, expected->len);
    g_assert_cmpuint(GST_BUFFER_PTS(output), ==, 1234);
    g_assert_cmpuint(GST_BUFFER_DTS(output), ==, GST_CLOCK_TIME_NONE);
    gst_buffer_unref(output);
    gst_buffer_unref(input);
    g_byte_array_unref(expected);
    media_jpeg_clear(&state);
}

static void
test_quantization_table_identity(void)
{
    guint8 tables[134] = {0xff, 0xdb, 0, 132, 0};
    guint8 replacement[69] = {0xff, 0xdb, 0, 67, 0};
    guint8 kept[69] = {0xff, 0xdb, 0, 67, 1};
    MediaJpeg state;
    MediaRtp packet = {.ssrc = 8, .sequence = 1, .marker = TRUE,
        .jpeg_profile = 0xffd8, .jpeg_extension = replacement, .jpeg_length = sizeof(replacement)};
    GByteArray *expected = g_byte_array_new();
    GstBuffer *input, *output;
    guint width, height;
    guint8 native_sof[sizeof(sof)];
    static const guint8 start[] = {0xff, 0xd8};
    memset(tables + 5, 1, 64);
    tables[69] = 1;
    memset(tables + 70, 2, 64);
    memset(replacement + 5, 3, 64);
    memset(kept + 5, 2, 64);
    memcpy(native_sof, sof, sizeof(sof));
    native_sof[8] = 24;
    native_sof[10] = 0;
    native_sof[13] = 1;
    native_sof[16] = 2;
    input = picture(tables, sizeof(tables));
    media_jpeg_init(&state);
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_COMPLETE);
    g_assert_cmpint(media_jpeg_rewrite(&state, input, 4096, 24, 16,
        &output, &width, &height), ==, MEDIA_JPEG_COMPLETE);
    g_byte_array_append(expected, start, sizeof(start));
    g_byte_array_append(expected, kept, sizeof(kept));
    g_byte_array_append(expected, native_sof, sizeof(native_sof));
    g_byte_array_append(expected, replacement, sizeof(replacement));
    g_byte_array_append(expected, tail, sizeof(tail));
    assert_bytes(output, expected->data, expected->len);
    g_assert_cmpuint(width, ==, 24);
    gst_buffer_unref(input);
    gst_buffer_unref(output);
    g_byte_array_unref(expected);
    media_jpeg_clear(&state);
}

static void
test_invalid_and_limits(void)
{
    MediaJpeg state;
    MediaRtp packet = {.ssrc = 1, .sequence = 1, .marker = TRUE,
        .jpeg_profile = 0xffd8, .jpeg_extension = sof, .jpeg_length = sizeof(sof)};
    GstBuffer *input = picture(NULL, 0), *output;
    guint width, height;
    guint8 changed[sizeof(sof)];
    guint8 *large = g_malloc0(MEDIA_JPEG_HEADER_MAX);
    media_jpeg_init(&state);
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_COMPLETE);
    g_assert_cmpint(media_jpeg_rewrite(&state, input, 4096, 16, 16,
        &output, &width, &height), ==, MEDIA_JPEG_LIMIT);
    g_assert_null(output);
    memcpy(changed, sof, sizeof(sof));
    changed[1] = 0xc2;
    packet.jpeg_extension = changed;
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_COMPLETE);
    g_assert_cmpint(media_jpeg_rewrite(&state, input, 4096, 24, 16,
        &output, &width, &height), ==, MEDIA_JPEG_UNSUPPORTED);
    changed[1] = 0xc0;
    changed[3] = 0xff;
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_COMPLETE);
    g_assert_cmpint(media_jpeg_rewrite(&state, input, 4096, 24, 16,
        &output, &width, &height), ==, MEDIA_JPEG_INVALID);
    packet.jpeg_extension = large;
    packet.jpeg_length = MEDIA_JPEG_HEADER_MAX;
    packet.marker = FALSE;
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_MORE);
    packet.jpeg_profile = 0xffff;
    packet.jpeg_length = 1;
    ++packet.sequence;
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_LIMIT);
    media_jpeg_reset(&state);
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_INVALID);
    packet.jpeg_profile = 0;
    g_assert_cmpint(media_jpeg_push(&state, &packet), ==, MEDIA_JPEG_LEGACY);
    g_free(large);
    gst_buffer_unref(input);
    media_jpeg_clear(&state);
}

int
main(int argc, char **argv)
{
    gst_init(&argc, &argv);
    g_test_init(&argc, &argv, NULL);
    g_test_add_func("/v2/jpeg/sof-overrides-rounded-dimensions-preserves-scan", test_sof_and_scan);
    g_test_add_func("/v2/jpeg/quantization-table-identity", test_quantization_table_identity);
    g_test_add_func("/v2/jpeg/invalid-unsupported-and-resource-boundaries", test_invalid_and_limits);
    return g_test_run();
}
