#include "jpeg.h"

#include <string.h>

typedef struct {
    guint key;
    GBytes *bytes;
} Segment;

static void
free_segment(gpointer data)
{
    Segment *segment = data;
    g_bytes_unref(segment->bytes);
    g_free(segment);
}

void
media_jpeg_init(MediaJpeg *state)
{
    memset(state, 0, sizeof(*state));
    state->headers = g_byte_array_new();
}

void
media_jpeg_reset(MediaJpeg *state)
{
    state->active = state->complete = FALSE;
    if (state->headers)
        g_byte_array_set_size(state->headers, 0);
}

void
media_jpeg_clear(MediaJpeg *state)
{
    g_clear_pointer(&state->headers, g_byte_array_unref);
}

gint
media_jpeg_push(MediaJpeg *state, const MediaRtp *packet)
{
    if (!state->active || state->complete || state->ssrc != packet->ssrc ||
        state->timestamp != packet->timestamp) {
        media_jpeg_reset(state);
        if (!packet->jpeg_profile)
            return MEDIA_JPEG_LEGACY;
        if (packet->jpeg_profile != 0xffd8)
            return MEDIA_JPEG_INVALID;
        state->active = TRUE;
    } else if ((guint16) (state->sequence + 1) != packet->sequence ||
        packet->jpeg_profile != 0xffff) {
        return MEDIA_JPEG_INVALID;
    }
    if (packet->jpeg_length > MEDIA_JPEG_HEADER_MAX - state->headers->len)
        return MEDIA_JPEG_LIMIT;
    g_byte_array_append(state->headers, packet->jpeg_extension, packet->jpeg_length);
    state->ssrc = packet->ssrc;
    state->timestamp = packet->timestamp;
    state->sequence = packet->sequence;
    state->complete = packet->marker;
    return state->complete ? MEDIA_JPEG_COMPLETE : MEDIA_JPEG_MORE;
}

static void
add_segment(GPtrArray *segments, guint code, guint key, const guint8 *body, guint length)
{
    Segment *segment = g_new(Segment, 1);
    guint8 *bytes = g_malloc(length + 4);
    bytes[0] = 0xff;
    bytes[1] = (guint8) code;
    GST_WRITE_UINT16_BE(bytes + 2, (guint16) (length + 2));
    memcpy(bytes + 4, body, length);
    *segment = (Segment) {(code << 8) | key, g_bytes_new_take(bytes, length + 4)};
    g_ptr_array_add(segments, segment);
}

static gint
segments(const guint8 *bytes, guint length, gboolean extension,
    GPtrArray *out, guint *tail, guint *width, guint *height)
{
    guint offset = extension ? 0 : 2;
    gboolean have_sof = FALSE;
    if (!extension && (length < 2 || bytes[0] != 0xff || bytes[1] != 0xd8))
        return MEDIA_JPEG_INVALID;
    while (offset < length) {
        guint start, code, size;
        const guint8 *body;
        if (bytes[offset] != 0xff)
            return MEDIA_JPEG_INVALID;
        while (offset < length && bytes[offset] == 0xff)
            ++offset;
        if (offset == length)
            return extension ? MEDIA_JPEG_COMPLETE : MEDIA_JPEG_INVALID;
        start = offset - 1;
        code = bytes[offset++];
        if (code == 0xda && !extension) {
            *tail = start;
            return have_sof ? MEDIA_JPEG_COMPLETE : MEDIA_JPEG_INVALID;
        }
        if (length - offset < 2)
            return MEDIA_JPEG_INVALID;
        size = GST_READ_UINT16_BE(bytes + offset);
        if (size < 2 || size > length - offset)
            return MEDIA_JPEG_INVALID;
        body = bytes + offset + 2;
        size -= 2;
        if (code == 0xdb || code == 0xc4) {
            guint consumed = 0;
            while (consumed < size) {
                guint count, index = body[consumed], i;
                if ((index & 15) > 3 || index >> 4 > 1)
                    return MEDIA_JPEG_UNSUPPORTED;
                if (code == 0xdb) {
                    count = 1 + 64 * (1 + (index >> 4));
                } else {
                    if (size - consumed < 17)
                        return MEDIA_JPEG_INVALID;
                    count = 17;
                    for (i = 1; i <= 16; ++i)
                        count += body[consumed + i];
                    if (count > 273)
                        return MEDIA_JPEG_INVALID;
                }
                if (count > size - consumed)
                    return MEDIA_JPEG_INVALID;
                add_segment(out, code, code == 0xdb ? index & 15 : index, body + consumed, count);
                consumed += count;
            }
            if (!consumed)
                return MEDIA_JPEG_INVALID;
        } else if (code == 0xc0) {
            if (have_sof || size < 6 || body[0] != 8 || body[5] != 3 ||
                size != 6u + 3u * body[5])
                return MEDIA_JPEG_UNSUPPORTED;
            *height = GST_READ_UINT16_BE(body + 1);
            *width = GST_READ_UINT16_BE(body + 3);
            if (!*width || !*height || body[6] == body[9] ||
                body[6] == body[12] || body[9] == body[12])
                return MEDIA_JPEG_INVALID;
            have_sof = TRUE;
            add_segment(out, code, 0, body, size);
        } else if ((code >= 0xe0 && code <= 0xef) || code == 0xfe || (code == 0xdd && size == 2)) {
            add_segment(out, code, 0, body, size);
        } else {
            return MEDIA_JPEG_UNSUPPORTED;
        }
        if (out->len > 256)
            return MEDIA_JPEG_LIMIT;
        offset += size + 2;
    }
    return extension ? MEDIA_JPEG_COMPLETE : MEDIA_JPEG_INVALID;
}

