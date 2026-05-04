import * as esbuild from "esbuild-wasm"
import { zipSync, strToU8 } from "fflate"

// Persist esbuild initialization across HMR reloads
const initPromiseKey = "__esbuild_singlefile_init__"
type GlobalState = { [initPromiseKey]?: Promise<void> }
const _global = globalThis as GlobalState

export type BuildMode = "online" | "offline"

export interface SinglefileOptions {
  /** Build mode: "online" uses import maps, "offline" inlines all deps */
  mode?: BuildMode
  /** Source files to bundle (keyed by absolute path like "/src/App.tsx") */
  sourceFiles: Record<string, string>
  /** All project files for the embedded source zip (superset of sourceFiles) */
  projectFiles?: Record<string, string>
  /** Package dependency versions (e.g. { "react": "19.2.4" }) */
  deps: Record<string, string>
  /** Entry point path within sourceFiles. Defaults to "/src/main.tsx" */
  entryPoint?: string
  /** HTML title. Defaults to "App" */
  title?: string
  /** Environment variables to define (e.g. { VITE_API_URL: "https://..." }) */
  env?: Record<string, string>
  /** Source transforms to apply before bundling */
  transforms?: Array<(path: string, content: string) => string>
  /** URL for esbuild wasm file. Defaults to jsdelivr CDN */
  wasmURL?: string
  /** Name for downloaded source zip. Defaults to "source.zip" */
  sourceZipName?: string
}

export interface SinglefileResult {
  html: string
  size: number
  externals: string[]
  errors: string[]
  warnings: string[]
  sourceFileCount: number
}

function normalizePath(p: string): string {
  const parts = p.split("/").filter(Boolean)
  const result: string[] = []
  for (const part of parts) {
    if (part === ".") continue
    if (part === "..") {
      result.pop()
      continue
    }
    result.push(part)
  }
  return "/" + result.join("/")
}

function resolveVirtual(
  path: string,
  files: Record<string, string>
): { path: string; namespace: string } | undefined {
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]
  for (const ext of exts) {
    if (files[path + ext] != null) {
      return { path: path + ext, namespace: "virtual" }
    }
  }
  return { path, namespace: "virtual" }
}

function parsePackageName(specifier: string): { pkg: string; subpath: string } {
  const parts = specifier.split("/")
  if (specifier.startsWith("@")) {
    return {
      pkg: parts.slice(0, 2).join("/"),
      subpath: parts.length > 2 ? "/" + parts.slice(2).join("/") : "",
    }
  }
  return {
    pkg: parts[0],
    subpath: parts.length > 1 ? "/" + parts.slice(1).join("/") : "",
  }
}

function makeEsmShUrl(specifier: string, deps: Record<string, string>): string {
  const { pkg: name, subpath } = parsePackageName(specifier)
  const version = deps[name]?.replace(/^[\^~]/, "") ?? ""
  const versionStr = version ? `@${version}` : ""
  const base = `https://esm.sh/${name}${versionStr}${subpath}`
  if (name === "react" || name === "react-dom") return base
  return base + "?external=react,react-dom"
}

function createSourceZip(projectFiles: Record<string, string>): string {
  const files: Record<string, Uint8Array> = {}
  for (const [path, content] of Object.entries(projectFiles)) {
    files[path.slice(1)] = strToU8(content)
  }
  const zipped = zipSync(files, { level: 6 })
  let binary = ""
  for (let i = 0; i < zipped.length; i++) {
    binary += String.fromCharCode(zipped[i])
  }
  return btoa(binary)
}

function createVirtualFsPlugin(
  externals: Set<string>,
  offline: boolean,
  files: Record<string, string>,
  deps: Record<string, string>,
  transforms: Array<(path: string, content: string) => string>
): esbuild.Plugin {
  function toUrl(specifier: string): string {
    const { pkg: name, subpath } = parsePackageName(specifier)
    const version = deps[name]?.replace(/^[\^~]/, "") ?? ""
    const versionStr = version ? `@${version}` : ""
    return `https://esm.sh/${name}${versionStr}${subpath}`
  }

  return {
    name: "singlefile-virtual-fs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === "esm-fetch") return undefined

        // @/ alias
        if (args.path.startsWith("@/")) {
          return resolveVirtual(args.path.replace("@/", "/src/"), files)
        }
        // Relative imports
        if (args.path.startsWith(".")) {
          const dir = args.importer
            ? args.importer.replace(/\/[^/]+$/, "")
            : args.resolveDir || "/src"
          return resolveVirtual(normalizePath(dir + "/" + args.path), files)
        }
        // Absolute paths
        if (args.path.startsWith("/")) {
          return resolveVirtual(args.path, files)
        }
        // Bare specifiers → external or fetch from esm.sh
        externals.add(args.path)
        if (offline) {
          return { path: toUrl(args.path), namespace: "esm-fetch" }
        }
        return { path: args.path, external: true }
      })

      build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
        let content = files[args.path]
        if (content == null) {
          return { errors: [{ text: `File not found: ${args.path}` }] }
        }

        // CSS imports → no-op (assumes Tailwind CDN handles styles)
        if (args.path.endsWith(".css")) {
          return { contents: "", loader: "js" }
        }

        // Apply transforms
        for (const transform of transforms) {
          content = transform(args.path, content)
        }

        const loader: esbuild.Loader = args.path.endsWith(".tsx")
          ? "tsx"
          : args.path.endsWith(".ts")
            ? "ts"
            : "js"
        return { contents: content, loader }
      })
    },
  }
}

