#!/usr/bin/env node
import { buildSinglefile } from "./index"
import { readdir, readFile, writeFile, stat } from "fs/promises"
import { join, relative, extname } from "path"

const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".json"])

async function readFilesRecursive(
  dir: string,
  base: string = dir
): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      Object.assign(files, await readFilesRecursive(fullPath, base))
    } else if (SUPPORTED_EXTS.has(extname(entry.name))) {
      const relPath = "/" + relative(base, fullPath)
      files[relPath] = await readFile(fullPath, "utf-8")
    }
  }
  return files
}

async function main() {
  const args = process.argv.slice(2)

  let srcDir = "./src"
  let outFile = "index.html"
  let mode: "online" | "offline" = "online"
  let entryPoint = "/src/main.tsx"
  let title = "App"

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-o" || arg === "--output") {
      outFile = args[++i]
    } else if (arg === "--offline") {
      mode = "offline"
    } else if (arg === "-e" || arg === "--entry") {
      entryPoint = args[++i]
      if (!entryPoint.startsWith("/")) entryPoint = "/" + entryPoint
    } else if (arg === "-t" || arg === "--title") {
      title = args[++i]
    } else if (arg === "-h" || arg === "--help") {
      console.log(`singlefile - Bundle a React app into a single HTML file

Usage: singlefile [src-dir] [options]

Arguments:
  src-dir          Source directory (default: ./src)

Options:
  -o, --output     Output file (default: index.html)
  -e, --entry      Entry point path (default: /src/main.tsx)
  -t, --title      HTML title (default: App)
  --offline        Inline all dependencies (slower, works offline)
  -h, --help       Show this help

Examples:
  singlefile                     # Build ./src to index.html
  singlefile ./app -o out.html   # Build ./app to out.html
  singlefile --offline           # Build with all deps inlined`)
      process.exit(0)
    } else if (!arg.startsWith("-")) {
      srcDir = arg
    }
  }

  const cwd = process.cwd()
  const srcPath = join(cwd, srcDir)

  // Check if src dir exists
  try {
    const s = await stat(srcPath)
    if (!s.isDirectory()) {
      console.error(`Error: ${srcDir} is not a directory`)
      process.exit(1)
    }
  } catch {
    console.error(`Error: ${srcDir} does not exist`)
    process.exit(1)
  }

  // Read source files
  console.log(`Reading sources from ${srcDir}...`)
  const sourceFiles = await readFilesRecursive(srcPath, cwd)

  // Read package.json for deps
  let deps: Record<string, string> = {}
  try {
    const pkgPath = join(cwd, "package.json")
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"))
    deps = { ...pkg.dependencies, ...pkg.devDependencies }
  } catch {
    console.log("No package.json found, using empty deps")
  }

  // Adjust entry point if it doesn't exist but alternatives do
  if (!sourceFiles[entryPoint]) {
    const alts = ["/src/main.tsx", "/src/main.ts", "/src/index.tsx", "/src/index.ts", "/main.tsx", "/main.ts"]
    for (const alt of alts) {
      if (sourceFiles[alt]) {
        entryPoint = alt
        break
      }
    }
  }

  console.log(`Building ${Object.keys(sourceFiles).length} files (mode: ${mode})...`)

  const result = await buildSinglefile({
    mode,
    sourceFiles,
    deps,
    entryPoint,
    title,
  })

  if (result.errors.length > 0) {
    console.error("Build errors:")
    for (const err of result.errors) console.error("  " + err)
    process.exit(1)
  }

  if (result.warnings.length > 0) {
    for (const warn of result.warnings) console.warn("Warning: " + warn)
  }

  await writeFile(join(cwd, outFile), result.html)
  const kb = (result.size / 1024).toFixed(1)
  console.log(`✓ ${outFile} (${kb} KB, ${result.externals.length} externals)`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
