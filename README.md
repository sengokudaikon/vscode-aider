# VSCode Aider Extension

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

## Usage

1. **Start Aider**: Use the command palette (Ctrl+Shift+P) and search for "Aider: Open" to start an Aider session.
2. **Select AI Model**: Choose your preferred AI model using the "Aider: Select Model" command.
3. **Open Menu**: Menu for custom arguments, model selection, etc.

## Known Issues

- Windows compatibility is still being improved. Some features may not work as expected on Windows systems.
- The extension may not always detect all open files on VSCode startup.

## Acknowledgements

- Aider CLI tool created by [Paul Gauthier](https://github.com/paul-gauthier)
- This extension is a fork of [Matt Flower](https://github.com/mattflower)'s extension

For more information on using Aider, visit the [Aider documentation](https://aider.chat/docs/).
