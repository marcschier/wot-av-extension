#include "p0_ipc.h"
#include "p0_metadata.h"

#include <gst/app/gstappsink.h>
#include <gst/audio/audio.h>
#include <gst/rtsp/gstrtspconnection.h>
#include <gst/sdp/gstsdpmessage.h>
#include <gst/video/video.h>
#include <glib/gwin32.h>
#include <io.h>
#include <libxml/xmlversion.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct Worker Worker;

typedef struct {
    Worker *worker;
    guint16 id;
    gint payload_type;
    gboolean selected, linked, timing_reported;
    GstElement *queue, *sink;
} Track;

typedef struct {
    guint16 kind;
    gchar *json;
} ControlEvent;

struct Worker {
    P0Ipc ipc;
    GMutex mutex;
    GQueue events;
    GstElement *pipeline, *source;
    GstBus *bus;
    Track tracks[3];
    P0Metadata metadata;
    guint32 session, generation, request, close_request, play_cseq;
    guint setup_acks;
    gboolean recorded, setup_sent, ready_sent, control_writable;
    guint64 start_ntp_ns, end_ntp_ns;
    gchar *uri, *failure;
    gint64 started_us;
    gint closing, ready;
    guint teardown_status;
};

static gchar *
quote_json(const gchar *input)
{
    GString *out = g_string_new("\"");
    const guchar *p = (const guchar *) input;
    for (; *p; ++p) {
        if (*p == '"' || *p == '\\') {
            g_string_append_c(out, '\\');
            g_string_append_c(out, (gchar) *p);
        } else if (*p < 0x20) {
            g_string_append_printf(out, "\\u%04x", *p);
        } else {
            g_string_append_c(out, (gchar) *p);
        }
    }
    g_string_append_c(out, '"');
    return g_string_free(out, FALSE);
}

static void
fail(Worker *worker, const gchar *code)
{
    g_mutex_lock(&worker->mutex);
    if (!worker->failure)
        worker->failure = g_strdup(code);
    g_mutex_unlock(&worker->mutex);
}

static void
event(Worker *worker, guint16 kind, gchar *json)
{
    ControlEvent *item;
    g_mutex_lock(&worker->mutex);
    if (g_queue_get_length(&worker->events) >= 64) {
        if (!worker->failure)
            worker->failure = g_strdup("ControlQueueLimit");
        g_mutex_unlock(&worker->mutex);
        g_free(json);
        return;
    }
    item = g_new(ControlEvent, 1);
    item->kind = kind;
    item->json = json;
    g_queue_push_tail(&worker->events, item);
    g_mutex_unlock(&worker->mutex);
}

static void
drain_events(Worker *worker)
{
    guint i;
    for (i = 0; i < 64; ++i) {
        ControlEvent *item;
        g_mutex_lock(&worker->mutex);
        item = g_queue_pop_head(&worker->events);
        g_mutex_unlock(&worker->mutex);
        if (!item)
            break;
        if (worker->control_writable)
            worker->control_writable = p0_ipc_control(&worker->ipc, item->kind,
                worker->session, worker->generation,
                worker->close_request ? worker->close_request : worker->request, item->json);
        g_free(item->json);
        g_free(item);
    }
}

static gboolean
data(Worker *worker, guint16 kind, const guint8 *payload, guint length)
{
    if (g_atomic_int_get(&worker->closing))
        return FALSE;
    if (!p0_ipc_data(&worker->ipc, kind, worker->session,
            worker->generation, payload, length)) {
        fail(worker, "DataQueueLimit");
        return FALSE;
    }
    return TRUE;
}

static gboolean
target_allowed(const gchar *uri, const gchar *base)
{
    GstRTSPUrl *target = NULL, *origin = NULL;
    gboolean valid = FALSE;
    if (!uri || strlen(uri) > 1024 ||
        gst_rtsp_url_parse(uri, &target) != GST_RTSP_OK)
        goto done;
    if (!g_str_has_prefix(uri, "rtsp://127.0.0.1:") || !target->host ||
        strcmp(target->host, "127.0.0.1") || target->user || target->passwd ||
        target->port < 1024 || !target->abspath ||
        !g_str_has_prefix(target->abspath, "/p0/"))
        goto done;
    if (strpbrk(uri, "\r\n\t ") || strchr(uri, '#'))
        goto done;
    if (base) {
        if (gst_rtsp_url_parse(base, &origin) != GST_RTSP_OK ||
            target->port != origin->port ||
            !g_str_has_prefix(target->abspath, origin->abspath))
            goto done;
        if (target->abspath[strlen(origin->abspath)] != '\0' &&
            target->abspath[strlen(origin->abspath)] != '/')
            goto done;
    }
    valid = TRUE;
done:
    if (target)
        gst_rtsp_url_free(target);
    if (origin)
        gst_rtsp_url_free(origin);
    return valid;
}

