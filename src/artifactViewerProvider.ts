import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentManager } from './agentManager';
import { Artifact } from './agentCommunication';

export class ArtifactViewerProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly agentManager: AgentManager
    ) {
        agentManager.on('newArtifact', () => this.updateView());
    }
    
    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        
        webviewView.webview.html = this.getHtmlContent();
        
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'openFile':
                    if (message.path && fs.existsSync(message.path)) {
                        const doc = await vscode.workspace.openTextDocument(message.path);
                        await vscode.window.showTextDocument(doc);
                    }
                    break;
                case 'viewScreenshot':
                    if (message.path && fs.existsSync(message.path)) {
                        const uri = vscode.Uri.file(message.path);
                        await vscode.commands.executeCommand('vscode.open', uri);
                    }
                    break;
                case 'copyCode':
                    await vscode.env.clipboard.writeText(message.code);
                    vscode.window.showInformationMessage('Code copied to clipboard');
                    break;
                case 'getArtifacts':
                    this.updateView();
                    break;
            }
        });
    }
    
    private updateView(): void {
        if (this._view) {
            const artifacts = this.agentManager.getAllArtifacts();
            this._view.webview.postMessage({ command: 'updateArtifacts', artifacts });
        }
    }

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Artifacts</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 12px;
        }
        .header { 
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h2 { font-size: 14px; font-weight: 600; }
        .artifact-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 10px;
        }
        .artifact-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .artifact-type {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            background: var(--vscode-badge-background);
            text-transform: uppercase;
        }
        .artifact-type.code { background: #4CAF50; }
        .artifact-type.screenshot { background: #2196F3; }
        .artifact-type.file { background: #FF9800; }
        .artifact-title { font-size: 13px; font-weight: 500; }
        .artifact-preview {
            background: var(--vscode-terminal-background);
            border-radius: 4px;
            padding: 8px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            max-height: 200px;
            overflow: auto;
            white-space: pre-wrap;
        }
        .artifact-actions {
            display: flex;
            gap: 6px;
            margin-top: 8px;
        }
        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            opacity: 0.6;
        }
        .filter-bar {
            display: flex;
            gap: 6px;
            margin-bottom: 12px;
        }
        .filter-btn {
            background: transparent;
            border: 1px solid var(--vscode-panel-border);
            color: var(--vscode-editor-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }
        .filter-btn.active {
            background: var(--vscode-button-background);
            border-color: var(--vscode-button-background);
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>📦 Artifacts</h2>
    </div>
    
    <div class="filter-bar">
        <button class="filter-btn active" onclick="filter('all')">All</button>
        <button class="filter-btn" onclick="filter('code')">Code</button>
        <button class="filter-btn" onclick="filter('screenshot')">Screenshots</button>
        <button class="filter-btn" onclick="filter('file')">Files</button>
    </div>
    
    <div id="artifacts-container">
        <div class="empty-state">No artifacts yet. Agents will produce artifacts as they work.</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let artifacts = [];
        let currentFilter = 'all';
        
        function filter(type) {
            currentFilter = type;
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.textContent.toLowerCase().includes(type));
            });
            renderArtifacts();
        }
        
        function openFile(path) {
            vscode.postMessage({ command: 'openFile', path });
        }
        
        function viewScreenshot(path) {
            vscode.postMessage({ command: 'viewScreenshot', path });
        }
        
        function copyCode(code) {
            vscode.postMessage({ command: 'copyCode', code });
        }
        
        function renderArtifacts() {
            const container = document.getElementById('artifacts-container');
            const filtered = currentFilter === 'all' 
                ? artifacts 
                : artifacts.filter(a => a.type === currentFilter);
            
            if (filtered.length === 0) {
                container.innerHTML = '<div class="empty-state">No artifacts yet.</div>';
                return;
            }
            
            container.innerHTML = filtered.map(artifact => {
                const time = new Date(artifact.timestamp).toLocaleTimeString();
                let preview = artifact.content;
                if (preview.length > 500) preview = preview.substring(0, 500) + '...';
                
                let actions = '';
                if (artifact.type === 'code') {
                    actions = \`<button class="btn" onclick="copyCode(\\\`\${artifact.content.replace(/\`/g, '\\\\\`')}\\\`)">📋 Copy</button>\`;
                } else if (artifact.type === 'screenshot') {
                    actions = \`<button class="btn" onclick="viewScreenshot('\${artifact.filePath}')">🖼️ View</button>\`;
                } else if (artifact.filePath) {
                    actions = \`<button class="btn" onclick="openFile('\${artifact.filePath}')">📂 Open</button>\`;
                }
                
                return \`
                    <div class="artifact-card">
                        <div class="artifact-header">
                            <span class="artifact-title">\${artifact.title}</span>
                            <span class="artifact-type \${artifact.type}">\${artifact.type}</span>
                        </div>
                        <div class="artifact-preview">\${preview}</div>
                        <div class="artifact-actions">
                            \${actions}
                            <span style="opacity: 0.5; font-size: 10px; margin-left: auto;">\${time}</span>
                        </div>
                    </div>
                \`;
            }).join('');
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateArtifacts') {
                artifacts = message.artifacts;
                renderArtifacts();
            }
        });
        
        vscode.postMessage({ command: 'getArtifacts' });
    </script>
</body>
</html>`;
    }
}
