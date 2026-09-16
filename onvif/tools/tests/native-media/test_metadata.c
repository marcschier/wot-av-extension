#include "p0_metadata.h"
#include <string.h>

static const gchar xml[] =
    "<m:MetadataStream xmlns:m=\"http://www.onvif.org/ver10/schema\">"
    "<m:VideoAnalytics><m:Frame UtcTime=\"2026-09-15T12:00:00.25Z\"/>"
    "</m:VideoAnalytics></m:MetadataStream>";

static void
test_fragments_and_gap(void)
{
    P0Metadata state = {0};
    P0RtpInfo packet = {0};
    guint cut = 73;
    packet.ssrc = 1234;
    packet.sequence = 65535;
    packet.timestamp = 0xfffffff0;
    g_assert_cmpint(p0_metadata_push(&state, &packet, (const guint8 *) xml, cut, 100), ==, P0_META_MORE);
    packet.sequence = 0;
    packet.timestamp = 123;
    packet.marker = TRUE;
    g_assert_cmpint(p0_metadata_push(&state, &packet, (const guint8 *) xml + cut,
        (guint) strlen(xml) - cut, 200), ==, P0_META_COMPLETE);
    g_assert_cmpuint(state.first_timestamp, ==, 0xfffffff0);
    g_assert_cmpuint(state.last_timestamp, ==, 123);
    g_assert_cmpmem(state.bytes, state.length, xml, strlen(xml));
    packet.sequence = 10;
    packet.marker = FALSE;
    g_assert_cmpint(p0_metadata_push(&state, &packet, (const guint8 *) xml, cut, 300), ==, P0_META_MORE);
    packet.sequence = 12;
    packet.marker = TRUE;
    g_assert_cmpint(p0_metadata_push(&state, &packet, (const guint8 *) xml + cut,
        (guint) strlen(xml) - cut, 400), ==, P0_META_GAP);
    packet.sequence = 13;
    g_assert_cmpint(p0_metadata_push(&state, &packet, (const guint8 *) xml,
        (guint) strlen(xml), 500), ==, P0_META_COMPLETE);
}

static void
test_xml_boundary(void)
{
    static const gchar *bad[] = {
        "<MetadataStream><VideoAnalytics><Frame UtcTime=\"x\"/></VideoAnalytics></MetadataStream>",
        "<m:MetadataStream xmlns:m=\"http://www.onvif.org/ver10/schema\"><m:Frame UtcTime=\"x\"/></m:MetadataStream>",
        "<!DOCTYPE x [<!ENTITY x SYSTEM \"file:///not-permitted\">]><x>&x;</x>",
        "<m:MetadataStream xmlns:m=\"http://www.onvif.org/ver10/schema\"><m:VideoAnalytics><m:Frame UtcTime=\"x\"/></m:VideoAnalytics></m:MetadataStream>broken",
        "<broken"
    };
    guint i;
    g_assert_true(p0_metadata_xml((const guint8 *) xml, (guint) strlen(xml)));
    for (i = 0; i < G_N_ELEMENTS(bad); ++i)
        g_assert_false(p0_metadata_xml((const guint8 *) bad[i], (guint) strlen(bad[i])));
}

static void
test_deadline_and_ssrc(void)
{
    P0Metadata state = {0};
    P0RtpInfo packet = {0};
    packet.ssrc = 1;
    packet.sequence = 1;
    g_assert_cmpint(p0_metadata_push(&state, &packet, (const guint8 *) xml, 10, 1), ==, P0_META_MORE);
    g_assert_true(p0_metadata_expire(&state, P0_METADATA_DEADLINE_US + 2));
    packet.sequence = 2;
    packet.marker = TRUE;
    g_assert_cmpint(p0_metadata_push(&state, &packet, (const guint8 *) xml,
        (guint) strlen(xml), P0_METADATA_DEADLINE_US + 3), ==, P0_META_MORE);
    packet.marker = FALSE;
    packet.sequence = 3;
    g_assert_cmpint(p0_metadata_push(&state, &packet, (const guint8 *) xml, 10,
        P0_METADATA_DEADLINE_US + 4), ==, P0_META_MORE);
    packet.ssrc = 2;
    packet.sequence = 4;
    g_assert_cmpint(p0_metadata_push(&state, &packet, (const guint8 *) xml, 10,
        P0_METADATA_DEADLINE_US + 5), ==, P0_META_GAP);
}

static void
test_replay_packet(void)
{
    guint8 packet[29] = {0x90, 0x80 | 110};
    GstBuffer *buffer;
    GstRTPBuffer rtp = GST_RTP_BUFFER_INIT;
    P0RtpInfo info;
    GST_WRITE_UINT16_BE(packet + 2, 65535);
    GST_WRITE_UINT32_BE(packet + 4, 123);
    GST_WRITE_UINT32_BE(packet + 8, 0x11223344);
    GST_WRITE_UINT16_BE(packet + 12, 0xabac);
    GST_WRITE_UINT16_BE(packet + 14, 3);
    GST_WRITE_UINT64_BE(packet + 16, G_GUINT64_CONSTANT(0xee53354040000000));
    packet[24] = 0xf0;
    packet[25] = 0x23;
    packet[28] = 'x';
    buffer = gst_buffer_new_allocate(NULL, sizeof(packet), NULL);
    gst_buffer_fill(buffer, 0, packet, sizeof(packet));
    g_assert_true(gst_rtp_buffer_map(buffer, GST_MAP_READ, &rtp));
    g_assert_true(p0_rtp_info(&rtp, &info));
    g_assert_true(info.replay_extension);
    g_assert_cmphex(info.ntp, ==, G_GUINT64_CONSTANT(0xee53354040000000));
    g_assert_cmpuint(info.play_cseq_low, ==, 0x23);
    g_assert_cmpuint(info.replay_flags, ==, 0xf0);
    g_assert_cmpuint(info.sequence, ==, 65535);
    gst_rtp_buffer_unmap(&rtp);
    gst_buffer_unref(buffer);
}

int
main(int argc, char **argv)
{
    gst_init(&argc, &argv);
    g_test_init(&argc, &argv, NULL);
    g_test_add_func("/metadata/marker-wrap-changing-timestamps-gap", test_fragments_and_gap);
    g_test_add_func("/metadata/xml-subset-and-no-external-content", test_xml_boundary);
    g_test_add_func("/metadata/deadline-ssrc", test_deadline_and_ssrc);
    g_test_add_func("/metadata/native-replay-header", test_replay_packet);
    return g_test_run();
}
