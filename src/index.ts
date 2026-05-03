/**
 * pi-read
 * Customizable read tool for Pi coding agent
 *
 * Overrides the built-in `read` tool to allow configurable default
 * line and byte limits via pi's settings.json.
 *
 * Configuration:
 * Add to `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global):
 *
 * ```json
 * {
 *   "readTool": {
 *     "maxLines": 100,
 *     "maxBytes": 5120,
 *     "maxLimitLines": 2000,
 *     "maxLimitBytes": 51200
 *   }
 * }
 * ```
 *
 * Project settings take precedence over global settings.
 *
 * Usage:
 * - `pi -e ./pi-read` - read tool with custom limits
 *
 * Installation:
 * ```bash
 * pi install git:github.com/arcanemachine/pi-read
 * ```
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  formatSize,
  createReadToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { constants } from "fs";
import { access, readFile } from "fs/promises";

// Default limits (can be overridden via config)
const DEFAULT_MAX_LINES = 100;
const DEFAULT_MAX_BYTES = 5120; // 5KB
const DEFAULT_MAX_LIMIT_LINES = 2000;
const DEFAULT_MAX_LIMIT_BYTES = 50 * 1024; // 50KB

interface ReadToolConfig {
  maxLines?: number;
  maxBytes?: number;
  maxLimitLines?: number;
  maxLimitBytes?: number;
}

interface Settings {
  readTool?: ReadToolConfig;
}

const DEFAULT_CONFIG: ReadToolConfig = {
  maxLines: DEFAULT_MAX_LINES,
  maxBytes: DEFAULT_MAX_BYTES,
  maxLimitLines: DEFAULT_MAX_LIMIT_LINES,
  maxLimitBytes: DEFAULT_MAX_LIMIT_BYTES,
};

/**
 * Load configuration from pi's settings.json files.
 * Project settings take precedence over global settings.
 */
