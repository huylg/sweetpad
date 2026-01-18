import path from "node:path";
import { buildApp, getXcodeBuildDestinationString, runOnMac, runOniOSDevice, runOniOSSimulator } from "../build/runner";
import { getBuildSettingsToLaunch } from "../common/cli/scripts";
import { ExtensionError } from "../common/errors";
import { assertUnreachable } from "../common/types";
import type { Destination } from "../destination/types";
import { SimulatorsManager } from "../simulators/manager";
import { getCliConfig, loadCliConfig } from "./config";
import { CliRuntimeContext } from "./context";
import {
  listDestinations,
  pickConfigurationSmart,
  pickDestinationSmart,
  pickSchemeSmart,
  pickXcodeWorkspacePathSmart,
} from "./pickers";
import { CliTaskTerminal } from "./terminal";

type CliOptions = {
  command?: "build" | "run" | "clean" | "launch";
  workspaceRoot?: string;
  xcworkspace?: string;
  scheme?: string;
  configuration?: string;
  destinationId?: string;
  destinationName?: string;
  sdk?: string;
  debug?: boolean;
  launchArgs: string[];
  launchEnv: Record<string, string>;
  help?: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    launchArgs: [],
    launchEnv: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--debug") {
      options.debug = true;
      continue;
    }
    if (!arg.startsWith("-") && !options.command) {
      options.command = arg as CliOptions["command"];
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("-")) {
      throw new ExtensionError(`Missing value for ${arg}`);
    }

    switch (arg) {
      case "--workspace-root":
        options.workspaceRoot = next;
        i++;
        break;
      case "--xcworkspace":
        options.xcworkspace = next;
        i++;
        break;
      case "--scheme":
        options.scheme = next;
        i++;
        break;
      case "--configuration":
        options.configuration = next;
        i++;
        break;
      case "--destination-id":
        options.destinationId = next;
        i++;
        break;
      case "--destination":
        options.destinationName = next;
        i++;
        break;
      case "--sdk":
        options.sdk = next;
        i++;
        break;
      case "--launch-args":
        options.launchArgs.push(...parseListValue(next));
        i++;
        break;
      case "--launch-env":
        Object.assign(options.launchEnv, parseEnvValue(next));
        i++;
        break;
      default:
        throw new ExtensionError(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseListValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  }
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseEnvValue(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
    return {};
  }

  const env: Record<string, string> = {};
  for (const item of trimmed.split(",")) {
    const [key, ...rest] = item.split("=");
    if (!key || rest.length === 0) {
      continue;
    }
    env[key.trim()] = rest.join("=").trim();
  }
  return env;
}

function printHelp(): void {
  process.stdout.write(
    [
      "SweetPad CLI",
      "",
      "Usage:",
      "  sweetpad <command> [options]",
      "",
      "Commands:",
      "  build   Build the app",
      "  run     Build and run the app",
      "  clean   Clean build artifacts",
      "  launch  Build and launch in debug mode",
      "",
      "Options:",
      "  --workspace-root <path>   Workspace root (default: cwd)",
      "  --xcworkspace <path>      Xcode workspace path",
      "  --scheme <name>           Scheme name",
      "  --configuration <name>    Build configuration",
      "  --destination-id <id>     Destination UDID",
      "  --destination <name>      Destination name or label substring",
      "  --sdk <sdk>               Xcode SDK (macosx, iphonesimulator, ...)",
      "  --debug                   Enable debug build settings",
      "  --launch-args <args>      Comma-separated or JSON array",
      "  --launch-env <env>        KEY=VALUE pairs or JSON object",
      "  -h, --help                Show help",
      "",
    ].join("\n"),
  );
}

async function resolveXcworkspace(
  options: CliOptions,
  workspacePath: string,
  config: Record<string, unknown>,
  runtime: CliRuntimeContext,
): Promise<string> {
  const configPath = getCliConfig<string>(config, "build.xcodeWorkspacePath");
  const rawPath = options.xcworkspace ?? configPath;

  if (rawPath) {
    return path.isAbsolute(rawPath) ? rawPath : path.join(workspacePath, rawPath);
  }

  return await pickXcodeWorkspacePathSmart({ workspacePath, context: runtime });
}

function resolveDerivedDataPath(workspacePath: string, config: Record<string, unknown>): string | null {
  const configPath = getCliConfig<string>(config, "build.derivedDataPath");
  if (!configPath) {
    return null;
  }
  return path.isAbsolute(configPath) ? configPath : path.join(workspacePath, configPath);
}

async function resolveDestination(options: {
  simulatorsManager: SimulatorsManager;
  storagePath: string;
  scheme: string;
  configuration: string;
  sdk: string | undefined;
  xcworkspace: string;
  derivedDataPath?: string | null;
  destinationId?: string;
  destinationName?: string;
  runtime: CliRuntimeContext;
}): Promise<Destination> {
  if (!options.destinationId && !options.destinationName) {
    return await pickDestinationSmart({
      simulatorsManager: options.simulatorsManager,
      storagePath: options.storagePath,
      scheme: options.scheme,
      configuration: options.configuration,
      sdk: options.sdk,
      xcworkspace: options.xcworkspace,
      derivedDataPath: options.derivedDataPath,
      context: options.runtime,
    });
  }

  const destinations = await listDestinations({
    simulatorsManager: options.simulatorsManager,
    storagePath: options.storagePath,
  });

  if (options.destinationId) {
    const destinationId = options.destinationId;
    const destination = destinations.find((item) => matchDestinationId(item, destinationId));
    if (!destination) {
      throw new ExtensionError(`Destination not found for id: ${destinationId}`);
    }
    return destination;
  }

  const matches = destinations.filter((item) => matchDestinationName(item, options.destinationName ?? ""));
  if (matches.length === 0) {
    throw new ExtensionError(`Destination not found for name: ${options.destinationName}`);
  }
  if (matches.length === 1) {
    return matches[0];
  }

  return await pickDestinationSmart({
    simulatorsManager: options.simulatorsManager,
    storagePath: options.storagePath,
    scheme: options.scheme,
    configuration: options.configuration,
    sdk: options.sdk,
    xcworkspace: options.xcworkspace,
    derivedDataPath: options.derivedDataPath,
    context: options.runtime,
  });
}

