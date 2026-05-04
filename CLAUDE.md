# @aussieljk/singlefile

Vite plugin that bundles React apps into single-file HTML using esbuild-wasm.

## Structure

- `src/` - Plugin and core bundler
- `ui/` - React UI for the builder (Vite + Tailwind)
- `dist/` - Built output
- `dist/ui/` - Built UI assets

## Development

```bash
bun install           # Install deps
bun run build         # Build plugin
bun run build:ui      # Build UI (cd ui && bun run build)
bun run build:all     # Build everything
```

## Publishing

```bash
npm version patch     # Bump version
npm publish --access public
```
