import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { convertToRelativePath } from './extension';

export interface AiderInterface {
    addFile(filePath: string) : void;
    addFiles(filePaths: string[]) : void;
    dispose() : void;
    dropFile(filePath: string) : void;
    dropFiles(filePaths: string[]) : void;
    isWorkspaceFile(filePath: string) : boolean;
    sendCommand(command: string, paths?: string[]) : void;    
    show(): void;
    isActive(): boolean;
}

export class AiderTerminal implements AiderInterface {
    _terminal: vscode.Terminal;
    _workingDirectory: string = '';
    _onDidCloseTerminal: () => void;
    _isActive: boolean = true;

    constructor(openaiAPIKey: string | null | undefined, anthropicAPIKey: string | null | undefined, aiderCommand: string, onDidCloseTerminal: () => void, workingDirectory: string, modelOption: string) {
        this._workingDirectory = workingDirectory;

        let opts: vscode.TerminalOptions = {
            'name': "Aider",
            'cwd': this._workingDirectory,
        };

        let env: { [key: string]: string } = {};
        if (openaiAPIKey) {
            env["OPENAI_API_KEY"] = openaiAPIKey;
        }
        if (anthropicAPIKey) {
            env["ANTHROPIC_API_KEY"] = anthropicAPIKey;
        }

        if (Object.keys(env).length > 0) {
            opts['env'] = env;
        }

        if (process.platform === 'win32') {
            opts['shellPath'] = 'cmd.exe';
            opts['shellArgs'] = ['/k', `cd /d "${this._workingDirectory}"`];
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
        this._terminal.sendText(`${aiderCommand} ${modelOption}`);
    }

    private getRelativeDirectory(filePath: string) {
        if (!this._workingDirectory) {
            return filePath;
        }

        return filePath.substring(this._workingDirectory.length);
    }

    private formatPath(filePath: string): string {
        const relativePath = path.relative(this._workingDirectory, filePath);
        return relativePath.replace(/\\/g, '/');
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
        this._terminal.sendText(fullCommand + os.EOL);
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

    dispose() : void {
        if (this._isActive) {
            this._terminal.sendText(this.formatCommand("/exit"));
            this._terminal.dispose();
        }
        this._isActive = false;
    }

    isActive(): boolean {
        return this._isActive;
    }

    isWorkspaceFile(filePath: string) : boolean {
        return filePath.startsWith(this._workingDirectory);
    }


    show(): void {
        this._terminal.show();
    }

    private formatCommand(command: string): string {
        return `${command}${os.EOL}`;
    }
}

