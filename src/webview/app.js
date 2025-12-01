// Liftoff Webview Application Script
// @ts-nocheck

const vscode = acquireVsCodeApi();

// ============================================================================
// State
// ============================================================================

let messages = [];
let tools = [];
let fileChanges = {}; // { path: { added: 0, removed: 0 } }
let terminalOutput = [];
let agents = []; // Active agents
let playwrightActions = [];
let isThinking = false;
let activeTab = 'tools';
let expandedTools = new Set();
let totalAdded = 0;
let totalRemoved = 0;
let orchestratorState = 'Ready';
let thoughtBuffer = '';
let thoughtTimer = null;
const THOUGHT_FLUSH_MS = 120;

// Phase tracking for App Builder
let currentPhase = null;
let phaseStartTime = null;

// Phase metadata
const PHASES = {
    'spec': { icon: '📋', name: 'Specification', color: '#3b82f6' },
    'architecture': { icon: '🏗️', name: 'Architecture', color: '#8b5cf6' },
    'scaffold': { icon: '⚡', name: 'Scaffolding', color: '#10b981' },
    'implement': { icon: '💻', name: 'Implementation', color: '#f59e0b' },
    'test': { icon: '🧪', name: 'Testing', color: '#ec4899' },
    'deploy': { icon: '🚀', name: 'Deployment', color: '#06b6d4' }
};

// ============================================================================
// Tool Categories
// ============================================================================

const toolCategories = {
    // MCP Filesystem Tools (new format)
    'read_file': { icon: '📄', category: 'file', label: 'Read File' },
    'write_file': { icon: '✏️', category: 'file', label: 'Write File' },
    'list_directory': { icon: '📁', category: 'file', label: 'List Directory' },
    'search_files': { icon: '🔍', category: 'file', label: 'Search Files' },
    'create_directory': { icon: '📁', category: 'file', label: 'Create Directory' },
    'move_file': { icon: '🔀', category: 'file', label: 'Move File' },
    'get_file_info': { icon: 'ℹ️', category: 'file', label: 'File Info' },

    // MCP Local Tools (new format with local__ prefix)
    'local__run_command': { icon: '💻', category: 'shell', label: 'Run Command' },
    'local__run_tests': { icon: '🧪', category: 'test', label: 'Run Tests' },
    'local__git_status': { icon: '📊', category: 'git', label: 'Git Status' },
    'local__git_diff': { icon: '📝', category: 'git', label: 'Git Diff' },
    'local__git_commit': { icon: '✅', category: 'git', label: 'Git Commit' },
    'local__git_log': { icon: '📜', category: 'git', label: 'Git Log' },
    'local__git_branch': { icon: '🌿', category: 'git', label: 'Git Branch' },
    'local__browser_navigate': { icon: '🌐', category: 'browser', label: 'Navigate' },
    'local__browser_click': { icon: '👆', category: 'browser', label: 'Click' },
    'local__browser_type': { icon: '⌨️', category: 'browser', label: 'Type' },
    'local__browser_screenshot': { icon: '📸', category: 'browser', label: 'Screenshot' },
    'local__browser_get_elements': { icon: '🔎', category: 'browser', label: 'Get Elements' },
    'local__browser_get_text': { icon: '📝', category: 'browser', label: 'Get Text' },
    'local__browser_wait': { icon: '⏳', category: 'browser', label: 'Wait' },
    'local__browser_close': { icon: '❌', category: 'browser', label: 'Close Browser' },

    // Serena Semantic Code Tools
    'find_symbol': { icon: '🔍', category: 'code', label: 'Find Symbol' },
    'replace_symbol_body': { icon: '🔧', category: 'code', label: 'Replace Symbol' },
    'insert_after_symbol': { icon: '➕', category: 'code', label: 'Insert Code' },
    'find_referencing_symbols': { icon: '🔗', category: 'code', label: 'Find References' },
    'get_symbol_definition': { icon: '📖', category: 'code', label: 'Get Definition' },
    'get_symbol_documentation': { icon: '📚', category: 'code', label: 'Get Docs' },
    'rename_symbol': { icon: '✏️', category: 'code', label: 'Rename Symbol' },

    // Legacy execute() format (deprecated but kept for compatibility)
    'fs.read': { icon: '📄', category: 'file', label: 'Read File (legacy)' },
    'fs.write': { icon: '✏️', category: 'file', label: 'Write File (legacy)' },
    'fs.list': { icon: '📁', category: 'file', label: 'List Directory (legacy)' },
    'fs.search': { icon: '🔍', category: 'file', label: 'Search Files (legacy)' },
    'fs.delete': { icon: '🗑️', category: 'file', label: 'Delete (legacy)' },
    'shell.run': { icon: '💻', category: 'shell', label: 'Run Command (legacy)' },
    'git.status': { icon: '📊', category: 'git', label: 'Git Status (legacy)' },
    'git.diff': { icon: '📝', category: 'git', label: 'Git Diff (legacy)' },
    'git.commit': { icon: '✅', category: 'git', label: 'Git Commit (legacy)' },
    'test.run': { icon: '🧪', category: 'test', label: 'Run Tests (legacy)' },
    'browser.navigate': { icon: '🌐', category: 'browser', label: 'Navigate (legacy)' },
    'browser.click': { icon: '👆', category: 'browser', label: 'Click (legacy)' },
    'browser.type': { icon: '⌨️', category: 'browser', label: 'Type (legacy)' },
    'browser.screenshot': { icon: '📸', category: 'browser', label: 'Screenshot (legacy)' },
    'browser.eval': { icon: '⚡', category: 'browser', label: 'Evaluate (legacy)' },
};