static gboolean
component_ids(GPtrArray *headers, guint8 ids[3])
{
    guint i;
    for (i = 0; i < headers->len; ++i) {
        Segment *segment = g_ptr_array_index(headers, i);
        if (segment->key == 0xc000) {
            const guint8 *bytes = g_bytes_get_data(segment->bytes, NULL);
            ids[0] = bytes[10];
            ids[1] = bytes[13];
            ids[2] = bytes[16];
            return TRUE;
        }
    }
    return FALSE;
}

gint
media_jpeg_rewrite(MediaJpeg *state, GstBuffer *input, guint maximum,
    guint max_width, guint max_height, GstBuffer **output, guint *width, guint *height)
{
    GstMapInfo map;
    GPtrArray *native = g_ptr_array_new_with_free_func(free_segment);
    GPtrArray *overrides = g_ptr_array_new_with_free_func(free_segment);
    GHashTable *keys = g_hash_table_new(g_direct_hash, g_direct_equal);
    GByteArray *result = g_byte_array_new();
    guint i, tail = 0, ignored = 0, native_width = 0, native_height = 0;
    guint8 native_ids[3], output_ids[3];
    gint status = MEDIA_JPEG_INVALID;
    gboolean mapped = FALSE;
    static const guint8 soi[] = {0xff, 0xd8};
    *output = NULL;
    *width = *height = 0;
    if (!state->active || !state->complete)
        goto done;
    if (gst_buffer_get_size(input) > maximum) {
        status = MEDIA_JPEG_LIMIT;
        goto done;
    }
    if (!(mapped = gst_buffer_map(input, &map, GST_MAP_READ)))
        goto done;
    status = segments(state->headers->data, state->headers->len, TRUE,
        overrides, &ignored, width, height);
    if (status != MEDIA_JPEG_COMPLETE)
        goto done;
    status = segments(map.data, (guint) map.size, FALSE,
        native, &tail, &native_width, &native_height);
    if (status != MEDIA_JPEG_COMPLETE)
        goto done;
    if (!*width) {
        *width = native_width;
        *height = native_height;
    }
    if (*width > max_width || *height > max_height) {
        status = MEDIA_JPEG_LIMIT;
        goto done;
    }
    for (i = 0; i < overrides->len; ++i) {
        Segment *segment = g_ptr_array_index(overrides, i);
        if (g_hash_table_contains(keys, GUINT_TO_POINTER(segment->key)) &&
            (segment->key >> 8) < 0xe0) {
            status = MEDIA_JPEG_INVALID;
            goto done;
        }
        g_hash_table_add(keys, GUINT_TO_POINTER(segment->key));
    }
    g_byte_array_append(result, soi, sizeof(soi));
    for (i = 0; i < native->len + overrides->len; ++i) {
        Segment *segment = i < native->len ? g_ptr_array_index(native, i) :
            g_ptr_array_index(overrides, i - native->len);
        gsize length;
        const guint8 *bytes = g_bytes_get_data(segment->bytes, &length);
        if (i < native->len && g_hash_table_contains(keys, GUINT_TO_POINTER(segment->key)))
            continue;
        if (length > maximum - result->len) {
            status = MEDIA_JPEG_LIMIT;
            goto done;
        }
        g_byte_array_append(result, bytes, (guint) length);
    }
    if (map.size - tail > maximum - result->len) {
        status = MEDIA_JPEG_LIMIT;
        goto done;
    }
    if (map.size - tail < 14 || GST_READ_UINT16_BE(map.data + tail + 2) != 12 ||
        map.data[tail + 4] != 3 || !component_ids(native, native_ids)) {
        status = MEDIA_JPEG_INVALID;
        goto done;
    }
    memcpy(output_ids, native_ids, sizeof(output_ids));
    component_ids(overrides, output_ids);
    {
        guint scan = result->len;
        g_byte_array_append(result, map.data + tail, (guint) map.size - tail);
        for (i = 0; i < 3; ++i) {
            guint component;
            for (component = 0; component < 3; ++component) {
                if (result->data[scan + 5 + 2 * i] == native_ids[component])
                    break;
            }
            if (component == 3) {
                status = MEDIA_JPEG_INVALID;
                goto done;
            }
            result->data[scan + 5 + 2 * i] = output_ids[component];
        }
    }
    *output = gst_buffer_new_allocate(NULL, result->len, NULL);
    gst_buffer_fill(*output, 0, result->data, result->len);
    gst_buffer_copy_into(*output, input, GST_BUFFER_COPY_METADATA, 0, (gsize) -1);
    status = MEDIA_JPEG_COMPLETE;
done:
    if (mapped)
        gst_buffer_unmap(input, &map);
    g_ptr_array_unref(native);
    g_ptr_array_unref(overrides);
    g_hash_table_unref(keys);
    g_byte_array_unref(result);
    return status;
}
