import { BackgroundEventNames } from './background/eventnames'
import { getBrowser } from './utils'

const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const SENSITIVE_LOG_KEYS = new Set([
    'authorization',
    'auth',
    'apikey',
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'password',
    'secret',
    'credential',
    'signature',
    'sig',
    'key',
    'cookie',
    'setcookie',
])

export const CUSTOM_API_REQUEST_LOG_STORAGE_KEY = 'customAPIRequestLogs'
export const CUSTOM_API_REQUEST_LOG_LIMIT = 100

export type CustomRequestBody = Record<string, unknown>

export interface CustomAPIRequestLogEntry {
    id: string
    timestamp: string
    method: string
    url: string
    headers: Record<string, string>
    requestBody: CustomRequestBody
    status?: number
    durationMs?: number
    finishReason?: string
    error?: string
}

export type CustomAPIRequestLogPatch = Pick<
    CustomAPIRequestLogEntry,
    'status' | 'durationMs' | 'finishReason' | 'error'
>

function isPlainObject(value: unknown): value is CustomRequestBody {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false
    }
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

export function parseCustomRequestBodyOverrides(value: string | undefined): CustomRequestBody {
    if (!value?.trim()) {
        return {}
    }

    const parsed: unknown = JSON.parse(value)
    if (!isPlainObject(parsed)) {
        throw new Error('Request body overrides must be a JSON object')
    }
    return parsed
}

function mergeValue(baseValue: unknown, overrideValue: unknown): unknown {
    if (!isPlainObject(baseValue) || !isPlainObject(overrideValue)) {
        return overrideValue
    }

    return mergeObjects(baseValue, overrideValue)
}

function mergeObjects(base: CustomRequestBody, overrides: CustomRequestBody): CustomRequestBody {
    const result: CustomRequestBody = { ...base }
    for (const [key, value] of Object.entries(overrides)) {
        if (BLOCKED_OBJECT_KEYS.has(key)) {
            continue
        }
        result[key] = mergeValue(base[key], value)
    }
    return result
}

export function mergeCustomRequestBody(base: CustomRequestBody, overrides: string | undefined): CustomRequestBody {
    return mergeObjects(base, parseCustomRequestBodyOverrides(overrides))
}

function isSensitiveLogKey(key: string): boolean {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '')
    return (
        SENSITIVE_LOG_KEYS.has(normalizedKey) ||
        normalizedKey.endsWith('apikey') ||
        normalizedKey.endsWith('token') ||
        normalizedKey.endsWith('secret') ||
        normalizedKey.endsWith('password') ||
        normalizedKey.endsWith('credential') ||
        normalizedKey.endsWith('signature')
    )
}

function sanitizeErrorForLog(value: string): string {
    return value
        .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
        .replace(
            /(\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|secret|credential|signature|sig|key|token|cookie)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
            '$1[REDACTED]'
        )
}

export function sanitizeCustomAPIRequestURL(value: string): string {
    try {
        const url = new URL(value)
        url.username = ''
        url.password = ''
        url.hash = ''
        for (const key of Array.from(url.searchParams.keys())) {
            if (isSensitiveLogKey(key)) {
                url.searchParams.set(key, 'REDACTED')
            }
        }
        return url.toString()
    } catch {
        return '[INVALID URL]'
    }
}

function sanitizeForLog(value: unknown, key = ''): unknown {
    if (key && isSensitiveLogKey(key)) {
        return '[REDACTED]'
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForLog(item))
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([entryKey, item]) => [entryKey, sanitizeForLog(item, entryKey)])
        )
    }
    return value
}

async function readCustomAPIRequestLogs(): Promise<CustomAPIRequestLogEntry[]> {
    const browser = await getBrowser()
    const stored = await browser.storage.local.get(CUSTOM_API_REQUEST_LOG_STORAGE_KEY)
    const logs = stored[CUSTOM_API_REQUEST_LOG_STORAGE_KEY]
    return Array.isArray(logs) ? (logs as CustomAPIRequestLogEntry[]) : []
}

class CustomAPIRequestLogInternalService {
    private writeQueue: Promise<void> = Promise.resolve()

    private enqueueWrite(operation: () => Promise<void>): Promise<void> {
        const result = this.writeQueue.then(operation)
        this.writeQueue = result.catch(() => undefined)
        return result
    }

    async get(): Promise<CustomAPIRequestLogEntry[]> {
        await this.writeQueue
        return await readCustomAPIRequestLogs()
    }

    append(entry: CustomAPIRequestLogEntry): Promise<void> {
        return this.enqueueWrite(async () => {
            const browser = await getBrowser()
            const logs = await readCustomAPIRequestLogs()
            const sanitizedEntry = sanitizeForLog({
                ...entry,
                url: sanitizeCustomAPIRequestURL(entry.url),
            }) as CustomAPIRequestLogEntry
            await browser.storage.local.set({
                [CUSTOM_API_REQUEST_LOG_STORAGE_KEY]: [sanitizedEntry, ...logs].slice(0, CUSTOM_API_REQUEST_LOG_LIMIT),
            })
        })
    }

    update(id: string, patch: CustomAPIRequestLogPatch): Promise<void> {
        return this.enqueueWrite(async () => {
            const browser = await getBrowser()
            const logs = await readCustomAPIRequestLogs()
            const sanitizedPatch: CustomAPIRequestLogPatch = {
                ...patch,
                finishReason: patch.finishReason ? sanitizeErrorForLog(patch.finishReason) : patch.finishReason,
                error: patch.error ? sanitizeErrorForLog(patch.error) : patch.error,
            }
            await browser.storage.local.set({
                [CUSTOM_API_REQUEST_LOG_STORAGE_KEY]: logs.map((entry) =>
                    entry.id === id ? { ...entry, ...sanitizedPatch } : entry
                ),
            })
        })
    }

    clear(): Promise<void> {
        return this.enqueueWrite(async () => {
            const browser = await getBrowser()
            await browser.storage.local.remove(CUSTOM_API_REQUEST_LOG_STORAGE_KEY)
        })
    }
}

export const customAPIRequestLogInternalService = new CustomAPIRequestLogInternalService()

type CustomAPIRequestLogMethod = 'get' | 'append' | 'update' | 'clear'

async function callCustomAPIRequestLogService<T>(method: CustomAPIRequestLogMethod, args: unknown[]): Promise<T> {
    const browser = await getBrowser()
    const response = await browser.runtime.sendMessage({
        type: BackgroundEventNames.customAPIRequestLogService,
        method,
        args,
    })
    return response.result as T
}

export function getCustomAPIRequestLogs(): Promise<CustomAPIRequestLogEntry[]> {
    return callCustomAPIRequestLogService<CustomAPIRequestLogEntry[]>('get', [])
}

export function appendCustomAPIRequestLog(entry: CustomAPIRequestLogEntry): Promise<void> {
    return callCustomAPIRequestLogService<void>('append', [entry])
}

export function updateCustomAPIRequestLog(id: string, patch: CustomAPIRequestLogPatch): Promise<void> {
    return callCustomAPIRequestLogService<void>('update', [id, patch])
}

export function clearCustomAPIRequestLogs(): Promise<void> {
    return callCustomAPIRequestLogService<void>('clear', [])
}

export function createCustomAPIRequestLogId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
