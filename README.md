# VSCode Aider Extension

## Introduction

The VSCode Aider Extension seamlessly integrates [Aider](https://aider.chat), a powerful AI-assisted coding tool, directly into Visual Studio Code. This extension enhances your coding experience by providing AI-powered code refactoring, modification, and generation capabilities.

## Features

- **AI-Powered Coding Assistance**: Leverage advanced AI models like GPT-4 and Claude to assist with your coding tasks.
- **Automatic File Synchronization**: The extension keeps track of open files and syncs them with Aider automatically.
- **Multiple AI Model Support**: Choose from various AI models, including GPT-4 and Claude variants.
- **Code Refactoring and Modification**: Easily refactor or modify selected code snippets using AI suggestions.
- **README Generation**: Automatically generate comprehensive README files for your projects.
- **Custom Startup Arguments**: Customize Aider's behavior with user-defined startup arguments.
- **File Management**: Add or ignore files directly from the VSCode explorer context menu.
- **Intuitive Menu System**: Access all Aider functions through a convenient menu system.

## Requirements

- Visual Studio Code version 1.50.0 or higher
- Aider CLI tool installed (visit [Aider's website](https://aider.chat) for installation instructions)
- An OpenAI API key or Anthropic API key (depending on the chosen model)

## Installation

1. Install the VSCode Aider Extension from the Visual Studio Code Marketplace.
2. Ensure the Aider CLI tool is installed on your system.
3. Configure your API keys in the extension settings.

## Usage

1. **Start Aider**: Use the command palette (Ctrl+Shift+P) and search for "Aider: Open" to start an Aider session.
2. **Select AI Model**: Choose your preferred AI model using the "Aider: Select Model" command.
3. **Access Menu**: Click the Aider status bar item or use the command palette to open the Aider menu for various functions.
4. **Refactor/Modify Code**: Select code and use the context menu or command palette to refactor or modify with Aider.
5. **Manage Files**: Use the explorer context menu to add files to Aider or ignore them.
6. **Generate README**: Use the "Aider: Generate README.md" command to create a project README.

## Known Issues

- Windows compatibility is being improved. Some features may not work as expected on Windows systems.
- The extension may not always detect all open files on VSCode startup.

## Changelog

For a detailed list of changes and updates, please refer to the [CHANGELOG.md](CHANGELOG.md) file.

## Acknowledgements

- Aider CLI tool created by [Paul Gauthier](https://github.com/paul-gauthier)
- This extension is a fork of [Matt Flower](https://github.com/mattflower)'s extension

For more information on using Aider, visit the [Aider documentation](https://aider.chat/docs/).
