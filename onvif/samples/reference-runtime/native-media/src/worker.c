#include "ipc.h"
#include "metadata.h"
#include "options.h"
#include "jpeg.h"
#include "terminal.h"

#include <gio/gio.h>
#include <glib/gstdio.h>
#include <glib/gwin32.h>
#include <gst/app/gstappsink.h>
#include <gst/app/gstappsrc.h>
#include <gst/audio/audio.h>
#include <gst/rtp/gstrtcpbuffer.h>
#include <gst/rtsp/gstrtsptransport.h>
#include <gst/sdp/gstsdpmessage.h>
#include <gst/video/video.h>
#include <fcntl.h>
#include <io.h>
#include <process.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct Worker Worker;
typedef struct {
    const gchar *encoding, *depay, *parser, *decoder;
    guint bit, track;
} Decoder;

static const Decoder decoders[] = {
    {"JPEG", "rtpjpegdepay", NULL, "jpegdec", 1, 1},
    {"H264", "rtph264depay", "h264parse", "avdec_h264", 2, 1},
    {"H265", "rtph265depay", "h265parse", "avdec_h265", 4, 1},
    {"MP4V-ES", "rtpmp4vdepay", "mpeg4videoparse", "avdec_mpeg4", 8, 1},
    {"PCMU", "rtppcmudepay", NULL, "mulawdec", 16, 2},
    {"MPEG4-GENERIC", "rtpmp4gdepay", "aacparse", "avdec_aac", 32, 2}
};

typedef struct {
    Worker *worker;
    guint16 id;
    guint stream, clock_rate, incarnation;
    gint payload_type;
    const Decoder *decoder;
    gboolean selected, linked, timing_reported, seen_rtp, dimensions_ready;
    guint32 ssrc;
    guint16 sequence;
    guint encoded_bytes;
    guint32 encoded_timestamp;
    MediaJpeg jpeg;
    gchar *encoding, *native_track;
    GstElement *queue, *sink;
} Track;

typedef struct {
    guint16 kind;
    guint32 generation, request;
    gchar *json;
} Event;

struct Worker {
    MediaIpc ipc;
    MediaOptions options;
    MediaMetadata metadata;
    GMutex mutex;
    GQueue events;
    GstElement *pipeline, *source, *back_source, *back_pipeline;
    GstBus *bus, *back_bus;
    HANDLE control_thread;
    Track tracks[4];
    gboolean back_streams[16];
    guint32 session, generation, request, last_command, close_request, play_cseq;
    guint32 secret_session, pending_control, pending_generation, audio_sequence;
    guint setup_acks, setup_expected, teardown_status, control_ready;
    guint gap_count, last_dropped;
    guint backchannel_packets, backchannel_samples;
    guint64 audio_samples;
    gboolean open_received, secret_received, secrets_complete, audio_closed;
    gboolean setup_sent, ready_sent, control_writable, paused;
    gint closing, ready, accepting_data;
    gint64 born, command_epoch, control_started;
    guint epoch_commands;
    gchar *failure, *ca_path, *native_session;
};

