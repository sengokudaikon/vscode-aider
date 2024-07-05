import { AiderInterface } from './AiderTerminal';

export function refactorCodeSnippet(aider: AiderInterface, codeSnippet: string): void {
    const prompt = `Refactor the following code snippet to improve its readability, efficiency, and adherence to best practices. Only return the refactored code, no explanations: ${codeSnippet.replace(/\n/g, ' ')}`;

    // Escape any quotes in the prompt to prevent breaking the command
    const escapedPrompt = prompt.replace(/"/g, '\\"');

    // Send the entire prompt as a single command
    aider.sendCommand(`"${escapedPrompt}"`);
}
