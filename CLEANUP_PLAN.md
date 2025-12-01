# Liftoff Cleanup & Refactoring Plan

## Current Issues

### 1. **Code Organization**
- ❌ Mix of legacy templates AND CLI approach in same codebase
- ❌ Unclear which code paths are active
- ❌ 17 modified files, 10 untracked files
- ❌ No clear separation between old and new implementations

### 2. **Scaffolder Confusion**
- Legacy `legacyScaffold()` method (lines 334-406 in scaffolder.ts)
- Template files in `src/appBuilder/templates/base/` may be outdated
- CLI bootstrap creates files that templates also create

### 3. **Unclear Flow**
```
User Request → Spec Generator → Architecture → Scaffolder
                                                  ↓
                                    ┌─────────────┴─────────────┐
                                    │                           │
                                TIER 1: CLI              LEGACY: Templates
                                TIER 2: Overlays               ???
                                TIER 3: AI Custom
```

### 4. **Missing Labels**
- No clear phase indicators in logs
- Error messages don't say which tier failed
- No progress percentage shown

---

## Cleanup Tasks

### ✅ PHASE 1: Code Organization (Priority: HIGH)

**1.1 Remove Legacy Scaffolding**
- [ ] Delete `legacyScaffold()` method from scaffolder.ts
- [ ] Delete unused template files OR clearly mark them as TIER 2 overlays
- [ ] Keep only templates that are actually used in `applyTemplateOverlays()`

**1.2 Clear Method Labeling**
- [ ] Rename methods to include tier: `tier1_bootstrapWithCLI()`, `tier2_applyOverlays()`, `tier3_generateCustomCode()`
- [ ] Add tier labels to all log messages: `[TIER 1]`, `[TIER 2]`, `[TIER 3]`

**1.3 File Consolidation**
- [ ] Move all TIER 2 templates to `src/appBuilder/templates/tier2/`
- [ ] Delete unused template files
- [ ] Create `README.md` in templates folder explaining structure

---

### ✅ PHASE 2: Error Handling (Priority: HIGH)

**2.1 Better Error Messages**
```typescript
// BAD
throw new Error('Bootstrap failed');

// GOOD
throw new Error('[TIER 1 - CLI Bootstrap] Failed to create Vite project. Command: npm create vite. Error: ...');
```

**2.2 Rollback on Failure**
- [ ] If TIER 1 fails → clean up partial files
- [ ] If TIER 2 fails → still have working TIER 1 base
- [ ] If TIER 3 fails → still have working app without custom pages

**2.3 Validation Checkpoints**
- [ ] After each tier, validate before proceeding
- [ ] Log validation results clearly

---

### ✅ PHASE 3: Progress Indicators (Priority: MEDIUM)

**3.1 Add Progress to Logs**
```typescript
this.log('[TIER 1] (1/3) Bootstrapping with Vite CLI...');
this.log('[TIER 1] (2/3) Installing Tailwind CSS...');
this.log('[TIER 1] (3/3) Installing shadcn/ui components...');
```

**3.2 Emit Phase Updates**
```typescript
this.notifyPhaseUpdate({
    phase: 'scaffold',
    subphase: 'tier1',
    progress: 33,
    message: 'Running Vite CLI...'
});
```

---

### ✅ PHASE 4: Refactoring (Priority: MEDIUM)

**4.1 Extract CLI Commands**
```typescript
// Move to separate file: src/appBuilder/cliCommands.ts
export class CLICommands {
    static viteReact(projectName: string): string {
        return `npm create vite@latest ${projectName} -- --template react-ts`;
    }

    static nextJs(projectName: string): string {
        return `npx create-next-app@latest ${projectName} --typescript --tailwind --app --yes`;
    }

    // etc.
}
```

**4.2 Extract Template Overlays**
```typescript
// Move to separate file: src/appBuilder/templateOverlays.ts
export class TemplateOverlays {
    static supabaseClient(): string { ... }
    static authHook(): string { ... }
    static envExample(appName: string): string { ... }
}
```

**4.3 Simplify Scaffolder**
- [ ] Reduce scaffolder.ts from 663 lines to ~300 lines
- [ ] Each tier = separate class
- [ ] Scaffolder becomes coordinator only

---

### ✅ PHASE 5: Documentation (Priority: LOW)

**5.1 Add JSDoc Comments**
```typescript
/**
 * TIER 1: Bootstrap with Official CLIs
 *
 * Uses official CLI tools to create project skeleton:
 * - Vite CLI for React projects
 * - Next.js CLI for Turbopack projects
 * - Vue CLI for Vue projects
 *
 * @param targetDir - Absolute path to target directory
 * @param spec - App specification with stack choices
 * @throws {Error} If CLI command fails or validation fails
 *
 * Cost: 0 tokens, ~30-60 seconds
 * Reliability: 100% (official CLIs)
 */
```

**5.2 Create Architecture Diagram**
- [ ] Add visual diagram to README showing three-tier flow
- [ ] Document what each tier does and why

---

## Implementation Order

1. **Start Here:** PHASE 1 - Remove legacy code (30 mins)
2. **Then:** PHASE 2 - Better error messages (20 mins)
3. **Then:** PHASE 3 - Progress indicators (15 mins)
4. **Optional:** PHASE 4 - Refactoring (1 hour)
5. **Optional:** PHASE 5 - Documentation (30 mins)

---

## Success Criteria

- [ ] No legacy code paths remaining
- [ ] Every tier clearly labeled in logs
- [ ] Build errors show which tier failed and why
- [ ] Template folder structure is obvious
- [ ] Code compiles with no errors
- [ ] Test build succeeds with clear progress shown

---

## After Cleanup

Compare before/after:

| Metric | Before | After |
|--------|--------|-------|
| scaffolder.ts LOC | 663 | ~300 |
| Template files | ~20 | ~5 (only overlays) |
| Code paths | 2 (CLI + Legacy) | 1 (Three-tier) |
| Error clarity | Low | High |
| Progress visibility | None | Full |
