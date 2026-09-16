#ifndef ONVIF_MEDIA_METADATA_H
#define ONVIF_MEDIA_METADATA_H

#include <gst/rtp/gstrtpbuffer.h>

typedef struct {
    guint32 ssrc, timestamp;
    guint16 sequence;
    guint8 payload_type, replay_flags, play_cseq_low;
    gboolean marker, replay_extension;
    guint64 ntp;
    guint16 jpeg_profile;
    const guint8 *jpeg_extension;
    guint jpeg_length;
} MediaRtp;

typedef struct {
    GByteArray *wire, *xml;
    guint wire_max, inflated_max, deadline_ms;
    gboolean gzip, active, discarding, have_sequence;
    guint32 ssrc, first_timestamp, last_timestamp;
    guint16 first_sequence, last_sequence;
    gint64 started_us;
} MediaMetadata;

enum { MEDIA_META_MORE, MEDIA_META_COMPLETE, MEDIA_META_GAP, MEDIA_META_LIMIT, MEDIA_META_INVALID };

gboolean media_rtp_info(GstRTPBuffer *rtp, MediaRtp *out);
void media_metadata_init(MediaMetadata *state, guint wire_max,
    guint inflated_max, guint deadline_ms, gboolean gzip);
void media_metadata_reset(MediaMetadata *state, gboolean drain);
void media_metadata_clear(MediaMetadata *state);
gboolean media_metadata_xml(const guint8 *bytes, guint length);
gint media_metadata_push(MediaMetadata *state, const MediaRtp *packet,
    const guint8 *bytes, guint length, gint64 now_us);
gboolean media_metadata_expire(MediaMetadata *state, gint64 now_us);

#endif
