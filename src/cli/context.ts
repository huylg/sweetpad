import os from "node:os";
import path from "node:path";
import { ExtensionError } from "../common/errors";
import { createDirectory } from "../common/files";
import { getCliConfig, getCliConfigOrDefault } from "./config";
import type { BuildRuntimeContext } from "../build/runner";
import { SimulatorsManager } from "../simulators/manager";
import type { SimulatorDestination } from "../simulators/types";

type CliRuntimeOptions = {
  workspacePath: string;
  config: Record<string, unknown>;
  simulatorsManager: SimulatorsManager;
  storagePath?: string;
};

export class CliRuntimeContext implements BuildRuntimeContext {
  workspacePath: string;
  storagePath: string;
  private config: Record<string, unknown>;
  private state = new Map<string, unknown>();
  private simulatorsManager: SimulatorsManager;

  private constructor(options: {
    workspacePath: string;
    storagePath: string;
    config: Record<string, unknown>;
    simulatorsManager: SimulatorsManager;
  }) {
    this.workspacePath = options.workspacePath;
    this.storagePath = options.storagePath;
    this.config = options.config;
    this.simulatorsManager = options.simulatorsManager;
  }

  static async create(options: CliRuntimeOptions): Promise<CliRuntimeContext> {
    const storagePath = options.storagePath ?? (await resolveStoragePath(options.workspacePath));
    return new CliRuntimeContext({
      workspacePath: options.workspacePath,
      storagePath,
      config: options.config,
      simulatorsManager: options.simulatorsManager,
    });
  }

  updateProgressStatus(message: string): void {
    process.stdout.write(`SweetPad: ${message}\n`);
  }

  updateWorkspaceState(key: string, value: unknown): void {
    if (value === undefined) {
      this.state.delete(key);
      return;
    }
    this.state.set(key, value);
  }

  getWorkspaceState<T = unknown>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  getConfig<T>(key: string): T | undefined {
    return getCliConfig<T>(this.config, key);
  }

  getConfigOrDefault<T>(key: string, fallback: T): T {
    return getCliConfigOrDefault<T>(this.config, key, fallback);
  }

  async getSimulatorByUdid(udid: string): Promise<SimulatorDestination> {
    const simulators = await this.simulatorsManager.getSimulators({ refresh: true });
    const simulator = simulators.find((item) => item.udid === udid);
    if (!simulator) {
      throw new ExtensionError("Simulator not found", { context: { udid } });
    }
    return simulator;
  }

  async onSimulatorBooted(): Promise<void> {
    await this.simulatorsManager.refresh();
  }
}

async function resolveStoragePath(workspacePath: string): Promise<string> {
  const preferredPath = path.join(workspacePath, ".sweetpad");
  try {
    await createDirectory(preferredPath);
    return preferredPath;
  } catch (error) {
    const fallback = path.join(os.tmpdir(), "sweetpad");
    await createDirectory(fallback);
    return fallback;
  }
}
