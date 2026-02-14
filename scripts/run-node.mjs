#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const env = { ...process.env };
const cwd = process.cwd();
const compiler = "tsdown";
const compilerArgs = [compiler, "--no-clean"];

const distRoot = path.join(cwd, "dist");
const distEntry = path.join(distRoot, "/entry.js");
const buildStampPath = path.join(distRoot, ".buildstamp");
const srcRoot = path.join(cwd, "src");
const configFiles = [path.join(cwd, "tsconfig.json"), path.join(cwd, "package.json")];

const statMtime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
};

const isExcludedSource = (filePath) => {
  const relativePath = path.relative(srcRoot, filePath);
  if (relativePath.startsWith("..")) {
    return false;
  }
  return (
    relativePath.endsWith(".test.ts") ||
    relativePath.endsWith(".test.tsx") ||
    relativePath.endsWith(`test-helpers.ts`)
  );
};

const findLatestMtime = (dirPath, shouldSkip) => {
  let latest = null;
  const queue = [dirPath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (shouldSkip?.(fullPath)) {
        continue;
      }
      const mtime = statMtime(fullPath);
      if (mtime == null) {
        continue;
      }
      if (latest == null || mtime > latest) {
        latest = mtime;
      }
    }
  }
  return latest;
};

const shouldBuild = () => {
  if (env.OPENCLAW_FORCE_BUILD === "1") {
    return true;
  }
  const stampMtime = statMtime(buildStampPath);
  if (stampMtime == null) {
    return true;
  }
  if (statMtime(distEntry) == null) {
    return true;
  }

  for (const filePath of configFiles) {
    const mtime = statMtime(filePath);
    if (mtime != null && mtime > stampMtime) {
      return true;
    }
  }

  const srcMtime = findLatestMtime(srcRoot, isExcludedSource);
  if (srcMtime != null && srcMtime > stampMtime) {
    return true;
  }
  return false;
};

const logRunner = (message) => {
  if (env.OPENCLAW_RUNNER_LOG === "0") {
    return;
  }
  process.stderr.write(`[openclaw] ${message}\n`);
};

const hasCommand = (cmd) => {
  const rawPath = env.PATH ?? "";
  if (!rawPath) {
    return false;
  }

  const dirs = rawPath.split(path.delimiter).filter(Boolean);
  const isWindows = process.platform === "win32";
  const pathExts = isWindows ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
  const hasExt = path.extname(cmd) !== "";

  for (const dir of dirs) {
    if (hasExt) {
      const full = path.join(dir, cmd);
      if (fs.existsSync(full)) {
        return true;
      }
      continue;
    }

    if (isWindows) {
      for (const ext of pathExts) {
        const full = path.join(dir, `${cmd}${ext}`);
        if (fs.existsSync(full)) {
          return true;
        }
      }
      continue;
    }

    const full = path.join(dir, cmd);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return true;
    } catch {
      // Not executable or doesn't exist; continue scanning.
    }
  }

  return false;
};

const getBuildCommand = () => {
  const isWindows = process.platform === "win32";

  if (hasCommand("bun")) {
    return { cmd: "bun", args: ["x", ...compilerArgs], label: "bun" };
  }

  if (hasCommand("pnpm")) {
    if (isWindows) {
      return { cmd: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", "exec", ...compilerArgs], label: "pnpm" };
    }
    return { cmd: "pnpm", args: ["exec", ...compilerArgs], label: "pnpm" };
  }

  if (hasCommand("npm")) {
    if (isWindows) {
      return { cmd: "cmd.exe", args: ["/d", "/s", "/c", "npm", "exec", "--", ...compilerArgs], label: "npm" };
    }
    return { cmd: "npm", args: ["exec", "--", ...compilerArgs], label: "npm" };
  }

  return null;
};

const runNode = () => {
  const nodeProcess = spawn(process.execPath, ["openclaw.mjs", ...args], {
    cwd,
    env,
    stdio: "inherit",
  });

  nodeProcess.on("exit", (exitCode, exitSignal) => {
    if (exitSignal) {
      process.exit(1);
    }
    process.exit(exitCode ?? 1);
  });
};

const writeBuildStamp = () => {
  try {
    fs.mkdirSync(distRoot, { recursive: true });
    fs.writeFileSync(buildStampPath, `${Date.now()}\n`);
  } catch (error) {
    // Best-effort stamp; still allow the runner to start.
    logRunner(`Failed to write build stamp: ${error?.message ?? "unknown error"}`);
  }
};

if (!shouldBuild()) {
  runNode();
} else {
  logRunner("Building TypeScript (dist is stale).");
  const buildTool = getBuildCommand();
  if (!buildTool) {
    logRunner("Build failed: no package runner found (need bun, pnpm, or npm in PATH).");
    process.exit(1);
  }
  logRunner(`Building TypeScript using ${buildTool.label}.`);
  const build = spawn(buildTool.cmd, buildTool.args, {
    cwd,
    env,
    stdio: "inherit",
  });

  build.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    if (code !== 0 && code !== null) {
      process.exit(code);
    }
    writeBuildStamp();
    runNode();
  });
}
