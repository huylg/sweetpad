import fs from "node:fs/promises";
import path from "node:path";

export type StateMap = Record<string, unknown>;

const STATE_FILE = "cli-state.json";

export async function loadState(storagePath: string): Promise<StateMap> {
  const statePath = path.join(storagePath, STATE_FILE);
  try {
    const content = await fs.readFile(statePath, "utf-8");
    return JSON.parse(content) as StateMap;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveState(storagePath: string, state: StateMap): Promise<void> {
  const statePath = path.join(storagePath, STATE_FILE);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export function getRememberedValue<T>(state: StateMap, key: string): T | undefined {
  return state[key] as T | undefined;
}

export function setRememberedValue(state: StateMap, key: string, value: unknown): StateMap {
  return {
    ...state,
    [key]: value,
  };
}

export function removeRememberedValue(state: StateMap, key: string): StateMap {
  const newState = { ...state };
  delete newState[key];
  return newState;
}