static gchar *
quote(const gchar *input)
{
    GString *out = g_string_new("\"");
    const guchar *p = (const guchar *) (input ? input : "");
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

static gboolean
failed(Worker *worker)
{
    gboolean value;
    g_mutex_lock(&worker->mutex);
    value = worker->failure != NULL;
    g_mutex_unlock(&worker->mutex);
    return value;
}

static void
event(Worker *worker, guint16 kind, gchar *json)
{
    Event *item;
    g_mutex_lock(&worker->mutex);
    if (g_queue_get_length(&worker->events) >= 256) {
        if (!worker->failure)
            worker->failure = g_strdup("ControlQueueLimit");
        g_mutex_unlock(&worker->mutex);
        g_free(json);
        return;
    }
    item = g_new(Event, 1);
    *item = (Event) {kind, worker->generation, worker->request, json};
    g_queue_push_tail(&worker->events, item);
    g_mutex_unlock(&worker->mutex);
}

static void
gap(Worker *worker, guint track, const gchar *code)
{
    g_mutex_lock(&worker->mutex);
    ++worker->gap_count;
    g_mutex_unlock(&worker->mutex);
    event(worker, MEDIA_GAP, g_strdup_printf("{\"track\":%u,\"code\":\"%s\"}", track, code));
}

static void
drain(Worker *worker)
{
    guint i;
    for (i = 0; i < 256; ++i) {
        Event *item;
        g_mutex_lock(&worker->mutex);
        item = g_queue_pop_head(&worker->events);
        g_mutex_unlock(&worker->mutex);
        if (!item)
            break;
        if (worker->control_writable)
            worker->control_writable = media_ipc_control(&worker->ipc, item->kind,
                worker->session, item->generation, item->request, item->json);
        g_free(item->json);
        g_free(item);
    }
}

static gboolean
send_data(Worker *worker, guint16 kind, const guint8 *bytes, guint length)
{
    guint32 generation;
    gint result;
    if (g_atomic_int_get(&worker->closing) || !g_atomic_int_get(&worker->accepting_data))
        return FALSE;
    g_mutex_lock(&worker->mutex);
    generation = worker->generation;
    g_mutex_unlock(&worker->mutex);
    result = media_ipc_data(&worker->ipc, kind, worker->session, generation, bytes, length);
    if (result < 0)
        fail(worker, "MediaFrameLimit");
    return result > 0;
}

static gboolean
before_send(GstElement *source, GstRTSPMessage *request, gpointer context)
{
    Worker *worker = context;
    GstRTSPMethod method = request->type_data.request.method;
    gchar *range = NULL;
    (void) source;
    if ((g_atomic_int_get(&worker->closing) && method == GST_RTSP_PAUSE) ||
        (failed(worker) && method != GST_RTSP_TEARDOWN))
        return FALSE;
    if (!media_target_allowed(request->type_data.request.uri, FALSE, FALSE, &worker->options)) {
        fail(worker, "ForbiddenTarget");
        return FALSE;
    }
    if (method == GST_RTSP_SETUP) {
        g_mutex_lock(&worker->mutex);
        worker->setup_sent = TRUE;
        g_mutex_unlock(&worker->mutex);
    }
    if (method == GST_RTSP_PLAY && worker->options.mode) {
        if (gst_rtsp_message_get_header(request, GST_RTSP_HDR_RANGE, &range, 0) != GST_RTSP_OK ||
            !g_str_has_prefix(range, "clock=")) {
            fail(worker, "MissingNativeClockRange");
            return FALSE;
        }
        gst_rtsp_message_remove_header(request, GST_RTSP_HDR_REQUIRE, -1);
        gst_rtsp_message_remove_header(request, GST_RTSP_HDR_FRAMES, -1);
        gst_rtsp_message_remove_header(request, GST_RTSP_HDR_SCALE, -1);
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
    gchar *text = NULL, *range = NULL, *escaped, *end = NULL;
    guint64 cseq;
    (void) source;
    if (gst_rtsp_message_get_header(response, GST_RTSP_HDR_CSEQ, &text, 0) != GST_RTSP_OK) {
        fail(worker, "MissingResponseCSeq");
        return;
    }
    cseq = g_ascii_strtoull(text, &end, 10);
    if (!end || *end || !cseq || cseq > G_MAXUINT32) {
        fail(worker, "InvalidResponseCSeq");
        return;
    }
    gst_rtsp_message_get_header(response, GST_RTSP_HDR_RANGE, &range, 0);
    if (range && strlen(range) > 160) {
        fail(worker, "ResponseRangeLimit");
        return;
    }
    if (method == GST_RTSP_SETUP && status >= 200 && status < 300) {
        gchar *session = NULL, *owned;
        gsize length;
        if (gst_rtsp_message_get_header(response, GST_RTSP_HDR_SESSION, &session, 0) != GST_RTSP_OK ||
            !session || !(length = strcspn(session, ";")) || length > 256 ||
            strcspn(session, " \t\r\n") < length) {
            fail(worker, "InvalidNativeSession");
            return;
        }
        owned = g_strndup(session, length);
        g_mutex_lock(&worker->mutex);
        if (!worker->native_session)
            worker->native_session = owned;
        else {
            if (strcmp(worker->native_session, owned) && !worker->failure)
                worker->failure = g_strdup("InconsistentNativeSession");
            g_free(owned);
        }
        g_mutex_unlock(&worker->mutex);
    }
    escaped = quote(range);
    event(worker, MEDIA_RESPONSE, g_strdup_printf(
        "{\"method\":\"%s\",\"status\":%u,\"cseq\":%u,\"range\":%s}",
        gst_rtsp_method_as_text(method), status, (guint) cseq, escaped));
    g_free(escaped);
    g_mutex_lock(&worker->mutex);
    if (method == GST_RTSP_SETUP && status >= 200 && status < 300)
        ++worker->setup_acks;
    if (method == GST_RTSP_TEARDOWN)
        worker->teardown_status = status;
    if (method == GST_RTSP_PLAY && status >= 200 && status < 300) {
        if (worker->setup_acks != worker->setup_expected || !worker->setup_expected) {
            if (!worker->failure)
                worker->failure = g_strdup("MissingRequiredTrack");
        } else {
            worker->play_cseq = (guint32) cseq;
            if (worker->pending_generation)
                worker->generation = worker->pending_generation;
            worker->pending_generation = 0;
            worker->paused = FALSE;
            worker->control_ready = worker->pending_control;
            worker->pending_control = 0;
            g_atomic_int_set(&worker->ready, 1);
            g_atomic_int_set(&worker->accepting_data, 1);
        }
    }
    if (method == GST_RTSP_PAUSE && status >= 200 && status < 300 &&
        worker->pending_control == MEDIA_PAUSE) {
        worker->paused = TRUE;
        worker->control_ready = worker->pending_control;
        worker->pending_control = 0;
    }
    if ((method == GST_RTSP_PLAY || method == GST_RTSP_PAUSE) &&
        status >= 400 && status != 401 && worker->pending_control && !worker->failure)
        worker->failure = g_strdup("ControlRejected");
    g_mutex_unlock(&worker->mutex);
    if (method == GST_RTSP_PLAY && status >= 200 && status < 300)
        media_ipc_suspend(&worker->ipc, FALSE, FALSE);
}

static const Decoder *
decoder_for(const gchar *encoding)
{
    guint i;
    for (i = 0; i < G_N_ELEMENTS(decoders); ++i) {
        if (encoding && !g_ascii_strcasecmp(encoding, decoders[i].encoding))
            return &decoders[i];
    }
    return NULL;
}

static gboolean
has_factory(const gchar *name)
{
    GstElementFactory *factory;
    if (!name)
        return TRUE;
    factory = gst_element_factory_find(name);
    if (!factory)
        return FALSE;
    gst_object_unref(factory);
    return TRUE;
}

static GstPadProbeReturn
allocation_guard(GstPad *pad, GstPadProbeInfo *info, gpointer context)
{
    Track *track = context;
    Worker *worker = track->worker;
    (void) pad;
    if (GST_PAD_PROBE_INFO_TYPE(info) & GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM) {
        GstEvent *event_value = GST_PAD_PROBE_INFO_EVENT(info);
        if (GST_EVENT_TYPE(event_value) == GST_EVENT_CAPS) {
            GstCaps *caps;
            const GstStructure *structure;
            gint width = 0, height = 0, rate = 0, channels = 0;
            gst_event_parse_caps(event_value, &caps);
            structure = gst_caps_get_structure(caps, 0);
            if (track->id == 1) {
                track->dimensions_ready = gst_structure_get_int(structure, "width", &width) &&
                    gst_structure_get_int(structure, "height", &height) &&
                    width > 0 && height > 0 &&
                    (guint) width <= worker->options.max_width &&
                    (guint) height <= worker->options.max_height &&
                    (guint64) width * height * 3 / 2 <= worker->options.decoded_max;
            } else {
                track->dimensions_ready = gst_structure_get_int(structure, "rate", &rate) &&
                    gst_structure_get_int(structure, "channels", &channels) &&
                    rate > 0 && rate <= 96000 && channels > 0 && channels <= 8;
            }
        }
    } else if ((GST_PAD_PROBE_INFO_TYPE(info) & GST_PAD_PROBE_TYPE_BUFFER) && !track->dimensions_ready) {
        fail(worker, "DecoderAllocationPolicy");
        return GST_PAD_PROBE_DROP;
    }
    return GST_PAD_PROBE_OK;
}

static GstFlowReturn
decoded(GstAppSink *sink, gpointer context)
{
    Track *track = context;
    Worker *worker = track->worker;
    GstSample *sample = gst_app_sink_pull_sample(sink);
    GstBuffer *buffer;
    GstCaps *caps;
    guint8 *output;
    guint size = 0;
    if (!sample)
        return GST_FLOW_EOS;
    if (g_atomic_int_get(&worker->closing)) {
        gst_sample_unref(sample);
        return GST_FLOW_FLUSHING;
    }
    buffer = gst_sample_get_buffer(sample);
    caps = gst_sample_get_caps(sample);
    if (gst_buffer_get_size(buffer) > worker->options.decoded_max) {
        fail(worker, "DecodedFrameLimit");
        gst_sample_unref(sample);
        return GST_FLOW_ERROR;
    }
    output = g_malloc0(36 + gst_buffer_get_size(buffer));
    GST_WRITE_UINT16_BE(output, track->id);
    GST_WRITE_UINT16_BE(output + 2, track->id);
    GST_WRITE_UINT64_BE(output + 24, GST_BUFFER_PTS(buffer));
    if (track->id == 1) {
        GstVideoInfo video;
        GstVideoFrame frame;
        guint plane, row;
        if (!gst_video_info_from_caps(&video, caps) ||
            GST_VIDEO_INFO_FORMAT(&video) != GST_VIDEO_FORMAT_I420 ||
            (guint) GST_VIDEO_INFO_WIDTH(&video) > worker->options.max_width ||
            (guint) GST_VIDEO_INFO_HEIGHT(&video) > worker->options.max_height ||
            !gst_video_frame_map(&frame, &video, buffer, GST_MAP_READ)) {
            fail(worker, "UnexpectedDecodedVideo");
            goto error;
        }
        GST_WRITE_UINT32_BE(output + 4, GST_VIDEO_INFO_WIDTH(&video));
        GST_WRITE_UINT32_BE(output + 8, GST_VIDEO_INFO_HEIGHT(&video));
        GST_WRITE_UINT32_BE(output + 20, 1);
        for (plane = 0; plane < 3; ++plane) {
            guint width = plane ? (GST_VIDEO_INFO_WIDTH(&video) + 1) / 2 : GST_VIDEO_INFO_WIDTH(&video);
            guint height = plane ? (GST_VIDEO_INFO_HEIGHT(&video) + 1) / 2 : GST_VIDEO_INFO_HEIGHT(&video);
            const guint8 *pixels = GST_VIDEO_FRAME_PLANE_DATA(&frame, plane);
            gint stride = GST_VIDEO_FRAME_PLANE_STRIDE(&frame, plane);
            for (row = 0; row < height; ++row) {
                memcpy(output + 36 + size, pixels + (gssize) row * stride, width);
                size += width;
            }
        }
        gst_video_frame_unmap(&frame);
    } else {
        GstAudioInfo audio;
        gsize bytes = gst_buffer_get_size(buffer);
        if (!gst_audio_info_from_caps(&audio, caps) ||
            GST_AUDIO_INFO_FORMAT(&audio) != GST_AUDIO_FORMAT_S16LE ||
            GST_AUDIO_INFO_RATE(&audio) <= 0 || GST_AUDIO_INFO_RATE(&audio) > 96000 ||
            GST_AUDIO_INFO_CHANNELS(&audio) <= 0 || GST_AUDIO_INFO_CHANNELS(&audio) > 8 ||
            !bytes || bytes % GST_AUDIO_INFO_BPF(&audio)) {
            fail(worker, "UnexpectedDecodedAudio");
            goto error;
        }
        size = (guint) bytes;
        GST_WRITE_UINT32_BE(output + 12, GST_AUDIO_INFO_RATE(&audio));
        GST_WRITE_UINT16_BE(output + 16, (guint16) GST_AUDIO_INFO_CHANNELS(&audio));
        GST_WRITE_UINT32_BE(output + 20, size / GST_AUDIO_INFO_BPF(&audio));
        gst_buffer_extract(buffer, 0, output + 36, size);
    }
    GST_WRITE_UINT32_BE(output + 32, size);
    send_data(worker, MEDIA_DECODED, output, size + 36);
    g_free(output);
    gst_sample_unref(sample);
    return GST_FLOW_OK;
error:
    g_free(output);
    gst_sample_unref(sample);
    return GST_FLOW_ERROR;
}

static gboolean
create_backchannel(Worker *worker, Track *track);

static GstPadProbeReturn
jpeg_input(GstPad *pad, GstPadProbeInfo *info, gpointer context)
{
    Track *track = context;
    GstRTPBuffer rtp = GST_RTP_BUFFER_INIT;
    MediaRtp packet;
    gint status;
    (void) pad;
    if (GST_PAD_PROBE_INFO_TYPE(info) & GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM) {
        GstEventType type = GST_EVENT_TYPE(GST_PAD_PROBE_INFO_EVENT(info));
        if (type == GST_EVENT_FLUSH_START || type == GST_EVENT_FLUSH_STOP)
            media_jpeg_reset(&track->jpeg);
        return GST_PAD_PROBE_OK;
    }
    if (!gst_rtp_buffer_map(GST_PAD_PROBE_INFO_BUFFER(info), GST_MAP_READ, &rtp))
        return GST_PAD_PROBE_DROP;
    status = media_rtp_info(&rtp, &packet) ? media_jpeg_push(&track->jpeg, &packet) : MEDIA_JPEG_INVALID;
    gst_rtp_buffer_unmap(&rtp);
    if (status >= MEDIA_JPEG_INVALID) {
        fail(track->worker, status == MEDIA_JPEG_LIMIT ? "JpegHeaderLimit" : "InvalidOnvifJpegHeader");
        return GST_PAD_PROBE_DROP;
    }
    return GST_PAD_PROBE_OK;
}

static GstPadProbeReturn
jpeg_output(GstPad *pad, GstPadProbeInfo *info, gpointer context)
{
    Track *track = context;
    Worker *worker = track->worker;
    GstBuffer *input = GST_PAD_PROBE_INFO_BUFFER(info), *output;
    GstCaps *caps;
    guint width, height;
    gint status;
    if (!track->jpeg.active)
        return GST_PAD_PROBE_OK;
    status = media_jpeg_rewrite(&track->jpeg, input, worker->options.wire_max,
        worker->options.max_width, worker->options.max_height, &output, &width, &height);
    if (status != MEDIA_JPEG_COMPLETE) {
        fail(worker, status == MEDIA_JPEG_LIMIT ? "JpegHeaderLimit" :
            status == MEDIA_JPEG_UNSUPPORTED ? "UnsupportedJpegHeader" : "InvalidOnvifJpegHeader");
        return GST_PAD_PROBE_DROP;
    }
    caps = gst_pad_get_current_caps(pad);
    if (!caps) {
        gst_buffer_unref(output);
        fail(worker, "MissingJpegCaps");
        return GST_PAD_PROBE_DROP;
    }
    caps = gst_caps_make_writable(caps);
    gst_caps_set_simple(caps, "width", G_TYPE_INT, (gint) width, "height", G_TYPE_INT, (gint) height, NULL);
    if (!gst_pad_push_event(pad, gst_event_new_caps(caps))) {
        gst_caps_unref(caps);
        gst_buffer_unref(output);
        fail(worker, "JpegCapsRejected");
        return GST_PAD_PROBE_DROP;
    }
    gst_caps_unref(caps);
    GST_PAD_PROBE_INFO_DATA(info) = output;
    gst_buffer_unref(input);
    return GST_PAD_PROBE_OK;
}

static GstFlowReturn
backchannel_sample(GstAppSink *sink, gpointer context)
{
    Worker *worker = context;
    GstSample *sample = gst_app_sink_pull_sample(sink);
    GstFlowReturn result = GST_FLOW_FLUSHING;
    GstRTPBuffer rtp = GST_RTP_BUFFER_INIT;
    GstBuffer *buffer;
    guint samples = 0;
    if (!sample)
        return GST_FLOW_EOS;
    buffer = gst_sample_get_buffer(sample);
    if (!gst_rtp_buffer_map(buffer, GST_MAP_READ, &rtp)) {
        fail(worker, "InvalidNativeBackchannelPacket");
        gst_sample_unref(sample);
        return GST_FLOW_ERROR;
    }
    samples = gst_rtp_buffer_get_payload_len(&rtp);
    if (gst_rtp_buffer_get_payload_type(&rtp) != worker->tracks[3].payload_type ||
        !samples || samples > 160) {
        gst_rtp_buffer_unmap(&rtp);
        fail(worker, "InvalidNativeBackchannelPacket");
        gst_sample_unref(sample);
        return GST_FLOW_ERROR;
    }
    gst_rtp_buffer_unmap(&rtp);
    if (!g_atomic_int_get(&worker->closing) && g_atomic_int_get(&worker->accepting_data))
        g_signal_emit_by_name(worker->source, "push-backchannel-sample",
            worker->tracks[3].stream, sample, &result);
    if (result == GST_FLOW_OK) {
        g_mutex_lock(&worker->mutex);
        ++worker->backchannel_packets;
        worker->backchannel_samples += samples;
        g_mutex_unlock(&worker->mutex);
    } else if (!g_atomic_int_get(&worker->closing)) {
        fail(worker, "NativeBackchannelSendFailure");
    }
    gst_sample_unref(sample);
    return result;
}

static gboolean
create_backchannel(Worker *worker, Track *track)
{
    GstElement *encoder = gst_element_factory_make("mulawenc", NULL);
    GstElement *pay = gst_element_factory_make("rtppcmupay", NULL);
    GstElement *sink = gst_element_factory_make("appsink", NULL);
    GstCaps *caps = gst_caps_from_string(
        "audio/x-raw,format=S16LE,layout=interleaved,rate=8000,channels=1");
    worker->back_pipeline = gst_pipeline_new("owned-onvif-backchannel");
    worker->back_source = gst_element_factory_make("appsrc", NULL);
    if (!encoder || !pay || !sink || !worker->back_pipeline || !worker->back_source) {
        gst_clear_object(&encoder);
        gst_clear_object(&pay);
        gst_clear_object(&sink);
        gst_clear_object(&worker->back_source);
        gst_clear_caps(&caps);
        return FALSE;
    }
    g_object_set(worker->back_source, "caps", caps, "format", GST_FORMAT_TIME,
        "is-live", TRUE, "block", FALSE, "max-bytes", (guint64) 2560,
        "max-buffers", (guint64) 8, "max-time", (guint64) 160 * GST_MSECOND, NULL);
    gst_caps_unref(caps);
    g_object_set(pay, "pt", (guint) track->payload_type,
        "min-ptime", (gint64) 20 * GST_MSECOND, "max-ptime", (gint64) 20 * GST_MSECOND, NULL);
    g_object_set(sink, "emit-signals", TRUE, "sync", FALSE, "async", FALSE,
        "max-buffers", 2u, "max-bytes", (guint64) 512, "wait-on-eos", FALSE, NULL);
    gst_bin_add_many(GST_BIN(worker->back_pipeline), worker->back_source, encoder, pay, sink, NULL);
    if (!gst_element_link_many(worker->back_source, encoder, pay, sink, NULL))
        return FALSE;
    g_signal_connect(sink, "new-sample", G_CALLBACK(backchannel_sample), worker);
    worker->back_bus = gst_element_get_bus(worker->back_pipeline);
    return gst_element_set_state(worker->back_pipeline, GST_STATE_PLAYING) != GST_STATE_CHANGE_FAILURE;
}

static void
backchannel_input(Worker *worker, const MediaCommand *command)
{
    GstBuffer *buffer;
    guint samples;
    guint64 buffered_bytes, buffered_frames;
    if (!(worker->options.tracks & 8)) {
        fail(worker, "UnsupportedBackchannel");
        return;
    }
    if (!worker->back_source || !g_atomic_int_get(&worker->ready) ||
        !g_atomic_int_get(&worker->accepting_data) || worker->paused || worker->pending_control) {
        fail(worker, "BackchannelNotReady");
        return;
    }
    if (command->kind != MEDIA_BACKCHANNEL || command->session != worker->session ||
        command->generation != worker->generation || !command->sequence ||
        command->sequence <= worker->audio_sequence || command->length < 16) {
        fail(worker, "InvalidBackchannelFrame");
        return;
    }
    samples = GST_READ_UINT32_BE(command->payload + 12);
    if (GST_READ_UINT16_BE(command->payload) != 4 ||
        GST_READ_UINT16_BE(command->payload + 2) != 2 ||
        GST_READ_UINT32_BE(command->payload + 4) != 8000 ||
        GST_READ_UINT16_BE(command->payload + 8) != 1 ||
        GST_READ_UINT16_BE(command->payload + 10) ||
        !samples || samples > 800 || samples % 160 || command->length != 16 + samples * 2) {
        fail(worker, "UnsupportedBackchannelFormat");
        return;
    }
    g_object_get(worker->back_source, "current-level-bytes", &buffered_bytes,
        "current-level-buffers", &buffered_frames, NULL);
    if (buffered_bytes + samples * 2 > 2560 || buffered_frames >= 8) {
        fail(worker, "BackchannelQueueLimit");
        return;
    }
    buffer = gst_buffer_new_allocate(NULL, samples * 2, NULL);
    gst_buffer_fill(buffer, 0, command->payload + 16, samples * 2);
    GST_BUFFER_PTS(buffer) = gst_util_uint64_scale(worker->audio_samples, GST_SECOND, 8000);
    GST_BUFFER_DURATION(buffer) = gst_util_uint64_scale(samples, GST_SECOND, 8000);
    worker->audio_samples += samples;
    worker->audio_sequence = command->sequence;
    if (gst_app_src_push_buffer(GST_APP_SRC(worker->back_source), buffer) != GST_FLOW_OK)
        fail(worker, "BackchannelQueueFailure");
}

static gboolean
create_track(Worker *worker, Track *track)
{
    GstElement *depay, *parser = NULL, *decoder, *convert, *filter;
    GstElement *terminal = media_terminal_new();
    GstCaps *caps;
    GstPad *guard;
    guint i;
    GstElement *elements[8];
    guint count = 0;
    track->queue = gst_element_factory_make("queue", NULL);
    track->sink = gst_element_factory_make(track->id == 3 ? "fakesink" : "appsink", NULL);
    if (!track->queue || !track->sink || !terminal)
        return FALSE;
    g_object_set(track->queue, "max-size-buffers", 128u, "max-size-bytes", 8u * 1024u * 1024u,
        "max-size-time", (guint64) 0, NULL);
    g_object_set(track->sink, "sync", FALSE, "async", FALSE, NULL);
    if (track->id == 3) {
        gst_bin_add_many(GST_BIN(worker->pipeline), track->queue, terminal, track->sink, NULL);
        return gst_element_link_many(track->queue, terminal, track->sink, NULL) &&
            gst_element_sync_state_with_parent(track->queue) &&
            gst_element_sync_state_with_parent(terminal) &&
            gst_element_sync_state_with_parent(track->sink);
    }
    depay = gst_element_factory_make(track->decoder->depay, NULL);
    if (track->decoder->parser)
        parser = gst_element_factory_make(track->decoder->parser, NULL);
    decoder = gst_element_factory_make(track->decoder->decoder, NULL);
    convert = gst_element_factory_make(track->id == 1 ? "videoconvert" : "audioconvert", NULL);
    filter = gst_element_factory_make("capsfilter", NULL);
    if (!depay || !decoder || !convert || !filter || (track->decoder->parser && !parser)) {
        gst_clear_object(&depay);
        gst_clear_object(&parser);
        gst_clear_object(&decoder);
        gst_clear_object(&convert);
        gst_clear_object(&filter);
        return FALSE;
    }
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(decoder), "max-threads"))
        g_object_set(decoder, "max-threads", 2, NULL);
    caps = gst_caps_from_string(track->id == 1 ?
        "video/x-raw,format=I420" : "audio/x-raw,format=S16LE,layout=interleaved");
    g_object_set(filter, "caps", caps, NULL);
    gst_caps_unref(caps);
    elements[count++] = track->queue;
    elements[count++] = terminal;
    elements[count++] = depay;
    if (parser)
        elements[count++] = parser;
    elements[count++] = decoder;
    elements[count++] = convert;
    elements[count++] = filter;
    elements[count++] = track->sink;
    for (i = 0; i < count; ++i)
        gst_bin_add(GST_BIN(worker->pipeline), elements[i]);
    for (i = 1; i < count; ++i) {
        if (!gst_element_link(elements[i - 1], elements[i]))
            return FALSE;
    }
    guard = gst_element_get_static_pad(decoder, "sink");
    gst_pad_add_probe(guard, GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM | GST_PAD_PROBE_TYPE_BUFFER,
        allocation_guard, track, NULL);
    gst_object_unref(guard);
    if (track->decoder->bit == 1) {
        media_jpeg_init(&track->jpeg);
        guard = gst_element_get_static_pad(depay, "sink");
        gst_pad_add_probe(guard, GST_PAD_PROBE_TYPE_BUFFER | GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM,
            jpeg_input, track, NULL);
        gst_object_unref(guard);
        guard = gst_element_get_static_pad(depay, "src");
        gst_pad_add_probe(guard, GST_PAD_PROBE_TYPE_BUFFER, jpeg_output, track, NULL);
        gst_object_unref(guard);
    }
    g_object_set(track->sink, "emit-signals", TRUE, "max-buffers", 2u,
        "max-bytes", (guint64) worker->options.decoded_max, "max-time", (guint64) 0,
        "wait-on-eos", FALSE, NULL);
    g_signal_connect(track->sink, "new-sample", G_CALLBACK(decoded), track);
    for (i = 0; i < count; ++i) {
        if (!gst_element_sync_state_with_parent(elements[i]))
            return FALSE;
    }
    return TRUE;
}

