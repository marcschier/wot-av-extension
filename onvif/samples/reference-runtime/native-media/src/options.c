#include "options.h"

#include <gio/gio.h>
#include <string.h>

typedef struct {
    const guint8 *bytes;
    guint length, offset;
    gboolean valid;
} Reader;

static gchar *
string(Reader *reader, guint maximum)
{
    guint length;
    gchar *result;
    if (!reader->valid || reader->length - reader->offset < 2) {
        reader->valid = FALSE;
        return NULL;
    }
    length = GST_READ_UINT16_BE(reader->bytes + reader->offset);
    reader->offset += 2;
    if (length > maximum || length > reader->length - reader->offset ||
        memchr(reader->bytes + reader->offset, 0, length) ||
        !g_utf8_validate((const gchar *) reader->bytes + reader->offset, length, NULL)) {
        reader->valid = FALSE;
        return NULL;
    }
    result = g_strndup((const gchar *) reader->bytes + reader->offset, length);
    reader->offset += length;
    return result;
}

static gchar **
strings(Reader *reader)
{
    gchar **values;
    guint count, i;
    if (!reader->valid || reader->length - reader->offset < 2) {
        reader->valid = FALSE;
        return NULL;
    }
    count = GST_READ_UINT16_BE(reader->bytes + reader->offset);
    reader->offset += 2;
    if (count > 16) {
        reader->valid = FALSE;
        return NULL;
    }
    values = g_new0(gchar *, count + 1);
    for (i = 0; i < count; ++i) {
        values[i] = string(reader, 2048);
        if (!values[i]) {
            g_strfreev(values);
            return NULL;
        }
    }
    return values;
}

gboolean
media_range_valid(guint64 start, guint64 end)
{
    return start >= G_GUINT64_CONSTANT(2208988800000000000) &&
        end > start && end <= G_MAXINT64;
}

gboolean
media_secrets_parse(MediaSecrets *out, const guint8 *bytes, guint length)
{
    Reader reader = {bytes, length, 12, TRUE};
    if (length < 12 || bytes[8] > 1 || bytes[9] || bytes[10] || bytes[11])
        return FALSE;
    out->credential_handle = GST_READ_UINT32_BE(bytes);
    out->trust_handle = GST_READ_UINT32_BE(bytes + 4);
    out->allow_md5 = bytes[8] != 0;
    out->target_ref = string(&reader, 256);
    out->principal = string(&reader, 256);
    out->origin = string(&reader, 2048);
    out->realm = string(&reader, 1024);
    out->username = string(&reader, 1024);
    out->password = string(&reader, 1024);
    out->outer_origin = string(&reader, 2048);
    out->outer_realm = string(&reader, 1024);
    out->outer_username = string(&reader, 1024);
    out->outer_password = string(&reader, 1024);
    out->ca_pem = string(&reader, 32768);
    if (!reader.valid || reader.offset != length || !out->trust_handle ||
        !out->target_ref[0] || !out->principal[0] ||
        (out->credential_handle && (!out->username[0] || !out->realm[0])) ||
        (!out->credential_handle && (out->username[0] || out->password[0] || out->realm[0])) ||
        (out->outer_username[0] && (!out->outer_origin[0] || !out->outer_realm[0])))
        return FALSE;
    return TRUE;
}

gchar *
media_origin(const gchar *uri, gboolean outer)
{
    GUri *parsed;
    gchar *result = NULL;
    const gchar *scheme, *host, *p;
    gint port;
    if (!uri || !*uri || strlen(uri) > 2048 || strpbrk(uri, "\\ \t\r\n"))
        return NULL;
    for (p = uri; *p; ++p) {
        if ((guchar) *p < 0x20 || (guchar) *p == 0x7f)
            return NULL;
    }
    parsed = g_uri_parse(uri, G_URI_FLAGS_ENCODED, NULL);
    if (!parsed)
        return NULL;
    scheme = g_uri_get_scheme(parsed);
    host = g_uri_get_host(parsed);
    port = g_uri_get_port(parsed);
    if (!scheme || !host || !*host || g_uri_get_userinfo(parsed) ||
        g_uri_get_fragment(parsed) || port <= 0 || port > 65535)
        goto done;
    if (outer) {
        if (strcmp(scheme, "http") && strcmp(scheme, "https"))
            goto done;
    } else if (strcmp(scheme, "rtsp") && strcmp(scheme, "rtsps")) {
        goto done;
    }
    result = g_strdup_printf("%s://%s%s%s:%d", scheme, strchr(host, ':') ? "[" : "",
        host, strchr(host, ':') ? "]" : "", port);
done:
    g_uri_unref(parsed);
    return result;
}

