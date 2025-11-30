import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get the complete webview HTML by loading external files
 */
export function getWebviewHtml(extensionUri: vscode.Uri, _webview: vscode.Webview): string {
    const webviewPath = path.join(extensionUri.fsPath, 'src', 'webview');
    
    // Load CSS
    const cssPath = path.join(webviewPath, 'styles.css');
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
    
    // Load HTML template
    const htmlPath = path.join(webviewPath, 'template.html');
    const bodyHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '<div>Template not found</div>';
    
    // Load JavaScript
    const jsPath = path.join(webviewPath, 'app.js');
    const script = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
    <title>Liftoff</title>
    <style>${css}</style>
</head>
<body>
${bodyHtml}
    <script>${script}</script>
</body>
</html>`;
}

/**
 * Get paths to webview resources for development hot-reload
 */
export function getWebviewPaths(extensionUri: vscode.Uri): { css: string; html: string; js: string } {
    const webviewPath = path.join(extensionUri.fsPath, 'src', 'webview');
    return {
        css: path.join(webviewPath, 'styles.css'),
        html: path.join(webviewPath, 'template.html'),
        js: path.join(webviewPath, 'app.js')
    };
}
