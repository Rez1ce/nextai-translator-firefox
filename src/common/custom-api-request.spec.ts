import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBrowser } from './utils'
import {
    appendCustomAPIRequestLog,
    clearCustomAPIRequestLogs,
    customAPIRequestLogInternalService,
    getCustomAPIRequestLogs,
    sanitizeCustomAPIRequestURL,
    updateCustomAPIRequestLog,
} from './custom-api-request'
import { BackgroundEventNames } from './background/eventnames'

vi.mock('./utils', () => ({
    getBrowser: vi.fn(),
}))

describe('custom API request body overrides', () => {
    it('deep-merges object fields while replacing arrays and scalar values', async () => {
        const { mergeCustomRequestBody } = await import('./custom-api-request')
        const merged = mergeCustomRequestBody(
            {
                model: 'gpt-4',
                stream: true,
                metadata: { source: 'translator', nested: { keep: true } },
                stop: ['old'],
            },
            JSON.stringify({
                stream: false,
                metadata: { nested: { added: true } },
                stop: ['new'],
            })
        )

        expect(merged).toEqual({
            model: 'gpt-4',
            stream: false,
            metadata: { source: 'translator', nested: { keep: true, added: true } },
            stop: ['new'],
        })
    })

    it('rejects values that are not JSON objects', async () => {
        const { parseCustomRequestBodyOverrides } = await import('./custom-api-request')

        expect(() => parseCustomRequestBodyOverrides('[1, 2, 3]')).toThrow('must be a JSON object')
    })

    it('redacts URL credentials before they are persisted', () => {
        const sanitized = sanitizeCustomAPIRequestURL(
            'https://user:password@example.com/v1/chat/completions?api_key=secret&access-token=hidden&key=credential&signature=signed&model=gpt-4#token=fragment-secret'
        )

        expect(sanitized).toBe(
            'https://example.com/v1/chat/completions?api_key=REDACTED&access-token=REDACTED&key=REDACTED&signature=REDACTED&model=gpt-4'
        )
    })
})

describe('custom API request logs', () => {
    let values: Record<string, unknown>
    let storageSet: ReturnType<typeof vi.fn>
    let runtimeSendMessage: ReturnType<typeof vi.fn>

    beforeEach(() => {
        values = {}
        storageSet = vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(values, items)
        })
        runtimeSendMessage = vi.fn().mockResolvedValue({ result: undefined })
        vi.mocked(getBrowser).mockResolvedValue({
            storage: {
                local: {
                    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
                    set: storageSet,
                    remove: vi.fn(async (key: string) => {
                        delete values[key]
                    }),
                },
            },
            runtime: {
                sendMessage: runtimeSendMessage,
            },
        } as never)
    })

    it('routes log operations through the background service so extension contexts share one queue', async () => {
        const entry = {
            id: 'request-1',
            timestamp: '2026-09-30T00:00:00.000Z',
            method: 'POST',
            url: 'http://localhost:8000/v1/chat/completions',
            headers: {},
            requestBody: {},
        }

        await appendCustomAPIRequestLog(entry)
        runtimeSendMessage.mockResolvedValueOnce({ result: [entry] })
        await expect(getCustomAPIRequestLogs()).resolves.toEqual([entry])
        await updateCustomAPIRequestLog(entry.id, { status: 200 })
        await clearCustomAPIRequestLogs()

        expect(runtimeSendMessage).toHaveBeenNthCalledWith(1, {
            type: BackgroundEventNames.customAPIRequestLogService,
            method: 'append',
            args: [entry],
        })
        expect(runtimeSendMessage).toHaveBeenNthCalledWith(2, {
            type: BackgroundEventNames.customAPIRequestLogService,
            method: 'get',
            args: [],
        })
        expect(runtimeSendMessage).toHaveBeenNthCalledWith(3, {
            type: BackgroundEventNames.customAPIRequestLogService,
            method: 'update',
            args: [entry.id, { status: 200 }],
        })
        expect(runtimeSendMessage).toHaveBeenNthCalledWith(4, {
            type: BackgroundEventNames.customAPIRequestLogService,
            method: 'clear',
            args: [],
        })
        expect(storageSet).not.toHaveBeenCalled()
    })

    it('keeps the newest 100 entries and redacts credentials', async () => {
        for (let index = 0; index < 105; index += 1) {
            await customAPIRequestLogInternalService.append({
                id: `request-${index}`,
                timestamp: new Date(index * 1000).toISOString(),
                method: 'POST',
                url: 'https://user:password@localhost:8000/v1/chat/completions?api_key=url-secret',
                headers: {
                    'Authorization': 'Bearer secret-token',
                    'X-API-Key': 'secret-api-key',
                    'Content-Type': 'application/json',
                },
                requestBody: {
                    model: 'gpt-4',
                    ['api_key']: 'body-secret',
                    ['client_secret']: 'oauth-secret',
                    credential: 'signed-credential',
                },
            })
        }

        const logs = await customAPIRequestLogInternalService.get()
        expect(logs).toHaveLength(100)
        expect(logs[0].id).toBe('request-104')
        expect(logs[99].id).toBe('request-5')
        expect(logs[0].headers).toEqual({
            'Authorization': '[REDACTED]',
            'X-API-Key': '[REDACTED]',
            'Content-Type': 'application/json',
        })
        expect(logs[0].requestBody).toEqual({
            model: 'gpt-4',
            ['api_key']: '[REDACTED]',
            ['client_secret']: '[REDACTED]',
            credential: '[REDACTED]',
        })
        expect(logs[0].url).toBe('https://localhost:8000/v1/chat/completions?api_key=REDACTED')
    })

    it('updates an existing entry without changing its request payload', async () => {
        await customAPIRequestLogInternalService.append({
            id: 'request-1',
            timestamp: '2026-09-30T00:00:00.000Z',
            method: 'POST',
            url: 'http://localhost:8000/v1/chat/completions',
            headers: { Authorization: 'Bearer secret-token' },
            requestBody: { model: 'gpt-4' },
        })

        await customAPIRequestLogInternalService.update('request-1', {
            status: 200,
            durationMs: 125,
            finishReason: 'stop',
        })

        const [log] = await customAPIRequestLogInternalService.get()
        expect(log).toMatchObject({
            id: 'request-1',
            status: 200,
            durationMs: 125,
            finishReason: 'stop',
            requestBody: { model: 'gpt-4' },
        })
    })

    it('redacts credentials echoed in remote error messages', async () => {
        await customAPIRequestLogInternalService.append({
            id: 'request-1',
            timestamp: '2026-09-30T00:00:00.000Z',
            method: 'POST',
            url: 'http://localhost:8000/v1/chat/completions',
            headers: {},
            requestBody: {},
        })

        await customAPIRequestLogInternalService.update('request-1', {
            error: 'Unauthorized: client_secret=oauth-value, Authorization: Bearer bearer-value',
        })

        const [log] = await customAPIRequestLogInternalService.get()
        expect(log.error).toBe('Unauthorized: client_secret=[REDACTED], Authorization: Bearer [REDACTED]')
    })

    it('clears all stored entries', async () => {
        await customAPIRequestLogInternalService.append({
            id: 'request-1',
            timestamp: '2026-09-30T00:00:00.000Z',
            method: 'POST',
            url: 'http://localhost:8000/v1/chat/completions',
            headers: {},
            requestBody: {},
        })

        await customAPIRequestLogInternalService.clear()

        await expect(customAPIRequestLogInternalService.get()).resolves.toEqual([])
    })
})
