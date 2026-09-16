#ifndef ONVIF_P0_DIGEST_H
#define ONVIF_P0_DIGEST_H

#include <gst/rtsp/gstrtspmessage.h>
#include <gst/rtsp/gstrtspconnection.h>

typedef struct {
    const gchar *realm, *username, *password;
    gboolean allow_md5;
} P0MediaAuth;

typedef struct {
    P0MediaAuth rtsp, http;
    const gchar *native_origin, *outer_origin, *local_address;
    gboolean (*authorize)(const gchar *uri, gboolean redirect, gboolean outer, gpointer context);
    gpointer context;
} P0MediaPolicy;

typedef struct {
    gchar *nonce;
    gchar *realm;
    gchar cnonce[33];
    guint32 count;
    gint strongest;
} P0DigestState;

gint p0_digest_rank(const gchar *algorithm, const gchar *qop,
    const gchar *charset, const gchar *userhash);
gint p0_digest_params_rank(GstRTSPAuthParam **params);
gchar *p0_digest_response(const gchar *algorithm, const gchar *method,
    const gchar *realm, const gchar *user, const gchar *password,
    const gchar *uri, const gchar *nonce, const gchar *cnonce,
    guint32 count, gboolean auth_qop);
gchar *p0_digest_header(P0DigestState *state, GHashTable *params,
    const gchar *method, const gchar *user, const gchar *password,
    const gchar *uri);
void p0_digest_clear(P0DigestState *state);
GHashTable *p0_digest_select(GstRTSPMessage *response, const P0MediaAuth *policy);
GST_RTSP_API gboolean gst_rtsp_connection_set_media_policy(
    GstRTSPConnection *connection, P0MediaPolicy *policy);
GST_RTSP_API gboolean gst_rtsp_connection_set_media_auth(
    GstRTSPConnection *connection, GstRTSPMessage *response);
GST_RTSP_API const gchar *gst_rtsp_connection_media_revision(void);

#endif
