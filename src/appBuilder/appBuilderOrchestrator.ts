/**
 * App Builder Orchestrator - Main coordinator for building apps from specs
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
    AppSpec,
    Architecture,
    BuildState,
    BuildPhase,
    BuildLog,
    FeatureType
} from './types';
import { SpecGenerator } from './specGenerator';
import { ArchitectureGenerator } from './architectureGenerator';
import { Scaffolder } from './scaffolder';
import { getOrderedTasks, generateEntityTasks, TaskDefinition } from './featureTasks';
import { BuildStateManager } from './buildState';
import { MainOrchestrator } from '../mainOrchestrator';
import {
    LiftoffPlan,
    createInitialPlan,
    updatePhaseStatus,
    addFeature,
    serializePlan,
    deserializePlan
} from './liftoffPlan';

export interface BuildResult {
    success: boolean;
    projectPath: string;
    spec?: AppSpec;
    architecture?: Architecture;
    todoItems: string[];
    deployUrl?: string;
    error?: string;
}

export class AppBuilderOrchestrator {
    private specGenerator: SpecGenerator;
    private architectureGenerator: ArchitectureGenerator;
    private scaffolder: Scaffolder;
    private stateManager: BuildStateManager;
    private mainOrchestrator?: MainOrchestrator;

    private buildState: BuildState;
    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;
    private liftoffPlan?: LiftoffPlan;
    private webview?: vscode.WebviewPanel;

    constructor(
        extensionPath: string,
        mainOrchestrator?: MainOrchestrator
    ) {
        this.mainOrchestrator = mainOrchestrator;
        this.specGenerator = new SpecGenerator(mainOrchestrator);  // Pass orchestrator for AI-driven stack research
        this.architectureGenerator = new ArchitectureGenerator();
        this.scaffolder = new Scaffolder(extensionPath, mainOrchestrator);  // Pass orchestrator for AI scaffolding
        this.stateManager = new BuildStateManager();

        this.outputChannel = vscode.window.createOutputChannel('Liftoff Builder');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

        this.buildState = {
            phase: 'spec',
            completedFeatures: [],
            failedFeatures: [],
            todoItems: [],
            logs: []
        };
    }

    /**
     * Main entry point - build app from description
     */
    async buildApp(description: string, targetDir: string): Promise<BuildResult> {
        this.outputChannel.show();
        this.statusBarItem.show();

        // Create initial .liftoff plan file
        this.liftoffPlan = createInitialPlan(description, targetDir);
        await this.saveLiftoffPlan(targetDir);

        this.log('init', '📋 Created .liftoff plan file - entering APP BUILDER mode', 'started');

        this.buildState = {
            phase: 'spec',
            completedFeatures: [],
            failedFeatures: [],
            todoItems: [],
            logs: []
        };

        try {
            // PHASE 1: Specification
            this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'spec', 'in-progress');
            await this.saveLiftoffPlan(targetDir);
            this.setPhase('spec', 'Analyzing requirements...');
            const spec = await this.runSpecPhase(description);
            if (!spec) {
                return this.buildError('Spec generation cancelled');
            }
            this.buildState.spec = spec;
            this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'spec', 'complete');
            this.liftoffPlan.artifacts.specFile = path.join(targetDir, 'liftoff.spec.json');
            await this.saveLiftoffPlan(targetDir);

            // PHASE 2: Architecture
            this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'architecture', 'in-progress');
            await this.saveLiftoffPlan(targetDir);
            this.setPhase('architecture', 'Designing system...');
            const architecture = await this.runArchitecturePhase(spec);
            this.buildState.architecture = architecture;
            this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'architecture', 'complete');
            this.liftoffPlan.artifacts.archFile = path.join(targetDir, 'liftoff.architecture.json');
            await this.saveLiftoffPlan(targetDir);

            // PHASE 3: Scaffold
            this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'scaffold', 'in-progress');
            await this.saveLiftoffPlan(targetDir);
            this.setPhase('scaffold', 'Setting up project...');
            await this.runScaffoldPhase(targetDir, spec, architecture);
            this.buildState.projectPath = targetDir;
            this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'scaffold', 'complete');
            await this.saveLiftoffPlan(targetDir);

            // PHASE 4: Implementation
            this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'implement', 'in-progress');
            await this.saveLiftoffPlan(targetDir);
            this.setPhase('implement', 'Writing code...');
            await this.runImplementationPhase(targetDir, spec, architecture);
            this.liftoffPlan = updatePhaseStatus(this.liftoffPlan, 'implement', 'complete');
            await this.saveLiftoffPlan(targetDir);

            // Complete! Skip tests and deployment for now
            this.log('complete', '✅ Build complete!', 'completed');
            this.statusBarItem.text = '$(check) Liftoff: Complete';

            // Show summary
            await this.showBuildSummary(spec, architecture, targetDir);

            return {
                success: true,
                projectPath: targetDir,
                spec,
                architecture,
                todoItems: this.buildState.todoItems
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(this.buildState.phase, `Build failed: ${errorMessage}`, 'failed');
            this.statusBarItem.text = '$(error) Liftoff: Failed';

            vscode.window.showErrorMessage(`Build failed: ${errorMessage}`);

            return this.buildError(errorMessage);
        }
    }

    /**
     * Resume an interrupted build
     */
    async resumeBuild(projectPath: string): Promise<BuildResult> {
        const savedState = await this.stateManager.loadState(projectPath);
        if (!savedState) {
            return this.buildError('No saved build state found');
        }

        this.buildState = savedState;
        this.outputChannel.show();
        this.log('resume', `Resuming build from ${savedState.phase} phase`);

        if (!savedState.spec || !savedState.architecture) {
            return this.buildError('Incomplete saved state');
        }

        try {
            // Resume from the current phase
            switch (savedState.phase) {
                case 'scaffold':
                    await this.runScaffoldPhase(projectPath, savedState.spec, savedState.architecture);
                    // Fall through to next phases
                case 'implement':
                    await this.runImplementationPhase(projectPath, savedState.spec, savedState.architecture);
                    break;
                case 'test':
                    await this.runTestPhase(projectPath);
                    break;
                case 'deploy':
                    // Optional deployment
                    break;
            }

            return {
                success: true,
                projectPath,
                spec: savedState.spec,
                architecture: savedState.architecture,
                todoItems: this.buildState.todoItems
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.buildError(errorMessage);
        }
    }

    /**
     * Phase 1: Generate spec from description + user input
     */
    private async runSpecPhase(description: string): Promise<AppSpec | null> {
        const spec = await this.specGenerator.generateSpecFromDescription(description);
        if (!spec) {
            return null;
        }
        return spec;
    }

    /**
     * Phase 2: Generate architecture from spec
     */
    private async runArchitecturePhase(spec: AppSpec): Promise<Architecture> {
        const architecture = this.architectureGenerator.generateArchitecture(spec);
        return architecture;
    }

    /**
     * Phase 3: Scaffold project from templates
     */
    private async runScaffoldPhase(
        targetDir: string,
        spec: AppSpec,
        architecture: Architecture
    ): Promise<void> {
        await this.scaffolder.scaffold(targetDir, spec, architecture);
        await this.scaffolder.installDependencies(targetDir);
    }

    /**
     * Phase 4: Build features using agent system
     */
    private async runImplementationPhase(
        targetDir: string,
        spec: AppSpec,
        _architecture: Architecture
    ): Promise<void> {
        // Get ordered tasks for all features
        const featureTasks = getOrderedTasks(spec.features);

        // Add entity-specific tasks
        for (const entity of spec.entities) {
            if (entity.tableName !== 'profiles') {
                const entityTasks = generateEntityTasks(entity);
                featureTasks.push(...entityTasks);
            }
        }

        this.log('implement', `Building ${featureTasks.length} tasks using AI agents...`);

        let completedCount = 0;
        let failedCount = 0;
        const totalCount = featureTasks.length;

        for (const task of featureTasks) {
            this.statusBarItem.text = `$(sync~spin) ${task.name} (${completedCount}/${totalCount})`;

            try {
                if (this.mainOrchestrator) {
                    const contextPrompt = this.buildTaskPrompt(task, targetDir);
                    const result = await this.mainOrchestrator.delegateTask(task.agent, contextPrompt);

                    if (result.success) {
                        completedCount++;
                    } else {
                        failedCount++;
                        const errorDetail = result.error || result.message || 'Unknown error';
                        // Only log failures
                        this.outputChannel.appendLine(`[❌] ${task.name}: ${errorDetail}`);
                        this.buildState.todoItems.push(`[FAILED] ${task.name}: ${errorDetail}`);
                    }
                } else {
                    this.buildState.todoItems.push(`[${task.agent}] ${task.name}: ${task.prompt}`);
                    completedCount++;
                }
            } catch (error) {
                failedCount++;
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`[❌] ${task.name}: ${errorMessage}`);
                this.buildState.todoItems.push(`[FAILED] ${task.name}: ${task.prompt} - Error: ${errorMessage}`);
            }
        }

        const summary = `Completed ${completedCount}/${totalCount} tasks` +
                       (failedCount > 0 ? ` (${failedCount} failed)` : '');
        this.log('implement', summary, failedCount > 0 ? 'failed' : 'completed');
    }

    /**
     * Build rich context for task execution
     */
    private buildTaskContext(spec: AppSpec, architecture: Architecture): string {
        // Map PostgreSQL types to TypeScript types
        const pgToTs = (pgType: string): string => {
            const typeMap: Record<string, string> = {
                'uuid': 'string',
                'text': 'string',
                'varchar': 'string',
                'integer': 'number',
                'bigint': 'number',
                'boolean': 'boolean',
                'timestamp': 'string',
                'timestamptz': 'string',
                'jsonb': 'any',
                'json': 'any'
            };
            return typeMap[pgType.toLowerCase()] || 'any';
        };

        // Convert to PascalCase
        const toPascalCase = (str: string): string => {
            return str.split(/[-_]/).map(word =>
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            ).join('');
        };

        // Build entity type definitions
        const entityTypes = architecture.database.tables
            .map(table => {
                const typeName = toPascalCase(table.name);
                const fields = table.columns
                    .map(col => `  ${col.name}${col.nullable ? '?' : ''}: ${pgToTs(col.type)};`)
                    .join('\n');

                return `type ${typeName} = {\n${fields}\n}`;
            })
            .join('\n\n');

        // Build available imports
        const imports = [
            "import { supabase } from '@/lib/supabase';",
            "import { useAuth } from '@/hooks/useAuth';",
            "import { useState, useEffect } from 'react';",
            spec.stack.styling === 'tailwind' ? "// Tailwind CSS classes available" : "",
            "import { Button } from '@/components/ui/button';",
            "import { Input } from '@/components/ui/input';",
            "import { Card } from '@/components/ui/card';"
        ].filter(Boolean).join('\n');

        return `## Project Context

**Stack:**
- Frontend: ${spec.stack.frontend}
- Bundler: ${spec.stack.bundler || 'vite'}
- Styling: ${spec.stack.styling}
- Backend: ${spec.stack.backend}
- Auth: ${spec.stack.auth || 'supabase-auth'}

**Available Imports:**
\`\`\`typescript
${imports}
\`\`\`

## Entity Type Definitions

\`\`\`typescript
${entityTypes}
\`\`\`

## Database Tables

${architecture.database.tables.map(table => `
**${table.name}:**
- Primary Key: ${table.primaryKey}
- Columns: ${table.columns.map(c => `${c.name} (${c.type}${c.nullable ? ', nullable' : ''})`).join(', ')}
`).join('\n')}

## Code Pattern Examples

**Fetching data from Supabase:**
\`\`\`tsx
import { supabase } from '@/lib/supabase';
import { useState, useEffect } from 'react';

export function ExampleListPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const { data, error } = await supabase
        .from('table_name')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error:', error);
      } else if (data) {
        setItems(data);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-4">
      {items.map(item => (
        <Card key={item.id}>
          {/* Render item */}
        </Card>
      ))}
    </div>
  );
}
\`\`\`

**Creating/updating data:**
\`\`\`tsx
async function handleSubmit(formData: any) {
  const { data, error } = await supabase
    .from('table_name')
    .insert([formData])
    .select();

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Created:', data);
  }
}
\`\`\`

**Authentication check:**
\`\`\`tsx
import { useAuth } from '@/hooks/useAuth';

export function ProtectedPage() {
  const { user, loading } = useAuth();

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Please log in</div>;

  return <div>Welcome, {user.email}</div>;
}
\`\`\`
`;
    }

    /**
     * Build context-aware prompt for task
     */
    private buildTaskPrompt(task: TaskDefinition, targetDir: string): string {
        // Build rich context if we have spec and architecture
        let contextSection = '';
        if (this.buildState.spec && this.buildState.architecture) {
            contextSection = this.buildTaskContext(this.buildState.spec, this.buildState.architecture) + '\n\n';
        }

        return `${contextSection}## Your Task

**Project Directory:** ${targetDir}
**Task Name:** ${task.name}
**Agent Type:** ${task.agent}

**Instructions:**
${task.prompt}

**Files to create/modify:**
${task.files?.join('\n') || 'As needed'}

**Verification:**
${task.verification || 'Ensure code compiles and follows project patterns'}

---

Please implement this task following the project patterns and type definitions above. Write clean, type-safe code that integrates seamlessly with the existing codebase.`;
    }

    /**
     * Phase 5: Run test suite
     */
    private async runTestPhase(targetDir: string): Promise<void> {
        this.log('test', 'Running tests...');

        try {
            await this.scaffolder.runCommand('npm run test -- --run', targetDir);
            this.log('test', 'Tests passed', 'completed');
        } catch (_error) {
            this.log('test', 'Some tests failed - check output', 'failed');
            this.buildState.todoItems.push('[TODO] Fix failing tests');
        }
    }

    /**
     * Phase 6: Deploy to hosting
     */
    private async runDeployPhase(targetDir: string, spec: AppSpec): Promise<string> {
        this.log('deploy', 'Preparing deployment...');

        const hosting = spec.stack.hosting;

        try {
            if (hosting === 'vercel') {
                // Build first
                await this.scaffolder.runCommand('npm run build', targetDir);

                // Deploy with Vercel
                await this.scaffolder.runCommand('npx vercel --yes', targetDir);

                this.log('deploy', 'Deployed to Vercel', 'completed');
                return `https://${spec.name}.vercel.app`;

            } else if (hosting === 'netlify') {
                // Build first
                await this.scaffolder.runCommand('npm run build', targetDir);

                // Deploy with Netlify
                await this.scaffolder.runCommand('npx netlify deploy --prod --dir=dist', targetDir);

                this.log('deploy', 'Deployed to Netlify', 'completed');
                return `https://${spec.name}.netlify.app`;
            }
        } catch (_error) {
            this.log('deploy', 'Deployment failed - add to TODO', 'failed');
            this.buildState.todoItems.push(`[TODO] Deploy to ${hosting}`);
        }

        return '';
    }

    /**
     * Show build summary to user
     */
    private async showBuildSummary(
        spec: AppSpec,
        architecture: Architecture,
        projectPath: string,
        deployUrl?: string
    ): Promise<void> {
        const summary = [
            `# Build Complete: ${spec.displayName}`,
            '',
            `**Project Location:** ${projectPath}`,
            '',
            '## What was created:',
            `- ${architecture.database.tables.length} database tables`,
            `- ${architecture.components.pages.length} page components`,
            `- ${architecture.apiRoutes.length} API routes`,
            `- ${spec.features.length} features: ${spec.features.join(', ')}`,
            ''
        ];

        if (deployUrl) {
            summary.push(`## Deployed to:`, deployUrl, '');
        }

        if (this.buildState.todoItems.length > 0) {
            summary.push('## TODO Items:', ...this.buildState.todoItems.map(t => `- ${t}`), '');
        }

        summary.push(
            '## Next Steps:',
            '1. Set up Supabase project at https://supabase.com',
            '2. Copy project URL and anon key to .env',
            '3. Run the migration SQL in Supabase SQL Editor',
            '4. Run `npm run dev` to start development',
            ''
        );

        // Show in output channel
        this.outputChannel.appendLine(summary.join('\n'));

        // Also show notification
        const action = await vscode.window.showInformationMessage(
            `Build complete! Project created at ${projectPath}`,
            'Open Folder',
            'View Summary'
        );

        if (action === 'Open Folder') {
            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath));
        } else if (action === 'View Summary') {
            this.outputChannel.show();
        }
    }

    /**
     * Set webview panel for UI updates
     */
    setWebview(webview: vscode.WebviewPanel): void {
        this.webview = webview;
    }

    /**
     * Set current phase and update UI
     */
    private setPhase(phase: BuildPhase, message: string): void {
        this.buildState.phase = phase;
        this.statusBarItem.text = `$(sync~spin) Liftoff: ${message}`;
        this.log(phase, message, 'started');
        this.notifyPhaseUpdate(phase);
    }

    /**
     * Notify webview of phase change
     */
    private notifyPhaseUpdate(phase: BuildPhase): void {
        if (this.webview) {
            this.webview.webview.postMessage({
                type: 'phaseUpdate',
                phase: phase
            });
        }
    }

    /**
     * Log build event
     */
    private log(phase: BuildPhase | string, action: string, status?: BuildLog['status']): void {
        const timestamp = new Date();
        const log: BuildLog = {
            timestamp,
            phase: phase as BuildPhase,
            action,
            status: status || 'started'
        };

        this.buildState.logs.push(log);
        this.outputChannel.appendLine(`[${timestamp.toISOString()}] [${phase}] ${action}`);
    }

    /**
     * Save current build state
     */
    private async saveState(projectPath: string): Promise<void> {
        await this.stateManager.saveState(projectPath, this.buildState);
    }

    /**
     * Save .liftoff plan file
     */
    private async saveLiftoffPlan(projectPath: string): Promise<void> {
        if (!this.liftoffPlan) return;

        const liftoffPath = path.join(projectPath, '.liftoff');
        const content = serializePlan(this.liftoffPlan);
        await fs.writeFile(liftoffPath, content, 'utf-8');
        this.log('plan', 'Updated .liftoff file', 'started');
    }

    /**
     * Load existing .liftoff plan file
     */
    private async loadLiftoffPlan(projectPath: string): Promise<LiftoffPlan | null> {
        try {
            const liftoffPath = path.join(projectPath, '.liftoff');
            const content = await fs.readFile(liftoffPath, 'utf-8');
            return deserializePlan(content);
        } catch (error) {
            return null;
        }
    }

    /**
     * Create error result
     */
    private buildError(message: string): BuildResult {
        return {
            success: false,
            projectPath: '',
            todoItems: this.buildState.todoItems,
            error: message
        };
    }

    /**
     * Get default entities for app type
     */
    private getDefaultEntities(_appType: string): AppSpec['entities'] {
        // Simplified - full implementation in specGenerator
        return [
            {
                name: 'Profile',
                tableName: 'profiles',
                fields: [
                    { name: 'id', type: 'uuid', required: true, unique: true },
                    { name: 'email', type: 'email', required: true, unique: true },
                    { name: 'full_name', type: 'text', required: false },
                    { name: 'avatar_url', type: 'url', required: false }
                ],
                timestamps: true,
                rls: true,
                rlsPolicy: 'owner'
            }
        ];
    }

    /**
     * Get default pages for app type
     */
    private getDefaultPages(appType: string, features: FeatureType[]): AppSpec['pages'] {
        const pages: AppSpec['pages'] = [
            { path: '/', name: 'Home', component: 'HomePage', layout: 'default', protected: false }
        ];

        if (features.includes('auth')) {
            pages.push(
                { path: '/login', name: 'Login', component: 'LoginPage', layout: 'auth', protected: false },
                { path: '/signup', name: 'Signup', component: 'SignupPage', layout: 'auth', protected: false }
            );
        }

        if (appType === 'saas' || appType === 'dashboard' || appType === 'crud') {
            pages.push(
                { path: '/dashboard', name: 'Dashboard', component: 'DashboardPage', layout: 'dashboard', protected: true },
                { path: '/settings', name: 'Settings', component: 'SettingsPage', layout: 'dashboard', protected: true }
            );
        }

        return pages;
    }

    /**
     * Convert string to title case
     */
    private toTitleCase(str: string): string {
        return str.split('-').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.outputChannel.dispose();
        this.statusBarItem.dispose();
    }
}
