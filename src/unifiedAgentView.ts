import * as vscode from 'vscode';
import { Agent, AgentStatus } from './autonomousAgent';

/**
 * Unified Agent View - Single panel showing ALL agents with tabs
 * Replaces individual AgentViewProvider panels to avoid tab chaos
 */

interface OutputMessage {
    timestamp: string;
    content: string;
    type: 'thought' | 'tool' | 'result' | 'error';
    outputType?: string;
    agentId: string;
}

export class UnifiedAgentView {
    private panel: vscode.WebviewPanel | undefined;
    private disposables: vscode.Disposable[] = [];
    private agents: Map<string, Agent> = new Map();
    private outputBuffers: Map<string, OutputMessage[]> = new Map();
    private activeAgentId: string | null = null;

    constructor(private readonly extensionUri: vscode.Uri) {}

    public show(): void {
        const column = vscode.ViewColumn.Beside;

        if (this.panel) {
            this.panel.reveal(column);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'liftoff.agents',
            '🤖 Liftoff Agents',
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
                    case 'switchAgent':
                        this.activeAgentId = message.agentId;
                        this.sendUpdate();
                        break;
                    case 'stop':
                        vscode.commands.executeCommand('liftoff.stopAgent', message.agentId);
                        break;
                    case 'clear':
                        if (message.agentId) {
                            this.outputBuffers.set(message.agentId, []);
                            this.sendUpdate();
                        }
                        break;
                    case 'copy':
                        vscode.env.clipboard.writeText(message.text);
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    public addAgent(agent: Agent): void {
        this.agents.set(agent.id, agent);
        if (!this.outputBuffers.has(agent.id)) {
            this.outputBuffers.set(agent.id, []);
        }
        // Auto-switch to the newest agent
        this.activeAgentId = agent.id;

        // Ensure panel exists before sending update
        if (!this.panel) {
            this.show();
        }
        this.sendUpdate();
    }

    public updateAgent(agent: Agent): void {
        this.agents.set(agent.id, agent);
        if (this.panel) {
            this.sendUpdate();
        }
    }

    public removeAgent(agentId: string): void {
        this.agents.delete(agentId);
        this.outputBuffers.delete(agentId);

        // Switch to another agent if we removed the active one
        if (this.activeAgentId === agentId) {
            const agentIds = Array.from(this.agents.keys());
            this.activeAgentId = agentIds.length > 0 ? agentIds[0] : null;
        }

        this.sendUpdate();
    }

    public appendOutput(agentId: string, content: string, type: 'thought' | 'tool' | 'result' | 'error' = 'thought'): void {
        if (!this.outputBuffers.has(agentId)) {
            this.outputBuffers.set(agentId, []);
        }

        const buffer = this.outputBuffers.get(agentId)!;
        buffer.push({
            timestamp: new Date().toISOString(),
            content,
            type,
            outputType: type,
            agentId
        });

        // Keep last 500 messages per agent
        if (buffer.length > 500) {
            this.outputBuffers.set(agentId, buffer.slice(-500));
        }

        this.sendUpdate();
    }

    public appendToolExecution(agentId: string, tool: string, params: any, result?: any, error?: any): void {
        this.appendOutput(agentId, JSON.stringify({ tool, params, result, error }), 'tool');
    }

    private sendUpdate(): void {
        if (!this.panel) return;

        const agentData = Array.from(this.agents.values()).map(agent => ({
            id: agent.id,
            name: agent.name,
            type: agent.type,
            status: agent.status,
            task: agent.task,
            iterations: agent.iterations,
            maxIterations: agent.maxIterations || 30,
            startTime: agent.startTime.toISOString(),
            endTime: agent.endTime?.toISOString()
        }));

        this.panel.webview.postMessage({
            type: 'update',
            agents: agentData,
            activeAgentId: this.activeAgentId,
            outputs: Object.fromEntries(this.outputBuffers)
        });
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
    <title>Liftoff Agents</title>
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

        /* Agent Tabs */
        .agent-tabs {
            display: flex;
            gap: 4px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            padding: 8px 12px 0;
            overflow-x: auto;
            flex-shrink: 0;
        }

        .agent-tab {
            padding: 8px 16px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-bottom: none;
            border-radius: var(--radius) var(--radius) 0 0;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            white-space: nowrap;
            transition: all 0.2s;
        }

        .agent-tab:hover {
            background: var(--bg-hover);
        }

        .agent-tab.active {
            background: var(--bg-primary);
            border-color: var(--accent);
        }

        .agent-tab-emoji {
            font-size: 14px;
        }

        .agent-tab-name {
            font-weight: 500;
        }

        .agent-tab-status {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-left: 4px;
        }

        .agent-tab-status.running { background: var(--success); }
        .agent-tab-status.waiting { background: var(--warning); }
        .agent-tab-status.error { background: var(--error); }
        .agent-tab-status.completed { background: var(--info); }

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

        .agent-info {
            flex: 1;
        }

        .agent-name {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .agent-task {
            color: var(--text-secondary);
            font-size: 12px;
        }

        .stats {
            display: flex;
            gap: 20px;
        }

        .stat {
            text-align: right;
        }

        .stat-label {
            color: var(--text-muted);
            font-size: 11px;
            margin-bottom: 2px;
        }

        .stat-value {
            font-family: var(--font-mono);
            font-size: 14px;
            font-weight: 600;
        }

        .status-badge {
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .status-badge.running { background: var(--success); color: #000; }
        .status-badge.waiting { background: var(--warning); color: #000; }
        .status-badge.error { background: var(--error); color: #fff; }
        .status-badge.completed { background: var(--info); color: #000; }

        /* Toolbar */
        .toolbar {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            padding: 12px 20px;
            display: flex;
            gap: 8px;
            align-items: center;
            flex-shrink: 0;
        }

        .filter-group {
            display: flex;
            gap: 4px;
            background: var(--bg-tertiary);
            border-radius: var(--radius);
            padding: 4px;
        }

        .filter-btn {
            padding: 6px 12px;
            background: transparent;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            border-radius: calc(var(--radius) - 2px);
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s;
        }

        .filter-btn:hover {
            background: var(--bg-hover);
            color: var(--text-primary);
        }

        .filter-btn.active {
            background: var(--accent);
            color: #000;
        }

        .btn {
            padding: 6px 12px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            color: var(--text-primary);
            cursor: pointer;
            border-radius: var(--radius);
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s;
        }

        .btn:hover {
            background: var(--bg-hover);
            border-color: var(--accent);
        }

        .btn-danger {
            background: var(--error);
            color: #fff;
            border: none;
        }

        .btn-danger:hover {
            opacity: 0.8;
        }

        /* Console */
        .console-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        }

        .console-line {
            display: flex;
            gap: 12px;
            padding: 8px 0;
            border-bottom: 1px solid var(--bg-tertiary);
        }

        .console-line.hidden {
            display: none;
        }

        .console-timestamp {
            color: var(--text-muted);
            font-family: var(--font-mono);
            font-size: 11px;
            min-width: 80px;
            flex-shrink: 0;
        }

        .console-content {
            flex: 1;
            word-break: break-word;
            font-family: var(--font-mono);
            line-height: 1.5;
        }

        .console-line.thought .console-content {
            color: var(--text-primary);
        }

        .console-line.error .console-content {
            color: var(--error);
        }

        /* Tool Cards */
        .tool-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            margin-bottom: 16px;
            overflow: hidden;
        }

        .tool-card.hidden {
            display: none;
        }

        .tool-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            background: var(--bg-tertiary);
            cursor: pointer;
            user-select: none;
        }

        .tool-header:hover {
            background: var(--bg-hover);
        }

        .tool-icon {
            font-size: 16px;
        }

        .tool-name {
            flex: 1;
            font-weight: 600;
        }

        .tool-chevron {
            color: var(--text-muted);
            transition: transform 0.2s;
        }

        .tool-card.collapsed .tool-chevron {
            transform: rotate(-90deg);
        }

        .tool-body {
            padding: 16px;
        }

        .tool-card.collapsed .tool-body {
            display: none;
        }

        .tool-section {
            margin-bottom: 12px;
        }

        .tool-section:last-child {
            margin-bottom: 0;
        }

        .tool-section-title {
            color: var(--text-secondary);
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .copy-btn {
            padding: 4px 8px;
            background: var(--bg-hover);
            border: 1px solid var(--border);
            color: var(--text-secondary);
            cursor: pointer;
            border-radius: 4px;
            font-size: 10px;
            transition: all 0.2s;
        }

        .copy-btn:hover {
            background: var(--accent);
            color: #000;
            border-color: var(--accent);
        }

        .tool-code {
            background: var(--bg-primary);
            border: 1px solid var(--border);
            border-radius: calc(var(--radius) - 2px);
            padding: 12px;
            font-family: var(--font-mono);
            font-size: 12px;
            overflow-x: auto;
            white-space: pre-wrap;
            word-break: break-all;
        }

        /* Syntax Highlighting */
        .hl-key { color: #79c0ff; }
        .hl-string { color: #a5d6ff; }
        .hl-number { color: #79c0ff; }
        .hl-boolean { color: #ff7b72; }
        .hl-null { color: #ff7b72; }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 20px;
            color: var(--text-muted);
        }

        .empty-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .empty-text {
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="agent-tabs" id="agentTabs"></div>

    <div class="header" id="header" style="display: none;">
        <div class="agent-info">
            <div class="agent-name" id="agentName">No agent selected</div>
            <div class="agent-task" id="agentTask">Idle</div>
        </div>
        <div class="status-badge" id="statusBadge">idle</div>
        <div class="stats">
            <div class="stat">
                <div class="stat-label">Iterations</div>
                <div class="stat-value">
                    <span id="iterations">0</span><span id="maxIterations">/30</span>
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">Elapsed</div>
                <div class="stat-value" id="elapsed">0s</div>
            </div>
        </div>
    </div>

    <div class="toolbar" id="toolbar" style="display: none;">
        <div class="filter-group">
            <button class="filter-btn active" data-filter="all">All</button>
            <button class="filter-btn" data-filter="thought">Thoughts</button>
            <button class="filter-btn" data-filter="tool">Tools</button>
            <button class="filter-btn" data-filter="error">Errors</button>
        </div>
        <button class="btn" onclick="clearConsole()">Clear</button>
        <button class="btn btn-danger" onclick="stopAgent()">Stop Agent</button>
    </div>

    <div class="console-container" id="console">
        <div class="empty-state">
            <div class="empty-icon">🤖</div>
            <div class="empty-text">No agents running. Spawn an agent to see output here.</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        let agents = [];
        let activeAgentId = null;
        let outputs = {};
        let currentFilter = 'all';
        let elapsedInterval = null;

        // Filter handling
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                applyFilter();
            });
        });

        function applyFilter() {
            const console = document.getElementById('console');
            const items = console.children;

            for (let item of items) {
                if (currentFilter === 'all') {
                    item.classList.remove('hidden');
                } else if (item.classList.contains('console-line')) {
                    if (item.classList.contains(currentFilter)) {
                        item.classList.remove('hidden');
                    } else {
                        item.classList.add('hidden');
                    }
                } else if (item.classList.contains('tool-card')) {
                    if (currentFilter === 'tool') {
                        item.classList.remove('hidden');
                    } else {
                        item.classList.add('hidden');
                    }
                }
            }
        }

        function switchAgent(agentId) {
            activeAgentId = agentId;
            vscode.postMessage({ command: 'switchAgent', agentId });
            renderActiveAgent();
        }

        function renderTabs() {
            const tabsContainer = document.getElementById('agentTabs');
            tabsContainer.innerHTML = '';

            agents.forEach(agent => {
                const tab = document.createElement('div');
                tab.className = 'agent-tab' + (agent.id === activeAgentId ? ' active' : '');
                tab.onclick = () => switchAgent(agent.id);

                const emoji = getAgentEmoji(agent.type);
                const statusDot = document.createElement('div');
                statusDot.className = 'agent-tab-status ' + agent.status;

                tab.innerHTML = '<span class="agent-tab-emoji">' + emoji + '</span>' +
                                '<span class="agent-tab-name">' + agent.name + '</span>';
                tab.appendChild(statusDot);

                tabsContainer.appendChild(tab);
            });
        }

        function renderActiveAgent() {
            const agent = agents.find(a => a.id === activeAgentId);

            if (!agent) {
                document.getElementById('header').style.display = 'none';
                document.getElementById('toolbar').style.display = 'none';
                document.getElementById('console').innerHTML = '<div class="empty-state"><div class="empty-icon">🤖</div><div class="empty-text">No agents running.</div></div>';
                return;
            }

            document.getElementById('header').style.display = 'flex';
            document.getElementById('toolbar').style.display = 'flex';

            document.getElementById('agentName').textContent = agent.name;
            document.getElementById('agentTask').textContent = agent.task || 'No task';

            const statusBadge = document.getElementById('statusBadge');
            statusBadge.textContent = agent.status;
            statusBadge.className = 'status-badge ' + agent.status;

            document.getElementById('iterations').textContent = agent.iterations || 0;
            document.getElementById('maxIterations').textContent = '/ ' + (agent.maxIterations || 30);

            // Render output
            const console = document.getElementById('console');
            console.innerHTML = '';

            const agentOutputs = outputs[agent.id] || [];
            if (agentOutputs.length === 0) {
                console.innerHTML = '<div class="empty-state"><div class="empty-icon">🚀</div><div class="empty-text">Waiting for agent output...</div></div>';
            } else {
                agentOutputs.forEach(msg => appendOutput(msg));
            }

            if (agent.status === 'running' && !elapsedInterval) {
                elapsedInterval = setInterval(() => updateElapsed(agent), 1000);
            } else if (agent.status !== 'running' && elapsedInterval) {
                clearInterval(elapsedInterval);
                elapsedInterval = null;
            }

            updateElapsed(agent);
        }

        function updateElapsed(agent) {
            const startTime = new Date(agent.startTime);
            const endTime = agent.endTime ? new Date(agent.endTime) : new Date();
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

            if (msg.type === 'tool') {
                appendToolExecution(msg);
                return;
            }

            // For streaming thoughts, append to the last line if it's the same type
            const lastLine = console.lastElementChild;
            const isSameType = lastLine && lastLine.classList.contains('console-line') &&
                               lastLine.classList.contains(msg.type);

            if (isSameType && msg.type === 'thought') {
                const content = lastLine.querySelector('.console-content');
                if (content) {
                    content.textContent += msg.content;
                    console.scrollTop = console.scrollHeight;
                    return;
                }
            }

            // Create new line
            const line = document.createElement('div');
            line.className = 'console-line ' + msg.type;

            const timestamp = document.createElement('div');
            timestamp.className = 'console-timestamp';
            timestamp.textContent = new Date(msg.timestamp).toLocaleTimeString();

            const content = document.createElement('div');
            content.className = 'console-content';
            content.textContent = msg.content;

            line.appendChild(timestamp);
            line.appendChild(content);
            console.appendChild(line);

            applyFilter();
            console.scrollTop = console.scrollHeight;
        }

        function appendToolExecution(msg) {
            const console = document.getElementById('console');
            const emptyState = console.querySelector('.empty-state');
            if (emptyState) emptyState.remove();

            const data = JSON.parse(msg.content);
            const card = document.createElement('div');
            card.className = 'tool-card';

            let html = '<div class="tool-header" onclick="toggleToolCard(this)">';
            html += '<span class="tool-icon">🔧</span>';
            html += '<span class="tool-name">' + escapeHtml(data.tool) + '</span>';
            html += '<span class="tool-chevron">▼</span>';
            html += '</div>';
            html += '<div class="tool-body">';

            if (data.params && Object.keys(data.params).length > 0) {
                const paramsJson = JSON.stringify(data.params, null, 2);
                html += '<div class="tool-section">';
                html += '<div class="tool-section-title">';
                html += 'Parameters';
                html += '<button class="copy-btn" onclick="copyToClipboard(event, ' + escapeHtml(JSON.stringify(paramsJson)) + ')">Copy</button>';
                html += '</div>';
                html += '<div class="tool-code">' + highlightJson(paramsJson) + '</div>';
                html += '</div>';
            }

            if (data.result) {
                const resultJson = JSON.stringify(data.result, null, 2);
                html += '<div class="tool-section">';
                html += '<div class="tool-section-title">';
                html += 'Result';
                html += '<button class="copy-btn" onclick="copyToClipboard(event, ' + escapeHtml(JSON.stringify(resultJson)) + ')">Copy</button>';
                html += '</div>';
                html += '<div class="tool-code">' + highlightJson(resultJson) + '</div>';
                html += '</div>';
            }

            if (data.error) {
                const errorText = typeof data.error === 'string' ? data.error : JSON.stringify(data.error, null, 2);
                html += '<div class="tool-section">';
                html += '<div class="tool-section-title">';
                html += 'Error';
                html += '<button class="copy-btn" onclick="copyToClipboard(event, ' + escapeHtml(JSON.stringify(errorText)) + ')">Copy</button>';
                html += '</div>';
                html += '<div class="tool-code" style="color: var(--error)">' + escapeHtml(errorText) + '</div>';
                html += '</div>';
            }

            html += '</div>';
            card.innerHTML = html;
            console.appendChild(card);

            applyFilter();
            console.scrollTop = console.scrollHeight;
        }

        function toggleToolCard(header) {
            const card = header.parentElement;
            card.classList.toggle('collapsed');
        }

        function highlightJson(json) {
            return json
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"([^"]+)":/g, '<span class="hl-key">"$1"</span>:')
                .replace(/: "([^"]*)"/g, ': <span class="hl-string">"$1"</span>')
                .replace(/: (-?\d+\.?\d*)/g, ': <span class="hl-number">$1</span>')
                .replace(/: (true|false)/g, ': <span class="hl-boolean">$1</span>')
                .replace(/: null/g, ': <span class="hl-null">null</span>');
        }

        function copyToClipboard(event, text) {
            event.stopPropagation();
            const unescaped = JSON.parse(text);
            vscode.postMessage({ command: 'copy', text: unescaped });

            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
                btn.textContent = originalText;
            }, 2000);
        }

        function escapeHtml(text) {
            if (typeof text !== 'string') return String(text);
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function clearConsole() {
            if (activeAgentId) {
                vscode.postMessage({ command: 'clear', agentId: activeAgentId });
            }
        }

        function stopAgent() {
            if (activeAgentId) {
                vscode.postMessage({ command: 'stop', agentId: activeAgentId });
            }
        }

        function getAgentEmoji(type) {
            const emojis = {
                frontend: '🎨',
                backend: '⚙️',
                testing: '🧪',
                browser: '🌐',
                general: '🔧',
                cleaner: '🧹'
            };
            return emojis[type] || '🤖';
        }

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'update':
                    agents = message.agents || [];
                    activeAgentId = message.activeAgentId;
                    outputs = message.outputs || {};
                    renderTabs();
                    renderActiveAgent();
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
