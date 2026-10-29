import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { operatorCommand, type OperatorCommand } from "../src/lib/operator";

export async function remoteOperator(input: OperatorCommand) {
  const command = operatorCommand.parse(input);
  const write = command.action === "set_feature_access";
  const key =
    process.env[write ? "LASTPEEK_OPS_FLAGS_KEY" : "LASTPEEK_OPS_READ_KEY"];
  const hostKey = process.env.LASTPEEK_OPS_HOST_KEY;
  if (!key || !hostKey)
    throw new Error(
      "Operator credentials are not configured. See docs/operations.md.",
    );
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+(?: .*)?$/.test(hostKey))
    throw new Error("Invalid pinned host key.");
  const directory = await mkdtemp(join(tmpdir(), "lastpeek-ops-"));
  try {
    await writeFile(join(directory, "key"), key.trim() + "\n", { mode: 0o600 });
    await writeFile(
      join(directory, "hosts"),
      `[100.124.28.78]:2222 ${hostKey}\n`,
      { mode: 0o600 },
    );
    const args = [
      "-F",
      "/dev/null",
      "-T",
      "-p",
      "2222",
      "-i",
      join(directory, "key"),
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "IdentityAgent=none",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      `UserKnownHostsFile=${join(directory, "hosts")}`,
      "-o",
      "GlobalKnownHostsFile=/dev/null",
      "-o",
      "ConnectTimeout=10",
      "lastpeek-ops@100.124.28.78",
    ];
    const result = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "ssh",
        args,
        { timeout: 35000, maxBuffer: 1000000 },
        (error, stdout) => {
          if (error && !stdout.trim())
            reject(
              new Error(
                "Operator SSH failed. Check Tailscale connectivity, pinned host key and credential.",
              ),
            );
          else resolve(stdout);
        },
      );
      child.stdin!.on("error", () => {
        /* SSH failure is reported by its completion callback. */
      });
      child.stdin!.end(JSON.stringify(command));
    });
    const parsed = JSON.parse(result);
    if (typeof parsed.ok !== "boolean")
      throw new Error("Invalid operator response.");
    return parsed;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