static gboolean
before_send(GstElement *source, GstRTSPMessage *request, gpointer context)
{
    Worker *worker = context;
    GstRTSPMethod method = request->type_data.request.method;
    gchar *range = NULL;
    gboolean failed;
    (void) source;
    if (g_atomic_int_get(&worker->closing) && method == GST_RTSP_PAUSE)
        return FALSE;
    g_mutex_lock(&worker->mutex);
    failed = worker->failure != NULL;
    g_mutex_unlock(&worker->mutex);
    if (failed && method != GST_RTSP_TEARDOWN)
        return FALSE;
    if (!target_allowed(request->type_data.request.uri, worker->uri)) {
        fail(worker, "ForbiddenTarget");
        return FALSE;
    }
    if (method == GST_RTSP_SETUP) {
        g_mutex_lock(&worker->mutex);
        worker->setup_sent = TRUE;
        g_mutex_unlock(&worker->mutex);
    }
    if (method == GST_RTSP_PLAY && worker->recorded) {
        if (gst_rtsp_message_get_header(request, GST_RTSP_HDR_RANGE, &range, 0) != GST_RTSP_OK ||
            !g_str_has_prefix(range, "clock=")) {
            fail(worker, "MissingNativeClockRange");
            return FALSE;
        }
        gst_rtsp_message_add_header(request, GST_RTSP_HDR_REQUIRE, "onvif-replay");
        gst_rtsp_message_add_header(request, GST_RTSP_HDR_FRAMES, "all");
        gst_rtsp_message_add_header(request, GST_RTSP_HDR_SCALE, "1.0");
    }
    return TRUE;
}

static void
after_response(GstElement *source, GstRTSPMessage *request,
    GstRTSPMessage *response, gpointer context)
{
    Worker *worker = context;
    GstRTSPMethod method = request->type_data.request.method;
    guint status = response->type_data.response.code;
    gchar *cseq_text = NULL, *range = NULL, *escaped_range;
    guint64 cseq = 0;
    gchar *end = NULL;
    (void) source;
    if (gst_rtsp_message_get_header(response, GST_RTSP_HDR_CSEQ, &cseq_text, 0) != GST_RTSP_OK) {
        fail(worker, "MissingResponseCSeq");
        return;
    }
    cseq = g_ascii_strtoull(cseq_text, &end, 10);
    if (!end || *end || cseq > G_MAXUINT32) {
        fail(worker, "InvalidResponseCSeq");
        return;
    }
    gst_rtsp_message_get_header(response, GST_RTSP_HDR_RANGE, &range, 0);
    if (range && strlen(range) > 160) {
        fail(worker, "ResponseRangeLimit");
        return;
    }
    escaped_range = quote_json(range ? range : "");
    event(worker, P0_RTSP_RESPONSE, g_strdup_printf(
        "{\"method\":\"%s\",\"status\":%u,\"cseq\":%u,\"range\":%s}",
        gst_rtsp_method_as_text(method), status, (guint) cseq, escaped_range));
    g_free(escaped_range);
    g_mutex_lock(&worker->mutex);
    if (method == GST_RTSP_SETUP && status >= 200 && status < 300)
        ++worker->setup_acks;
    if (method == GST_RTSP_TEARDOWN)
        worker->teardown_status = status;
    if (method == GST_RTSP_PLAY && status >= 200 && status < 300) {
        worker->play_cseq = (guint32) cseq;
        if (worker->setup_acks != 3 && !worker->failure)
            worker->failure = g_strdup("MissingRequiredTrack");
        else
            g_atomic_int_set(&worker->ready, 1);
    }
    g_mutex_unlock(&worker->mutex);
}

static guint
track_for_caps(GstCaps *caps)
{
    const GstStructure *structure;
    const gchar *media, *encoding;
    if (!caps || gst_caps_is_empty(caps))
        return 0;
    structure = gst_caps_get_structure(caps, 0);
    media = gst_structure_get_string(structure, "media");
    encoding = gst_structure_get_string(structure, "encoding-name");
    if (!media || !encoding)
        return 0;
    if (!strcmp(media, "video") && !g_ascii_strcasecmp(encoding, "JPEG"))
        return 1;
    if (!strcmp(media, "audio") && !g_ascii_strcasecmp(encoding, "PCMU"))
        return 2;
    if (!strcmp(media, "application") && !g_ascii_strcasecmp(encoding, "VND.ONVIF.METADATA"))
        return 3;
    return 0;
}

static gboolean
select_stream(GstElement *source, guint stream, GstCaps *caps, gpointer context)
{
    Worker *worker = context;
    guint id = track_for_caps(caps);
    gint payload_type;
    (void) source;
    (void) stream;
    if (!id || !gst_structure_get_int(gst_caps_get_structure(caps, 0),
            "payload", &payload_type) || payload_type < 0 || payload_type > 127) {
        fail(worker, "UnsupportedTrackEncoding");
        return FALSE;
    }
    if (worker->tracks[id - 1].selected) {
        fail(worker, "DuplicateTrack");
        return FALSE;
    }
    worker->tracks[id - 1].selected = TRUE;
    worker->tracks[id - 1].payload_type = payload_type;
    return TRUE;
}

