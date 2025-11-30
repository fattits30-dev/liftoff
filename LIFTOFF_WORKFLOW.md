# .liftoff File Workflow - Keeping the Orchestrator On Track

## Problem

The MainOrchestrator was bypassing the AppBuilder system and manually creating files instead of following the proper workflow:
- ❌ Manually writing files with `write_file` commands
- ❌ Skipping the SpecGenerator and ArchitectureGenerator phases
- ❌ Not using templates and scaffolding
- ❌ Losing track of what phase it's in

## Solution: .liftoff Planning File

The `.liftoff` file is a **JSON planning document** that:
1. Tells the orchestrator it's in APP BUILDER mode (not code editing mode)
2. Tracks which phase it's currently in
3. Provides phase-specific instructions
4. Prevents manual file creation
5. Ensures proper progression through phases

## How It Works

### 1. User Request Detection

When user says: **"Build a recipe app"**

MainOrchestrator:
1. Checks for `.liftoff` file first
2. If not found → Creates one (entering APP BUILDER mode)
3. If found → Reads it and continues from current phase

### 2. Two Modes

**APP BUILDER Mode** (has `.liftoff` file):
- User wants to BUILD A NEW APP
- Follow structured phases: spec → architecture → scaffold → implement → test → deploy
- Use AppBuilderOrchestrator methods
- DO NOT manually create files

**CODE EDITING Mode** (no `.liftoff` file):
- User wants to EDIT EXISTING CODE
- Direct agent delegation
- Normal file operations allowed

### 3. The Six Phases

The `.liftoff` file defines these phases:

```json
{
  "currentPhase": "spec",
  "phases": {
    "spec": {
      "name": "Specification",
      "status": "in-progress",
      "dependencies": []
    },
    "architecture": {
      "name": "Architecture Design",
      "status": "pending",
      "dependencies": ["spec"]
    },
    "scaffold": {
      "name": "Project Scaffolding",
      "status": "pending",
      "dependencies": ["architecture"]
    },
    "implement": {
      "name": "Feature Implementation",
      "status": "pending",
      "dependencies": ["scaffold"]
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
  }
}
```

### 4. Phase Instructions

Each phase has specific instructions via `getOrchestratorInstructions()`:

**SPEC Phase:**
```
🎯 CURRENT PHASE: SPECIFICATION
Your task: Generate AppSpec from user description

REQUIRED ACTIONS:
1. Use AppBuilderOrchestrator.runSpecPhase()
2. This will:
   - Parse the description
   - Ask clarifying questions via VS Code UI
   - Generate structured AppSpec JSON
   - Save to liftoff.spec.json

DO NOT:
- Manually create files
- Delegate to agents yet
- Write any code

NEXT PHASE: Architecture
```

**IMPLEMENT Phase:**
```
🎯 CURRENT PHASE: IMPLEMENTATION
Your task: Build features using agent delegation

REQUIRED ACTIONS:
1. Use AppBuilderOrchestrator.runImplementationPhase()
2. For each feature in the plan:
   - Get ordered tasks from featureTasks.ts
   - Delegate each task to appropriate agent
   - Wait for completion
   - Track progress in .liftoff file

FEATURES TO IMPLEMENT:
- auth (pending)
- database (pending)
- file-upload (pending)

NOW you can delegate to agents!

NEXT PHASE: Testing
```

## Orchestrator System Prompt Changes

Updated `buildPlannerSystemPrompt()` to include:

```markdown
## CRITICAL: CHECK FOR .liftoff PLAN FILE FIRST
BEFORE doing ANYTHING, check if a .liftoff file exists:

```tool
{"name": "read_file", "params": {"path": ".liftoff"}}
```

**If .liftoff EXISTS:**
- You are in APP BUILDER mode
- Follow the phase instructions EXACTLY
- Use AppBuilderOrchestrator methods
- Update .liftoff file as you progress

**If .liftoff DOES NOT exist:**
- Check if user wants to BUILD APP or EDIT CODE
- BUILD APP: Create .liftoff and enter APP BUILDER mode
- EDIT CODE: Continue with normal delegation
```

## AppBuilderOrchestrator Integration

The `AppBuilderOrchestrator` now:

