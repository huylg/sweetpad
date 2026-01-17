import path from "node:path";
import { isFileExists, readJsonFile } from "../common/files";

type CliConfigMap = Record<string, unknown>;

function envKeyForConfigKey(key: string): string {
  return `SWEETPAD_${key.toUpperCase().replace(/\./g, "_")}`;
}

function parseEnvValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return trimmed;
    }
  }
  return trimmed;
}

function extractSweetpadConfig(settings: Record<string, unknown>): CliConfigMap {
  const config: CliConfigMap = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith("sweetpad.")) {
      continue;
    }
    const normalizedKey = key.replace(/^sweetpad\./, "");
    config[normalizedKey] = value;
  }
  return config;
}

export async function loadCliConfig(workspacePath: string): Promise<CliConfigMap> {
  const configPath = path.join(workspacePath, ".vscode", "settings.json");
  const config: CliConfigMap = {};

  if (await isFileExists(configPath)) {
    const settings = await readJsonFile<Record<string, unknown>>(configPath);
    Object.assign(config, extractSweetpadConfig(settings));
  }

  const knownKeys = new Set<string>([
    ...Object.keys(config),
    "build.configuration",
    "build.arch",
    "build.args",
    "build.env",
    "build.launchArgs",
    "build.launchEnv",
    "build.rosettaDestination",
    "build.allowProvisioningUpdates",
    "build.xcbeautifyEnabled",
    "build.derivedDataPath",
    "build.xcodeWorkspacePath",
    "build.bringSimulatorToForeground",
    "xcodebuildserver.autogenerate",
    "xcodebuildserver.path",
    "system.customXcodeWorkspaceParser",
  ]);

  for (const key of knownKeys) {
    const envKey = envKeyForConfigKey(key);
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      config[key] = parseEnvValue(envValue);
    }
  }

  return config;
}

export function getCliConfig<T>(config: CliConfigMap, key: string): T | undefined {
  return config[key] as T | undefined;
}

export function getCliConfigOrDefault<T>(config: CliConfigMap, key: string, fallback: T): T {
  const value = getCliConfig<T>(config, key);
  return value ?? fallback;
}
