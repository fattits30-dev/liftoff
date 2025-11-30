# Orchestrator Fix Summary

## Problems Identified

### 1. ❌ Orchestrator Bypassing AppBuilder System
**Issue:** When user requested "Build a recipe app", the orchestrator was:
- Manually creating files with `write_file` commands
- Skipping SpecGenerator and ArchitectureGenerator phases
- Not using project templates
- Losing track of what phase it's in
- Delegating to agents WAY too early (before scaffolding)

**Root Cause:** No structured plan to keep the orchestrator on track.

### 2. ❌ UI Outputs Appearing Meaningless
**Issue:** Commands like this appeared in the UI:
```
```tool
{"name": "write_file", "params": {...}}
```
```

**Confusion:** Looks like orchestrator is just outputting text, not actually executing.

**Reality:** The orchestrator DOES parse and execute these via:
- `parseToolCall()` - extracts ```tool blocks
- `parseDelegation()` - extracts ```delegate blocks
- `executeToolCall()` - runs the tool
- `executeDelegation()` - delegates to agent

But showing them in UI makes it look like nothing is happening.

## Solutions Implemented

### ✅ Solution 1: .liftoff Planning File

Created a **`.liftoff` JSON file** that:
1. Tracks which mode: APP BUILDER vs CODE EDITING
2. Defines 6 structured phases with dependencies
3. Provides phase-specific instructions
4. Prevents phase skipping
5. Tells orchestrator when to delegate (only in IMPLEMENT phase)

**New Files:**
- `src/appBuilder/liftoffPlan.ts` - Plan file structure and management
- `LIFTOFF_WORKFLOW.md` - Full workflow documentation

**Modified Files:**
- `src/mainOrchestrator.ts` - System prompt now checks for .liftoff FIRST
- `src/appBuilder/appBuilderOrchestrator.ts` - Creates and updates .liftoff
- `src/appBuilder/index.ts` - Exports liftoff plan functions

### ✅ Solution 2: Updated System Prompt

MainOrchestrator now has this at the top of its system prompt:

```markdown
## CRITICAL: CHECK FOR .liftoff PLAN FILE FIRST
BEFORE doing ANYTHING, check if .liftoff exists:

```tool
{"name": "read_file", "params": {"path": ".liftoff"}}
```

**If .liftoff EXISTS:**
- You are in APP BUILDER mode
- Follow phase instructions EXACTLY
- Use AppBuilderOrchestrator methods
- DO NOT manually create files
- Update .liftoff as you progress

**If .liftoff DOES NOT exist:**
- Check if user wants BUILD APP or EDIT CODE
- BUILD APP → Create .liftoff, enter APP BUILDER mode
- EDIT CODE → Normal delegation workflow
```

### ✅ Solution 3: Phase-Based Workflow

The `.liftoff` file enforces this flow:

```
1. SPEC Phase
   ↓ (Generate AppSpec via SpecGenerator)
2. ARCHITECTURE Phase
   ↓ (Design schema via ArchitectureGenerator)
3. SCAFFOLD Phase
   ↓ (Copy templates via Scaffolder)
4. IMPLEMENT Phase
   ↓ (NOW delegate to agents!)
5. TEST Phase
   ↓ (Run test suite)
6. DEPLOY Phase
   ↓ (Deploy to Vercel/Netlify)
```

**Key Change:** Agents are NOT involved until IMPLEMENT phase!

## How It Works Now

### Scenario: "Build a recipe app with meal planning"

**Old Behavior (WRONG):**
```
Orchestrator: Let me create package.json...
```tool
{"name": "write_file", "params": {"path": "package.json", ...}}
```

Orchestrator: Now creating main.tsx...
```tool
{"name": "write_file", "params": {"path": "src/main.tsx", ...}}
```

[Manually creates 20+ files, bypasses all proper phases]
```

**New Behavior (CORRECT):**
```
Orchestrator: Checking for .liftoff file...
```tool
{"name": "read_file", "params": {"path": ".liftoff"}}
```
→ Not found

Orchestrator: New app build detected. Creating .liftoff plan...
```tool
{"name": "write_file", "params": {"path": ".liftoff", "content": "{...}"}}
```

📊 ENTERING APP BUILDER MODE
Phase: SPECIFICATION

Orchestrator: Using AppBuilderOrchestrator.runSpecPhase()
[SpecGenerator runs, asks clarifying questions via VS Code UI]
✅ Generated liftoff.spec.json

Orchestrator: Updating .liftoff to ARCHITECTURE phase...
```tool
{"name": "write_file", "params": {"path": ".liftoff", "content": "{phase:architecture...}"}}
```

Phase: ARCHITECTURE
[ArchitectureGenerator creates database schema, component tree, etc.]
✅ Generated liftoff.architecture.json

Phase: SCAFFOLD
[Scaffolder copies templates, generates structure]
✅ Project scaffolded at ./recipe-app

Phase: IMPLEMENTATION
Now I can delegate to agents!

Feature: auth
Task: auth-provider
```delegate
{"agent": "frontend", "task": "Create AuthContext using Supabase auth..."}
```
[Agent works...]
✅ auth-provider complete

[Continues through all features properly]
```

