#ifndef ONVIF_TEST_P0_IPC_H
#define ONVIF_TEST_P0_IPC_H

#include <gst/gst.h>
#include <windows.h>

#define P0_PROTOCOL 1
#define P0_HEADER_SIZE 24
#define P0_CONTROL_MAX 4096
#define P0_DATA_MAX 65536
#define P0_QUEUE_MAX (1024 * 1024)
#define P0_QUEUE_FRAMES 64

enum {
    P0_OPEN = 1, P0_CLOSE = 2,
    P0_HELLO = 0x8001, P0_READY = 0x8002, P0_CLOSED = 0x8003,
    P0_ERROR = 0x8004, P0_RTSP_RESPONSE = 0x8005, P0_GAP = 0x8006,
    P0_NATIVE_DIAGNOSTIC = 0x8007,
    P0_RTP = 0x9001, P0_DECODED = 0x9002, P0_METADATA = 0x9003
};

typedef struct {
    guint16 kind;
    guint32 session, generation, sequence, length;
    guint8 payload[P0_CONTROL_MAX];
} P0Command;

typedef struct {
    HANDLE input, control, data, wake, writer;
    GMutex mutex;
    GQueue frames;
    guint queued_bytes, queued_frames, peak_bytes, discarded_frames;
    guint32 data_sequence;
    volatile LONG stopping, data_failed;
    guint8 input_bytes[P0_HEADER_SIZE + P0_CONTROL_MAX];
    guint input_length;
} P0Ipc;

void p0_header(guint8 *out, guint16 kind, guint32 session,
    guint32 generation, guint32 sequence, guint32 length);
gboolean p0_ipc_init(P0Ipc *ipc, HANDLE data);
gint p0_ipc_read(P0Ipc *ipc, P0Command *command);
gboolean p0_ipc_control(P0Ipc *ipc, guint16 kind, guint32 session,
    guint32 generation, guint32 sequence, const gchar *json);
gboolean p0_ipc_data(P0Ipc *ipc, guint16 kind, guint32 session,
    guint32 generation, const guint8 *payload, guint32 length);
gboolean p0_ipc_stop_data(P0Ipc *ipc);
void p0_ipc_clear(P0Ipc *ipc);

#endif
