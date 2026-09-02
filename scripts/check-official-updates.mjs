import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const baseline = JSON.parse(
  readFileSync(new URL("../UPSTREAM_BASELINE.json", import.meta.url), "utf8"),
);
const git = (...args) =>
  execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const remoteUrl = git("remote", "get-url", baseline.remote);
if (remoteUrl !== baseline.repository) {
  throw new Error(
    `Remote ${baseline.remote} points to ${remoteUrl}; expected ${baseline.repository}`,
  );
}

if (process.argv.includes("--fetch")) {
  execFileSync("git", ["fetch", baseline.remote, "main", "--prune"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
}

git("cat-file", "-e", `${baseline.commit}^{commit}`);
const tip = git("rev-parse", `${baseline.remote}/main`);
console.log(`Recorded official baseline: ${baseline.commit} (${baseline.packageVersion})`);
console.log(`Current ${baseline.remote}/main: ${tip}`);

if (tip === baseline.commit) {
  console.log("Official upstream is already at the recorded baseline.");
  process.exit(0);
}

const commitCount = git("rev-list", "--count", `${baseline.commit}..${tip}`);
console.log(`Official upstream has ${commitCount} newer commit(s).`);
const changed = git(
  "diff",
  "--name-status",
  `${baseline.commit}..${tip}`,
  "--",
  ...baseline.trackedSurfaces,
);
console.log(changed || "No tracked plugin surface changed.");
console.log(
  "Review and port these changes into this repository; never push local commits to the official remote.",
);
