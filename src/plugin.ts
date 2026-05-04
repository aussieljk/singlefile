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

        // Serve the library bundle
        if (path === "/__singlefile/lib.js") {
          try {
            const fs = await import("fs/promises")
            const p = await import("path")
            const libPath = p.join(p.dirname(import.meta.url.replace("file://", "")), "index.js")
            const code = await fs.readFile(libPath, "utf-8")
            res.setHeader("Content-Type", "application/javascript")
            res.end(code)
          } catch (e: any) {
            res.statusCode = 500
            res.end(`console.error("Failed to load lib:", ${JSON.stringify(e.message)})`)
          }
          return
        }

        // Serve built UI files
        const uiPath = path.replace("/__singlefile", "") || "/index.html"
        try {
          const fs = await import("fs/promises")
          const p = await import("path")
          const uiDir = p.join(p.dirname(import.meta.url.replace("file://", "")), "ui")
          let filePath = p.join(uiDir, uiPath)

          // Default to index.html for directory requests
          if (filePath.endsWith("/") || !p.extname(filePath)) {
            filePath = p.join(uiDir, "index.html")
          }

          const stat = await fs.stat(filePath).catch(() => null)
          if (!stat || !stat.isFile()) {
            filePath = p.join(uiDir, "index.html")
          }

          let content = await fs.readFile(filePath, "utf-8")

          // Inject config into index.html
          if (filePath.endsWith("index.html")) {
            const config = JSON.stringify({ title: options.title || "App", mode: options.mode || "online" })
            content = content.replace(
              "<head>",
              `<head><script>window.__SINGLEFILE_CONFIG__=${config}</script>`
            )
          }

          const ext = p.extname(filePath)
          const mimeTypes: Record<string, string> = {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
          }
          res.setHeader("Content-Type", mimeTypes[ext] || "text/plain")
          res.end(content)
        } catch (e: any) {
          // Fallback to inline HTML if UI not built
          res.setHeader("Content-Type", "text/html")
          res.end(getFallbackHtml(options))
        }
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

function getFallbackHtml(options: SinglefilePluginOptions) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Singlefile Builder</title>
  <style>
    body { font-family: system-ui; background: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #a1a1aa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Singlefile Builder</h1>
    <p>UI not built. Run: <code>cd ui && bun run build</code></p>
  </div>
</body>
</html>`
}

export default singlefile
