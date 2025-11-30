import * as vscode from 'vscode';
import * as path from 'path';
import { AutonomousAgentManager } from './autonomousAgent';
import { ManagerViewProvider } from './managerViewProvider';
import { ArtifactViewerProvider } from './artifactViewerProvider';
import { LiftoffEditorPanel } from './liftoffEditorPanel';
import { PersistenceManager } from './persistence';
import { MainOrchestrator } from './mainOrchestrator';
import { SemanticMemoryStore, OrchestratorMemory } from './memory/agentMemory';
import { AgentType } from './types/agentTypes';
import { AppBuilderOrchestrator, hasBuildState, loadBuildState } from './appBuilder';

let agentManager: AutonomousAgentManager;
let orchestrator: MainOrchestrator;
let appBuilder: AppBuilderOrchestrator;
let persistenceManager: PersistenceManager;
let semanticMemory: SemanticMemoryStore;
let orchestratorMemory: OrchestratorMemory;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

function log(message: string): void {
    outputChannel?.appendLine(`[Liftoff] ${new Date().toISOString()} - ${message}`);
}

export async function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Liftoff Extension');
    context.subscriptions.push(outputChannel);
    
    log('🚀 Liftoff is activating...');

    try {
        const memoryPath = path.join(context.globalStorageUri.fsPath, 'memory');
        semanticMemory = new SemanticMemoryStore(path.join(memoryPath, 'semantic.json'));
        orchestratorMemory = new OrchestratorMemory(path.join(memoryPath, 'orchestrator.json'), semanticMemory);
        
        await Promise.all([
            semanticMemory.initialize(),
            orchestratorMemory.initialize()
        ]);

        agentManager = new AutonomousAgentManager(context, semanticMemory);
        
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        orchestrator = new MainOrchestrator(workspaceRoot, semanticMemory, orchestratorMemory);
        
        // Wire orchestrator to agent manager for delegation
        orchestrator.setAgentManager(agentManager);

        // Initialize app builder
        appBuilder = new AppBuilderOrchestrator(context.extensionPath, orchestrator);

        persistenceManager = new PersistenceManager(context);

        log('Core components initialized');
    } catch (err: any) {
        log(`Failed to initialize: ${err.message}`);
        vscode.window.showErrorMessage(`Liftoff failed to initialize: ${err.message}`);
        return;
    }
    
    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(rocket) Liftoff';
    statusBarItem.tooltip = 'Autonomous AI Agents';
    statusBarItem.command = 'liftoff.openManager';
    statusBarItem.show();
    
    agentManager.onAgentUpdate(() => {
        const running = agentManager.getRunningAgents().length;
        statusBarItem.text = running > 0 
            ? `$(rocket) Liftoff ☁️ (${running} active)`
            : '$(rocket) Liftoff ☁️';
    });

    // Webview providers - MUST push providers themselves to subscriptions for proper cleanup
    const managerProvider = new ManagerViewProvider(context.extensionUri, agentManager);
    const artifactProvider = new ArtifactViewerProvider(context.extensionUri, agentManager);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('liftoff.managerView', managerProvider),
        vscode.window.registerWebviewViewProvider('liftoff.artifactView', artifactProvider),
        managerProvider,  // Provider instance for internal cleanup
        artifactProvider  // Provider instance for internal cleanup
    );
    
    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('liftoff.openManager', () => {
            LiftoffEditorPanel.createOrShow(context.extensionUri, agentManager, orchestrator);
        }),

        vscode.commands.registerCommand('liftoff.openSidebar', () => {
            vscode.commands.executeCommand('workbench.view.extension.liftoff');
        }),
        
        vscode.commands.registerCommand('liftoff.setApiKey', async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your HuggingFace API key (Pro recommended)',
                password: true,
                placeHolder: 'hf_...'
            });
            if (apiKey) {
                agentManager.setApiKey(apiKey);
                orchestrator.setApiKey(apiKey);
                const ok = await agentManager.testConnection();
                vscode.window.showInformationMessage(
                    ok ? '✅ API key verified!' : '⚠️ Key set but connection test failed'
                );
            }
        }),
        
        vscode.commands.registerCommand('liftoff.spawnAgent', async () => {
            const config = vscode.workspace.getConfiguration('liftoff');
            if (!config.get<string>('huggingfaceApiKey')) {
                const action = await vscode.window.showErrorMessage('HuggingFace API key not set!', 'Set Key');
                if (action) vscode.commands.executeCommand('liftoff.setApiKey');
                return;
            }
            
            const types = [
                { label: '🎨 Frontend', description: 'Edit React/Vue/CSS, run builds', value: 'frontend' as AgentType },
                { label: '⚙️ Backend', description: 'Modify APIs, databases, server code', value: 'backend' as AgentType },
                { label: '🧪 Testing', description: 'Run tests, analyze failures', value: 'testing' as AgentType },
                { label: '🌐 Browser', description: 'Control browser, test UI', value: 'browser' as AgentType },
                { label: '🧹 Cleaner', description: 'Remove dead code, cleanup', value: 'cleaner' as AgentType },
                { label: '🔧 General', description: 'General dev tasks', value: 'general' as AgentType }
            ];
            
            const selected = await vscode.window.showQuickPick(types, { placeHolder: 'Select agent type' });
            if (!selected) return;
            
            const task = await vscode.window.showInputBox({
                prompt: 'What should this agent do?',
                placeHolder: 'e.g., Run the tests and fix any failures'
            });
            if (!task) return;
            
            try {
                await agentManager.spawnAgent({ type: selected.value, task });
                vscode.window.showInformationMessage(`🚀 ${selected.label} agent started!`);
            } catch (e: any) {
                vscode.window.showErrorMessage(`Failed: ${e.message}`);
            }
        }),
        
        vscode.commands.registerCommand('liftoff.killAllAgents', () => {
            agentManager.stopAllAgents();
            vscode.window.showInformationMessage('All agents stopped');
        }),

        vscode.commands.registerCommand('liftoff.continueAgent', async () => {
            const agents = agentManager.getAllAgents();
            if (agents.length === 0) {
                vscode.window.showInformationMessage('No agents');
                return;
            }
            
            interface AgentOption extends vscode.QuickPickItem { agentId: string; }
            const options: AgentOption[] = agents.map(a => ({
                label: a.name,
                description: `${a.status} - ${a.iterations} iterations`,
                detail: a.task.substring(0, 80),
                agentId: a.id
            }));
            
            const sel = await vscode.window.showQuickPick(options, { placeHolder: 'Select agent' });
            if (!sel) return;
            
            const msg = await vscode.window.showInputBox({ prompt: 'Message to agent' });
            if (msg) {
                await agentManager.continueAgent(sel.agentId, msg);
            }
        }),

        vscode.commands.registerCommand('liftoff.viewHistory', async () => {
            const sessions = await persistenceManager.getSessionHistory();
            if (sessions.length === 0) {
                vscode.window.showInformationMessage('No history');
                return;
            }
            interface SessionOption extends vscode.QuickPickItem { sessionId: string; }
            const opts: SessionOption[] = sessions.map(s => ({
                label: new Date(s.timestamp).toLocaleString(),
                description: `${s.agents.length} agents`,
                sessionId: s.id
            }));
            const sel = await vscode.window.showQuickPick(opts);
            if (sel) {
                const session = await persistenceManager.getSession(sel.sessionId);
                if (session) {
                    const doc = await vscode.workspace.openTextDocument({
                        content: JSON.stringify(session, null, 2),
                        language: 'json'
                    });
                    vscode.window.showTextDocument(doc);
                }
            }
        }),

        vscode.commands.registerCommand('liftoff.showOutput', () => {
            agentManager.showOutput();
        }),


        vscode.commands.registerCommand('liftoff.initMcp', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const fs = require('fs');
            const configPath = path.join(workspaceRoot, '.mcp.json');

            if (fs.existsSync(configPath)) {
                const action = await vscode.window.showWarningMessage(
                    '.mcp.json already exists. Overwrite?',
                    'Overwrite', 'Cancel'
                );
                if (action !== 'Overwrite') return;
            }

            const config = {
                "$schema": "https://raw.githubusercontent.com/anthropics/mcp/main/schemas/config.json",
                "servers": {
                    "filesystem": {
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-filesystem", workspaceRoot],
                        "enabled": true
                    },
                    "github": {
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-github"],
                        "enabled": true
                    },
                    "memory": {
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-memory"],
                        "enabled": true
                    },
                    "fetch": {
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-fetch"],
                        "enabled": true
                    }
                }
            };

            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            vscode.window.showInformationMessage(
                '✅ Created .mcp.json. Reload window to connect.',
                'Reload'
            ).then(action => {
                if (action === 'Reload') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }),

        vscode.commands.registerCommand('liftoff.orchestratorChat', async () => {
            const config = vscode.workspace.getConfiguration('liftoff');
            if (!config.get<string>('huggingfaceApiKey')) {
                const action = await vscode.window.showErrorMessage(
                    'HuggingFace API key not set!', 'Set Key'
                );
                if (action) vscode.commands.executeCommand('liftoff.setApiKey');
                return;
            }

            const task = await vscode.window.showInputBox({
                prompt: '🧠 Orchestrator: What would you like me to do?',
                placeHolder: 'e.g., Run the tests and fix any failures',
                ignoreFocusOut: true
            });

            if (!task) return;

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '🧠 Orchestrator working...',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Processing task...' });
                
                try {
                    const response = await orchestrator.chat(task);
                    orchestrator.showOutput();
                    
                    const lines = response.split('\n').filter(l => l.trim());
                    const summary = lines.slice(0, 3).join(' | ');
                    vscode.window.showInformationMessage(
                        summary.substring(0, 200) + (summary.length > 200 ? '...' : ''),
                        'View Details'
                    ).then(action => {
                        if (action) orchestrator.showOutput();
                    });
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Orchestrator error: ${err.message}`);
                }
            });
        }),

        // App Builder Commands
        vscode.commands.registerCommand('liftoff.buildApp', async () => {
            const config = vscode.workspace.getConfiguration('liftoff');
            if (!config.get<string>('huggingfaceApiKey')) {
                const action = await vscode.window.showErrorMessage(
                    'HuggingFace API key not set!', 'Set Key'
                );
                if (action) vscode.commands.executeCommand('liftoff.setApiKey');
                return;
            }

            const description = await vscode.window.showInputBox({
                prompt: '🏗️ Describe the app you want to build',
                placeHolder: 'A project management app with teams, tasks, and deadlines',
                ignoreFocusOut: true
            });

            if (!description) return;

            const targetFolder = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Select Project Location',
                title: 'Where should we create the project?'
            });

            if (!targetFolder || targetFolder.length === 0) return;

            const appName = await vscode.window.showInputBox({
                prompt: 'Project folder name (lowercase, no spaces)',
                placeHolder: 'my-app',
                validateInput: (value) => {
                    if (!/^[a-z][a-z0-9-]*$/.test(value)) {
                        return 'Must be lowercase, start with letter, only letters/numbers/hyphens';
                    }
                    return null;
                }
            });

            if (!appName) return;

            const targetDir = path.join(targetFolder[0].fsPath, appName);

            log(`Building app: ${description} at ${targetDir}`);

            try {
                const result = await appBuilder.buildApp(description, targetDir);

                if (result.success) {
                    const action = await vscode.window.showInformationMessage(
                        `✅ App "${result.spec?.displayName}" created successfully!`,
                        'Open Folder',
                        'View TODO'
                    );

                    if (action === 'Open Folder') {
                        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetDir));
                    } else if (action === 'View TODO' && result.todoItems.length > 0) {
                        const doc = await vscode.workspace.openTextDocument({
                            content: result.todoItems.join('\n'),
                            language: 'markdown'
                        });
                        vscode.window.showTextDocument(doc);
                    }
                } else {
                    vscode.window.showErrorMessage(`Build failed: ${result.error}`);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Build failed: ${err.message}`);
            }
        }),

        vscode.commands.registerCommand('liftoff.resumeBuild', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            if (!hasBuildState(workspaceRoot)) {
                vscode.window.showInformationMessage('No interrupted build found in this workspace');
                return;
            }

            const state = await loadBuildState(workspaceRoot);
            if (!state) return;

            const resume = await vscode.window.showQuickPick(
                ['Yes, resume build', 'No, start fresh'],
                {
                    placeHolder: `Found interrupted build at "${state.phase}" phase. Resume?`
                }
            );

            if (resume === 'Yes, resume build') {
                try {
                    const result = await appBuilder.resumeBuild(workspaceRoot);
                    if (result.success) {
                        vscode.window.showInformationMessage('Build resumed and completed!');
                    } else {
                        vscode.window.showErrorMessage(`Resume failed: ${result.error}`);
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Resume failed: ${err.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('liftoff.addFeature', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const features = [
                { label: '🔐 Auth', description: 'Add user authentication', value: 'auth' },
                { label: '📁 File Upload', description: 'Add file/image uploads', value: 'file-upload' },
                { label: '💳 Payments', description: 'Add Stripe payments', value: 'payments' },
                { label: '⚡ Realtime', description: 'Add realtime updates', value: 'realtime' },
                { label: '🔍 Search', description: 'Add full-text search', value: 'search' },
                { label: '👑 Admin', description: 'Add admin dashboard', value: 'admin' },
                { label: '🔗 Social Auth', description: 'Add Google/GitHub login', value: 'social-auth' },
                { label: '🛡️ RBAC', description: 'Add role-based access', value: 'rbac' }
            ];

            const selected = await vscode.window.showQuickPick(features, {
                placeHolder: 'Select feature to add',
                title: 'Add Feature'
            });

            if (!selected) return;

            // Use orchestrator to implement the feature
            const task = `Add ${selected.label} feature to this project.
This includes:
- Creating necessary components
- Setting up required hooks
- Adding any needed database tables
- Integrating with existing code`;

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Adding ${selected.label} feature...`,
                cancellable: false
            }, async () => {
                try {
                    await orchestrator.chat(task);
                    vscode.window.showInformationMessage(`✅ ${selected.label} feature added!`);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to add feature: ${err.message}`);
                }
            });
        }),

        vscode.commands.registerCommand('liftoff.deployApp', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const platform = await vscode.window.showQuickPick(
                [
                    { label: '▲ Vercel', description: 'Deploy to Vercel', value: 'vercel' },
                    { label: '◆ Netlify', description: 'Deploy to Netlify', value: 'netlify' }
                ],
                { placeHolder: 'Select deployment platform' }
            );

            if (!platform) return;

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Deploying to ${platform.label}...`,
                cancellable: false
            }, async () => {
                const { exec } = require('child_process');

                try {
                    // Build first
                    await new Promise<void>((resolve, reject) => {
                        exec('npm run build', { cwd: workspaceRoot }, (err: Error | null) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    // Deploy
                    const deployCmd = platform.value === 'vercel'
                        ? 'npx vercel --yes'
                        : 'npx netlify deploy --prod --dir=dist';

                    await new Promise<void>((resolve, reject) => {
                        exec(deployCmd, { cwd: workspaceRoot }, (err: Error | null, stdout: string) => {
                            if (err) reject(err);
                            else {
                                log(stdout);
                                resolve();
                            }
                        });
                    });

                    vscode.window.showInformationMessage(`✅ Deployed to ${platform.label}!`);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Deployment failed: ${err.message}`);
                }
            });
        })
    );
    
    // Apply API key from config if present
    const config = vscode.workspace.getConfiguration('liftoff');
    if (!config.get<string>('huggingfaceApiKey')) {
        vscode.window.showInformationMessage(
            '🚀 Liftoff ready! Set your HuggingFace API key to start.',
            'Set Key'
        ).then(a => { if (a) vscode.commands.executeCommand('liftoff.setApiKey'); });
    } else {
        const apiKey = config.get<string>('huggingfaceApiKey')!;
        agentManager.setApiKey(apiKey);
        orchestrator.setApiKey(apiKey);
    }
    
    context.subscriptions.push(statusBarItem, agentManager, orchestrator, appBuilder);
}

export function deactivate() {
    log('Deactivating Liftoff...');

    try { appBuilder?.dispose(); } catch (err: any) { log(`Error: ${err.message}`); }
    try { orchestrator?.dispose(); } catch (err: any) { log(`Error: ${err.message}`); }
    try { agentManager?.dispose(); } catch (err: any) { log(`Error: ${err.message}`); }
    try { persistenceManager?.dispose(); } catch (err: any) { log(`Error: ${err.message}`); }
    try { semanticMemory?.dispose(); } catch (err: any) { log(`Error: ${err.message}`); }
    try { orchestratorMemory?.dispose(); } catch (err: any) { log(`Error: ${err.message}`); }

    log('Liftoff deactivated');
}
