import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export interface AiderInterface {
    voiceCommandTimeout: NodeJS.Timeout | null;
    addFile(filePath: string): void;

    addFiles(filePaths: string[]): void;

    dropFile(filePath: string): void;

    dropFiles(filePaths: string[]): void;

    addReadOnlyFile(filePath: string): void;

    addReadOnlyFiles(filePaths: string[]): void;

    sendCommand(command: string, paths?: string[]): void;

    isWorkspaceFile(filePath: string): boolean;

    isActive(): boolean;

    show(): void;

    dispose(): void;

    onResponse(handler: (response: string) => void): void;

    offResponse(handler: (response: string) => void): void;

    toggleVoiceCommand(isKeyDown: boolean): void;
}

export class AiderTerminal implements AiderInterface {
    _terminal: vscode.Terminal;
    _workingDirectory: string = '';
    _gitWorkingDirectory: string | null = null;
    _onDidCloseTerminal: () => void;
    _isActive: boolean = true;
    private responseHandlers: ((response: string) => void)[] = [];
    private voiceCommandActive: boolean = false;
    voiceCommandTimeout: NodeJS.Timeout | null = null;
    toggleVoiceCommand(): void {
        if (!this.voiceCommandActive) {
            this.sendCommand('/voice');
            this.voiceCommandActive = true;
        } else {
            if (this.voiceCommandTimeout) {
                clearTimeout(this.voiceCommandTimeout);
            }
            this.voiceCommandTimeout = setTimeout(() => {
                this.sendEnter();
                this.voiceCommandActive = false;
                this.voiceCommandTimeout = null;
            }, 500); // 500ms delay, adjust as needed
        }
    }

    constructor(env: { [key: string]: string }, aiderCommand: string, onDidCloseTerminal: () => void, workingDirectory: string) {
        this._workingDirectory = this.findProjectRoot(workingDirectory);
        this._gitWorkingDirectory = this.findGitWorkingDirectory(this._workingDirectory);
        let opts: vscode.TerminalOptions = {
            'name': "Aider",
            'cwd': this._workingDirectory,
        };

        if (Object.keys(env).length > 0) {
            opts['env'] = env;
        }

        if (process.platform === 'win32') {
            opts['shellPath'] = 'powershell.exe';
            opts['shellArgs'] = [
                '-NoExit',
                '-Command',
                `Set-Location -Path '${this._workingDirectory}'; Add-Type -AssemblyName System.Windows.Forms;`
            ];
        } else {
            opts['shellPath'] = '/bin/sh';
            opts['shellArgs'] = ['-c', `cd "${this._workingDirectory}" && exec $SHELL`];
        }

        this._terminal = vscode.window.createTerminal(opts);

        this._onDidCloseTerminal = onDidCloseTerminal;
        vscode.window.onDidCloseTerminal((closedTerminal) => {
            if (closedTerminal === this._terminal) {
                this._onDidCloseTerminal();
            }
        });

        this._terminal.show();
        this._terminal.sendText(aiderCommand);
    }
    private getRelativeDirectory(filePath: string) {
        if (!this._workingDirectory) {
            return filePath;
        }

        return filePath.substring(this._workingDirectory.length);
    }

    private formatPath(filePath: string): string {
        const relativePath = path.relative(this._gitWorkingDirectory || this._workingDirectory, filePath);
        return relativePath.replace(/\\/g, '/');
    }

    isWorkspaceFile(filePath: string): boolean {
        const rootDir = this._gitWorkingDirectory || this._workingDirectory;
        return filePath.startsWith(rootDir);
    }

    sendCommand(command: string, paths?: string[]): void {
        let fullCommand: string;
        if (paths) {
            const formattedPaths = paths.map(p => {
                const formatted = this.formatPath(p);
                return formatted.includes(' ') ? `"${formatted}"` : formatted;
            }).join(' ');
            fullCommand = `${command} ${formattedPaths}`;
        } else {
            fullCommand = command;
        }

        // Remove all whitespace, line breaks, and symbols that might cause breaks
        fullCommand = fullCommand.replace(/\s+/g, ' ').trim();

        this._terminal.sendText(fullCommand, true);
    }

    addFile(filePath: string): void {
        this.sendCommand('/add', [filePath]);
    }

    addFiles(filePaths: string[]): void {
        if (filePaths.length > 0) {
            this.sendCommand('/add', filePaths);
        }
    }

    dropFile(filePath: string): void {
        this.sendCommand('/drop', [filePath]);
    }

    dropFiles(filePaths: string[]): void {
        if (filePaths.length > 0) {
            this.sendCommand('/drop', filePaths);
        }
    }

    addReadOnlyFile(filePath: string): void {
        this.sendCommand('/read-only', [filePath]);
    }

    addReadOnlyFiles(filePaths: string[]): void {
        if (filePaths.length > 0) {
            this.sendCommand('/read-only', filePaths);
        }
    }

    dispose(): void {
        if (this._isActive) {
            this._terminal.sendText(this.formatCommand("/exit"));
            this._terminal.dispose();
        }
        this._isActive = false;
    }

    isActive(): boolean {
        return this._isActive;
    }

    show(): void {
        this._terminal.show();
    }

    onResponse(handler: (response: string) => void): void {
        this.responseHandlers.push(handler);
    }

    offResponse(handler: (response: string) => void): void {
        this.responseHandlers = this.responseHandlers.filter(h => h !== handler);
    }

    private formatCommand(command: string): string {
        return `${command}${os.EOL}`;
    }

    private findProjectRoot(startPath: string): string {
        let currentPath = startPath;
        while (currentPath !== path.parse(currentPath).root) {
            if (fs.existsSync(path.join(currentPath, 'package.json')) ||
                fs.existsSync(path.join(currentPath, '.git'))) {
                return currentPath;
            }
            currentPath = path.dirname(currentPath);
        }
        return startPath; // If no project root found, return the original path
    }

    private findGitWorkingDirectory(startPath: string): string | null {
        let currentPath = startPath;
        while (currentPath !== path.parse(currentPath).root) {
            const gitDir = path.join(currentPath, '.git');
            if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
                return currentPath;
            }
            currentPath = path.dirname(currentPath);
        }
        return null;
    }

    // You'll need to implement a method to capture terminal output and call the response handlers
    private handleTerminalOutput(output: string): void {
        this.responseHandlers.forEach(handler => handler(output));
    }

    sendVoiceCommand(): void {
        this.sendCommand('/voice');
    }

    sendEnter(): void {
        if (os.platform() === 'win32') {                                                                          
            // For Windows, send a carriage return without a newline                                              
            this._terminal.sendText('\r', false);                                                                 
        } else {                                                                                                  
            // For macOS and Linux, send an empty string with a newline                                           
            this._terminal.sendText('', true);                                                                    
        }   
    }
}

