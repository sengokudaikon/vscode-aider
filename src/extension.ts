import * as vscode from 'vscode';
import { AiderInterface, AiderTerminal } from './AiderTerminal';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let customStartupArgs: string = '';

export function convertToRelativePath(filePath: string, workingDirectory: string): string {
    if (path.isAbsolute(filePath)) {
        return path.relative(workingDirectory, filePath);
    }
    return filePath;
}

let aider: AiderInterface | null = null;
let filesThatAiderKnows = new Set<string>();
let calculatedWorkingDirectory: string | undefined = undefined;
let selectedModel: string = '--sonnet'; // Default model
let statusBarItem: vscode.StatusBarItem;

/**
 * Create the Aider interface (currently a terminal) and start it.
 */
async function createAider() {
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
    let openaiApiKey: string | null | undefined = config.get('openaiApiKey');
    let anthropicApiKey: string | null | undefined = config.get('anthropicApiKey');
    let aiderCommandLine: string = config.get('commandLine') ?? 'aider';
    let workingDirectory: string | undefined = config.get('workingDirectory');

    findWorkingDirectory(workingDirectory).then((workingDirectory) => {
        calculatedWorkingDirectory = workingDirectory;
        let fullCommand = `${aiderCommandLine}`;
        if (selectedModel !== 'custom') {
            fullCommand += ` ${selectedModel}`;
        }
        if (customStartupArgs) {
            fullCommand += ` ${customStartupArgs}`;
        }
        fullCommand = fullCommand.trim();
        aider = new AiderTerminal(openaiApiKey, anthropicApiKey, fullCommand, handleAiderClose, workingDirectory);
        
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
        }
    }).catch((err) => {
        vscode.window.showErrorMessage(`Error starting Aider: ${err}`);
    });
}

/**
 * If the Aider terminal is closed, update local variables to reflect the change.
 */
