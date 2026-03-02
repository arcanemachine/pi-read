/**
 * pi-read
 * Customizable read tool for Pi coding agent
 *
 * Overrides the built-in `read` tool to allow configurable default
 * line and byte limits via settings or config files.
 *
 * Configuration files (merged, project takes precedence):
 * - ~/.pi/agent/read.json (global)
 * - <cwd>/.pi/read.json (project-local)
 *
 * Example .pi/read.json:
 * ```json
 * {
 *   "maxLines": 100,
 *   "maxBytes": 1024
 * }
 * ```
 *
 * Usage:
 * - `pi -e ./pi-read` - read tool with custom limits
 *
 * Installation:
 * ```bash
 * pi install git:github.com/yourusername/pi-read
 * ```
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { constants } from "fs";
import { access, readFile } from "fs/promises";

// Default limits (can be overridden via config)
const DEFAULT_MAX_LINES = 100;
const DEFAULT_MAX_BYTES = 1024; // 1KB

interface ReadConfig {
  maxLines?: number;
  maxBytes?: number;
}

const DEFAULT_CONFIG: ReadConfig = {
  maxLines: DEFAULT_MAX_LINES,
  maxBytes: DEFAULT_MAX_BYTES,
};

/**
 * Load configuration from global and project config files.
 * Project config takes precedence over global config.
 */
function loadConfig(cwd: string): ReadConfig {
  const globalConfigPath = join(homedir(), ".pi", "agent", "read.json");
  const projectConfigPath = join(cwd, ".pi", "read.json");

  let config: ReadConfig = { ...DEFAULT_CONFIG };

  // Load global config first
  if (existsSync(globalConfigPath)) {
    try {
      const globalConfig: Partial<ReadConfig> = JSON.parse(
        readFileSync(globalConfigPath, "utf-8"),
      );
      config = { ...config, ...globalConfig };
    } catch (e) {
      console.error(
        `[pi-read] Warning: Could not parse ${globalConfigPath}: ${e}`,
      );
    }
  }

  // Project config overrides global
  if (existsSync(projectConfigPath)) {
    try {
      const projectConfig: Partial<ReadConfig> = JSON.parse(
        readFileSync(projectConfigPath, "utf-8"),
      );
      config = { ...config, ...projectConfig };
    } catch (e) {
      console.error(
        `[pi-read] Warning: Could not parse ${projectConfigPath}: ${e}`,
      );
    }
  }

  // Validate and clamp values
  if (config.maxLines !== undefined) {
    config.maxLines = Math.max(1, Math.min(config.maxLines, 10000));
  }
  if (config.maxBytes !== undefined) {
    config.maxBytes = Math.max(256, Math.min(config.maxBytes, 1024 * 1024)); // 256B to 1MB
  }

  return config;
}

/**
 * Resolve a read path relative to cwd.
 * Handles relative paths, absolute paths, and home directory expansion.
 */
function resolveReadPath(path: string, cwd: string): string {
  // Expand home directory
  if (path.startsWith("~/")) {
    path = join(homedir(), path.slice(2));
  }

  // Resolve relative to cwd if not absolute
  if (!isAbsolute(path)) {
    path = resolve(cwd, path);
  }

  return path;
}

/**
 * Detect if a file is an image by checking common extensions.
 * Returns the MIME type or undefined if not an image.
 */
function detectImageMimeType(path: string): string | undefined {
  const ext = path.toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return undefined;
  }
}

const readSchema = Type.Object({
  path: Type.String({
    description: "Path to the file to read (relative or absolute)",
  }),
  offset: Type.Optional(
    Type.Number({
      description: "Line number to start reading from (1-indexed)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of lines to read" }),
  ),
});

