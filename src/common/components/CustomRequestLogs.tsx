import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { clearCustomAPIRequestLogs, CustomAPIRequestLogEntry, getCustomAPIRequestLogs } from '../custom-api-request'

interface ICustomRequestLogsProps {
    active: boolean
}

export function CustomRequestLogs({ active }: ICustomRequestLogsProps) {
    const { t } = useTranslation()
    const [logs, setLogs] = useState<CustomAPIRequestLogEntry[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const refresh = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            setLogs(await getCustomAPIRequestLogs())
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        if (active) {
            void refresh()
        }
    }, [active, refresh])

    const clear = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            await clearCustomAPIRequestLogs()
            setLogs([])
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [])

    return (
        <section style={{ marginTop: 24 }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                }}
            >
                <strong style={{ fontSize: '1.2em' }}>{t('Request logs')}</strong>
                <span style={{ flexGrow: 1 }} />
                <button type='button' disabled={loading} onClick={() => void refresh()}>
                    {t('Refresh')}
                </button>
                <button
                    type='button'
                    disabled={loading || logs.length === 0}
                    data-testid='clear-request-logs'
                    onClick={() => void clear()}
                >
                    {t('Clear logs')}
                </button>
            </div>
            <p style={{ marginTop: 0, opacity: 0.75 }}>
                {t(
                    'The latest 100 custom OpenAI-compatible API requests are stored locally. Authorization secrets are redacted.'
                )}
            </p>
            {error ? <div style={{ color: '#d32f2f', marginBottom: 8 }}>{error}</div> : null}
            {!loading && logs.length === 0 ? <div>{t('No request logs yet')}</div> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflowY: 'auto' }}>
                {logs.map((entry) => (
                    <details
                        key={entry.id}
                        open
                        style={{ border: '1px solid currentColor', borderRadius: 6, padding: 8 }}
                    >
                        <summary style={{ cursor: 'pointer', overflowWrap: 'anywhere' }}>
                            {new Date(entry.timestamp).toLocaleString()} · {entry.method} · {entry.status ?? '—'} ·{' '}
                            {entry.durationMs === undefined ? '—' : `${entry.durationMs} ms`} · {entry.url}
                        </summary>
                        <pre
                            style={{
                                marginBottom: 0,
                                padding: 8,
                                overflowX: 'auto',
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                                background: 'rgba(127, 127, 127, 0.12)',
                            }}
                        >
                            {JSON.stringify(
                                {
                                    headers: entry.headers,
                                    requestBody: entry.requestBody,
                                    finishReason: entry.finishReason,
                                    error: entry.error,
                                },
                                null,
                                2
                            )}
                        </pre>
                    </details>
                ))}
            </div>
        </section>
    )
}