static void
on_sdp(GstElement *source, GstSDPMessage *sdp, gpointer context)
{
    Worker *worker = context;
    guint i;
    const gchar *control = gst_sdp_message_get_attribute_val(sdp, "control");
    const gchar *range = gst_sdp_message_get_attribute_val(sdp, "range");
    (void) source;
    if (!control || strcmp(control, "*") || gst_sdp_message_medias_len(sdp) != 3) {
        fail(worker, "UnsupportedFixtureSdp");
        return;
    }
    if (worker->recorded && range && !g_str_has_prefix(range, "clock=") &&
        strcmp(range, "npt=0-")) {
        fail(worker, "UnsupportedRecordedSdpRange");
        return;
    }
    for (i = 0; i < 3; ++i) {
        const GstSDPMedia *media = gst_sdp_message_get_media(sdp, i);
        const gchar *value = gst_sdp_media_get_attribute_val(media, "control");
        gchar expected[16];
        g_snprintf(expected, sizeof(expected), "track%u", i);
        if (!value || strcmp(value, expected))
            fail(worker, "ForbiddenSdpControl");
    }
}

static GstPadProbeReturn
rtp_probe(GstPad *pad, GstPadProbeInfo *probe, gpointer context)
{
    Track *track = context;
    Worker *worker = track->worker;
    GstBuffer *buffer = GST_PAD_PROBE_INFO_BUFFER(probe);
    GstRTPBuffer rtp = GST_RTP_BUFFER_INIT;
    P0RtpInfo packet;
    guint8 output[P0_DATA_MAX];
    gsize size;
    gint64 receipt = g_get_monotonic_time();
    (void) pad;
    if (!buffer || g_atomic_int_get(&worker->closing) ||
        !g_atomic_int_get(&worker->ready))
        return GST_PAD_PROBE_OK;
    size = gst_buffer_get_size(buffer);
    if (size > P0_DATA_MAX - 40 || !gst_rtp_buffer_map(buffer, GST_MAP_READ, &rtp)) {
        fail(worker, "InvalidOrOversizedRtp");
        return GST_PAD_PROBE_DROP;
    }
    if (!p0_rtp_info(&rtp, &packet) ||
        packet.payload_type != track->payload_type) {
        fail(worker, "UnsupportedRtpExtensionOrPayload");
        gst_rtp_buffer_unmap(&rtp);
        return GST_PAD_PROBE_DROP;
    }
    if (worker->recorded && !track->timing_reported) {
        GstEvent *segment_event = gst_pad_get_sticky_event(pad, GST_EVENT_SEGMENT, 0);
        const GstSegment *segment = NULL;
        if (segment_event)
            gst_event_parse_segment(segment_event, &segment);
        event(worker, P0_NATIVE_DIAGNOSTIC, g_strdup_printf(
            "{\"code\":\"ReplayTiming\",\"track\":%u,\"ptsNs\":\"%" G_GUINT64_FORMAT
            "\",\"dtsNs\":\"%" G_GUINT64_FORMAT "\",\"segmentStartNs\":\"%" G_GUINT64_FORMAT "\"}",
            track->id, GST_BUFFER_PTS(buffer), GST_BUFFER_DTS(buffer),
            segment ? segment->start : GST_CLOCK_TIME_NONE));
        if (segment_event)
            gst_event_unref(segment_event);
        track->timing_reported = TRUE;
    }
    if (worker->recorded && packet.replay_extension) {
        guint32 cseq;
        g_mutex_lock(&worker->mutex);
        cseq = worker->play_cseq;
        g_mutex_unlock(&worker->mutex);
        if (packet.play_cseq_low != (cseq & 0xff)) {
            event(worker, P0_GAP, g_strdup("{\"code\":\"ReplayGenerationMismatch\"}"));
            gst_rtp_buffer_unmap(&rtp);
            return GST_PAD_PROBE_DROP;
        }
    }
    GST_WRITE_UINT16_BE(output, track->id);
    output[2] = packet.payload_type;
    output[3] = packet.marker ? 1 : 0;
    GST_WRITE_UINT32_BE(output + 4, packet.ssrc);
    GST_WRITE_UINT16_BE(output + 8, packet.sequence);
    output[10] = packet.replay_flags;
    output[11] = packet.play_cseq_low;
    GST_WRITE_UINT32_BE(output + 12, packet.timestamp);
    GST_WRITE_UINT64_BE(output + 16, (guint64) receipt * 1000);
    GST_WRITE_UINT64_BE(output + 24, packet.ntp);
    GST_WRITE_UINT32_BE(output + 32, packet.replay_extension ? 1 : 0);
    GST_WRITE_UINT32_BE(output + 36, (guint32) size);
    gst_buffer_extract(buffer, 0, output + 40, size);
    data(worker, P0_RTP, output, (guint) size + 40);
    if (track->id == 3) {
        gint result;
        g_mutex_lock(&worker->mutex);
        result = p0_metadata_push(&worker->metadata, &packet,
            gst_rtp_buffer_get_payload(&rtp), gst_rtp_buffer_get_payload_len(&rtp), receipt);
        if (result == P0_META_COMPLETE) {
            P0Metadata *metadata = &worker->metadata;
            GST_WRITE_UINT16_BE(output, 3);
            GST_WRITE_UINT16_BE(output + 2, 0);
            GST_WRITE_UINT16_BE(output + 4, metadata->first_sequence);
            GST_WRITE_UINT16_BE(output + 6, metadata->last_sequence);
            GST_WRITE_UINT32_BE(output + 8, metadata->ssrc);
            GST_WRITE_UINT32_BE(output + 12, metadata->first_timestamp);
            GST_WRITE_UINT32_BE(output + 16, metadata->last_timestamp);
            GST_WRITE_UINT64_BE(output + 20, (guint64) receipt * 1000);
            GST_WRITE_UINT32_BE(output + 28, metadata->length);
            memcpy(output + 32, metadata->bytes, metadata->length);
            size = metadata->length + 32;
        }
        g_mutex_unlock(&worker->mutex);
        if (result == P0_META_COMPLETE)
            data(worker, P0_METADATA, output, (guint) size);
        else if (result != P0_META_MORE)
            event(worker, P0_GAP, g_strdup_printf(
                "{\"code\":\"%s\",\"track\":3}",
                result == P0_META_GAP ? "RtpSequenceGap" :
                result == P0_META_LIMIT ? "MetadataResourceLimit" : "InvalidMetadataXml"));
    }
    gst_rtp_buffer_unmap(&rtp);
    return GST_PAD_PROBE_OK;
}

