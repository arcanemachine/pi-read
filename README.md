# pi-read

> Customizable read tool for Pi coding agent - configure default line/byte limits.

A plugin for [Pi](https://github.com/badlogic/pi-mono) that overrides the built-in `read` tool with configurable truncation limits.

## Features

- **Configurable limits**: Set default max lines and bytes for file reads
- **Global and project config**: Different limits per project or global defaults
- **Sensible defaults**: 100 lines / 1KB (much smaller than built-in 2000 lines / 50KB)
- **Full compatibility**: Supports all the same features as the built-in read tool (images, offset/limit, etc.)

## Installation

### From GitHub (Recommended)

```bash
pi install git:github.com/yourusername/pi-read
```

To update to the latest version:

```bash
pi update git:github.com/yourusername/pi-read
```

### From Local Clone

```bash
git clone https://github.com/yourusername/pi-read.git
cd pi-read
npm install
pi install /path/to/pi-read
```

## Configuration

Create a config file at either:

- `~/.pi/agent/read.json` - Global config (applies to all projects)
- `.pi/read.json` - Project config (overrides global for current project)

### Example Config

```json
{
  "maxLines": 100,
  "maxBytes": 1024
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxLines` | number | 100 | Maximum number of lines to read |
| `maxBytes` | number | 1024 | Maximum bytes to read (256 to 1MB) |

Values are validated and clamped to safe ranges:
- `maxLines`: 1 to 10000
- `maxBytes`: 256 to 1048576 (1MB)

## Usage

Once installed, the read tool automatically uses your configured limits. No changes needed to your workflow.

### Commands

| Command | Description |
|---------|-------------|
| `/read-config` | Show current read tool configuration and config file locations |

### Example Session

```
You: read a large file

[read tool uses your configured limits, e.g., 100 lines / 1KB]

[Showing lines 1-100 of 5000. Use offset=101 to continue.]

You: continue reading from offset 101
```

## Why?

The built-in read tool has generous defaults (2000 lines / 50KB) which can consume significant context window. This extension lets you:

- Keep more context available for the conversation
- Read files more deliberately in smaller chunks
- Set different limits per project (e.g., larger limits for documentation projects)

## How It Works

This extension:

1. Registers a tool named `read` that overrides the built-in read tool
2. Loads configuration from `~/.pi/agent/read.json` and `.pi/read.json`
3. Applies your custom limits when truncating file output
4. Falls back to built-in behavior for images (no truncation needed)

The truncation logic uses the same `truncateHead` function as the built-in tool, ensuring consistent behavior.
