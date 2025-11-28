import * as vscode from 'vscode';

export class ManagerViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly agentManager: any
    ) {
        agentManager.on('agentSpawned', () => this.updateView());
        agentManager.on('statusChange', () => this.updateView());
        agentManager.on('output', (data: any) => this.sendOutput(data));
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
            }
        });
    }

    private updateView(): void {
        if (this._view) {
            const agents = this.agentManager.getAllAgents().map((a: any) => ({
                id: a.id, name: a.name, status: a.status, task: a.task, iterations: a.iterations
            }));
            this._view.webview.postMessage({ type: 'agents', agents });
        }
    }
    
    private sendOutput(data: any): void {
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
body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); height: 100vh; display: flex; flex-direction: column; }

.toolbar { padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 4px; flex-wrap: wrap; }
.btn { padding: 4px 8px; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn-danger { background: #c53030; color: white; }

.tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
.tab { padding: 6px 12px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 12px; display: flex; align-items: center; gap: 6px; }
.tab.active { border-bottom-color: var(--vscode-focusBorder); background: var(--vscode-editor-background); }
.tab .dot { width: 8px; height: 8px; border-radius: 50%; }
.tab .dot.running { background: #48bb78; animation: pulse 1s infinite; }
.tab .dot.stopped, .tab .dot.error { background: #f56565; }
.tab .dot.completed { background: #4299e1; }
.tab .dot.idle { background: #a0aec0; }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }

.panels { flex: 1; overflow: hidden; position: relative; }
.panel { display: none; height: 100%; flex-direction: column; }
.panel.active { display: flex; }

.chat { flex: 1; overflow-y: auto; padding: 12px; }
.msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; max-width: 90%; }
.msg.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-left: auto; }
.msg.thought { background: var(--vscode-editor-inactiveSelectionBackground); white-space: pre-wrap; word-break: break-word; }
.msg.tool { background: #2d3748; color: #68d391; font-family: monospace; font-size: 12px; }
.msg.result { background: #1a365d; color: #90cdf4; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
.msg.error { background: #742a2a; color: #feb2b2; }

.input-row { padding: 8px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 6px; }
.input-row input { flex: 1; padding: 6px 10px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; }
.input-row input:focus { outline: 1px solid var(--vscode-focusBorder); }

.empty { padding: 40px; text-align: center; color: var(--vscode-descriptionForeground); }
.empty h3 { margin-bottom: 12px; }

.agent-header { padding: 8px 12px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
.agent-header .task { color: var(--vscode-descriptionForeground); flex: 1; margin: 0 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>
<div class="toolbar">
    <button class="btn" onclick="spawn('frontend')">🎨 Frontend</button>
    <button class="btn" onclick="spawn('backend')">⚙️ Backend</button>
    <button class="btn" onclick="spawn('testing')">🧪 Testing</button>
    <button class="btn" onclick="spawn('browser')">🌐 Browser</button>
    <button class="btn" onclick="spawn('cleaner')">🧹 Cleaner</button>
    <button class="btn" onclick="spawn('general')">🔧 General</button>
</div>

<div class="tabs" id="tabs"></div>

<div class="panels" id="panels">
    <div class="empty" id="empty">
        <h3>🚀 Liftoff</h3>
        <p>Spawn an agent to get started</p>
    </div>
</div>

<script>
const vscode = acquireVsCodeApi();
let agents = [];
let activeId = null;
let outputs = {};

function spawn(type) { vscode.postMessage({ command: 'spawn', type }); }
function stop(id) { vscode.postMessage({ command: 'stop', id }); }
function remove(id) { vscode.postMessage({ command: 'remove', id }); }

function send(id) {
    const input = document.getElementById('input-' + id);
    if (input && input.value.trim()) {
        vscode.postMessage({ command: 'chat', id, text: input.value });
        input.value = '';
    }
}

function select(id) {
    activeId = id;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.id === id));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + id));
}

function render() {
    const tabsEl = document.getElementById('tabs');
    const panelsEl = document.getElementById('panels');
    const emptyEl = document.getElementById('empty');
    
    if (agents.length === 0) {
        tabsEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    
    tabsEl.innerHTML = agents.map(a => 
        '<div class="tab' + (a.id === activeId ? ' active' : '') + '" data-id="' + a.id + '" onclick="select(\\'' + a.id + '\\')">' +
        '<span class="dot ' + a.status + '"></span>' + a.name +
        '</div>'
    ).join('');
    
    agents.forEach(a => {
        if (!document.getElementById('panel-' + a.id)) {
            outputs[a.id] = outputs[a.id] || [];
            const panel = document.createElement('div');
            panel.id = 'panel-' + a.id;
            panel.className = 'panel' + (a.id === activeId ? ' active' : '');
            panel.innerHTML = 
                '<div class="agent-header">' +
                '<span class="dot ' + a.status + '"></span>' +
                '<span class="task">' + a.task + '</span>' +
                '<button class="btn btn-danger" onclick="stop(\\'' + a.id + '\\')">Stop</button>' +
                '</div>' +
                '<div class="chat" id="chat-' + a.id + '"><div class="msg thought">📋 Task: ' + a.task + '</div></div>' +
                '<div class="input-row">' +
                '<input id="input-' + a.id + '" placeholder="Message..." onkeydown="if(event.key===\\'Enter\\')send(\\'' + a.id + '\\')">' +
                '<button class="btn btn-primary" onclick="send(\\'' + a.id + '\\')">Send</button>' +
                '</div>';
            panelsEl.appendChild(panel);
        }
        // Update status dot
        const header = document.querySelector('#panel-' + a.id + ' .agent-header .dot');
        if (header) header.className = 'dot ' + a.status;
    });
    
    if (!activeId && agents.length > 0) select(agents[0].id);
}

function appendOutput(agentId, content, type) {
    const chat = document.getElementById('chat-' + agentId);
    if (!chat) return;
    
    // For streaming, append to last message of same type or create new
    const lastMsg = chat.lastElementChild;
    if (lastMsg && lastMsg.classList.contains(type) && type === 'thought') {
        lastMsg.textContent += content;
    } else {
        const msg = document.createElement('div');
        msg.className = 'msg ' + type;
        msg.textContent = content;
        chat.appendChild(msg);
    }
    chat.scrollTop = chat.scrollHeight;
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'agents') {
        agents = msg.agents;
        render();
    } else if (msg.type === 'output') {
        appendOutput(msg.agentId, msg.content, msg.outputType);
    }
});

vscode.postMessage({ command: 'refresh' });
</script>
</body></html>`;
    }
}
