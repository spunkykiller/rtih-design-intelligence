import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function extractToken(text) {
  const patterns = [
    /github_pat_[A-Za-z0-9_]+/,
    /ghp_[A-Za-z0-9_]+/,
    /gho_[A-Za-z0-9_]+/,
    /ghu_[A-Za-z0-9_]+/,
    /ghs_[A-Za-z0-9_]+/,
    /ghr_[A-Za-z0-9_]+/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function tokenFromEnvironment() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const tokenFile = process.env.GITHUB_PAT_FILE;
  if (tokenFile && fs.existsSync(tokenFile)) {
    return extractToken(fs.readFileSync(tokenFile, "utf8"));
  }
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  return result;
}

function notify(event, message) {
  return run(process.execPath, ["scripts/notify-whatsapp.mjs", event, message], {
    env: process.env,
  });
}

const token = tokenFromEnvironment();
if (!token) {
  notify("roadblock", "Roadblock: GitHub token was not available for push.");
  console.error("Missing GITHUB_TOKEN or GITHUB_PAT_FILE.");
  process.exit(1);
}

const askpassPath = path.join(os.tmpdir(), `rtih-askpass-${Date.now()}.sh`);
fs.writeFileSync(
  askpassPath,
  `#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\\n' 'x-access-token' ;;
  *Password*) printf '%s\\n' "$GITHUB_TOKEN" ;;
  *) printf '\\n' ;;
esac
`,
  { mode: 0o700 },
);

const push = run("git", ["push", ...process.argv.slice(2)], {
  env: {
    ...process.env,
    GITHUB_TOKEN: token,
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: "0",
  },
});

fs.rmSync(askpassPath, { force: true });

if (push.status !== 0) {
  notify("roadblock", `Roadblock: Git push failed. ${push.stderr || push.stdout}`.slice(0, 700));
  process.stderr.write(push.stderr);
  process.stdout.write(push.stdout);
  process.exit(push.status ?? 1);
}

notify("push", "Pushed RTIH design intelligence updates to GitHub.");
process.stdout.write(push.stdout);
process.stderr.write(push.stderr);
