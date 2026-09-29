# Changelog

All notable changes to this independent Firefox fork are documented here.

## 0.6.44-firefox.1 — 2026-09-30

- Added a local language-detection fallback when Baidu, Google, or Bing detection fails or returns an unknown language.
- Added regression tests for remote language-detection failures and simplified/traditional Chinese detection.
- Added the official Mozilla Add-ons installation link to the project documentation.

## 0.6.43-firefox.1 — 2026-09-25

- Established an independent, community-maintained Firefox-only fork.
- Removed non-Firefox application and packaging targets.
- Adapted the Manifest V3 background process for Firefox.
- Added arbitrary custom OpenAI-compatible API origins.
- Added model discovery through the configured `/v1/models` endpoint.
- Avoided sending an empty authorization header during model discovery.
- Added focused regression tests for Firefox and custom API behavior.
- Assigned the independent add-on ID `nextai-translator-firefox@rez1ce`.
- Declared required website-content and authentication-data transmission for Firefox's install consent flow.
- Added correctly sized 16, 32, 48, and 128 pixel extension icons.
- Added AGPL attribution and Mozilla Add-ons build instructions.
