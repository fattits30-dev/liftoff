import * as vscode from 'vscode';

/**
 * Liftoff Editor Panel - Cursor/Antigravity-style UI
 * Left side: Chat with markdown rendering
 * Right side: Agent activity status & terminal commands
 */
export class LiftoffEditorPanel {
    public static currentPanel: LiftoffEditorPanel | undefined;
    private static readonly viewType = 'liftoffEditor';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly agentManager: any;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, agentManager: any) {
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

        LiftoffEditorPanel.currentPanel = new LiftoffEditorPanel(panel, extensionUri, agentManager);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, agentManager: any) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.agentManager = agentManager;

        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

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
                }
            },
            null,
            this.disposables
        );

        this.disposables.push(
            this.agentManager.on('agentSpawned', () => this.updateAgents()),
            this.agentManager.on('statusChange', () => this.updateAgents()),
            this.agentManager.on('output', (data: any) => this.sendOutput(data))
        );
    }

    private updateAgents(): void {
        const agents = this.agentManager.getAllAgents().map((a: any) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            task: a.task,
            iterations: a.iterations,
            type: a.type,
            model: a.model
        }));
        this.panel.webview.postMessage({ type: 'agents', agents });
    }

    private sendOutput(data: any): void {
        if (!data.agentId || data.content === undefined) return;

        this.panel.webview.postMessage({
            type: 'output',
            agentId: data.agentId,
            content: data.content,
            outputType: data.type
        });
    }

    public dispose() {
        LiftoffEditorPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) d.dispose();
        }
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Liftoff</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
            --bg: #1e1e1e;
            --bg-secondary: #252526;
            --bg-tertiary: #2d2d30;
            --border: #3c3c3c;
            --fg: #cccccc;
            --fg-muted: #858585;
            --accent: #007acc;
            --accent-hover: #1c8cd9;
            --success: #4ec9b0;
            --error: #f14c4c;
            --warning: #cca700;
            --code-bg: #1a1a1a;
            --inline-code-bg: #383838;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            color: var(--fg);
            background: var(--bg);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* Header */
        .header {
            padding: 8px 16px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .header-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 500;
            font-size: 13px;
        }

        .header-divider {
            width: 1px;
            height: 16px;
            background: var(--border);
        }

        .session-name {
            color: var(--fg-muted);
            font-size: 12px;
        }

        .header-actions {
            margin-left: auto;
            display: flex;
            gap: 8px;
        }

        .btn {
            padding: 4px 12px;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: transparent;
            color: var(--fg);
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s;
        }

        .btn:hover {
            background: var(--bg-tertiary);
            border-color: var(--fg-muted);
        }

        .btn-primary {
            background: var(--accent);
            border-color: var(--accent);
            color: white;
        }

        .btn-primary:hover {
            background: var(--accent-hover);
        }

        .btn-danger {
            color: var(--error);
            border-color: var(--error);
        }

        .btn-danger:hover {
            background: rgba(241, 76, 76, 0.1);
        }

        /* Main layout */
        .main {
            flex: 1;
            display: flex;
            overflow: hidden;
            min-height: 0;
        }

        /* Left panel - Chat */
        .chat-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--border);
            min-width: 400px;
            height: 100%;
            overflow: hidden;
        }

        .chat-scroll {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 16px;
            max-height: 100%;
            scroll-behavior: smooth;
        }

        /* Chat messages */
        .msg {
            margin-bottom: 16px;
            line-height: 1.6;
        }

        .msg-thought {
            color: var(--fg);
        }

        .msg-user {
            background: var(--accent);
            color: white;
            padding: 8px 14px;
            border-radius: 12px;
            max-width: 80%;
            margin-left: auto;
        }

        .msg-task {
            background: linear-gradient(135deg, #1a3a5c 0%, #1e293b 100%);
            border-left: 3px solid var(--accent);
            padding: 12px 16px;
            border-radius: 0 8px 8px 0;
        }

        /* Inline code */
        .inline-code {
            font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
            font-size: 12px;
            background: var(--inline-code-bg);
            padding: 2px 6px;
            border-radius: 4px;
            color: #ce9178;
        }

        /* Code blocks */
        .code-block {
            background: var(--code-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            margin: 8px 0;
            overflow: hidden;
        }

        .code-header {
            padding: 6px 12px;
            background: var(--bg-tertiary);
            font-size: 11px;
            color: var(--fg-muted);
            border-bottom: 1px solid var(--border);
        }

        .code-content {
            padding: 12px;
            font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
            font-size: 12px;
            overflow-x: auto;
            white-space: pre;
        }

        /* Analysis cards */
        .analysis-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            margin: 12px 0;
            overflow: hidden;
        }

        .analysis-header {
            padding: 10px 14px;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 12px;
        }

        .analysis-icon {
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        }

        .analysis-type {
            color: var(--fg-muted);
        }

        .analysis-file {
            color: var(--success);
            font-family: 'Cascadia Code', monospace;
        }

        .analysis-lines {
            color: var(--fg-muted);
            margin-left: auto;
        }

        /* Search card */
        .search-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 10px 14px;
            margin: 12px 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .search-icon {
            color: var(--fg-muted);
        }

        .search-query {
            color: var(--fg);
        }

        .search-results {
            margin-left: auto;
            color: var(--fg-muted);
            font-size: 12px;
        }

        /* Generating indicator */
        .generating {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--fg-muted);
            font-style: italic;
            padding: 8px 0;
        }

        .generating-dot {
            width: 6px;
            height: 6px;
            background: var(--accent);
            border-radius: 50%;
            animation: pulse 1s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.8); }
        }

        /* Chat input */
        .chat-input {
            padding: 12px 16px;
            border-top: 1px solid var(--border);
            background: var(--bg-secondary);
        }

        .input-container {
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 8px 12px;
        }

        .input-container:focus-within {
            border-color: var(--accent);
        }

        .chat-input input {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--fg);
            font-size: 13px;
            outline: none;
        }

        .input-hint {
            color: var(--fg-muted);
            font-size: 11px;
        }

        /* Model selector */
        .model-selector {
            padding: 8px 16px;
            border-top: 1px solid var(--border);
            background: var(--bg-secondary);
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
        }

        .model-label {
            color: var(--fg-muted);
        }

        .model-name {
            color: var(--fg);
            background: var(--bg-tertiary);
            padding: 4px 8px;
            border-radius: 4px;
        }

        /* Right panel - Agent Activity */
        .activity-panel {
            width: 400px;
            min-width: 300px;
            display: flex;
            flex-direction: column;
            background: var(--bg-secondary);
            height: 100%;
            overflow: hidden;
        }

        .activity-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .activity-icon {
            font-size: 16px;
        }

        .activity-title {
            font-weight: 500;
        }

        .activity-close {
            margin-left: auto;
            background: none;
            border: none;
            color: var(--fg-muted);
            cursor: pointer;
            font-size: 16px;
        }

        /* Status display */
        .status-display {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px;
            text-align: center;
        }

        .status-animation {
            font-size: 48px;
            color: var(--fg-muted);
            margin-bottom: 24px;
            animation: bounce 1.5s ease-in-out infinite;
        }

        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }

        .status-text {
            font-size: 16px;
            color: var(--fg);
            margin-bottom: 24px;
        }

        /* Terminal command card */
        .terminal-card {
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            width: 100%;
            max-width: 350px;
            overflow: hidden;
        }

        .terminal-header {
            padding: 10px 14px;
            background: var(--bg-tertiary);
            font-family: 'Cascadia Code', monospace;
            font-size: 12px;
            color: var(--fg-muted);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .terminal-path {
            color: var(--success);
        }

        .terminal-command {
            padding: 12px 14px;
            font-family: 'Cascadia Code', monospace;
            font-size: 13px;
            color: var(--fg);
        }

        .terminal-footer {
            padding: 10px 14px;
            border-top: 1px solid var(--border);
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 12px;
        }

        .terminal-status {
            display: flex;
            align-items: center;
            gap: 6px;
            color: var(--warning);
        }

        .terminal-status-dot {
            width: 6px;
            height: 6px;
            background: var(--warning);
            border-radius: 50%;
            animation: pulse 1s infinite;
        }

        .terminal-link {
            color: var(--accent);
            text-decoration: none;
            cursor: pointer;
        }

        .terminal-link:hover {
            text-decoration: underline;
        }

        .terminal-cancel {
            margin-left: auto;
            color: var(--fg-muted);
            cursor: pointer;
        }

        .terminal-cancel:hover {
            color: var(--error);
        }

        /* Empty state */
        .empty-state {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--fg-muted);
            text-align: center;
            padding: 40px;
        }

        .empty-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .empty-title {
            font-size: 16px;
            color: var(--fg);
            margin-bottom: 8px;
        }

        /* Agent buttons row */
        .agent-buttons {
            padding: 12px 16px;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            border-bottom: 1px solid var(--border);
        }

        .agent-btn {
            padding: 6px 14px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-radius: 20px;
            color: var(--fg);
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s;
        }

        .agent-btn:hover {
            background: var(--accent);
            border-color: var(--accent);
            color: white;
        }

        /* Tool output list */
        .tool-list {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }

        .tool-item {
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            margin-bottom: 8px;
            overflow: hidden;
        }

        .tool-item-header {
            padding: 8px 12px;
            background: var(--bg-tertiary);
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
        }

        .tool-item-icon {
            font-size: 14px;
        }

        .tool-item-name {
            font-weight: 500;
        }

        .tool-item-status {
            margin-left: auto;
            font-size: 11px;
        }

        .tool-item-status.success { color: var(--success); }
        .tool-item-status.error { color: var(--error); }

        .tool-item-body {
            padding: 10px 12px;
            font-family: 'Cascadia Code', monospace;
            font-size: 11px;
            max-height: 150px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-all;
            color: #a0a0a0;
        }

        .tool-item-body.error {
            color: #f0a0a0;
        }

        /* Agent Tabs (Top Level) */
        .agent-tabs {
            display: flex;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            height: 32px;
            overflow-x: auto;
        }

        .agent-tab {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 12px;
            background: transparent;
            border: none;
            border-right: 1px solid var(--border);
            color: var(--fg-muted);
            cursor: pointer;
            font-size: 12px;
            white-space: nowrap;
            transition: all 0.15s;
        }

        .agent-tab:hover { background: var(--bg-tertiary); color: var(--fg); }
        .agent-tab.active {
            background: var(--bg);
            color: var(--fg);
            border-bottom: 2px solid var(--accent);
        }

        .agent-tab .status-dot { width: 8px; height: 8px; border-radius: 50%; }
        .agent-tab .status-dot.running { background: var(--success); animation: pulse 1s infinite; }
        .agent-tab .status-dot.completed { background: var(--accent); }
        .agent-tab .status-dot.error { background: var(--error); }
        .agent-tab .status-dot.idle { background: var(--fg-muted); }

        .agent-tab .close-btn {
            opacity: 0;
            margin-left: 4px;
            font-size: 14px;
            padding: 2px 4px;
            border-radius: 3px;
        }
        .agent-tab:hover .close-btn { opacity: 0.7; }
        .agent-tab .close-btn:hover { opacity: 1; background: rgba(241, 76, 76, 0.2); color: var(--error); }

        /* Sub-Tabs (Nested Level) - more subtle */
        .sub-tabs {
            display: none;
            gap: 0;
            padding: 0 12px;
            background: var(--bg);
            border-bottom: 1px solid var(--border);
        }

        .sub-tabs.visible { display: flex; }

        .sub-tab {
            padding: 8px 16px;
            font-size: 11px;
            color: var(--fg-muted);
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .sub-tab:hover { color: var(--fg); background: var(--bg-tertiary); }
        .sub-tab.active {
            color: var(--fg);
            border-bottom-color: var(--accent);
        }

        .sub-tab-badge {
            font-size: 10px;
            padding: 1px 5px;
            min-width: 16px;
            text-align: center;
            border-radius: 8px;
            background: var(--accent);
            color: white;
        }

        /* View containers */
        .view-container {
            display: none;
            flex: 1;
            overflow: hidden;
            min-height: 0;
            height: 100%;
        }
        .view-container.active {
            display: flex;
            flex-direction: row;
        }

        /* Chat view specifically needs row layout for chat + activity panels */
        #view-chat.active {
            display: flex;
            flex-direction: row;
        }

        /* Other views use column layout */
        #view-tools.active,
        #view-artifacts.active,
        #view-analysis.active {
            display: flex;
            flex-direction: column;
        }

        /* Stat cards for Analysis view */
        .stat-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            padding: 12px;
            border-radius: 6px;
        }

        .stat-label {
            font-size: 11px;
            color: var(--fg-muted);
            margin-bottom: 4px;
        }

        .stat-value {
            font-size: 18px;
            font-weight: 500;
            color: var(--fg);
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--border);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--fg-muted);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">
            <span>🚀</span>
            <span>Liftoff</span>
        </div>
        <div class="header-divider"></div>
        <span class="session-name" id="sessionName">No active agent</span>
        <div class="header-actions">
            <button class="btn btn-danger" id="stopBtn" style="display: none;" onclick="stopAgent()">
                ⬛ Stop
            </button>
        </div>
    </div>

    <div class="agent-buttons">
        <button class="agent-btn" onclick="spawn('testing')">🧪 Testing</button>
        <button class="agent-btn" onclick="spawn('frontend')">🎨 Frontend</button>
        <button class="agent-btn" onclick="spawn('backend')">⚙️ Backend</button>
        <button class="agent-btn" onclick="spawn('browser')">🌐 Browser</button>
        <button class="agent-btn" onclick="spawn('cleaner')">🧹 Cleaner</button>
        <button class="agent-btn" onclick="spawn('general')">🔧 General</button>
    </div>

    <!-- Agent Tabs (Top Level) -->
    <div class="agent-tabs" id="agentTabs" role="tablist"></div>

    <!-- Sub-Tabs (Nested Level) -->
    <div class="sub-tabs" id="subTabs">
        <button class="sub-tab active" data-view="chat" onclick="selectSubTab('chat')">💬 Chat</button>
        <button class="sub-tab" data-view="tools" onclick="selectSubTab('tools')">🔧 Tools</button>
        <button class="sub-tab" data-view="artifacts" onclick="selectSubTab('artifacts')">📦 Artifacts</button>
        <button class="sub-tab" data-view="analysis" onclick="selectSubTab('analysis')">📊 Analysis</button>
    </div>

    <div class="main">
        <!-- Chat View -->
        <div class="view-container active" id="view-chat">
            <div class="chat-panel">
                <div class="chat-scroll" id="chatScroll">
                    <div class="empty-state" id="emptyChat">
                        <div class="empty-icon">💬</div>
                        <div class="empty-title">No Agent Running</div>
                        <div>Click an agent button above to start</div>
                    </div>
                </div>

                <div class="chat-input" id="chatInputArea" style="display: none;">
                    <div class="input-container">
                        <input type="text" id="messageInput" placeholder="Ask anything, @ for context" />
                        <span class="input-hint">↵</span>
                    </div>
                </div>

                <div class="model-selector" id="modelSelector" style="display: none;">
                    <span class="model-label">+</span>
                    <span class="model-label">∧ Fast</span>
                    <span class="model-label">∧</span>
                    <span class="model-name" id="modelName">Qwen3-235B</span>
                </div>
            </div>

            <div class="activity-panel">
                <div class="activity-header">
                    <span class="activity-icon">⚡</span>
                    <span class="activity-title">Following Agent</span>
                    <button class="activity-close">×</button>
                </div>

                <div id="activityContent">
                    <div class="status-display" id="idleStatus">
                        <div class="empty-icon">🤖</div>
                        <div class="status-text">No agent activity</div>
                    </div>
                </div>

                <div class="tool-list" id="toolList" style="display: none;"></div>
            </div>
        </div>

        <!-- Tools View -->
        <div class="view-container" id="view-tools">
            <div class="empty-state">
                <div class="empty-icon">🔧</div>
                <div class="empty-title">No Tool Calls Yet</div>
                <div>Tool executions will appear here</div>
            </div>
        </div>

        <!-- Artifacts View -->
        <div class="view-container" id="view-artifacts">
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div class="empty-title">No Artifacts Yet</div>
                <div>Code snippets and files will appear here</div>
            </div>
        </div>

        <!-- Analysis View -->
        <div class="view-container" id="view-analysis">
            <div class="empty-state">
                <div class="empty-icon">📊</div>
                <div class="empty-title">No Analysis Data</div>
                <div>Agent statistics will appear here</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        let agents = [];
        let activeAgentId = null;
        let activeSubTab = 'chat';  // Track which sub-tab is active
        let chatHistory = {};
        let toolHistory = {};
        let currentCommand = null;
        let agentStatus = 'idle';

        function spawn(type) {
            vscode.postMessage({ command: 'spawn', type });
        }

        function stopAgent() {
            if (activeAgentId) {
                vscode.postMessage({ command: 'stop', id: activeAgentId });
            }
        }

        // === TAB MANAGEMENT FUNCTIONS ===

        function selectAgent(agentId) {
            activeAgentId = agentId;
            activeSubTab = 'chat';  // Reset to chat when switching agents
            renderAgentTabs();
            renderSubTabs();
            renderActiveView();
            updateUI();
        }

        function selectSubTab(view) {
            activeSubTab = view;
            document.querySelectorAll('.sub-tab').forEach(t =>
                t.classList.toggle('active', t.dataset.view === view));
            renderActiveView();
        }

        function closeAgent(agentId, event) {
            if (event) event.stopPropagation();
            vscode.postMessage({ command: 'stop', id: agentId });
            if (activeAgentId === agentId) {
                const remaining = agents.filter(a => a.id !== agentId);
                activeAgentId = remaining.length > 0 ? remaining[0].id : null;
            }
            renderAgentTabs();
            renderSubTabs();
            renderActiveView();
        }

        function renderAgentTabs() {
            const container = document.getElementById('agentTabs');
            const subTabs = document.getElementById('subTabs');

            if (agents.length === 0) {
                container.innerHTML = '';
                subTabs.classList.remove('visible');
                return;
            }

            subTabs.classList.add('visible');
            container.innerHTML = agents.map(a =>
                '<div class="agent-tab ' + (a.id === activeAgentId ? 'active' : '') + '" onclick="selectAgent(\\'' + a.id + '\\')">' +
                '<span class="status-dot ' + a.status + '"></span>' +
                '<span>' + escapeHtml(a.name) + '</span>' +
                '<span class="close-btn" onclick="closeAgent(\\'' + a.id + '\\', event)">×</span>' +
                '</div>'
            ).join('');
        }

        function renderSubTabs() {
            document.querySelectorAll('.sub-tab').forEach(t =>
                t.classList.toggle('active', t.dataset.view === activeSubTab));
        }

        function renderActiveView() {
            document.querySelectorAll('.view-container').forEach(v =>
                v.classList.toggle('active', v.id === 'view-' + activeSubTab));

            switch(activeSubTab) {
                case 'chat':
                    renderChat();
                    renderActivityPanel();
                    break;
                case 'tools':
                    renderToolsView();
                    break;
                case 'artifacts':
                    renderArtifactsView();
                    break;
                case 'analysis':
                    renderAnalysisView();
                    break;
            }
        }

        function renderToolsView() {
            const container = document.getElementById('view-tools');
            const tools = toolHistory[activeAgentId] || [];

            if (tools.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔧</div><div class="empty-title">No Tool Calls Yet</div><div>Tool executions will appear here</div></div>';
                return;
            }

            container.innerHTML = '<div class="tool-list" style="display:block;flex:1;overflow-y:auto;">' +
                tools.slice(-30).map(t =>
                    '<div class="tool-item">' +
                    '<div class="tool-item-header">' +
                    '<span class="tool-item-icon">' + (t.success ? '✅' : '❌') + '</span>' +
                    '<span class="tool-item-name">' + escapeHtml(t.name) + '</span>' +
                    '<span class="tool-item-status ' + (t.success ? 'success' : 'error') + '">' + (t.success ? 'Success' : 'Failed') + '</span>' +
                    '</div>' +
                    '<div class="tool-item-body ' + (t.success ? '' : 'error') + '">' + escapeHtml((t.output || '').substring(0, 500)) + '</div>' +
                    '</div>'
                ).join('') + '</div>';
        }

        function renderArtifactsView() {
            const container = document.getElementById('view-artifacts');
            const agent = agents.find(a => a.id === activeAgentId);
            const artifacts = agent?.artifacts || [];

            if (!artifacts || artifacts.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-title">No Artifacts Yet</div><div>Code snippets and files will appear here</div></div>';
                return;
            }

            container.innerHTML = '<div style="padding:12px;overflow-y:auto;flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;align-content:start;">' +
                artifacts.map(a =>
                    '<div style="background:var(--bg-secondary);border:1px solid var(--border);padding:12px;border-radius:6px;">' +
                    '<div style="font-size:11px;color:var(--fg-muted);margin-bottom:8px;">' + (a.language || a.type || 'code') + '</div>' +
                    '<pre style="font-size:11px;max-height:150px;overflow:auto;margin:0;">' + escapeHtml((a.content || '').substring(0, 500)) + '</pre>' +
                    '</div>'
                ).join('') + '</div>';
        }

        function renderAnalysisView() {
            const container = document.getElementById('view-analysis');
            const agent = agents.find(a => a.id === activeAgentId);
            const tools = toolHistory[activeAgentId] || [];

            if (!agent) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No Analysis Data</div><div>Select an agent to view statistics</div></div>';
                return;
            }

            const successRate = tools.length > 0
                ? Math.round(tools.filter(t => t.success).length / tools.length * 100)
                : 0;

            container.innerHTML =
                '<div style="padding:16px;overflow-y:auto;flex:1;">' +
                '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px;">' +
                '<div class="stat-card"><div class="stat-label">Status</div><div class="stat-value">' + (agent.status || 'N/A') + '</div></div>' +
                '<div class="stat-card"><div class="stat-label">Tool Calls</div><div class="stat-value">' + tools.length + '</div></div>' +
                '<div class="stat-card"><div class="stat-label">Success Rate</div><div class="stat-value">' + successRate + '%</div></div>' +
                '<div class="stat-card"><div class="stat-label">Iterations</div><div class="stat-value">' + (agent.iterations || 0) + '</div></div>' +
                '</div>' +
                '<div class="stat-card"><div class="stat-label">Task</div><div style="margin-top:8px;line-height:1.5;">' + escapeHtml(agent.task || 'N/A') + '</div></div>' +
                '<div class="stat-card" style="margin-top:12px;"><div class="stat-label">Agent Type</div><div style="margin-top:8px;">' + (agent.type || 'N/A') + '</div></div>' +
                '</div>';
        }

        function sendMessage() {
            const input = document.getElementById('messageInput');
            const text = input?.value?.trim();
            if (!text || !activeAgentId) return;

            addChatMessage(activeAgentId, text, 'user');
            vscode.postMessage({ command: 'chat', id: activeAgentId, text });
            input.value = '';
        }

        function openTerminal() {
            vscode.postMessage({ command: 'openTerminal' });
        }

        function renderChat() {
            const container = document.getElementById('chatScroll');
            const emptyChat = document.getElementById('emptyChat');

            if (!activeAgentId) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">No Agent Running</div><div>Click an agent button above to start</div></div>';
                return;
            }

            const messages = chatHistory[activeAgentId] || [];

            if (messages.length === 0) {
                container.innerHTML = '<div class="generating"><div class="generating-dot"></div>Starting agent...</div>';
                return;
            }

            container.innerHTML = messages.map(m => renderMessage(m)).join('');

            // Add generating indicator if running
            if (agentStatus === 'running') {
                container.innerHTML += '<div class="generating"><div class="generating-dot"></div>Generating...</div>';
            }

            // Scroll to bottom after DOM update
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 10);
        }

        function renderMessage(msg) {
            if (msg.type === 'user') {
                return '<div class="msg msg-user">' + escapeHtml(msg.content) + '</div>';
            }

            if (msg.type === 'task') {
                return '<div class="msg msg-task">' + escapeHtml(msg.content) + '</div>';
            }

            if (msg.type === 'tool') {
                return renderToolCard(msg.content);
            }

            // Render thought with markdown
            return '<div class="msg msg-thought">' + renderMarkdown(msg.content) + '</div>';
        }

        function renderToolCard(content) {
            // Parse tool info from content
            const match = content.match(/^🔧\\s*(\\w+)(?:\\s+(.*))?$/);
            if (!match) return '<div class="msg msg-thought">' + escapeHtml(content) + '</div>';

            const toolName = match[1];
            const params = match[2] || '';

            // File analysis card
            if (toolName === 'read_file' || toolName === 'Analyzed') {
                const fileMatch = params.match(/([\\w./\\-_]+\\.\\w+)(?:#L(\\d+)-(\\d+))?/);
                if (fileMatch) {
                    const ext = fileMatch[1].split('.').pop();
                    return '<div class="analysis-card"><div class="analysis-header">' +
                        '<span class="analysis-icon">📄</span>' +
                        '<span class="analysis-type">Analyzed</span>' +
                        '<span class="inline-code">' + ext + '</span>' +
                        '<span class="analysis-file">' + escapeHtml(fileMatch[1]) + '</span>' +
                        (fileMatch[2] ? '<span class="analysis-lines">#L' + fileMatch[2] + '-' + fileMatch[3] + '</span>' : '') +
                        '</div></div>';
                }
            }

            // Search card
            if (toolName === 'search_files' || toolName === 'Searched') {
                return '<div class="search-card">' +
                    '<span class="search-icon">🔍</span>' +
                    '<span class="search-query">Searched ' + escapeHtml(params) + '</span>' +
                    '</div>';
            }

            // Default tool card
            return '<div class="search-card">' +
                '<span class="search-icon">🔧</span>' +
                '<span class="search-query">' + toolName + ' ' + escapeHtml(params) + '</span>' +
                '</div>';
        }

        function renderMarkdown(text) {
            if (!text) return '';

            let html = escapeHtml(text);

            // Code blocks
            html = html.replace(/\`\`\`(\\w+)?\\n([\\s\\S]*?)\`\`\`/g, (m, lang, code) => {
                return '<div class="code-block">' +
                    (lang ? '<div class="code-header">' + lang + '</div>' : '') +
                    '<div class="code-content">' + code + '</div></div>';
            });

            // Inline code
            html = html.replace(/\`([^\`]+)\`/g, '<span class="inline-code">$1</span>');

            // File references with line numbers
            html = html.replace(/([\\w./\\-_]+\\.(ts|js|py|tsx|jsx|json|md|css|html))(?:#L(\\d+)(?:-(\\d+))?)?/g, (m, file, ext, start, end) => {
                return '<span class="analysis-file">' + file + '</span>' +
                    (start ? '<span class="analysis-lines">#L' + start + (end ? '-' + end : '') + '</span>' : '');
            });

            // Convert newlines
            html = html.replace(/\\n/g, '<br>');

            return html;
        }

        function renderActivityPanel() {
            const content = document.getElementById('activityContent');
            const toolList = document.getElementById('toolList');

            if (!activeAgentId || agentStatus === 'idle' || agentStatus === 'completed') {
                content.style.display = 'flex';
                toolList.style.display = 'none';

                if (agentStatus === 'completed') {
                    content.innerHTML = '<div class="status-display"><div class="empty-icon">✅</div><div class="status-text">Task completed</div></div>';
                } else {
                    content.innerHTML = '<div class="status-display"><div class="empty-icon">🤖</div><div class="status-text">No agent activity</div></div>';
                }
                return;
            }

            // Show running status
            if (currentCommand) {
                content.innerHTML = '<div class="status-display">' +
                    '<div class="status-animation">∧</div>' +
                    '<div class="status-text">Agent is running terminal commands</div>' +
                    '<div class="terminal-card">' +
                    '<div class="terminal-header"><span class="terminal-path">...\\\\Project</span> &gt;</div>' +
                    '<div class="terminal-command">' + escapeHtml(currentCommand) + '</div>' +
                    '<div class="terminal-footer">' +
                    '<div class="terminal-status"><div class="terminal-status-dot"></div>Running</div>' +
                    '<span class="terminal-link" onclick="openTerminal()">Open Terminal ↗</span>' +
                    '<span class="terminal-cancel" onclick="stopAgent()">Cancel</span>' +
                    '</div></div></div>';
            } else {
                content.innerHTML = '<div class="status-display">' +
                    '<div class="status-animation">∧</div>' +
                    '<div class="status-text">Agent is thinking...</div></div>';
            }

            // Show tool history
            const tools = toolHistory[activeAgentId] || [];
            if (tools.length > 0) {
                content.style.display = 'none';
                toolList.style.display = 'block';
                toolList.innerHTML = tools.slice(-10).map(t =>
                    '<div class="tool-item">' +
                    '<div class="tool-item-header">' +
                    '<span class="tool-item-icon">' + (t.success ? '✅' : '❌') + '</span>' +
                    '<span class="tool-item-name">' + escapeHtml(t.name) + '</span>' +
                    '<span class="tool-item-status ' + (t.success ? 'success' : 'error') + '">' + (t.success ? 'Success' : 'Failed') + '</span>' +
                    '</div>' +
                    '<div class="tool-item-body ' + (t.success ? '' : 'error') + '">' + escapeHtml(t.output.substring(0, 500)) + '</div>' +
                    '</div>'
                ).join('');
                toolList.scrollTop = toolList.scrollHeight;
            }
        }

        function addChatMessage(agentId, content, type) {
            if (!chatHistory[agentId]) chatHistory[agentId] = [];
            chatHistory[agentId].push({ content, type });
            if (agentId === activeAgentId) renderChat();
        }

        function addToolOutput(agentId, name, output, success) {
            if (!toolHistory[agentId]) toolHistory[agentId] = [];
            toolHistory[agentId].push({ name, output, success });
            if (agentId === activeAgentId) renderActivityPanel();
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function updateUI() {
            const sessionName = document.getElementById('sessionName');
            const stopBtn = document.getElementById('stopBtn');
            const chatInput = document.getElementById('chatInputArea');
            const modelSelector = document.getElementById('modelSelector');

            if (activeAgentId && agents.length > 0) {
                const agent = agents.find(a => a.id === activeAgentId);
                if (agent) {
                    sessionName.textContent = agent.name + ' / ' + agent.task.substring(0, 40);
                    agentStatus = agent.status;

                    stopBtn.style.display = (agent.status === 'running' || agent.status === 'waiting_user') ? 'flex' : 'none';
                    chatInput.style.display = 'block';
                    modelSelector.style.display = 'flex';

                    // Update model name
                    const modelName = document.getElementById('modelName');
                    if (agent.model) {
                        const shortModel = agent.model.split('/').pop().substring(0, 12);
                        modelName.textContent = shortModel;
                    }
                }
            } else {
                sessionName.textContent = 'No active agent';
                stopBtn.style.display = 'none';
                chatInput.style.display = 'none';
                modelSelector.style.display = 'none';
            }

            // Render the nested tabs UI
            renderAgentTabs();
            renderSubTabs();
            renderActiveView();
        }

        window.addEventListener('message', event => {
            const msg = event.data;

            switch (msg.type) {
                case 'agents':
                    agents = msg.agents;

                    agents.forEach(a => {
                        if (!chatHistory[a.id]) {
                            chatHistory[a.id] = [{ content: '📋 Task: ' + a.task, type: 'task' }];
                        }
                        if (!toolHistory[a.id]) toolHistory[a.id] = [];
                    });

                    if (!activeAgentId && agents.length > 0) {
                        activeAgentId = agents[0].id;
                    }

                    updateUI();
                    break;

                case 'output':
                    const { agentId, content, outputType } = msg;
                    if (!agentId || content === undefined) break;

                    if (!activeAgentId) activeAgentId = agentId;
                    if (!chatHistory[agentId]) chatHistory[agentId] = [];
                    if (!toolHistory[agentId]) toolHistory[agentId] = [];

                    if (outputType === 'thought') {
                        const messages = chatHistory[agentId];
                        const last = messages[messages.length - 1];
                        if (last && last.type === 'thought') {
                            last.content += content;
                        } else {
                            messages.push({ content, type: 'thought' });
                        }
                        if (agentId === activeAgentId) renderChat();

                    } else if (outputType === 'tool') {
                        // Extract command for terminal display
                        const cmdMatch = content.match(/run_(?:command|tests).*?"command":\\s*"([^"]+)"/);
                        if (cmdMatch) {
                            currentCommand = cmdMatch[1];
                        }
                        addChatMessage(agentId, content, 'tool');
                        renderActivityPanel();

                    } else if (outputType === 'result') {
                        currentCommand = null;
                        const isError = content.includes('Error:') || content.startsWith('❌');
                        addToolOutput(agentId, 'Result', content, !isError);

                    } else if (outputType === 'error') {
                        currentCommand = null;
                        addChatMessage(agentId, '❌ ' + content, 'error');
                        addToolOutput(agentId, 'Error', content, false);
                    }
                    break;
            }
        });

        document.getElementById('messageInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') sendMessage();
        });

        vscode.postMessage({ command: 'refresh' });
    </script>
</body>
</html>`;
    }
}
