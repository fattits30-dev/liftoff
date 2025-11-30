import * as vscode from 'vscode';
import { Agent, AgentStatus } from './autonomousAgent';

/**
 * Agent View Provider - Dedicated full-screen panel for each agent
 * Shows real-time output, tool executions, and progress
 */
export class AgentViewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private disposables: vscode.Disposable[] = [];
    private agent: Agent;
    private outputBuffer: OutputMessage[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        agent: Agent
    ) {
        this.agent = agent;
    }

    public show(): void {
        const column = vscode.ViewColumn.Beside;

        if (this.panel) {
            this.panel.reveal(column);
            return;
        }

        const emoji = this.getAgentEmoji(this.agent.type);
        this.panel = vscode.window.createWebviewPanel(
            `liftoff.agent.${this.agent.id}`,
            `${emoji} ${this.agent.name}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.extensionUri]
            }
        );

        this.panel.webview.html = this.getHtml();

        this.panel.onDidDispose(() => {
            this.dispose();
        }, null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'stop':
                        vscode.commands.executeCommand('liftoff.stopAgent', this.agent.id);
                        break;
                    case 'continue':
                        vscode.commands.executeCommand('liftoff.continueAgent', this.agent.id, message.text);
                        break;
                    case 'clear':
                        this.outputBuffer = [];
                        this.sendUpdate();
                        break;
                }
            },
            null,
            this.disposables
        );

        this.sendUpdate();
    }

    public appendOutput(content: string, type: 'thought' | 'tool' | 'result' | 'error' = 'thought'): void {
        this.outputBuffer.push({
            timestamp: new Date().toISOString(),
            content,
            type
        });

        // Keep last 500 messages
        if (this.outputBuffer.length > 500) {
            this.outputBuffer = this.outputBuffer.slice(-500);
        }

        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'output',
                message: {
                    timestamp: new Date().toISOString(),
                    content,
                    outputType: type
                }
            });
        }
    }

    public appendToolExecution(tool: string, params: any, result?: any, error?: string): void {
        const message: ToolExecutionMessage = {
            timestamp: new Date().toISOString(),
            tool,
            params,
            result,
            error
        };

        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'tool',
                message
            });
        }
    }

    public updateAgent(agent: Agent): void {
        this.agent = agent;

        if (this.panel) {
            const emoji = this.getAgentEmoji(agent.type);
            this.panel.title = `${emoji} ${agent.name}`;
            this.sendUpdate();
        }
    }

    private sendUpdate(): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'update',
                agent: {
                    id: this.agent.id,
                    name: this.agent.name,
                    type: this.agent.type,
                    status: this.agent.status,
                    task: this.agent.task,
                    iterations: this.agent.iterations,
                    maxIterations: this.agent.maxIterations || 30,
                    startTime: this.agent.startTime.toISOString(),
                    endTime: this.agent.endTime?.toISOString()
                },
                output: this.outputBuffer
            });
        }
    }

    private getAgentEmoji(type: string): string {
        const emojis: Record<string, string> = {
            frontend: '🎨',
            backend: '⚙️',
            testing: '🧪',
            browser: '🌐',
            general: '🔧',
            cleaner: '🧹'
        };
        return emojis[type] || '🤖';
    }

    public dispose(): void {
        this.panel = undefined;
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agent Monitor</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #21262d;
            --bg-hover: #30363d;
            --border: #30363d;
            --text-primary: #e6edf3;
            --text-secondary: #8b949e;
            --text-muted: #6e7681;
            --accent: #58a6ff;
            --accent-hover: #79c0ff;
            --success: #3fb950;
            --error: #f85149;
            --warning: #d29922;
            --info: #79c0ff;
            --radius: 8px;
            --font-mono: 'Cascadia Code', 'SF Mono', Consolas, monospace;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 13px;
            color: var(--text-primary);
            background: var(--bg-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* Header */
        .header {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            padding: 16px 20px;
            display: flex;
            align-items: center;
            gap: 16px;
            flex-shrink: 0;
        }

        .agent-icon {
            font-size: 32px;
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg-tertiary);
            border-radius: var(--radius);
        }

        .agent-info {
            flex: 1;
            min-width: 0;
        }

        .agent-name {
            font-size: 18px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 4px;
        }

        .status-badge {
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .status-badge.running {
            background: rgba(63, 185, 80, 0.15);
            color: var(--success);
        }

        .status-badge.completed {
            background: rgba(88, 166, 255, 0.15);
            color: var(--info);
        }

        .status-badge.error {
            background: rgba(248, 81, 73, 0.15);
            color: var(--error);
        }

        .status-badge.idle {
            background: rgba(139, 148, 158, 0.15);
            color: var(--text-secondary);
        }

        .agent-task {
            color: var(--text-secondary);
            font-size: 13px;
        }

        .header-actions {
            display: flex;
            gap: 8px;
        }

        .btn {
            padding: 8px 16px;
            border-radius: var(--radius);
            border: 1px solid var(--border);
            background: var(--bg-tertiary);
            color: var(--text-primary);
            font-size: 13px;
            cursor: pointer;
            transition: all 0.15s;
            font-weight: 500;
        }

        .btn:hover {
            background: var(--bg-hover);
            border-color: var(--text-muted);
        }

        .btn-danger {
            border-color: rgba(248, 81, 73, 0.3);
            color: var(--error);
        }

        .btn-danger:hover {
            background: rgba(248, 81, 73, 0.15);
            border-color: var(--error);
        }

        /* Stats Bar */
        .stats-bar {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            padding: 12px 20px;
            display: flex;
            gap: 24px;
            font-size: 12px;
            flex-shrink: 0;
        }

        .stat {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text-secondary);
        }

        .stat-label {
            font-weight: 500;
        }

        .stat-value {
            color: var(--text-primary);
            font-weight: 600;
            font-family: var(--font-mono);
        }

        .progress-bar {
            flex: 1;
            height: 4px;
            background: var(--bg-tertiary);
            border-radius: 2px;
            overflow: hidden;
            margin: 0 12px;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--accent), var(--success));
            transition: width 0.3s ease;
        }

        /* Output Console */
        .console {
            flex: 1;
            overflow-y: auto;
            padding: 16px 20px;
            font-family: var(--font-mono);
            font-size: 12px;
            line-height: 1.6;
        }

        .console-line {
            margin-bottom: 8px;
            padding: 8px 12px;
            border-radius: 6px;
            display: flex;
            gap: 12px;
            animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .console-timestamp {
            color: var(--text-muted);
            font-size: 10px;
            min-width: 80px;
            flex-shrink: 0;
        }

        .console-content {
            flex: 1;
            word-break: break-word;
        }

        .console-line.thought {
            background: var(--bg-secondary);
            color: var(--text-secondary);
        }

        .console-line.tool {
            background: rgba(88, 166, 255, 0.1);
            border-left: 3px solid var(--accent);
        }

        .console-line.result {
            background: rgba(63, 185, 80, 0.1);
            border-left: 3px solid var(--success);
        }

        .console-line.error {
            background: rgba(248, 81, 73, 0.1);
            border-left: 3px solid var(--error);
            color: #ffa198;
        }

        /* Tool Execution Card */
        .tool-card {
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 12px;
            margin-bottom: 12px;
            animation: slideIn 0.3s ease;
        }

        @keyframes slideIn {
            from { opacity: 0; transform: translateX(-8px); }
            to { opacity: 1; transform: translateX(0); }
        }

        .tool-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--accent);
        }

        .tool-icon {
            font-size: 16px;
        }

        .tool-section {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--border);
        }

        .tool-section-title {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
            margin-bottom: 6px;
            font-weight: 600;
        }

        .tool-code {
            background: var(--bg-primary);
            border-radius: 4px;
            padding: 8px;
            font-size: 11px;
            color: var(--text-secondary);
            overflow-x: auto;
            max-height: 200px;
            overflow-y: auto;
        }

        /* Input Box */
        .input-box {
            background: var(--bg-secondary);
            border-top: 1px solid var(--border);
            padding: 16px 20px;
            display: flex;
            gap: 12px;
            flex-shrink: 0;
        }

        .input {
            flex: 1;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 10px 14px;
            color: var(--text-primary);
            font-size: 13px;
            outline: none;
            transition: all 0.15s;
        }

        .input:focus {
            border-color: var(--accent);
            background: var(--bg-hover);
        }

        .input::placeholder {
            color: var(--text-muted);
        }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: var(--bg-primary); }
        ::-webkit-scrollbar-thumb {
            background: var(--bg-tertiary);
            border-radius: 5px;
            border: 2px solid var(--bg-primary);
        }
        ::-webkit-scrollbar-thumb:hover { background: var(--bg-hover); }

        /* Empty State */
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--text-muted);
            gap: 12px;
        }

        .empty-icon {
            font-size: 48px;
            opacity: 0.5;
        }

        .empty-text {
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="agent-icon" id="agentIcon">🤖</div>
        <div class="agent-info">
            <div class="agent-name">
                <span id="agentName">Agent</span>
                <span class="status-badge" id="statusBadge">idle</span>
            </div>
            <div class="agent-task" id="agentTask">No task assigned</div>
        </div>
        <div class="header-actions">
            <button class="btn" onclick="clearConsole()">Clear</button>
            <button class="btn btn-danger" onclick="stopAgent()" id="stopBtn">Stop</button>
        </div>
    </div>

    <div class="stats-bar">
        <div class="stat">
            <span class="stat-label">Iterations:</span>
            <span class="stat-value" id="iterations">0</span>
            <span class="stat-value" id="maxIterations">/ 30</span>
        </div>
        <div class="progress-bar">
            <div class="progress-fill" id="progressFill" style="width: 0%"></div>
        </div>
        <div class="stat">
            <span class="stat-label">Elapsed:</span>
            <span class="stat-value" id="elapsed">0s</span>
        </div>
        <div class="stat">
            <span class="stat-label">Tools:</span>
            <span class="stat-value" id="toolCount">0</span>
        </div>
    </div>

    <div class="console" id="console">
        <div class="empty-state">
            <div class="empty-icon">🚀</div>
            <div class="empty-text">Waiting for agent output...</div>
        </div>
    </div>

    <div class="input-box">
        <input
            type="text"
            class="input"
            id="messageInput"
            placeholder="Send a message to the agent..."
            onkeydown="if(event.key==='Enter') sendMessage()"
        >
        <button class="btn" onclick="sendMessage()">Send</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let agent = null;
        let startTime = null;
        let elapsedInterval = null;
        let toolExecutionCount = 0;

        const agentEmojis = {
            testing: '🧪', frontend: '🎨', backend: '⚙️',
            browser: '🌐', cleaner: '🧹', general: '🔧'
        };

        function updateAgent(data) {
            agent = data;
            startTime = new Date(data.startTime);

            const emoji = agentEmojis[data.type] || '🤖';
            document.getElementById('agentIcon').textContent = emoji;
            document.getElementById('agentName').textContent = data.name;
            document.getElementById('agentTask').textContent = data.task;

            const statusBadge = document.getElementById('statusBadge');
            statusBadge.textContent = data.status;
            statusBadge.className = 'status-badge ' + data.status;

            document.getElementById('iterations').textContent = data.iterations || 0;
            document.getElementById('maxIterations').textContent = '/ ' + (data.maxIterations || 30);

            const progress = ((data.iterations || 0) / (data.maxIterations || 30)) * 100;
            document.getElementById('progressFill').style.width = progress + '%';

            if (data.status === 'running' && !elapsedInterval) {
                elapsedInterval = setInterval(updateElapsed, 1000);
            } else if (data.status !== 'running' && elapsedInterval) {
                clearInterval(elapsedInterval);
                elapsedInterval = null;
            }

            updateElapsed();
        }

        function updateElapsed() {
            if (!startTime) return;
            const endTime = agent?.endTime ? new Date(agent.endTime) : new Date();
            const elapsed = Math.floor((endTime - startTime) / 1000);
            document.getElementById('elapsed').textContent = formatDuration(elapsed);
        }

        function formatDuration(seconds) {
            if (seconds < 60) return seconds + 's';
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return mins + 'm ' + secs + 's';
        }

        function appendOutput(msg) {
            const console = document.getElementById('console');
            const emptyState = console.querySelector('.empty-state');
            if (emptyState) emptyState.remove();

            const line = document.createElement('div');
            line.className = 'console-line ' + (msg.outputType || 'thought');

            const timestamp = document.createElement('div');
            timestamp.className = 'console-timestamp';
            timestamp.textContent = new Date(msg.timestamp).toLocaleTimeString();

            const content = document.createElement('div');
            content.className = 'console-content';
            content.textContent = msg.content;

            line.appendChild(timestamp);
            line.appendChild(content);
            console.appendChild(line);

            console.scrollTop = console.scrollHeight;
        }

        function appendToolExecution(msg) {
            const console = document.getElementById('console');
            const emptyState = console.querySelector('.empty-state');
            if (emptyState) emptyState.remove();

            toolExecutionCount++;
            document.getElementById('toolCount').textContent = toolExecutionCount;

            const card = document.createElement('div');
            card.className = 'tool-card';

            let html = '<div class="tool-header">';
            html += '<span class="tool-icon">🔧</span>';
            html += '<span>' + escapeHtml(msg.tool) + '</span>';
            html += '</div>';

            if (msg.params && Object.keys(msg.params).length > 0) {
                html += '<div class="tool-section">';
                html += '<div class="tool-section-title">Parameters</div>';
                html += '<div class="tool-code">' + escapeHtml(JSON.stringify(msg.params, null, 2)) + '</div>';
                html += '</div>';
            }

            if (msg.result) {
                html += '<div class="tool-section">';
                html += '<div class="tool-section-title">Result</div>';
                html += '<div class="tool-code">' + escapeHtml(JSON.stringify(msg.result, null, 2)) + '</div>';
                html += '</div>';
            }

            if (msg.error) {
                html += '<div class="tool-section">';
                html += '<div class="tool-section-title">Error</div>';
                html += '<div class="tool-code" style="color: var(--error)">' + escapeHtml(msg.error) + '</div>';
                html += '</div>';
            }

            card.innerHTML = html;
            console.appendChild(card);
            console.scrollTop = console.scrollHeight;
        }

        function escapeHtml(text) {
            if (typeof text !== 'string') return String(text);
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function clearConsole() {
            vscode.postMessage({ command: 'clear' });
            document.getElementById('console').innerHTML = '<div class="empty-state"><div class="empty-icon">🚀</div><div class="empty-text">Console cleared</div></div>';
            toolExecutionCount = 0;
            document.getElementById('toolCount').textContent = '0';
        }

        function stopAgent() {
            vscode.postMessage({ command: 'stop' });
        }

        function sendMessage() {
            const input = document.getElementById('messageInput');
            if (input.value.trim()) {
                vscode.postMessage({ command: 'continue', text: input.value });
                input.value = '';
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'update':
                    updateAgent(message.agent);
                    if (message.output && message.output.length > 0) {
                        message.output.forEach(appendOutput);
                    }
                    break;
                case 'output':
                    appendOutput(message.message);
                    break;
                case 'tool':
                    appendToolExecution(message.message);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}

interface OutputMessage {
    timestamp: string;
    content: string;
    type: 'thought' | 'tool' | 'result' | 'error';
}

interface ToolExecutionMessage {
    timestamp: string;
    tool: string;
    params: any;
    result?: any;
    error?: string;
}
