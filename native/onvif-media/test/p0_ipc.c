#include "p0_ipc.h"

#include <process.h>
#include <string.h>

typedef struct {
    guint size;
    guint8 bytes[];
} P0Frame;

void
p0_header(guint8 *out, guint16 kind, guint32 session,
    guint32 generation, guint32 sequence, guint32 length)
{
    memcpy(out, "OMPG", 4);
    GST_WRITE_UINT16_BE(out + 4, P0_PROTOCOL);
    GST_WRITE_UINT16_BE(out + 6, kind);
    GST_WRITE_UINT32_BE(out + 8, session);
    GST_WRITE_UINT32_BE(out + 12, generation);
    GST_WRITE_UINT32_BE(out + 16, sequence);
    GST_WRITE_UINT32_BE(out + 20, length);
}

static gboolean
write_all(HANDLE handle, const guint8 *data, guint size, volatile LONG *stopping)
{
    while (size) {
        DWORD written;
        if (stopping && InterlockedCompareExchange(stopping, 0, 0))
            return FALSE;
        if (!WriteFile(handle, data, size, &written, NULL) || !written)
            return FALSE;
        data += written;
        size -= written;
    }
    return TRUE;
}

static unsigned __stdcall
data_writer(void *context)
{
    P0Ipc *ipc = context;
    while (!InterlockedCompareExchange(&ipc->stopping, 0, 0)) {
        P0Frame *frame;
        gboolean written;
        g_mutex_lock(&ipc->mutex);
        frame = g_queue_pop_head(&ipc->frames);
        g_mutex_unlock(&ipc->mutex);
        if (!frame) {
            WaitForSingleObject(ipc->wake, 50);
            continue;
        }
        written = write_all(ipc->data, frame->bytes, frame->size, &ipc->stopping);
        g_mutex_lock(&ipc->mutex);
        ipc->queued_bytes -= frame->size;
        --ipc->queued_frames;
        if (!written)
            ++ipc->discarded_frames;
        g_mutex_unlock(&ipc->mutex);
        g_free(frame);
        if (!written) {
            if (!InterlockedCompareExchange(&ipc->stopping, 0, 0))
                InterlockedExchange(&ipc->data_failed, 1);
            break;
        }
    }
    return 0;
}

gboolean
p0_ipc_init(P0Ipc *ipc, HANDLE data)
{
    memset(ipc, 0, sizeof(*ipc));
    ipc->input = GetStdHandle(STD_INPUT_HANDLE);
    ipc->control = GetStdHandle(STD_OUTPUT_HANDLE);
    ipc->data = data;
    g_mutex_init(&ipc->mutex);
    g_queue_init(&ipc->frames);
    if (GetFileType(ipc->input) != FILE_TYPE_PIPE ||
        GetFileType(ipc->control) != FILE_TYPE_PIPE ||
        GetFileType(data) != FILE_TYPE_PIPE)
        return FALSE;
    ipc->wake = CreateEventW(NULL, FALSE, FALSE, NULL);
    if (!ipc->wake)
        return FALSE;
    ipc->writer = (HANDLE) _beginthreadex(NULL, 0, data_writer, ipc, 0, NULL);
    return ipc->writer != NULL;
}

gint
p0_ipc_read(P0Ipc *ipc, P0Command *command)
{
    DWORD available = 0, received;
    guint32 length;
    guint total;

    if (ipc->input_length >= P0_HEADER_SIZE) {
        const guint8 *header = ipc->input_bytes;
        if (memcmp(header, "OMPG", 4) ||
            GST_READ_UINT16_BE(header + 4) != P0_PROTOCOL)
            return -2;
        length = GST_READ_UINT32_BE(header + 20);
        if (length > P0_CONTROL_MAX)
            return -2;
        total = P0_HEADER_SIZE + length;
        if (ipc->input_length >= total) {
            command->kind = GST_READ_UINT16_BE(header + 6);
            command->session = GST_READ_UINT32_BE(header + 8);
            command->generation = GST_READ_UINT32_BE(header + 12);
            command->sequence = GST_READ_UINT32_BE(header + 16);
            command->length = length;
            memcpy(command->payload, header + P0_HEADER_SIZE, length);
            memmove(ipc->input_bytes, ipc->input_bytes + total, ipc->input_length - total);
            ipc->input_length -= total;
            return 1;
        }
    }
    if (!PeekNamedPipe(ipc->input, NULL, 0, NULL, &available, NULL))
        return GetLastError() == ERROR_BROKEN_PIPE && !ipc->input_length ? -1 : -2;
    if (!available)
        return 0;
    available = MIN(available, (DWORD) sizeof(ipc->input_bytes) - ipc->input_length);
    if (!available || !ReadFile(ipc->input, ipc->input_bytes + ipc->input_length,
            available, &received, NULL) || !received)
        return -2;
    ipc->input_length += received;
    return 0;
}

gboolean
p0_ipc_control(P0Ipc *ipc, guint16 kind, guint32 session,
    guint32 generation, guint32 sequence, const gchar *json)
{
    guint8 header[P0_HEADER_SIZE];
    gsize length = strlen(json);
    if (length > P0_CONTROL_MAX)
        return FALSE;
    p0_header(header, kind, session, generation, sequence, (guint32) length);
    return write_all(ipc->control, header, sizeof(header), NULL) &&
        write_all(ipc->control, (const guint8 *) json, (guint) length, NULL);
}

gboolean
p0_ipc_data(P0Ipc *ipc, guint16 kind, guint32 session,
    guint32 generation, const guint8 *payload, guint32 length)
{
    P0Frame *frame;
    guint size = P0_HEADER_SIZE + length;
    if (length > P0_DATA_MAX || InterlockedCompareExchange(&ipc->stopping, 0, 0))
        return FALSE;
    g_mutex_lock(&ipc->mutex);
    if (ipc->queued_frames >= P0_QUEUE_FRAMES || size > P0_QUEUE_MAX - ipc->queued_bytes) {
        g_mutex_unlock(&ipc->mutex);
        return FALSE;
    }
    frame = g_malloc(sizeof(*frame) + size);
    frame->size = size;
    p0_header(frame->bytes, kind, session, generation, ++ipc->data_sequence, length);
    memcpy(frame->bytes + P0_HEADER_SIZE, payload, length);
    g_queue_push_tail(&ipc->frames, frame);
    ipc->queued_bytes += size;
    ++ipc->queued_frames;
    ipc->peak_bytes = MAX(ipc->peak_bytes, ipc->queued_bytes);
    g_mutex_unlock(&ipc->mutex);
    SetEvent(ipc->wake);
    return TRUE;
}

gboolean
p0_ipc_stop_data(P0Ipc *ipc)
{
    guint i;
    InterlockedExchange(&ipc->stopping, 1);
    if (!ipc->writer)
        return TRUE;
    SetEvent(ipc->wake);
    for (i = 0; i < 40; ++i) {
        CancelSynchronousIo(ipc->writer);
        if (WaitForSingleObject(ipc->writer, 50) == WAIT_OBJECT_0)
            return TRUE;
    }
    return FALSE;
}

void
p0_ipc_clear(P0Ipc *ipc)
{
    P0Frame *frame;
    while ((frame = g_queue_pop_head(&ipc->frames)) != NULL) {
        ++ipc->discarded_frames;
        g_free(frame);
    }
    if (ipc->writer)
        CloseHandle(ipc->writer);
    if (ipc->wake)
        CloseHandle(ipc->wake);
    if (ipc->data && ipc->data != INVALID_HANDLE_VALUE)
        CloseHandle(ipc->data);
    g_mutex_clear(&ipc->mutex);
}
