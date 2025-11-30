import * as vscode from 'vscode';
import * as fs from 'fs';
import { IAgentManager } from './types';

/**
 * Artifact Viewer Provider - Shows code snippets, screenshots, and files
 * Updated with modern dark theme matching the main panel
 */
export class ArtifactViewerProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];
    
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly agentManager: IAgentManager
    ) {
        this._disposables.push(
            agentManager.on('newArtifact', () => this.updateView())
        );
    }
    
    dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
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
            --radius: 6px;
            --font-mono: 'Cascadia Code', Consolas, monospace;
        }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 12px;
            background: var(--bg-primary);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

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

        .badge {
            background: var(--accent);
            color: white;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            font-weight: 500;
        }

        .filter-bar {
            display: flex;
            gap: 4px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--border);
            background: var(--bg-secondary);
            overflow-x: auto;
        }

        .filter-btn {
            padding: 4px 10px;
            background: transparent;
            border: 1px solid var(--border);
            border-radius: 20px;
            color: var(--text-secondary);
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s;
            white-space: nowrap;
        }

        .filter-btn:hover {
            background: var(--bg-hover);
            color: var(--text-primary);
        }

        .filter-btn.active {
            background: var(--accent);
            border-color: var(--accent);
            color: white;
        }

        .artifacts-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        }

        .artifact-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            margin-bottom: 8px;
            overflow: hidden;
            transition: all 0.15s;
        }

        .artifact-card:hover {
            border-color: var(--text-muted);
        }

        .artifact-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            background: var(--bg-tertiary);
            border-bottom: 1px solid var(--border);
        }

        .artifact-icon {
            font-size: 14px;
        }

        .artifact-title {
            flex: 1;
            font-size: 12px;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .artifact-type {
            font-size: 9px;
            padding: 2px 6px;
            border-radius: 10px;
            text-transform: uppercase;
            font-weight: 600;
            letter-spacing: 0.5px;
        }

        .artifact-type.code { background: rgba(63, 185, 80, 0.2); color: var(--success); }
        .artifact-type.screenshot { background: rgba(88, 166, 255, 0.2); color: var(--accent); }
        .artifact-type.file { background: rgba(210, 153, 34, 0.2); color: var(--warning); }

        .artifact-preview {
            padding: 10px 12px;
            font-family: var(--font-mono);
            font-size: 11px;
            max-height: 150px;
            overflow: auto;
            white-space: pre-wrap;
            word-break: break-all;
            color: var(--text-secondary);
            background: var(--bg-primary);
        }

        .artifact-actions {
            display: flex;
            gap: 6px;
            padding: 8px 12px;
            border-top: 1px solid var(--border);
            background: var(--bg-tertiary);
        }

        .action-btn {
            padding: 4px 10px;
            background: var(--bg-primary);
            border: 1px solid var(--border);
            border-radius: 4px;
            color: var(--text-secondary);
            font-size: 10px;
            cursor: pointer;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .action-btn:hover {
            background: var(--accent);
            border-color: var(--accent);
            color: white;
        }

        .artifact-time {
            margin-left: auto;
            font-size: 10px;
            color: var(--text-muted);
        }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--text-muted);
            text-align: center;
            padding: 32px;
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

        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">
            <span>📦</span>
            <span>Artifacts</span>
        </div>
        <span class="badge" id="artifactCount">0</span>
    </div>
    
    <div class="filter-bar">
        <button class="filter-btn active" data-filter="all" onclick="filter('all')">All</button>
        <button class="filter-btn" data-filter="code" onclick="filter('code')">💻 Code</button>
        <button class="filter-btn" data-filter="screenshot" onclick="filter('screenshot')">🖼️ Screenshots</button>
        <button class="filter-btn" data-filter="file" onclick="filter('file')">📄 Files</button>
    </div>
    
    <div class="artifacts-list" id="artifactsList">
        <div class="empty-state" id="emptyState">
            <div class="empty-icon">📦</div>
            <div class="empty-title">No Artifacts Yet</div>
            <div>Code snippets and files will appear here</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let artifacts = [];
        let currentFilter = 'all';
        
        const typeIcons = {
            code: '💻',
            screenshot: '🖼️',
            file: '📄'
        };
        
        function filter(type) {
            currentFilter = type;
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === type);
            });
            renderArtifacts();
        }
        
        function openFile(path) {
            vscode.postMessage({ command: 'openFile', path });
        }
        
        function viewScreenshot(path) {
            vscode.postMessage({ command: 'viewScreenshot', path });
        }
        
        function copyCode(index) {
            const artifact = artifacts[index];
            if (artifact) {
                vscode.postMessage({ command: 'copyCode', code: artifact.content });
            }
        }
        
        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function renderArtifacts() {
            const container = document.getElementById('artifactsList');
            const empty = document.getElementById('emptyState');
            const countBadge = document.getElementById('artifactCount');
            
            const filtered = currentFilter === 'all' 
                ? artifacts 
                : artifacts.filter(a => a.type === currentFilter);
            
            countBadge.textContent = filtered.length;
            
            if (filtered.length === 0) {
                container.innerHTML = '<div class="empty-state" id="emptyState"><div class="empty-icon">📦</div><div class="empty-title">No Artifacts</div><div>Nothing matches this filter</div></div>';
                return;
            }
            
            container.innerHTML = filtered.map((artifact, index) => {
                const time = artifact.timestamp ? new Date(artifact.timestamp).toLocaleTimeString() : '';
                const icon = typeIcons[artifact.type] || '📄';
                let preview = artifact.content || '';
                if (preview.length > 300) preview = preview.substring(0, 300) + '...';
                
                let actions = '';
                if (artifact.type === 'code') {
                    actions = '<button class="action-btn" onclick="copyCode(' + index + ')">📋 Copy</button>';
                } else if (artifact.type === 'screenshot' && artifact.filePath) {
                    actions = '<button class="action-btn" onclick="viewScreenshot(\\'' + escapeHtml(artifact.filePath) + '\\')">👁️ View</button>';
                } else if (artifact.filePath) {
                    actions = '<button class="action-btn" onclick="openFile(\\'' + escapeHtml(artifact.filePath) + '\\')">📂 Open</button>';
                }
                
                return '<div class="artifact-card">' +
                    '<div class="artifact-header">' +
                        '<span class="artifact-icon">' + icon + '</span>' +
                        '<span class="artifact-title">' + escapeHtml(artifact.title || 'Untitled') + '</span>' +
                        '<span class="artifact-type ' + artifact.type + '">' + (artifact.language || artifact.type) + '</span>' +
                    '</div>' +
                    (preview ? '<div class="artifact-preview">' + escapeHtml(preview) + '</div>' : '') +
                    '<div class="artifact-actions">' +
                        actions +
                        '<span class="artifact-time">' + time + '</span>' +
                    '</div>' +
                '</div>';
            }).join('');
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateArtifacts') {
                artifacts = message.artifacts || [];
                renderArtifacts();
            }
        });
        
        vscode.postMessage({ command: 'getArtifacts' });
    </script>
</body>
</html>`;
    }
}
