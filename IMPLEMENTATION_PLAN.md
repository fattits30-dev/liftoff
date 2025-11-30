# Liftoff App Builder - Complete Implementation Plan

## Executive Summary

Transform Liftoff from a code-editing assistant into a full **app builder** that can take a natural language description and produce a working, deployable application. This mirrors what Lovable, Bolt.new, and GPT Pilot do.

---

## Current State

### What Exists ✅
- Multi-agent system (Frontend, Backend, Testing, Browser, General, Cleaner)
- Orchestrator with planning loop and delegation
- HuggingFace cloud inference
- MCP integration (Serena, filesystem, git, etc.)
- Tool execution (file ops, git, browser automation)
- Retry logic with TODO tracking
- VS Code extension UI

### What's Missing ❌
- Specification phase (gathering requirements)
- Architecture phase (designing structure before coding)
- Project scaffolding (template-based initialization)
- Database schema generation
- Component library integration (shadcn/ui)
- Deployment automation
- Build state persistence

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER INPUT                                    │
│  "Build me a project management app with auth and teams"        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: SPECIFICATION                                          │
│  ─────────────────────────                                       │
│  • Parse user description                                        │
│  • Ask clarifying questions via VS Code UI                       │
│  • Generate structured AppSpec JSON                              │
│  • Output: liftoff.spec.json                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: ARCHITECTURE                                           │
│  ─────────────────────────                                       │
│  • Design database schema from entities                          │
│  • Plan component tree                                           │
│  • Define API routes                                             │
│  • Map out file structure                                        │
│  • Output: liftoff.architecture.json                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: SCAFFOLD                                               │
│  ─────────────────────────                                       │
│  • Copy project template to workspace                            │
│  • Install dependencies (npm install)                            │
│  • Generate folder structure                                     │
│  • Create Supabase schema SQL                                    │
│  • Set up environment files                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: IMPLEMENTATION                                         │
│  ─────────────────────────                                       │
│  • Break spec into ordered tasks                                 │
│  • Delegate to specialized agents                                │
│  • Build feature by feature                                      │
│  • Test after each feature                                       │
│  • Retry failed tasks (max 3 → TODO)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 5: TESTING                                                │
│  ─────────────────────────                                       │
│  • Run full test suite                                           │
│  • Browser automation tests (Playwright)                         │
│  • Fix any failures                                              │
│  • Generate test report                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 6: DEPLOYMENT                                             │
│  ─────────────────────────                                       │
│  • Build production bundle                                       │
│  • Push to git                                                   │
│  • Deploy to Vercel/Netlify                                      │
│  • Output deployment URL                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### TASK 1: App Builder Types
**File:** `src/appBuilder/types.ts`
**Status:** ✅ CREATED (but needs review)

**Contains:**
- `AppSpec` - Full app specification interface
- `AppType` - saas | dashboard | landing | crud | ecommerce | blog | portfolio
- `FeatureType` - auth | database | file-upload | payments | realtime | etc.
- `Entity` - Data model definition with fields
- `Architecture` - Database schema + component tree
- `BuildState` - Current build progress
- `ProjectTemplate` - Template file structure

**Review needed:** Ensure types are complete and match implementation needs.

---

### TASK 2: Spec Generator
**File:** `src/appBuilder/specGenerator.ts`
**Status:** ✅ CREATED (but needs review)

**Contains:**
- `SpecGenerator` class with VS Code quick pick UI
- `gatherSpec()` - Interactive requirement gathering
- `generateSpecFromDescription()` - LLM-powered spec inference
- Default entities for each app type
- `saveSpec()` / `loadSpec()` helpers

**Review needed:** Test the VS Code UI flow works properly.

---

### TASK 3: Architecture Generator
**File:** `src/appBuilder/architectureGenerator.ts`
**Status:** ❌ NOT CREATED

**Must implement:**
```typescript
export class ArchitectureGenerator {
    /**
     * Generate full architecture from spec
     */
    generateArchitecture(spec: AppSpec): Architecture {
        return {
            spec,
            database: this.generateDatabaseSchema(spec.entities),
            components: this.generateComponentTree(spec.pages, spec.features),
            apiRoutes: this.generateAPIRoutes(spec.entities, spec.features),
            envVars: this.generateEnvVars(spec.features)
        };
    }

    /**
     * Convert entities to PostgreSQL schema
     */
    generateDatabaseSchema(entities: Entity[]): DatabaseSchema {
        // Map EntityField types to PostgreSQL types
        // Generate CREATE TABLE statements
        // Generate RLS policies
        // Generate indexes
    }

    /**
     * Plan component hierarchy
     */
    generateComponentTree(pages: PageRoute[], features: FeatureType[]): ComponentTree {
        // Map pages to page components
        // Identify shared components (Header, Footer, Sidebar)
        // Plan feature-specific components (LoginForm, DataTable)
        // Define custom hooks needed
    }

    /**
     * Generate Supabase migration SQL
     */
    generateMigrationSQL(schema: DatabaseSchema): string {
        // Full SQL script for Supabase
    }
}
```

