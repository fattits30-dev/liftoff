# CLAUDE.md - Liftoff Extension Development Guide

## Project Overview

Liftoff is a VS Code extension that transforms natural language descriptions into fully functional, deployable web applications. It's an autonomous AI agent system similar to Lovable, Bolt.new, and GPT Pilot.

**Repository:** `C:\Users\sava6\ClaudeHome\projects\liftoff`

---

## Available MCP Servers

| Server | Tools | Use Case |
|--------|-------|----------|
| **serena** | `find_symbol`, `get_symbol_definition`, `replace_symbol_body`, `rename_symbol` | Editing existing code with semantic understanding |
| **context7** | `resolve-library-id`, `get-library-docs` | Get up-to-date docs for React, Tailwind, Supabase, etc. |
| **filesystem** | `read_file`, `write_file`, `list_directory`, `search_files` | File operations |
| **github** | `create_repository`, `push_files`, `create_pull_request` | Git operations |
| **memory** | `create_entities`, `search_nodes`, `read_graph` | Persistent memory across sessions |
| **fetch** | `fetch` | HTTP requests for APIs |
| **puppeteer** | `navigate`, `screenshot`, `click`, `fill`, `evaluate` | Browser automation testing |
| **sequential-thinking** | `think` | Complex multi-step reasoning |

---

## Tech Stack (100% Free)

- **Frontend:** React 18 + Vite + TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **Backend:** Supabase (free tier: 50k MAU, 500MB DB, 1GB storage)
- **Hosting:** Vercel or Netlify (free tier)
- **AI:** HuggingFace Inference API (already integrated)

---

## Current Implementation Status

### ✅ Completed
- Multi-agent system (Frontend, Backend, Testing, Browser, General, Cleaner)
- MainOrchestrator with planning loop and delegation
- HuggingFace cloud inference integration
- MCP integration framework
- Tool execution (file ops, git, browser)
- Retry logic with TODO tracking (max 3 attempts)
- VS Code extension UI (webview panel)

### ❌ To Implement (See IMPLEMENTATION_PLAN.md)
1. App Builder Types (`src/appBuilder/types.ts`) - ✅ STARTED
2. Spec Generator (`src/appBuilder/specGenerator.ts`) - ✅ STARTED
3. Architecture Generator (`src/appBuilder/architectureGenerator.ts`)
4. Feature Task Mappings (`src/appBuilder/featureTasks.ts`)
5. Project Templates (`src/appBuilder/templates/`)
6. Scaffolder (`src/appBuilder/scaffolder.ts`)
7. App Builder Orchestrator (`src/appBuilder/appBuilderOrchestrator.ts`)
8. Build State Manager (`src/appBuilder/buildState.ts`)
9. VS Code Commands (modify `src/extension.ts`)

---

## Development Workflow

### Before Writing Code
```
1. ALWAYS use context7 to get current library docs
2. Read IMPLEMENTATION_PLAN.md for detailed specs
3. Check existing code patterns in the codebase
4. Use sequential-thinking for complex logic
```

### Code Standards
```typescript
// TypeScript - strict mode, no `any`
// React - functional components + hooks only
// Errors - always try/catch with user-friendly messages
// Files - max 300 lines, split into modules
// Tests - write tests alongside implementation
```

### File Operations
```
- NEW files: Use filesystem MCP write_file
- EDIT existing: Use serena MCP (find_symbol → replace_symbol_body)
- SEARCH: Use filesystem MCP search_files
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/mainOrchestrator.ts` | Planning brain that delegates to agents |
| `src/autonomousAgent.ts` | Agent execution with tools |
| `src/hfProvider.ts` | HuggingFace API integration |
| `src/extension.ts` | VS Code extension entry point |
| `src/tools/*.ts` | Tool implementations |
| `src/appBuilder/*.ts` | App builder components (in progress) |

---

## Implementation Instructions

### Task: Complete App Builder System

Read `IMPLEMENTATION_PLAN.md` for the full specification. Execute in this order:

#### Phase 1: Core Types & Generators
```
1. Review/fix src/appBuilder/types.ts
2. Review/fix src/appBuilder/specGenerator.ts  
3. Create src/appBuilder/architectureGenerator.ts
4. Create src/appBuilder/featureTasks.ts
```

#### Phase 2: Templates
```
1. Create src/appBuilder/templates/base/ with:
   - package.json.tmpl
   - vite.config.ts
   - tailwind.config.js
   - src/main.tsx
   - src/App.tsx
   - src/lib/supabase.ts.tmpl
   - src/hooks/useAuth.ts
   - src/components/ui/*.tsx (shadcn components)

2. Create app-type templates:
   - templates/saas/
   - templates/crud/
   - templates/ecommerce/
   - templates/blog/
   - templates/landing/
```

#### Phase 3: Scaffolder & Orchestrator
```
1. Create src/appBuilder/scaffolder.ts
2. Create src/appBuilder/appBuilderOrchestrator.ts
3. Create src/appBuilder/buildState.ts
4. Create src/appBuilder/index.ts (barrel export)
```

#### Phase 4: Integration
```
1. Modify src/extension.ts to add commands:
   - liftoff.buildApp
   - liftoff.addFeature
   - liftoff.deployApp
   
2. Update package.json with new commands
3. Test end-to-end flow
```

---

## Critical Rules

1. **NEVER hallucinate APIs** - Always use context7 first
2. **NEVER write huge files at once** - Build incrementally
3. **ALWAYS test after each feature** - Don't batch test at end
4. **ALWAYS use TypeScript with proper types** - No `any`
5. **ALWAYS handle errors** - try/catch + user feedback
6. **ALWAYS ask if unclear** - Don't assume requirements

---

## Testing

```bash
# Compile TypeScript
npm run compile

# Run extension in debug mode
# Press F5 in VS Code

# Test app builder flow
# 1. Cmd+Shift+P → "Liftoff: Build App"
# 2. Enter description
# 3. Verify project scaffolds correctly
# 4. Verify features build
# 5. Verify app runs with npm run dev
```

---

## Debugging

- **Extension Output:** View → Output → Select "Liftoff"
- **DevTools:** Help → Toggle Developer Tools
- **Agent Logs:** Check Liftoff panel in VS Code sidebar

---

## Quick Reference

### Generate AppSpec from Description
```typescript
const specGen = new SpecGenerator();
const spec = await specGen.generateSpecFromDescription(
    "A task management app with teams and projects"
);
```

### Generate Architecture
```typescript
const archGen = new ArchitectureGenerator();
const architecture = archGen.generateArchitecture(spec);
```

### Scaffold Project
```typescript
const scaffolder = new Scaffolder(extensionPath);
await scaffolder.scaffold(targetDir, spec, architecture);
```

### Build App (Full Flow)
```typescript
const builder = new AppBuilderOrchestrator(/* deps */);
const result = await builder.buildApp(description, targetDir);
```
