# Mozilla Add-ons source build instructions

These instructions build version 0.6.44 of NextAI Translator Community for Firefox from the submitted source archive.

## Build environment

The release build is verified with:

- Linux x86_64
- Node.js 24.14.0
- pnpm 9.1.3
- Info-ZIP 3.0

The project contains no native application components. All build dependencies are downloaded from the public npm registry and pinned by `pnpm-lock.yaml`.

## Build steps

Run these commands from the root of the extracted source archive:

```bash
npm exec --yes pnpm@9.1.3 -- install --frozen-lockfile
npm run package
```

The unsigned extension archive is created at:

```text
dist/nextai-translator-firefox.zip
```

Its contents are built from `dist/firefox/`. The ZIP root contains `manifest.json`; there is no enclosing directory.

## Review notes

- TypeScript is type-checked before the Vite production build.
- Vite bundles and minifies the extension code; the submitted source archive contains the unprocessed TypeScript, TSX, HTML, CSS, and configuration files.
- No obfuscator or web-based build tool is used.
- `pnpm-lock.yaml` is included so dependency resolution is reproducible.
- Network access during the build is used only by the package manager to download dependencies from the public npm registry.