function handleAiderClose() {
    if (aider) {
        aider.dispose();
        aider = null;
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
function syncAiderAndVSCodeFiles() {
    let filesThatVSCodeKnows = new Set<string>();
    vscode.workspace.textDocuments.forEach((document) => {
        if (document.uri.scheme === "file" && document.fileName && aider?.isWorkspaceFile(document.fileName)) {
            filesThatVSCodeKnows.add(document.fileName);
        }
    });

    let opened = [...filesThatVSCodeKnows].filter(x => !filesThatAiderKnows.has(x));
    let closed = [...filesThatAiderKnows].filter(x => !filesThatVSCodeKnows.has(x));
    
    let ignoreFiles = vscode.workspace.getConfiguration('aider').get('ignoreFiles') as string[];
    let ignoreFilesRegex = ignoreFiles.map((regex) => new RegExp(regex));
    
    opened = opened.filter((item) => !ignoreFilesRegex.some((regex) => regex.test(item)));
    aider?.addFiles(opened);

    closed = closed.filter((item) => !ignoreFilesRegex.some((regex) => regex.test(item)));
    aider?.dropFiles(closed);

    filesThatAiderKnows = filesThatVSCodeKnows;
}

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
        ...folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath })),
        { label: "Select a folder...", description: "" }
    ];

    const selected = await vscode.window.showQuickPick(items, { placeHolder: "Select a folder to use with Aider" });

    if (selected) {
        if (selected.label === "Select a folder...") {
            const result = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
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
    if (e.affectsConfiguration('aider.openaiApiKey') || e.affectsConfiguration('aider.anthropicApiKey')) {
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
    let modelName;
    switch (selectedModel) {
        case '--4o':
            modelName = 'GPT-4o';
            break;
        case '--sonnet':
            modelName = 'Claude 3.5 Sonnet';
            break;
        case '--opus':
            modelName = 'Claude 3 Opus';
            break;
        case 'custom':
            modelName = 'Custom';
            break;
        default:
            modelName = 'Unknown';
    }
    statusBarItem.text = `🤖 Aider: ${modelName}`;
    statusBarItem.command = 'aider.openMenu';
    statusBarItem.tooltip = 'Click to open Aider management menu';
    statusBarItem.show();
}

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar()));

    context.subscriptions.push(vscode.commands.registerCommand('aider.openMenu', showAiderMenu));

    let disposable = vscode.commands.registerCommand('aider.selectModel', async () => {
        const models = [
            { label: '$(sparkle) Claude 3.5 Sonnet (Default)', value: '--sonnet', description: selectedModel === '--sonnet' ? '(Current)' : '' },
            { label: '$(star) Claude 3 Opus', value: '--opus', description: selectedModel === '--opus' ? '(Current)' : '' },
            { label: '$(robot) GPT-4o', value: '--4o', description: selectedModel === '--4o' ? '(Current)' : '' },
            { label: '$(gear) Custom (startup argument)', value: 'custom', description: selectedModel === 'custom' ? '(Current)' : '' }
        ];
        const selectedModelOption = await vscode.window.showQuickPick(models, {
            placeHolder: 'Select a model for Aider',
        });

        if (selectedModelOption) {
            // Close Aider if it's running
            if (aider) {
                aider.dispose();
                aider = null;
                filesThatAiderKnows.clear();
            }

            if (selectedModelOption.value === 'custom') {
                selectedModel = 'custom';
                updateStatusBar();
                vscode.window.showInformationMessage(`Aider model set to: Custom. The model specified in custom startup arguments will be used.`);
            } else {
                selectedModel = selectedModelOption.value;
                updateStatusBar();
                vscode.window.showInformationMessage(`Aider model set to: ${selectedModelOption.label.replace(/\$\([^)]+\)\s/, '')}.`);
            }
            
            // Automatically reopen Aider with the new model
            createAider().then(() => {
                if (aider) {
                    aider.show();
                    // Force the terminal to appear
                    vscode.commands.executeCommand('workbench.action.terminal.focus');
                    vscode.window.showInformationMessage(`Reopen Aider to use the new model.`);
                }
            }).catch((error) => {
                vscode.window.showErrorMessage(`Failed to reopen Aider: ${error}`);
            });
        }
    });
    context.subscriptions.push(disposable);

    // Add command to open model selection from StatusBar
    disposable = vscode.commands.registerCommand('aider.openModelSelection', () => {
        vscode.commands.executeCommand('aider.selectModel');
    });
    context.subscriptions.push(disposable);
    if (process.platform !== 'win32') {
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (aider && document.uri.scheme === "file" && document.fileName) {
                const filePath = document.fileName;
                const relativePath = path.relative(calculatedWorkingDirectory || '', filePath).replace(/\\/g, '/');
                const ignoreFiles = vscode.workspace.getConfiguration('aider').get('ignoreFiles') as string[];
                const shouldIgnore = ignoreFiles.some((regex) => new RegExp(regex).test(relativePath));

                if (!shouldIgnore && aider.isWorkspaceFile(filePath)) {
                    aider.addFile(filePath);
                    filesThatAiderKnows.add(filePath);
                }
            }
        });
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (aider) {
                if (document.uri.scheme === "file" && document.fileName && aider.isWorkspaceFile(document.fileName)) {
                    let filePath = document.fileName;
                    let ignoreFiles = vscode.workspace.getConfiguration('aider').get('ignoreFiles') as string[];
                    let shouldIgnore = ignoreFiles.some((regex) => new RegExp(regex).test(filePath));

                    if (!shouldIgnore) {
                        aider.dropFile(filePath);
                        filesThatAiderKnows.delete(document.fileName);
                    }
                }
            }
        });
    }

    disposable = vscode.commands.registerCommand('aider.add', function () {
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

    disposable = vscode.commands.registerCommand('aider.syncFiles', function () {
        if (!aider) {
            vscode.window.showErrorMessage("Aider is not running.  Please run the 'Open Aider' command first.");
        }

        syncAiderAndVSCodeFiles();
    });

    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('aider.open', function () {
        if (!aider || !aider.isActive()) {
            filesThatAiderKnows.clear();
            createAider();
        } else {
            aider.show();
        }
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
        const readmePath = path.join(workspaceRoot, 'README.md');

        try {
            // Generate README content using Aider
            const readmeContent = await generateReadmeWithAider(workspaceRoot);
            
            fs.writeFileSync(readmePath, readmeContent);
            vscode.window.showInformationMessage('README.md has been generated successfully using Aider. Edit the file as needed to add more details like AUTHOR, LICENSE, CONTRIBUTING, etc. if needed');
            
            const openPath = vscode.Uri.file(readmePath);
            vscode.workspace.openTextDocument(openPath).then(doc => {
                vscode.window.showTextDocument(doc);
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to generate README.md: ${error}`);
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

    // API key management functionality removed

async function generateReadmeWithAider(workspaceRoot: string): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!aider) {
            reject(new Error("Aider is not running"));
            return;
        }

        const prompt = `Generate a comprehensive README.md file for the project in the current workspace. Include sections for introduction, features, installation, usage, configuration, and any other relevant information based on the project files and structure.`;

        aider.sendCommand(prompt);

        // We need to implement a way to capture Aider's response
        // This is a placeholder and needs to be replaced with actual implementation
        // that captures Aider's output and returns it as the README content
        setTimeout(() => {
            resolve("");
        }, 5000);
    });
}

async function generateReadmeContent(workspaceRoot: string): Promise<string> {
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    let packageJson;
    try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch (error) {
        console.error('Error reading package.json:', error);
        packageJson = {};
    }

    const projectName = packageJson.name || path.basename(workspaceRoot);
    const description = packageJson.description || 'A VSCode extension project';

    let readmeContent = `# ${projectName}\n\n`;
    readmeContent += `${description}\n\n`;
    readmeContent += `## Features\n\n`;
    readmeContent += `- List the main features of your extension here\n\n`;
    readmeContent += `## Requirements\n\n`;
    readmeContent += `- List any prerequisites or requirements here\n\n`;
    readmeContent += `## Extension Settings\n\n`;
    readmeContent += `This extension contributes the following settings:\n\n`;
    readmeContent += `* \`myExtension.enable\`: Enable/disable this extension\n`;
    readmeContent += `* \`myExtension.thing\`: Set to \`blah\` to do something\n\n`;
    readmeContent += `## Known Issues\n\n`;
    readmeContent += `Calling out known issues can help limit users opening duplicate issues against your extension.\n\n`;
    readmeContent += `## Release Notes\n\n`;
    readmeContent += `Users appreciate release notes as you update your extension.\n\n`;
    readmeContent += `### 1.0.0\n\n`;
    readmeContent += `Initial release of ...\n\n`;
    readmeContent += `### 1.0.1\n\n`;
    readmeContent += `Fixed issue #.\n\n`;
    readmeContent += `### 1.1.0\n\n`;
    readmeContent += `Added features X, Y, and Z.\n\n`;
    readmeContent += `---\n\n`;
    readmeContent += `## Following extension guidelines\n\n`;
    readmeContent += `Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.\n\n`;
    readmeContent += `* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)\n\n`;
    readmeContent += `## Working with Markdown\n\n`;
    readmeContent += `You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:\n\n`;
    readmeContent += `* Split the editor (\`Cmd+\\\` on macOS or \`Ctrl+\\\` on Windows and Linux)\n`;
    readmeContent += `* Toggle preview (\`Shift+Cmd+V\` on macOS or \`Shift+Ctrl+V\` on Windows and Linux)\n`;
    readmeContent += `* Press \`Ctrl+Space\` (Windows, Linux, macOS) to see a list of Markdown snippets\n\n`;
    readmeContent += `## For more information\n\n`;
    readmeContent += `* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)\n`;
    readmeContent += `* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)\n\n`;
    readmeContent += `**Enjoy!**\n`;

    return readmeContent;
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

    if (!text) {
        vscode.window.showErrorMessage("No text selected. Please select a code snippet to refactor or modify.");
        return;
    }

    let task: string;
    if (action === 'Refactor') {
        task = "Refactor the following code to improve its structure, performance and readability without changing its functionality:";
    } else {
        task = await vscode.window.showInputBox({
            prompt: "Enter the modification task or instruction",
            placeHolder: "e.g., Add error handling, Implement a new feature, etc."
        }) || "";
    }

    if (task === "") {
        return; // User cancelled the input for Modify action
    }

    const filePath = editor.document.uri.fsPath;
    const relativePath = vscode.workspace.asRelativePath(filePath);
    const lineNumber = selection.start.line + 1;

    const sanitizedText = text.replace(/\r?\n/g, '\\n');
    const prompt = `${task}\n\nFile: ${relativePath}\nLine: ${lineNumber}\n\n${sanitizedText}`;

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

export function deactivate() {}
async function showAiderMenu() {
    const items: vscode.QuickPickItem[] = [
        {
            label: aider && aider.isActive() ? 'Close Aider' : 'Open Aider',
            description: aider && aider.isActive() ? 'Close the current Aider session' : 'Start a new Aider session'
        },
        {
            label: 'Select Model',
            description: 'Change the AI model used by Aider'
        },
        {
            label: 'Sync Files',
            description: 'Synchronize open files with Aider'
        },
        {
            label: 'Set Custom Startup Arguments',
            description: 'Set custom arguments for Aider startup'
        }
    ];

    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an Aider action'
    });

    if (selection) {
        switch (selection.label) {
            case 'Open Aider':
                vscode.commands.executeCommand('aider.open');
                break;
            case 'Close Aider':
                vscode.commands.executeCommand('aider.close');
                break;
            case 'Select Model':
                vscode.commands.executeCommand('aider.selectModel');
                break;
            case 'Sync Files':
                vscode.commands.executeCommand('aider.syncFiles');
                break;
            case 'Set Custom Startup Arguments':
                setCustomStartupArgs();
                break;
        }
    }
}