static gboolean
origin_list(gchar **values, gboolean required)
{
    guint i;
    if (!values || (required && !values[0]))
        return FALSE;
    for (i = 0; values[i]; ++i) {
        gchar *origin = media_origin(values[i], FALSE);
        gboolean valid = origin && !strcmp(origin, values[i]);
        g_free(origin);
        if (!valid)
            return FALSE;
    }
    return TRUE;
}

gboolean
media_options_parse(MediaOptions *out, const guint8 *bytes, guint length)
{
    Reader reader = {bytes, length, 64, TRUE};
    GInetAddress *address;
    guint i;
    guint *limits[] = {&out->wire_max, &out->inflated_max, &out->deadline_ms,
        &out->queue_bytes, &out->queue_frames, &out->max_width, &out->max_height,
        &out->decoded_max, &out->codecs};
    if (length < 64)
        return FALSE;
    out->mode = bytes[0];
    out->transport = bytes[1];
    out->tracks = bytes[2];
    out->flags = bytes[3];
    out->credential_handle = GST_READ_UINT32_BE(bytes + 4);
    out->trust_handle = GST_READ_UINT32_BE(bytes + 8);
    out->start_ntp_ns = GST_READ_UINT64_BE(bytes + 12);
    out->end_ntp_ns = GST_READ_UINT64_BE(bytes + 20);
    for (i = 0; i < G_N_ELEMENTS(limits); ++i)
        *limits[i] = GST_READ_UINT32_BE(bytes + 28 + i * 4);
    if (out->mode > 1 || out->transport < 1 || out->transport > 5 ||
        !out->tracks || out->tracks > 15 || out->flags > 3 ||
        (!out->credential_handle && !(out->flags & 2)) ||
        (out->credential_handle && (out->flags & 2)) ||
        (out->mode && (!media_range_valid(out->start_ntp_ns, out->end_ntp_ns) ||
            out->transport == 2 || (out->tracks & 8))) ||
        (!out->mode && (out->start_ntp_ns || out->end_ntp_ns)) ||
        !out->wire_max || out->wire_max > MEDIA_WIRE_MAX ||
        !out->inflated_max || out->inflated_max > MEDIA_INFLATED_MAX ||
        !out->deadline_ms || out->deadline_ms > 10000 ||
        out->queue_bytes < 65536 || out->queue_bytes > MEDIA_QUEUE_MAX ||
        !out->queue_frames || out->queue_frames > MEDIA_QUEUE_FRAMES ||
        !out->max_width || out->max_width > 8192 ||
        !out->max_height || out->max_height > 8192 ||
        out->decoded_max < 384 || out->decoded_max > 64u * 1024u * 1024u ||
        !out->codecs || out->codecs > 0x3f)
        return FALSE;
    out->uri = string(&reader, 2048);
    out->target_ref = string(&reader, 256);
    out->principal = string(&reader, 256);
    out->local_address = string(&reader, 64);
    out->origins = strings(&reader);
    out->redirects = strings(&reader);
    if (!reader.valid || reader.offset != length ||
        !out->target_ref[0] || !out->principal[0] ||
        !origin_list(out->origins, TRUE) || !origin_list(out->redirects, FALSE))
        return FALSE;
    address = g_inet_address_new_from_string(out->local_address);
    if (!address || g_inet_address_get_is_any(address) || g_inet_address_get_is_multicast(address)) {
        g_clear_object(&address);
        return FALSE;
    }
    g_object_unref(address);
    return media_target_allowed(out->uri, FALSE, FALSE, out);
}

