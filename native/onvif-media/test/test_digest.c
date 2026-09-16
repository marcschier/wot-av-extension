#include "p0_digest.h"
#include <string.h>

static void
test_rfc_vectors(void)
{
    static const struct {
        const char *algorithm, *realm, *password, *nonce, *cnonce, *expected;
        gboolean qop;
    } vectors[] = {
        {
            "MD5", "testrealm@host.com", "Circle Of Life",
            "dcd98b7102dd2f0e8b11d0f600bfb0c093", "0a4f113b",
            "6629fae49393a05397450978507c4ef1", TRUE
        },
        {
            "MD5", "http-auth@example.org", "Circle of Life",
            "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
            "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
            "8ca523f5e9506fed4657c9700eebdbec", TRUE
        },
        {
            "SHA-256", "http-auth@example.org", "Circle of Life",
            "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
            "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
            "753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1", TRUE
        },
        {
            "MD5", "testrealm@host.com", "Circle Of Life",
            "dcd98b7102dd2f0e8b11d0f600bfb0c093", NULL,
            "670fd8c2df070c60b045671b8b24ff02", FALSE
        }
    };
    guint i;
    for (i = 0; i < G_N_ELEMENTS(vectors); ++i) {
        gchar *actual = p0_digest_response(vectors[i].algorithm, "GET",
            vectors[i].realm, "Mufasa", vectors[i].password, "/dir/index.html",
            vectors[i].nonce, vectors[i].cnonce, 1, vectors[i].qop);
        g_assert_cmpstr(actual, ==, vectors[i].expected);
        g_free(actual);
    }
}

static void
test_policy(void)
{
    g_assert_cmpint(p0_digest_rank(NULL, NULL, NULL, NULL), ==, 1);
    g_assert_cmpint(p0_digest_rank("MD5", "auth-int, auth", NULL, NULL), ==, 2);
    g_assert_cmpint(p0_digest_rank("SHA-256", "auth", "UTF-8", "false"), ==, 3);
    g_assert_cmpint(p0_digest_rank("SHA-256", NULL, NULL, NULL), ==, 0);
    g_assert_cmpint(p0_digest_rank("MD5", "auth-int", NULL, NULL), ==, 0);
    g_assert_cmpint(p0_digest_rank("MD5-sess", "auth", NULL, NULL), ==, 0);
    g_assert_cmpint(p0_digest_rank("SHA-512-256", "auth", NULL, NULL), ==, 0);
    g_assert_cmpint(p0_digest_rank("SHA-256", "auth", NULL, "true"), ==, 0);
    g_assert_cmpint(p0_digest_rank("SHA-256", "auth", "ISO-8859-1", NULL), ==, 0);
    g_assert_null(p0_digest_response("SHA-256", "PLAY", "r", "u", "p",
        "rtsp://127.0.0.1/p0", "n", "", 1, TRUE));
}

static GHashTable *
parameters(void)
{
    GHashTable *params = g_hash_table_new(g_str_hash, g_str_equal);
    g_hash_table_insert(params, "realm", "onvif-p0");
    g_hash_table_insert(params, "nonce", "nonce-one");
    g_hash_table_insert(params, "algorithm", "SHA-256");
    g_hash_table_insert(params, "qop", "auth");
    g_hash_table_insert(params, "opaque", "quoted\"slash\\value");
    return params;
}

static void
test_nonce_and_downgrade(void)
{
    P0DigestState state = {0};
    GHashTable *params = parameters();
    gchar cnonce[33];
    gchar *header = p0_digest_header(&state, params, "DESCRIBE", "fixture",
        "not-a-camera-password", "rtsp://127.0.0.1:9999/p0?exact=a%2Fb");
    g_assert_nonnull(header);
    g_assert_nonnull(strstr(header, "nc=00000001"));
    g_assert_nonnull(strstr(header, "opaque=\"quoted\\\"slash\\\\value\""));
    g_assert_cmpuint(strlen(state.cnonce), ==, 32);
    memcpy(cnonce, state.cnonce, sizeof(cnonce));
    g_free(header);
    header = p0_digest_header(&state, params, "SETUP", "fixture",
        "not-a-camera-password", "rtsp://127.0.0.1:9999/p0/track");
    g_assert_nonnull(header);
    g_assert_nonnull(strstr(header, "nc=00000002"));
    g_assert_cmpstr(state.cnonce, ==, cnonce);
    g_free(header);
    g_hash_table_insert(params, "nonce", "nonce-two");
    header = p0_digest_header(&state, params, "PLAY", "fixture",
        "not-a-camera-password", "rtsp://127.0.0.1:9999/p0");
    g_assert_nonnull(header);
    g_assert_nonnull(strstr(header, "nc=00000001"));
    g_assert_cmpstr(state.cnonce, !=, cnonce);
    g_free(header);
    g_hash_table_insert(params, "algorithm", "MD5");
    g_assert_null(p0_digest_header(&state, params, "PLAY", "fixture",
        "not-a-camera-password", "rtsp://127.0.0.1:9999/p0"));
    g_hash_table_insert(params, "algorithm", "SHA-256");
    state.count = G_MAXUINT32;
    g_assert_null(p0_digest_header(&state, params, "PLAY", "fixture",
        "not-a-camera-password", "rtsp://127.0.0.1:9999/p0"));
    p0_digest_clear(&state);
    g_assert_null(state.nonce);
    g_hash_table_unref(params);
}

static void
test_ambiguous_challenge(void)
{
    GstRTSPAuthParam realm = {"realm", "onvif-p0"};
    GstRTSPAuthParam nonce = {"nonce", "nonce"};
    GstRTSPAuthParam duplicate = {"REALM", "other"};
    GstRTSPAuthParam bad = {"opaque", "injected\r\nAuthorization: Basic bad"};
    GstRTSPAuthParam *valid[] = {&realm, &nonce, NULL};
    GstRTSPAuthParam *ambiguous[] = {&realm, &nonce, &duplicate, NULL};
    GstRTSPAuthParam *injection[] = {&realm, &nonce, &bad, NULL};
    g_assert_cmpint(p0_digest_params_rank(valid), ==, 1);
    g_assert_cmpint(p0_digest_params_rank(ambiguous), ==, 0);
    g_assert_cmpint(p0_digest_params_rank(injection), ==, 0);
}

int
main(int argc, char **argv)
{
    g_test_init(&argc, &argv, NULL);
    g_test_add_func("/digest/rfc-literal-vectors", test_rfc_vectors);
    g_test_add_func("/digest/declared-policy", test_policy);
    g_test_add_func("/digest/nonce-downgrade-bounds", test_nonce_and_downgrade);
    g_test_add_func("/digest/ambiguous-injected-challenge", test_ambiguous_challenge);
    return g_test_run();
}
