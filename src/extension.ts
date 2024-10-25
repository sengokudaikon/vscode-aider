import * as vscode from 'vscode';
import {AiderInterface, AiderTerminal} from './AiderTerminal';
import * as fs from 'fs';
import * as path from 'path';
import {debounce} from './utils';

let ignoredFiles: string[] = [];
let diagnosticCollection: vscode.DiagnosticCollection;
let diagnosticsMap: Map<string, vscode.Diagnostic[]> = new Map();

let customStartupArgs: string = '';

async function updateAiderIgnoreFile(newPattern: string) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }

    const aiderIgnorePath = vscode.Uri.joinPath(workspaceFolder.uri, '.aider.ignore');
    try {
        const currentContent = await vscode.workspace.fs.readFile(aiderIgnorePath);
        const updatedContent = currentContent.toString() + '\n' + newPattern;
        await vscode.workspace.fs.writeFile(aiderIgnorePath, Buffer.from(updatedContent));
    } catch (error) {
        // If the file doesn't exist, create it with the new pattern
        await vscode.workspace.fs.writeFile(aiderIgnorePath, Buffer.from(newPattern));
    }
}

export function convertToRelativePath(filePath: string, workingDirectory: string): string {
    if (path.isAbsolute(filePath)) {
        return path.relative(workingDirectory, filePath);
    }
    return filePath;
}

let aider: AiderInterface | null = null;
let aiderTerminal: vscode.Terminal | null = null;
let filesThatAiderKnows = new Set<string>();
let calculatedWorkingDirectory: string | undefined = undefined;

async function manageIgnoredFiles() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }

    const aiderIgnorePath = vscode.Uri.joinPath(workspaceFolder.uri, '.aider.ignore');
    let ignoredFiles: string[] = [];

    try {
        const fileContent = await vscode.workspace.fs.readFile(aiderIgnorePath);
        ignoredFiles = fileContent.toString().split('\n').filter(line => line.trim() !== '');
    } catch (error) {
        // File doesn't exist or couldn't be read
    }

    const options: vscode.QuickPickOptions = {
        placeHolder: 'Select an action',
        canPickMany: false
    };

    const actions = ['View Ignored Files', 'Add Ignored File Pattern', 'Remove Ignored File Pattern'];
    const selectedAction = await vscode.window.showQuickPick(actions, options);

    if (selectedAction === 'View Ignored Files') {
        if (ignoredFiles.length === 0) {
            vscode.window.showInformationMessage('No files are currently ignored.');
        } else {
            vscode.window.showInformationMessage(`Currently ignored file patterns: ${ignoredFiles.join(', ')}`);
        }
    } else if (selectedAction === 'Add Ignored File Pattern') {
        const pattern = await vscode.window.showInputBox({
            prompt: 'Enter a file pattern to ignore (e.g., *.log, temp/*, etc.)',
            placeHolder: '*.log'
        });
        if (pattern) {
            await updateAiderIgnoreFile(pattern);
            vscode.window.showInformationMessage(`Added "${pattern}" to ignored file patterns.`);
        }
    } else if (selectedAction === 'Remove Ignored File Pattern') {
        const patternToRemove = await vscode.window.showQuickPick(ignoredFiles, {
            placeHolder: 'Select a pattern to remove'
        });
        if (patternToRemove) {
            const updatedContent = ignoredFiles.filter(p => p !== patternToRemove).join('\n');
            await vscode.workspace.fs.writeFile(aiderIgnorePath, Buffer.from(updatedContent));
            vscode.window.showInformationMessage(`Removed "${patternToRemove}" from ignored file patterns.`);
        }
    }
}

let statusBarItem: vscode.StatusBarItem;

