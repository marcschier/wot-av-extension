#include "p0_digest.h"

#include <windows.h>
#include <bcrypt.h>
#include <string.h>

static gboolean
safe_ascii(const gchar *value)
{
    const guchar *p = (const guchar *) value;
    if (!value || strlen(value) > 2048 || !g_utf8_validate(value, -1, NULL))
        return FALSE;
    for (; *p; ++p) {
        if (*p < 0x20 || *p == 0x7f)
            return FALSE;
    }
    return TRUE;
}

gint
p0_digest_rank(const gchar *algorithm, const gchar *qop,
    const gchar *charset, const gchar *userhash)
{
    gboolean md5 = !algorithm || g_ascii_strcasecmp(algorithm, "MD5") == 0;
    gboolean sha256 = algorithm && g_ascii_strcasecmp(algorithm, "SHA-256") == 0;
    gboolean has_auth = FALSE;
    gchar **tokens;
    guint i;

    if ((!md5 && !sha256) ||
        (charset && g_ascii_strcasecmp(charset, "UTF-8") != 0) ||
        (userhash && g_ascii_strcasecmp(userhash, "false") != 0))
        return 0;
    if (!qop)
        return md5 ? 1 : 0;
    if (!safe_ascii(qop))
        return 0;
    tokens = g_strsplit(qop, ",", 17);
    for (i = 0; tokens[i] && i < 16; ++i) {
        if (g_ascii_strcasecmp(g_strstrip(tokens[i]), "auth") == 0)
            has_auth = TRUE;
    }
    if (tokens[i])
        has_auth = FALSE;
    g_strfreev(tokens);
    return has_auth ? (sha256 ? 3 : 2) : 0;
}

gint
p0_digest_params_rank(GstRTSPAuthParam **params)
{
    GHashTable *values = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);
    gint result = 0;
    guint i;
    const gchar *realm, *nonce;

    if (!params)
        goto done;
    for (i = 0; params[i]; ++i) {
        gchar *key;
        if (i >= 32 || !safe_ascii(params[i]->name) ||
            !safe_ascii(params[i]->value))
            goto done;
        key = g_ascii_strdown(params[i]->name, -1);
        if (g_hash_table_contains(values, key)) {
            g_free(key);
            goto done;
        }
        g_hash_table_insert(values, key, params[i]->value);
    }
    realm = g_hash_table_lookup(values, "realm");
    nonce = g_hash_table_lookup(values, "nonce");
    if (!realm || !nonce || !*nonce)
        goto done;
    result = p0_digest_rank(
        g_hash_table_lookup(values, "algorithm"),
        g_hash_table_lookup(values, "qop"),
        g_hash_table_lookup(values, "charset"),
        g_hash_table_lookup(values, "userhash"));
done:
    g_hash_table_unref(values);
    return result;
}

gchar *
p0_digest_response(const gchar *algorithm, const gchar *method,
    const gchar *realm, const gchar *user, const gchar *password,
    const gchar *uri, const gchar *nonce, const gchar *cnonce,
    guint32 count, gboolean auth_qop)
{
    GChecksumType type;
    gchar *a1, *a2, *ha1, *ha2, *input, *response;

    if (!safe_ascii(method) || !safe_ascii(realm) || !safe_ascii(user) ||
        !safe_ascii(password) || !safe_ascii(uri) || !safe_ascii(nonce) ||
        (auth_qop && (!safe_ascii(cnonce) || !*cnonce || !count)))
        return NULL;
    if (!algorithm || g_ascii_strcasecmp(algorithm, "MD5") == 0)
        type = G_CHECKSUM_MD5;
    else if (g_ascii_strcasecmp(algorithm, "SHA-256") == 0 && auth_qop)
        type = G_CHECKSUM_SHA256;
    else
        return NULL;
    a1 = g_strdup_printf("%s:%s:%s", user, realm, password);
    a2 = g_strdup_printf("%s:%s", method, uri);
    ha1 = g_compute_checksum_for_string(type, a1, -1);
    ha2 = g_compute_checksum_for_string(type, a2, -1);
    SecureZeroMemory(a1, strlen(a1));
    g_free(a1);
    g_free(a2);
    if (auth_qop)
        input = g_strdup_printf("%s:%s:%08x:%s:auth:%s",
            ha1, nonce, count, cnonce, ha2);
    else
        input = g_strdup_printf("%s:%s:%s", ha1, nonce, ha2);
    response = g_compute_checksum_for_string(type, input, -1);
    SecureZeroMemory(ha1, strlen(ha1));
    SecureZeroMemory(input, strlen(input));
    g_free(ha1);
    g_free(ha2);
    g_free(input);
    return response;
}

static void
append_quoted(GString *output, const gchar *value)
{
    g_string_append_c(output, '"');
    for (; *value; ++value) {
        if (*value == '"' || *value == '\\')
            g_string_append_c(output, '\\');
        g_string_append_c(output, *value);
    }
    g_string_append_c(output, '"');
}

