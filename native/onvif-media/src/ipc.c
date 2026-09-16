#include "ipc.h"

#include <process.h>
#include <string.h>

typedef struct {
    guint size;
    guint8 bytes[];
} MediaWrite;

void
media_header(guint8 *out, guint16 kind, guint32 session,
    guint32 generation, guint32 sequence, guint32 length)
{
    memcpy(out, "OMPG", 4);
    GST_WRITE_UINT16_BE(out + 4, MEDIA_PROTOCOL);
    GST_WRITE_UINT16_BE(out + 6, kind);
    GST_WRITE_UINT32_BE(out + 8, session);
    GST_WRITE_UINT32_BE(out + 12, generation);
    GST_WRITE_UINT32_BE(out + 16, sequence);
    GST_WRITE_UINT32_BE(out + 20, length);
}

static gboolean
write_all(HANDLE handle, const guint8 *bytes, guint length, volatile LONG *cancel)
{
    while (length) {
        DWORD written;
        if (cancel && InterlockedCompareExchange(cancel, 0, 0))
            return FALSE;
        if (!WriteFile(handle, bytes, length, &written, NULL) || !written)
            return FALSE;
        bytes += written;
        length -= written;
    }
    return TRUE;
}

static unsigned __stdcall
writer(void *context)
{
    MediaIpc *ipc = context;
    while (!InterlockedCompareExchange(&ipc->stopping, 0, 0)) {
        MediaWrite *item;
        gboolean written;
        g_mutex_lock(&ipc->mutex);
        item = g_queue_pop_head(&ipc->frames);
        g_mutex_unlock(&ipc->mutex);
        if (!item) {
            WaitForSingleObject(ipc->wake, 50);
            continue;
        }
        written = write_all(ipc->data, item->bytes, item->size, &ipc->stopping);
        g_mutex_lock(&ipc->mutex);
        ipc->queued_bytes -= item->size;
        --ipc->queued_frames;
        if (!written)
            ++ipc->discarded_frames;
        g_cond_broadcast(&ipc->space);
        g_mutex_unlock(&ipc->mutex);
        g_free(item);
        if (!written) {
            if (!InterlockedCompareExchange(&ipc->stopping, 0, 0))
                InterlockedExchange(&ipc->data_failed, 1);
            break;
        }
    }
    return 0;
}

gboolean
media_ipc_init(MediaIpc *ipc, HANDLE data, HANDLE secrets, HANDLE audio)
{
    memset(ipc, 0, sizeof(*ipc));
    ipc->commands.handle = GetStdHandle(STD_INPUT_HANDLE);
    ipc->control = GetStdHandle(STD_OUTPUT_HANDLE);
    ipc->secrets.handle = secrets;
    ipc->audio.handle = audio;
    ipc->data = data;
    g_mutex_init(&ipc->mutex);
    g_cond_init(&ipc->space);
    g_queue_init(&ipc->frames);
    if (GetFileType(ipc->commands.handle) != FILE_TYPE_PIPE ||
        GetFileType(ipc->control) != FILE_TYPE_PIPE ||
        GetFileType(data) != FILE_TYPE_PIPE || GetFileType(secrets) != FILE_TYPE_PIPE ||
        GetFileType(audio) != FILE_TYPE_PIPE)
        return FALSE;
    ipc->wake = CreateEventW(NULL, FALSE, FALSE, NULL);
    if (!ipc->wake)
        return FALSE;
    ipc->writer = (HANDLE) _beginthreadex(NULL, 0, writer, ipc, 0, NULL);
    return ipc->writer != NULL;
}

gint
media_input_read(MediaInput *input, MediaCommand *command)
{
    DWORD available, received;
    guint length, total;
    gint64 now = g_get_monotonic_time();
    if (input->length >= MEDIA_HEADER) {
        const guint8 *head = input->bytes;
        if (memcmp(head, "OMPG", 4) || GST_READ_UINT16_BE(head + 4) != MEDIA_PROTOCOL)
            return -2;
        length = GST_READ_UINT32_BE(head + 20);
        if (length > MEDIA_CONTROL_MAX)
            return -2;
        total = MEDIA_HEADER + length;
        if (input->length >= total) {
            command->kind = GST_READ_UINT16_BE(head + 6);
            command->session = GST_READ_UINT32_BE(head + 8);
            command->generation = GST_READ_UINT32_BE(head + 12);
            command->sequence = GST_READ_UINT32_BE(head + 16);
            command->length = length;
            memcpy(command->payload, head + MEDIA_HEADER, length);
            memmove(input->bytes, input->bytes + total, input->length - total);
            SecureZeroMemory(input->bytes + input->length - total, total);
            input->length -= total;
            input->incomplete_since = input->length ? now : 0;
            return 1;
        }
    }
    if (input->incomplete_since && now - input->incomplete_since > 2000000)
        return -2;
    if (!PeekNamedPipe(input->handle, NULL, 0, NULL, &available, NULL))
        return GetLastError() == ERROR_BROKEN_PIPE && !input->length ? -1 : -2;
    if (!available)
        return 0;
    available = MIN(available, (DWORD) sizeof(input->bytes) - input->length);
    if (!available || !ReadFile(input->handle, input->bytes + input->length,
            available, &received, NULL) || !received)
        return -2;
    if (!input->length)
        input->incomplete_since = now;
    input->length += received;
    return 0;
}

