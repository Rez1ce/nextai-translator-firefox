import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
    getSettings: vi.fn(),
}))

vi.mock('../universal-fetch', () => ({
    getUniversalFetch: () => mocks.fetch,
}))

vi.mock('../utils', () => ({
    getSettings: mocks.getSettings,
}))

import { detectLang, localDetectLang } from './index'

const jsonResponse = (body: unknown, ok = true) => ({
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
})

describe('detectLang', () => {
    beforeEach(() => {
        mocks.fetch.mockReset()
        mocks.getSettings.mockReset()
        mocks.getSettings.mockResolvedValue({ languageDetectionEngine: 'baidu' })
    })

    it('uses the remote engine when it answers', async () => {
        mocks.fetch.mockResolvedValue(jsonResponse({ error: 0, lan: 'zh' }))

        await expect(detectLang('要求')).resolves.toBe('zh-Hans')
    })

    it('falls back to local detection when the remote engine returns no language', async () => {
        mocks.fetch.mockResolvedValue(jsonResponse({ error: 997, msg: 'anti-bot' }))

        await expect(detectLang('要求')).resolves.toBe('zh-Hans')
    })

    it('falls back to local detection when the remote engine returns an unknown code', async () => {
        mocks.fetch.mockResolvedValue(jsonResponse({ error: 0, lan: 'wyw' }))

        await expect(detectLang('要求')).resolves.toBe('zh-Hans')
    })

    it('falls back to local detection on a non-ok response', async () => {
        mocks.fetch.mockResolvedValue(jsonResponse(null, false))

        await expect(detectLang('要求')).resolves.toBe('zh-Hans')
    })

    it('falls back to local detection when the remote request throws', async () => {
        mocks.fetch.mockRejectedValue(new Error('network down'))
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        await expect(detectLang('要求')).resolves.toBe('zh-Hans')
        await expect(detectLang('hello world')).resolves.toBe('en')
        expect(warning).toHaveBeenCalledTimes(2)
        warning.mockRestore()
    })

    it('honors the local engine without touching the network', async () => {
        mocks.getSettings.mockResolvedValue({ languageDetectionEngine: 'local' })

        await expect(detectLang('要求')).resolves.toBe('zh-Hans')
        expect(mocks.fetch).not.toHaveBeenCalled()
    })
})

describe('localDetectLang', () => {
    it('detects simplified and traditional Chinese', async () => {
        await expect(localDetectLang('要求')).resolves.toBe('zh-Hans')
        await expect(localDetectLang('翻譯經常中譯中')).resolves.toBe('zh-Hant')
    })
})
