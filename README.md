# pi-read

> The Pi coding agent `/read` tool, but with lower (and configurable) default max values (e.g. 2000 lines -> 100 lines).

A plugin for [Pi](https://github.com/badlogic/pi-mono) that overrides the built-in `read` tool with configurable truncation limits.

## Features

- Configurable defaults: Set default max lines and bytes for file reads
- Configurable hard caps: Clamp agent-requested `limitLines` / `limitBytes`
- Global and project config: Different limits per project or global defaults
- Sensible defaults: 100 lines / 5KB (much smaller than built-in 2000 lines / 50KB)
- Same core behavior as built-in read tool for text truncation and image reads

## Installation

### From GitHub (Recommended)

```bash
pi install git:github.com/arcanemachine/pi-read
```

To update to the latest version:

```bash
pi update git:github.com/arcanemachine/pi-read
```

### From Local Clone

```bash
git clone https://github.com/arcanemachine/pi-read.git
cd pi-read
pi install /path/to/pi-read
```

No local `npm install` is required for normal usage.

## Development

For local development and verification:

```bash
npm install
npm run typecheck
npm run test
npm run build
```

## Configuration

Add a `readTool` key to your pi `settings.json`.

### Configuration File Locations

Pi-read merges `readTool` settings from these locations (project overrides global):

1. `.pi/settings.json` (project-specific)
2. `~/.pi/agent/settings.json` (global)

You can also edit settings via the `/settings` command in pi.

### Example Configuration

Add to your `.pi/settings.json` or `~/.pi/agent/settings.json`:

```json
{
  "readTool": {
    "maxLines": 100,
    "maxBytes": 5120,
    "maxLimitLines": 2000,
    "maxLimitBytes": 51200
  }
}
```

### Configuration Options

| Option          | Type   | Default | Description                                        |
| --------------- | ------ | ------- | -------------------------------------------------- |
| `maxLines`      | number | 100     | Default maximum lines when `limitLines` is omitted |
| `maxBytes`      | number | 5120    | Default maximum bytes when `limitBytes` is omitted |
| `maxLimitLines` | number | 2000    | Hard cap for agent-requested `limitLines`          |
| `maxLimitBytes` | number | 51200   | Hard cap for agent-requested `limitBytes` (50KB)   |

### Project-Specific Example

Set conservative defaults globally, but allow more for specific projects:

`~/.pi/agent/settings.json`

```json
{
  "readTool": {
    "maxLines": 50,
    "maxBytes": 512,
    "maxLimitLines": 500,
    "maxLimitBytes": 8192
  }
}
```

`.pi/settings.json` (in a documentation project):

```json
{
  "readTool": {
    "maxLines": 500,
    "maxBytes": 51200,
    "maxLimitLines": 2000,
    "maxLimitBytes": 51200
  }
}
```

## Usage

Once installed, the read tool automatically uses your configured limits. No changes needed to your workflow.

### Tool Parameters

- `offsetLines` (1-indexed) and `limitLines`
- `offsetBytes` (0-indexed) and `limitBytes`
- If both offsets are provided, `offsetBytes` takes precedence.
- Byte limits are hard safety limits; line limits are secondary guardrails.
- Agent-requested limits are clamped by `maxLimitLines` and `maxLimitBytes`.

### Commands

| Command        | Description                                                      |
| -------------- | ---------------------------------------------------------------- |
| `/read-config` | Show current read tool configuration and settings file locations |

### Example Session

```
You: read a large file

[read tool uses your configured defaults, e.g., 100 lines / 5KB]

[Showing lines 1-100 of 500. Use offsetLines=101 to continue or offsetBytes=4970 for byte-based paging.]

You: continue reading from offsetLines 101
```

## Why?

The built-in read tool has generous defaults (2000 lines / 50KB) which can consume significant context window. This extension lets you:

- Keep more context available for the conversation
- Read files more deliberately in smaller chunks
- Set different limits per project (e.g., larger limits for documentation projects)

## How It Works

This extension:

1. Registers a tool named `read` that overrides the built-in read tool
2. Loads configuration from pi's `settings.json` files
3. Applies your configured defaults (`maxLines` / `maxBytes`)
4. Clamps agent-requested limits with hard caps (`maxLimitLines` / `maxLimitBytes`)
5. Falls back to built-in behavior for images (no truncation needed)

The truncation logic uses the same `truncateHead` function as the built-in tool, ensuring consistent behavior.