gboolean
media_ipc_control(MediaIpc *ipc, guint16 kind, guint32 session,
    guint32 generation, guint32 sequence, const gchar *json)
{
    guint8 head[MEDIA_HEADER];
    gsize length = strlen(json);
    if (length > MEDIA_CONTROL_MAX)
        return FALSE;
    media_header(head, kind, session, generation, sequence, (guint32) length);
    return write_all(ipc->control, head, sizeof(head), NULL) &&
        write_all(ipc->control, (const guint8 *) json, (guint) length, NULL);
}

void
media_ipc_limits(MediaIpc *ipc, guint bytes, guint frames, gboolean replay)
{
    g_mutex_lock(&ipc->mutex);
    ipc->queue_max = ipc->credits_bytes = bytes;
    ipc->frame_max = ipc->credits_frames = frames;
    ipc->replay = replay;
    g_mutex_unlock(&ipc->mutex);
}

gboolean
media_ipc_credit(MediaIpc *ipc, guint bytes, guint frames)
{
    gboolean valid;
    g_mutex_lock(&ipc->mutex);
    valid = bytes && frames && bytes <= ipc->queue_max - ipc->credits_bytes &&
        frames <= ipc->frame_max - ipc->credits_frames;
    if (valid) {
        ipc->credits_bytes += bytes;
        ipc->credits_frames += frames;
        g_cond_broadcast(&ipc->space);
    }
    g_mutex_unlock(&ipc->mutex);
    return valid;
}

gint
media_ipc_data(MediaIpc *ipc, guint16 kind, guint32 session,
    guint32 generation, const guint8 *payload, guint32 length)
{
    MediaWrite *item;
    guint size = MEDIA_HEADER + length;
    if (length > MEDIA_DATA_MAX || size > ipc->queue_max)
        return -1;
    g_mutex_lock(&ipc->mutex);
    while (!ipc->suspended && !InterlockedCompareExchange(&ipc->stopping, 0, 0) &&
        (ipc->queued_frames >= ipc->frame_max || size > ipc->queue_max - ipc->queued_bytes ||
            !ipc->credits_frames || size > ipc->credits_bytes)) {
        if (!ipc->replay) {
            ++ipc->discarded_frames;
            g_mutex_unlock(&ipc->mutex);
            return 0;
        }
        g_cond_wait_until(&ipc->space, &ipc->mutex, g_get_monotonic_time() + 100000);
    }
    if (ipc->suspended || InterlockedCompareExchange(&ipc->stopping, 0, 0)) {
        g_mutex_unlock(&ipc->mutex);
        return 0;
    }
    item = g_malloc(sizeof(*item) + size);
    item->size = size;
    media_header(item->bytes, kind, session, generation, ++ipc->sequence, length);
    memcpy(item->bytes + MEDIA_HEADER, payload, length);
    g_queue_push_tail(&ipc->frames, item);
    ipc->queued_bytes += size;
    ++ipc->queued_frames;
    ipc->credits_bytes -= size;
    --ipc->credits_frames;
    ipc->peak_bytes = MAX(ipc->peak_bytes, ipc->queued_bytes);
    g_mutex_unlock(&ipc->mutex);
    SetEvent(ipc->wake);
    return 1;
}

void
media_ipc_suspend(MediaIpc *ipc, gboolean suspended, gboolean flush)
{
    g_mutex_lock(&ipc->mutex);
    ipc->suspended = suspended;
    if (flush) {
        MediaWrite *item;
        while ((item = g_queue_pop_head(&ipc->frames)) != NULL) {
            ipc->queued_bytes -= item->size;
            --ipc->queued_frames;
            ipc->credits_bytes += item->size;
            ++ipc->credits_frames;
            ++ipc->discarded_frames;
            g_free(item);
        }
    }
    g_cond_broadcast(&ipc->space);
    g_mutex_unlock(&ipc->mutex);
}

void
media_ipc_cancel(MediaIpc *ipc)
{
    InterlockedExchange(&ipc->stopping, 1);
    media_ipc_suspend(ipc, TRUE, TRUE);
    if (ipc->wake)
        SetEvent(ipc->wake);
}

gboolean
media_ipc_stop(MediaIpc *ipc)
{
    guint i;
    media_ipc_cancel(ipc);
    if (!ipc->writer)
        return TRUE;
    for (i = 0; i < 40; ++i) {
        CancelSynchronousIo(ipc->writer);
        if (WaitForSingleObject(ipc->writer, 50) == WAIT_OBJECT_0)
            return TRUE;
    }
    return FALSE;
}

void
media_ipc_clear(MediaIpc *ipc)
{
    if (ipc->writer)
        CloseHandle(ipc->writer);
    if (ipc->wake)
        CloseHandle(ipc->wake);
    CloseHandle(ipc->data);
    CloseHandle(ipc->secrets.handle);
    CloseHandle(ipc->audio.handle);
    SecureZeroMemory(ipc->secrets.bytes, sizeof(ipc->secrets.bytes));
    g_cond_clear(&ipc->space);
    g_mutex_clear(&ipc->mutex);
}