static gboolean
select_stream(GstElement *source, guint stream, GstCaps *caps, gpointer context)
{
    Worker *worker = context;
    const GstStructure *structure = gst_caps_get_structure(caps, 0);
    const gchar *media = gst_structure_get_string(structure, "media");
    const gchar *encoding = gst_structure_get_string(structure, "encoding-name");
    const Decoder *decoder = decoder_for(encoding);
    gint payload = -1, rate = 0;
    guint id;
    Track *track;
    gboolean gzip = FALSE;
    (void) source;
    if (stream >= 16 || !media || !encoding) {
        fail(worker, "InvalidSdpTrack");
        return FALSE;
    }
    if (worker->back_streams[stream])
        id = 4;
    else if (!strcmp(media, "video"))
        id = 1;
    else if (!strcmp(media, "audio"))
        id = 2;
    else if (!strcmp(media, "application"))
        id = 3;
    else
        return FALSE;
    if (!(worker->options.tracks & (1u << (id - 1))))
        return FALSE;
    track = &worker->tracks[id - 1];
    if (track->selected) {
        fail(worker, "DuplicateRequestedTrack");
        return FALSE;
    }
    if (id == 3) {
        gzip = !g_ascii_strcasecmp(encoding, "VND.ONVIF.METADATA.GZIP");
        if (!gzip && g_ascii_strcasecmp(encoding, "VND.ONVIF.METADATA")) {
            fail(worker, "UnsupportedMetadataEncoding");
            return FALSE;
        }
    } else if (!decoder || !(worker->options.codecs & decoder->bit) ||
        !has_factory(decoder->depay) || !has_factory(decoder->parser) || !has_factory(decoder->decoder)) {
        fail(worker, "NoDecoder");
        return FALSE;
    }
    if (!gst_structure_get_int(structure, "payload", &payload) || payload < 0 || payload > 127 ||
        !gst_structure_get_int(structure, "clock-rate", &rate) || rate <= 0 || rate > 192000) {
        fail(worker, "InvalidPayloadMap");
        return FALSE;
    }
    if (id == 4 && (decoder->bit != 16 || rate != 8000)) {
        fail(worker, "UnsupportedBackchannelEncoding");
        return FALSE;
    }
    track->selected = TRUE;
    track->stream = stream;
    track->payload_type = payload;
    track->clock_rate = (guint) rate;
    track->encoding = g_strdup(encoding);
    track->decoder = decoder;
    ++worker->setup_expected;
    if (id == 3)
        worker->metadata.gzip = gzip;
    if (id == 4 && !create_backchannel(worker, track)) {
        fail(worker, "NativeBackchannelPipelineFailure");
        return FALSE;
    }
    if (id != 4 && !create_track(worker, track)) {
        fail(worker, "NativeDecoderPipelineFailure");
        return FALSE;
    }
    return TRUE;
}