1. **Creates .liftoff on start:**
```typescript
async buildApp(description: string, targetDir: string) {
    // Create initial plan
    this.liftoffPlan = createInitialPlan(description, targetDir);
    await this.saveLiftoffPlan(targetDir);

    // ... continue with phases
}
```

2. **Updates .liftoff after each phase:**
```typescript
// After spec phase
this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'spec', 'complete');
this.liftoffPlan.artifacts.specFile = 'liftoff.spec.json';
await this.saveLiftoffPlan(targetDir);

// Move to next phase
this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'architecture', 'in-progress');
await this.saveLiftoffPlan(targetDir);
```

3. **Tracks feature implementation:**
```typescript
// Add features to plan
this.liftoffPlan = addFeature(this.liftoffPlan, 'auth', authTasks);
this.liftoffPlan = addFeature(this.liftoffPlan, 'database', dbTasks);

// Update feature status as agents complete tasks
this.liftoffPlan = updateFeatureStatus(this.liftoffPlan, 'auth', 'complete');
```

## Example Workflow

### User Request
```
"Build a Recipe & Meal Planning Platform with auth, recipes, meal plans, and shopping lists"
```

### Orchestrator Flow

**Step 1: Check for .liftoff**
```tool
{"name": "read_file", "params": {"path": ".liftoff"}}
```
→ File not found

**Step 2: Create .liftoff (Enter APP BUILDER Mode)**
```tool
{"name": "write_file", "params": {"path": ".liftoff", "content": "{...initial plan...}"}}
```

**Step 3: SPEC Phase**
```
📊 PHASE: SPECIFICATION
Using AppBuilderOrchestrator.runSpecPhase()...
✅ Generated liftoff.spec.json
```

**Step 4: Update .liftoff → Move to ARCHITECTURE**
```tool
{"name": "write_file", "params": {"path": ".liftoff", "content": "{...spec complete, architecture in-progress...}"}}
```

**Step 5: ARCHITECTURE Phase**
```
📊 PHASE: ARCHITECTURE
Using AppBuilderOrchestrator.runArchitecturePhase()...
✅ Generated liftoff.architecture.json
✅ Designed database schema
✅ Planned component tree
```

**Step 6: Update .liftoff → Move to SCAFFOLD**

**Step 7: SCAFFOLD Phase**
```
📊 PHASE: SCAFFOLD
Using AppBuilderOrchestrator.runScaffoldPhase()...
✅ Copied base template
✅ Generated project structure
✅ Created Supabase migration
✅ Ran npm install
```

**Step 8: Update .liftoff → Move to IMPLEMENT**

**Step 9: IMPLEMENT Phase (Finally delegates to agents!)**
```
📊 PHASE: IMPLEMENTATION

Features to implement:
- auth
- database
- file-upload

Task 1: auth-provider
```delegate
{"agent": "frontend", "task": "Create AuthContext..."}
```
[Agent completes]

✅ auth-provider complete

Task 2: login-page
```delegate
{"agent": "frontend", "task": "Create login page..."}
```

... continues through all tasks
```

**Step 10: TEST & DEPLOY phases**

## Benefits

✅ **Keeps orchestrator on track** - Can't skip phases
✅ **Prevents manual file creation** - Uses proper templates
✅ **Clear progress tracking** - Know exactly what's done/next
✅ **Resumable builds** - Can stop and continue later
✅ **Separates concerns** - APP BUILDER vs CODE EDITING modes
✅ **Better delegation** - Only delegates when appropriate (implement phase)

## Files Modified

1. **`src/appBuilder/liftoffPlan.ts`** (NEW)
   - Defines `.liftoff` file structure
   - Phase management functions
   - Orchestrator instruction generator

2. **`src/mainOrchestrator.ts`**
   - Updated system prompt to check for `.liftoff` first
   - Added APP BUILDER vs CODE EDITING mode logic
   - Shows example workflow in prompt

3. **`src/appBuilder/appBuilderOrchestrator.ts`**
   - Creates `.liftoff` on buildApp start
   - Updates `.liftoff` after each phase
   - Tracks feature implementation progress

4. **`src/appBuilder/index.ts`**
   - Exports liftoffPlan functions

## Next Steps

- [ ] Test full workflow with example app build
- [ ] Handle edge cases (interrupted builds, errors)
- [ ] Add UI to show current phase in VS Code status bar
- [ ] Add command to view/edit .liftoff file
