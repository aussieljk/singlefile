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

Then visit `/__singlefile/` in your dev server.

## Features

- **Code Editor** - Edit source files directly in the browser
- **Download** - Build and download as single HTML file
- **Send to URL** - Build and POST to any endpoint with Bearer auth

## UI Routes

| Route | Description |
|-------|-------------|
| `/__singlefile/` | Builder UI |
| `/__singlefile/sources` | JSON of source files |
| `/__singlefile/deps` | JSON of dependencies |
| `/__singlefile/lib.js` | Bundler library |

## Options

```ts
singlefile({
  title: "My App",    // HTML title (default: "App")
  mode: "online",     // Default mode: "online" | "offline"
})
```

## Build Modes

| Mode | Speed | Size | Network |
|------|-------|------|---------|
| online | ~2s | Smaller | Required |
| offline | ~5-30s | Larger | Not required |

## Send to URL

The builder UI includes a form to POST the built HTML to any URL:
- Enter the target URL
- Optionally add a Bearer token for auth
- Select build mode (online/offline)
- Click "Build & Send"

The HTML is sent as the request body with `Content-Type: text/html`.
