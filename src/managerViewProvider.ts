import * as vscode from 'vscode';
import { IAgentManager, IAgent, AgentOutputEvent } from './types';

/**
 * Manager View Provider - Sidebar panel for quick agent management
 * Redesigned with modern dark theme matching the editor panel
 */
export class ManagerViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];
    
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly agentManager: IAgentManager
    ) {
        this._disposables.push(
            agentManager.on('agentSpawned', () => this.updateView()),
            agentManager.on('statusChange', () => this.updateView()),
            agentManager.on('output', (data: AgentOutputEvent) => this.sendOutput(data))
        );
    }
    
    dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
    
    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();
        
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'spawn':
                    const task = await vscode.window.showInputBox({
                        prompt: `What should the ${msg.type} agent do?`,
                        placeHolder: 'e.g., Run tests and fix failures'
                    });
                    if (task) {
                        try {
                            await this.agentManager.spawnAgent({ type: msg.type, task });
                            this.updateView();
                        } catch (e: any) {
                            vscode.window.showErrorMessage(e.message);
                        }
                    }
                    break;
                case 'stop':
                    this.agentManager.killAgent(msg.id);
                    this.updateView();
                    break;
                case 'stopAll':
                    this.agentManager.stopAllAgents();
                    this.updateView();
                    break;
                case 'remove':
                    this.agentManager.removeAgent(msg.id);
                    this.updateView();
                    break;
                case 'chat':
                    await this.agentManager.continueAgent(msg.id, msg.text);
                    break;
                case 'refresh':
                    this.updateView();
                    break;
                case 'openPanel':
                    vscode.commands.executeCommand('liftoff.openManager');
                    break;
            }
        });
    }

    private updateView(): void {
        if (this._view) {
            const allAgents = this.agentManager.getAllAgents();
            const agents = allAgents.map((a: IAgent) => ({
                id: a.id, name: a.name, status: a.status, task: a.task, iterations: a.iterations, type: a.type
            }));

            // Debug logging
            console.log(`[ManagerView] Updating with ${agents.length} agents:`,
                agents.map(a => `${a.name} (${a.status})`).join(', '));

            this._view.webview.postMessage({ type: 'agents', agents });
        }
    }
    
    private sendOutput(data: AgentOutputEvent): void {
        if (this._view) {
            this._view.webview.postMessage({ 
                type: 'output', 
                agentId: data.agentId,
                content: data.content,
                outputType: data.type
            });
        }
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
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
        --accent-muted: rgba(88, 166, 255, 0.15);
        --success: #3fb950;
        --error: #f85149;
        --warning: #d29922;
        --radius: 6px;
        --font-mono: 'Cascadia Code', Consolas, monospace;
    }
    
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 12px;
        color: var(--text-primary);
        background: var(--bg-primary);
        height: 100vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    /* Header */
    .header {
        padding: 12px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .header-title {
        font-weight: 600;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .open-panel-btn {
        margin-left: auto;
        padding: 4px 8px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: transparent;
        color: var(--text-secondary);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
    }

    .open-panel-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
        border-color: var(--text-muted);
    }

    /* Quick Actions */
    .quick-actions {
        padding: 10px 12px;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        border-bottom: 1px solid var(--border);
    }

    .quick-btn {
        padding: 8px 6px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        color: var(--text-secondary);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
    }

    .quick-btn:hover {
        background: var(--accent);
        border-color: var(--accent);
        color: white;
    }

    .quick-btn-icon {
        font-size: 16px;
    }

    /* Agent List */
    .agents-section {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
    }

    .section-title {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
        padding: 8px 4px;
    }

    .agent-card {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        margin-bottom: 8px;
        overflow: hidden;
        transition: all 0.15s;
    }

    .agent-card:hover {
        border-color: var(--text-muted);
    }

    .agent-card.running {
        border-left: 3px solid var(--success);
    }

    .agent-card.error {
        border-left: 3px solid var(--error);
    }

    .agent-card.completed {
        border-left: 3px solid var(--accent);
    }

    .agent-header {
        padding: 10px 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
    }

    .agent-icon {
        font-size: 16px;
    }

    .agent-info {
        flex: 1;
        min-width: 0;
    }

    .agent-name {
        font-weight: 500;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--text-muted);
    }

    .status-dot.running {
        background: var(--success);
        animation: pulse 2s infinite;
    }

    .status-dot.completed { background: var(--accent); }
    .status-dot.error { background: var(--error); }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }

    .agent-task {
        font-size: 11px;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
    }

    .agent-actions {
        display: flex;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.15s;
    }

    .agent-card:hover .agent-actions {
        opacity: 1;
    }

    .action-btn {
        padding: 4px 6px;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-secondary);
        font-size: 10px;
        cursor: pointer;
        transition: all 0.15s;
    }

    .action-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .action-btn.danger:hover {
        background: rgba(248, 81, 73, 0.15);
        color: var(--error);
        border-color: var(--error);
    }

    /* Agent Details (expanded) */
    .agent-details {
        display: none;
        padding: 8px 12px;
        border-top: 1px solid var(--border);
        background: var(--bg-tertiary);
    }

    .agent-card.expanded .agent-details {
        display: block;
    }

    .agent-chat {
        max-height: 150px;
        overflow-y: auto;
        font-size: 11px;
        margin-bottom: 8px;
    }

    .chat-msg {
        padding: 4px 8px;
        margin-bottom: 4px;
        border-radius: 4px;
        background: var(--bg-primary);
    }

    .chat-msg.thought {
        color: var(--text-secondary);
    }

    .chat-msg.error {
        background: rgba(248, 81, 73, 0.1);
        color: #ffa198;
    }

    .chat-input-row {
        display: flex;
        gap: 6px;
    }

    .chat-input {
        flex: 1;
        padding: 6px 8px;
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 11px;
        outline: none;
    }

    .chat-input:focus {
        border-color: var(--accent);
    }

    .send-btn {
        padding: 6px 10px;
        background: var(--accent);
        border: none;
        border-radius: 4px;
        color: white;
        font-size: 11px;
        cursor: pointer;
    }

    .send-btn:hover {
        background: var(--accent-hover);
    }

    /* Stats */
    .stats {
        padding: 8px 12px;
        border-top: 1px solid var(--border);
        display: flex;
        gap: 12px;
        font-size: 10px;
        color: var(--text-muted);
    }

    .stat-value {
        color: var(--text-secondary);
        font-weight: 500;
    }

    /* Empty State */
    .empty-state {
        padding: 32px 16px;
        text-align: center;
        color: var(--text-muted);
    }

    .empty-icon {
        font-size: 32px;
        margin-bottom: 12px;
        opacity: 0.5;
    }

    .empty-title {
        font-size: 13px;
        color: var(--text-secondary);
        margin-bottom: 4px;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
</style>
</head>
<body>
    <div class="header">
        <div class="header-title">
            <span>🚀</span>
            <span>Liftoff</span>
        </div>
        <button class="open-panel-btn" onclick="openPanel()">Open Panel ↗</button>
    </div>

    <div class="quick-actions">
        <button class="quick-btn" onclick="spawn('testing')">
            <span class="quick-btn-icon">🧪</span>
            <span>Test</span>
        </button>
        <button class="quick-btn" onclick="spawn('frontend')">
            <span class="quick-btn-icon">🎨</span>
            <span>Frontend</span>
        </button>
        <button class="quick-btn" onclick="spawn('backend')">
            <span class="quick-btn-icon">⚙️</span>
            <span>Backend</span>
        </button>
        <button class="quick-btn" onclick="spawn('browser')">
            <span class="quick-btn-icon">🌐</span>
            <span>Browser</span>
        </button>
        <button class="quick-btn" onclick="spawn('cleaner')">
            <span class="quick-btn-icon">🧹</span>
            <span>Clean</span>
        </button>
        <button class="quick-btn" onclick="spawn('general')">
            <span class="quick-btn-icon">🔧</span>
            <span>General</span>
        </button>
    </div>

    <div class="agents-section" id="agentsSection">
        <div class="empty-state" id="emptyState">
            <div class="empty-icon">🤖</div>
            <div class="empty-title">No Active Agents</div>
            <div>Click a button above to spawn an agent</div>
        </div>
        <div id="agentsList"></div>
    </div>

    <div class="stats" id="statsBar">
        <span>Active: <span class="stat-value" id="statActive">0</span></span>
        <span>Total: <span class="stat-value" id="statTotal">0</span></span>
    </div>

<script>
const vscode = acquireVsCodeApi();
let agents = [];
let chatHistory = {};
let expandedAgent = null;

const agentEmojis = {
    testing: '🧪', frontend: '🎨', backend: '⚙️',
    browser: '🌐', cleaner: '🧹', general: '🔧'
};

function spawn(type) { vscode.postMessage({ command: 'spawn', type }); }
function stop(id) { vscode.postMessage({ command: 'stop', id }); }
function remove(id) { vscode.postMessage({ command: 'remove', id }); }
function openPanel() { vscode.postMessage({ command: 'openPanel' }); }

function toggleAgent(id) {
    expandedAgent = expandedAgent === id ? null : id;
    render();
}

function send(id) {
    const input = document.getElementById('input-' + id);
    if (input && input.value.trim()) {
        vscode.postMessage({ command: 'chat', id, text: input.value });
        input.value = '';
    }
}

function render() {
    const list = document.getElementById('agentsList');
    const empty = document.getElementById('emptyState');
    
    if (agents.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    
    empty.style.display = 'none';
    
    list.innerHTML = agents.map(a => {
        const emoji = agentEmojis[a.type] || '🔧';
        const expanded = expandedAgent === a.id;
        const messages = chatHistory[a.id] || [];
        
        return '<div class="agent-card ' + a.status + (expanded ? ' expanded' : '') + '">' +
            '<div class="agent-header" onclick="toggleAgent(\\'' + a.id + '\\')">' +
                '<span class="agent-icon">' + emoji + '</span>' +
                '<div class="agent-info">' +
                    '<div class="agent-name">' +
                        '<span class="status-dot ' + a.status + '"></span>' +
                        escapeHtml(a.name) +
                    '</div>' +
                    '<div class="agent-task">' + escapeHtml(a.task) + '</div>' +
                '</div>' +
                '<div class="agent-actions">' +
                    (a.status === 'running' ? '<button class="action-btn danger" onclick="event.stopPropagation();stop(\\'' + a.id + '\\')">Stop</button>' : '') +
                    '<button class="action-btn danger" onclick="event.stopPropagation();remove(\\'' + a.id + '\\')">×</button>' +
                '</div>' +
            '</div>' +
            '<div class="agent-details">' +
                '<div class="agent-chat" id="chat-' + a.id + '">' +
                    messages.slice(-10).map(m => 
                        '<div class="chat-msg ' + (m.type || 'thought') + '">' + escapeHtml(m.content.substring(0, 200)) + '</div>'
                    ).join('') +
                '</div>' +
                '<div class="chat-input-row">' +
                    '<input class="chat-input" id="input-' + a.id + '" placeholder="Message..." onkeydown="if(event.key===\\'Enter\\')send(\\'' + a.id + '\\')">' +
                    '<button class="send-btn" onclick="send(\\'' + a.id + '\\')">Send</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');

    document.getElementById('statActive').textContent = agents.filter(a => a.status === 'running').length;
    document.getElementById('statTotal').textContent = agents.length;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.addEventListener('message', e => {
    const msg = e.data;
    
    if (msg.type === 'agents') {
        agents = msg.agents;
        agents.forEach(a => { if (!chatHistory[a.id]) chatHistory[a.id] = []; });
        render();
    } else if (msg.type === 'output') {
        if (!chatHistory[msg.agentId]) chatHistory[msg.agentId] = [];
        
        if (msg.outputType === 'thought') {
            const last = chatHistory[msg.agentId].slice(-1)[0];
            if (last && last.type === 'thought') {
                last.content += msg.content;
            } else {
                chatHistory[msg.agentId].push({ content: msg.content, type: 'thought' });
            }
        } else {
            chatHistory[msg.agentId].push({ content: msg.content, type: msg.outputType });
        }
        
        if (expandedAgent === msg.agentId) render();
    }
});

vscode.postMessage({ command: 'refresh' });
</script>
</body></html>`;
    }
}
