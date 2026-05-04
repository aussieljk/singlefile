import type { Plugin, ViteDevServer } from "vite"

export interface SinglefilePluginOptions {
  title?: string
  mode?: "online" | "offline"
}

export function singlefile(options: SinglefilePluginOptions = {}): Plugin {
  return {
    name: "vite-plugin-singlefile",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__singlefile")) return next()

        const url = new URL(req.url, "http://localhost")
        const path = url.pathname

        // Serve source files as JSON
        if (path === "/__singlefile/sources") {
          try {
            const sources = await readSourceFiles(server)
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify(sources))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
          return
        }

        // Serve the library bundle
        if (path === "/__singlefile/lib.js") {
          const fs = await import("fs/promises")
          const p = await import("path")
          const libPath = p.join(p.dirname(import.meta.url.replace("file://", "")), "index.js")
          const code = await fs.readFile(libPath, "utf-8")
          res.setHeader("Content-Type", "application/javascript")
          res.end(code)
          return
        }

        // Serve deps from package.json
        if (path === "/__singlefile/deps") {
          try {
            const deps = await readDeps(server)
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify(deps))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
          return
        }

        // Serve the builder app
        if (path === "/__singlefile" || path === "/__singlefile/") {
          res.setHeader("Content-Type", "text/html")
          res.end(getBuilderHtml(options))
          return
        }

        next()
      })
    },
  }
}

async function readSourceFiles(server: ViteDevServer): Promise<Record<string, string>> {
  const fs = await import("fs/promises")
  const path = await import("path")
  const root = server.config.root
  const srcDir = path.join(root, "src")
  const files: Record<string, string> = {}
  const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".json"])

  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
        await walk(full)
      } else if (exts.has(path.extname(entry.name))) {
        const relPath = "/" + path.relative(root, full)
        files[relPath] = await fs.readFile(full, "utf-8")
      }
    }
  }

  await walk(srcDir)
  return files
}

async function readDeps(server: ViteDevServer): Promise<Record<string, string>> {
  const fs = await import("fs/promises")
  const root = server.config.root
  try {
    const pkg = JSON.parse(await fs.readFile(`${root}/package.json`, "utf-8"))
    return { ...pkg.dependencies, ...pkg.devDependencies }
  } catch {
    return {}
  }
}

function getBuilderHtml(options: SinglefilePluginOptions) {
  const title = options.title || "App"
  const defaultMode = options.mode || "online"

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Singlefile Builder</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center p-8">
  <div id="app" class="max-w-md w-full space-y-6">
    <h1 class="text-2xl font-semibold">Singlefile Builder</h1>
    <p class="text-zinc-400">Bundle your app into a single HTML file.</p>
    <div id="status" class="text-zinc-500">Loading...</div>
  </div>

  <script type="importmap">
    {
      "imports": {
        "esbuild-wasm": "https://esm.sh/esbuild-wasm@0.27.7",
        "fflate": "https://esm.sh/fflate@0.8.2"
      }
    }
  </script>
  <script type="module">
    import { buildSinglefile, downloadHtml } from "/__singlefile/lib.js"

    const title = ${JSON.stringify(title)}
    const defaultMode = ${JSON.stringify(defaultMode)}
    const status = document.getElementById("status")
    const app = document.getElementById("app")

    async function init() {
      status.textContent = "Fetching sources..."

      const [sourcesRes, depsRes] = await Promise.all([
        fetch("/__singlefile/sources"),
        fetch("/__singlefile/deps")
      ])

      const sourceFiles = await sourcesRes.json()
      const deps = await depsRes.json()
      const fileCount = Object.keys(sourceFiles).length

      status.textContent = \`Ready: \${fileCount} files\`

      app.innerHTML = \`
        <h1 class="text-2xl font-semibold">Singlefile Builder</h1>
        <p class="text-zinc-400">\${fileCount} source files ready to bundle.</p>

        <div class="space-y-3">
          <button id="online" class="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-medium transition">
            Download (Online)
          </button>
          <button id="offline" class="w-full bg-zinc-800 hover:bg-zinc-700 py-3 rounded-lg font-medium transition">
            Download (Offline)
          </button>
        </div>

        <div class="text-sm text-zinc-500 space-y-1">
          <p><strong>Online:</strong> Smaller file, loads deps from CDN (~2s)</p>
          <p><strong>Offline:</strong> Larger file, fully self-contained (~5-30s)</p>
        </div>

        <div id="progress" class="hidden p-4 rounded-lg bg-zinc-900 text-sm"></div>
      \`

      const progress = document.getElementById("progress")

      async function build(mode) {
        progress.className = "p-4 rounded-lg bg-zinc-900 text-sm"
        progress.textContent = mode === "offline"
          ? "Building (this may take 5-30s for offline mode)..."
          : "Building..."

        try {
          // Find entry point
          let entryPoint = "/src/main.tsx"
          const alts = ["/src/main.tsx", "/src/main.ts", "/src/index.tsx", "/src/index.ts"]
          for (const alt of alts) {
            if (sourceFiles[alt]) { entryPoint = alt; break }
          }

          const result = await buildSinglefile({
            mode,
            sourceFiles,
            deps,
            entryPoint,
            title,
          })

          if (result.errors.length > 0) {
            progress.innerHTML = '<span class="text-red-400">Build errors:</span><br>' +
              result.errors.map(e => e).join("<br>")
            return
          }

          const kb = (result.size / 1024).toFixed(1)
          progress.innerHTML = \`<span class="text-green-400">Built successfully!</span> \${kb} KB, \${result.externals.length} externals\`

          downloadHtml(result.html, \`\${title.toLowerCase().replace(/\\s+/g, "-")}.html\`)
        } catch (e) {
          progress.innerHTML = '<span class="text-red-400">Error:</span> ' + e.message
        }
      }

      document.getElementById("online").onclick = () => build("online")
      document.getElementById("offline").onclick = () => build("offline")
    }

    init().catch(e => { status.innerHTML = '<span class="text-red-400">Error:</span> ' + e.message })
  </script>
</body>
</html>`
}

export default singlefile
