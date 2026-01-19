# SweetPad CLI (iOS/Swift development) 

SweetPad CLI is a fork of [sweetpad-dev/sweetpad](https://github.com/sweetpad-dev/sweetpad). This fork extracts the
standalone CLI for building, running, and managing iOS/Swift projects from the command line.

SweetPad integrates open-source tools such as **swift-format**, **swiftlint**, **xcodebuild**, **xcrun**,
**xcode-build-server**, **sourcekit-lsp** to provide a complete iOS development workflow.

##  Autocomplete

SweetPad CLI provides interactive autocomplete for workspace, scheme, configuration, and destination selection using
`fzf`. When configuration is missing or incomplete, the CLI will prompt you to select the appropriate options
automatically.

**Benefits:**

- No manual configuration needed - SweetPad discovers your Xcode project structure
- Interactive selection with fuzzy search powered by `fzf`
- Remembers your selections across sessions for faster workflows
- Easy to get started with any iOS project

## CLI Installation

### Prerequisites

1. **macOS** — required for iOS development
2. **Xcode** — required for building and running iOS apps
3. **fzf** — for interactive CLI selections (`brew install fzf`)
4. **bun** — JavaScript runtime for running the CLI (`brew install bun`)

### Install

```bash
# Clone the repository
git clone https://github.com/huylg/sweetpad.git
cd sweetpad

# Build the standalone CLI executable
bun run build:cli:standalone

# Move to your PATH
mv sweetpad /usr/local/bin/
```

## CLI Usage

SweetPad CLI provides build/run/clean/launch workflows for iOS projects.

### Commands

**Build:**

```bash
sweetpad build --xcworkspace MyApp.xcworkspace --scheme MyApp
```

**Run on simulator:**

```bash
sweetpad run --destination "iPhone 15" --launch-args "--mock,1"
```

**Launch app:**

```bash
sweetpad launch --scheme MyApp --configuration Debug
```

**Clean:**

```bash
sweetpad clean --destination-id 00000000-0000-0000-0000-000000000000
```

### Configuration

- Supports environment overrides like `SWEETPAD_BUILD_CONFIGURATION=Debug`
- Uses `.sweetpad/` inside the workspace for temporary files

## License

This project is licensed under the [MIT License](./LICENSE.md).
