#ifndef ONVIF_TEST_P0_METADATA_H
#define ONVIF_TEST_P0_METADATA_H

#include <gst/rtp/gstrtpbuffer.h>

#define P0_METADATA_MAX 32768
#define P0_METADATA_DEADLINE_US (2 * G_USEC_PER_SEC)

typedef struct {
    guint32 ssrc, timestamp;
    guint16 sequence;
    guint8 payload_type, replay_flags, play_cseq_low;
    gboolean marker, replay_extension;
    guint64 ntp;
} P0RtpInfo;

typedef struct {
    guint8 bytes[P0_METADATA_MAX];
    guint length;
    gboolean active, discarding;
    guint32 ssrc, first_timestamp, last_timestamp;
    guint16 first_sequence, last_sequence;
    gint64 started_us;
} P0Metadata;

enum { P0_META_MORE, P0_META_COMPLETE, P0_META_GAP, P0_META_LIMIT, P0_META_INVALID };

gboolean p0_rtp_info(GstRTPBuffer *rtp, P0RtpInfo *info);
gboolean p0_metadata_xml(const guint8 *bytes, guint length);
gint p0_metadata_push(P0Metadata *state, const P0RtpInfo *packet,
    const guint8 *bytes, guint length, gint64 now_us);
gboolean p0_metadata_expire(P0Metadata *state, gint64 now_us);

#endif
