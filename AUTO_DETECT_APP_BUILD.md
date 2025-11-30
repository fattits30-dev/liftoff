# Auto-Detect App Build Feature

## Problem Solved
User doesn't want to use a special command like "Liftoff: Build App". They want the orchestrator to be SMART and automatically detect when they want to build a new app vs edit existing code, even with vague prompts.

## Solution
Added intelligent app build detection to MainOrchestrator.

---

## How It Works

### 1. Detection Logic (`detectAppBuildRequest()`)

The orchestrator analyzes user input for three types of signals:

#### **Build Indicators** (Strong signals to build)
```typescript
'build me', 'build a', 'create an app', 'make me a',
'scaffold', 'generate an app', 'i want to build',
'new application', 'start a new project'
```

#### **App Keywords** (Features that suggest app building)
```typescript
'with authentication', 'with auth', 'user login',
'database', 'supabase', 'real-time', 'file upload',
'payments', 'shopping cart', 'dashboard', 'calendar'
```

#### **App Types** (Common app categories)
```typescript
'saas', 'crud app', 'ecommerce', 'marketplace',
'blog', 'cms', 'social network', 'task manager',
'todo app', 'recipe app', 'fitness tracker'
```

#### **Edit Indicators** (Signals it's code editing, NOT app building)
```typescript
'fix the', 'debug', 'refactor', 'update the',
'change the', 'modify', 'add a function', 'bug in',
'error in', 'issue with', 'improve the'
```

### 2. Decision Flow

```typescript
if (hasEditIndicator) {
    return false; // CODE EDITING mode
}

if (hasBuildIndicator) {
    return true; // APP BUILD mode
}

if (hasAppType && hasAppKeywords) {
    return true; // APP BUILD mode
}

// Default to code editing if unclear
return false;
```

### 3. Automatic Routing

When user sends a message:
1. `chat()` method calls `detectAppBuildRequest()`
2. If **APP BUILD detected** → calls `handleAppBuild()`
3. If **CODE EDITING** → calls `planningLoop()` (normal flow)

---

## Examples

### ✅ Triggers APP BUILD Mode:

1. **"Build me a recipe app with meal planning"**
   - Has: "build me" + "recipe app" + app description
   - Result: APP BUILD

2. **"Create a todo app with authentication and database"**
   - Has: "create" + "todo app" + "authentication" + "database"
   - Result: APP BUILD

3. **"I want an ecommerce site with shopping cart and payments"**
   - Has: "i want" + "ecommerce" + "shopping cart" + "payments"
   - Result: APP BUILD

4. **"Make me a dashboard with real-time updates"**
   - Has: "make me a" + "dashboard" + "real-time"
   - Result: APP BUILD

5. **"Scaffold a saas application"**
   - Has: "scaffold" + "saas"
   - Result: APP BUILD

### ❌ Triggers CODE EDITING Mode:

1. **"Fix the login bug"**
   - Has: "fix the" (edit indicator)
   - Result: CODE EDITING

2. **"Debug the API error"**
   - Has: "debug" (edit indicator)
   - Result: CODE EDITING

3. **"Refactor the auth module"**
   - Has: "refactor" (edit indicator)
   - Result: CODE EDITING

4. **"Add a function to validate emails"**
   - Has: "add a function" (edit indicator)
   - Result: CODE EDITING

5. **"Update the header component"**
   - Has: "update the" (edit indicator)
   - Result: CODE EDITING

### 🤔 Edge Cases:

1. **"recipe app"** (just 2 words)
   - Has: "recipe app" (app type) but no keywords
   - Result: CODE EDITING (default, too vague)

2. **"I need help with authentication"**
   - Has: "authentication" but no build indicator
   - Result: CODE EDITING (helping, not building)

3. **"Build a function that validates users"**
   - Has: "build" but "add a function" context
   - Result: CODE EDITING (building a function, not an app)

---

## Workflow When APP BUILD Detected

```
User: "Build me a recipe app with auth"
  ↓
MainOrchestrator.chat()
  ↓
detectAppBuildRequest() → TRUE
  ↓
handleAppBuild() called
  ↓
1. Show folder picker dialog
2. User selects target directory
3. Create AppBuilderOrchestrator instance
4. Call appBuilder.buildApp(message, targetDir)
  ↓
AppBuilderOrchestrator runs:
  ├─ PHASE 1: SPEC - Generate liftoff.spec.json
  ├─ PHASE 2: ARCHITECTURE - Generate liftoff.architecture.json
  ├─ PHASE 3: SCAFFOLD - Copy templates, npm install
  ├─ PHASE 4: IMPLEMENT - Delegate to agents
  ├─ PHASE 5: TEST - Run tests
  └─ PHASE 6: DEPLOY - Deploy to Vercel/Netlify
  ↓
Return: "✅ App Build Complete! 📁 Project: /path/to/app"
```

---

## Benefits

1. **No Special Commands** - User just types naturally
2. **Smart Detection** - Works even with vague prompts
3. **Proper Workflow** - Uses AppBuilderOrchestrator phases
4. **Correct .liftoff** - Creates proper LiftoffPlan structure
5. **Template-Based** - Uses templates instead of manual file creation
6. **Clear Separation** - APP BUILD vs CODE EDITING modes

---

## Code Changes

### File: `src/mainOrchestrator.ts`

**Added:**
1. Import `AppBuilderOrchestrator`
2. `detectAppBuildRequest()` method (100+ lines)
3. `handleAppBuild()` method (60 lines)
4. Modified `chat()` to call detection before planning loop

**Key Lines:**
```typescript
// In chat() method
const isAppBuildRequest = this.detectAppBuildRequest(userMessage);

if (isAppBuildRequest) {
    return await this.handleAppBuild(userMessage);
}

return await this.planningLoop(); // Normal code editing
```

---

## Testing

### Test Case 1: App Build
```
User: "Build a recipe app with meal planning and shopping lists"

Expected:
1. Detects APP BUILD (has "build" + "recipe app")
2. Shows folder picker
3. Creates proper .liftoff file with LiftoffPlan structure
4. Follows SPEC → ARCH → SCAFFOLD → IMPLEMENT phases
5. Uses templates from src/appBuilder/templates/
```

### Test Case 2: Code Editing
```
User: "Fix the login validation bug"

Expected:
1. Detects CODE EDITING (has "fix the")
2. Goes to normal planningLoop()
3. Uses delegation to agents
4. No .liftoff file created
```

### Test Case 3: Vague Prompt
```
User: "I want something with authentication and database"

Expected:
1. Detects APP BUILD (has "authentication" + "database")
2. Shows folder picker
3. Enters AppBuilder mode
```

---

## Future Improvements

1. **Add more keywords** as we discover common patterns
2. **Use LLM for detection** if pattern matching isn't enough
3. **Remember user preferences** (some users always build, some always edit)
4. **Add confirmation dialog** for edge cases: "Did you want to build a new app or edit existing code?"

---

## Fixes the Original Problem

**Before:**
- User: "Build a recipe app"
- Result: Orchestrator manually creates files, wrong .liftoff format

**After:**
- User: "Build a recipe app"
- Result: AppBuilderOrchestrator runs, proper .liftoff, uses templates, follows phases

**Mission accomplished!** 🎉
