import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: () => void,
    ctx: { cwd: string },
  ) => Promise<any>;
};

const tempDirs: string[] = [];

async function makeTempProject() {
  const dir = await mkdtemp(join(tmpdir(), "pi-read-core-delegate-"));
  tempDirs.push(dir);
  await mkdir(join(dir, ".pi"), { recursive: true });
  await writeFile(
    join(dir, ".pi", "settings.json"),
    JSON.stringify({ readTool: { maxLines: 3, maxBytes: 1000 } }, null, 2),
    "utf-8",
  );
  return dir;
}

async function writeProjectFile(cwd: string, relPath: string, content: string) {
  const fullPath = join(cwd, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

function loadTool(readExtension: (pi: any) => void): RegisteredTool {
  const tools: RegisteredTool[] = [];
  const piMock = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    on() {},
  };

  readExtension(piMock);
  const tool = tools.find((t) => t.name === "read");
  if (!tool) throw new Error("read tool was not registered");
  return tool;
}

afterEach(async () => {
  vi.resetModules();
  vi.doUnmock("@earendil-works/pi-coding-agent");
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("pi-read image delegation", () => {
  it("delegates image reads to core read execute", async () => {
    const executeMock = vi.fn(async () => ({
      content: [{ type: "text", text: "core-image" }],
      details: { delegated: true },
    }));

    vi.doMock("@earendil-works/pi-coding-agent", async () => {
      const actual = await vi.importActual<any>(
        "@earendil-works/pi-coding-agent",
      );
      return {
        ...actual,
        createReadToolDefinition: vi.fn(() => ({ execute: executeMock })),
      };
    });

    const { default: readExtension } = await import("../src/index.ts");
    const cwd = await makeTempProject();
    await writeProjectFile(cwd, "sample.jpg", "fake-image");

    const tool = loadTool(readExtension as any);
    const result = await tool.execute(
      "t1",
      { path: "sample.jpg", offsetLines: 4, limitLines: 2 },
      undefined,
      () => {},
      { cwd },
    );

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][1]).toEqual({
      path: "sample.jpg",
      offset: 4,
      limit: 2,
    });
    expect(result.content[0].text).toBe("core-image");
  });

  it("fails fast when core read definition is incompatible", async () => {
    vi.doMock("@earendil-works/pi-coding-agent", async () => {
      const actual = await vi.importActual<any>(
        "@earendil-works/pi-coding-agent",
      );
      return {
        ...actual,
        createReadToolDefinition: vi.fn(() => ({})),
      };
    });

    const { default: readExtension } = await import("../src/index.ts");
    const cwd = await makeTempProject();
    await writeProjectFile(cwd, "sample.png", "fake-image");

    const tool = loadTool(readExtension as any);
    await expect(
      tool.execute("t2", { path: "sample.png" }, undefined, () => {}, { cwd }),
    ).rejects.toThrow(
      "Incompatible pi-coding-agent: createReadToolDefinition() did not return an executable read tool",
    );
  });
});