---

### TASK 4: Project Templates
**Directory:** `src/appBuilder/templates/`
**Status:** ❌ NOT CREATED

**Structure:**
```
templates/
├── base/                    # Shared across all templates
│   ├── package.json.tmpl
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── .env.example
│   ├── .gitignore
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── lib/
│       │   └── supabase.ts.tmpl
│       ├── hooks/
│       │   └── useAuth.ts
│       └── components/
│           └── ui/          # shadcn/ui components
│               ├── button.tsx
│               ├── input.tsx
│               ├── card.tsx
│               ├── dialog.tsx
│               └── ... (core set)
│
├── saas/                    # SaaS-specific additions
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   └── Settings.tsx
│       └── components/
│           ├── Sidebar.tsx
│           └── Header.tsx
│
├── crud/                    # CRUD app additions
├── ecommerce/               # E-commerce additions
├── blog/                    # Blog additions
└── landing/                 # Landing page additions
```

**Template variables to support:**
- `{{APP_NAME}}` - lowercase app name
- `{{DISPLAY_NAME}}` - display name
- `{{SUPABASE_URL}}` - Supabase project URL
- `{{SUPABASE_ANON_KEY}}` - Supabase anon key

---

### TASK 5: Scaffolder
**File:** `src/appBuilder/scaffolder.ts`
**Status:** ❌ NOT CREATED

**Must implement:**
```typescript
export class Scaffolder {
    private templateDir: string;  // Extension's bundled templates
    
    /**
     * Create new project from template
     */
    async scaffold(
        targetDir: string,
        spec: AppSpec,
        architecture: Architecture
    ): Promise<void> {
        // 1. Copy base template
        await this.copyTemplate('base', targetDir);
        
        // 2. Copy app-type specific template
        await this.copyTemplate(spec.type, targetDir);
        
        // 3. Process template variables
        await this.processTemplateVars(targetDir, {
            APP_NAME: spec.name,
            DISPLAY_NAME: spec.displayName,
            // ...
        });
        
        // 4. Generate pages from spec
        await this.generatePages(targetDir, spec.pages);
        
        // 5. Generate entity components (if CRUD)
        await this.generateEntityComponents(targetDir, spec.entities);
        
        // 6. Create Supabase migration
        await this.writeMigration(targetDir, architecture.database);
        
        // 7. Install dependencies
        await this.runCommand('npm install', targetDir);
    }

    /**
     * Copy template with variable replacement
     */
    private async copyTemplate(templateName: string, targetDir: string): Promise<void>;
    
    /**
     * Replace {{VAR}} placeholders in all files
     */
    private async processTemplateVars(dir: string, vars: Record<string, string>): Promise<void>;
    
    /**
     * Generate page components from routes
     */
    private async generatePages(dir: string, pages: PageRoute[]): Promise<void>;
}
```

---

### TASK 6: App Builder Orchestrator
**File:** `src/appBuilder/appBuilderOrchestrator.ts`
**Status:** ❌ NOT CREATED

**This is the main coordinator that runs all phases:**

