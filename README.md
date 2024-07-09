# VSCode Aider Extension

![Aider Extension](https://raw.githubusercontent.com/mattflower/vscode-aider-extension/master/images/AiderExtension.png)

## Introduction

The VSCode Aider Extension integrates [Aider](https://aider.chat), a powerful AI-assisted coding tool, directly into Visual Studio Code. This extension enhances your coding experience by providing seamless access to AI-powered code refactoring, modification, and generation capabilities.

## Features

- **AI-Powered Coding Assistance**: Leverage the power of AI models like GPT-4 and Claude to assist with your coding tasks.
- **Automatic File Synchronization**: The extension automatically keeps track of open files and syncs them with Aider.
- **Multiple AI Model Support**: Choose between different AI models, including GPT-4 and Claude variants.
- **Code Refactoring**: Easily refactor selected code snippets using AI suggestions.
- **Code Modification**: Get AI assistance in modifying your code based on specific instructions.
- **README Generation**: Automatically generate comprehensive README files for your projects.
- **Custom Startup Arguments**: Customize Aider's behavior with user-defined startup arguments.

## Requirements

- Visual Studio Code version 1.50.0 or higher
- Aider CLI tool installed (visit [Aider's website](https://aider.chat) for installation instructions)
- An OpenAI API key or Anthropic API key (depending on the model you choose)

## Installation

1. Install the Aider Extension from the Visual Studio Code Marketplace.
2. Ensure you have the Aider CLI tool installed on your system.
3. Configure your API keys in the extension settings.

## Configuration

To set up the Aider Extension:

1. Open VS Code settings (File > Preferences > Settings).
2. Search for "Aider" in the settings search bar.
3. Configure the following settings:
   - `aider.openaiApiKey`: Your OpenAI API key (if using OpenAI models)
   - `aider.anthropicApiKey`: Your Anthropic API key (if using Claude models)
   - `aider.commandLine`: The command to run Aider (e.g., `aider` or full path if needed)
   - `aider.workingDirectory`: Set a specific working directory for Aider (optional)
   - `aider.ignoreFiles`: List of file patterns to ignore (optional)

## Usage

1. **Start Aider**: Use the command palette (Ctrl+Shift+P) and search for "Aider: Open" to start an Aider session.
2. **Select AI Model**: Choose your preferred AI model using the "Aider: Select Model" command.
3. **Refactor Code**: Select a code snippet and use the "Aider: Refactor Selected Code" command.
4. **Modify Code**: Select code and use "Aider: Modify Selected Code" to get AI suggestions for modifications.
5. **Generate README**: Use the "Aider: Generate README.md" command to create a project README.
6. **Sync Files**: Manually sync open files with Aider using the "Aider: Sync Open Files" command.

## Known Issues

- Windows compatibility is still being improved. Some features may not work as expected on Windows systems.
- The extension may not always detect all open files on VSCode startup.

## Contributing

Contributions to the Aider Extension are welcome! Please submit issues and pull requests on the [GitHub repository](https://github.com/MattFlower/vscode-aider-extension).

## License

This extension is released under the [MIT License](LICENSE.md).

## Acknowledgements

- Aider CLI tool created by [Paul Gauthier](https://github.com/paul-gauthier)
- VSCode Aider Extension developed by [Matt Flower](https://github.com/mattflower)

For more information on using Aider, visit the [Aider documentation](https://aider.chat/docs/).