static GstFlowReturn
decoded_sample(GstAppSink *sink, gpointer context)
{
    Track *track = context;
    Worker *worker = track->worker;
    GstSample *sample = gst_app_sink_pull_sample(sink);
    GstBuffer *buffer;
    GstCaps *caps;
    guint8 output[P0_DATA_MAX] = {0};
    guint size = 0;
    if (!sample)
        return GST_FLOW_EOS;
    if (g_atomic_int_get(&worker->closing)) {
        gst_sample_unref(sample);
        return GST_FLOW_FLUSHING;
    }
    buffer = gst_sample_get_buffer(sample);
    caps = gst_sample_get_caps(sample);
    GST_WRITE_UINT16_BE(output, track->id);
    GST_WRITE_UINT16_BE(output + 2, track->id);
    GST_WRITE_UINT64_BE(output + 24, GST_BUFFER_PTS(buffer));
    if (track->id == 1) {
        GstVideoInfo info;
        GstVideoFrame frame;
        guint plane, row;
        if (!gst_video_info_from_caps(&info, caps) ||
            GST_VIDEO_INFO_FORMAT(&info) != GST_VIDEO_FORMAT_I420 ||
            GST_VIDEO_INFO_WIDTH(&info) != 16 || GST_VIDEO_INFO_HEIGHT(&info) != 16 ||
            !gst_video_frame_map(&frame, &info, buffer, GST_MAP_READ)) {
            fail(worker, "UnexpectedDecodedVideo");
            gst_sample_unref(sample);
            return GST_FLOW_ERROR;
        }
        GST_WRITE_UINT32_BE(output + 4, 16);
        GST_WRITE_UINT32_BE(output + 8, 16);
        GST_WRITE_UINT32_BE(output + 20, 1);
        for (plane = 0; plane < 3; ++plane) {
            guint width = plane ? 8 : 16;
            guint height = plane ? 8 : 16;
            const guint8 *pixels = GST_VIDEO_FRAME_PLANE_DATA(&frame, plane);
            gint stride = GST_VIDEO_FRAME_PLANE_STRIDE(&frame, plane);
            for (row = 0; row < height; ++row) {
                memcpy(output + 36 + size, pixels + (gssize) row * stride, width);
                size += width;
            }
        }
        gst_video_frame_unmap(&frame);
    } else {
        GstAudioInfo info;
        gsize bytes = gst_buffer_get_size(buffer);
        if (!gst_audio_info_from_caps(&info, caps) ||
            GST_AUDIO_INFO_FORMAT(&info) != GST_AUDIO_FORMAT_S16LE ||
            GST_AUDIO_INFO_RATE(&info) != 8000 || GST_AUDIO_INFO_CHANNELS(&info) != 1 ||
            !bytes || bytes > P0_DATA_MAX - 36 || bytes % 2) {
            fail(worker, "UnexpectedDecodedAudio");
            gst_sample_unref(sample);
            return GST_FLOW_ERROR;
        }
        size = (guint) bytes;
        GST_WRITE_UINT32_BE(output + 12, 8000);
        GST_WRITE_UINT16_BE(output + 16, 1);
        GST_WRITE_UINT32_BE(output + 20, size / 2);
        gst_buffer_extract(buffer, 0, output + 36, size);
    }
    GST_WRITE_UINT32_BE(output + 32, size);
    data(worker, P0_DECODED, output, size + 36);
    gst_sample_unref(sample);
    return GST_FLOW_OK;
}

static void
pad_added(GstElement *source, GstPad *pad, gpointer context)
{
    Worker *worker = context;
    GstCaps *caps = gst_pad_get_current_caps(pad);
    guint id = track_for_caps(caps);
    GstPad *sink;
    Track *track;
    (void) source;
    if (caps)
        gst_caps_unref(caps);
    if (!id) {
        fail(worker, "UnexpectedDynamicTrack");
        return;
    }
    track = &worker->tracks[id - 1];
    if (track->linked) {
        fail(worker, "DuplicateDynamicTrack");
        return;
    }
    gst_pad_add_probe(pad, GST_PAD_PROBE_TYPE_BUFFER, rtp_probe, track, NULL);
    sink = gst_element_get_static_pad(track->queue, "sink");
    if (gst_pad_link(pad, sink) != GST_PAD_LINK_OK)
        fail(worker, "NativePadLinkFailure");
    else
        track->linked = TRUE;
    gst_object_unref(sink);
}