// ============================================================================
// Utility Functions
// ============================================================================

function getToolInfo(name) {
    // Exact match first
    if (toolCategories[name]) return toolCategories[name];

    // Check for partial matches in tool categories
    for (const [key, value] of Object.entries(toolCategories)) {
        if (name.startsWith(key) || name.includes(key)) return value;
    }

    // MCP tool pattern matching
    if (name.includes('file') || name.includes('read') || name.includes('write') || name.includes('directory')) {
        return { icon: '📄', category: 'file', label: name };
    }
    if (name.includes('local__') && name.includes('command')) {
        return { icon: '💻', category: 'shell', label: name.replace('local__', '') };
    }
    if (name.includes('local__git') || name.includes('git_')) {
        return { icon: '📊', category: 'git', label: name.replace('local__', '').replace('_', ' ') };
    }
    if (name.includes('local__browser') || name.includes('browser_')) {
        return { icon: '🌐', category: 'browser', label: name.replace('local__', '').replace('_', ' ') };
    }
    if (name.includes('test')) {
        return { icon: '🧪', category: 'test', label: name };
    }
    if (name.includes('symbol') || name.includes('find_') || name.includes('replace_') || name.includes('insert_')) {
        return { icon: '🔍', category: 'code', label: name.replace(/_/g, ' ') };
    }

    // Legacy execute() format
    if (name.includes('shell') || name.includes('command')) {
        return { icon: '💻', category: 'shell', label: name };
    }

    // Default fallback
    return { icon: '🔧', category: 'default', label: name };
}

function formatDuration(ms) {
    if (!ms) return '';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
}

function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatParams(params) {
    if (!params) return '';
    if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch { return params; }
    }
    if (params.code) return params.code.substring(0, 300);
    if (params.path) return params.path;
    if (params.command) return '$ ' + params.command;
    if (params.url) return params.url;
    return JSON.stringify(params, null, 2).substring(0, 300);
}

function extractFilePath(params) {
    if (!params) return null;
    if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch { return null; }
    }
    return params.path || params.file || params.filePath || null;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// Phase Management Functions
// ============================================================================

function updatePhaseView(phase) {
    if (phase !== currentPhase) {
        // Complete previous phase
        if (currentPhase) {
            const duration = Date.now() - phaseStartTime;
            markPhaseComplete(currentPhase, duration);
        }

        // Start new phase
        currentPhase = phase;
        phaseStartTime = Date.now();
        createPhaseSection(phase);
    }
}

