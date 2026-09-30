import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AbstractOpenAI } from './abstract-openai'
import { Ollama } from './ollama'
import { OpenAI } from './openai'
import { IMessageRequest } from './interfaces'
import { fetchSSE, getSettings } from '../utils'
import { getUniversalFetch } from '../universal-fetch'

const customRequestLogMocks = vi.hoisted(() => ({
    append: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    createId: vi.fn(() => 'request-log-id'),
}))

vi.mock('../utils', () => {
    return {
        defaultAPIURL: 'https://api.openai.com',
        defaultAPIURLPath: '/v1/chat/completions',
        fetchSSE: vi.fn(),
        getSettings: vi.fn().mockResolvedValue({ noModelsAPISupport: false }),
    }
})

vi.mock('../universal-fetch', () => {
    return {
        getUniversalFetch: vi.fn(),
    }
})

vi.mock('../custom-api-request', async () => {
    const actual = await vi.importActual<typeof import('../custom-api-request')>('../custom-api-request')
    return {
        ...actual,
        appendCustomAPIRequestLog: customRequestLogMocks.append,
        updateCustomAPIRequestLog: customRequestLogMocks.update,
        createCustomAPIRequestLogId: customRequestLogMocks.createId,
    }
})

class TestOpenAIEngine extends AbstractOpenAI {
    constructor(
        private readonly model: string,
        private readonly apiURL = 'https://api.openai.com',
        private readonly apiURLPath = '/v1/chat/completions'
    ) {
        super()
    }

    async getAPIModel(): Promise<string> {
        return this.model
    }

    async getAPIKey(): Promise<string> {
        return 'test-api-key'
    }

    async getAPIURL(): Promise<string> {
        return this.apiURL
    }

    async getAPIURLPath(): Promise<string> {
        return this.apiURLPath
    }
}

interface MockFetchSSEOptions {
    body?: BodyInit | null
    onMessage: (data: string) => Promise<void>
    onStatusCode?: (statusCode: number) => void
}

function createMessageRequest() {
    const onMessage = vi.fn().mockResolvedValue(undefined)
    const onError = vi.fn()
    const onFinished = vi.fn()
    const req: IMessageRequest = {
        rolePrompt: 'You are a translator',
        commandPrompt: 'Translate hello to Chinese',
        onMessage,
        onError,
        onFinished,
        signal: new AbortController().signal,
    }

    return {
        req,
        onMessage,
        onError,
        onFinished,
    }
}