static void
on_sdp(GstElement *source, GstSDPMessage *sdp, gpointer context)
{
    Worker *worker = context;
    guint i, length = gst_sdp_message_medias_len(sdp);
    const gchar *control = gst_sdp_message_get_attribute_val(sdp, "control");
    (void) source;
    if (!length || length > 16 || !control || strlen(control) > 2048) {
        fail(worker, "InvalidSdp");
        return;
    }
    if (strstr(control, "://") && !media_target_allowed(control, FALSE, FALSE, &worker->options)) {
        fail(worker, "ForbiddenSdpControl");
        return;
    }
    for (i = 0; i < length; ++i) {
        const GstSDPMedia *media = gst_sdp_message_get_media(sdp, i);
        const gchar *value = gst_sdp_media_get_attribute_val(media, "control");
        const gchar *protocol = gst_sdp_media_get_proto(media);
        worker->back_streams[i] = gst_sdp_media_get_attribute_val(media, "sendonly") != NULL;
        if (!value || strlen(value) > 2048 || strpbrk(value, "\\\r\n\t ") ||
            !protocol || strcmp(protocol, "RTP/AVP") ||
            (strstr(value, "://") && !media_target_allowed(value, FALSE, FALSE, &worker->options))) {
            fail(worker, "ForbiddenOrUnsupportedSdpControl");
            return;
        }
    }
}