async function setupEnvironmentAndModelPrefix(): Promise<{ env: { [key: string]: string } }> {
    const config = vscode.workspace.getConfiguration('aider');
    let env: { [key: string]: string } = {};

    // Check for OpenAI API key first as it's required
    const openAiKey = config.get<string>('openai.apiKey');
    if (!openAiKey) {
        throw new Error('OpenAI API key is required. Please set it in the extension settings (aider.openai.apiKey).');
    }
    env['OPENAI_API_KEY'] = openAiKey;

    // Add any other API keys that are configured
    const apiConfigs = {
        'ANTHROPIC_API_KEY': config.get<string>('anthropic.apiKey'),
        'GEMINI_API_KEY': config.get<string>('gemini.apiKey'),
        'GROQ_API_KEY': config.get<string>('groq.apiKey'),
        'AZURE_API_KEY': config.get<string>('azure.apiKey'),
        'COHERE_API_KEY': config.get<string>('cohere.apiKey'),
        'DEEPSEEK_API_KEY': config.get<string>('deepSeek.apiKey'),
        'OPENROUTER_API_KEY': config.get<string>('openRouter.apiKey'),
        'VERTEX_API_KEY': config.get<string>('vertex.apiKey'),
        'BEDROCK_API_KEY': config.get<string>('bedrock.apiKey')
    };

    // Add any configured API keys to env
    Object.entries(apiConfigs).forEach(([key, value]) => {
        if (value) {
            env[key] = value;
        }
    });

    // Add any additional base URLs if configured
    const baseUrl = config.get<string>('openai.baseUrl');
    if (baseUrl) {
        env['OPENAI_API_BASE'] = baseUrl;
    }
    const ollamaBaseUrl = config.get<string>('ollama.baseUrl');
    if (ollamaBaseUrl) {
        env['OLLAMA_API_BASE'] = ollamaBaseUrl;
    }
    const azureBaseUrl = config.get<string>('azure.baseUrl');
    if (azureBaseUrl) {
        env['AZURE_API_BASE'] = azureBaseUrl;
        const apiVersion = config.get<string>('azure.apiVersion');
        if (apiVersion) {
            env['AZURE_API_VERSION'] = apiVersion;
        } else {
            throw new Error('Azure API version is required');
        }
    }

    return {env};
}

/**
 * Create the Aider interface (currently a terminal) and start it.
 */
