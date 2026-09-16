#include "metadata.h"

#include <gio/gio.h>
#include <libxml/parser.h>
#include <string.h>

gboolean
media_rtp_info(GstRTPBuffer *rtp, MediaRtp *out)
{
    guint16 profile;
    gpointer raw;
    const guint8 *extension;
    guint words;
    memset(out, 0, sizeof(*out));
    out->ssrc = gst_rtp_buffer_get_ssrc(rtp);
    out->timestamp = gst_rtp_buffer_get_timestamp(rtp);
    out->sequence = gst_rtp_buffer_get_seq(rtp);
    out->payload_type = gst_rtp_buffer_get_payload_type(rtp);
    out->marker = gst_rtp_buffer_get_marker(rtp);
    if (!gst_rtp_buffer_get_extension_data(rtp, &profile, &raw, &words))
        return TRUE;
    extension = raw;
    if (profile == 0xabac) {
        if (words < 3 || (extension[8] & 0x0f) || extension[10] || extension[11])
            return FALSE;
        out->replay_extension = TRUE;
        out->ntp = GST_READ_UINT64_BE(extension);
        out->replay_flags = extension[8];
        out->play_cseq_low = extension[9];
        if (words == 3)
            return TRUE;
        profile = GST_READ_UINT16_BE(extension + 12);
        if (words != 4u + GST_READ_UINT16_BE(extension + 14))
            return FALSE;
        extension += 16;
        words -= 4;
    }
    if (profile == 0xffd8 || profile == 0xffff) {
        out->jpeg_profile = profile;
        out->jpeg_extension = extension;
        out->jpeg_length = words * 4;
    } else if (out->replay_extension) {
        return FALSE;
    }
    return TRUE;
}

void
media_metadata_init(MediaMetadata *state, guint wire_max,
    guint inflated_max, guint deadline_ms, gboolean gzip)
{
    memset(state, 0, sizeof(*state));
    state->wire = g_byte_array_new();
    state->xml = g_byte_array_new();
    state->wire_max = wire_max;
    state->inflated_max = inflated_max;
    state->deadline_ms = deadline_ms;
    state->gzip = gzip;
}

void
media_metadata_reset(MediaMetadata *state, gboolean drain)
{
    state->active = FALSE;
    state->discarding = drain;
    state->have_sequence = FALSE;
    if (state->wire)
        g_byte_array_set_size(state->wire, 0);
    if (state->xml)
        g_byte_array_set_size(state->xml, 0);
}

void
media_metadata_clear(MediaMetadata *state)
{
    g_clear_pointer(&state->wire, g_byte_array_unref);
    g_clear_pointer(&state->xml, g_byte_array_unref);
}

static xmlParserErrors
deny_resource(void *context, const char *url, const char *public_id,
    xmlResourceType type, xmlParserInputFlags flags, xmlParserInputPtr *out)
{
    (void) context;
    (void) url;
    (void) public_id;
    (void) type;
    (void) flags;
    *out = NULL;
    return XML_IO_LOAD_ERROR;
}

static gboolean
bounded(xmlNodePtr node, guint depth, guint *count)
{
    for (; node; node = node->next) {
        xmlAttrPtr attribute;
        guint attributes = 0;
        if (++*count > 65536 || depth > 64 || node->type == XML_ENTITY_REF_NODE)
            return FALSE;
        for (attribute = node->properties; attribute; attribute = attribute->next) {
            if (++attributes > 128)
                return FALSE;
        }
        if (node->children && !bounded(node->children, depth + 1, count))
            return FALSE;
    }
    return TRUE;
}

gboolean
media_metadata_xml(const guint8 *bytes, guint length)
{
    xmlParserCtxtPtr parser;
    xmlDocPtr document;
    xmlNodePtr root;
    guint count = 0;
    gboolean valid = FALSE;
    if (!length || length > 32u * 1024u * 1024u || memchr(bytes, 0, length) ||
        !g_utf8_validate((const gchar *) bytes, length, NULL) ||
        g_strstr_len((const gchar *) bytes, length, "<!DOCTYPE") ||
        g_strstr_len((const gchar *) bytes, length, "<!ENTITY"))
        return FALSE;
    parser = xmlNewParserCtxt();
    if (!parser)
        return FALSE;
    xmlCtxtSetResourceLoader(parser, deny_resource, NULL);
    xmlCtxtSetMaxAmplification(parser, 1);
    document = xmlCtxtReadMemory(parser, (const char *) bytes, (int) length,
        "native-metadata.xml", "UTF-8",
        XML_PARSE_NONET | XML_PARSE_NO_XXE | XML_PARSE_NO_SYS_CATALOG |
        XML_PARSE_NOERROR | XML_PARSE_NOWARNING);
    if (document) {
        root = xmlDocGetRootElement(document);
        valid = root && root->ns && root->type == XML_ELEMENT_NODE &&
            xmlStrEqual(root->name, BAD_CAST "MetadataStream") &&
            xmlStrEqual(root->ns->href, BAD_CAST "http://www.onvif.org/ver10/schema") &&
            !document->intSubset && !document->extSubset && bounded(root, 1, &count);
        xmlFreeDoc(document);
    }
    xmlFreeParserCtxt(parser);
    return valid;
}