function createPhaseSection(phase) {
    const meta = PHASES[phase];
    if (!meta) return;

    const section = document.createElement('div');
    section.className = 'phase-section active';
    section.id = `phase-${phase}`;
    section.innerHTML = `
        <div class="phase-header" onclick="togglePhase('${phase}')">
            <span class="phase-icon">${meta.icon}</span>
            <span class="phase-name">${meta.name}</span>
            <span class="phase-status">In Progress...</span>
            <span class="phase-toggle">▼</span>
        </div>
        <div class="phase-content">
            <div class="file-tree" id="files-${phase}"></div>
            <div class="task-list" id="tasks-${phase}"></div>
            <div class="phase-logs" id="logs-${phase}"></div>
        </div>
    `;

    // Add to output container (create if doesn't exist)
    let outputContainer = document.getElementById('phase-output-container');
    if (!outputContainer) {
        outputContainer = document.createElement('div');
        outputContainer.id = 'phase-output-container';
        outputContainer.className = 'phase-output-container';

        // Insert into terminal output area
        const terminalContent = document.getElementById('terminalContent');
        if (terminalContent) {
            terminalContent.parentNode.insertBefore(outputContainer, terminalContent);
        }
    }

    outputContainer.appendChild(section);
}

function markPhaseComplete(phase, duration) {
    const section = document.getElementById(`phase-${phase}`);
    if (!section) return;

    section.classList.remove('active');
    section.classList.add('completed');

    const statusEl = section.querySelector('.phase-status');
    if (statusEl) {
        statusEl.textContent = `Completed in ${formatDuration(duration)}`;
    }
}

function togglePhase(phase) {
    const section = document.getElementById(`phase-${phase}`);
    if (!section) return;

    const content = section.querySelector('.phase-content');
    const toggle = section.querySelector('.phase-toggle');

    if (content.style.display === 'none') {
        content.style.display = 'block';
        toggle.textContent = '▼';
    } else {
        content.style.display = 'none';
        toggle.textContent = '▶';
    }
}