static gboolean
create_tracks(Worker *worker)
{
    guint i;
    for (i = 0; i < 3; ++i) {
        Track *track = &worker->tracks[i];
        GstElement *depay = NULL, *decoder = NULL;
        track->worker = worker;
        track->id = (guint16) (i + 1);
        track->queue = gst_element_factory_make("queue", NULL);
        track->sink = gst_element_factory_make(i == 2 ? "fakesink" : "appsink", NULL);
        if (!track->queue || !track->sink) {
            gst_clear_object(&track->queue);
            gst_clear_object(&track->sink);
            return FALSE;
        }
        g_object_set(track->queue, "max-size-buffers", 4u,
            "max-size-bytes", 65536u, "max-size-time", (guint64) 0, NULL);
        g_object_set(track->sink, "sync", FALSE, "async", FALSE, NULL);
        gst_bin_add_many(GST_BIN(worker->pipeline), track->queue, track->sink, NULL);
        if (i == 2) {
            if (!gst_element_link(track->queue, track->sink))
                return FALSE;
            continue;
        }
        depay = gst_element_factory_make(i ? "rtppcmudepay" : "rtpjpegdepay", NULL);
        decoder = gst_element_factory_make(i ? "mulawdec" : "jpegdec", NULL);
        if (!depay || !decoder) {
            gst_clear_object(&depay);
            gst_clear_object(&decoder);
            return FALSE;
        }
        gst_bin_add_many(GST_BIN(worker->pipeline), depay, decoder, NULL);
        if (!gst_element_link_many(track->queue, depay, decoder, track->sink, NULL))
            return FALSE;
        g_object_set(track->sink, "emit-signals", TRUE, "max-buffers", 2u,
            "max-bytes", (guint64) P0_DATA_MAX, "max-time", (guint64) 0,
            "wait-on-eos", FALSE, NULL);
        g_signal_connect(track->sink, "new-sample", G_CALLBACK(decoded_sample), track);
    }
    return TRUE;
}

static gboolean
open_session(Worker *worker, const P0Command *command)
{
    guint16 uri_length;
    guint8 auth;
    GstEvent *seek;
    if (command->length < 22 || command->generation || !command->session || !command->sequence)
        return FALSE;
    uri_length = GST_READ_UINT16_BE(command->payload + 20);
    if (!uri_length || uri_length > 1024 || command->length != 22u + uri_length ||
        memchr(command->payload + 22, 0, uri_length) ||
        !g_utf8_validate((const gchar *) command->payload + 22, uri_length, NULL))
        return FALSE;
    auth = command->payload[2];
    if (command->payload[0] > 1 || command->payload[1] != 1 || auth > 1 ||
        command->payload[3] != 7)
        return FALSE;
    worker->uri = g_strndup((const gchar *) command->payload + 22, uri_length);
    if (!target_allowed(worker->uri, NULL))
        return FALSE;
    worker->recorded = command->payload[0] == 1;
    worker->start_ntp_ns = GST_READ_UINT64_BE(command->payload + 4);
    worker->end_ntp_ns = GST_READ_UINT64_BE(command->payload + 12);
    if ((worker->recorded && (worker->start_ntp_ns < G_GUINT64_CONSTANT(2208988800000000000) ||
            worker->end_ntp_ns <= worker->start_ntp_ns || worker->end_ntp_ns > G_MAXINT64)) ||
        (!worker->recorded && (worker->start_ntp_ns || worker->end_ntp_ns)))
        return FALSE;
    worker->session = command->session;
    worker->generation = 1;
    worker->request = command->sequence;
    worker->started_us = g_get_monotonic_time();
    worker->pipeline = gst_pipeline_new("onvif-p0");
    worker->source = gst_element_factory_make("rtspsrc", "native-rtsp");
    if (!worker->pipeline || !worker->source ||
        !g_signal_lookup("p0-after-response", G_OBJECT_TYPE(worker->source)))
        return FALSE;
    gst_bin_add(GST_BIN(worker->pipeline), worker->source);
    g_object_set(worker->source, "location", worker->uri,
        "protocols", GST_RTSP_LOWER_TRANS_TCP, "latency", 20u,
        "tcp-timeout", (guint64) 2000000, "teardown-timeout", (guint64) 2000000000,
        "do-rtcp", FALSE, "udp-reconnect", FALSE,
        "onvif-mode", worker->recorded, "onvif-rate-control", FALSE,
        "is-live", !worker->recorded,
        "user-agent", "onvif-native-p0/1", NULL);
    if (auth)
        g_object_set(worker->source, "user-id", "fixture",
            "user-pw", "not-a-camera-password", NULL);
    g_signal_connect(worker->source, "before-send", G_CALLBACK(before_send), worker);
    g_signal_connect(worker->source, "p0-after-response", G_CALLBACK(after_response), worker);
    g_signal_connect(worker->source, "select-stream", G_CALLBACK(select_stream), worker);
    g_signal_connect(worker->source, "on-sdp", G_CALLBACK(on_sdp), worker);
    g_signal_connect(worker->source, "pad-added", G_CALLBACK(pad_added), worker);
    if (!create_tracks(worker))
        return FALSE;
    worker->bus = gst_element_get_bus(worker->pipeline);
    if (worker->recorded) {
        seek = gst_event_new_seek(1.0, GST_FORMAT_TIME,
            GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_ACCURATE, GST_SEEK_TYPE_SET,
            (gint64) worker->start_ntp_ns, GST_SEEK_TYPE_SET, (gint64) worker->end_ntp_ns);
        if (!gst_element_send_event(worker->source, seek))
            return FALSE;
    }
    return gst_element_set_state(worker->pipeline, GST_STATE_PLAYING) != GST_STATE_CHANGE_FAILURE;
}

