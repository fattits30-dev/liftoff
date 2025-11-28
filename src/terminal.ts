// Liftoff Terminal - Real VS Code terminal for agent operations
import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * A real VS Code terminal that agents can use to run commands
 * Output is visible in the terminal panel in real-time
 */
export class LiftoffTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number>();
    
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose: vscode.Event<number> = this.closeEmitter.event;
    
    private currentProcess: ChildProcess | null = null;
    private commandQueue: Array<{
        command: string;
        cwd: string;
        timeout: number;
        resolve: (result: { output: string; exitCode: number }) => void;
    }> = [];
    private isRunning = false;
    private outputBuffer = '';

    open(): void {
        this.writeLine('🚀 Liftoff Terminal Ready');
        this.writeLine('─'.repeat(50));
        this.writeLine('');
    }

    close(): void {
        if (this.currentProcess) {
            this.currentProcess.kill();
        }
    }

    handleInput(data: string): void {
        // Allow Ctrl+C to kill current process
        if (data === '\x03' && this.currentProcess) {
            this.currentProcess.kill('SIGINT');
            this.writeLine('\r\n^C');
        }
    }

    private write(text: string): void {
        this.writeEmitter.fire(text);
    }

    private writeLine(text: string): void {
        this.write(text + '\r\n');
    }

    /**
     * Run a command and return the full output
     */
    public async runCommand(command: string, cwd: string, timeout: number = 60000): Promise<{ output: string; exitCode: number }> {
        return new Promise((resolve) => {
            this.commandQueue.push({ command, cwd, resolve, timeout });
            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.isRunning || this.commandQueue.length === 0) return;
        
        this.isRunning = true;
        const { command, cwd, timeout, resolve } = this.commandQueue.shift()!;
        let timeoutId: NodeJS.Timeout | null = null;
        let resolved = false;
        
        const safeResolve = (result: { output: string; exitCode: number }) => {
            if (resolved) return;
            resolved = true;
            if (timeoutId) clearTimeout(timeoutId);
            resolve(result);
        };
        
        this.outputBuffer = '';
        
        this.writeLine(`\r\n📂 ${cwd}`);
        this.writeLine(`$ ${command}`);
        this.writeLine('');

        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
        const shellArgs = process.platform === 'win32' 
            ? ['-NoProfile', '-NoLogo', '-Command', command] 
            : ['-c', command];

        this.currentProcess = spawn(shell, shellArgs, {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'], // Explicitly pipe all streams
            env: { 
                ...process.env, 
                FORCE_COLOR: '0',  // Disable colors for better capture
                NO_COLOR: '1',
                PYTHONUNBUFFERED: '1',  // Force Python unbuffered output
                CI: '1',  // Many tools output more in CI mode
            },
            windowsHide: true, // Don't show console window on Windows
        });

        // Set encoding for text mode (avoids Buffer issues)
        if (this.currentProcess.stdout) {
            this.currentProcess.stdout.setEncoding('utf8');
            this.currentProcess.stdout.on('data', (data: string) => {
                this.outputBuffer += data;
                this.write(data.replace(/\n/g, '\r\n'));
            });
        } else {
            this.writeLine('⚠️ Warning: stdout not available');
        }

        if (this.currentProcess.stderr) {
            this.currentProcess.stderr.setEncoding('utf8');
            this.currentProcess.stderr.on('data', (data: string) => {
                this.outputBuffer += data;
                this.write(data.replace(/\n/g, '\r\n'));
            });
        } else {
            this.writeLine('⚠️ Warning: stderr not available');
        }

        this.currentProcess.on('close', (code) => {
            const exitCode = code ?? 0;
            this.writeLine('');
            this.writeLine(`─ Exit code: ${exitCode} ─`);
            this.writeLine('');
            
            this.currentProcess = null;
            this.isRunning = false;
            
            // Debug: log output length
            this.writeLine(`[Debug: captured ${this.outputBuffer.length} chars]`);
            
            safeResolve({ output: this.outputBuffer, exitCode });
            
            // Process next command if any
            this.processQueue();
        });

        this.currentProcess.on('error', (err) => {
            this.writeLine(`\r\n❌ Error: ${err.message}`);
            this.currentProcess = null;
            this.isRunning = false;
            
            safeResolve({ output: this.outputBuffer + `\nError: ${err.message}`, exitCode: -1 });
            this.processQueue();
        });
        
        // Set timeout to prevent hanging
        timeoutId = setTimeout(() => {
            if (this.currentProcess) {
                this.writeLine(`\r\n⏰ Command timed out after ${timeout/1000}s`);
                this.currentProcess.kill('SIGTERM');
                this.currentProcess = null;
                this.isRunning = false;
                
                safeResolve({ 
                    output: this.outputBuffer + `\n[Timed out after ${timeout/1000}s]`, 
                    exitCode: -1 
                });
                this.processQueue();
            }
        }, timeout);
    }
}

// Singleton terminal manager
class TerminalManager {
    private terminal: vscode.Terminal | null = null;
    private pty: LiftoffTerminal | null = null;

    public getTerminal(): { terminal: vscode.Terminal; pty: LiftoffTerminal } {
        // Check if terminal still exists
        if (this.terminal) {
            const exists = vscode.window.terminals.includes(this.terminal);
            if (!exists) {
                this.terminal = null;
                this.pty = null;
            }
        }

        if (!this.terminal || !this.pty) {
            this.pty = new LiftoffTerminal();
            this.terminal = vscode.window.createTerminal({
                name: '🚀 Liftoff',
                pty: this.pty,
                iconPath: new vscode.ThemeIcon('rocket'),
            });
        }

        return { terminal: this.terminal, pty: this.pty };
    }

    public show(): void {
        const { terminal } = this.getTerminal();
        terminal.show(false); // false = don't take focus
    }

    public async runCommand(command: string, cwd: string, timeout?: number): Promise<{ output: string; exitCode: number }> {
        const { terminal, pty } = this.getTerminal();
        terminal.show(false);
        return pty.runCommand(command, cwd, timeout);
    }

    public dispose(): void {
        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = null;
            this.pty = null;
        }
    }
}

// Export singleton
let instance: TerminalManager | null = null;

export function getLiftoffTerminal(): TerminalManager {
    if (!instance) {
        instance = new TerminalManager();
    }
    return instance;
}

export function disposeLiftoffTerminal(): void {
    if (instance) {
        instance.dispose();
        instance = null;
    }
}
