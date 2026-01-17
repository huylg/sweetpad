import { spawn } from "node:child_process";
import { ExtensionError } from "../common/errors";

type FzfItem<T> = {
  label: string;
  value: T;
};

export async function fzfPick<T>(options: { prompt: string; items: FzfItem<T>[] }): Promise<T> {
  const items = options.items;
  if (items.length === 0) {
    throw new ExtensionError("No items available for selection");
  }
  if (items.length === 1) {
    return items[0].value;
  }

  const input = items.map((item, index) => `${item.label}\t${index}`).join("\n");

  return new Promise<T>((resolve, reject) => {
    const child = spawn("fzf", ["--prompt", `${options.prompt} `, "--delimiter", "\t", "--with-nth", "1"]);

    let output = "";

    child.stdin.write(input);
    child.stdin.end();

    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new ExtensionError("fzf is required but not installed. Install it with `brew install fzf` and try again."),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new ExtensionError("Selection cancelled"));
        return;
      }

      const trimmed = output.trim();
      const indexPart = trimmed.split("\t")[1];
      const index = Number(indexPart);
      if (!Number.isFinite(index) || !items[index]) {
        reject(new ExtensionError("Failed to parse fzf selection"));
        return;
      }
      resolve(items[index].value);
    });
  });
}