static GstPadProbeReturn
rtp_probe(GstPad *pad, GstPadProbeInfo *info, gpointer context)
{
    Track *track = context;
    Worker *worker = track->worker;
    GstBuffer *buffer = GST_PAD_PROBE_INFO_BUFFER(info);
    GstRTPBuffer rtp = GST_RTP_BUFFER_INIT;
    MediaRtp packet;
    guint8 *output;
    guint size;
    gint64 receipt = g_get_monotonic_time();
    if (!buffer || g_atomic_int_get(&worker->closing) ||
        !g_atomic_int_get(&worker->accepting_data))
        return GST_PAD_PROBE_DROP;
    if (gst_buffer_get_size(buffer) > 65536 ||
        !gst_rtp_buffer_map(buffer, GST_MAP_READ, &rtp)) {
        gap(worker, track->id, "InvalidOrOversizedRtp");
        return GST_PAD_PROBE_DROP;
    }
    if (!media_rtp_info(&rtp, &packet) || packet.payload_type != track->payload_type) {
        gap(worker, track->id, "InvalidRtpExtensionOrPayload");
        gst_rtp_buffer_unmap(&rtp);
        return GST_PAD_PROBE_DROP;
    }
    if (track->id != 3) {
        if (track->encoded_timestamp != packet.timestamp)
            track->encoded_bytes = 0;
        track->encoded_timestamp = packet.timestamp;
        size = gst_rtp_buffer_get_payload_len(&rtp);
        if (size > worker->options.wire_max - track->encoded_bytes) {
            fail(worker, "EncodedFrameLimit");
            gst_rtp_buffer_unmap(&rtp);
            return GST_PAD_PROBE_DROP;
        }
        track->encoded_bytes += size;
        if (packet.marker)
            track->encoded_bytes = 0;
    }
    if (worker->options.mode && !track->timing_reported) {
        GstEvent *segment_event = gst_pad_get_sticky_event(pad, GST_EVENT_SEGMENT, 0);
        const GstSegment *segment = NULL;
        if (segment_event)
            gst_event_parse_segment(segment_event, &segment);
        event(worker, MEDIA_DIAGNOSTIC, g_strdup_printf(
            "{\"code\":\"ReplayTiming\",\"track\":%u,\"ptsNs\":\"%" G_GUINT64_FORMAT
            "\",\"dtsNs\":\"%" G_GUINT64_FORMAT "\",\"segmentStartNs\":\"%" G_GUINT64_FORMAT "\"}",
            track->id, GST_BUFFER_PTS(buffer), GST_BUFFER_DTS(buffer),
            segment ? segment->start : GST_CLOCK_TIME_NONE));
        if (segment_event)
            gst_event_unref(segment_event);
        track->timing_reported = TRUE;
    }
    if (worker->options.mode && packet.replay_extension) {
        guint32 cseq;
        g_mutex_lock(&worker->mutex);
        cseq = worker->play_cseq;
        g_mutex_unlock(&worker->mutex);
        if (packet.play_cseq_low != (cseq & 0xff)) {
            gap(worker, track->id, "ReplayGenerationMismatch");
            gst_rtp_buffer_unmap(&rtp);
            return GST_PAD_PROBE_DROP;
        }
    }
    if (track->seen_rtp && track->ssrc != packet.ssrc) {
        ++track->incarnation;
        gap(worker, track->id, "SsrcIncarnationChanged");
    } else if (track->seen_rtp && packet.sequence != track->sequence &&
        (guint16) (track->sequence + 1) != packet.sequence) {
        gap(worker, track->id, "RtpSequenceGap");
    }
    track->seen_rtp = TRUE;
    track->ssrc = packet.ssrc;
    track->sequence = packet.sequence;
    if (worker->options.flags & 1) {
        size = (guint) gst_buffer_get_size(buffer);
        output = g_malloc(size + 40);
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
        GST_WRITE_UINT32_BE(output + 32, (packet.replay_extension ? 1 : 0) |
            (packet.jpeg_profile ? 2 : 0));
        GST_WRITE_UINT32_BE(output + 36, size);
        gst_buffer_extract(buffer, 0, output + 40, size);
        send_data(worker, MEDIA_RTP, output, size + 40);
        g_free(output);
    }
    if (track->id == 3) {
        gint result;
        g_mutex_lock(&worker->mutex);
        result = media_metadata_push(&worker->metadata, &packet,
            gst_rtp_buffer_get_payload(&rtp), gst_rtp_buffer_get_payload_len(&rtp), receipt);
        if (result == MEDIA_META_COMPLETE) {
            MediaMetadata *metadata = &worker->metadata;
            size = metadata->xml->len + 32;
            output = g_malloc0(size);
            GST_WRITE_UINT16_BE(output, track->id);
            GST_WRITE_UINT16_BE(output + 4, metadata->first_sequence);
            GST_WRITE_UINT16_BE(output + 6, metadata->last_sequence);
            GST_WRITE_UINT32_BE(output + 8, metadata->ssrc);
            GST_WRITE_UINT32_BE(output + 12, metadata->first_timestamp);
            GST_WRITE_UINT32_BE(output + 16, metadata->last_timestamp);
            GST_WRITE_UINT64_BE(output + 20, (guint64) receipt * 1000);
            GST_WRITE_UINT32_BE(output + 28, metadata->xml->len);
            memcpy(output + 32, metadata->xml->data, metadata->xml->len);
        } else {
            size = 0;
            output = NULL;
        }
        g_mutex_unlock(&worker->mutex);
        if (result == MEDIA_META_COMPLETE) {
            send_data(worker, MEDIA_METADATA, output, size);
            g_free(output);
        } else if (result != MEDIA_META_MORE) {
            gap(worker, 3, result == MEDIA_META_GAP ? "MetadataPacketGap" :
                result == MEDIA_META_LIMIT ? "MetadataResourceLimit" : "InvalidMetadataXml");
        }
    }
    gst_rtp_buffer_unmap(&rtp);
    return GST_PAD_PROBE_OK;
}

static GstPadProbeReturn
rtcp_probe(GstPad *pad, GstPadProbeInfo *info, gpointer context)
{
    Track *track = context;
    Worker *worker = track->worker;
    GstBuffer *buffer = GST_PAD_PROBE_INFO_BUFFER(info);
    GstRTCPBuffer rtcp = GST_RTCP_BUFFER_INIT;
    GstRTCPPacket packet;
    (void) pad;
    if (!buffer || !gst_rtcp_buffer_validate_reduced(buffer) ||
        !gst_rtcp_buffer_map(buffer, GST_MAP_READ, &rtcp))
        return GST_PAD_PROBE_OK;
    if (gst_rtcp_buffer_get_first_packet(&rtcp, &packet)) {
        do {
            if (gst_rtcp_packet_get_type(&packet) == GST_RTCP_TYPE_SR) {
                guint8 output[36] = {0};
                guint32 ssrc, timestamp, packets, octets;
                guint64 ntp;
                gst_rtcp_packet_sr_get_sender_info(&packet, &ssrc, &ntp, &timestamp, &packets, &octets);
                GST_WRITE_UINT16_BE(output, track->id);
                GST_WRITE_UINT32_BE(output + 4, ssrc);
                GST_WRITE_UINT32_BE(output + 8, timestamp);
                GST_WRITE_UINT64_BE(output + 12, ntp);
                GST_WRITE_UINT64_BE(output + 20, (guint64) g_get_monotonic_time() * 1000);
                GST_WRITE_UINT32_BE(output + 28, track->clock_rate);
                GST_WRITE_UINT32_BE(output + 32, track->incarnation);
                send_data(worker, MEDIA_RTCP, output, sizeof(output));
            }
        } while (gst_rtcp_packet_move_to_next(&packet));
    }
    gst_rtcp_buffer_unmap(&rtcp);
    return GST_PAD_PROBE_OK;
}

static void
manager_pad(GstElement *manager, GstPad *pad, gpointer context)
{
    Worker *worker = context;
    const gchar *name = GST_PAD_NAME(pad);
    guint i, stream;
    gchar *end;
    (void) manager;
    if (!g_str_has_prefix(name, "recv_rtcp_sink_"))
        return;
    stream = (guint) g_ascii_strtoull(name + strlen("recv_rtcp_sink_"), &end, 10);
    if (*end)
        return;
    for (i = 0; i < 4; ++i) {
        if (worker->tracks[i].selected && worker->tracks[i].stream == stream) {
            gst_pad_add_probe(pad, GST_PAD_PROBE_TYPE_BUFFER, rtcp_probe, &worker->tracks[i], NULL);
            return;
        }
    }
}

static void
new_manager(GstElement *source, GstElement *manager, gpointer context)
{
    (void) source;
    g_signal_connect(manager, "pad-added", G_CALLBACK(manager_pad), context);
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(manager), "max-dropout-time"))
        g_object_set(manager, "max-dropout-time", 2000u, "max-misorder-time", 200u, NULL);
}

static void
pad_added(GstElement *source, GstPad *pad, gpointer context)
{
    Worker *worker = context;
    GstCaps *caps = gst_pad_get_current_caps(pad);
    const GstStructure *structure;
    gint payload = -1;
    guint i;
    (void) source;
    if (!caps || gst_caps_is_empty(caps))
        goto invalid;
    structure = gst_caps_get_structure(caps, 0);
    if (!gst_structure_get_int(structure, "payload", &payload))
        goto invalid;
    for (i = 0; i < 3; ++i) {
        Track *track = &worker->tracks[i];
        GstPad *sink;
        if (!track->selected || track->payload_type != payload)
            continue;
        if (track->linked) {
            fail(worker, "DuplicateDynamicTrack");
            goto done;
        }
        gst_pad_add_probe(pad, GST_PAD_PROBE_TYPE_BUFFER, rtp_probe, track, NULL);
        sink = gst_element_get_static_pad(track->queue, "sink");
        if (gst_pad_link(pad, sink) != GST_PAD_LINK_OK)
            fail(worker, "NativePadLinkFailure");
        else
            track->linked = TRUE;
        gst_object_unref(sink);
        goto done;
    }
invalid:
    fail(worker, "UnexpectedDynamicTrack");
done:
    if (caps)
        gst_caps_unref(caps);
}

static gboolean
reject_certificate(GstElement *source, GTlsConnection *connection,
    GTlsCertificate *certificate, GTlsCertificateFlags errors, gpointer context)
{
    Worker *worker = context;
    (void) source;
    (void) connection;
    (void) certificate;
    event(worker, MEDIA_DIAGNOSTIC, g_strdup_printf(
        "{\"code\":\"TlsCertificateRejected\",\"certificateErrors\":%u}", (guint) errors));
    fail(worker, "TlsCertificateRejected");
    return FALSE;
}

static gboolean
set_tls(Worker *worker)
{
    GTlsDatabase *database;
    GError *error = NULL;
    gint fd;
    if (!g_tls_backend_supports_tls(g_tls_backend_get_default())) {
        fail(worker, "NoTlsBackend");
        return FALSE;
    }
    g_object_set(worker->source, "tls-validation-flags", G_TLS_CERTIFICATE_VALIDATE_ALL, NULL);
    g_signal_connect(worker->source, "accept-certificate", G_CALLBACK(reject_certificate), worker);
    if (!worker->options.secrets.ca_pem[0])
        return TRUE;
    fd = g_file_open_tmp("onvif-media-ca-XXXXXX.pem", &worker->ca_path, &error);
    if (fd < 0) {
        g_clear_error(&error);
        fail(worker, "TlsTrustStoreCreateFailure");
        return FALSE;
    }
    _setmode(fd, _O_BINARY);
    if (_write(fd, worker->options.secrets.ca_pem,
            (unsigned int) strlen(worker->options.secrets.ca_pem)) != (int) strlen(worker->options.secrets.ca_pem)) {
        _close(fd);
        fail(worker, "TlsTrustStoreWriteFailure");
        return FALSE;
    }
    _close(fd);
    database = g_tls_file_database_new(worker->ca_path, &error);
    if (!database) {
        g_clear_error(&error);
        fail(worker, "TlsTrustStoreInvalid");
        return FALSE;
    }
    g_object_set(worker->source, "tls-database", database, NULL);
    g_object_unref(database);
    return TRUE;
}

