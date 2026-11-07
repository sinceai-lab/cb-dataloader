import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.logFile), { recursive: true });

// One line per message, to stdout (docker logs) and to the log file.
export function debug(message: string, data?: unknown) {
  const line = `${new Date().toISOString()} DEBUG ${message}${data === undefined ? "" : " " + JSON.stringify(data)}`;
  console.log(line);
  fs.appendFileSync(config.logFile, line + "\n");
}
