import { AiderInterface } from './AiderTerminal';

export function refactorCodeSnippet(aider: AiderInterface, codeSnippet: string, task: string): void {
    const prompt = `Refactor the following code snippet according to this task: ${task}. Here's the code:\n\n${codeSnippet}\n\nOnly return the refactored code, no explanations.`;

    // Escape any quotes in the prompt to prevent breaking the command
    const escapedPrompt = prompt.replace(/"/g, '\\"');

    // Send the entire prompt as a single command
    aider.sendCommand(`"${escapedPrompt}"`);
}

export function modifyCodeSnippet(aider: AiderInterface, codeSnippet: string, task: string): void {
    const prompt = `Modify the following code snippet according to this task: ${task}. Here's the code:\n\n${codeSnippet}\n\nOnly return the modified code, no explanations.`;

    // Escape any quotes in the prompt to prevent breaking the command
    const escapedPrompt = prompt.replace(/"/g, '\\"');

    // Send the entire prompt as a single command
    aider.sendCommand(`"${escapedPrompt}"`);
}