static gboolean
seek_native(Worker *worker)
{
    GstEvent *seek = gst_event_new_seek(1.0, GST_FORMAT_TIME,
        GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_ACCURATE, GST_SEEK_TYPE_SET,
        (gint64) worker->options.start_ntp_ns, GST_SEEK_TYPE_SET,
        (gint64) worker->options.end_ntp_ns);
    return gst_element_send_event(worker->source, seek);
}

static gboolean
open_native(Worker *worker)
{
    gchar *location;
    guint i;
    if (!media_options_bind(&worker->options))
        return FALSE;
    worker->generation = 1;
    worker->pipeline = gst_pipeline_new("owned-onvif-session");
    worker->source = gst_element_factory_make("rtspsrc", "native-rtsp");
    if (!worker->pipeline || !worker->source ||
        !g_signal_lookup("p0-after-response", G_OBJECT_TYPE(worker->source)))
        return FALSE;
    for (i = 0; i < 4; ++i) {
        worker->tracks[i].worker = worker;
        worker->tracks[i].id = (guint16) (i + 1);
        worker->tracks[i].incarnation = 1;
    }
    media_metadata_init(&worker->metadata, worker->options.wire_max,
        worker->options.inflated_max, worker->options.deadline_ms, FALSE);
    media_ipc_limits(&worker->ipc, worker->options.queue_bytes,
        worker->options.queue_frames, worker->options.mode != 0);
    gst_bin_add(GST_BIN(worker->pipeline), worker->source);
    g_object_set_data(G_OBJECT(worker->source), "onvif-media-policy", &worker->options.native_policy);
    location = media_location(&worker->options);
    g_object_set(worker->source, "location", location,
        "protocols", worker->options.transport == 2 ? GST_RTSP_LOWER_TRANS_UDP : GST_RTSP_LOWER_TRANS_TCP,
        "latency", 200u, "tcp-timeout", (guint64) 3000000,
        "teardown-timeout", (guint64) 2000000000, "timeout", (guint64) 0,
        "do-rtcp", TRUE, "udp-reconnect", FALSE, "ignore-x-server-reply", TRUE,
        "onvif-mode", worker->options.mode != 0, "onvif-rate-control", FALSE,
        "is-live", worker->options.mode == 0, "backchannel", (worker->options.tracks & 8) ? 1 : 0,
        "user-agent", "onvif-native-reference/2", NULL);
    g_free(location);
    if ((worker->options.transport == 4 || worker->options.transport == 5) && !set_tls(worker))
        return FALSE;
    g_signal_connect(worker->source, "before-send", G_CALLBACK(before_send), worker);
    g_signal_connect(worker->source, "p0-after-response", G_CALLBACK(after_response), worker);
    g_signal_connect(worker->source, "select-stream", G_CALLBACK(select_stream), worker);
    g_signal_connect(worker->source, "on-sdp", G_CALLBACK(on_sdp), worker);
    g_signal_connect(worker->source, "pad-added", G_CALLBACK(pad_added), worker);
    g_signal_connect(worker->source, "new-manager", G_CALLBACK(new_manager), worker);
    worker->bus = gst_element_get_bus(worker->pipeline);
    worker->control_started = g_get_monotonic_time();
    if (worker->options.mode && !seek_native(worker))
        return FALSE;
    return gst_element_set_state(worker->pipeline, GST_STATE_PLAYING) != GST_STATE_CHANGE_FAILURE;
}

static gchar *
tracks_json(Worker *worker)
{
    GString *json = g_string_new("[");
    guint i, added = 0;
    for (i = 0; i < 4; ++i) {
        Track *track = &worker->tracks[i];
        gchar *encoding;
        if (!track->selected)
            continue;
        encoding = quote(track->encoding);
        g_string_append_printf(json,
            "%s{\"id\":%u,\"kind\":\"%s\",\"direction\":\"%s\",\"encoding\":%s,"
            "\"payloadType\":%d,\"clockRate\":%u}",
            added++ ? "," : "", track->id, i == 0 ? "video" : i == 2 ? "metadata" : "audio",
            i == 3 ? "send" : "receive", encoding, track->payload_type, track->clock_rate);
        g_free(encoding);
    }
    g_string_append_c(json, ']');
    return g_string_free(json, FALSE);
}

static gchar *
inventory(gchar **problem)
{
    static const gchar *required[] = {
        "rtspsrc", "rtpbin", "appsink", "appsrc", "queue", "fakesink",
        "videoconvert", "audioconvert"
    };
    GString *plugins = g_string_new("[");
    GString *codecs = g_string_new("[");
    GHashTable *seen = g_hash_table_new(g_str_hash, g_str_equal);
    guint major, minor, micro, nano, i, count = 0, codec_count = 0;
    gchar *result = NULL;
    gst_version(&major, &minor, &micro, &nano);
    if (major != 1 || minor != 28 || micro != 7 || nano ||
        strcmp(gst_rtsp_connection_media_revision(), "classic-media-v2-scoped-auth-4")) {
        *problem = g_strdup("NativeVersionOrPatchMismatch");
        goto done;
    }
    for (i = 0; i < G_N_ELEMENTS(required); ++i) {
        if (!has_factory(required[i])) {
            *problem = g_strdup_printf("MissingPlugin:%s", required[i]);
            goto done;
        }
    }
    for (i = 0; i < G_N_ELEMENTS(decoders); ++i) {
        if (has_factory(decoders[i].depay) && has_factory(decoders[i].parser) &&
            has_factory(decoders[i].decoder))
            g_string_append_printf(codecs, "%s\"%s\"", codec_count++ ? "," : "", decoders[i].encoding);
    }
    {
        GList *list = gst_registry_get_plugin_list(gst_registry_get());
        GList *node;
        for (node = list; node; node = node->next) {
            GstPlugin *plugin = node->data;
            const gchar *filename = gst_plugin_get_filename(plugin);
            const gchar *name = gst_plugin_get_name(plugin);
            gchar *bytes = NULL, *hash, *license;
            gsize length;
            if (!filename || g_hash_table_contains(seen, name))
                continue;
            if (!g_file_get_contents(filename, &bytes, &length, NULL)) {
                *problem = g_strdup("PluginIntegrityReadFailed");
                gst_plugin_list_free(list);
                goto done;
            }
            g_hash_table_add(seen, (gpointer) name);
            hash = g_compute_checksum_for_data(G_CHECKSUM_SHA256, (const guchar *) bytes, length);
            license = quote(gst_plugin_get_license(plugin));
            g_string_append_printf(plugins,
                "%s{\"name\":\"%s\",\"version\":\"%s\",\"license\":%s,\"bytes\":%" G_GSIZE_FORMAT
                ",\"sha256\":\"%s\"}", count++ ? "," : "", name,
                gst_plugin_get_version(plugin), license, length, hash);
            g_free(bytes);
            g_free(hash);
            g_free(license);
        }
        gst_plugin_list_free(list);
    }
    g_string_append_c(plugins, ']');
    g_string_append_c(codecs, ']');
    result = g_strdup_printf(
        "{\"protocol\":2,\"worker\":\"onvif-media-reference\",\"gstreamer\":\"1.28.7\","
        "\"nativeRevision\":\"classic-media-v2-scoped-auth-4\","
        "\"nativeCredentialInput\":true,\"scope\":\"explicit-native-origin-interface-principal-policy\","
        "\"plugins\":%s,\"availableDecoders\":%s,\"tlsBackend\":%s,"
        "\"transports\":[\"tcp-interleaved\",\"udp-unicast\",\"http-tunnel\",\"https-tunnel\",\"tls-interleaved\"],"
        "\"controls\":[\"open\",\"close\",\"pause\",\"play\",\"seek\",\"credit\"],"
        "\"backchannelInput\":\"PCMU-from-S16LE-8000-mono-private-fd5\","
        "\"metadataGuard\":\"bounded-xml-root-not-canonical-validation\","
        "\"certification\":false,\"distributionApproved\":false}",
        plugins->str, codecs->str,
        g_tls_backend_supports_tls(g_tls_backend_get_default()) ? "true" : "false");
done:
    g_hash_table_unref(seen);
    g_string_free(plugins, TRUE);
    g_string_free(codecs, TRUE);
    return result;
}

static void
isolated_gstreamer(void)
{
    gchar *root = g_win32_get_package_installation_directory_of_module(NULL);
    gchar *plugins = g_build_filename(root, "plugins", NULL);
    gchar *registry = g_build_filename(root, "media-registry.bin", NULL);
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
    gst_debug_set_default_threshold(GST_LEVEL_WARNING);
    g_free(root);
    g_free(plugins);
    g_free(registry);
    g_free(gio);
}

