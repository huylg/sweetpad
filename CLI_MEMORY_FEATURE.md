# CLI Options Remembering Feature

## Overview

The CLI now remembers user selections made via fzf and automatically reuses them on subsequent runs, eliminating the
need to repeatedly select the same options.

## How It Works

### 1. State Persistence

- User selections are stored in `.sweetpad/cli-state.json` within each workspace
- State is per-workspace, not global - selections are remembered independently for each project
- State is saved after all selections are made (before build/run commands execute)

### 2. Remembered Values

The following selections are automatically remembered:

| Key                  | Description                          | Example Value                |
| -------------------- | ------------------------------------ | ---------------------------- |
| `cli.scheme`         | Xcode scheme name                    | `"MyApp"`                    |
| `cli.configuration`  | Build configuration                  | `"Debug"`                    |
| `cli.xcworkspace`    | Xcode workspace path                 | `"/path/to/App.xcworkspace"` |
| `cli.destination.id` | Destination ID (UDID or platform ID) | `"iPhone 15 Pro"`            |

### 3. Auto-Selection Logic

For each picker:

1. **Check if remembered value exists** → Load from state file
2. **Validate remembered value** → Ensure it's still in the list of available options
3. **Auto-select if valid** → Skip fzf and use remembered value immediately
4. **Otherwise show fzf** → Let user select from all available options
5. **Save new selection** → Store to state file for next time

### 4. Behavior Details

- **Single option**: Automatically returns that option (existing behavior)
- **Remembered option exists and is valid**: Auto-selects without showing fzf
- **Remembered option no longer available**: Shows fzf with all options
- **User manually provides flags**: Respects CLI flags over remembered values
- **Config values**: Respects VSCode config/env vars over remembered values

## Example Workflow

### First Run

```bash
$ sweetpad run
# User sees fzf for scheme selection:
> MyApp
> MyAppTests

# User selects "MyApp"
# User sees fzf for destination selection:
> My Mac
> iPhone 15 Pro

# User selects "iPhone 15 Pro"
# Build and run...
```

### Second Run

```bash
$ sweetpad run
# No fzf shown! Automatically uses:
# - Scheme: MyApp (remembered)
# - Configuration: Debug (remembered)
# - Destination: iPhone 15 Pro (remembered)

# Build and run immediately...
```

### Override with CLI Flags

```bash
$ sweetpad run --scheme MyAppTests --destination-id "0000-0000-0000"
# CLI flags override remembered values
# State is NOT updated when CLI flags are used
```

## State File Format

`.sweetpad/cli-state.json`:

```json
{
  "cli.scheme": "MyApp",
  "cli.configuration": "Debug",
  "cli.xcworkspace": "/path/to/App.xcworkspace",
  "cli.destination.id": "iPhone 15 Pro"
}
```

## Resetting Remembered Values

To clear all remembered selections:

```bash
rm .sweetpad/cli-state.json
```

Or delete specific keys by editing the JSON file manually.

## Implementation Details

### Files Modified

1. **`src/cli/state.ts`** (new)

   - `loadState()` - Load state from JSON file
   - `saveState()` - Save state to JSON file
   - `getRememberedValue()` - Get a remembered value by key
   - `setRememberedValue()` - Set a remembered value
   - `removeRememberedValue()` - Remove a remembered value

2. **`src/cli/context.ts`**

   - Added `persistentState: StateMap` field
   - Added `stateDirty` flag for efficient writes
   - Added `savePersistentState()` method
   - Added `getRememberedValue()` method
   - Added `setRememberedValue()` method
   - Added `removeRememberedValue()` method
   - Modified `create()` to load persistent state

3. **`src/cli/pickers.ts`**

   - `pickSchemeSmart()` - Smart scheme picker with memory
   - `pickConfigurationSmart()` - Smart configuration picker with memory
   - `pickXcodeWorkspacePathSmart()` - Smart workspace picker with memory
   - `pickDestinationSmart()` - Smart destination picker with memory

4. **`src/cli/index.ts`**
   - Updated `resolveXcworkspace()` to use smart picker
   - Updated `resolveDestination()` to use smart picker
   - Replaced `pickScheme()` with `pickSchemeSmart()`
   - Replaced `pickConfiguration()` with `pickConfigurationSmart()`
   - Added `runtime.savePersistentState()` call after selections

## Benefits

1. **Faster workflow**: No repeated fzf selections for commonly used options
2. **Better UX**: Seamless experience for frequent builds
3. **Workspace-specific**: Different projects remember different selections
4. **Respects overrides**: CLI flags and config still take precedence
5. **Safe**: Only auto-selects if remembered value is still valid
6. **Transparent**: State file is human-readable JSON

## Future Enhancements

Potential improvements:

- Add `--no-remember` flag to disable memory for a single run
- Add `--reset-remembered` flag to clear specific values
- Show "using remembered: X" message for transparency
- Add configuration option to disable remembering globally
