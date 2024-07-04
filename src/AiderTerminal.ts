import * as vscode from 'vscode';
import * as os from 'os';
import { convertToRelativePath } from './extension';

export interface AiderInterface {
    addFile(filePath: string) : void;
    addFiles(filePaths: string[]) : void;
    dispose() : void;
    dropFile(filePath: string) : void;
    dropFiles(filePaths: string[]) : void;
    isWorkspaceFile(filePath: string) : boolean;
    sendCommand(command: string) : void;    
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
            opts['shellArgs'] = ['/k', 'cd ' + this._workingDirectory];
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

    addFile(filePath: string) : void {
        const relativePath = convertToRelativePath(filePath, this._workingDirectory);
        this._terminal.sendText(this.formatCommand(`/add ${relativePath}`));
    }

    addFiles(filePaths: string[]) : void {
        if (filePaths.length === 0) {
            return;
        }

        const relativePaths = filePaths.map(filePath => convertToRelativePath(filePath, this._workingDirectory));
        this._terminal.sendText(this.formatCommand(`/add ${relativePaths.join(' ')}`));
    }

    dropFile(filePath: string) : void {
        this._terminal.sendText(this.formatCommand(`/drop ${this.getRelativeDirectory(filePath)}`));
    }

    dropFiles(filePaths: string[]) : void {
        if (filePaths.length === 0) {
            return;
        }

        this._terminal.sendText(this.formatCommand(`/drop ${filePaths.map((filePath) => this.getRelativeDirectory(filePath)).join(' ')}`));
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

    sendCommand(command: string) : void {
        this._terminal.sendText(this.formatCommand(command));
    }

    show(): void {
        this._terminal.show();
    }

    private formatCommand(command: string): string {
        return process.platform === 'win32' ? `${command}${os.EOL}` : command;
    }
}