gchar *
p0_digest_header(P0DigestState *state, GHashTable *params,
    const gchar *method, const gchar *user, const gchar *password,
    const gchar *uri)
{
    const gchar *realm, *nonce, *algorithm, *opaque;
    gint rank;
    gchar *response;
    GString *header;
    guint i;

    if (!params || !state)
        return NULL;
    realm = g_hash_table_lookup(params, "realm");
    nonce = g_hash_table_lookup(params, "nonce");
    algorithm = g_hash_table_lookup(params, "algorithm");
    opaque = g_hash_table_lookup(params, "opaque");
    rank = p0_digest_rank(algorithm, g_hash_table_lookup(params, "qop"),
        g_hash_table_lookup(params, "charset"), g_hash_table_lookup(params, "userhash"));
    if (!rank || rank < state->strongest || !safe_ascii(realm) ||
        !safe_ascii(nonce) || !*nonce || (opaque && !safe_ascii(opaque)) ||
        (state->realm && strcmp(state->realm, realm) != 0))
        return NULL;
    if (!safe_ascii(user) || strchr(user, ':') || !safe_ascii(password) ||
        !safe_ascii(method) || !safe_ascii(uri))
        return NULL;
    if (!state->realm)
        state->realm = g_strdup(realm);
    if (g_strcmp0(state->nonce, nonce) != 0) {
        g_free(state->nonce);
        state->nonce = g_strdup(nonce);
        state->count = 0;
        state->cnonce[0] = '\0';
    }
    if (rank > 1 && !state->cnonce[0]) {
        guchar random[16];
        if (BCryptGenRandom(NULL, random, sizeof(random),
                BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
            return NULL;
        for (i = 0; i < sizeof(random); ++i)
            g_snprintf(state->cnonce + 2 * i, 3, "%02x", random[i]);
        SecureZeroMemory(random, sizeof(random));
    }
    if (state->count == G_MAXUINT32)
        return NULL;
    ++state->count;
    algorithm = rank == 3 ? "SHA-256" : "MD5";
    response = p0_digest_response(algorithm, method, realm, user, password,
        uri, nonce, state->cnonce, state->count, rank > 1);
    if (!response)
        return NULL;
    state->strongest = MAX(state->strongest, rank);
    header = g_string_new("Digest username=");
    append_quoted(header, user);
    g_string_append(header, ", realm=");
    append_quoted(header, realm);
    g_string_append(header, ", nonce=");
    append_quoted(header, nonce);
    g_string_append(header, ", uri=");
    append_quoted(header, uri);
    g_string_append(header, ", response=");
    append_quoted(header, response);
    g_string_append_printf(header, ", algorithm=%s", algorithm);
    if (rank > 1) {
        g_string_append_printf(header, ", qop=auth, nc=%08x, cnonce=", state->count);
        append_quoted(header, state->cnonce);
    }
    if (opaque) {
        g_string_append(header, ", opaque=");
        append_quoted(header, opaque);
    }
    g_free(response);
    return g_string_free(header, FALSE);
}

void
p0_digest_clear(P0DigestState *state)
{
    g_free(state->nonce);
    g_free(state->realm);
    SecureZeroMemory(state, sizeof(*state));
}

GHashTable *
p0_digest_select(GstRTSPMessage *response, const P0MediaAuth *policy)
{
    GstRTSPAuthCredential **credentials, *selected = NULL;
    GHashTable *result = NULL;
    guint i;
    gint strongest = 0;
    if (!policy || !policy->username || !*policy->username || !policy->realm)
        return NULL;
    credentials = gst_rtsp_message_parse_auth_credentials(response, GST_RTSP_HDR_WWW_AUTHENTICATE);
    if (!credentials)
        return NULL;
    for (i = 0; credentials[i]; ++i) {
        GstRTSPAuthCredential *candidate = credentials[i];
        gint rank;
        guint j;
        const gchar *realm = NULL;
        if (i >= 8) {
            selected = NULL;
            break;
        }
        if (candidate->scheme != GST_RTSP_AUTH_DIGEST)
            continue;
        rank = p0_digest_params_rank(candidate->params);
        if (!rank || (rank < 3 && !policy->allow_md5))
            continue;
        for (j = 0; candidate->params[j]; ++j) {
            if (!g_ascii_strcasecmp(candidate->params[j]->name, "realm"))
                realm = candidate->params[j]->value;
        }
        if (g_strcmp0(realm, policy->realm) || rank <= strongest)
            continue;
        strongest = rank;
        selected = candidate;
    }
    if (selected) {
        result = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, g_free);
        for (i = 0; selected->params[i]; ++i)
            g_hash_table_insert(result, g_ascii_strdown(selected->params[i]->name, -1),
                g_strdup(selected->params[i]->value));
    }
    gst_rtsp_auth_credentials_free(credentials);
    return result;
}