static void
poll_bus(Worker *worker, GstBus *bus)
{
    GstMessage *message;
    if (!bus)
        return;
    while ((message = gst_bus_pop(bus)) != NULL) {
        if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
            GError *error = NULL;
            gchar *debug = NULL;
            gst_message_parse_error(message, &error, &debug);
            if (error) {
                gchar *domain = quote(g_quark_to_string(error->domain));
                gchar *element = quote(GST_OBJECT_NAME(GST_MESSAGE_SRC(message)));
                event(worker, MEDIA_DIAGNOSTIC, g_strdup_printf(
                    "{\"domain\":%s,\"code\":%d,\"element\":%s}", domain, error->code, element));
                g_free(domain);
                g_free(element);
            }
            fail(worker, (error && strstr(error->message, "ForbiddenTarget")) ? "ForbiddenTarget" :
                (debug && strstr(debug, "UnsupportedAuthentication")) ? "UnsupportedAuthentication" :
                "NativeRtspOrDecodeFailure");
            g_clear_error(&error);
            g_free(debug);
        } else if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_EOS && bus == worker->bus) {
            guint sequence;
            g_mutex_lock(&worker->ipc.mutex);
            sequence = worker->ipc.sequence;
            g_mutex_unlock(&worker->ipc.mutex);
            event(worker, MEDIA_END, g_strdup_printf(
                "{\"reason\":\"native-eos\",\"lastDataSequence\":%u}", sequence));
        } else if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_WARNING) {
            GError *error = NULL;
            gchar *debug = NULL;
            gst_message_parse_warning(message, &error, &debug);
            if (error) {
                gchar *domain = quote(g_quark_to_string(error->domain));
                gchar *element = quote(GST_OBJECT_NAME(GST_MESSAGE_SRC(message)));
                event(worker, MEDIA_DIAGNOSTIC, g_strdup_printf(
                    "{\"level\":\"warning\",\"domain\":%s,\"code\":%d,\"element\":%s}",
                    domain, error->code, element));
                if (error->domain == GST_STREAM_ERROR && error->code == GST_STREAM_ERROR_DECODE)
                    gap(worker, 0, "NativeDecodeWarning");
                g_free(domain);
                g_free(element);
            }
            g_clear_error(&error);
            g_free(debug);
        }
        gst_message_unref(message);
    }
}

static gboolean
control_finished(Worker *worker, DWORD timeout)
{
    if (!worker->control_thread)
        return TRUE;
    if (WaitForSingleObject(worker->control_thread, timeout) != WAIT_OBJECT_0)
        return FALSE;
    CloseHandle(worker->control_thread);
    worker->control_thread = NULL;
    return TRUE;
}

static unsigned __stdcall
native_control(void *context)
{
    Worker *worker = context;
    guint kind = worker->pending_control;
    const gchar *failure = NULL;
    gboolean sent = FALSE;
    if (g_atomic_int_get(&worker->closing))
        return 0;
    if (kind == MEDIA_PAUSE) {
        if (!worker->paused)
            g_signal_emit_by_name(worker->source, "onvif-media-control", 2u, &sent);
        if (!sent)
            failure = "PauseNotSent";
    } else if (worker->options.mode) {
        gboolean resume = worker->paused;
        if (!seek_native(worker))
            failure = "SeekNotSent";
        else if (resume && !g_atomic_int_get(&worker->closing)) {
            g_signal_emit_by_name(worker->source, "onvif-media-control", 1u, &sent);
            if (!sent)
                failure = "PlayNotSent";
        }
    } else {
        g_signal_emit_by_name(worker->source, "onvif-media-control", 1u, &sent);
        if (!sent)
            failure = "PlayNotSent";
    }
    if (failure && !g_atomic_int_get(&worker->closing))
        fail(worker, failure);
    return 0;
}

static void
control(Worker *worker, const MediaCommand *command)
{
    guint i;
    if (!g_atomic_int_get(&worker->ready) || worker->pending_control || worker->control_thread ||
        (command->kind != MEDIA_SEEK && command->length) ||
        (command->kind == MEDIA_SEEK && (!worker->options.mode || command->length != 16))) {
        fail(worker, "InvalidOrBusyControl");
        return;
    }
    if (command->kind == MEDIA_SEEK) {
        guint64 start = GST_READ_UINT64_BE(command->payload);
        guint64 end = GST_READ_UINT64_BE(command->payload + 8);
        if (!media_range_valid(start, end)) {
            fail(worker, "UnsupportedReplayRange");
            return;
        }
        worker->options.start_ntp_ns = start;
        worker->options.end_ntp_ns = end;
    }
    worker->pending_control = command->kind;
    worker->request = command->sequence;
    worker->control_started = g_get_monotonic_time();
    g_atomic_int_set(&worker->accepting_data, 0);
    media_ipc_suspend(&worker->ipc, TRUE, TRUE);
    g_mutex_lock(&worker->mutex);
    media_metadata_reset(&worker->metadata, FALSE);
    for (i = 0; i < 4; ++i) {
        worker->tracks[i].timing_reported = FALSE;
        worker->tracks[i].seen_rtp = FALSE;
        worker->tracks[i].encoded_bytes = 0;
        ++worker->tracks[i].incarnation;
    }
    g_mutex_unlock(&worker->mutex);
    if (command->kind != MEDIA_PAUSE) {
        if (worker->generation == G_MAXUINT32) {
            fail(worker, "GenerationLimit");
            return;
        }
        worker->pending_generation = worker->generation + 1;
    }
    /* Native recorded seek can wait for a wire response; keep CLOSE readable. */
    worker->control_thread = (HANDLE) _beginthreadex(NULL, 0, native_control, worker, 0, NULL);
    if (!worker->control_thread)
        fail(worker, "NativeControlThreadFailure");
}

static gboolean
close_native(Worker *worker)
{
    gboolean local = TRUE;
    GstState state = GST_STATE_NULL;
    const gchar *remote;
    gchar *json;
    g_atomic_int_set(&worker->closing, 1);
    g_atomic_int_set(&worker->accepting_data, 0);
    media_ipc_cancel(&worker->ipc);
    if (worker->back_pipeline) {
        gst_element_set_state(worker->back_pipeline, GST_STATE_NULL);
        gst_clear_object(&worker->back_bus);
        gst_clear_object(&worker->back_pipeline);
        worker->back_source = NULL;
    }
    if (worker->pipeline) {
        if (worker->control_thread) {
            gboolean interrupted = FALSE;
            g_signal_emit_by_name(worker->source, "onvif-media-control", 3u, &interrupted);
            if (!interrupted)
                local = FALSE;
        }
        if (gst_element_set_state(worker->pipeline, GST_STATE_NULL) == GST_STATE_CHANGE_FAILURE ||
            gst_element_get_state(worker->pipeline, &state, NULL, 2 * GST_SECOND) == GST_STATE_CHANGE_FAILURE ||
            state != GST_STATE_NULL)
            local = FALSE;
        if (!control_finished(worker, 2000)) {
            local = FALSE;
        } else {
            gst_clear_object(&worker->bus);
            gst_clear_object(&worker->pipeline);
            worker->source = NULL;
        }
    }
    if (!media_ipc_stop(&worker->ipc))
        local = FALSE;
    if (worker->ca_path && g_unlink(worker->ca_path) != 0)
        local = FALSE;
    drain(worker);
    remote = !worker->setup_sent ? "not-created" :
        (worker->teardown_status >= 200 && worker->teardown_status < 300) ? "acknowledged" :
        worker->teardown_status == 454 ? "already-ended" : "uncertain";
    json = g_strdup_printf(
        "{\"localCleanup\":%s,\"remote\":\"%s\",\"teardownStatus\":%u,"
        "\"dataDiscardedFrames\":%u,\"dataQueuePeakBytes\":%u,\"gaps\":%u,"
        "\"backchannelPackets\":%u,\"backchannelSamples\":%u,\"awaitWorkerExit\":true}",
        local ? "true" : "false", remote, worker->teardown_status,
        worker->ipc.discarded_frames, worker->ipc.peak_bytes, worker->gap_count,
        worker->backchannel_packets, worker->backchannel_samples);
    if (worker->control_writable)
        media_ipc_control(&worker->ipc, MEDIA_CLOSED, worker->session,
            worker->generation, worker->close_request, json);
    g_free(json);
    return local;
}

static HANDLE
handle_argument(const gchar *name, const gchar *value, guint expected)
{
    gchar *end;
    guint64 number = g_ascii_strtoull(value, &end, 10);
    if (!*value || *end || !number || number > UINTPTR_MAX)
        return INVALID_HANDLE_VALUE;
    if (g_str_has_suffix(name, "-fd"))
        return number == expected ? (HANDLE) _get_osfhandle((int) expected) : INVALID_HANDLE_VALUE;
    return (HANDLE) (uintptr_t) number;
}