## Benefits

| Before | After |
|--------|-------|
| ❌ Manually created files | ✅ Uses templates |
| ❌ Skipped spec/architecture | ✅ Follows all phases |
| ❌ Lost track of progress | ✅ Tracks in .liftoff |
| ❌ Delegated too early | ✅ Delegates at right time |
| ❌ One mode for everything | ✅ APP BUILDER vs CODE EDITING |
| ❌ No resumability | ✅ Can resume interrupted builds |

## File Structure

```
.liftoff                        # Planning file (created on app build)
liftoff.spec.json               # Generated in SPEC phase
liftoff.architecture.json       # Generated in ARCHITECTURE phase
liftoff.state.json              # Build state (existing)

src/
  appBuilder/
    liftoffPlan.ts              # NEW - Plan file management
    appBuilderOrchestrator.ts   # MODIFIED - Creates/updates .liftoff
    index.ts                    # MODIFIED - Exports liftoff functions
  mainOrchestrator.ts           # MODIFIED - Checks .liftoff first
```

## Example .liftoff File

```json
{
  "version": "1.0.0",
  "mode": "app-builder",
  "description": "Recipe & Meal Planning Platform",
  "targetDir": "./recipe-app",
  "currentPhase": "implement",
  "phases": {
    "spec": {
      "name": "Specification",
      "status": "complete",
      "completedAt": "2025-01-30T10:15:00Z"
    },
    "architecture": {
      "name": "Architecture Design",
      "status": "complete",
      "completedAt": "2025-01-30T10:20:00Z"
    },
    "scaffold": {
      "name": "Project Scaffolding",
      "status": "complete",
      "completedAt": "2025-01-30T10:30:00Z"
    },
    "implement": {
      "name": "Feature Implementation",
      "status": "in-progress",
      "startedAt": "2025-01-30T10:31:00Z"
    },
    "test": {
      "name": "Testing",
      "status": "pending",
      "dependencies": ["implement"]
    },
    "deploy": {
      "name": "Deployment",
      "status": "pending",
      "dependencies": ["test"]
    }
  },
  "features": [
    {
      "name": "auth",
      "status": "complete",
      "tasks": [...]
    },
    {
      "name": "database",
      "status": "in-progress",
      "tasks": [...]
    }
  ],
  "progress": {
    "completedPhases": ["spec", "architecture", "scaffold"],
    "blockers": [],
    "todoItems": []
  },
  "artifacts": {
    "specFile": "./recipe-app/liftoff.spec.json",
    "archFile": "./recipe-app/liftoff.architecture.json"
  }
}
```

## Testing the Fix

To verify this works:

1. **Start fresh build:**
   ```
   User: "Build a todo app with auth and teams"
   ```

2. **Orchestrator should:**
   - Check for .liftoff (not found)
   - Create .liftoff file
   - Enter APP BUILDER mode
   - Run SPEC phase (ask questions, generate spec)
   - Run ARCHITECTURE phase (design schema)
   - Run SCAFFOLD phase (copy templates)
   - Run IMPLEMENT phase (delegate to agents)
   - NOT manually create any files

3. **Verify .liftoff exists** in project directory

4. **Resume interrupted build:**
   ```
   User: "Continue building the app"
   ```
   - Orchestrator reads existing .liftoff
   - Resumes from currentPhase

## Next Steps

- [ ] Test full end-to-end app build
- [ ] Add VS Code command to view .liftoff file
- [ ] Show current phase in status bar
- [ ] Handle error cases (phase failures)
- [ ] Add ability to skip phases (advanced users)

## Regarding "UI Outputs"

The `\`\`\`tool` and `\`\`\`delegate` blocks you see in the UI ARE being executed:
- `parseToolCall()` extracts them
- `executeToolCall()` runs them
- Results feed back into orchestrator

They appear in the output stream for transparency so user can see what's happening. This is intentional, not a bug.

If you want to hide them:
- Modify the UI to not show tool/delegate blocks
- Or add a "verbose mode" toggle

But the orchestrator IS executing them correctly.