async function createAider() {
    try {
        let env: { [key: string]: string } = {};
        if (aider && aider.isActive()) {
            // Close the existing Aider instance
            aider.dispose();
            aider = null;
            if (aiderTerminal) {
                aiderTerminal.dispose();
                aiderTerminal = null;
            }
            filesThatAiderKnows.clear();
        }

        // Check if a model is specified in custom startup args
        if (!customStartupArgs.includes('--model') && !customStartupArgs.includes('-m')) {
            throw new Error('No model specified. Please specify a model using --model in the startup arguments (e.g., --model gpt-4).');
        }

        if (process.platform === 'win32') {
            const response = await vscode.window.showWarningMessage(
                'Aider is not yet fully optimized for Windows. Some features may behave unexpectedly. Do you want to continue?',
                'Yes', 'No'
            );
            if (response !== 'Yes') {
                return;
            }
        }
        if (!statusBarItem) {
            statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
            statusBarItem.show();
        }
        updateStatusBar();
        const config = vscode.workspace.getConfiguration('aider');
        let aiderCommandLine: string = config.get('commandLine') ?? 'aider';
        let workingDirectory: string | undefined = config.get('workingDirectory');

        const gitRoot = findGitRoot(workingDirectory || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
        if (!gitRoot) {
            vscode.window.showErrorMessage('Unable to find Git root directory. Please ensure you are in a Git repository.');
            return;
        }
        calculatedWorkingDirectory = gitRoot;
        let fullCommand = `${aiderCommandLine}`;
        if (customStartupArgs) {
            fullCommand += ` ${customStartupArgs}`;
        }
        const useArchitect = config.get<boolean>('useArchitect', false);
        if (useArchitect && !fullCommand.includes('--architect')) {
            fullCommand += ' --architect';
        }
        const cachePrompts = config.get<boolean>('useCachePrompts', false)
        if (cachePrompts && !fullCommand.includes('--cache-prompts')) {
            fullCommand += ' --cache-prompts'
        }
        const yesAlways = config.get<boolean>('yesAlways', false)
        if (yesAlways && !fullCommand.includes('--yes-always')) {
            fullCommand += ' --yes-always'
        }
        try {
            const result = await setupEnvironmentAndModelPrefix()
            env = result.env;
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Aider configuration error: ${error.message}`)
            } else {
                vscode.window.showErrorMessage(`An unknown error has occured`)
            }
        }
        const defaultModel: string | undefined = config.get<string>('defaultModel');
        if (!defaultModel) {
            vscode.window.showErrorMessage("No default model provided. Please ensure you have configured everything correctly.");
        }
        fullCommand += ` --model ${defaultModel}`;
        const defaultEditorModel: string | undefined = config.get<string>('defaultEditorModel');
        if (useArchitect && !fullCommand.includes('--editor-model') && defaultEditorModel) {
            fullCommand += ` --editor-model ${defaultEditorModel}`
        }
        const defaultWeakModel: string | undefined = config.get<string>('defaultWeakModel');
        if (!fullCommand.includes('--weak-model') && defaultWeakModel) {
            fullCommand += ` --weak-model ${defaultWeakModel}`
        }
        const useVoiceCommands = config.get('useVoiceCommands', false);

        if (useVoiceCommands) {
            // Include OpenAI API key for voice commands
            const openAiApiKey = config.get('openai.apiKey', '');
            if (openAiApiKey) {
                env['OPENAI_API_KEY'] = openAiApiKey;
            } else {
                vscode.window.showWarningMessage('Voice commands are enabled, but OpenAI API key is not set. Please set the API key in the Aider settings.');
            }
        }

        fullCommand = fullCommand.trim();
        aider = new AiderTerminal(env, fullCommand, handleAiderClose, gitRoot);

        if (aider) {
            // Collect all open files from both sources
            const openFiles = new Set<string>();
            vscode.workspace.textDocuments.forEach((document) => {
                if (document.uri.scheme === "file" && document.fileName && aider?.isWorkspaceFile(document.fileName)) {
                    openFiles.add(document.fileName);
                }
            });
            vscode.window.visibleTextEditors.forEach((editor) => {
                if (editor.document.uri.scheme === "file" && editor.document.fileName && aider?.isWorkspaceFile(editor.document.fileName)) {
                    openFiles.add(editor.document.fileName);
                }
            });

            // Add all open files to Aider
            openFiles.forEach((filePath) => {
                filesThatAiderKnows.add(filePath);
            });
            aider.addFiles(Array.from(openFiles));

            aider.show();
            aiderTerminal = (aider as AiderTerminal)._terminal;
        }
    } catch (error) {
        if (error instanceof Error) {
            vscode.window.showWarningMessage("Aider configuration error: " + error.message);
        }
    }
}

/**
 * If the Aider terminal is closed, update local variables to reflect the change.
 */
function handleAiderClose() {
    if (aider) {
        aider.dispose();
        aider = null;
        aiderTerminal = null;
        filesThatAiderKnows.clear();
        updateStatusBar();
    }
}

/**
 * Figure out which files are open in VS Code and which ones are known to be open in Aider.  Synchronize the
 * two.
 *
 * Note this method has a flaw -- if a user opens a file using directly using /add in Aider, we won't know
 * about it.  This might lead to duplicate /add statements.
 */
const syncAiderAndVSCodeFiles = debounce(async () => {
    if (!aider) return;

    // Re-read the .aider.ignore file
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        const aiderIgnorePath = vscode.Uri.joinPath(workspaceFolder.uri, '.aider.ignore');
        try {
            const content = await vscode.workspace.fs.readFile(aiderIgnorePath);
            ignoredFiles = content.toString().split('\n').filter(line => line.trim() !== '');
        } catch (error) {
            console.log('.aider.ignore file not found or couldn\'t be read');
            ignoredFiles = [];
        }
    }

    const filesThatVSCodeKnows = new Set<string>();
    vscode.workspace.textDocuments.forEach((document) => {
        if (document.uri.scheme === "file" && document.fileName && aider?.isWorkspaceFile(document.fileName)) {
            filesThatVSCodeKnows.add(path.normalize(document.fileName));
        }
    });

    const opened = [...filesThatVSCodeKnows].filter(x => !filesThatAiderKnows.has(x));
    const closed = [...filesThatAiderKnows].filter(x => !filesThatVSCodeKnows.has(x));

    const ignoreFilesRegex = ignoredFiles.map((pattern: string) => new RegExp(pattern.replace(/\\/g, '\\\\')));

    const filteredOpened = opened.filter((item) => !ignoreFilesRegex.some((regex: RegExp) => regex.test(item)));
    aider.addFiles(filteredOpened.map(file => path.normalize(file)));

    const filteredClosed = closed.filter((item) => !ignoreFilesRegex.some((regex: RegExp) => regex.test(item)));
    aider.dropFiles(filteredClosed.map(file => path.normalize(file)));

    filesThatAiderKnows = new Set(filesThatVSCodeKnows);
}, 300);

/**
 * Find a working directory for Aider.
 *
 * @returns A promise pointing to a working directory for Aider.
 */
export async function findWorkingDirectory(overridePath?: string): Promise<string> {
    if (overridePath && overridePath.trim() !== '') {
        return overridePath;
    }

    // Get the active text editor's file path
    const activeEditorPath = vscode.window.activeTextEditor?.document.uri.fsPath;

    // If there's an active editor, use its directory
    if (activeEditorPath) {
        return path.dirname(activeEditorPath);
    }

    // If there's a single workspace folder, use it
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length === 1) {
        return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    // If there are multiple workspace folders or none, ask the user to select
    const folders = vscode.workspace.workspaceFolders || [];
    const items: vscode.QuickPickItem[] = [
        ...folders.map(folder => ({label: folder.name, description: folder.uri.fsPath})),
        {label: "Select a folder...", description: ""}
    ];

    const selected = await vscode.window.showQuickPick(items, {placeHolder: "Select a folder to use with Aider"});

    if (selected) {
        if (selected.label === "Select a folder...") {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false
            });
            if (result && result[0]) {
                return result[0].fsPath;
            }
        } else {
            return selected.description!;
        }
    }

    throw new Error("Starting Aider requires a workspace folder. Aborting...");
}

function findGitDirectoryInSelfOrParents(filePath: string): string {
    const parts = filePath.split(path.sep);
    while (parts.length > 0) {
        const dir = path.join(...parts, '.git');
        try {
            if (fs.statSync(dir).isDirectory()) {
                return path.join(...parts);
            }
        } catch (err) {
            // Directory doesn't exist, continue searching
        }
        parts.pop();
    }
    return path.parse(filePath).root;
}

/**
 * If any API Key changes in the settings, restart the Aider terminal so it will use the new
 * API key.
 */
vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('aider.openai.apiKey') || e.affectsConfiguration('aider.anthropic.apiKey') || e.affectsConfiguration('aider.provider') || e.affectsConfiguration('aider.useVoiceCommands')) {
        // Stop the Aider terminal
        if (aider) {
            aider.dispose();
            aider = null;
        }

        // Restart the Aider terminal with the new API key
        createAider();

        // Add all currently open files
        syncAiderAndVSCodeFiles();
    }
});


function updateStatusBar() {
    statusBarItem.text = `🤖 Aider`;
    statusBarItem.command = 'aider.openMenu';
    statusBarItem.tooltip = 'Click to open Aider management menu';
    statusBarItem.show();
}

let voiceCommandKeyPressed: boolean = false;

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar()));
    // Read .aider.ignore file
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        const aiderIgnorePath = vscode.Uri.joinPath(workspaceFolder.uri, '.aider.ignore');
        vscode.workspace.fs.readFile(aiderIgnorePath).then(
            (content) => {
                ignoredFiles = content.toString().split('\n').filter(line => line.trim() !== '');
            },
            (error) => {
                console.log('.aider.ignore file not found or couldn\'t be read');
            }
        );
    }
    context.subscriptions.push(vscode.commands.registerCommand('aider.openMenu', showAiderMenu));

    vscode.workspace.onDidOpenTextDocument(() => syncAiderAndVSCodeFiles());
    vscode.workspace.onDidCloseTextDocument(() => syncAiderAndVSCodeFiles());

    let disposable = vscode.commands.registerCommand('aider.add', function () {
        if (!aider) {
            vscode.window.showErrorMessage("Aider is not running.  Please run the 'Open Aider' command first.");
        }

        // The code you place here will be executed every time your command is executed
        // Get the currently selected file in VS Code
        let activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return; // No open text editor
        }
        let filePath = activeEditor.document.fileName;

        // Send the "/add <filename>" command to the Aider process
        if (aider) {
            filesThatAiderKnows.add(filePath);
            aider.addFile(filePath);
        }
    });

    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('aider.debugInfo', function () {
        console.log(`===============================`)
        console.log(`Working directory: ${calculatedWorkingDirectory}`);
        console.log(`Config working directory: ${vscode.workspace.getConfiguration('aider').get('workingDirectory')}`);
        console.log(`Files that aider knows about:`);
        filesThatAiderKnows.forEach((file) => {
            console.log(`  ${file}`);
        });
        console.log(`Aider object: ${aider}`);
        console.log(`VSCode Workspace Files:`);
        vscode.workspace.textDocuments.forEach((document) => {
            console.log(`  ${document.fileName}`);
        });
        console.log(`VSCode Active Tab Files:`);
        vscode.window.visibleTextEditors.forEach((editor) => {
            console.log(`  ${editor.document.fileName}`);
        });
        console.log(`===============================`)
        vscode.window.showInformationMessage("Open Help->Toggle Developer Tools to see debug info in the 'Console' tab.");
    });

    context.subscriptions.push(disposable)

    disposable = vscode.commands.registerCommand('aider.drop', function () {
        if (!aider) {
            vscode.window.showErrorMessage("Aider is not running.  Please run the 'Open Aider' command first.");
        }

        // The code you place here will be executed every time your command is executed
        // Get the currently selected file in VS Code
        let activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return; // No open text editor
        }
        let filePath = activeEditor.document.fileName;

        // Send the "/drop <filename>" command to the Aider process
        if (aider) {
            filesThatAiderKnows.delete(filePath);
            aider.dropFile(filePath);
        }
    });

    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('aider.syncFiles', async function () {
        if (!aider) {
            vscode.window.showErrorMessage("Aider is not running.  Please run the 'Open Aider' command first.");
        }

        syncAiderAndVSCodeFiles();
    });

    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('aider.open', function () {
        filesThatAiderKnows.clear();
        createAider();
        updateStatusBar();
    });

    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('aider.close', function () {
        if (!aider) {
            vscode.window.showErrorMessage("Aider is not running.  Please run the 'Open Aider' command first.");
        } else {
            filesThatAiderKnows.clear();
            aider.dispose();
            aider = null;
            if (aiderTerminal) {
                aiderTerminal.dispose();
                aiderTerminal = null;
            }
            updateStatusBar();
        }
    });

    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('aider.generateReadme', async function () {
        if (!aider) {
            vscode.window.showErrorMessage("Aider is not running. Please run the 'Open Aider' command first.");
            return;
        }

        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder open. Please open a folder and try again.");
            return;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        try {
            await generateReadmeWithAider(workspaceRoot);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to send README generation request to Aider: ${error}`);
        }
    });

    context.subscriptions.push(disposable);

    // Register the refactor and modify commands
    disposable = vscode.commands.registerCommand('aider.refactorSnippet', () => handleSelectedCode('Refactor'));
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('aider.modifySnippet', () => handleSelectedCode('Modify'));
    context.subscriptions.push(disposable);

    // Register the "Add to Aider" command
    disposable = vscode.commands.registerCommand('aider.addFileToAider', (uri: vscode.Uri) => {
        if (!aider) {
            vscode.window.showErrorMessage("Aider is not running. Please run the 'Open Aider' command first.");
            return;
        }

        const filePath = uri.fsPath;
        aider.addFile(filePath);
        filesThatAiderKnows.add(filePath);
        vscode.window.showInformationMessage(`Added ${path.basename(filePath)} to Aider.`);
    });
    context.subscriptions.push(disposable);

    // Register the "Add to Aider as Read-Only" command
    disposable = vscode.commands.registerCommand('aider.addReadOnlyFileToAider', (uri: vscode.Uri) => {
        if (!aider) {
            vscode.window.showErrorMessage("Aider is not running. Please run the 'Open Aider' command first.");
            return;
        }

        const filePath = uri.fsPath;
        aider.addReadOnlyFile(filePath);
        filesThatAiderKnows.add(filePath);
        vscode.window.showInformationMessage(`Added ${path.basename(filePath)} to Aider as read-only.`);
    });
    context.subscriptions.push(disposable);

    // Register the command to set startup arguments
    disposable = vscode.commands.registerCommand('aider.setStartupArgs', setCustomStartupArgs);
    context.subscriptions.push(disposable);

    // Register the command to manage ignored files
    disposable = vscode.commands.registerCommand('aider.manageIgnoredFiles', manageIgnoredFiles);
    context.subscriptions.push(disposable);

    // Register the command to ignore a file
    disposable = vscode.commands.registerCommand('aider.ignoreFile', ignoreFile);
    context.subscriptions.push(disposable);

    // Register the command to fix errors with Aider
    disposable = vscode.commands.registerCommand('aider.fixError', async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic) => {
        if (!aider) {
            vscode.window.showErrorMessage("Aider is not running. Please run the 'Open Aider' command first.");
            return;
        }

        const filePath = document.uri.fsPath;
        const lineNumber = diagnostic.range.start.line + 1;
        const errorMessage = diagnostic.message;
        const code = document.getText(diagnostic.range);

        const prompt = `Fix "${errorMessage}" in file ${filePath} at line ${lineNumber}. The problematic code is:\n\n${code}`;
        aider.sendCommand(prompt);
        vscode.window.showInformationMessage('Error sent to Aider for fixing. Please check the Aider terminal for the response.');
    });
    context.subscriptions.push(disposable);

    // Create a diagnostic collection to store and manage diagnostics
    diagnosticCollection = vscode.languages.createDiagnosticCollection('aider');
    context.subscriptions.push(diagnosticCollection);

    // Listen for changes in diagnostics
    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(onDidChangeDiagnostics));
    // Listen for voice input
    const voiceCommandDisposable = vscode.commands.registerCommand('aider.voiceCommand', () => {
        const useVoiceCommands = vscode.workspace.getConfiguration('aider').get('useVoiceCommands', false);

        if (useVoiceCommands) {
            if (aider) {
                aider.toggleVoiceCommand(voiceCommandKeyPressed);
            } else {
                vscode.window.showInformationMessage('Aider is not active. Please start Aider before using voice commands.');
            }
        } else {
            vscode.window.showInformationMessage('Voice commands are not enabled. Please enable them in Aider settings to use this feature.');
        }
    });
    context.subscriptions.push(voiceCommandDisposable);

    // Register a code action provider
    class AiderCodeActionProvider implements vscode.CodeActionProvider {
        provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
            const diagnostics = diagnosticsMap.get(document.uri.toString()) || [];
            return diagnostics
                .filter(diagnostic => range.intersection(diagnostic.range))
                .map(diagnostic => this.createCommandCodeAction(document, diagnostic));
        }

        private createCommandCodeAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
            const action = new vscode.CodeAction('Fix with Aider', vscode.CodeActionKind.QuickFix);
            action.command = {
                command: 'aider.fixError',
                title: 'Fix with Aider',
                arguments: [document, diagnostic]
            };
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            return action;
        }
    }

    context.subscriptions.push(vscode.languages.registerCodeActionsProvider('*', new AiderCodeActionProvider(), {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    }));

    function onDidChangeDiagnostics(event: vscode.DiagnosticChangeEvent) {
        for (const uri of event.uris) {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            diagnosticsMap.set(uri.toString(), diagnostics);
        }
    }

    async function updateAiderIgnoreFile(newPattern?: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        const aiderIgnorePath = vscode.Uri.joinPath(workspaceFolder.uri, '.aider.ignore');
        if (newPattern) {
            ignoredFiles.push(newPattern);
        }
        await vscode.workspace.fs.writeFile(aiderIgnorePath, Buffer.from(ignoredFiles.join('\n')));
    }

    async function ignoreFile(uri: vscode.Uri) {
        if (!uri) {
            vscode.window.showErrorMessage("No file selected.");
            return;
        }

        const filePath = vscode.workspace.asRelativePath(uri);
        await updateAiderIgnoreFile(filePath);
        vscode.window.showInformationMessage(`Added ${filePath} to ignored files.`);

        // Refresh the ignoredFiles array
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const aiderIgnorePath = vscode.Uri.joinPath(workspaceFolder.uri, '.aider.ignore');
            const content = await vscode.workspace.fs.readFile(aiderIgnorePath);
            ignoredFiles = content.toString().split('\n').filter(line => line.trim() !== '');
        }
    }

    async function generateReadmeWithAider(workspaceRoot: string): Promise<void> {
        if (!aider) {
            throw new Error("Aider is not running");
        }

        const prompt = `Generate a comprehensive, user-friendly, and developer-friendly README.md file for the project in the current workspace. The README should be tailored to the specific needs and nature of the project. Include the following sections: 1. Project Title and Description 2. Features 3. Prerequisites 4. Installation 5. Usage 6. Configuration 7. API Reference (if applicable) 8. Contributing 9. Testing 10. Deployment (if applicable) 11. Built With (technologies used) 12. Versioning 13. Authors 14. License 15. Acknowledgments. For each section, provide detailed and relevant information based on the project files and structure. Ensure the content is clear, concise, and helpful for both users and developers. If any section is not applicable to this project, you may omit it. Additionally: Use proper Markdown formatting for headers, lists, code blocks, etc. Include badges where appropriate (e.g., build status, version, license). If it's an open-source project, include information on how to contribute. Add a table of contents for easy navigation. Include examples and screenshots if possible. Please generate the README content now.`;

        aider.sendCommand(prompt.replace(/\n/g, ' ').trim());
        vscode.window.showInformationMessage('README generation request sent to Aider. Please wait for the response.');
    }
}

class RefactorCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
        const refactorAction = new vscode.CodeAction('Refactor with Aider', vscode.CodeActionKind.RefactorRewrite);
        refactorAction.command = {
            command: 'aider.refactorSnippet',
            title: 'Refactor with Aider',
            arguments: [document, range]
        };
        return [refactorAction];
    }
}

async function handleSelectedCode(action: 'Refactor' | 'Modify') {
    if (!aider) {
        vscode.window.showErrorMessage("Aider is not running. Please run the 'Open Aider' command first.");
        return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active text editor.");
        return;
    }

    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (!text.trim()) {
        vscode.window.showErrorMessage("No text selected. Please select a code snippet to refactor or modify.");
        return;
    }

    const task = action === 'Refactor'
        ? "Refactor the following code to improve its structure, performance and readability without changing its functionality:"
        : await vscode.window.showInputBox({
            prompt: "Enter the modification task or instruction",
            placeHolder: "e.g., Add error handling, Implement a new feature, etc."
        });

    if (!task) {
        return; // User cancelled the input for Modify action
    }

    const filePath = editor.document.uri.fsPath;
    const relativePath = vscode.workspace.asRelativePath(filePath);
    const lineNumber = selection.start.line + 1;

    const prompt = `${task}\n\nFile: ${relativePath}\nLine: ${lineNumber}`;

    aider.sendCommand(prompt.replace(/\r?\n|\r/g, ' ').trim());
    vscode.window.showInformationMessage(`${action} request sent to Aider. Please wait for the response.`);
}