```typescript
export class AppBuilderOrchestrator {
    private specGenerator: SpecGenerator;
    private architectureGenerator: ArchitectureGenerator;
    private scaffolder: Scaffolder;
    private mainOrchestrator: MainOrchestrator;  // Existing agent delegator
    
    private buildState: BuildState;
    
    /**
     * Main entry point - build app from description
     */
    async buildApp(description: string, targetDir: string): Promise<BuildResult> {
        this.buildState = {
            phase: 'spec',
            completedFeatures: [],
            failedFeatures: [],
            todoItems: [],
            logs: []
        };
        
        try {
            // PHASE 1: Specification
            this.log('spec', 'Gathering requirements...');
            const spec = await this.runSpecPhase(description);
            this.buildState.spec = spec;
            
            // PHASE 2: Architecture
            this.log('architecture', 'Designing architecture...');
            const architecture = await this.runArchitecturePhase(spec);
            this.buildState.architecture = architecture;
            
            // PHASE 3: Scaffold
            this.log('scaffold', 'Creating project structure...');
            await this.runScaffoldPhase(targetDir, spec, architecture);
            this.buildState.projectPath = targetDir;
            
            // PHASE 4: Implementation
            this.log('implement', 'Building features...');
            await this.runImplementationPhase(targetDir, spec, architecture);
            
            // PHASE 5: Testing
            this.log('test', 'Running tests...');
            await this.runTestPhase(targetDir);
            
            // PHASE 6: Deployment (optional)
            if (await this.confirmDeploy()) {
                this.log('deploy', 'Deploying...');
                await this.runDeployPhase(targetDir, spec);
            }
            
            return {
                success: true,
                projectPath: targetDir,
                spec,
                architecture,
                todoItems: this.buildState.todoItems
            };
            
        } catch (error) {
            this.log(this.buildState.phase, `Failed: ${error}`, 'failed');
            throw error;
        }
    }
    
    /**
     * Phase 1: Generate spec from description + user input
     */
    private async runSpecPhase(description: string): Promise<AppSpec>;
    
    /**
     * Phase 2: Generate architecture from spec
     */
    private async runArchitecturePhase(spec: AppSpec): Promise<Architecture>;
    
    /**
     * Phase 3: Scaffold project from templates
     */
    private async runScaffoldPhase(
        targetDir: string, 
        spec: AppSpec, 
        architecture: Architecture
    ): Promise<void>;
    
    /**
     * Phase 4: Build features using existing agent system
     */
    private async runImplementationPhase(
        targetDir: string,
        spec: AppSpec,
        architecture: Architecture
    ): Promise<void> {
        // Convert spec.features into ordered tasks
        const tasks = this.featuresToTasks(spec.features, architecture);
        
        // Use mainOrchestrator to delegate each task
        for (const task of tasks) {
            await this.mainOrchestrator.processUserMessage(task.prompt);
            // Wait for completion
            // Check success/failure
            // Update buildState
        }
    }
    
    /**
     * Phase 5: Run test suite
     */
    private async runTestPhase(targetDir: string): Promise<void>;
    
    /**
     * Phase 6: Deploy to hosting
     */
    private async runDeployPhase(targetDir: string, spec: AppSpec): Promise<string>;
}
```

---

### TASK 7: Feature Task Mappings
**File:** `src/appBuilder/featureTasks.ts`
**Status:** ❌ NOT CREATED

**Maps features to implementation tasks:**

```typescript
export interface FeatureTask {
    feature: FeatureType;
    tasks: TaskDefinition[];
}

export interface TaskDefinition {
    name: string;
    agent: AgentType;
    prompt: string;
    dependsOn?: string[];  // Other task names
    verification: string;  // How to verify completion
}

export const FEATURE_TASKS: Record<FeatureType, TaskDefinition[]> = {
    auth: [
        {
            name: 'auth-provider',
            agent: 'frontend',
            prompt: 'Create AuthContext provider at src/contexts/AuthContext.tsx that wraps the app and provides useAuth hook with: user, loading, signIn, signUp, signOut functions using Supabase auth',
            verification: 'File exists and exports AuthProvider and useAuth'
        },
        {
            name: 'login-page',
            agent: 'frontend',
            prompt: 'Create Login page at src/pages/Login.tsx with email/password form using shadcn/ui components. Connect to useAuth().signIn()',
            dependsOn: ['auth-provider'],
            verification: 'Login page renders and form submits'
        },
        {
            name: 'signup-page',
            agent: 'frontend',
            prompt: 'Create Signup page at src/pages/Signup.tsx with email/password/confirm form using shadcn/ui. Connect to useAuth().signUp()',
            dependsOn: ['auth-provider'],
            verification: 'Signup page renders and form submits'
        },
        {
            name: 'protected-route',
            agent: 'frontend',
            prompt: 'Create ProtectedRoute component at src/components/ProtectedRoute.tsx that redirects to /login if not authenticated',
            dependsOn: ['auth-provider'],
            verification: 'Component redirects unauthenticated users'
        },
        {
            name: 'auth-tests',
            agent: 'testing',
            prompt: 'Write tests for auth flow: login success, login failure, signup, logout. Use Playwright for e2e tests.',
            dependsOn: ['login-page', 'signup-page'],
            verification: 'All auth tests pass'
        }
    ],
    
    database: [
        {
            name: 'supabase-client',
            agent: 'frontend',
            prompt: 'Create Supabase client at src/lib/supabase.ts with typed Database interface from generated types',
            verification: 'File exports supabase client'
        },
        {
            name: 'entity-hooks',
            agent: 'frontend',
            prompt: 'Create React Query hooks for each entity: useItems, useItem, useCreateItem, useUpdateItem, useDeleteItem at src/hooks/useItems.ts',
            dependsOn: ['supabase-client'],
            verification: 'Hooks exist and handle CRUD operations'
        }
    ],
    
    'file-upload': [
        {
            name: 'upload-component',
            agent: 'frontend',
            prompt: 'Create FileUpload component at src/components/FileUpload.tsx that uploads to Supabase storage bucket, shows progress, returns public URL',
            verification: 'Component uploads files successfully'
        }
    ],
    
    // ... more features
};
```

