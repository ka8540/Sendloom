import { spawnSync } from "node:child_process";

// Preview deployments only need a compiled app. Keep the existing migration
// step for production and local builds, where the configured database is
// expected to be reachable.
const preview = process.env.VERCEL_ENV === "preview";
const steps = [
  ...(!preview ? [["prisma", "migrate", "deploy"]] : []),
  ["prisma", "generate"],
  ["next", "build"]
];

if (preview) {
  console.log("Vercel preview: skipping database migrations during build.");
}

for (const [command, ...args] of steps) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