async function setCustomStartupArgs() {
    const args = await vscode.window.showInputBox({
        prompt: 'Enter custom startup arguments for Aider',
        placeHolder: 'e.g. --no-auto-commits --dark-mode',
        value: customStartupArgs
    });

    if (args !== undefined) {
        customStartupArgs = args;
        vscode.window.showInformationMessage(`Custom startup arguments set to: ${customStartupArgs}`);

        // If Aider is running, inform the user that they need to restart it
        if (aider && aider.isActive()) {
            vscode.window.showInformationMessage('Please restart Aider for the new startup arguments to take effect.');
        }
    }
}


export function deactivate() {
    if (aider && aider.voiceCommandTimeout) {
        clearTimeout(aider.voiceCommandTimeout);
    }
}

async function showAiderMenu() {
    const items: vscode.QuickPickItem[] = [
        {
            label: aider && aider.isActive() ? '$(stop-circle) Close Aider' : '$(play-circle) Open Aider',
            description: aider && aider.isActive() ? 'Close the current Aider session' : 'Start a new Aider session'
        },
        {
            label: '$(sync) Sync Files',
            description: 'Synchronize open files with Aider'
        },
        {
            label: '$(gear) Set Custom Startup Arguments',
            description: 'Set custom arguments for Aider startup'
        },
        {
            label: '$(file-submodule) Manage Ignored Files',
            description: 'Manage files to ignore in Aider'
        },
        {
            label: '$(question) Help',
            description: 'Open Aider documentation'
        }
    ];

    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an Aider action'
    });

    if (selection) {
        switch (selection.label) {
            case '$(play-circle) Open Aider':
                vscode.commands.executeCommand('aider.open');
                break;
            case '$(stop-circle) Close Aider':
                vscode.commands.executeCommand('aider.close');
                break;
            case '$(sync) Sync Files':
                vscode.commands.executeCommand('aider.syncFiles');
                break;
            case '$(gear) Set Custom Startup Arguments':
                await setCustomStartupArgs();
                break;
            case '$(file-submodule) Manage Ignored Files':
                await manageIgnoredFiles();
                break;
            case '$(question) Help':
                vscode.env.openExternal(vscode.Uri.parse('https://aider.chat/'));
                break;
        }
    }
}

function findGitRoot(startPath: string): string | null {
    let currentPath = startPath;
    while (currentPath !== path.parse(currentPath).root) {
        if (fs.existsSync(path.join(currentPath, '.git'))) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }
    return null;
}