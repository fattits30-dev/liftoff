import * as vscode from 'vscode';
import { MainOrchestrator } from './mainOrchestrator';
import { IAgentManager, IAgent } from './types';
import { getWebviewHtml } from './webview';

/**
 * Liftoff Editor Panel - Modern Cursor/Cline-style UI
 * 
 * Features:
 * - Split-pane layout (Chat | Activity)
 * - Enhanced tool activity with collapsible cards
 * - Editor stats tracking (lines added/removed)
 * - Playwright browser output panel
 * - File diff summaries
 */
export class LiftoffEditorPanel {
    public static currentPanel: LiftoffEditorPanel | undefined;
    private static readonly viewType = 'liftoffEditor';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly agentManager: IAgentManager;
    private readonly orchestrator: MainOrchestrator;
    private disposables: vscode.Disposable[] = [];
    private orchestratorModeActive: boolean = false;

    public static createOrShow(extensionUri: vscode.Uri, agentManager: IAgentManager, orchestrator: MainOrchestrator) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (LiftoffEditorPanel.currentPanel) {
            LiftoffEditorPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            LiftoffEditorPanel.viewType,
            '🚀 Liftoff',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        LiftoffEditorPanel.currentPanel = new LiftoffEditorPanel(panel, extensionUri, agentManager, orchestrator);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, agentManager: IAgentManager, orchestrator: MainOrchestrator) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.agentManager = agentManager;
        this.orchestrator = orchestrator;

        // Load HTML from separate files
        this.panel.webview.html = getWebviewHtml(extensionUri, this.panel.webview);
        
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            async (msg) => {
                switch (msg.command) {
                    case 'spawn':
                        const task = await vscode.window.showInputBox({
                            prompt: `What should the ${msg.type} agent do?`,
                            placeHolder: 'e.g., Run tests and fix failures'
                        });
                        if (task) {
                            try {
                                await this.agentManager.spawnAgent({ type: msg.type, task });
                                this.updateAgents();
                            } catch (e: any) {
                                vscode.window.showErrorMessage(e.message);
                            }
                        }
                        break;
                    case 'stop':
                        this.agentManager.killAgent(msg.id);
                        this.updateAgents();
                        break;
                    case 'stopAll':
                        this.agentManager.stopAllAgents();
                        this.updateAgents();
                        break;
                    case 'chat':
                        if (msg.id && msg.text) {
                            await this.agentManager.continueAgent(msg.id, msg.text);
                        }
                        break;
                    case 'refresh':
                        this.updateAgents();
                        break;
                    case 'openTerminal':
                        vscode.commands.executeCommand('workbench.action.terminal.focus');
                        break;
                    case 'openFile':
                        if (msg.path) {
                            const doc = await vscode.workspace.openTextDocument(msg.path);
                            await vscode.window.showTextDocument(doc);
                        }
                        break;
                    case 'orchestratorChat':
                        if (msg.text) {
                            this.handleOrchestratorChat(msg.text);
                        }
                        break;
                    case 'clearChat':
                        this.orchestrator.clearHistory();
                        this.panel.webview.postMessage({ type: 'chatCleared' });
                        break;
                }
            },
            null,
            this.disposables
        );

        // Subscribe to agent events
        this.disposables.push(
            this.agentManager.on('agentSpawned', () => this.updateAgents()),
            this.agentManager.on('statusChange', () => this.updateAgents()),
            this.agentManager.on('output', (data) => this.sendOutput(data)),
            // Tool execution events for right panel
            this.agentManager.onToolStart((data) => {
                this.panel.webview.postMessage({
                    type: 'toolStart',
                    tool: data.tool,
                    params: JSON.stringify(data.params, null, 2)
                });
            }),
            this.agentManager.onToolComplete((data) => {
                this.panel.webview.postMessage({
                    type: 'toolComplete',
                    tool: data.tool,
                    success: data.success,
                    output: data.output,
                    duration: data.duration
                });
            })
        );

        // Subscribe to orchestrator events
        this.disposables.push(
            this.orchestrator.onMessage((msg) => {
                // Only send assistant messages - user messages are already added by webview locally
                if (msg.role === 'assistant') {
                    this.panel.webview.postMessage({ type: 'orchestratorMessage', message: msg });
                }
            }),
            this.orchestrator.onStatusChange((status) => {
                this.panel.webview.postMessage({ type: 'orchestratorStatus', status });
            }),
            this.orchestrator.onThought((thought) => {
                // Stream thinking/planning in real-time
                this.panel.webview.postMessage({ 
                    type: 'orchestratorThought', 
                    content: thought 
                });
            }),
            this.orchestrator.onAgentSpawned(({ agent, task }) => {
                this.panel.webview.postMessage({ 
                    type: 'agentSpawned', 
                    agent: { id: agent.id, name: agent.name, type: agent.type },
                    task 
                });
                this.updateAgents();
            }),
            this.orchestrator.onAgentCompleted(({ agent, success, error }) => {
                this.panel.webview.postMessage({ 
                    type: 'agentCompleted', 
                    agent: { id: agent.id, name: agent.name, type: agent.type },
                    success,
                    error
                });
                this.updateAgents();
            }),
            this.orchestrator.onTodoAdded((todo) => {
                this.panel.webview.postMessage({ 
                    type: 'todoAdded', 
                    todo 
                });
            })
        );

        // Send initial settings
        const showAgentButtons = vscode.workspace.getConfiguration('liftoff').get('showAgentButtons', false);
        this.panel.webview.postMessage({ type: 'settings', showAgentButtons });
    }

    private updateAgents(): void {
        const agents = this.agentManager.getAllAgents().map((a: IAgent) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            task: a.task,
            iterations: a.iterations,
            type: a.type
        }));
        this.panel.webview.postMessage({ type: 'agents', agents });
    }

    private sendOutput(data: { agentId: string; content: string; type?: string }): void {
        if (!data.agentId || data.content === undefined) return;

        // Send agent output to activity panel (right side) ONLY
        // Chat shows orchestrator planning, right panel shows agent work
        this.panel.webview.postMessage({
            type: 'output',
            agentId: data.agentId,
            content: data.content,
            outputType: data.type
        });
    }

    private async handleOrchestratorChat(text: string): Promise<void> {
        this.orchestratorModeActive = true;
        this.panel.webview.postMessage({ type: 'orchestratorStart' });

        try {
            // Use the REAL orchestrator - it will plan and delegate to agents
            const response = await this.orchestrator.chat(text);
            
            // Send final response
            this.panel.webview.postMessage({
                type: 'orchestratorMessage',
                message: { role: 'assistant', content: response, timestamp: new Date() }
            });
        } catch (err: any) {
            this.panel.webview.postMessage({
                type: 'orchestratorMessage',
                message: { role: 'assistant', content: `❌ Error: ${err.message}`, timestamp: new Date() }
            });
        } finally {
            this.orchestratorModeActive = false;
            this.panel.webview.postMessage({ type: 'orchestratorEnd' });
        }
    }

    public dispose() {
        LiftoffEditorPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) d.dispose();
        }
    }
}
