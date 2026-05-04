import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

declare const CodeMirror: any

interface BuildResult {
  html: string
  size: number
  externals: string[]
  errors: string[]
  warnings: string[]
}

async function loadSinglefile() {
  const mod = await import("/__singlefile/lib.js")
  return mod as {
    buildSinglefile: (options: any) => Promise<BuildResult>
    downloadHtml: (html: string, filename: string) => void
  }
}

export default function App() {
  const [sourceFiles, setSourceFiles] = useState<Record<string, string>>({})
  const [deps, setDeps] = useState<Record<string, string>>({})
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [status, setStatus] = useState<{ type: "idle" | "loading" | "success" | "error"; message: string }>({
    type: "loading",
    message: "Loading sources...",
  })
  const [sendUrl, setSendUrl] = useState("")
  const [sendToken, setSendToken] = useState("")
  const [sendMode, setSendMode] = useState<"online" | "offline">("online")
  const [building, setBuilding] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  const editorInstanceRef = useRef<any>(null)
  const editorsCache = useRef<Map<string, any>>(new Map())

  // Load config from window if available (set by plugin)
  const config = (window as any).__SINGLEFILE_CONFIG__ || { title: "App" }

  useEffect(() => {
    async function load() {
      try {
        const [sourcesRes, depsRes] = await Promise.all([
          fetch("/__singlefile/sources"),
          fetch("/__singlefile/deps"),
        ])
        const sources = await sourcesRes.json()
        const d = await depsRes.json()
        setSourceFiles(sources)
        setDeps(d)
        const files = Object.keys(sources).sort()
        if (files.length > 0) {
          setCurrentFile(files[0])
        }
        setStatus({ type: "idle", message: `${files.length} files` })
      } catch (e: any) {
        setStatus({ type: "error", message: e.message })
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (!currentFile || !editorRef.current) return

    // Destroy current editor
    if (editorInstanceRef.current) {
      // Save current content
      const prevFile = editorInstanceRef.current._file
      if (prevFile) {
        setSourceFiles((prev) => ({
          ...prev,
          [prevFile]: editorInstanceRef.current.getValue(),
        }))
      }
    }

    // Check cache
    if (editorsCache.current.has(currentFile)) {
      const cached = editorsCache.current.get(currentFile)!
      editorRef.current.innerHTML = ""
      editorRef.current.appendChild(cached.getWrapperElement())
      editorInstanceRef.current = cached
      cached.refresh()
      return
    }

    // Create new editor
    editorRef.current.innerHTML = ""
    const mode = currentFile.endsWith(".css") ? "css" : "jsx"
    const cm = CodeMirror(editorRef.current, {
      value: sourceFiles[currentFile] || "",
      mode,
      theme: "dracula",
      lineNumbers: true,
      tabSize: 2,
      indentWithTabs: false,
    })
    cm._file = currentFile
    cm.on("change", () => {
      const file = cm._file
      if (file) {
        setSourceFiles((prev) => ({ ...prev, [file]: cm.getValue() }))
      }
    })
    editorsCache.current.set(currentFile, cm)
    editorInstanceRef.current = cm
  }, [currentFile, sourceFiles])

  const findEntryPoint = useCallback(() => {
    const alts = ["/src/main.tsx", "/src/main.ts", "/src/index.tsx", "/src/index.ts"]
    for (const alt of alts) {
      if (sourceFiles[alt]) return alt
    }
    return "/src/main.tsx"
  }, [sourceFiles])

  const build = useCallback(
    async (mode: "online" | "offline") => {
      setBuilding(true)
      setStatus({ type: "loading", message: mode === "offline" ? "Building (5-30s)..." : "Building..." })

      try {
        const { buildSinglefile } = await loadSinglefile()
        const result = await buildSinglefile({
          mode,
          sourceFiles,
          deps,
          entryPoint: findEntryPoint(),
          title: config.title,
        })

        if (result.errors.length > 0) {
          setStatus({ type: "error", message: result.errors.join("\n") })
          return null
        }

        const kb = (result.size / 1024).toFixed(1)
        setStatus({ type: "success", message: `Built! ${kb} KB` })
        return result
      } catch (e: any) {
        setStatus({ type: "error", message: e.message })
        return null
      } finally {
        setBuilding(false)
      }
    },
    [sourceFiles, deps, findEntryPoint, config.title]
  )

  const handleDownload = useCallback(
    async (mode: "online" | "offline") => {
      const result = await build(mode)
      if (result) {
        const { downloadHtml } = await loadSinglefile()
        const filename = `${config.title.toLowerCase().replace(/\s+/g, "-")}.html`
        downloadHtml(result.html, filename)
      }
    },
    [build, config.title]
  )

  const handleSend = useCallback(async () => {
    if (!sendUrl) {
      setStatus({ type: "error", message: "Enter a URL" })
      return
    }

    const result = await build(sendMode)
    if (!result) return

    setStatus({ type: "loading", message: "Sending..." })

    try {
      const headers: Record<string, string> = { "Content-Type": "text/html" }
      if (sendToken) {
        headers["Authorization"] = `Bearer ${sendToken}`
      }

      const res = await fetch(sendUrl, {
        method: "POST",
        headers,
        body: result.html,
      })

      if (res.ok) {
        setStatus({ type: "success", message: `Sent! ${res.status}` })
      } else {
        setStatus({ type: "error", message: `Failed: ${res.status}` })
      }
    } catch (e: any) {
      setStatus({ type: "error", message: e.message })
    }
  }, [sendUrl, sendToken, sendMode, build])

  const files = Object.keys(sourceFiles).sort()

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">Singlefile Builder</h1>
        <div
          className={cn(
            "text-sm px-2 py-1 rounded",
            status.type === "loading" && "text-muted-foreground",
            status.type === "success" && "text-success",
            status.type === "error" && "text-destructive",
            status.type === "idle" && "text-muted-foreground"
          )}
        >
          {status.message}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* File list */}
        <aside className="w-64 border-r border-border flex flex-col">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Files
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {files.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => setCurrentFile(path)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded text-sm truncate transition-colors",
                    currentFile === path
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  {path}
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Editor */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-border text-sm text-muted-foreground">
            {currentFile || "No file selected"}
          </div>
          <div ref={editorRef} className="flex-1 overflow-hidden" />
        </main>

        {/* Actions panel */}
        <aside className="w-72 border-l border-border p-4 space-y-6 overflow-y-auto">
          {/* Download section */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Download</h2>
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => handleDownload("online")}
                loading={building}
              >
                Online Mode
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => handleDownload("offline")}
                loading={building}
              >
                Offline Mode
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Online:</strong> Smaller, needs network<br />
              <strong>Offline:</strong> Larger, self-contained
            </p>
          </section>

          {/* Send section */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Send to URL</h2>
            <div className="space-y-2">
              <Input
                type="url"
                placeholder="https://..."
                value={sendUrl}
                onChange={(e) => setSendUrl(e.target.value)}
              />
              <Input
                type="text"
                placeholder="API token (optional)"
                value={sendToken}
                onChange={(e) => setSendToken(e.target.value)}
              />
              <Select value={sendMode} onChange={(e) => setSendMode(e.target.value as "online" | "offline")}>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </Select>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSend}
                loading={building}
              >
                Build & Send
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              POSTs HTML with Bearer token auth
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
