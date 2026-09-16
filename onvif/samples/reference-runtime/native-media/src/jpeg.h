#ifndef ONVIF_MEDIA_JPEG_H
#define ONVIF_MEDIA_JPEG_H

#include "metadata.h"

#define MEDIA_JPEG_HEADER_MAX 65536u

typedef struct {
    GByteArray *headers;
    guint32 ssrc, timestamp;
    guint16 sequence;
    gboolean active, complete;
} MediaJpeg;

enum {
    MEDIA_JPEG_LEGACY, MEDIA_JPEG_MORE, MEDIA_JPEG_COMPLETE,
    MEDIA_JPEG_INVALID, MEDIA_JPEG_LIMIT, MEDIA_JPEG_UNSUPPORTED
};

void media_jpeg_init(MediaJpeg *state);
void media_jpeg_reset(MediaJpeg *state);
void media_jpeg_clear(MediaJpeg *state);
gint media_jpeg_push(MediaJpeg *state, const MediaRtp *packet);
gint media_jpeg_rewrite(MediaJpeg *state, GstBuffer *input, guint maximum,
    guint max_width, guint max_height, GstBuffer **output, guint *width, guint *height);

#endif
