import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCustomAPIRequestLogs, getCustomAPIRequestLogs } from '../custom-api-request'
import { CustomRequestLogs } from './CustomRequestLogs'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (value: string) => value }),
}))

vi.mock('../custom-api-request', () => ({
    getCustomAPIRequestLogs: vi.fn(),
    clearCustomAPIRequestLogs: vi.fn(),
}))

describe('CustomRequestLogs', () => {
    let container: HTMLDivElement
    let root: Root

    beforeAll(() => {
        const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true
    })

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        vi.mocked(getCustomAPIRequestLogs).mockResolvedValue([
            {
                id: 'request-1',
                timestamp: '2026-09-30T01:00:00.000Z',
                method: 'POST',
                url: 'http://localhost:8000/v1/chat/completions',
                headers: { Authorization: '[REDACTED]' },
                requestBody: { model: 'local-model' },
                status: 200,
                durationMs: 42,
                finishReason: 'stop',
            },
        ])
        vi.mocked(clearCustomAPIRequestLogs).mockResolvedValue(undefined)
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        vi.clearAllMocks()
    })

    it('shows persisted custom API request details', async () => {
        await act(async () => {
            root.render(<CustomRequestLogs active />)
        })

        expect(container.textContent).toContain('http://localhost:8000/v1/chat/completions')
        expect(container.textContent).toContain('200')
        expect(container.textContent).toContain('local-model')
        expect(container.textContent).toContain('[REDACTED]')
    })

    it('clears persisted request logs', async () => {
        await act(async () => {
            root.render(<CustomRequestLogs active />)
        })

        const clearButton = container.querySelector('[data-testid="clear-request-logs"]') as HTMLButtonElement
        await act(async () => {
            clearButton.click()
        })

        expect(clearCustomAPIRequestLogs).toHaveBeenCalledTimes(1)
        expect(container.textContent).toContain('No request logs yet')
    })
})
