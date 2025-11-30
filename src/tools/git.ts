// Git tools for version control operations
import { Tool } from './index';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runGit(args: string, cwd: string): Promise<{ success: boolean; output: string; error?: string }> {
    try {
        const { stdout, stderr } = await execAsync(`git ${args}`, { 
            cwd, 
            maxBuffer: 1024 * 1024 * 5,
            timeout: 30000
        });
        return { success: true, output: stdout.trim() + (stderr ? `\n${stderr.trim()}` : '') };
    } catch (e: any) {
        return { success: false, output: e.stdout || '', error: e.stderr || e.message };
    }
}

export const GIT_TOOLS: Record<string, Tool> = {
    git_status: {
        name: 'git_status',
        description: 'Get current git status - shows modified, staged, and untracked files',
        parameters: {},
        async execute(params, workspaceRoot) {
            const result = await runGit('status --porcelain', workspaceRoot);
            if (!result.success) return { success: false, output: '', error: result.error };
            
            if (!result.output.trim()) {
                return { success: true, output: 'Working directory clean - no changes' };
            }
            
            const lines = result.output.split('\n').filter(l => l.trim());
            const modified = lines.filter(l => l.startsWith(' M') || l.startsWith('M ')).map(l => l.slice(3));
            const added = lines.filter(l => l.startsWith('A ') || l.startsWith('??')).map(l => l.slice(3));
            const deleted = lines.filter(l => l.startsWith(' D') || l.startsWith('D ')).map(l => l.slice(3));
            
            let output = `Git Status:\n`;
            if (modified.length) output += `\nModified (${modified.length}):\n  ${modified.join('\n  ')}`;
            if (added.length) output += `\nNew/Untracked (${added.length}):\n  ${added.join('\n  ')}`;
            if (deleted.length) output += `\nDeleted (${deleted.length}):\n  ${deleted.join('\n  ')}`;
            
            return { success: true, output };
        }
    },

    git_diff: {
        name: 'git_diff',
        description: 'Show changes in working directory or for a specific file',
        parameters: {
            file: { type: 'string', description: 'Specific file to diff (optional)' },
            staged: { type: 'boolean', description: 'Show staged changes instead of unstaged' }
        },
        async execute(params, workspaceRoot) {
            const staged = params.staged ? '--staged' : '';
            const file = params.file || '';
            const result = await runGit(`diff ${staged} ${file}`.trim(), workspaceRoot);
            
            if (!result.success) return { success: false, output: '', error: result.error };
            if (!result.output.trim()) {
                return { success: true, output: 'No changes to show' };
            }
            
            // Truncate if too long
            const output = result.output.length > 5000 
                ? result.output.substring(0, 5000) + '\n... (truncated)'
                : result.output;
            
            return { success: true, output };
        }
    },

    git_commit: {
        name: 'git_commit',
        description: 'Stage all changes and commit with a message',
        parameters: {
            message: { type: 'string', description: 'Commit message', required: true },
            files: { type: 'string', description: 'Specific files to commit (space-separated), or empty for all' }
        },
        async execute(params, workspaceRoot) {
            // Stage files
            const files = params.files || '.';
            const addResult = await runGit(`add ${files}`, workspaceRoot);
            if (!addResult.success) return { success: false, output: '', error: addResult.error };
            
            // Commit
            const message = params.message.replace(/"/g, '\\"');
            const commitResult = await runGit(`commit -m "${message}"`, workspaceRoot);
            
            if (!commitResult.success) {
                if (commitResult.error?.includes('nothing to commit')) {
                    return { success: true, output: 'Nothing to commit - working directory clean' };
                }
                return { success: false, output: '', error: commitResult.error };
            }
            
            return { success: true, output: `Committed: ${params.message}\n${commitResult.output}` };
        }
    },

    git_undo: {
        name: 'git_undo',
        description: 'Undo the last commit (keeps changes in working directory) or discard uncommitted changes',
        parameters: {
            mode: { type: 'string', description: '"soft" = undo last commit, "hard" = discard all uncommitted changes, "file" = discard changes to specific file', required: true },
            file: { type: 'string', description: 'File to restore (only for mode="file")' }
        },
        async execute(params, workspaceRoot) {
            if (params.mode === 'soft') {
                const result = await runGit('reset --soft HEAD~1', workspaceRoot);
                if (!result.success) return { success: false, output: '', error: result.error };
                return { success: true, output: 'Undid last commit. Changes are now unstaged.' };
            }
            
            if (params.mode === 'hard') {
                const result = await runGit('checkout -- .', workspaceRoot);
                if (!result.success) return { success: false, output: '', error: result.error };
                return { success: true, output: 'Discarded all uncommitted changes.' };
            }
            
            if (params.mode === 'file' && params.file) {
                const result = await runGit(`checkout -- "${params.file}"`, workspaceRoot);
                if (!result.success) return { success: false, output: '', error: result.error };
                return { success: true, output: `Restored ${params.file} to last committed state.` };
            }
            
            return { success: false, output: '', error: 'Invalid mode. Use "soft", "hard", or "file".' };
        }
    },

    git_log: {
        name: 'git_log',
        description: 'Show recent commit history',
        parameters: {
            count: { type: 'number', description: 'Number of commits to show (default 10)' }
        },
        async execute(params, workspaceRoot) {
            const count = params.count || 10;
            const result = await runGit(`log --oneline -${count}`, workspaceRoot);
            if (!result.success) return { success: false, output: '', error: result.error };
            return { success: true, output: `Recent commits:\n${result.output}` };
        }
    },

    git_branch: {
        name: 'git_branch',
        description: 'List branches, create new branch, or switch branches',
        parameters: {
            action: { type: 'string', description: '"list", "create", or "switch"', required: true },
            name: { type: 'string', description: 'Branch name (for create/switch)' }
        },
        async execute(params, workspaceRoot) {
            if (params.action === 'list') {
                const result = await runGit('branch -a', workspaceRoot);
                if (!result.success) return { success: false, output: '', error: result.error };
                return { success: true, output: `Branches:\n${result.output}` };
            }
            
            if (params.action === 'create' && params.name) {
                const result = await runGit(`checkout -b "${params.name}"`, workspaceRoot);
                if (!result.success) return { success: false, output: '', error: result.error };
                return { success: true, output: `Created and switched to branch: ${params.name}` };
            }
            
            if (params.action === 'switch' && params.name) {
                const result = await runGit(`checkout "${params.name}"`, workspaceRoot);
                if (!result.success) return { success: false, output: '', error: result.error };
                return { success: true, output: `Switched to branch: ${params.name}` };
            }
            
            return { success: false, output: '', error: 'Invalid action or missing branch name' };
        }
    },

    git_stash: {
        name: 'git_stash',
        description: 'Stash or restore uncommitted changes',
        parameters: {
            action: { type: 'string', description: '"save", "pop", or "list"', required: true },
            message: { type: 'string', description: 'Stash message (for save)' }
        },
        async execute(params, workspaceRoot) {
            if (params.action === 'save') {
                const msg = params.message ? `-m "${params.message}"` : '';
                const result = await runGit(`stash ${msg}`.trim(), workspaceRoot);
                if (!result.success) return { success: false, output: '', error: result.error };
                return { success: true, output: 'Changes stashed successfully' };
            }
            
            if (params.action === 'pop') {
                const result = await runGit('stash pop', workspaceRoot);
                if (!result.success) return { success: false, output: '', error: result.error };
                return { success: true, output: 'Restored stashed changes' };
            }
            
            if (params.action === 'list') {
                const result = await runGit('stash list', workspaceRoot);
                if (!result.success) return { success: false, output: '', error: result.error };
                return { success: true, output: result.output || 'No stashes' };
            }
            
            return { success: false, output: '', error: 'Invalid action. Use "save", "pop", or "list".' };
        }
    }
};

export function getGitToolsDescription(): string {
    return Object.values(GIT_TOOLS)
        .map(t => `- ${t.name}: ${t.description}`)
        .join('\n');
}