export default function (pi: ExtensionAPI) {
  // Store config per cwd (in case cwd changes)
  const configCache = new Map<string, ReadConfig>();

  function getConfig(cwd: string): ReadConfig {
    if (!configCache.has(cwd)) {
      configCache.set(cwd, loadConfig(cwd));
    }
    return configCache.get(cwd)!;
  }

  pi.registerTool({
    name: "read",
    label: "read (custom)",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to configurable limits (default: ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES} bytes). Use offset/limit for large files. Configure via ~/.pi/agent/read.json or .pi/read.json.`,
    parameters: readSchema,

    async execute(
      _toolCallId,
      { path, offset, limit },
      signal,
      _onUpdate,
      ctx,
    ) {
      const absolutePath = resolveReadPath(path, ctx.cwd);
      const config = getConfig(ctx.cwd);

      // Check if already aborted
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      // Check if file exists and is readable
      try {
        await access(absolutePath, constants.R_OK);
      } catch (error) {
        throw new Error(`Cannot read file: ${path}`);
      }

      // Check if it's an image
      const mimeType = detectImageMimeType(absolutePath);

      if (mimeType) {
        // For images, read and return as base64
        const buffer = await readFile(absolutePath);
        const base64 = buffer.toString("base64");

        return {
          content: [
            { type: "text", text: `Read image file [${mimeType}]` },
            { type: "image", data: base64, mimeType },
          ],
          details: { mimeType, size: buffer.length },
        };
      } else {
        // Handle text files with custom truncation
        const buffer = await readFile(absolutePath);
        const textContent = buffer.toString("utf-8");
        const allLines = textContent.split("\n");
        const totalFileLines = allLines.length;

        // Apply offset if specified (1-indexed to 0-indexed)
        const startLine = offset ? Math.max(0, offset - 1) : 0;
        const startLineDisplay = startLine + 1; // For display (1-indexed)

        // Check if offset is out of bounds
        if (startLine >= allLines.length) {
          throw new Error(
            `Offset ${offset} is beyond end of file (${allLines.length} lines total)`,
          );
        }

        // If limit is specified by user, use it; otherwise we'll let truncateHead decide
        let selectedContent;
        let userLimitedLines;
        if (limit !== undefined) {
          const endLine = Math.min(startLine + limit, allLines.length);
          selectedContent = allLines.slice(startLine, endLine).join("\n");
          userLimitedLines = endLine - startLine;
        } else {
          selectedContent = allLines.slice(startLine).join("\n");
        }

        // Apply truncation with custom limits from config
        const truncation = truncateHead(selectedContent, {
          maxLines: config.maxLines ?? DEFAULT_MAX_LINES,
          maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
        });

        let outputText;
        let details: Record<string, unknown> = { truncation };

        if (truncation.firstLineExceedsLimit) {
          // First line at offset exceeds byte limit - tell model to use bash
          const firstLineSize = formatSize(
            Buffer.byteLength(allLines[startLine], "utf-8"),
          );
          outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(
            config.maxBytes ?? DEFAULT_MAX_BYTES,
          )} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${
            config.maxBytes ?? DEFAULT_MAX_BYTES
          }]`;
        } else if (truncation.truncated) {
          // Truncation occurred - build actionable notice
          const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
          const nextOffset = endLineDisplay + 1;
          outputText = truncation.content;
          if (truncation.truncatedBy === "lines") {
            outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
          } else {
            outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(
              config.maxBytes ?? DEFAULT_MAX_BYTES,
            )} limit). Use offset=${nextOffset} to continue.]`;
          }
        } else if (
          userLimitedLines !== undefined &&
          startLine + userLimitedLines < allLines.length
        ) {
          // User specified limit, there's more content, but no truncation
          const remaining = allLines.length - (startLine + userLimitedLines);
          const nextOffset = startLine + userLimitedLines + 1;
          outputText = truncation.content;
          outputText += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
        } else {
          // No truncation, no user limit exceeded
          outputText = truncation.content;
        }

        return {
          content: [{ type: "text", text: outputText }],
          details,
        };
      }
    },
  });

  // Register a command to show current read configuration
  pi.registerCommand("read-config", {
    description: "Show current read tool configuration",
    handler: async (_args, ctx) => {
      const config = getConfig(ctx.cwd);
      const lines = [
        "Read Tool Configuration:",
        "",
        `Max lines: ${config.maxLines}`,
        `Max bytes: ${config.maxBytes} (${formatSize(config.maxBytes ?? DEFAULT_MAX_BYTES)})`,
        "",
        "Config files:",
        `  Global: ~/.pi/agent/read.json`,
        `  Project: ${join(ctx.cwd, ".pi", "read.json")}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // Clear cache on session start (in case configs changed)
  pi.on("session_start", async (_event, ctx) => {
    configCache.delete(ctx.cwd);
  });
}
