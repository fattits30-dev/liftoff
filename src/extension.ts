import * as vscode from 'vscode';
import { AutonomousAgentManager, AgentType } from './autonomousAgent';
import { ManagerViewProvider } from './managerViewProvider';
import { ArtifactViewerProvider } from './artifactViewerProvider';
import { LiftoffEditorPanel } from './liftoffEditorPanel';
import { PersistenceManager } from './persistence';

let agentManager: AutonomousAgentManager;
let persistenceManager: PersistenceManager;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Liftoff is now active!');
    
    agentManager = new AutonomousAgentManager(context);
    persistenceManager = new PersistenceManager(context);
    
    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(rocket) Liftoff';
    statusBarItem.tooltip = 'Autonomous AI Agents';
    statusBarItem.command = 'liftoff.openManager';
    statusBarItem.show();
    
    agentManager.onAgentUpdate(() => {
        const running = agentManager.getRunningAgents().length;
        const mode = agentManager.getExecutionMode();
        const modeIcon = mode === 'local' ? '🏠' : mode === 'hybrid' ? '🔀' : '☁️';
        statusBarItem.text = running > 0 
            ? `$(rocket) Liftoff ${modeIcon} (${running} active)`
            : `$(rocket) Liftoff ${modeIcon}`;
    });
    
    // Webview providers
    const managerProvider = new ManagerViewProvider(context.extensionUri, agentManager as any);
    const artifactProvider = new ArtifactViewerProvider(context.extensionUri, agentManager as any);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('liftoff.managerView', managerProvider),
        vscode.window.registerWebviewViewProvider('liftoff.artifactView', artifactProvider)
    );
    
    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('liftoff.openManager', () => {
            // Open full editor panel instead of sidebar
            LiftoffEditorPanel.createOrShow(context.extensionUri, agentManager);
        }),

        vscode.commands.registerCommand('liftoff.openSidebar', () => {
            vscode.commands.executeCommand('workbench.view.extension.liftoff');
        }),
        
        vscode.commands.registerCommand('liftoff.setApiKey', async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your HuggingFace API key (Pro recommended for best models)',
                password: true,
                placeHolder: 'hf_...'
            });
            if (apiKey) {
                agentManager.setApiKey(apiKey);
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
                { label: '🌐 Browser', description: 'Control browser, test UI like a human', value: 'browser' as AgentType },
                { label: '🧹 Cleaner', description: 'Remove broken tests, dead code, cleanup', value: 'cleaner' as AgentType },
                { label: '🔧 General', description: 'General development tasks', value: 'general' as AgentType }
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
            const sessions = persistenceManager.getAllSessions();
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
                const session = persistenceManager.getSession(sel.sessionId);
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
            const path = require('path');
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
                    },
                    "puppeteer": {
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
                        "enabled": true
                    },
                    "sequential-thinking": {
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
                        "enabled": true
                    }
                }
            };

            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            vscode.window.showInformationMessage(
                '✅ Created .mcp.json with filesystem server. Reload window to connect.',
                'Reload'
            ).then(action => {
                if (action === 'Reload') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }),

        vscode.commands.registerCommand('liftoff.configureOllama', async () => {
            const config = vscode.workspace.getConfiguration('liftoff');
            
            // Select execution mode
            const modes = [
                { label: '☁️ Cloud Only', description: 'Use HuggingFace for all inference', value: 'cloud' },
                { label: '🏠 Local Only', description: 'Use Ollama for all inference (requires local setup)', value: 'local' },
                { label: '🔀 Hybrid', description: 'Cloud brain + local muscle (recommended)', value: 'hybrid' }
            ];
            
            const selectedMode = await vscode.window.showQuickPick(modes, {
                placeHolder: 'Select execution mode'
            });
            if (!selectedMode) return;
            
            await config.update('executionMode', selectedMode.value, true);
            agentManager.setExecutionMode(selectedMode.value as any);
            
            if (selectedMode.value !== 'cloud') {
                // Configure Ollama URL
                const url = await vscode.window.showInputBox({
                    prompt: 'Ollama URL',
                    value: config.get('ollamaUrl') || 'http://localhost:11434',
                    placeHolder: 'http://localhost:11434'
                });
                if (url) {
                    await config.update('ollamaUrl', url, true);
                }
                
                // Select local model
                const models = [
                    { label: 'devstral:latest', description: 'Mistral coding model (recommended)' },
                    { label: 'qwen2.5-coder:7b-instruct', description: 'Fast, fits in 8GB VRAM' },
                    { label: 'qwen2.5-coder:14b-instruct', description: 'Good balance' },
                    { label: 'qwen2.5-coder:32b-instruct', description: 'Best quality (needs high VRAM)' },
                    { label: 'codellama:13b-instruct', description: 'Meta CodeLlama' },
                    { label: 'deepseek-coder-v2:latest', description: 'DeepSeek coder' }
                ];
                
                const selectedModel = await vscode.window.showQuickPick(models, {
                    placeHolder: 'Select local model'
                });
                if (selectedModel) {
                    await config.update('ollamaModel', selectedModel.label, true);
                }
                
                // Test connection
                const available = await agentManager.configureLocal({
                    url: url || config.get('ollamaUrl'),
                    model: selectedModel?.label || config.get('ollamaModel')
                });
                
                if (available) {
                    vscode.window.showInformationMessage(`✅ Ollama configured! Mode: ${selectedMode.value}`);
                } else {
                    vscode.window.showWarningMessage(
                        '⚠️ Ollama not reachable. Make sure it\'s running: ollama serve',
                        'Check Status'
                    ).then(action => {
                        if (action) vscode.commands.executeCommand('liftoff.checkLocalStatus');
                    });
                }
            } else {
                vscode.window.showInformationMessage('☁️ Cloud-only mode enabled');
            }
        }),

        vscode.commands.registerCommand('liftoff.checkLocalStatus', async () => {
            const available = await agentManager.isLocalAvailable();
            const stats = agentManager.getHybridStats();
            
            if (available) {
                const models = await agentManager.listLocalModels();
                const modelList = models.length > 0 ? models.slice(0, 5).join(', ') : 'None found';
                
                vscode.window.showInformationMessage(
                    `✅ Ollama Status: Available | Models: ${modelList} | ` +
                    `Local calls: ${stats.localCallsThisHour} | Latency: ${stats.averageLocalLatency.toFixed(0)}ms`
                );
            } else {
                vscode.window.showErrorMessage(
                    '❌ Ollama not available. Start it with: ollama serve'
                );
            }
        })
    );
    
    // Apply execution mode from config
    const config = vscode.workspace.getConfiguration('liftoff');
    const executionMode = config.get<string>('executionMode') || 'cloud';
    agentManager.setExecutionMode(executionMode as any);
    
    // Configure Ollama from settings
    const ollamaUrl = config.get<string>('ollamaUrl') || 'http://localhost:11434';
    const ollamaModel = config.get<string>('ollamaModel') || 'devstral:latest';
    agentManager.configureLocal({ url: ollamaUrl, model: ollamaModel });
    
    // Prompt for API key if not set
    if (!config.get<string>('huggingfaceApiKey')) {
        vscode.window.showInformationMessage(
            '🚀 Liftoff ready! Set your HuggingFace API key to start.',
            'Set Key'
        ).then(a => { if (a) vscode.commands.executeCommand('liftoff.setApiKey'); });
    } else {
        agentManager.setApiKey(config.get<string>('huggingfaceApiKey')!);
    }
    
    context.subscriptions.push(statusBarItem, agentManager);
}

export function deactivate() {
    agentManager?.dispose();
}
