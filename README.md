# NextAI Translator Community for Firefox

An independent, community-maintained Firefox-only fork of [NextAI Translator](https://github.com/nextai-translator/nextai-translator).

This project is not affiliated with or endorsed by the upstream maintainers. It focuses exclusively on Firefox and intentionally excludes Tauri, Electron, Chromium, Safari, userscript, and native packaging targets.

## Differences from upstream

-   Firefox-only WebExtension build.
-   Firefox Manifest V3 background-script compatibility.
-   Custom OpenAI-compatible API origins.
-   Model discovery through `GET {API URL}/v1/models`.
-   `Authorization: Bearer ...` is sent for model discovery only when an API key is configured.

Firefox requests access to all sites because a custom API can use any origin.

## Data transmission

Translation requires sending the content selected by the user to the API provider configured in the extension. When an API key is configured, it is sent only to that configured provider as an authorization credential. The extension does not include analytics or advertising telemetry.

The Firefox manifest declares the `websiteContent` and `authenticationInfo` data categories so this behavior is visible during installation.

## Development

Requirements:

-   Node.js 24.x (`.node-version` pins the reviewed build version).
-   pnpm 9.1.3.
-   `zip` 3.0 or compatible.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## Packaging

Build the unsigned Firefox extension archive:

```bash
pnpm package
```

The result is written to `dist/nextai-translator-firefox.zip`.

Maintainers can create both the extension and its matching source archive from a clean Git commit:

```bash
pnpm package:amo
```

See `AMO_BUILD.md` for the reproducible Mozilla Add-ons review instructions.

## Temporary installation

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json` after running `pnpm build`.

Permanent installation in regular Firefox requires a Mozilla-signed XPI.

## Origin and modifications

This repository is based on [nextai-translator/nextai-translator](https://github.com/nextai-translator/nextai-translator). The fork was modified in 2026 and is maintained independently by [Rez1ce](https://github.com/Rez1ce).

See `NOTICE` and `CHANGELOG.md` for attribution and a summary of modifications.

## License

This project is distributed under the GNU Affero General Public License v3.0 (`AGPL-3.0`). See `LICENSE`.

The source code for each distributed version is available from this repository and its matching Git tag.
