#ifndef ONVIF_MEDIA_OPTIONS_H
#define ONVIF_MEDIA_OPTIONS_H

#include "ipc.h"
#include "p0_digest.h"

#define MEDIA_WIRE_MAX (8u * 1024u * 1024u)
#define MEDIA_INFLATED_MAX (32u * 1024u * 1024u)

typedef struct {
    guint32 credential_handle, trust_handle;
    gchar *target_ref, *principal, *origin, *realm, *username, *password;
    gchar *outer_origin, *outer_realm, *outer_username, *outer_password, *ca_pem;
    gboolean allow_md5;
} MediaSecrets;

typedef struct {
    guint8 mode, transport, tracks, flags;
    guint32 credential_handle, trust_handle;
    guint64 start_ntp_ns, end_ntp_ns;
    guint wire_max, inflated_max, deadline_ms, queue_bytes, queue_frames;
    guint max_width, max_height, decoded_max, codecs;
    gchar *uri, *target_ref, *principal, *local_address;
    gchar **origins, **redirects;
    MediaSecrets secrets;
    P0MediaPolicy native_policy;
} MediaOptions;

gboolean media_secrets_parse(MediaSecrets *out, const guint8 *bytes, guint length);
gboolean media_options_parse(MediaOptions *out, const guint8 *bytes, guint length);
gboolean media_options_bind(MediaOptions *options);
gboolean media_target_allowed(const gchar *uri, gboolean redirect, gboolean outer, gpointer context);
gchar *media_origin(const gchar *uri, gboolean outer);
gchar *media_location(const MediaOptions *options);
void media_options_clear(MediaOptions *options);
gboolean media_range_valid(guint64 start, guint64 end);

#endif