function matchDestinationId(destination: Destination, id: string): boolean {
  const normalized = id.trim().toLowerCase();
  if ("udid" in destination) {
    return destination.udid.toLowerCase() === normalized || destination.id.toLowerCase() === normalized;
  }
  return destination.id.toLowerCase() === normalized;
}

function matchDestinationName(destination: Destination, name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const label = destination.label.toLowerCase();
  const destName = "name" in destination ? destination.name.toLowerCase() : label;
  return (
    label.includes(normalized) || destName.includes(normalized) || destination.id.toLowerCase().includes(normalized)
  );
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.command) {
    printHelp();
    return;
  }

  const workspacePath = path.resolve(options.workspaceRoot ?? process.cwd());
  process.chdir(workspacePath);
  const config = await loadCliConfig(workspacePath);
  const simulatorsManager = new SimulatorsManager();
  const useWorkspaceParser = getCliConfig<boolean>(config, "system.customXcodeWorkspaceParser") ?? false;

  const runtime = await CliRuntimeContext.create({
    workspacePath,
    config,
    simulatorsManager,
  });

  const xcworkspace = await resolveXcworkspace(options, workspacePath, config, runtime);
  const scheme = options.scheme ?? (await pickSchemeSmart({ xcworkspace, useWorkspaceParser, context: runtime }));
  const configuration =
    options.configuration ??
    getCliConfig<string>(config, "build.configuration") ??
    (await pickConfigurationSmart({ xcworkspace, useWorkspaceParser, context: runtime }));
  const derivedDataPath = resolveDerivedDataPath(workspacePath, config);

  const destination = await resolveDestination({
    simulatorsManager,
    storagePath: runtime.storagePath,
    scheme,
    configuration,
    sdk: options.sdk,
    xcworkspace,
    derivedDataPath,
    destinationId: options.destinationId,
    destinationName: options.destinationName,
    runtime,
  });

  await runtime.savePersistentState();

  const sdk = options.sdk ?? destination.platform;
  const destinationRaw = getXcodeBuildDestinationString(runtime, { destination });

  const launchArgs =
    options.launchArgs.length > 0 ? options.launchArgs : (getCliConfig<string[]>(config, "build.launchArgs") ?? []);
  const launchEnv =
    Object.keys(options.launchEnv).length > 0
      ? options.launchEnv
      : (getCliConfig<Record<string, string>>(config, "build.launchEnv") ?? {});

  const terminal = new CliTaskTerminal(workspacePath);
  const reportBuildOutput = async () => {
    const buildSettings = await getBuildSettingsToLaunch({
      scheme,
      configuration,
      sdk,
      xcworkspace,
      derivedDataPath,
    });
    const outputPath = buildSettings.appPath ?? buildSettings.executablePath;
    if (outputPath) {
      process.stdout.write(`SweetPad: Build output: ${outputPath}\n`);
    }
  };

  switch (options.command) {
    case "build": {
      await buildApp(runtime, terminal, {
        scheme,
        sdk,
        configuration,
        shouldBuild: true,
        shouldClean: false,
        shouldTest: false,
        xcworkspace,
        destinationRaw,
        debug: options.debug ?? false,
      });
      await reportBuildOutput();
      return;
    }
    case "clean": {
      await buildApp(runtime, terminal, {
        scheme,
        sdk,
        configuration,
        shouldBuild: false,
        shouldClean: true,
        shouldTest: false,
        xcworkspace,
        destinationRaw,
        debug: options.debug ?? false,
      });
      return;
    }
    case "run":
    case "launch": {
      const debug = options.command === "launch" ? true : (options.debug ?? false);
      await buildApp(runtime, terminal, {
        scheme,
        sdk,
        configuration,
        shouldBuild: true,
        shouldClean: false,
        shouldTest: false,
        xcworkspace,
        destinationRaw,
        debug,
      });
      await reportBuildOutput();

      if (destination.type === "macOS") {
        await runOnMac(runtime, terminal, {
          scheme,
          xcworkspace,
          configuration,
          watchMarker: false,
          launchArgs,
          launchEnv,
        });
      } else if (
        destination.type === "iOSSimulator" ||
        destination.type === "watchOSSimulator" ||
        destination.type === "tvOSSimulator" ||
        destination.type === "visionOSSimulator"
      ) {
        await runOniOSSimulator(runtime, terminal, {
          scheme,
          destination,
          sdk,
          configuration,
          xcworkspace,
          watchMarker: false,
          launchArgs,
          launchEnv,
          debug,
        });
      } else if (
        destination.type === "iOSDevice" ||
        destination.type === "watchOSDevice" ||
        destination.type === "tvOSDevice" ||
        destination.type === "visionOSDevice"
      ) {
        await runOniOSDevice(runtime, terminal, {
          scheme,
          destination,
          sdk,
          configuration,
          xcworkspace,
          watchMarker: false,
          launchArgs,
          launchEnv,
        });
      } else {
        assertUnreachable(destination);
      }
      return;
    }
    default:
      throw new ExtensionError(`Unknown command: ${options.command}`);
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`SweetPad CLI error: ${message}\n`);
  process.exitCode = 1;
});
