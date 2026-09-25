/* eslint-disable camelcase */
import { version } from '../../package.json'

export function getManifest() {
    const manifest: chrome.runtime.Manifest = {
        manifest_version: 3,

        name: 'NextAI Translator Community for Firefox',
        description: `Independent Firefox-only fork of NextAI Translator with custom OpenAI-compatible API support.`,
        version: version,
        homepage_url: 'https://github.com/Rez1ce/nextai-translator-firefox',

        icons: {
            '16': 'icons/icon-16.png',
            '32': 'icons/icon-32.png',
            '48': 'icons/icon-48.png',
            '128': 'icon.png',
        },

        options_ui: {
            page: 'src/browser-extension/options/index.html',
            open_in_tab: true,
        },

        action: {
            default_icon: 'icon.png',
            default_popup: 'src/browser-extension/popup/index.html',
        },

        content_scripts: [
            {
                matches: ['<all_urls>'],
                all_frames: true,
                match_about_blank: true,
                js: ['src/browser-extension/content_script/index.tsx'],
            },
        ],

        background: {
            // Firefox MV3 continues to use a background script. The Vite
            // plugin emits the generated script through background.html.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            scripts: ['src/browser-extension/background/index.ts'],
        },

        permissions: ['storage', 'contextMenus', 'webRequest'],

        commands: {
            'open-popup': {
                suggested_key: {
                    default: 'Ctrl+Shift+Y',
                    mac: 'Command+Shift+Y',
                },
                description: 'Open the popup',
            },
        },

        host_permissions: ['<all_urls>'],
        browser_specific_settings: {
            gecko: {
                id: 'nextai-translator-firefox@rez1ce',
                data_collection_permissions: {
                    required: ['websiteContent', 'authenticationInfo'],
                },
            },
        },
    }
    return manifest
}