/** Cache for fetched esm.sh modules (persists across builds in same session) */
const fetchCache = new Map<string, string>()

function createEsmFetchPlugin(deps: Record<string, string>): esbuild.Plugin {
  function toEsmShUrl(specifier: string): string {
    const { pkg: name, subpath } = parsePackageName(specifier)
    const version = deps[name]?.replace(/^[\^~]/, "") ?? ""
    const versionStr = version ? `@${version}` : ""
    return `https://esm.sh/${name}${versionStr}${subpath}`
  }

  const reactVersion = deps["react"]?.replace(/^[\^~]/, "") ?? ""
  const reactDomVersion = deps["react-dom"]?.replace(/^[\^~]/, "") ?? ""

  function isReactSpecifier(s: string): string | null {
    if (s === "react" || s.startsWith("react/")) {
      const subpath = s.slice("react".length)
      return `https://esm.sh/react@${reactVersion}${subpath}`
    }
    if (s === "react-dom" || s.startsWith("react-dom/")) {
      const subpath = s.slice("react-dom".length)
      return `https://esm.sh/react-dom@${reactDomVersion}${subpath}`
    }
    if (s.startsWith("/react@") || s.startsWith("/react-dom@")) {
      const isRD = s.startsWith("/react-dom@")
      const pkg = isRD ? "react-dom" : "react"
      const ver = isRD ? reactDomVersion : reactVersion
      const pathParts = s.split("/")
      let subpath = ""
      if (pathParts.length > 2) {
        subpath = "/" + pathParts.slice(2).join("/")
        subpath = subpath.split("?")[0]
      }
      return `https://esm.sh/${pkg}@${ver}${subpath}`
    }
    return null
  }

  return {
    name: "singlefile-esm-fetch",
    setup(build) {
      build.onResolve({ filter: /.*/, namespace: "esm-fetch" }, (args) => {
        const reactRedirect = isReactSpecifier(args.path)
        if (reactRedirect) {
          return { path: reactRedirect, namespace: "esm-fetch" }
        }
        if (args.path.startsWith("https://")) {
          const urlPath = args.path.replace("https://esm.sh", "")
          const reactUrlRedirect = isReactSpecifier(urlPath)
          if (reactUrlRedirect) {
            return { path: reactUrlRedirect, namespace: "esm-fetch" }
          }
          return { path: args.path, namespace: "esm-fetch" }
        }
        if (args.path.startsWith(".") || args.path.startsWith("/")) {
          const base = args.importer.startsWith("https://")
            ? args.importer
            : toEsmShUrl(args.importer)
          const resolved = new URL(args.path, base).href
          return { path: resolved, namespace: "esm-fetch" }
        }
        return { path: toEsmShUrl(args.path), namespace: "esm-fetch" }
      })

      build.onLoad({ filter: /.*/, namespace: "esm-fetch" }, async (args) => {
        const url = args.path
        if (fetchCache.has(url)) {
          return { contents: fetchCache.get(url)!, loader: "js" }
        }
        const res = await fetch(url)
        if (!res.ok) {
          return { errors: [{ text: `Failed to fetch ${url}: ${res.status}` }] }
        }
        const contents = await res.text()
        fetchCache.set(url, contents)
        if (res.url !== url) fetchCache.set(res.url, contents)
        return { contents, loader: "js" }
      })
    },
  }
}

/**
 * Bundle source files into a single HTML file
 */
