#include "p0_metadata.h"

#include <libxml/parser.h>
#include <string.h>

gboolean
p0_rtp_info(GstRTPBuffer *rtp, P0RtpInfo *info)
{
    guint16 profile;
    gpointer extension;
    guint words;
    memset(info, 0, sizeof(*info));
    info->ssrc = gst_rtp_buffer_get_ssrc(rtp);
    info->timestamp = gst_rtp_buffer_get_timestamp(rtp);
    info->sequence = gst_rtp_buffer_get_seq(rtp);
    info->payload_type = gst_rtp_buffer_get_payload_type(rtp);
    info->marker = gst_rtp_buffer_get_marker(rtp);
    if (gst_rtp_buffer_get_extension_data(rtp, &profile, &extension, &words) &&
        profile == 0xabac) {
        const guint8 *data = extension;
        if (words != 3 || (data[8] & 0x0f) || data[10] || data[11])
            return FALSE;
        info->replay_extension = TRUE;
        info->ntp = GST_READ_UINT64_BE(data);
        info->replay_flags = data[8];
        info->play_cseq_low = data[9];
    }
    return TRUE;
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
named(xmlNodePtr node, const char *name)
{
    return node && node->type == XML_ELEMENT_NODE &&
        xmlStrEqual(node->name, BAD_CAST name) && node->ns &&
        xmlStrEqual(node->ns->href, BAD_CAST "http://www.onvif.org/ver10/schema");
}

static gboolean
bounded_nodes(xmlNodePtr node, guint depth, guint *count)
{
    for (; node; node = node->next) {
        xmlAttrPtr attribute;
        guint attributes = 0;
        if (++*count > 2048 || depth > 24 || node->type == XML_ENTITY_REF_NODE)
            return FALSE;
        for (attribute = node->properties; attribute; attribute = attribute->next) {
            if (++attributes > 64)
                return FALSE;
        }
        if (node->children && !bounded_nodes(node->children, depth + 1, count))
            return FALSE;
    }
    return TRUE;
}

gboolean
p0_metadata_xml(const guint8 *bytes, guint length)
{
    xmlParserCtxtPtr parser;
    xmlDocPtr document;
    xmlNodePtr root, analytics, frame;
    guint count = 0;
    gboolean found = FALSE;
    if (!length || length > P0_METADATA_MAX || memchr(bytes, 0, length) ||
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
        "p0-metadata.xml", "UTF-8",
        XML_PARSE_NONET | XML_PARSE_NO_XXE | XML_PARSE_NO_SYS_CATALOG |
        XML_PARSE_NOERROR | XML_PARSE_NOWARNING);
    if (!document)
        goto done;
    root = xmlDocGetRootElement(document);
    if (!named(root, "MetadataStream") || document->intSubset || document->extSubset ||
        !bounded_nodes(root, 1, &count))
        goto done;
    for (analytics = root->children; analytics; analytics = analytics->next) {
        if (!named(analytics, "VideoAnalytics"))
            continue;
        for (frame = analytics->children; frame; frame = frame->next) {
            if (named(frame, "Frame") && xmlHasProp(frame, BAD_CAST "UtcTime"))
                found = TRUE;
        }
    }
done:
    if (document)
        xmlFreeDoc(document);
    xmlFreeParserCtxt(parser);
    return found;
}

gboolean
p0_metadata_expire(P0Metadata *state, gint64 now_us)
{
    if (state->active && now_us - state->started_us > P0_METADATA_DEADLINE_US) {
        state->active = FALSE;
        state->discarding = TRUE;
        state->length = 0;
        return TRUE;
    }
    return FALSE;
}

gint
p0_metadata_push(P0Metadata *state, const P0RtpInfo *packet,
    const guint8 *bytes, guint length, gint64 now_us)
{
    gint error = P0_META_MORE;
    if (p0_metadata_expire(state, now_us))
        error = P0_META_LIMIT;
    if (state->active) {
        if (state->ssrc == packet->ssrc && state->last_sequence == packet->sequence)
            return P0_META_MORE;
        if (state->ssrc != packet->ssrc ||
            (guint16) (state->last_sequence + 1) != packet->sequence) {
            state->active = FALSE;
            state->discarding = TRUE;
            state->length = 0;
            error = P0_META_GAP;
        }
    }
    if (state->discarding) {
        if (packet->marker)
            state->discarding = FALSE;
        return error;
    }
    if (!state->active) {
        state->active = TRUE;
        state->length = 0;
        state->ssrc = packet->ssrc;
        state->first_sequence = packet->sequence;
        state->first_timestamp = packet->timestamp;
        state->started_us = now_us;
    }
    state->last_sequence = packet->sequence;
    state->last_timestamp = packet->timestamp;
    if (length > P0_METADATA_MAX - state->length) {
        state->active = FALSE;
        state->discarding = !packet->marker;
        state->length = 0;
        return P0_META_LIMIT;
    }
    memcpy(state->bytes + state->length, bytes, length);
    state->length += length;
    if (!packet->marker)
        return P0_META_MORE;
    state->active = FALSE;
    return p0_metadata_xml(state->bytes, state->length) ? P0_META_COMPLETE : P0_META_INVALID;
}
