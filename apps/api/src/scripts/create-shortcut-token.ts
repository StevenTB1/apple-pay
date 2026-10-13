import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../../.shortcut-credentials.json", import.meta.url));
const token = `ap_${randomBytes(32).toString("hex")}`;
const credentials = {
  token,
  sourceId: randomUUID(),
  tokenHash: createHash("sha256").update(token).digest("hex"),
};

try {
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Private Shortcut credentials saved to ${path}`);
  console.log("Copy token to the phone; configure sourceId and tokenHash in the API environment.");
  console.log("Keep this file private. The command never replaces an existing credential file.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EEXIST") {
    console.error("A private credential file already exists. Move it aside intentionally before generating a replacement.");
  } else {
    console.error("Could not save the private credential file.");
  }
  process.exitCode = 1;
}