static gchar *
inventory(gchar **problem)
{
    static const gchar *required[] = {
        "rtspsrc", "rtpbin", "rtpjpegdepay", "jpegdec", "rtppcmudepay",
        "mulawdec", "appsink", "queue", "fakesink"
    };
    guint major, minor, micro, nano, i;
    GString *plugins = g_string_new("[");
    gchar *result = NULL;
    HMODULE library = GetModuleHandleW(L"gstrtsp-1.0-0.dll");
    typedef const gchar *(__cdecl *Revision)(void);
    union { FARPROC generic; Revision revision; } marker;
    marker.generic = library ? GetProcAddress(library, "gst_rtsp_connection_p0_revision") : NULL;
    gst_version(&major, &minor, &micro, &nano);
    if (major != 1 || minor != 28 || micro != 7 || nano ||
        !marker.generic || strcmp(marker.revision(), "classic-rtsp-p0-digest-1")) {
        *problem = g_strdup("NativeVersionOrPatchMismatch");
        goto done;
    }
    for (i = 0; i < G_N_ELEMENTS(required); ++i) {
        GstElementFactory *factory = gst_element_factory_find(required[i]);
        GstPlugin *plugin;
        if (!factory) {
            *problem = g_strdup_printf("MissingPlugin:%s", required[i]);
            goto done;
        }
        plugin = gst_plugin_feature_get_plugin(GST_PLUGIN_FEATURE(factory));
        if (!plugin || strcmp(gst_plugin_get_version(plugin), "1.28.7")) {
            *problem = g_strdup("PluginVersionMismatch");
            gst_object_unref(factory);
            if (plugin)
                gst_object_unref(plugin);
            goto done;
        }
        g_string_append_printf(plugins, "%s{\"factory\":\"%s\",\"version\":\"%s\",\"license\":\"%s\"}",
            i ? "," : "", required[i], gst_plugin_get_version(plugin), gst_plugin_get_license(plugin));
        gst_object_unref(plugin);
        gst_object_unref(factory);
    }
    {
        GstElement *source = gst_element_factory_make("rtspsrc", NULL);
        gboolean patched = source && g_signal_lookup("p0-after-response", G_OBJECT_TYPE(source));
        gst_clear_object(&source);
        if (!patched) {
            *problem = g_strdup("RtspPluginPatchMismatch");
            goto done;
        }
    }
    g_string_append_c(plugins, ']');
    result = g_strdup_printf(
        "{\"protocol\":1,\"worker\":\"onvif-media-p0\",\"scope\":\"owned-loopback-fixtures-only\","
        "\"gstreamer\":\"1.28.7\",\"glib\":\"%u.%u.%u\",\"libxml2Headers\":\"%s\","
        "\"rtspPatch\":\"classic-rtsp-p0-digest-1\",\"patchSha256\":\"%s\","
        "\"plugins\":%s,\"modes\":[\"live\",\"recorded-forward-range\"],"
        "\"transports\":[\"rtsp-tcp-interleaved\"],\"controls\":[\"open\",\"close\"],"
        "\"fixtureDecoders\":[\"JPEG-I420-16x16\",\"PCMU-S16LE-8000-mono\"],"
        "\"metadata\":[\"uncompressed-xml-frame-subset-not-canonical-schema\"],"
        "\"fixtureAuth\":[\"explicit-none\",\"MD5-no-qop\",\"MD5-auth\",\"SHA-256-auth\"],"
        "\"nativeCredentialInput\":false,\"generation\":1,"
        "\"limits\":{\"controlPayload\":4096,\"dataPayload\":65536,\"dataQueueBytes\":1048576,"
        "\"dataQueueFrames\":64,\"metadataBytes\":32768,\"metadataDeadlineMs\":2000,"
        "\"openDeadlineMs\":6000,\"mainLoopLifetimeMs\":30000},\"replayIsLive\":false,"
        "\"qualification\":\"candidate-cells-require-independent-gate-results\"}",
        glib_major_version, glib_minor_version, glib_micro_version, LIBXML_DOTTED_VERSION,
        P0_PATCH_SHA256, plugins->str);
done:
    g_string_free(plugins, TRUE);
    return result;
}

