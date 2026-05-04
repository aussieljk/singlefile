# @aussieljk/singlefile

Vite plugin to bundle a React app into a single HTML file.

## Installation

```bash
bun add -D @aussieljk/singlefile
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import singlefile from "@aussieljk/singlefile/plugin"

export default defineConfig({
  plugins: [
    react(),
    singlefile({ title: "My App" }),
  ],
})
```

Then visit `/__singlefile/` in your dev server to download your bundled HTML.

## Routes

| Route | Description |
|-------|-------------|
| `/__singlefile/` | Dashboard UI |
| `/__singlefile/download?mode=online` | Download (deps from CDN) |
| `/__singlefile/download?mode=offline` | Download (fully self-contained) |
| `/__singlefile/build` | JSON build result |

## Options

```ts
singlefile({
  title: "My App",           // HTML title (default: "App")
  mode: "online",            // Default mode: "online" | "offline"
  sourceZipName: "src.zip",  // Name for embedded source zip
})
```

## Build Modes

| Mode | Speed | Size | Network |
|------|-------|------|---------|
| online | ~2s | Smaller | Required |
| offline | ~5-30s | Larger | Not required |

## Source Download

Generated HTML embeds a zip of source files. Visit `yourfile.html#source` to download.