describe('AbstractOpenAI', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('lists models from a custom endpoint without requiring an API key', async () => {
        const fetcher = vi.fn().mockResolvedValue({
            json: async () => ({ data: [{ id: 'custom-model' }] }),
        })
        vi.mocked(getUniversalFetch).mockReturnValue(fetcher)
        const engine = new TestOpenAIEngine('custom-model', 'http://localhost:8000')

        await expect(engine.listModels(undefined)).resolves.toEqual([{ id: 'custom-model', name: 'custom-model' }])
        expect(fetcher).toHaveBeenCalledWith(
            'http://localhost:8000/v1/models',
            expect.objectContaining({
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            })
        )
    })

    it('routes GPT-5 models on official endpoint to Responses API and parses response deltas', async () => {
        const engine = new TestOpenAIEngine('gpt-5')
        const { req, onMessage, onFinished } = createMessageRequest()

        vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
            expect(input).toBe('https://api.openai.com/v1/responses')
            expect(typeof options.body).toBe('string')
            const payload = JSON.parse(options.body as string)
            expect(payload.model).toBe('gpt-5')
            expect(payload.stream).toBe(true)
            expect(payload.reasoning).toEqual({ effort: 'minimal' })
            expect(payload.reasoning_effort).toBeUndefined()
            expect(payload.input).toBe('Translate hello to Chinese')
            expect(payload.instructions).toBe('You are a translator')
            expect(payload.messages).toBeUndefined()

            await options.onMessage(JSON.stringify({ type: 'response.output_text.delta', delta: '你好' }))
            await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
        })

        await engine.sendMessage(req)

        expect(onMessage).toHaveBeenCalledWith({ content: '你好', role: 'assistant' })
        expect(onFinished).toHaveBeenCalledWith('stop')
    })

    it('keeps chat completions behavior for GPT-4 models', async () => {
        const engine = new TestOpenAIEngine('gpt-4')
        const { req, onMessage, onFinished } = createMessageRequest()

        vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
            expect(input).toBe('https://api.openai.com/v1/chat/completions')
            expect(typeof options.body).toBe('string')
            const payload = JSON.parse(options.body as string)
            expect(payload.model).toBe('gpt-4')
            expect(payload.messages).toEqual([
                {
                    role: 'user',
                    content: 'You are a translator\n\nTranslate hello to Chinese',
                },
            ])
            expect(payload.temperature).toBe(0)

            await options.onMessage(
                JSON.stringify({
                    choices: [{ delta: { content: '你好', role: 'assistant' } }],
                })
            )
            await options.onMessage(
                JSON.stringify({
                    // eslint-disable-next-line camelcase
                    choices: [{ delta: {}, finish_reason: 'stop' }],
                })
            )
        })

        await engine.sendMessage(req)

        expect(onMessage).toHaveBeenCalledWith({ content: '你好', role: 'assistant' })
        expect(onFinished).toHaveBeenCalledWith('stop')
    })

    it('merges and logs request body overrides for a custom OpenAI-compatible endpoint', async () => {
        vi.mocked(getSettings).mockResolvedValue({
            apiKeys: '',
            apiURL: 'http://localhost:8000',
            apiURLPath: '/v1/chat/completions',
            apiModel: 'gpt-4',
            customRequestBodyOverrides: JSON.stringify({
                temperature: 0.75,
                ['stream_options']: { ['include_usage']: true },
            }),
            thinkingEnabled: true,
        } as never)
        const engine = new OpenAI()
        const { req } = createMessageRequest()

        vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
            expect(input).toBe('http://localhost:8000/v1/chat/completions')
            const payload = JSON.parse(options.body as string)
            expect(payload.temperature).toBe(0.75)
            expect(payload['stream_options']).toEqual({ ['include_usage']: true })
            expect(payload.messages).toEqual([
                {
                    role: 'user',
                    content: 'You are a translator\n\nTranslate hello to Chinese',
                },
            ])

            options.onStatusCode?.(200)
            await options.onMessage(
                JSON.stringify({
                    // eslint-disable-next-line camelcase
                    choices: [{ delta: {}, finish_reason: 'stop' }],
                })
            )
        })

        await engine.sendMessage(req)
        expect(customRequestLogMocks.append).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'request-log-id',
                method: 'POST',
                url: 'http://localhost:8000/v1/chat/completions',
                requestBody: expect.objectContaining({
                    temperature: 0.75,
                    ['stream_options']: { ['include_usage']: true },
                }),
            })
        )
        expect(customRequestLogMocks.update).toHaveBeenCalledWith(
            'request-log-id',
            expect.objectContaining({ status: 200, finishReason: 'stop' })
        )
    })

    it('records a network error for a custom OpenAI-compatible endpoint', async () => {
        vi.mocked(getSettings).mockResolvedValue({
            apiKeys: '',
            apiURL: 'http://localhost:8000',
            apiURLPath: '/v1/chat/completions',
            apiModel: 'gpt-4',
            customRequestBodyOverrides: '{}',
            thinkingEnabled: true,
        } as never)
        vi.mocked(fetchSSE).mockRejectedValueOnce(new Error('network unavailable'))
        const engine = new OpenAI()
        const { req } = createMessageRequest()

        await expect(engine.sendMessage(req)).rejects.toThrow('network unavailable')
        expect(customRequestLogMocks.update).toHaveBeenCalledWith(
            'request-log-id',
            expect.objectContaining({ finishReason: 'error', error: 'network unavailable' })
        )
    })

    it('waits for the initial log entry before recording a fast completion', async () => {
        vi.mocked(getSettings).mockResolvedValue({
            apiKeys: '',
            apiURL: 'http://localhost:8000',
            apiURLPath: '/v1/chat/completions',
            apiModel: 'gpt-4',
            customRequestBodyOverrides: '{}',
            thinkingEnabled: true,
        } as never)
        let finishAppend: (() => void) | undefined
        customRequestLogMocks.append.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishAppend = resolve
            })
        )
        vi.mocked(fetchSSE).mockImplementationOnce(async (_input: string, options: MockFetchSSEOptions) => {
            await options.onMessage(
                JSON.stringify({
                    // eslint-disable-next-line camelcase
                    choices: [{ delta: {}, finish_reason: 'stop' }],
                })
            )
        })
        const engine = new OpenAI()
        const { req } = createMessageRequest()

        await engine.sendMessage(req)
        expect(customRequestLogMocks.update).not.toHaveBeenCalled()

        finishAppend?.()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(customRequestLogMocks.update).toHaveBeenCalledWith(
            'request-log-id',
            expect.objectContaining({ finishReason: 'stop' })
        )
    })

    it.each(['https://api.openai.com', 'https://API.OPENAI.COM', 'https://api.openai.com:443/'])(
        'does not customize or log requests to the official OpenAI endpoint %s',
        async (apiURL) => {
            vi.mocked(getSettings).mockResolvedValue({
                apiKeys: 'test-api-key',
                apiURL,
                apiURLPath: '/v1/chat/completions',
                apiModel: 'gpt-4',
                customRequestBodyOverrides: JSON.stringify({ model: 'unexpected-model' }),
                thinkingEnabled: true,
            } as never)
            const engine = new OpenAI()
            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (_input: string, options: MockFetchSSEOptions) => {
                const payload = JSON.parse(options.body as string)
                expect(payload.model).toBe('gpt-4')

                await options.onMessage(
                    JSON.stringify({
                        // eslint-disable-next-line camelcase
                        choices: [{ delta: {}, finish_reason: 'stop' }],
                    })
                )
            })

            await engine.sendMessage(req)
            expect(customRequestLogMocks.append).not.toHaveBeenCalled()
        }
    )

    it('does not send reasoning_effort for GPT-5 code models', async () => {
        const engine = new TestOpenAIEngine('gpt-5-code')
        const { req } = createMessageRequest()

        vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
            expect(input).toBe('https://api.openai.com/v1/responses')
            const payload = JSON.parse(options.body as string)
            expect(payload.model).toBe('gpt-5-code')
            expect(payload.stream).toBe(true)
            expect(payload.reasoning_effort).toBeUndefined()
            expect(payload.reasoning).toBeUndefined()

            await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
        })

        await engine.sendMessage(req)
    })

    it('does not send reasoning_effort for GPT-5 mini code models', async () => {
        const engine = new TestOpenAIEngine('gpt-5-mini-code')
        const { req } = createMessageRequest()

        vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
            expect(input).toBe('https://api.openai.com/v1/responses')
            const payload = JSON.parse(options.body as string)
            expect(payload.model).toBe('gpt-5-mini-code')
            expect(payload.reasoning_effort).toBeUndefined()
            expect(payload.reasoning).toBeUndefined()

            await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
        })

        await engine.sendMessage(req)
    })

    it('sends reasoning effort low for GPT-5 pro models via Responses API', async () => {
        const engine = new TestOpenAIEngine('gpt-5-pro')
        const { req } = createMessageRequest()

        vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
            expect(input).toBe('https://api.openai.com/v1/responses')
            const payload = JSON.parse(options.body as string)
            expect(payload.model).toBe('gpt-5-pro')
            expect(payload.stream).toBe(true)
            expect(payload.reasoning).toEqual({ effort: 'low' })
            expect(payload.reasoning_effort).toBeUndefined()

            await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
        })

        await engine.sendMessage(req)
    })

    it('sends reasoning effort low for GPT-5 mini pro models via Responses API', async () => {
        const engine = new TestOpenAIEngine('gpt-5-mini-pro')
        const { req } = createMessageRequest()

        vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
            expect(input).toBe('https://api.openai.com/v1/responses')
            const payload = JSON.parse(options.body as string)
            expect(payload.model).toBe('gpt-5-mini-pro')
            expect(payload.reasoning).toEqual({ effort: 'low' })
            expect(payload.reasoning_effort).toBeUndefined()

            await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
        })

        await engine.sendMessage(req)
    })

    it('does not send reasoning_effort for GPT-5 chat models', async () => {
        const engine = new TestOpenAIEngine('gpt-5-chat')
        const { req } = createMessageRequest()

        vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
            expect(input).toBe('https://api.openai.com/v1/responses')
            const payload = JSON.parse(options.body as string)
            expect(payload.model).toBe('gpt-5-chat')
            expect(payload.stream).toBe(true)
            expect(payload.reasoning_effort).toBeUndefined()
            expect(payload.reasoning).toBeUndefined()

            await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
        })

        await engine.sendMessage(req)
    })

    // Regression tests for #1853: reasoning_effort 'minimal' only exists on
    // the undotted gpt-5 series; dotted successors (gpt-5.1, gpt-5.6, ...)
    // must never receive it.
    describe("reasoning_effort 'minimal' gating", () => {
        it('sends minimal reasoning effort for GPT-5 nano via Responses API', async () => {
            const engine = new TestOpenAIEngine('gpt-5-nano')
            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                expect(input).toBe('https://api.openai.com/v1/responses')
                const payload = JSON.parse(options.body as string)
                expect(payload.model).toBe('gpt-5-nano')
                expect(payload.reasoning).toEqual({ effort: 'minimal' })

                await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })

        it.each(['gpt-5.6', 'gpt-5.10'])('does not send minimal reasoning effort for %s', async (model) => {
            vi.mocked(getSettings).mockResolvedValueOnce({ thinkingEnabled: true } as never)
            const engine = new TestOpenAIEngine(model)
            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                const payload = JSON.parse(options.body as string)
                expect(payload.model).toBe(model)
                expect(payload.reasoning_effort).toBeUndefined()
                expect(payload.reasoning).toBeUndefined()

                await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })

        it('does not send minimal reasoning effort for gpt-5.0 either', async () => {
            vi.mocked(getSettings).mockResolvedValueOnce({ thinkingEnabled: true } as never)
            const engine = new TestOpenAIEngine('gpt-5.0')
            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                const payload = JSON.parse(options.body as string)
                expect(payload.model).toBe('gpt-5.0')
                expect(payload.reasoning_effort).toBeUndefined()
                expect(payload.reasoning).toBeUndefined()

                await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })
    })

    describe('modelOverride', () => {
        it('should use modelOverride instead of getAPIModel when provided', async () => {
            const engine = new TestOpenAIEngine('gpt-4o')
            const { req } = createMessageRequest()
            req.modelOverride = 'gpt-3.5-turbo'

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                const body = JSON.parse(options.body as string)
                expect(body.model).toBe('gpt-3.5-turbo')
                await options.onMessage(
                    JSON.stringify({
                        // eslint-disable-next-line camelcase
                        choices: [{ delta: { content: 'hi' }, finish_reason: null }],
                    })
                )
                await options.onMessage(
                    JSON.stringify({
                        // eslint-disable-next-line camelcase
                        choices: [{ delta: {}, finish_reason: 'stop' }],
                    })
                )
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })

        it('should use getAPIModel when modelOverride is not provided', async () => {
            const engine = new TestOpenAIEngine('gpt-4o')
            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                const body = JSON.parse(options.body as string)
                expect(body.model).toBe('gpt-4o')
                await options.onMessage(
                    JSON.stringify({
                        // eslint-disable-next-line camelcase
                        choices: [{ delta: {}, finish_reason: 'stop' }],
                    })
                )
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })

        it('should ignore empty string modelOverride and use getAPIModel', async () => {
            const engine = new TestOpenAIEngine('gpt-4o')
            const { req } = createMessageRequest()
            req.modelOverride = ''

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                const body = JSON.parse(options.body as string)
                expect(body.model).toBe('gpt-4o')
                await options.onMessage(
                    JSON.stringify({
                        // eslint-disable-next-line camelcase
                        choices: [{ delta: {}, finish_reason: 'stop' }],
                    })
                )
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })

        it('should apply correct request params for overridden model', async () => {
            // Engine is configured with gpt-4o, but override to o1
            // o1 is routed to Responses API, so reasoning_effort becomes reasoning.effort
            const engine = new TestOpenAIEngine('gpt-4o')
            const { req } = createMessageRequest()
            req.modelOverride = 'o1'

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                expect(input).toBe('https://api.openai.com/v1/responses')
                const body = JSON.parse(options.body as string)
                expect(body.model).toBe('o1')
                // o-series reasoning_effort is transformed to reasoning.effort for Responses API
                expect(body.reasoning).toEqual({ effort: 'low' })
                expect(body.reasoning_effort).toBeUndefined()
                expect(body.temperature).toBeUndefined()
                await options.onMessage(JSON.stringify({ type: 'response.completed', response: {} }))
            })

            await engine.sendMessage(req)
        })
    })

    describe('thinkingEnabled reasoning_effort gating', () => {
        it('does not inject reasoning_effort:none for non-OpenAI providers (e.g. DeepSeek)', async () => {
            // Regression test for #1879: `reasoning_effort: 'none'` is only valid for OpenAI
            // GPT-5.1+ models. Other providers (DeepSeek, etc.) reject it.
            vi.mocked(getSettings).mockResolvedValueOnce({ thinkingEnabled: false } as never)
            const engine = new TestOpenAIEngine('deepseek-chat', 'https://api.deepseek.com', '/v1/chat/completions')
            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                const payload = JSON.parse(options.body as string)
                expect(payload.model).toBe('deepseek-chat')
                expect(payload.reasoning_effort).toBeUndefined()
                await options.onMessage(
                    JSON.stringify({
                        // eslint-disable-next-line camelcase
                        choices: [{ delta: {}, finish_reason: 'stop' }],
                    })
                )
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })

        it('injects reasoning_effort:none for GPT-5.1+ when thinking is disabled', async () => {
            vi.mocked(getSettings).mockResolvedValueOnce({ thinkingEnabled: false } as never)
            const engine = new TestOpenAIEngine('gpt-5.1', 'https://example.com', '/v1/chat/completions')
            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                const payload = JSON.parse(options.body as string)
                expect(payload.model).toBe('gpt-5.1')
                expect(payload.reasoning_effort).toBe('none')
                await options.onMessage(
                    JSON.stringify({
                        // eslint-disable-next-line camelcase
                        choices: [{ delta: {}, finish_reason: 'stop' }],
                    })
                )
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })

        it('does not inject reasoning_effort:none for GPT-5.1+ when thinking is enabled', async () => {
            vi.mocked(getSettings).mockResolvedValueOnce({ thinkingEnabled: true } as never)
            const engine = new TestOpenAIEngine('gpt-5.1', 'https://example.com', '/v1/chat/completions')
            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                const payload = JSON.parse(options.body as string)
                expect(payload.reasoning_effort).toBeUndefined()
                await options.onMessage(
                    JSON.stringify({
                        // eslint-disable-next-line camelcase
                        choices: [{ delta: {}, finish_reason: 'stop' }],
                    })
                )
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })

        it('injects reasoning_effort:none for Ollama so thinking can be disabled (#1881)', async () => {
            // Regression test for #1881: Ollama / LM Studio servers honor `reasoning_effort: 'none'`
            // to turn off thinking on hybrid models like Qwen3, so the Ollama engine must keep
            // sending it even though the conservative base default only allows GPT-5.1+.
            vi.mocked(getSettings).mockResolvedValue({
                thinkingEnabled: false,
                ollamaAPIURL: 'http://localhost:11434',
                ollamaAPIModel: 'qwen3',
                ollamaModelLifetimeInMemory: '5m',
            } as never)
            const engine = new Ollama()
            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (input: string, options: MockFetchSSEOptions) => {
                expect(input).toBe('http://localhost:11434/v1/chat/completions')
                const payload = JSON.parse(options.body as string)
                expect(payload.model).toBe('qwen3')
                expect(payload.reasoning_effort).toBe('none')
                await options.onMessage(
                    JSON.stringify({
                        // eslint-disable-next-line camelcase
                        choices: [{ delta: {}, finish_reason: 'stop' }],
                    })
                )
            })

            await engine.sendMessage(req)
            expect(vi.mocked(fetchSSE)).toHaveBeenCalled()
        })
    })
})
