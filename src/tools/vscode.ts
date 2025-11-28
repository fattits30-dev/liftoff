// VS Code diagnostics tools for autonomous agents
import * as vscode from 'vscode';
import { Tool, ToolResult } from './index';

export const VSCODE_TOOLS: Record<string, Tool> = {
    get_problems: {
        name: 'get_problems',
        description: 'Get VS Code Problems panel diagnostics (TypeScript errors, ESLint warnings, etc.). Use this BEFORE running tests to catch compile errors.',
        parameters: {
            severity: { type: 'string', description: 'Filter: "error" | "warning" | "all" (default: all)' },
            limit: { type: 'number', description: 'Max problems to return (default: 50)' }
        },
        async execute(params, workspaceRoot) {
            try {
                const allDiagnostics = vscode.languages.getDiagnostics();
                const problems: Array<{
                    file: string;
                    line: number;
                    column: number;
                    message: string;
                    severity: string;
                    source: string;
                }> = [];

                for (const [uri, diagnostics] of allDiagnostics) {
                    try {
                        // Skip non-file URIs
                        if (uri.scheme !== 'file') {
                            continue;
                        }
                        
                        // Filter to workspace files only
                        const relativePath = vscode.workspace.asRelativePath(uri, false);
                        if (relativePath.startsWith('..') || relativePath.includes('node_modules')) {
                            continue;
                        }
                        
                        // Skip if file doesn't exist (stale diagnostics)
                        try {
                            await vscode.workspace.fs.stat(uri);
                        } catch {
                            continue; // File doesn't exist, skip it
                        }

                    for (const diag of diagnostics) {
                        const severity =
                            diag.severity === vscode.DiagnosticSeverity.Error ? 'error' :
                            diag.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'info';

                        // Apply severity filter
                        if (params.severity && params.severity !== 'all' && params.severity !== severity) {
                            continue;
                        }

                        problems.push({
                            file: relativePath,
                            line: diag.range.start.line + 1,
                            column: diag.range.start.character + 1,
                            message: diag.message,
                            severity,
                            source: diag.source || 'unknown'
                        });

                        if (problems.length >= (params.limit || 50)) break;
                    }
                    if (problems.length >= (params.limit || 50)) break;
                    } catch {
                        // Skip files that cause errors (deleted, inaccessible, etc.)
                        continue;
                    }
                }

                if (problems.length === 0) {
                    return { success: true, output: 'No problems found! All clear. ✓' };
                }

                // Sort by severity (errors first) then by file
                problems.sort((a, b) => {
                    if (a.severity === 'error' && b.severity !== 'error') return -1;
                    if (a.severity !== 'error' && b.severity === 'error') return 1;
                    return a.file.localeCompare(b.file);
                });

                const errorCount = problems.filter(p => p.severity === 'error').length;
                const warningCount = problems.filter(p => p.severity === 'warning').length;

                const formatted = problems.map(p =>
                    `${p.severity.toUpperCase()}: ${p.file}:${p.line}:${p.column} - ${p.message} [${p.source}]`
                ).join('\n');

                // Always return success:true so agent sees full output
                // The tool "succeeded" at finding problems - problems ARE the output
                return {
                    success: true,
                    output: `Found ${errorCount} errors, ${warningCount} warnings:\n\n${formatted}\n\n${errorCount > 0 ? '⚠️ Fix errors before proceeding!' : '✓ No errors, only warnings.'}`
                };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    refresh_diagnostics: {
        name: 'refresh_diagnostics',
        description: 'Force VS Code to refresh diagnostics by triggering a file save. Use after making edits to see updated problems.',
        parameters: {
            path: { type: 'string', description: 'File path to refresh (optional - refreshes all if not specified)' }
        },
        async execute(params, workspaceRoot) {
            try {
                if (params.path) {
                    // Find and save specific document
                    const uri = vscode.Uri.file(
                        params.path.startsWith('/') || params.path.includes(':')
                            ? params.path
                            : `${workspaceRoot}/${params.path}`
                    );
                    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
                    if (doc && doc.isDirty) {
                        await doc.save();
                    }
                } else {
                    // Save all dirty documents
                    await vscode.workspace.saveAll(false);
                }

                // Give language servers a moment to update
                await new Promise(resolve => setTimeout(resolve, 500));

                return { success: true, output: 'Diagnostics refreshed. Use get_problems to see current issues.' };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    }
};

export function getVSCodeToolsDescription(): string {
    return Object.values(VSCODE_TOOLS)
        .map(t => {
            const params = Object.entries(t.parameters)
                .map(([name, p]) => `  - ${name}: ${p.description}`)
                .join('\n');
            return `## ${t.name}\n${t.description}\n${params}`;
        })
        .join('\n\n');
}