static void
isolated_gstreamer(void)
{
    gchar *root = g_win32_get_package_installation_directory_of_module(NULL);
    gchar *plugins = g_build_filename(root, "plugins", NULL);
    gchar *registry = g_build_filename(root, "p0-registry.bin", NULL);
    gchar *gio = g_build_filename(root, "gio", NULL);
    g_setenv("GST_PLUGIN_SYSTEM_PATH_1_0", plugins, TRUE);
    g_setenv("GST_PLUGIN_PATH_1_0", "", TRUE);
    g_setenv("GST_REGISTRY_1_0", registry, TRUE);
    g_setenv("GST_REGISTRY_FORK", "no", TRUE);
    g_setenv("GIO_MODULE_DIR", gio, TRUE);
    g_setenv("GIO_EXTRA_MODULES", "", TRUE);
    g_setenv("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
    g_unsetenv("GST_DEBUG");
    g_unsetenv("GST_DEBUG_FILE");
    g_unsetenv("GST_DEBUG_DUMP_DOT_DIR");
    g_unsetenv("GST_PLUGIN_FEATURE_RANK");
    gst_init(NULL, NULL);
    gst_debug_set_active(FALSE);
    g_free(root);
    g_free(plugins);
    g_free(registry);
    g_free(gio);
}

static void
poll_bus(Worker *worker)
{
    GstMessage *message;
    if (!worker->bus)
        return;
    while ((message = gst_bus_pop(worker->bus)) != NULL) {
        if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
            GError *error = NULL;
            gchar *debug = NULL;
            gst_message_parse_error(message, &error, &debug);
            if (error) {
                gchar *domain = quote_json(g_quark_to_string(error->domain));
                gchar *element = quote_json(GST_OBJECT_NAME(GST_MESSAGE_SRC(message)));
                event(worker, P0_NATIVE_DIAGNOSTIC, g_strdup_printf(
                    "{\"domain\":%s,\"code\":%d,\"element\":%s}", domain, error->code, element));
                g_free(domain);
                g_free(element);
            }
            fail(worker, (error && strstr(error->message, "ForbiddenTarget")) ? "ForbiddenTarget" :
                (debug && strstr(debug, "UnsupportedAuthentication")) ? "UnsupportedAuthentication" :
                "NativeRtspOrDecodeFailure");
            g_clear_error(&error);
            g_free(debug);
        } else if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_EOS) {
            fail(worker, "UnexpectedNativeEos");
        }
        gst_message_unref(message);
    }
}

static gboolean
close_session(Worker *worker)
{
    GstState state = GST_STATE_NULL;
    gboolean local = TRUE;
    const gchar *remote;
    guint status;
    gchar *json;
    g_atomic_int_set(&worker->closing, 1);
    if (worker->pipeline) {
        if (gst_element_set_state(worker->pipeline, GST_STATE_NULL) == GST_STATE_CHANGE_FAILURE ||
            gst_element_get_state(worker->pipeline, &state, NULL, 2 * GST_SECOND) == GST_STATE_CHANGE_FAILURE ||
            state != GST_STATE_NULL)
            local = FALSE;
        if (worker->bus)
            gst_object_unref(worker->bus);
        gst_object_unref(worker->pipeline);
        worker->pipeline = NULL;
        worker->source = NULL;
        worker->bus = NULL;
    }
    if (!p0_ipc_stop_data(&worker->ipc))
        local = FALSE;
    drain_events(worker);
    g_mutex_lock(&worker->mutex);
    status = worker->teardown_status;
    remote = !worker->setup_sent ? "not-created" :
        (status >= 200 && status < 300) ? "acknowledged" :
        status == 454 ? "already-ended" : "uncertain";
    g_mutex_unlock(&worker->mutex);
    json = g_strdup_printf(
        "{\"localCleanup\":%s,\"remote\":\"%s\",\"teardownStatus\":%u,"
        "\"dataDiscardedFrames\":%u,\"dataQueuePeakBytes\":%u,\"awaitWorkerExit\":true}",
        local ? "true" : "false", remote, status,
        worker->ipc.discarded_frames + worker->ipc.queued_frames, worker->ipc.peak_bytes);
    if (worker->control_writable)
        p0_ipc_control(&worker->ipc, P0_CLOSED, worker->session,
            worker->generation, worker->close_request, json);
    g_free(json);
    return local;
}

