import { describe, expect, it } from 'vitest'
import { getManifest } from './manifest'

describe('Firefox manifest', () => {
    it('identifies the independent Firefox community fork', () => {
        const manifest = getManifest()

        expect(manifest.name).toBe('NextAI Translator Community for Firefox')
        expect(manifest.description).toBe(
            'Independent Firefox-only fork of NextAI Translator with custom OpenAI-compatible API support.'
        )
    })

    it('uses the fork maintainer add-on ID', () => {
        const manifest = getManifest()

        expect(manifest.browser_specific_settings?.gecko?.id).toBe('nextai-translator-firefox@rez1ce')
    })

    it('links users to the corresponding source repository', () => {
        const manifest = getManifest()

        expect(manifest.homepage_url).toBe('https://github.com/Rez1ce/nextai-translator-firefox')
    })

    it('discloses the data required for remote translation', () => {
        const manifest = getManifest()
        const gecko = manifest.browser_specific_settings?.gecko as
            | { data_collection_permissions?: { required?: string[] } }
            | undefined

        expect(gecko?.data_collection_permissions?.required).toEqual(['websiteContent', 'authenticationInfo'])
    })

    it('provides correctly sized Firefox icons', () => {
        const manifest = getManifest()

        expect(manifest.icons).toEqual({
            '16': 'icons/icon-16.png',
            '32': 'icons/icon-32.png',
            '48': 'icons/icon-48.png',
            '128': 'icon.png',
        })
    })

    it('allows background requests to custom API endpoints', () => {
        const manifest = getManifest()

        expect(manifest.host_permissions).toContain('<all_urls>')
        expect(manifest.background).toEqual({ scripts: ['src/browser-extension/background/index.ts'] })
        expect(manifest.background).not.toHaveProperty('service_worker')
    })
})
