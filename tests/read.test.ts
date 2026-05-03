import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import readExtension from "../src/index.ts";

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

async function makeTempProject(config: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), "pi-read-test-"));
  tempDirs.push(dir);
  await mkdir(join(dir, ".pi"), { recursive: true });
  await writeFile(
    join(dir, ".pi", "settings.json"),
    JSON.stringify({ readTool: config }, null, 2),
    "utf-8",
  );
  return dir;
}

async function writeProjectFile(cwd: string, relPath: string, content: string) {
  const fullPath = join(cwd, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
  return fullPath;
}

function buildTool(): RegisteredTool {
  const tools: RegisteredTool[] = [];
  const piMock = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    registerCommand() {
      // no-op
    },
    on() {
      // no-op
    },
  };

  readExtension(piMock as any);
  const tool = tools.find((t) => t.name === "read");
  if (!tool) throw new Error("read tool was not registered");
  return tool;
}

async function runRead(
  tool: RegisteredTool,
  cwd: string,
  args: Record<string, unknown>,
) {
  return tool.execute("test-call", args, undefined, () => {}, { cwd });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("pi-read tool", () => {
  it("uses offsetBytes when both offsets are provided", async () => {
    const cwd = await makeTempProject({
      maxLines: 100,
      maxBytes: 1000,
      maxLimitLines: 2000,
      maxLimitBytes: 51200,
    });

    await writeProjectFile(cwd, "sample.txt", "line1\nline2\nline3\n");

    const tool = buildTool();
    const result = await runRead(tool, cwd, {
      path: "sample.txt",
      offsetLines: 3,
      offsetBytes: 6,
      limitLines: 10,
      limitBytes: 1000,
    });

    const text = result.content[0].text as string;
    expect(text.startsWith("line2")).toBe(true);
    expect(text.includes("line3")).toBe(true);
  });

  it("clamps requested limitBytes to maxLimitBytes", async () => {
    const cwd = await makeTempProject({
      maxLines: 100,
      maxBytes: 100,
      maxLimitLines: 2000,
      maxLimitBytes: 10,
    });

    await writeProjectFile(cwd, "bytes.txt", "a\nb\nc\nd\ne\nf\ng\n");

    const tool = buildTool();
    const result = await runRead(tool, cwd, {
      path: "bytes.txt",
      limitBytes: 1000,
      limitLines: 100,
    });

    expect(result.details.effectiveLimits.maxBytes).toBe(10);
    expect(result.details.truncation.maxBytes).toBe(10);
  });

  it("clamps requested limitLines to maxLimitLines", async () => {
    const cwd = await makeTempProject({
      maxLines: 100,
      maxBytes: 1000,
      maxLimitLines: 2,
      maxLimitBytes: 51200,
    });

    await writeProjectFile(cwd, "lines.txt", "1\n2\n3\n4\n");

    const tool = buildTool();
    const result = await runRead(tool, cwd, {
      path: "lines.txt",
      limitLines: 99,
      limitBytes: 1000,
    });

    const text = result.content[0].text as string;
    expect(result.details.effectiveLimits.maxLines).toBe(2);
    expect(result.details.truncation.maxLines).toBe(2);
    expect(result.details.truncation.outputLines).toBe(2);
    expect(text.startsWith("1\n2\n")).toBe(true);
  });

  it("uses configured defaults when limits are omitted", async () => {
    const cwd = await makeTempProject({
      maxLines: 3,
      maxBytes: 1000,
      maxLimitLines: 2000,
      maxLimitBytes: 51200,
    });

    await writeProjectFile(cwd, "defaults.txt", "a\nb\nc\nd\ne\n");

    const tool = buildTool();
    const result = await runRead(tool, cwd, {
      path: "defaults.txt",
    });

    expect(result.details.effectiveLimits.maxLines).toBe(3);
    expect(result.details.truncation.maxLines).toBe(3);
    expect((result.content[0].text as string).includes("offsetLines=")).toBe(
      true,
    );
  });

  it("includes both next offsets in truncation hint", async () => {
    const cwd = await makeTempProject({
      maxLines: 2,
      maxBytes: 1000,
      maxLimitLines: 2000,
      maxLimitBytes: 51200,
    });

    await writeProjectFile(cwd, "hint.txt", "aa\nbb\ncc\ndd\n");

    const tool = buildTool();
    const result = await runRead(tool, cwd, {
      path: "hint.txt",
    });

    const text = result.content[0].text as string;
    expect(text.includes("offsetLines=")).toBe(true);
    expect(text.includes("offsetBytes=")).toBe(true);
    expect(result.details.nextOffsetLines).toBeGreaterThan(1);
    expect(result.details.nextOffsetBytes).toBeGreaterThan(0);
  });
});