int
main(int argc, char **argv)
{
    Worker *worker = g_new0(Worker, 1);
    gboolean inventory_only = argc == 2 && !strcmp(argv[1], "--inventory");
    gboolean done = FALSE, error_exit = FALSE, local;
    HANDLE data_handle, secret_handle, input_handle;
    gchar *problem = NULL, *hello;
    guint i;
    worker->born = worker->command_epoch = g_get_monotonic_time();
    if (!inventory_only) {
        if (argc != 7 ||
            (strcmp(argv[1], "--data-fd") && strcmp(argv[1], "--data-handle")) ||
            (strcmp(argv[3], "--secret-fd") && strcmp(argv[3], "--secret-handle")) ||
            (strcmp(argv[5], "--input-fd") && strcmp(argv[5], "--input-handle"))) {
            fputs("Use --inventory or private data/secret/input pipe descriptors. No targets or credentials in argv.\n", stderr);
            g_free(worker);
            return 2;
        }
        data_handle = handle_argument(argv[1], argv[2], 3);
        secret_handle = handle_argument(argv[3], argv[4], 4);
        input_handle = handle_argument(argv[5], argv[6], 5);
        if (!media_ipc_init(&worker->ipc, data_handle, secret_handle, input_handle)) {
            fputs("InvalidPrivatePipeHandles\n", stderr);
            g_free(worker);
            return 2;
        }
    }
    g_mutex_init(&worker->mutex);
    g_queue_init(&worker->events);
    worker->control_writable = TRUE;
    isolated_gstreamer();
    hello = inventory(&problem);
    if (!hello) {
        if (inventory_only) {
            fprintf(stderr, "%s\n", problem);
        } else {
            gchar *escaped = quote(problem);
            gchar *json = g_strdup_printf("{\"code\":%s,\"execution\":\"not-sent\"}", escaped);
            media_ipc_control(&worker->ipc, MEDIA_ERROR, 0, 0, 0, json);
            media_ipc_stop(&worker->ipc);
            media_ipc_clear(&worker->ipc);
            g_free(escaped);
            g_free(json);
        }
        g_free(problem);
        g_mutex_clear(&worker->mutex);
        g_free(worker);
        return 2;
    }
    if (inventory_only) {
        puts(hello);
        g_free(hello);
        g_mutex_clear(&worker->mutex);
        g_free(worker);
        return 0;
    }
    worker->control_writable = media_ipc_control(&worker->ipc, MEDIA_HELLO, 0, 0, 0, hello);
    g_free(hello);
    while (!done) {
        MediaCommand command;
        gint read;
        gint64 now = g_get_monotonic_time();
        control_finished(worker, 0);
        if (!worker->secrets_complete) {
            read = media_input_read(&worker->ipc.secrets, &command);
            if (read == 1) {
                if (worker->secret_received || command.kind != MEDIA_SECURITY || !command.session ||
                    command.generation || command.sequence != 1 ||
                    !media_secrets_parse(&worker->options.secrets, command.payload, command.length)) {
                    fail(worker, "InvalidSecurityPipe");
                } else {
                    worker->secret_session = command.session;
                    worker->secret_received = TRUE;
                }
                SecureZeroMemory(&command, sizeof(command));
            } else if (read < 0) {
                if (read == -2 || !worker->secret_received)
                    fail(worker, "InvalidSecurityPipe");
                worker->secrets_complete = TRUE;
            }
        }
        read = media_input_read(&worker->ipc.commands, &command);
        if (read == 1) {
            if (now - worker->command_epoch > G_USEC_PER_SEC) {
                worker->epoch_commands = 0;
                worker->command_epoch = now;
            }
            if (++worker->epoch_commands > 4096 || !command.sequence ||
                command.sequence <= worker->last_command) {
                fail(worker, "IpcCommandSequenceOrRate");
            } else if (command.kind == MEDIA_OPEN && !worker->open_received &&
                !command.generation && command.session) {
                worker->session = command.session;
                worker->request = command.sequence;
                worker->open_received = TRUE;
                if (!media_options_parse(&worker->options, command.payload, command.length))
                    fail(worker, "InvalidOrUnauthorizedOpen");
            } else if (command.session != worker->session ||
                (command.generation != worker->generation && command.kind != MEDIA_CREDIT &&
                    !(command.kind == MEDIA_CLOSE && command.generation < worker->generation))) {
                fail(worker, "IpcSessionOrGenerationMismatch");
            } else if (command.kind == MEDIA_CLOSE && !command.length && worker->open_received) {
                worker->close_request = command.sequence;
                done = TRUE;
            } else if (command.kind == MEDIA_CREDIT && command.length == 8 && worker->pipeline) {
                if (command.generation > worker->generation ||
                    !media_ipc_credit(&worker->ipc, GST_READ_UINT32_BE(command.payload),
                        GST_READ_UINT32_BE(command.payload + 4)))
                    fail(worker, "InvalidMediaCredit");
            } else if (command.kind >= MEDIA_PAUSE && command.kind <= MEDIA_SEEK && worker->pipeline) {
                control(worker, &command);
            } else {
                fail(worker, "UnsupportedCommand");
            }
            worker->last_command = command.sequence;
        } else if (read < 0) {
            if (read == -2)
                fail(worker, "InvalidIpcFrame");
            done = TRUE;
        }
        if (!done && !failed(worker) && worker->open_received && worker->secrets_complete && !worker->pipeline) {
            if (worker->session != worker->secret_session || !open_native(worker))
                fail(worker, "InvalidScopeOrNativeOpen");
        }
        if (!done && !failed(worker) && !worker->audio_closed) {
            read = media_input_read(&worker->ipc.audio, &command);
            if (read == 1)
                backchannel_input(worker, &command);
            else if (read < 0) {
                worker->audio_closed = TRUE;
                if (read == -2)
                    fail(worker, "InvalidBackchannelFrame");
            }
        }
        poll_bus(worker, worker->bus);
        poll_bus(worker, worker->back_bus);
        if (InterlockedCompareExchange(&worker->ipc.data_failed, 0, 0))
            fail(worker, "DataPipeClosed");
        if ((!worker->pipeline && now - worker->born > 6000000) ||
            (worker->pipeline && (!g_atomic_int_get(&worker->ready) || worker->pending_control) &&
                now - worker->control_started > 8000000))
            fail(worker, "NativeOperationDeadline");
        if (worker->metadata.wire) {
            gboolean expired;
            g_mutex_lock(&worker->mutex);
            expired = media_metadata_expire(&worker->metadata, now);
            g_mutex_unlock(&worker->mutex);
            if (expired)
                gap(worker, 3, "MetadataDeadline");
        }
        if (failed(worker)) {
            gchar *escaped = quote(worker->failure);
            gchar *json = g_strdup_printf("{\"code\":%s,\"execution\":\"see-native-responses\"}", escaped);
            if (worker->control_writable)
                media_ipc_control(&worker->ipc, MEDIA_ERROR, worker->session,
                    worker->generation, worker->request, json);
            g_free(escaped);
            g_free(json);
            done = TRUE;
            error_exit = TRUE;
        }
        drain(worker);
        if (!done && g_atomic_int_get(&worker->ready) && !worker->ready_sent && !error_exit) {
            gchar *tracks = tracks_json(worker);
            gchar *session = quote(worker->native_session);
            gchar *json = g_strdup_printf(
                "{\"state\":\"playing\",\"protocolReady\":true,\"receivingIsSeparate\":true,"
                "\"nativeSessionId\":%s,\"tracks\":%s}", session, tracks);
            for (i = 0; i < 4; ++i) {
                if ((worker->options.tracks & (1u << i)) && !worker->tracks[i].selected)
                    fail(worker, "MissingRequiredTrack");
            }
            if (!failed(worker))
                worker->control_writable = media_ipc_control(&worker->ipc, MEDIA_READY, worker->session,
                    worker->generation, worker->request, json);
            worker->ready_sent = TRUE;
            g_free(session);
            g_free(tracks);
            g_free(json);
        }
        if (!done && worker->control_ready && !worker->control_thread && !error_exit) {
            gchar *json = g_strdup_printf("{\"state\":\"%s\",\"acknowledged\":true,\"command\":%u}",
                worker->paused ? "paused" : "playing", worker->control_ready);
            worker->control_writable = media_ipc_control(&worker->ipc, MEDIA_CONTROL, worker->session,
                worker->generation, worker->request, json);
            worker->control_ready = 0;
            g_free(json);
        }
        {
            guint dropped;
            g_mutex_lock(&worker->ipc.mutex);
            dropped = worker->ipc.discarded_frames;
            g_mutex_unlock(&worker->ipc.mutex);
            if (dropped != worker->last_dropped && !done) {
                event(worker, MEDIA_GAP, g_strdup_printf(
                    "{\"code\":\"ConsumerBackpressure\",\"wholeFramesDropped\":%u}", dropped - worker->last_dropped));
                worker->last_dropped = dropped;
            }
        }
        if (!worker->control_writable)
            done = TRUE;
        if (!done)
            g_usleep(1000);
    }
    local = close_native(worker);
    if (!local)
        ExitProcess(3);
    media_ipc_clear(&worker->ipc);
    media_metadata_clear(&worker->metadata);
    media_options_clear(&worker->options);
    for (i = 0; i < 4; ++i) {
        g_free(worker->tracks[i].encoding);
        g_free(worker->tracks[i].native_track);
        media_jpeg_clear(&worker->tracks[i].jpeg);
    }
    g_free(worker->ca_path);
    g_free(worker->failure);
    g_free(worker->native_session);
    g_mutex_clear(&worker->mutex);
    g_free(worker);
    gst_deinit();
    return error_exit ? 2 : 0;
}
