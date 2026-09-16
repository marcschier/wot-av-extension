#ifndef ONVIF_MEDIA_IPC_H
#define ONVIF_MEDIA_IPC_H

#include <gst/gst.h>
#include <windows.h>

#define MEDIA_PROTOCOL 2
#define MEDIA_HEADER 24
#define MEDIA_CONTROL_MAX 65536
#define MEDIA_DATA_MAX (64u * 1024u * 1024u + 64u)
#define MEDIA_QUEUE_MAX (128u * 1024u * 1024u)
#define MEDIA_QUEUE_FRAMES 256u

enum {
    MEDIA_OPEN = 1, MEDIA_CLOSE, MEDIA_PAUSE, MEDIA_PLAY, MEDIA_SEEK, MEDIA_CREDIT,
    MEDIA_SECURITY = 0x10,
    MEDIA_BACKCHANNEL = 0x1001,
    MEDIA_HELLO = 0x8001, MEDIA_READY, MEDIA_CLOSED, MEDIA_ERROR,
    MEDIA_RESPONSE, MEDIA_GAP, MEDIA_DIAGNOSTIC, MEDIA_CONTROL, MEDIA_END,
    MEDIA_RTP = 0x9001, MEDIA_DECODED, MEDIA_METADATA, MEDIA_RTCP
};

typedef struct {
    guint16 kind;
    guint32 session, generation, sequence, length;
    guint8 payload[MEDIA_CONTROL_MAX];
} MediaCommand;

typedef struct {
    HANDLE handle;
    guint8 bytes[MEDIA_HEADER + MEDIA_CONTROL_MAX];
    guint length;
    gint64 incomplete_since;
} MediaInput;

typedef struct {
    MediaInput commands, secrets, audio;
    HANDLE control, data, wake, writer;
    GMutex mutex;
    GCond space;
    GQueue frames;
    guint queued_bytes, queued_frames, peak_bytes, discarded_frames;
    guint queue_max, frame_max, credits_bytes, credits_frames;
    guint32 sequence;
    gboolean replay, suspended;
    volatile LONG stopping, data_failed;
} MediaIpc;

void media_header(guint8 *out, guint16 kind, guint32 session,
    guint32 generation, guint32 sequence, guint32 length);
gboolean media_ipc_init(MediaIpc *ipc, HANDLE data, HANDLE secrets, HANDLE audio);
gint media_input_read(MediaInput *input, MediaCommand *command);
gboolean media_ipc_control(MediaIpc *ipc, guint16 kind, guint32 session,
    guint32 generation, guint32 sequence, const gchar *json);
void media_ipc_limits(MediaIpc *ipc, guint bytes, guint frames, gboolean replay);
gboolean media_ipc_credit(MediaIpc *ipc, guint bytes, guint frames);
gint media_ipc_data(MediaIpc *ipc, guint16 kind, guint32 session,
    guint32 generation, const guint8 *payload, guint32 length);
void media_ipc_suspend(MediaIpc *ipc, gboolean suspended, gboolean flush);
void media_ipc_cancel(MediaIpc *ipc);
gboolean media_ipc_stop(MediaIpc *ipc);
void media_ipc_clear(MediaIpc *ipc);

#endif
