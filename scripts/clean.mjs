import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputNames = ["dist", ".next", "coverage", "test-results", "playwright-report"];
const workspaceGroups = ["apps", "modules", "packages"];
const targets = [".turbo", "dist", "coverage"].map((name) => join(projectRoot, name));

for (const group of workspaceGroups) {
  const groupPath = join(projectRoot, group);
  let entries;

  try {
    entries = await readdir(groupPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspacePath = join(groupPath, entry.name);
    for (const outputName of outputNames) {
      targets.push(join(workspacePath, outputName));
    }
  }
}

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
}

console.log("Removed workspace build outputs, caches, coverage, and Playwright reports.");