gboolean
media_metadata_expire(MediaMetadata *state, gint64 now_us)
{
    if (state->active && now_us - state->started_us > (gint64) state->deadline_ms * 1000) {
        state->active = FALSE;
        state->discarding = TRUE;
        g_byte_array_set_size(state->wire, 0);
        return TRUE;
    }
    return FALSE;
}

static gint
inflate(MediaMetadata *state)
{
    GZlibDecompressor *decompressor = g_zlib_decompressor_new(G_ZLIB_COMPRESSOR_FORMAT_GZIP);
    GError *error = NULL;
    guint consumed = 0;
    GConverterResult result = G_CONVERTER_CONVERTED;
    gint status = MEDIA_META_INVALID;
    while (result == G_CONVERTER_CONVERTED) {
        guint8 output[16384];
        gsize read = 0, written = 0;
        result = g_converter_convert(G_CONVERTER(decompressor),
            state->wire->data + consumed, state->wire->len - consumed,
            output, sizeof(output), G_CONVERTER_INPUT_AT_END, &read, &written, &error);
        if (result == G_CONVERTER_ERROR)
            break;
        if (written > state->inflated_max - state->xml->len ||
            state->xml->len + written > (guint64) MAX(state->wire->len, 1u) * 128u) {
            status = MEDIA_META_LIMIT;
            break;
        }
        g_byte_array_append(state->xml, output, (guint) written);
        consumed += (guint) read;
        if (result == G_CONVERTER_FINISHED && consumed == state->wire->len)
            status = MEDIA_META_COMPLETE;
        else if (!read && !written)
            break;
    }
    g_clear_error(&error);
    g_object_unref(decompressor);
    return status;
}

gint
media_metadata_push(MediaMetadata *state, const MediaRtp *packet,
    const guint8 *bytes, guint length, gint64 now_us)
{
    gint problem = media_metadata_expire(state, now_us) ? MEDIA_META_LIMIT : MEDIA_META_MORE;
    if (state->have_sequence) {
        if (state->ssrc == packet->ssrc && state->last_sequence == packet->sequence)
            return MEDIA_META_MORE;
        if (state->ssrc != packet->ssrc ||
            (guint16) (state->last_sequence + 1) != packet->sequence) {
            state->active = FALSE;
            state->discarding = TRUE;
            g_byte_array_set_size(state->wire, 0);
            problem = MEDIA_META_GAP;
        }
    }
    state->ssrc = packet->ssrc;
    state->last_sequence = packet->sequence;
    state->have_sequence = TRUE;
    if (state->discarding) {
        if (packet->marker)
            state->discarding = FALSE;
        return problem;
    }
    if (!state->active) {
        state->active = TRUE;
        g_byte_array_set_size(state->wire, 0);
        g_byte_array_set_size(state->xml, 0);
        state->first_sequence = packet->sequence;
        state->first_timestamp = packet->timestamp;
        state->started_us = now_us;
    }
    state->last_timestamp = packet->timestamp;
    if (length > state->wire_max - state->wire->len) {
        state->active = FALSE;
        state->discarding = !packet->marker;
        g_byte_array_set_size(state->wire, 0);
        return MEDIA_META_LIMIT;
    }
    g_byte_array_append(state->wire, bytes, length);
    if (!packet->marker)
        return MEDIA_META_MORE;
    state->active = FALSE;
    if (state->gzip) {
        problem = inflate(state);
        if (problem != MEDIA_META_COMPLETE)
            return problem;
    } else {
        if (state->wire->len > state->inflated_max)
            return MEDIA_META_LIMIT;
        g_byte_array_append(state->xml, state->wire->data, state->wire->len);
    }
    return media_metadata_xml(state->xml->data, state->xml->len) ?
        MEDIA_META_COMPLETE : MEDIA_META_INVALID;
}