function addToFileTree(phase, filePath) {
    const tree = document.getElementById(`files-${phase}`);
    if (!tree) return;

    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
        <span class="file-icon">📄</span>
        <span class="file-path">${escapeHtml(filePath)}</span>
        <span class="file-status">✓</span>
    `;
    tree.appendChild(item);
}

function updateTaskInPhase(phase, task) {
    const taskList = document.getElementById(`tasks-${phase}`);
    if (!taskList) return;

    let taskItem = taskList.querySelector(`[data-task="${task.name}"]`);

    if (!taskItem) {
        taskItem = document.createElement('div');
        taskItem.className = 'task-item';
        taskItem.setAttribute('data-task', task.name);
        taskList.appendChild(taskItem);
    }

    const statusIcon = task.status === 'completed' ? '✅' :
                      task.status === 'error' ? '❌' :
                      task.status === 'running' ? '⏳' : '⭕';

    taskItem.innerHTML = `
        <span class="task-status">${statusIcon}</span>
        <span class="task-name">${escapeHtml(task.name)}</span>
    `;
}

function addLogToPhase(phase, content) {
    const logs = document.getElementById(`logs-${phase}`);
    if (!logs) return;

    const logLine = document.createElement('div');
    logLine.className = 'log-line';
    logLine.textContent = content;
    logs.appendChild(logLine);

    // Auto-scroll
    logs.scrollTop = logs.scrollHeight;
}

function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => 
        '<div class="code-block">' + (lang ? '<div class="code-header"><span class="lang">' + lang + '</span></div>' : '') + '<div class="code-content">' + code + '</div></div>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function formatOutput(output, toolName) {
    if (!output) return '';
    let html = escapeHtml(output);
    html = html.replace(/([\w./\-_]+\.(ts|js|py|tsx|jsx|json|md|css|html))/g, '<span class="file-path">$1</span>');
    if (toolName.includes('diff') || output.includes('@@')) {
        html = html.split('\n').map(line => {
            if (line.startsWith('+') && !line.startsWith('+++')) return '<div class="diff-line add">' + line + '</div>';
            if (line.startsWith('-') && !line.startsWith('---')) return '<div class="diff-line remove">' + line + '</div>';
            return line;
        }).join('\n');
    }
    return html;
}

// ============================================================================
// UI Actions
// ============================================================================

function toggleTool(id) {
    if (expandedTools.has(id)) expandedTools.delete(id);
    else expandedTools.add(id);
    renderTools();
}

function openFile(path) {
    vscode.postMessage({ command: 'openFile', path });
}

function togglePlaywright(show) {
    document.getElementById('playwrightPanel').classList.toggle('hidden', !show);
}

function setStatus(status, text) {
    document.getElementById('statusIndicator').className = 'status-indicator ' + status;
    document.getElementById('statusText').textContent = text;
    document.getElementById('stopBtn').style.display = status === 'active' ? 'inline-flex' : 'none';
    document.getElementById('progressBar').classList.toggle('indeterminate', status === 'active');
    orchestratorState = text || 'Ready';
    const railState = document.getElementById('railState');
    if (railState) {
        railState.textContent = orchestratorState;
        railState.className = 'rail-chip state ' + (status === 'active' ? 'active' : 'idle');
    }
}

function flushThoughtBuffer() {
    if (!thoughtBuffer) return;
    const thought = document.getElementById('currentThought');
    if (!thought) return;
    const nearBottom = thought.parentElement?.parentElement?.scrollHeight
        ? (thought.parentElement.parentElement.scrollHeight - thought.parentElement.parentElement.scrollTop - thought.parentElement.parentElement.clientHeight < 120)
        : true;

    // Split buffer into lines and create separate blocks for visual breaks
    const lines = thoughtBuffer.split('\n');
    for (const line of lines) {
        if (line.trim()) {
            // Create separate div for each significant line
            if (line.includes('---') || line.includes('Iteration') || line.includes('💭') || line.includes('🔧')) {
                const separator = document.createElement('div');
                separator.className = 'thought-separator';
                separator.style.cssText = 'margin: 12px 0; padding: 8px; background: rgba(100,149,237,0.1); border-left: 3px solid #6495ED; font-weight: 600;';
                separator.innerHTML = escapeHtml(line);
                thought.appendChild(separator);
            } else {
                const p = document.createElement('p');
                p.style.cssText = 'margin: 8px 0; line-height: 1.6;';
                p.innerHTML = escapeHtml(line);
                thought.appendChild(p);
            }
        } else if (line === '') {
            // Preserve intentional line breaks
            const br = document.createElement('br');
            thought.appendChild(br);
        }
    }

    thoughtBuffer = '';
    thoughtTimer = null;
    if (nearBottom) {
        const el = document.getElementById('chatMessages');
        el.scrollTop = el.scrollHeight;
    }
}

function updateStats() {
    document.getElementById('statFiles').textContent = Object.keys(fileChanges).length;
    document.getElementById('statAdded').textContent = '+' + totalAdded;
    document.getElementById('statRemoved').textContent = '-' + totalRemoved;
    document.getElementById('statTools').textContent = tools.length;
    const completed = tools.filter(t => t.status !== 'running');
    const successRate = completed.length > 0 ? Math.round(completed.filter(t => t.status === 'success').length / completed.length * 100) : 0;
    document.getElementById('statSuccess').textContent = completed.length > 0 ? successRate + '%' : '-';

    const filesCount = Object.keys(fileChanges).length;
    const agentWorkCount = agents.length + filesCount;
    document.getElementById('tabTools').textContent = `Tools (${tools.length})`;
    document.getElementById('tabFiles').textContent = `Agent Work (${agentWorkCount})`;
    document.getElementById('tabTerminal').textContent = `Output (${terminalOutput.length})`;
    document.getElementById('railTools').textContent = tools.length;
    document.getElementById('railFiles').textContent = agentWorkCount;
    document.getElementById('railTerminal').textContent = terminalOutput.length;
}

function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.activity-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('toolsList').style.display = 'none';
    document.getElementById('filesList').style.display = 'none';
    document.getElementById('terminalView').style.display = 'none';
    document.getElementById('activityEmpty').style.display = 'none';
    
    if (tab === 'tools') renderTools();
    else if (tab === 'files') renderFiles();
    else if (tab === 'terminal') renderTerminal();
}

function stopAll() { 
    vscode.postMessage({ command: 'stopAll' }); 
    setStatus('', 'Stopped'); 
}

function clearChat() {
    vscode.postMessage({ command: 'clearChat' });
    messages = []; tools = []; fileChanges = {}; terminalOutput = []; playwrightActions = []; agents = [];
    expandedTools.clear(); totalAdded = 0; totalRemoved = 0;
    renderMessages(); renderTools(); renderFiles(); renderTerminal(); updateStats();
    togglePlaywright(false);
}

// ============================================================================
// Message Handling
// ============================================================================

function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    vscode.postMessage({ command: 'orchestratorChat', text });
}

function addMessage(role, content) {
    // Prevent duplicate user messages
    if (role === 'user') {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'user' && lastMsg.content === content) {
            return;
        }
    }
    messages.push({ role, content, timestamp: Date.now() });
    renderMessages();
}

function renderMessages() {
    const el = document.getElementById('chatMessages');
    if (messages.length === 0 && !isThinking) {
        el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🚀</div><div class="empty-state-title">What would you like to build?</div></div>';
        return;
    }

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    let html = '';
    messages.forEach((msg, i) => {
        if (msg.role === 'user') {
            html += '<div class="message message-user"><div class="message-content">' +
                '<div class="message-meta"><span class="chip user">You</span><span class="meta-time">' + formatTime(msg.timestamp) + '</span></div>' +
                escapeHtml(msg.content) +
                '</div></div>';
        } else {
            html += '<div class="message message-assistant"><div class="message-content" id="msg-' + i + '">' +
                '<div class="message-meta"><span class="chip assistant">Orchestrator</span><span class="meta-time">' + formatTime(msg.timestamp) + '</span></div>' +
                renderMarkdown(msg.content) +
                '</div></div>';
        }
    });

    if (isThinking) {
        html += '<div class="message message-assistant"><div class="message-content" id="currentThought">';
        html += '<div class="thinking"><div class="thinking-dots"><span></span><span></span><span></span></div><span>Thinking...</span></div>';
        html += '</div></div>';
    }

    el.innerHTML = html;
    if (nearBottom) {
        el.scrollTop = el.scrollHeight;
    }
}

// ============================================================================
// Tool Handling
// ============================================================================

function addTool(name, params, status = 'running') {
    const info = getToolInfo(name);
    const tool = { 
        id: 'tool-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        name, displayName: info.label, icon: info.icon, category: info.category,
        params, status, output: '', startTime: Date.now(), duration: null,
        linesAdded: 0, linesRemoved: 0, filePath: extractFilePath(params)
    };
    tools.unshift(tool);
    
    // Show playwright panel for browser tools
    if (info.category === 'browser') {
        togglePlaywright(true);
        addPlaywrightAction(info.label, formatParams(params));
    }
    
    renderTools();
    updateStats();
    return tool.id;
}

function updateTool(name, status, output = '', duration = null, linesAdded = 0, linesRemoved = 0, filePath = null, screenshot = null) {
    const tool = tools.find(t => t.name === name && t.status === 'running');
    if (tool) {
        tool.status = status;
        tool.output = output;
        tool.duration = duration || (Date.now() - tool.startTime);
        tool.linesAdded = linesAdded || 0;
        tool.linesRemoved = linesRemoved || 0;
        
        // Track file changes
        const path = filePath || tool.filePath;
        if (path && (tool.linesAdded > 0 || tool.linesRemoved > 0)) {
            if (!fileChanges[path]) fileChanges[path] = { added: 0, removed: 0 };
            fileChanges[path].added += tool.linesAdded;
            fileChanges[path].removed += tool.linesRemoved;
            totalAdded += tool.linesAdded;
            totalRemoved += tool.linesRemoved;
        }

        // Handle playwright screenshot
        if (screenshot) {
            updatePlaywrightScreenshot(screenshot);
        }
        
        renderTools();
        renderFiles();
        updateStats();
    }
}

function renderTools() {
    const el = document.getElementById('toolsList');
    const empty = document.getElementById('activityEmpty');

    if (tools.length === 0 || activeTab !== 'tools') {
        el.style.display = 'none';
        if (activeTab === 'tools') empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';
    el.style.display = 'block';

    el.innerHTML = tools.slice(0, 50).map(t => {
        const isExpanded = expandedTools.has(t.id);
        const desc = t.filePath || formatParams(t.params).substring(0, 50);
        
        let statusBadge = t.status === 'running' 
            ? '<span class="tool-status-badge running"><span class="spinner"></span></span>'
            : t.status === 'success' 
                ? '<span class="tool-status-badge success">✓</span>'
                : '<span class="tool-status-badge error">✗</span>';

        let changesHtml = '';
        if (t.linesAdded > 0 || t.linesRemoved > 0) {
            changesHtml = '<div class="tool-changes">' +
                (t.linesAdded > 0 ? '<span class="added">+' + t.linesAdded + '</span>' : '') +
                (t.linesRemoved > 0 ? '<span class="removed">-' + t.linesRemoved + '</span>' : '') +
            '</div>';
        }

        let bodyHtml = '';
        if (t.params) {
            bodyHtml += '<div class="tool-params"><div class="tool-section-title">Parameters</div><div class="tool-section-content">' + escapeHtml(formatParams(t.params)) + '</div></div>';
        }
        if (t.output) {
            bodyHtml += '<div class="tool-output"><div class="tool-section-title">Output</div><div class="tool-section-content' + (t.status === 'error' ? ' error' : '') + '">' + formatOutput(t.output, t.name) + '</div></div>';
        }

        return '<div class="tool-card ' + t.status + (isExpanded ? ' expanded' : '') + '">' +
            (t.status === 'running' ? '<div class="tool-progress"><div class="tool-progress-bar"></div></div>' : '') +
            '<div class="tool-header" onclick="toggleTool(\'' + t.id + '\')">' +
                '<div class="tool-icon-wrapper ' + t.category + '">' + t.icon + '</div>' +
                '<div class="tool-info">' +
                    '<div class="tool-name">' + escapeHtml(t.displayName) + ' <span class="method">' + escapeHtml(t.name) + '</span></div>' +
                    '<div class="tool-desc">' + (t.filePath ? '<span class="file-path" onclick="event.stopPropagation();openFile(\'' + escapeHtml(t.filePath) + '\')">' + escapeHtml(desc) + '</span>' : escapeHtml(desc)) + '</div>' +
                '</div>' +
                '<div class="tool-meta">' +
                    changesHtml +
                    (t.duration ? '<span class="tool-duration">' + formatDuration(t.duration) + '</span>' : '') +
                    statusBadge +
                    '<span class="tool-expand-icon">▼</span>' +
                '</div>' +
            '</div>' +
            '<div class="tool-body">' + bodyHtml + '</div>' +
        '</div>';
    }).join('');
}

// ============================================================================
// Agents Panel
// ============================================================================

function renderAgents() {
    const el = document.getElementById('filesList');
    if (activeTab !== 'files') return;
    renderFiles(); // Trigger full re-render of Agent Work tab
}

// ============================================================================
// Files Panel (Agent Work Tab)
// ============================================================================

function renderFiles() {
    const el = document.getElementById('filesList');
    if (activeTab !== 'files') {
        el.style.display = 'none';
        return;
    }

    const files = Object.entries(fileChanges);
    const hasContent = agents.length > 0 || files.length > 0;

    if (!hasContent) {
        el.style.display = 'none';
        document.getElementById('activityEmpty').style.display = 'flex';
        return;
    }

    document.getElementById('activityEmpty').style.display = 'none';
    el.style.display = 'block';

    let html = '<div style="padding: 8px;">';

    // Render agents first
    if (agents.length > 0) {
        html += '<div class="agents-section" style="margin-bottom: 12px;">';
        html += '<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; display: flex; justify-content: space-between;">';
        html += '<span>Active Agents</span>';
        html += '<span style="color: var(--accent);">' + agents.length + ' total</span>';
        html += '</div>';
        agents.forEach(agent => {
            const statusIcon = agent.status === 'running' ? '🔄' : agent.status === 'completed' ? '✅' : '❌';
            const statusClass = agent.status === 'running' ? 'running' : agent.status === 'completed' ? 'success' : 'error';
            html += '<div class="agent-card ' + statusClass + '" style="background: var(--bg-secondary); border-radius: 6px; padding: 8px; margin-bottom: 6px; border-left: 3px solid var(--' + (agent.status === 'running' ? 'warning' : agent.status === 'completed' ? 'success' : 'error') + ');">';
            html += '<div style="display: flex; align-items: center; gap: 6px;">';
            html += '<span>' + statusIcon + '</span>';
            html += '<span style="font-weight: 500;">' + escapeHtml(agent.name || agent.type || 'Agent') + '</span>';
            html += '<span class="chip ' + statusClass + '" style="font-size: 10px;">' + agent.status + '</span>';
            html += '</div>';
            if (agent.task) {
                html += '<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(agent.task.substring(0, 80)) + '</div>';
            }
            html += '</div>';
        });
        html += '</div>';
    }

    // Render file changes
    if (files.length > 0) {
        html += '<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase;">File Changes</div>';
        html += files.map(([path, changes]) => {
            const filename = path.split(/[\\/]/).pop();
            return '<div class="file-change-badge" onclick="openFile(\'' + escapeHtml(path) + '\')">' +
                '<span class="filename">' + escapeHtml(filename) + '</span>' +
                '<span class="changes">' +
                    (changes.added > 0 ? '<span class="added">+' + changes.added + '</span> ' : '') +
                    (changes.removed > 0 ? '<span class="removed">-' + changes.removed + '</span>' : '') +
                '</span>' +
            '</div>';
        }).join('');
    }

    html += '</div>';
    el.innerHTML = html;
}

// ============================================================================
// Playwright Panel
// ============================================================================

function addPlaywrightAction(type, detail) {
    playwrightActions.unshift({ type, detail, timestamp: Date.now() });
    if (playwrightActions.length > 20) playwrightActions.pop();
    renderPlaywrightActions();
}

function updatePlaywrightScreenshot(base64) {
    const el = document.getElementById('playwrightScreenshot');
    el.innerHTML = '<img class="playwright-screenshot" src="data:image/png;base64,' + base64 + '" />';
}

function updatePlaywrightUrl(url) {
    document.getElementById('playwrightUrl').textContent = url;
}

function renderPlaywrightActions() {
    const el = document.getElementById('playwrightActions');
    el.innerHTML = playwrightActions.slice(0, 10).map(a =>
        '<div class="playwright-action">' +
            '<div class="playwright-action-type">' + escapeHtml(a.type) + '</div>' +
            '<div class="playwright-action-detail">' + escapeHtml(a.detail.substring(0, 100)) + '</div>' +
        '</div>'
    ).join('');
}

// ============================================================================
// Terminal Panel
// ============================================================================

function addTerminalLine(type, content) {
    terminalOutput.push({ type, content, timestamp: Date.now() });
    if (terminalOutput.length > 100) terminalOutput.shift();
    renderTerminal();
}

function renderTerminal() {
    const el = document.getElementById('terminalView');
    if (activeTab !== 'terminal') {
        el.style.display = 'none';
        return;
    }

    if (terminalOutput.length === 0) {
        el.style.display = 'none';
        document.getElementById('activityEmpty').style.display = 'flex';
        return;
    }

    document.getElementById('activityEmpty').style.display = 'none';
    el.style.display = 'block';
    el.innerHTML = '<div class="tool-section-content" style="max-height:none;height:calc(100% - 16px);margin:8px;">' +
        terminalOutput.map(l => {
            const style = l.type === 'cmd' ? 'color:var(--success)' : l.type === 'stderr' ? 'color:#ffa198' : '';
            return '<div style="' + style + '">' + (l.type === 'cmd' ? '$ ' : '') + escapeHtml(l.content) + '</div>';
        }).join('') +
    '</div>';
    el.querySelector('.tool-section-content').scrollTop = 99999;
}

// ============================================================================
// Event Listeners
// ============================================================================

document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault(); 
        sendMessage(); 
    }
});

window.addEventListener('message', e => {
    // SECURITY: Validate message structure to prevent malicious messages
    const msg = e.data;
    if (!msg || typeof msg !== 'object' || !msg.type) {
        return; // Ignore invalid messages
    }

    switch (msg.type) {
        case 'orchestratorStart':
            isThinking = true;
            setStatus('active', 'Thinking...');
            thoughtBuffer = '';
            if (thoughtTimer) {
                clearTimeout(thoughtTimer);
                thoughtTimer = null;
            }
            renderMessages();
            break;
            
        case 'orchestratorEnd':
            isThinking = false;
            setStatus('', 'Ready');
            thoughtBuffer = '';
            if (thoughtTimer) {
                clearTimeout(thoughtTimer);
                thoughtTimer = null;
            }
            const el = document.getElementById('currentThought');
            if (el && el.textContent) {
                const content = el.textContent.replace('Thinking...', '').trim();
                if (content) messages.push({ role: 'assistant', content, timestamp: Date.now() });
            }
            renderMessages();
            break;
            
        case 'orchestratorMessage':
            if (msg.message) {
                messages.push({ role: msg.message.role, content: msg.message.content, timestamp: Date.now() });
                renderMessages();
            }
            break;
            
        case 'orchestratorThought':
            isThinking = true;
            setStatus('active', 'Thinking...');
            let thought = document.getElementById('currentThought');
            if (!thought) {
                const div = document.createElement('div');
                div.className = 'message message-assistant';
                div.innerHTML = '<div class="message-content" id="currentThought"></div>';
                document.getElementById('chatMessages').appendChild(div);
                thought = document.getElementById('currentThought');
            }
            const indicator = thought.querySelector('.thinking');
            if (indicator) indicator.remove();
            thoughtBuffer += msg.content;
            if (!thoughtTimer) {
                thoughtTimer = setTimeout(flushThoughtBuffer, THOUGHT_FLUSH_MS);
            }
            break;
            
        case 'toolStart':
            addTool(msg.tool, msg.params, 'running');
            setStatus('active', 'Running: ' + msg.tool);
            addTerminalLine('cmd', msg.tool + ' ' + formatParams(msg.params).substring(0, 80));
            
            // Handle browser URL updates
            if (msg.tool.includes('navigate') && msg.params) {
                const params = typeof msg.params === 'string' ? JSON.parse(msg.params) : msg.params;
                if (params.url) updatePlaywrightUrl(params.url);
            }
            break;
            
        case 'toolComplete':
            updateTool(msg.tool, msg.success ? 'success' : 'error', msg.output, msg.duration, msg.linesAdded, msg.linesRemoved, msg.filePath, msg.screenshot);
            setStatus('active', msg.success ? 'Done: ' + msg.tool : 'Failed: ' + msg.tool);
            if (msg.output) addTerminalLine(msg.success ? 'stdout' : 'stderr', msg.output.substring(0, 300));
            break;

        case 'output':
            // Agent output - show in Output tab with type prefix
            if (msg.content) {
                const outputType = msg.outputType || 'stdout';
                const prefix = msg.outputType === 'thought' ? '💭 ' :
                              msg.outputType === 'tool' ? '🔧 ' :
                              msg.outputType === 'result' ? '📋 ' :
                              msg.outputType === 'error' ? '❌ ' : '';

                // Split long output into lines and add each separately
                const lines = msg.content.split('\n');
                for (const line of lines) {
                    if (line.trim()) {  // Skip empty lines
                        // Check for duplicate (same content in last 5 entries)
                        const recentOutput = terminalOutput.slice(-5);
                        const isDuplicate = recentOutput.some(entry =>
                            entry.content === prefix + line
                        );
                        if (!isDuplicate) {
                            addTerminalLine(outputType, prefix + line);
                        }
                    }
                }
                updateStats();
                // Highlight Output tab when new content arrives
                document.getElementById('tabTerminal').classList.add('has-activity');
                setTimeout(() => document.getElementById('tabTerminal').classList.remove('has-activity'), 2000);
            }
            break;

        case 'agents':
            // Full agent list update
            agents = msg.agents || [];
            console.log('[Webview] Received agents update:', agents.length, 'agents');
            agents.forEach((a, i) => console.log(`  [${i+1}] ${a.name} (${a.status})`));
            renderAgents();
            updateStats();
            break;

        case 'agentSpawned':
            // New agent spawned
            if (msg.agent) {
                const existing = agents.findIndex(a => a.id === msg.agent.id);
                if (existing >= 0) {
                    agents[existing] = { ...agents[existing], ...msg.agent, task: msg.task };
                } else {
                    agents.push({ ...msg.agent, task: msg.task, status: 'running' });
                }
                renderAgents();
                updateStats();
            }
            break;

        case 'agentCompleted':
            // Agent finished
            if (msg.agent) {
                const idx = agents.findIndex(a => a.id === msg.agent.id);
                if (idx >= 0) {
                    agents[idx].status = msg.success ? 'completed' : 'error';
                    agents[idx].error = msg.error;
                    renderAgents();
                    updateStats();
                }
            }
            break;

        case 'phaseUpdate':
            // App Builder phase change
            if (msg.phase) {
                updatePhaseView(msg.phase);
            }
            break;

        case 'fileCreated':
            // File created in current phase
            if (msg.path && currentPhase) {
                addToFileTree(currentPhase, msg.path);
            }
            break;

        case 'taskUpdate':
            // Task status update in current phase
            if (msg.task && currentPhase) {
                updateTaskInPhase(currentPhase, msg.task);
            }
            break;

        case 'chatCleared':
            clearChat();
            break;
    }
});

// Initialize
vscode.postMessage({ command: 'refresh' });