int
main(int argc, char **argv)
{
    Worker worker = {0};
    HANDLE data_handle = INVALID_HANDLE_VALUE;
    gchar *problem = NULL, *hello;
    gboolean inventory_only = argc == 2 && !strcmp(argv[1], "--inventory");
    gboolean done = FALSE, failed = FALSE, local;
    gint64 born = g_get_monotonic_time();
    guint32 commands = 0;
    if (!inventory_only) {
        gchar *end = NULL;
        guint64 handle;
        if (argc != 3 ||
            (strcmp(argv[1], "--data-handle") && strcmp(argv[1], "--data-fd"))) {
            fputs("Use --inventory or a private inherited --data-handle/--data-fd. No URI or credentials in argv.\n", stderr);
            return 2;
        }
        handle = g_ascii_strtoull(argv[2], &end, 10);
        if (!end || *end || !handle || handle > UINTPTR_MAX) {
            fputs("InvalidDataHandleArgument\n", stderr);
            return 2;
        }
        if (!strcmp(argv[1], "--data-fd")) {
            if (handle != 3) {
                fputs("The Node IPC data descriptor must be 3.\n", stderr);
                return 2;
            }
            data_handle = (HANDLE) _get_osfhandle(3);
        } else {
            data_handle = (HANDLE) (uintptr_t) handle;
        }
        if (!p0_ipc_init(&worker.ipc, data_handle)) {
            fputs("Invalid private IPC pipe handles.\n", stderr);
            return 2;
        }
    }
    g_mutex_init(&worker.mutex);
    g_queue_init(&worker.events);
    worker.control_writable = TRUE;
    isolated_gstreamer();
    hello = inventory(&problem);
    if (!hello) {
        if (inventory_only)
            fprintf(stderr, "%s\n", problem);
        else {
            gchar *quoted = quote_json(problem);
            gchar *error = g_strdup_printf("{\"code\":%s,\"execution\":\"not-sent\"}", quoted);
            p0_ipc_control(&worker.ipc, P0_ERROR, 0, 0, 0, error);
            p0_ipc_stop_data(&worker.ipc);
            p0_ipc_clear(&worker.ipc);
            g_free(quoted);
            g_free(error);
        }
        g_free(problem);
        g_mutex_clear(&worker.mutex);
        return 2;
    }
    if (inventory_only) {
        puts(hello);
        g_free(hello);
        g_mutex_clear(&worker.mutex);
        return 0;
    }
    worker.control_writable = p0_ipc_control(&worker.ipc, P0_HELLO, 0, 0, 0, hello);
    g_free(hello);
    while (!done) {
        P0Command command;
        gint read = p0_ipc_read(&worker.ipc, &command);
        gint64 now = g_get_monotonic_time();
        if (read == 1) {
            if (++commands > 64) {
                fail(&worker, "CommandLimit");
            } else if (command.kind == P0_OPEN && !worker.pipeline && !worker.session) {
                if (!open_session(&worker, &command)) {
                    worker.session = command.session;
                    worker.request = command.sequence;
                    fail(&worker, "UnsupportedOrInvalidOpenDescriptor");
                }
            } else if (command.kind == P0_CLOSE && command.length == 0 &&
                command.session == worker.session && command.generation == worker.generation &&
                command.sequence > worker.request) {
                worker.close_request = command.sequence;
                done = TRUE;
            } else {
                p0_ipc_control(&worker.ipc, P0_ERROR, worker.session, worker.generation,
                    command.sequence, "{\"code\":\"UnsupportedCommand\",\"execution\":\"not-sent\"}");
            }
        } else if (read < 0) {
            if (read == -2)
                fail(&worker, "InvalidIpcFrame");
            done = TRUE;
        }
        poll_bus(&worker);
        if (InterlockedCompareExchange(&worker.ipc.data_failed, 0, 0))
            fail(&worker, "DataPipeClosed");
        if ((!worker.pipeline && now - born > 6 * G_USEC_PER_SEC) ||
            (worker.pipeline && !g_atomic_int_get(&worker.ready) &&
                now - worker.started_us > 6 * G_USEC_PER_SEC))
            fail(&worker, "OpenDeadline");
        if (now - born > 30 * G_USEC_PER_SEC)
            fail(&worker, "WorkerLifetimeLimit");
        g_mutex_lock(&worker.mutex);
        if (p0_metadata_expire(&worker.metadata, now)) {
            g_mutex_unlock(&worker.mutex);
            event(&worker, P0_GAP, g_strdup("{\"code\":\"MetadataDeadline\",\"track\":3}"));
            g_mutex_lock(&worker.mutex);
        }
        if (worker.failure) {
            gchar *quoted = quote_json(worker.failure);
            gchar *json = g_strdup_printf("{\"code\":%s,\"execution\":\"see-native-responses\"}", quoted);
            g_mutex_unlock(&worker.mutex);
            if (worker.control_writable)
                p0_ipc_control(&worker.ipc, P0_ERROR, worker.session, worker.generation, worker.request, json);
            g_free(quoted);
            g_free(json);
            failed = TRUE;
            done = TRUE;
        } else {
            g_mutex_unlock(&worker.mutex);
        }
        drain_events(&worker);
        if (g_atomic_int_get(&worker.ready) && !worker.ready_sent && !failed) {
            worker.control_writable = p0_ipc_control(&worker.ipc, P0_READY, worker.session,
                worker.generation, worker.request,
                "{\"state\":\"playing\",\"protocolReady\":true,\"receivingIsSeparate\":true,\"tracks\":[1,2,3]}");
            worker.ready_sent = TRUE;
        }
        if (!worker.control_writable)
            done = TRUE;
        if (!done)
            g_usleep(2000);
    }
    local = close_session(&worker);
    if (!local)
        ExitProcess(3);
    p0_ipc_clear(&worker.ipc);
    g_free(worker.uri);
    g_free(worker.failure);
    g_mutex_clear(&worker.mutex);
    gst_deinit();
    return failed ? 2 : 0;
}