function loadConfig(cwd: string): ReadToolConfig {
  const projectSettingsPath = join(cwd, ".pi", "settings.json");
  const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");

  let config: ReadToolConfig = { ...DEFAULT_CONFIG };

  // Load global settings first
  if (existsSync(globalSettingsPath)) {
    try {
      const parsed: Settings = JSON.parse(
        readFileSync(globalSettingsPath, "utf-8"),
      );
      if (parsed.readTool) {
        config = { ...config, ...parsed.readTool };
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  // Project settings override global
  if (existsSync(projectSettingsPath)) {
    try {
      const parsed: Settings = JSON.parse(
        readFileSync(projectSettingsPath, "utf-8"),
      );
      if (parsed.readTool) {
        config = { ...config, ...parsed.readTool };
      }
    } catch {
      // Invalid JSON, ignore
    }
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

function clampLimit(
  requested: number | undefined,
  defaultLimit: number,
  maxLimit: number | undefined,
): number {
  const normalized =
    requested !== undefined ? Math.max(0, Math.floor(requested)) : defaultLimit;
  if (maxLimit === undefined) {
    return normalized;
  }
  return Math.min(normalized, Math.max(0, Math.floor(maxLimit)));
}

type CoreReadExecutor = (
  toolCallId: string,
  args: { path: string; offset?: number; limit?: number },
  signal: AbortSignal | undefined,
  onUpdate: (...args: unknown[]) => void,
  ctx: { cwd: string; model?: { input?: string[] } },
) => Promise<any>;

function createCoreReadExecutor(cwd: string): CoreReadExecutor {
  const definition = createReadToolDefinition(cwd);
  if (!definition || typeof definition.execute !== "function") {
    throw new Error(
      "Incompatible pi-coding-agent: createReadToolDefinition() did not return an executable read tool",
    );
  }
  return definition.execute as CoreReadExecutor;
}

const readSchema = Type.Object({
  path: Type.String({
    description: "Path to the file to read (relative or absolute)",
  }),
  offsetLines: Type.Optional(
    Type.Number({
      description:
        "Line number to start reading from (1-indexed). Ignored when offsetBytes is provided",
    }),
  ),
  limitLines: Type.Optional(
    Type.Number({
      description: "Maximum number of lines to read (subject to maxLimitLines)",
    }),
  ),
  offsetBytes: Type.Optional(
    Type.Number({
      description:
        "Byte offset to start reading from (0-indexed). Takes precedence over offsetLines",
    }),
  ),
  limitBytes: Type.Optional(
    Type.Number({
      description: "Maximum bytes to read (subject to maxLimitBytes)",
    }),
  ),
});

export default function (pi: ExtensionAPI) {
  // Store config per cwd (in case cwd changes)
  const configCache = new Map<string, ReadToolConfig>();
  const coreReadCache = new Map<string, CoreReadExecutor>();

  function getConfig(cwd: string): ReadToolConfig {
    if (!configCache.has(cwd)) {
      configCache.set(cwd, loadConfig(cwd));
    }
    return configCache.get(cwd)!;
  }

  function getCoreRead(cwd: string): CoreReadExecutor {
    if (!coreReadCache.has(cwd)) {
      coreReadCache.set(cwd, createCoreReadExecutor(cwd));
    }
    return coreReadCache.get(cwd)!;
  }

  pi.registerTool({
    name: "read",
    label: "read (custom)",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to configurable limits (default: ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES} bytes). Prefer using this tool to read files instead of using bash commands. Use offsets/limits for large files. Configure via readTool in .pi/settings.json or ~/.pi/agent/settings.json.`,
    promptGuidelines: [
      "Prefer using this tool to read files instead of using bash commands.",
    ],
    parameters: readSchema,

    async execute(
      _toolCallId,
      { path, offsetLines, limitLines, offsetBytes, limitBytes },
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
      } catch {
        throw new Error(`Cannot read file: ${path}`);
      }

      // Delegate image reads to Pi core for MIME sniffing and resize safeguards
      const mimeType = detectImageMimeType(absolutePath);
      if (mimeType) {
        const coreRead = getCoreRead(ctx.cwd);
        const coreOffset =
          offsetLines !== undefined
            ? Math.max(1, Math.floor(offsetLines))
            : undefined;
        const coreLimit =
          limitLines !== undefined
            ? Math.max(0, Math.floor(limitLines))
            : undefined;

        return await coreRead(
          _toolCallId,
          { path, offset: coreOffset, limit: coreLimit },
          signal,
          _onUpdate,
          ctx as { cwd: string; model?: { input?: string[] } },
        );
      }

      // Handle text files with custom truncation
      const buffer = await readFile(absolutePath);
      const textContent = buffer.toString("utf-8");
      const allLines = textContent.split("\n");
      const totalFileLines = allLines.length;

      const effectiveMaxLines = clampLimit(
        limitLines,
        config.maxLines ?? DEFAULT_MAX_LINES,
        config.maxLimitLines,
      );
      const effectiveMaxBytes = clampLimit(
        limitBytes,
        config.maxBytes ?? DEFAULT_MAX_BYTES,
        config.maxLimitBytes,
      );

      let startLine = 0;
      let startByte = 0;
      let selectedContent = textContent;

      const hasOffsetBytes = offsetBytes !== undefined;
      if (hasOffsetBytes) {
        startByte = Math.max(0, Math.floor(offsetBytes));
        if (startByte >= buffer.length) {
          throw new Error(
            `offsetBytes ${offsetBytes} is beyond end of file (${buffer.length} bytes total)`,
          );
        }

        selectedContent = buffer.subarray(startByte).toString("utf-8");
        const prefixText = buffer.subarray(0, startByte).toString("utf-8");
        startLine =
          prefixText.length === 0 ? 0 : prefixText.split("\n").length - 1;
      } else {
        startLine =
          offsetLines !== undefined
            ? Math.max(0, Math.floor(offsetLines) - 1)
            : 0;

        if (startLine >= allLines.length) {
          throw new Error(
            `offsetLines ${offsetLines} is beyond end of file (${allLines.length} lines total)`,
          );
        }

        selectedContent = allLines.slice(startLine).join("\n");

        if (startLine > 0) {
          startByte = Buffer.byteLength(
            `${allLines.slice(0, startLine).join("\n")}\n`,
            "utf-8",
          );
        }
      }

      const startLineDisplay = startLine + 1;
      const truncation = truncateHead(selectedContent, {
        maxLines: effectiveMaxLines,
        maxBytes: effectiveMaxBytes,
      });

      const nextOffsetLines = startLine + truncation.outputLines + 1;
      const nextOffsetBytes = startByte + truncation.outputBytes;

      let outputText = truncation.content;
      const details: Record<string, unknown> = {
        truncation,
        effectiveLimits: {
          maxLines: effectiveMaxLines,
          maxBytes: effectiveMaxBytes,
        },
        nextOffsetLines,
        nextOffsetBytes,
      };

      if (truncation.firstLineExceedsLimit) {
        const firstLine = selectedContent.split("\n", 1)[0] ?? "";
        const firstLineSize = formatSize(Buffer.byteLength(firstLine, "utf-8"));
        outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(
          effectiveMaxBytes,
        )} limit. Retry with a larger limitBytes (up to ${formatSize(
          config.maxLimitBytes ?? DEFAULT_MAX_LIMIT_BYTES,
        )}) or use bash for byte-level reads.]`;
      } else if (truncation.truncated) {
        const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
        outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offsetLines=${nextOffsetLines} to continue or offsetBytes=${nextOffsetBytes} for byte-based paging.]`;
      }

      return {
        content: [{ type: "text", text: outputText }],
        details,
      };
    },
  });

  // Clear cache on session start (in case configs changed)
  pi.on("session_start", async (_event, ctx) => {
    configCache.delete(ctx.cwd);
    coreReadCache.delete(ctx.cwd);
  });
}
