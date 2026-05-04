# Developer Experience Audit: @aussieljk/singlefile

> Browser-based bundler that creates single-file HTML apps using esbuild-wasm

**Audit Date:** 2026-05-04  
**Focus:** Developer experience and simplicity of use

---

## Summary

| Area | Score | Verdict |
|------|-------|---------|
| API Design | 7/10 | Good types and defaults, some naming confusion |
| Documentation | 6/10 | Has quick-start, missing return type docs |
| Error Handling | 5/10 | Some validation exists, several silent failures |
| Configuration | 7/10 | Sensible defaults, unnecessary required params |
| Build & Setup | 8/10 | Clean ESM, types included, peer deps add friction |

**Overall: 6.6/10** — Solid foundation, needs polish for production DX.

---

## 1. API Design & Ergonomics

### Strengths
- Clear `SinglefileOptions` interface with JSDoc comments
- Good defaults for `mode`, `entryPoint`, `title`
- Predictable `SinglefileResult` with errors/warnings arrays
- Clean separation: `buildSinglefile()` + `downloadHtml()` + `clearFetchCache()`

### Issues
| Problem | Impact | Fix |
|---------|--------|-----|
| `deps` is required but often empty | Devs must pass `deps: {}` even with no npm deps | Make optional, default `{}` |
| `sourceFiles` vs `projectFiles` confusing | Both take `Record<string, string>`, purpose unclear | Rename to `bundleFiles`/`zipFiles` |
| Path format undocumented | Must start with `/` but only in comments | Add runtime validation with helpful error |

---

## 2. Documentation Quality

### Strengths
- Quick-start example present and comprehensive
- Options table documents all `SinglefileOptions` properties
- Build modes (online/offline) explained with tradeoffs

### Gaps
| Missing | Why it matters |
|---------|----------------|
| `SinglefileResult` fields | Devs don't know what `externals`, `sourceFileCount` mean |
| Error types & failure modes | No guidance on debugging build failures |
| Limitations section | CSS becomes no-op, React-specific, hardcoded dark mode/Inter font |

### Recommendations
1. Add "Return Value" section documenting `SinglefileResult`
2. Add "Limitations" section noting React bias and assumptions
3. Add "Troubleshooting" for common errors

---

## 3. Error Handling & Debugging

### What Works
- Entry point validation with clear error message
- esbuild errors/warnings captured in result
- File not found errors are descriptive
- Fetch failures include HTTP status

### Problems
| Issue | Location | Impact |
|-------|----------|--------|
| Silent failure in `resolveVirtual` | line 67 | Returns fake path instead of erroring, defers failure |
| No input validation | `sourceFiles`, `deps` | Undefined inputs cause cryptic deep errors |
| esbuild init errors uncaught | lines 276-279 | WASM load failures bubble up with no context |
| No fetch retry/timeout | line 245 | Network failures give terse errors |

### Recommendations
1. Validate inputs at start of `buildSinglefile`
2. Wrap esbuild init with descriptive error message
3. Make `resolveVirtual` return `undefined` for missing files (fail fast)

---

## 4. Configuration & Defaults

### Good Defaults
- `mode: "online"` — fast iteration
- `entryPoint: "/src/main.tsx"` — common React structure
- `title: "App"` — reasonable fallback
- Most options optional

### Issues
| Config | Problem | Recommendation |
|--------|---------|----------------|
| `deps` | Required but could be `{}` | Default to `{}` |
| react/react-dom | Assumed but not enforced | Default to `{ react: "19.0.0", "react-dom": "19.0.0" }` |
| Missing react | Template requires it, no warning | Validate presence or warn |

---

## 5. Build & Setup Experience

### Strengths
- Clean ESM-only with `"type": "module"`
- Types included at `dist/index.d.ts`
- No postinstall scripts
- Exports field correctly configured

### Issues
| Issue | Impact | Fix |
|-------|--------|-----|
| No CJS support | CJS consumers fail | Document ESM-only or add CJS build |
| Peer deps not obvious | Users miss `esbuild-wasm` + `fflate` | Add copy-paste install command |
| Exports order | `"types"` should come before `"import"` | Reorder for faster TS resolution |

### Recommended Install Command for README
```bash
bun add @aussieljk/singlefile esbuild-wasm fflate
```

---

## Priority Improvements

### High Impact, Low Effort
1. **Make `deps` optional** — default to `{}`
2. **Add install command with peer deps** to README
3. **Document `SinglefileResult`** return fields

### High Impact, Medium Effort
4. **Add input validation** at start of `buildSinglefile`
5. **Rename `sourceFiles`/`projectFiles`** to `bundleFiles`/`zipFiles`
6. **Wrap esbuild init** with descriptive error

### Nice to Have
7. Default react/react-dom versions
8. Add "Limitations" section to README
9. Reorder exports conditions (`types` first)

---

## Conclusion

The library has a solid foundation with good TypeScript types and sensible defaults. The main DX friction comes from:

1. **Required params that should be optional** (`deps`)
2. **Missing documentation** (return types, limitations, troubleshooting)
3. **Silent failures** that make debugging harder

Addressing the high-impact items above would significantly improve the onboarding experience for new users.
