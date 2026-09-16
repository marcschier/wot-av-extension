#include "terminal.h"
#include "metadata.h"

typedef struct {
    GstElement parent;
    GstPad *sink, *src;
    gboolean pending, ended;
} MediaTerminal;

typedef struct {
    GstElementClass parent;
} MediaTerminalClass;

G_DEFINE_TYPE(MediaTerminal, media_terminal, GST_TYPE_ELEMENT)

static GstStaticPadTemplate sink_template = GST_STATIC_PAD_TEMPLATE(
    "sink", GST_PAD_SINK, GST_PAD_ALWAYS, GST_STATIC_CAPS("application/x-rtp"));
static GstStaticPadTemplate src_template = GST_STATIC_PAD_TEMPLATE(
    "src", GST_PAD_SRC, GST_PAD_ALWAYS, GST_STATIC_CAPS("application/x-rtp"));

static GstFlowReturn
chain(GstPad *pad, GstObject *parent, GstBuffer *buffer)
{
    MediaTerminal *self = (MediaTerminal *) parent;
    GstRTPBuffer rtp = GST_RTP_BUFFER_INIT;
    MediaRtp packet;
    GstFlowReturn result;
    gboolean terminal;
    (void) pad;
    if (self->ended) {
        gst_buffer_unref(buffer);
        return GST_FLOW_OK;
    }
    if (!gst_rtp_buffer_map(buffer, GST_MAP_READ, &rtp)) {
        gst_buffer_unref(buffer);
        return GST_FLOW_ERROR;
    }
    if (!media_rtp_info(&rtp, &packet)) {
        gst_rtp_buffer_unmap(&rtp);
        gst_buffer_unref(buffer);
        return GST_FLOW_ERROR;
    }
    if (packet.replay_extension && (packet.replay_flags & 0x10))
        self->pending = TRUE;
    terminal = self->pending && packet.marker;
    gst_rtp_buffer_unmap(&rtp);
    result = gst_pad_push(self->src, buffer);
    if (result == GST_FLOW_OK && terminal) {
        self->ended = TRUE;
        if (!gst_pad_push_event(self->src, gst_event_new_eos()))
            return GST_FLOW_ERROR;
    }
    return result;
}

static gboolean
sink_event(GstPad *pad, GstObject *parent, GstEvent *event)
{
    MediaTerminal *self = (MediaTerminal *) parent;
    (void) pad;
    if (GST_EVENT_TYPE(event) == GST_EVENT_FLUSH_STOP)
        self->pending = self->ended = FALSE;
    return gst_pad_push_event(self->src, event);
}

static gboolean
src_event(GstPad *pad, GstObject *parent, GstEvent *event)
{
    MediaTerminal *self = (MediaTerminal *) parent;
    (void) pad;
    return gst_pad_push_event(self->sink, event);
}

static void
media_terminal_class_init(MediaTerminalClass *klass)
{
    GstElementClass *element = GST_ELEMENT_CLASS(klass);
    gst_element_class_set_static_metadata(element, "ONVIF terminal drain",
        "Filter/Network/RTP", "Deliver the complete terminal access unit before EOS",
        "ONVIF native reference");
    gst_element_class_add_static_pad_template(element, &sink_template);
    gst_element_class_add_static_pad_template(element, &src_template);
}

static void
media_terminal_init(MediaTerminal *self)
{
    self->sink = gst_pad_new_from_static_template(&sink_template, "sink");
    self->src = gst_pad_new_from_static_template(&src_template, "src");
    gst_pad_set_chain_function(self->sink, chain);
    gst_pad_set_event_function(self->sink, sink_event);
    gst_pad_set_event_function(self->src, src_event);
    GST_PAD_SET_PROXY_CAPS(self->sink);
    GST_PAD_SET_PROXY_CAPS(self->src);
    GST_PAD_SET_PROXY_ALLOCATION(self->sink);
    gst_element_add_pad(GST_ELEMENT(self), self->sink);
    gst_element_add_pad(GST_ELEMENT(self), self->src);
}

GstElement *
media_terminal_new(void)
{
    return g_object_new(media_terminal_get_type(), NULL);
}
