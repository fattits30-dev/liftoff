# Build Folder Review - Recipe & Meal Planning Platform

## Current Status: ⚠️ ISSUES FOUND

### Location
`/c/Users/sava6/ClaudeHome/projects/Recipe & Meal Planning Platform/`

---

## ❌ PROBLEM 1: .liftoff File Format is Wrong

### What I Expected:
Full `LiftoffPlan` structure from `src/appBuilder/liftoffPlan.ts`:
```json
{
  "version": "1.0.0",
  "mode": "app-builder",
  "createdAt": "2025-01-30T20:00:00Z",
  "updatedAt": "2025-01-30T20:00:00Z",
  "description": "Recipe & Meal Planning Platform",
  "targetDir": "./",
  "currentPhase": "spec",
  "phases": {
    "spec": { "name": "Specification", "status": "in-progress", ... },
    "architecture": { "name": "Architecture", "status": "pending", ... },
    "scaffold": { ... },
    "implement": { ... },
    "test": { ... },
    "deploy": { ... }
  },
  "features": [],
  "progress": { ... },
  "artifacts": { ... }
}
```

### What Actually Exists:
```json
{
  "phase": "specification",
  "appName": "Recipe & Meal Planning Platform",
  "features": ["auth", "database", "file-upload", ...],
  "nextSteps": "Generate detailed specification document"
}
```

**This is NOT using the AppBuilderOrchestrator!**

---

## ❌ PROBLEM 2: Missing Required Files

### Expected Artifacts:
- ✗ `liftoff.spec.json` - Should be created in SPEC phase
- ✗ `liftoff.architecture.json` - Should be created in ARCHITECTURE phase
- ✗ `liftoff.state.json` - BuildState persistence

### What Exists:
- ✓ `.liftoff` - But wrong format
- ✓ `package.json` - Manually created
- ✓ `src/` directory - Files exist

---

## ❌ PROBLEM 3: Phase Mismatch

**Current .liftoff says:** `"phase": "specification"`
**But files already exist:**
- ✓ `src/components/RecipeDetail.tsx`
- ✓ `src/components/Carousel.tsx`
- ✓ `src/components/NutritionTable.tsx`
- ✓ `src/features/recipes/`
- ✓ `src/features/meal-plan/`
- ✓ `package.json` with dependencies

**This is wrong!** Files shouldn't exist during specification phase.

The orchestrator is:
1. Creating a simple .liftoff file
2. Immediately jumping to manual file creation
3. Bypassing SPEC → ARCHITECTURE → SCAFFOLD workflow

---

## ❌ PROBLEM 4: Manual File Creation (Not Using Templates)

### Evidence:
```
src/
├── components/
│   ├── RecipeDetail.tsx (10.5 KB)
│   ├── Carousel.tsx (4.8 KB)
│   ├── FullscreenModal.tsx (2.6 KB)
│   └── ...
├── features/
│   ├── meal-plan/
│   │   ├── components/.gitkeep
│   │   └── hooks/.gitkeep
│   ├── pantry/
│   ├── recipes/
│   └── social/
└── lib/
```

**Issues:**
- Empty `.gitkeep` files suggest folder creation without content
- Large component files (10KB+) manually written
- No template-based generation
- Not using `src/appBuilder/templates/` at all

---

## ✅ GOOD: Memory System Working

### Location: `/c/Users/sava6/ClaudeHome/memory/`

**Contents:**
- ✓ `knowledge_graph.json` (5 KB) - Memory persistence working
- ✓ `chroma_db/` directory - Vector storage exists

**This part is working correctly!**

---

## Root Cause Analysis

### The orchestrator is NOT using AppBuilderOrchestrator because:

1. **Extension command not wired up**
   - `liftoff.buildApp` command doesn't exist or isn't calling `AppBuilderOrchestrator.buildApp()`
   - User probably triggered regular chat, not the build command

2. **MainOrchestrator bypassing the system**
   - Even with updated prompt, it's creating files manually
   - Not checking .liftoff format properly
   - Not calling `appBuilderOrchestrator.buildApp()`

3. **Wrong entry point**
   - User might be using regular Liftoff chat
   - Should use dedicated "Build App" command
   - Current flow: User chat → MainOrchestrator → Manual file creation

---

## What Should Happen

### Correct Flow:
```
1. User: Cmd+Shift+P → "Liftoff: Build App"
2. Extension: Calls AppBuilderOrchestrator.buildApp()
3. AppBuilder: Creates proper .liftoff with full structure
4. Phase 1 (SPEC): Ask questions, generate liftoff.spec.json
5. Phase 2 (ARCHITECTURE): Generate liftoff.architecture.json
6. Phase 3 (SCAFFOLD): Copy templates, npm install
7. Phase 4 (IMPLEMENT): Delegate to agents
8. Update .liftoff after each phase
```

### What's Actually Happening:
```
1. User: Regular Liftoff chat "Build a recipe app"
2. Extension: Triggers MainOrchestrator.chat()
3. MainOrchestrator: Creates simple .liftoff
4. MainOrchestrator: Manually writes files with write_file
5. Bypasses all proper phases
```

---

## Required Fixes

### Fix 1: Wire Up Build App Command
File: `src/extension.ts`

Need to add:
```typescript
vscode.commands.registerCommand('liftoff.buildApp', async () => {
    const description = await vscode.window.showInputBox({
        prompt: 'Describe the app to build',
        placeHolder: 'A recipe app with meal planning...'
    });

    if (!description) return;

    const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        openLabel: 'Select Project Location'
    });

    if (!folder) return;

    const appBuilder = new AppBuilderOrchestrator(context.extensionPath);
    await appBuilder.buildApp(description, folder[0].fsPath);
});
```

### Fix 2: Update package.json Commands
Add:
```json
{
  "contributes": {
    "commands": [
      {
        "command": "liftoff.buildApp",
        "title": "Liftoff: Build App"
      }
    ]
  }
}
```

### Fix 3: Validate .liftoff Format
In MainOrchestrator, when reading .liftoff:
```typescript
const content = JSON.parse(fileContent);

// Check if it's the NEW format
if (content.version && content.mode && content.phases) {
    // New LiftoffPlan format - use it!
    this.liftoffPlan = deserializePlan(content);
} else {
    // Old simple format - migrate or error
    vscode.window.showWarningMessage(
        'Old .liftoff format detected. Please use "Liftoff: Build App" command.'
    );
}
```

---

## Summary

### Working: ✅
- Memory persistence (knowledge_graph.json)
- Files are being created
- Basic orchestrator flow

### Broken: ❌
- .liftoff file format (wrong structure)
- AppBuilderOrchestrator not being used
- No spec/architecture phase execution
- Manual file creation instead of templates
- No liftoff.spec.json or liftoff.architecture.json

### Action Items:
1. Add `liftoff.buildApp` VS Code command
2. Update package.json with command definition
3. Test by running "Liftoff: Build App" from command palette
4. Verify proper .liftoff file gets created
5. Confirm phases execute in order

---

## Next Steps

The build IS working, but it's using the old manual approach. To use the new structured workflow, we need to:

1. **Wire up the command** (extension.ts + package.json)
2. **Test with the command** instead of regular chat
3. **Verify phases execute** in correct order
4. **Check .liftoff format** matches LiftoffPlan structure

Would you like me to implement these fixes now?
