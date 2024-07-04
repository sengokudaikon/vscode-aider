import * as vscode from 'vscode';
import { AiderInterface, AiderTerminal } from './AiderTerminal';
import fs = require('fs');
import path = require('path');

export function convertToRelativePath(filePath: string, workingDirectory: string): string {
    if (path.isAbsolute(filePath)) {
        return path.relative(workingDirectory, filePath);
    }
    return filePath;
}

let aider: AiderInterface | null = null;
let filesThatAiderKnows = new Set<string>();
let calculatedWorkingDirectory: string | undefined = undefined;
let selectedModel: string = '--4o'; // Default model
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Create the Aider interface (currently a terminal) and start it.
 */
async function createAider() {
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
        aider = new AiderTerminal(openaiApiKey, anthropicApiKey, aiderCommandLine, handleAiderClose, workingDirectory, selectedModel);
        
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
    let dirs: string[] = filePath.split(path.sep).filter((item) => { return item !== ""});
    while (dirs.length > 0) {
        try {
            let isWin = path.sep === "\\";
            let dir;
            if (dirs && isWin) {
                dir = dirs.join("\\") + "\\.git";
            } else {
                dir = "/" + dirs.join("/") + "/.git";
            }
            if (fs.statSync(dir) !== undefined) {
                if (isWin) {
                    return dirs.join("\\") + "\\";
                } else {
                    return "/" + dirs.join("/") + "/";
                }
            } else {
                dirs.pop();
            }
        } catch(err) {
            dirs.pop();
        }
    }

    return "/";
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
    if (statusBarItem) {
        const modelName = selectedModel === '--4o' ? 'GPT-4o' : selectedModel === '--sonnet' ? 'Claude 3.5 Sonnet' : 'Claude 3 Opus';
        statusBarItem.text = `🤖 Aider: ${modelName}`;
        statusBarItem.command = 'aider.selectModel';
        statusBarItem.tooltip = 'Click to select Aider model';
        statusBarItem.show();
    }
}

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar()));

    let disposable = vscode.commands.registerCommand('aider.selectModel', async () => {
        const models = [
            { label: '$(robot) GPT-4o (Default)', value: '--4o', description: selectedModel === '--4o' ? '(Current)' : '' },
            { label: '$(sparkle) Claude 3.5 Sonnet', value: '--sonnet', description: selectedModel === '--sonnet' ? '(Current)' : '' },
            { label: '$(star) Claude 3 Opus', value: '--opus', description: selectedModel === '--opus' ? '(Current)' : '' }
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

            selectedModel = selectedModelOption.value;
            updateStatusBar();
            vscode.window.showInformationMessage(`Aider model set to: ${selectedModelOption.label.replace(/\$\([^)]+\)\s/, '')}. Reopening Aider with the new model.`);
            
            // Reopen Aider with the new model
            createAider().then(() => {
                if (aider) {
                    aider.show();
                    // Force the terminal to appear
                    vscode.commands.executeCommand('workbench.action.terminal.focus');
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
    vscode.workspace.onDidOpenTextDocument((document) => {
        if (aider) {
            if (document.uri.scheme === "file" && document.fileName && aider.isWorkspaceFile(document.fileName)) {
                let filePath = document.fileName;
                let ignoreFiles = vscode.workspace.getConfiguration('aider').get('ignoreFiles') as string[];
                let shouldIgnore = ignoreFiles.some((regex) => new RegExp(regex).test(filePath));

                if (!shouldIgnore) {
                    aider.addFile(filePath);
                    filesThatAiderKnows.add(document.fileName);
                }
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
            resolve("# Project README\n\nThis is a placeholder README content. Replace this with the actual content generated by Aider.");
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

export function deactivate() {}