export async function buildSinglefile(options: SinglefileOptions): Promise<SinglefileResult> {
  const {
    mode = "online",
    sourceFiles,
    projectFiles = sourceFiles,
    deps,
    entryPoint = "/src/main.tsx",
    title = "App",
    env = {},
    transforms = [],
    wasmURL = "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.27.7/esbuild.wasm",
    sourceZipName = "source.zip",
  } = options

  // Initialize esbuild (once per session)
  if (!_global[initPromiseKey]) {
    _global[initPromiseKey] = esbuild.initialize({ wasmURL, worker: false })
  }
  await _global[initPromiseKey]

  const offline = mode === "offline"
  const externals = new Set<string>()
  const stdinContents = sourceFiles[entryPoint]

  if (!stdinContents) {
    return {
      html: "",
      size: 0,
      externals: [],
      errors: [`Entry point not found: ${entryPoint}`],
      warnings: [],
      sourceFileCount: 0,
    }
  }

  const plugins: esbuild.Plugin[] = [
    createVirtualFsPlugin(externals, offline, sourceFiles, deps, transforms),
  ]
  if (offline) {
    plugins.push(createEsmFetchPlugin(deps))
  }

  // Build define object from env
  const define: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    define[`import.meta.env.${key}`] = JSON.stringify(value)
  }

  const result = await esbuild.build({
    stdin: {
      contents: stdinContents,
      loader: "tsx",
      resolveDir: "/",
      sourcefile: entryPoint,
    },
    bundle: true,
    format: "esm",
    jsx: "automatic",
    write: false,
    minify: offline,
    define,
    plugins,
    logLevel: "warning",
  })

  const js = (result.outputFiles?.[0]?.text ?? "").replace(/<\/script>/gi, "<\\/script>")
  const rawCss = sourceFiles["/src/index.css"] ?? ""
  const customCss = rawCss.replace(/^@import\s+["'][^"']+["'];?\s*$/gm, "").trim()
  const sourceB64 = createSourceZip(projectFiles)

  const downloadScript = `<script>
(function(){
  function dl(){
    if(location.hash!=="#source")return;
    var s=document.getElementById("source");
    if(!s)return;
    var b=atob(s.textContent),a=new Uint8Array(b.length);
    for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
    var url=URL.createObjectURL(new Blob([a],{type:"application/zip"}));
    var l=document.createElement("a");l.href=url;l.download="${sourceZipName}";
    document.body.appendChild(l);l.click();l.remove();URL.revokeObjectURL(url);
    history.replaceState(null,"",location.pathname);
  }
  window.addEventListener("hashchange",dl);dl();
})();
<\/script>`

  let html: string
  if (offline) {
    html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="preconnect" href="https://rsms.me/">
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"><\/script>
  <style type="text/tailwindcss">
${customCss}
  </style>
  <script type="application/zip" id="source">${sourceB64}<\/script>
${downloadScript}
</head>
<body class="bg-background text-foreground dark">
  <div id="root"></div>
  <script type="module">
${js}
  </script>
</body>
</html>`
  } else {
    const imports: Record<string, string> = {}
    for (const spec of externals) {
      imports[spec] = makeEsmShUrl(spec, deps)
    }
    const seen = new Set<string>()
    for (const spec of externals) {
      const { pkg: p } = parsePackageName(spec)
      if (seen.has(p)) continue
      seen.add(p)
      const version = deps[p]?.replace(/^[\^~]/, "") ?? ""
      const versionStr = version ? `@${version}` : ""
      const isReact = p === "react" || p === "react-dom"
      const baseUrl = `https://esm.sh/${p}${versionStr}`
      if (!imports[p]) {
        imports[p] = isReact ? baseUrl : baseUrl + "?external=react,react-dom"
      }
      if (isReact) {
        imports[p + "/"] = baseUrl + "/"
      }
    }

    html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="preconnect" href="https://rsms.me/">
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"><\/script>
  <style type="text/tailwindcss">
${customCss}
  </style>
  <script type="importmap">
${JSON.stringify({ imports }, null, 2)}
  </script>
  <script type="application/zip" id="source">${sourceB64}<\/script>
${downloadScript}
</head>
<body class="bg-background text-foreground dark">
  <div id="root"></div>
  <script type="module">
${js}
  </script>
</body>
</html>`
  }

  return {
    html,
    size: new Blob([html]).size,
    externals: [...externals],
    errors: result.errors.map((e) => e.text),
    warnings: result.warnings.map((w) => w.text),
    sourceFileCount: Object.keys(projectFiles).length,
  }
}

/**
 * Trigger download of an HTML string as a file
 */
export function downloadHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Clear the esm.sh fetch cache (useful for forcing fresh fetches)
 */
export function clearFetchCache(): void {
  fetchCache.clear()
}
