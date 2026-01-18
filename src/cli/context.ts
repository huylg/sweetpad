import os from "node:os";
import path from "node:path";
import type { BuildRuntimeContext } from "../build/runner";
import { ExtensionError } from "../common/errors";
import { createDirectory } from "../common/files";
import type { SimulatorsManager } from "../simulators/manager";
import type { SimulatorDestination } from "../simulators/types";
import { getCliConfig, getCliConfigOrDefault } from "./config";
import { type StateMap, getRememberedValue, loadState, saveState, setRememberedValue } from "./state";

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
  private persistentState: StateMap = {};
  private simulatorsManager: SimulatorsManager;
  private stateDirty = false;

  private constructor(options: {
    workspacePath: string;
    storagePath: string;
    config: Record<string, unknown>;
    simulatorsManager: SimulatorsManager;
    persistentState?: StateMap;
  }) {
    this.workspacePath = options.workspacePath;
    this.storagePath = options.storagePath;
    this.config = options.config;
    this.simulatorsManager = options.simulatorsManager;
    this.persistentState = options.persistentState ?? {};
  }

  static async create(options: CliRuntimeOptions): Promise<CliRuntimeContext> {
    const storagePath = options.storagePath ?? (await resolveStoragePath(options.workspacePath));
    const persistentState = await loadState(storagePath);
    return new CliRuntimeContext({
      workspacePath: options.workspacePath,
      storagePath,
      config: options.config,
      simulatorsManager: options.simulatorsManager,
      persistentState,
    });
  }

  async savePersistentState(): Promise<void> {
    if (this.stateDirty) {
      await saveState(this.storagePath, this.persistentState);
      this.stateDirty = false;
    }
  }

  getRememberedValue<T>(key: string): T | undefined {
    return getRememberedValue<T>(this.persistentState, key);
  }

  setRememberedValue(key: string, value: unknown): void {
    this.persistentState = setRememberedValue(this.persistentState, key, value);
    this.stateDirty = true;
  }

  removeRememberedValue(key: string): void {
    this.persistentState = { ...this.persistentState };
    delete this.persistentState[key];
    this.stateDirty = true;
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