---

### TASK 8: shadcn/ui Component Bundle
**File:** `src/appBuilder/templates/base/src/components/ui/`
**Status:** ❌ NOT CREATED

**Core shadcn components to bundle:**
- button.tsx
- input.tsx
- label.tsx
- card.tsx
- dialog.tsx
- dropdown-menu.tsx
- form.tsx (with react-hook-form)
- toast.tsx
- avatar.tsx
- badge.tsx
- separator.tsx
- skeleton.tsx
- table.tsx
- tabs.tsx
- textarea.tsx

**Note:** These need to be the actual shadcn/ui component code, pre-configured for the project's Tailwind setup.

---

### TASK 9: VS Code Commands
**File:** `src/extension.ts` (modify existing)
**Status:** ❌ NOT MODIFIED

**Add new commands:**
```typescript
// Command: liftoff.buildApp
vscode.commands.registerCommand('liftoff.buildApp', async () => {
    const description = await vscode.window.showInputBox({
        prompt: 'Describe the app you want to build',
        placeHolder: 'A project management app with teams, tasks, and deadlines'
    });
    
    if (!description) return;
    
    const targetFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        openLabel: 'Select Project Location'
    });
    
    if (!targetFolder) return;
    
    const orchestrator = new AppBuilderOrchestrator(/* deps */);
    await orchestrator.buildApp(description, targetFolder[0].fsPath);
});

// Command: liftoff.addFeature
vscode.commands.registerCommand('liftoff.addFeature', async () => {
    // Add feature to existing project
});

// Command: liftoff.deployApp
vscode.commands.registerCommand('liftoff.deployApp', async () => {
    // Deploy current project
});
```

---

### TASK 10: Build State Persistence
**File:** `src/appBuilder/buildState.ts`
**Status:** ❌ NOT CREATED

**Save/restore build progress:**
```typescript
export class BuildStateManager {
    private stateFile = 'liftoff.state.json';
    
    async saveState(projectPath: string, state: BuildState): Promise<void>;
    async loadState(projectPath: string): Promise<BuildState | null>;
    async clearState(projectPath: string): Promise<void>;
    
    // Resume interrupted build
    async resumeBuild(projectPath: string): Promise<void>;
}
```

---

## File Structure After Implementation

```
src/
├── appBuilder/
│   ├── index.ts                    # Exports
│   ├── types.ts                    # ✅ Created
│   ├── specGenerator.ts            # ✅ Created
│   ├── architectureGenerator.ts    # ❌ TODO
│   ├── scaffolder.ts               # ❌ TODO
│   ├── appBuilderOrchestrator.ts   # ❌ TODO
│   ├── featureTasks.ts             # ❌ TODO
│   ├── buildState.ts               # ❌ TODO
│   └── templates/                  # ❌ TODO
│       ├── base/
│       ├── saas/
│       ├── crud/
│       ├── ecommerce/
│       ├── blog/
│       └── landing/
├── extension.ts                    # Modify to add commands
└── ... (existing files)
```

---

## Execution Order

1. **Review & fix** `types.ts` and `specGenerator.ts`
2. **Create** `architectureGenerator.ts`
3. **Create** `featureTasks.ts`
4. **Create** template files in `templates/`
5. **Create** `scaffolder.ts`
6. **Create** `appBuilderOrchestrator.ts`
7. **Create** `buildState.ts`
8. **Create** `index.ts` barrel export
9. **Modify** `extension.ts` to add commands
10. **Test** end-to-end flow

---

## Dependencies to Add

```json
{
  "dependencies": {
    "handlebars": "^4.7.8"  // For template processing
  }
}
```

---

## Success Criteria

- [ ] User can run "Liftoff: Build App" command
- [ ] Interactive spec gathering works via VS Code UI
- [ ] Project scaffolds with correct structure
- [ ] Auth feature builds working login/signup
- [ ] Database entities generate correct Supabase schema
- [ ] App runs locally with `npm run dev`
- [ ] Tests pass
- [ ] Can deploy to Vercel/Netlify

---

## Notes for Claude Code

1. **Use context7 MCP** before writing any React/Tailwind/Supabase code to get current API docs
2. **Use serena MCP** when modifying existing files (find_symbol, replace_symbol_body)
3. **Use filesystem MCP** for new files
4. **Test after each major component** - don't write everything then test
5. **Keep files under 300 lines** - split large files into modules
6. **Use TypeScript strictly** - no `any` types
7. **Handle errors properly** - try/catch with user-friendly messages
