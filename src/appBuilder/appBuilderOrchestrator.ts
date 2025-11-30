/**
 * App Builder Orchestrator - Main coordinator for building apps from specs
 */

import * as vscode from 'vscode';
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

    constructor(
        extensionPath: string,
        mainOrchestrator?: MainOrchestrator
    ) {
        this.specGenerator = new SpecGenerator();
        this.architectureGenerator = new ArchitectureGenerator();
        this.scaffolder = new Scaffolder(extensionPath);
        this.stateManager = new BuildStateManager();
        this.mainOrchestrator = mainOrchestrator;

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

        this.buildState = {
            phase: 'spec',
            completedFeatures: [],
            failedFeatures: [],
            todoItems: [],
            logs: []
        };

        try {
            // PHASE 1: Specification
            this.setPhase('spec', 'Gathering requirements...');
            const spec = await this.runSpecPhase(description);
            if (!spec) {
                return this.buildError('Spec generation cancelled');
            }
            this.buildState.spec = spec;
            await this.saveState(targetDir);

            // PHASE 2: Architecture
            this.setPhase('architecture', 'Designing architecture...');
            const architecture = await this.runArchitecturePhase(spec);
            this.buildState.architecture = architecture;
            await this.saveState(targetDir);

            // PHASE 3: Scaffold
            this.setPhase('scaffold', 'Creating project structure...');
            await this.runScaffoldPhase(targetDir, spec, architecture);
            this.buildState.projectPath = targetDir;
            await this.saveState(targetDir);

            // PHASE 4: Implementation
            this.setPhase('implement', 'Building features...');
            await this.runImplementationPhase(targetDir, spec, architecture);
            await this.saveState(targetDir);

            // PHASE 5: Testing (optional)
            const runTests = await vscode.window.showQuickPick(
                ['Yes, run tests', 'Skip tests'],
                { placeHolder: 'Run tests before deployment?' }
            );

            if (runTests === 'Yes, run tests') {
                this.setPhase('test', 'Running tests...');
                await this.runTestPhase(targetDir);
            }

            // PHASE 6: Deployment (optional)
            const deploy = await vscode.window.showQuickPick(
                ['Deploy now', 'Deploy later'],
                { placeHolder: 'Deploy to production?' }
            );

            let deployUrl: string | undefined;
            if (deploy === 'Deploy now') {
                this.setPhase('deploy', 'Deploying...');
                deployUrl = await this.runDeployPhase(targetDir, spec);
            }

            // Complete!
            this.log('complete', 'Build complete!', 'completed');
            this.statusBarItem.text = '$(check) Liftoff: Complete';

            // Show summary
            await this.showBuildSummary(spec, architecture, targetDir, deployUrl);

            return {
                success: true,
                projectPath: targetDir,
                spec,
                architecture,
                todoItems: this.buildState.todoItems,
                deployUrl
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
                case 'test':
                    await this.runTestPhase(projectPath);
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
        // First, infer from description
        const inferred = await this.specGenerator.generateSpecFromDescription(description);

        // Show what we inferred and let user confirm/modify
        const useInferred = await vscode.window.showQuickPick(
            ['Use inferred settings', 'Customize settings'],
            {
                placeHolder: `Inferred: ${inferred.type} app with ${inferred.features?.join(', ')} features`
            }
        );

        if (useInferred === 'Customize settings') {
            // Run full interactive spec gathering
            return await this.specGenerator.gatherSpec();
        }

        // Get minimal required info
        const appName = await vscode.window.showInputBox({
            prompt: 'App name (lowercase, no spaces)',
            placeHolder: 'my-app',
            validateInput: (value) => {
                if (!/^[a-z][a-z0-9-]*$/.test(value)) {
                    return 'Must be lowercase, start with letter, only letters/numbers/hyphens';
                }
                return null;
            }
        });

        if (!appName) return null;

        // Build complete spec from inferred + user input
        const spec: AppSpec = {
            name: appName,
            displayName: this.toTitleCase(appName),
            description,
            version: '0.1.0',
            type: inferred.type || 'saas',
            features: inferred.features || ['auth', 'database'],
            entities: this.getDefaultEntities(inferred.type || 'saas'),
            pages: this.getDefaultPages(inferred.type || 'saas', inferred.features || []),
            stack: inferred.stack || {
                frontend: 'react',
                styling: 'tailwind',
                components: 'shadcn',
                backend: 'supabase',
                hosting: 'vercel'
            }
        };

        this.log('spec', `Generated spec: ${spec.name} (${spec.type})`, 'completed');
        return spec;
    }

    /**
     * Phase 2: Generate architecture from spec
     */
    private async runArchitecturePhase(spec: AppSpec): Promise<Architecture> {
        const architecture = this.architectureGenerator.generateArchitecture(spec);

        this.log('architecture', `Database: ${architecture.database.tables.length} tables`, 'completed');
        this.log('architecture', `Components: ${architecture.components.pages.length} pages`, 'completed');
        this.log('architecture', `API Routes: ${architecture.apiRoutes.length} endpoints`, 'completed');

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

        this.log('scaffold', `Project scaffolded at ${targetDir}`, 'completed');

        // Ask about npm install
        const installDeps = await vscode.window.showQuickPick(
            ['Yes, install now', 'No, I\'ll do it later'],
            { placeHolder: 'Install dependencies (npm install)?' }
        );

        if (installDeps === 'Yes, install now') {
            this.log('scaffold', 'Installing dependencies...', 'started');
            await this.scaffolder.installDependencies(targetDir);
            this.log('scaffold', 'Dependencies installed', 'completed');
        }
    }

    /**
     * Phase 4: Build features using agent system
     */
    private async runImplementationPhase(
        targetDir: string,
        spec: AppSpec,
        architecture: Architecture
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

        this.log('implement', `Building ${featureTasks.length} tasks...`);

        let completedCount = 0;
        const totalCount = featureTasks.length;

        for (const task of featureTasks) {
            this.statusBarItem.text = `$(sync~spin) Building: ${task.name} (${completedCount}/${totalCount})`;

            try {
                // If we have an orchestrator, delegate to agents
                if (this.mainOrchestrator) {
                    const contextPrompt = this.buildTaskPrompt(task, targetDir);
                    await this.mainOrchestrator.chat(contextPrompt);
                } else {
                    // Otherwise, just log as TODO
                    this.buildState.todoItems.push(`[${task.agent}] ${task.name}: ${task.prompt}`);
                }

                completedCount++;
                this.log('implement', `Completed: ${task.name}`, 'completed');

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.log('implement', `Failed: ${task.name} - ${errorMessage}`, 'failed');

                // Add to TODO list for manual completion
                this.buildState.todoItems.push(`[FAILED] ${task.name}: ${task.prompt}`);
            }
        }

        this.log('implement', `Completed ${completedCount}/${totalCount} tasks`, 'completed');
    }

    /**
     * Build context-aware prompt for task
     */
    private buildTaskPrompt(task: TaskDefinition, targetDir: string): string {
        return `Working in project at ${targetDir}:

Task: ${task.name}
Agent: ${task.agent}

Instructions:
${task.prompt}

Files to create/modify:
${task.files?.join('\n') || 'As needed'}

Verification:
${task.verification}

Please implement this task now.`;
    }

    /**
     * Phase 5: Run test suite
     */
    private async runTestPhase(targetDir: string): Promise<void> {
        this.log('test', 'Running tests...');

        try {
            await this.scaffolder.runCommand('npm run test -- --run', targetDir);
            this.log('test', 'Tests passed', 'completed');
        } catch (error) {
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
        } catch (error) {
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
     * Set current phase and update UI
     */
    private setPhase(phase: BuildPhase, message: string): void {
        this.buildState.phase = phase;
        this.statusBarItem.text = `$(sync~spin) Liftoff: ${message}`;
        this.log(phase, message, 'started');
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
    private getDefaultEntities(appType: string): AppSpec['entities'] {
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
