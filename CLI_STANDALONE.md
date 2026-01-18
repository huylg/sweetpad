# Standalone CLI Executable

You can compile the SweetPad CLI into a standalone executable using Bun. This creates a single binary file that can be
distributed and run without requiring Node.js or Bun to be installed.

## Building

```bash
npm run build:cli:standalone
```

This will:

1. Build the CLI using esbuild to `out/cli.js`
2. Compile the CLI using Bun's `--compile` flag
3. Create a standalone `sweetpad` executable (~58MB on macOS arm64)

## Usage

Once compiled, the executable can be run directly:

```bash
./sweetpad run
./sweetpad build --scheme MyApp
./sweetpad --help
```

## Installation

To use the standalone executable system-wide:

```bash
# Make executable (if not already)
chmod +x sweetpad

# Move to system path
sudo mv sweetpad /usr/local/bin/sweetpad

# Now available globally
sweetpad run --arch x86_64
```

Or install to your home directory:

```bash
mkdir -p ~/bin
cp sweetpad ~/bin/
export PATH="$HOME/bin:$PATH"
```

## Architecture Support

The standalone executable is compiled for the host architecture:

- macOS arm64 (Apple Silicon): ~58MB
- macOS x86_64 (Intel): ~60MB
- Linux arm64/x86_64: Sizes vary

To cross-compile for other platforms, you'll need to build on that platform or use a CI runner.

## Advantages

✅ No Node.js/Bun dependency for end users ✅ Single file distribution ✅ Faster startup (embedded Bun runtime) ✅
Self-contained (bundles all dependencies)

## Disadvantages

❌ Larger file size (~58MB vs ~1MB for bundled JS) ❌ Platform-specific (separate builds for macOS/Linux/Windows) ❌
Development requires rebuilding to test changes

## Development Notes

- The standalone executable is ignored by git (see `.gitignore`)
- Only build via npm script, not manually with bun command
- For development, use `npm run build` and `node out/cli.js`
