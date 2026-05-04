# @aussieljk/singlefile

Bundle a React app into a single HTML file.

## Installation

```bash
bun add -g @aussieljk/singlefile esbuild-wasm fflate
```

## CLI Usage

```bash
# Build ./src to index.html
singlefile

# Build specific directory
singlefile ./app -o out.html

# Build with all deps inlined (works offline)
singlefile --offline

# Custom entry point and title
singlefile -e /src/index.tsx -t "My App"
```

### Options

```
singlefile [src-dir] [options]

Arguments:
  src-dir          Source directory (default: ./src)

Options:
  -o, --output     Output file (default: index.html)
  -e, --entry      Entry point path (default: /src/main.tsx)
  -t, --title      HTML title (default: App)
  --offline        Inline all dependencies (slower, works offline)
  -h, --help       Show help
```

## Programmatic API

```typescript
import { buildSinglefile } from "@aussieljk/singlefile"

const result = await buildSinglefile({
  mode: "online",
  sourceFiles: {
    "/src/main.tsx": `import { createRoot } from "react-dom/client"
createRoot(document.getElementById("root")!).render(<div>Hello</div>)`,
  },
  deps: { react: "19.2.4", "react-dom": "19.2.4" },
})

if (result.errors.length === 0) {
  console.log(result.html)
}
```

## Build Modes

| Mode | Speed | Output Size | Network |
|------|-------|-------------|---------|
| online | ~2s | Smaller | Required |
| offline | ~5-30s | Larger | Not required |

## Source Download

Generated HTML embeds a zip of source files. Visit `yourfile.html#source` to download.