gboolean
media_target_allowed(const gchar *uri, gboolean redirect, gboolean outer, gpointer context)
{
    const MediaOptions *options = context;
    gchar *origin = media_origin(uri, outer);
    gboolean allowed = FALSE;
    if (!origin)
        return FALSE;
    if (outer) {
        GUri *parsed = g_uri_parse(uri, G_URI_FLAGS_ENCODED, NULL);
        GUri *target = options->uri ? g_uri_parse(options->uri, G_URI_FLAGS_ENCODED, NULL) : NULL;
        const gchar *expected = options->transport == 4 ? "https" : "http";
        allowed = !redirect && parsed && target &&
            !g_strcmp0(g_uri_get_host(parsed), g_uri_get_host(target)) &&
            g_uri_get_port(parsed) == g_uri_get_port(target) &&
            !strcmp(g_uri_get_scheme(parsed), expected);
        if (options->secrets.outer_username && options->secrets.outer_username[0])
            allowed = allowed && !g_strcmp0(origin, options->secrets.outer_origin);
        if (parsed)
            g_uri_unref(parsed);
        if (target)
            g_uri_unref(target);
    } else {
        allowed = g_str_has_prefix(origin, options->transport == 5 ? "rtsps://" : "rtsp://") &&
            options->origins && g_strv_contains((const gchar * const *) options->origins, origin);
        if (redirect)
            allowed = allowed && options->redirects &&
                g_strv_contains((const gchar * const *) options->redirects, origin);
        if (options->secrets.credential_handle)
            allowed = allowed && !g_strcmp0(origin, options->secrets.origin);
    }
    g_free(origin);
    return allowed;
}

gboolean
media_options_bind(MediaOptions *options)
{
    MediaSecrets *secrets = &options->secrets;
    gchar *origin = media_origin(options->uri, FALSE);
    gboolean valid = origin && !g_strcmp0(origin, secrets->origin) &&
        !g_strcmp0(options->target_ref, secrets->target_ref) &&
        !g_strcmp0(options->principal, secrets->principal) &&
        options->credential_handle == secrets->credential_handle &&
        options->trust_handle == secrets->trust_handle;
    g_free(origin);
    if (!valid)
        return FALSE;
    options->native_policy = (P0MediaPolicy) {
        .rtsp = {secrets->realm, secrets->username, secrets->password, secrets->allow_md5},
        .http = {secrets->outer_realm, secrets->outer_username, secrets->outer_password, secrets->allow_md5},
        .native_origin = secrets->origin,
        .outer_origin = secrets->outer_origin,
        .local_address = options->local_address,
        .authorize = media_target_allowed,
        .context = options
    };
    return TRUE;
}

gchar *
media_location(const MediaOptions *options)
{
    const gchar *scheme = options->transport == 3 ? "rtsph" :
        options->transport == 4 ? "rtspsh" :
        options->transport == 5 ? "rtsps" : "rtsp";
    const gchar *suffix = strstr(options->uri, "://");
    return suffix ? g_strconcat(scheme, suffix, NULL) : NULL;
}

static void
clear_secret(gchar *value)
{
    if (value) {
        SecureZeroMemory(value, strlen(value));
        g_free(value);
    }
}

void
media_options_clear(MediaOptions *options)
{
    MediaSecrets *secret = &options->secrets;
    g_free(options->uri);
    g_free(options->target_ref);
    g_free(options->principal);
    g_free(options->local_address);
    g_strfreev(options->origins);
    g_strfreev(options->redirects);
    g_free(secret->target_ref);
    g_free(secret->principal);
    g_free(secret->origin);
    g_free(secret->realm);
    clear_secret(secret->username);
    clear_secret(secret->password);
    g_free(secret->outer_origin);
    g_free(secret->outer_realm);
    clear_secret(secret->outer_username);
    clear_secret(secret->outer_password);
    g_free(secret->ca_pem);
    SecureZeroMemory(options, sizeof(*options));
}
