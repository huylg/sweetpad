import { spawn } from "node:child_process";
import { quote } from "shell-quote";
import type { CommandOptions, TaskTerminal } from "../common/tasks";
import { prepareEnvVars } from "../common/helpers";

type TerminalTextColor = "green" | "red" | "blue" | "yellow" | "magenta" | "cyan" | "white";
type TerminalWriteOptions = {
  color?: TerminalTextColor;
  newLine?: boolean;
};

const TERMINAL_COLOR_MAP: Record<TerminalTextColor, string> = {
  green: "32",
  red: "31",
  blue: "34",
  yellow: "33",
  magenta: "35",
  cyan: "36",
  white: "37",
};

class LineBuffer {
  public buffer = "";
  public enabled = true;
  public callback: (line: string) => void;

  constructor(options: { enabled: boolean; callback: (line: string) => void }) {
    this.enabled = options.enabled;
    this.callback = options.callback;
  }

  append(data: string): void {
    if (!this.enabled) return;

    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      this.callback(line);
    }
  }

  flush(): void {
    if (!this.enabled) return;
    if (this.buffer) {
      this.callback(this.buffer);
      this.buffer = "";
    }
  }
}

export class CliTaskTerminal implements TaskTerminal {
  constructor(private workspacePath: string) {}

  private command(command: string, args?: string[]): string {
    return quote([command, ...(args ?? [])]);
  }

  private createCommandLine(options: CommandOptions): string {
    const args = (options.args ?? []).filter((arg) => arg !== null) as string[];
    const mainCommand = quote([options.command, ...args]);

    if (!options.pipes) {
      return mainCommand;
    }

    const commands = [mainCommand];
    commands.push(...options.pipes.map((pipe) => this.command(pipe.command, pipe.args)));
    return `set -o pipefail; ${commands.join(" | ")}`;
  }

  write(data: string, options?: TerminalWriteOptions): void {
    const color = options?.color;
    let output = data;
    if (color) {
      const colorCode = TERMINAL_COLOR_MAP[color];
      output = `\x1b[${colorCode}m${output}\x1b[0m`;
    }
    if (options?.newLine) {
      output += "\n";
    }
    process.stdout.write(output);
  }

  private writeLine(line?: string, options?: TerminalWriteOptions): void {
    this.write(line ?? "", {
      ...options,
      newLine: true,
    });
  }

  async execute(options: CommandOptions): Promise<void> {
    const commandLine = this.createCommandLine(options);
    const args = (options.args ?? []).filter((arg) => arg !== null) as string[];
    const commandPrint = this.command(options.command, args);

    this.writeLine("🚀 Executing command:");
    this.writeLine(commandPrint, { color: "green" });
    this.writeLine();

    let hasOutput = false;

    return new Promise<void>((resolve, reject) => {
      const stdouBuffer = new LineBuffer({
        enabled: !!options.onOutputLine,
        callback: (line) => {
          options.onOutputLine?.({ value: line, type: "stdout" });
        },
      });
      const stderrBuffer = new LineBuffer({
        enabled: !!options.onOutputLine,
        callback: (line) => {
          options.onOutputLine?.({ value: line, type: "stderr" });
        },
      });

      const env = { ...process.env, ...prepareEnvVars(options.env) };
      const processHandle = spawn(commandLine, {
        shell: true,
        env: env,
        cwd: this.workspacePath,
      });

      processHandle.stderr?.on("data", (data: string | Buffer): void => {
        const output = data.toString();
        this.write(output, { color: "yellow" });
        hasOutput = true;
        stderrBuffer.append(output);
      });
      processHandle.stdout?.on("data", (data: string | Buffer): void => {
        const output = data.toString();
        this.write(output);
        hasOutput = true;
        stdouBuffer.append(output);
      });
      processHandle.on("close", (code) => {
        if (hasOutput) {
          this.writeLine();
        }
        stdouBuffer.flush();
        stderrBuffer.flush();

        if (code !== 0) {
          reject(new Error(`Command failed with exit code ${code}: ${commandPrint}`));
        } else {
          resolve();
        }
      });
      processHandle.on("error", (error) => {
        if (hasOutput) {
          this.writeLine();
        }
        reject(error);
      });
    });
  }
}
