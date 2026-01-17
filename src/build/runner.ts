import path from "node:path";
import type { TaskTerminal, Command } from "../common/tasks";
import {
  type XcodeBuildServerConfig,
  generateBuildServerConfig,
  getBuildSettingsToLaunch,
  getIsXcbeautifyInstalled,
  getIsXcodeBuildServerInstalled,
  getXcodeVersionInstalled,
  readXcodeBuildServerConfig,
} from "../common/cli/scripts";
import { ExtensionError } from "../common/errors";
import { createDirectory, isFileExists, readJsonFile, removeDirectory, tempFilePathInDirectory } from "../common/files";
import { assertUnreachable } from "../common/types";
import type { Destination } from "../destination/types";
import type { DeviceDestination } from "../devices/types";
import type { SimulatorDestination } from "../simulators/types";

export type BuildRuntimeContext = {
  workspacePath: string;
  storagePath: string;
  updateProgressStatus(message: string): void;
  updateWorkspaceState?(key: string, value: unknown): void;
  getConfig<T>(key: string): T | undefined;
  getConfigOrDefault<T>(key: string, fallback: T): T;
  getSimulatorByUdid(udid: string): Promise<SimulatorDestination>;
  onSimulatorBooted?: () => Promise<void> | void;
  onBuildCompleted?: () => Promise<void> | void;
};

function writeWatchMarkers(terminal: TaskTerminal) {
  terminal.write("🍭 SweetPad: watch marker (start)\n");
  terminal.write("🍩 SweetPad: watch marker (end)\n\n");
}

async function ensureAppPathExists(appPath: string | undefined): Promise<string> {
  if (!appPath) {
    throw new ExtensionError("App path is empty. Something went wrong.");
  }

  const isExists = await isFileExists(appPath);
  if (!isExists) {
    throw new ExtensionError(`App path does not exist. Have you built the app? Path: ${appPath}`);
  }
  return appPath;
}

function prepareDerivedDataPath(runtime: BuildRuntimeContext): string | null {
  const configPath = runtime.getConfig<string>("build.derivedDataPath");
  if (!configPath) {
    return null;
  }

  if (path.isAbsolute(configPath)) {
    return configPath;
  }

  return path.join(runtime.workspacePath, configPath);
}

async function prepareBundleDir(runtime: BuildRuntimeContext, scheme: string): Promise<string> {
  await createDirectory(runtime.storagePath);
  const bundleDir = path.join(runtime.storagePath, "bundle", scheme);

  await removeDirectory(bundleDir);
  const xcresult = path.join(runtime.storagePath, "bundle", `${scheme}.xcresult`);
  await removeDirectory(xcresult);

  return bundleDir;
}

/**
 * Check if buildServer.json needs to be regenerated and regenerate it if needed
 */
async function generateBuildServerConfigOnBuild(runtime: BuildRuntimeContext, options: { scheme: string; xcworkspace: string }) {
  const isEnabled = runtime.getConfigOrDefault("xcodebuildserver.autogenerate", true);
  if (!isEnabled) {
    return;
  }

  const xcodebuildServerPath = runtime.getConfig<string>("xcodebuildserver.path");
  const isServerInstalled = await getIsXcodeBuildServerInstalled({ xcodebuildServerPath });
  if (!isServerInstalled) {
    return;
  }

  let config: XcodeBuildServerConfig | undefined = undefined;
  try {
    config = await readXcodeBuildServerConfig(runtime.workspacePath);
  } catch (e) {
    // regenerate config in case of errors like JSON invalid or file does not exist
  }

  const isConfigValid =
    config &&
    config.scheme === options.scheme &&
    config.workspace &&
    config.build_root &&
    (await isFileExists(config.build_root)) &&
    (await isFileExists(config.workspace));

  if (!isConfigValid) {
    await generateBuildServerConfig({
      xcworkspace: options.xcworkspace,
      scheme: options.scheme,
      xcodebuildServerPath,
    });
  }
}

export async function runOnMac(
  runtime: BuildRuntimeContext,
  terminal: TaskTerminal,
  options: {
    scheme: string;
    xcworkspace: string;
    configuration: string;
    watchMarker: boolean;
    launchArgs: string[];
    launchEnv: Record<string, string>;
  },
) {
  runtime.updateProgressStatus("Extracting build settings");
  const buildSettings = await getBuildSettingsToLaunch({
    scheme: options.scheme,
    configuration: options.configuration,
    sdk: "macosx",
    xcworkspace: options.xcworkspace,
    derivedDataPath: prepareDerivedDataPath(runtime),
  });

  const executablePath = await ensureAppPathExists(buildSettings.executablePath);

  runtime.updateWorkspaceState?.("build.lastLaunchedApp", {
    type: "macos",
    appPath: executablePath,
  });
  if (options.watchMarker) {
    writeWatchMarkers(terminal);
  }

  runtime.updateProgressStatus(`Running "${options.scheme}" on Mac`);
  await terminal.execute({
    command: executablePath,
    env: options.launchEnv,
    args: options.launchArgs,
  });
}

export async function runOniOSSimulator(
  runtime: BuildRuntimeContext,
  terminal: TaskTerminal,
  options: {
    scheme: string;
    destination: SimulatorDestination;
    sdk: string;
    configuration: string;
    xcworkspace: string;
    watchMarker: boolean;
    launchArgs: string[];
    launchEnv: Record<string, string>;
    debug: boolean;
  },
) {
  const simulatorId = options.destination.udid;

  runtime.updateProgressStatus("Extracting build settings");
  const buildSettings = await getBuildSettingsToLaunch({
    scheme: options.scheme,
    configuration: options.configuration,
    sdk: options.sdk,
    xcworkspace: options.xcworkspace,
    derivedDataPath: prepareDerivedDataPath(runtime),
  });
  const appPath = await ensureAppPathExists(buildSettings.appPath);
  const bundlerId = buildSettings.bundleIdentifier;

  // Get simulator with fresh state
  runtime.updateProgressStatus(`Searching for simulator "${simulatorId}"`);
  const simulator = await runtime.getSimulatorByUdid(simulatorId);

  // Boot device
  if (!simulator.isBooted) {
    runtime.updateProgressStatus(`Booting simulator "${simulator.name}"`);
    await terminal.execute({
      command: "xcrun",
      args: ["simctl", "boot", simulator.udid],
    });

    await runtime.onSimulatorBooted?.();
  }

  // Open simulator
  runtime.updateProgressStatus("Launching Simulator.app");
  const bringToForeground = runtime.getConfigOrDefault("build.bringSimulatorToForeground", true);
  const openArgs = bringToForeground ? ["-a", "Simulator"] : ["-g", "-a", "Simulator"];
  await terminal.execute({
    command: "open",
    args: openArgs,
  });

  // Install app
  runtime.updateProgressStatus(`Installing "${options.scheme}" on "${simulator.name}"`);
  await terminal.execute({
    command: "xcrun",
    args: ["simctl", "install", simulator.udid, appPath],
  });

  runtime.updateWorkspaceState?.("build.lastLaunchedApp", {
    type: "simulator",
    appPath: appPath,
  });
  if (options.watchMarker) {
    writeWatchMarkers(terminal);
  }

  const launchArgs = [
    "simctl",
    "launch",
    "--console-pty",
    ...(options.debug ? ["--wait-for-debugger"] : []),
    "--terminate-running-process",
    simulator.udid,
    bundlerId,
    ...options.launchArgs,
  ];

  // Run app
  runtime.updateProgressStatus(`Running "${options.scheme}" on "${simulator.name}"`);
  await terminal.execute({
    command: "xcrun",
    args: launchArgs,
    env: Object.fromEntries(Object.entries(options.launchEnv).map(([key, value]) => [`SIMCTL_CHILD_${key}`, value])),
  });
}

export async function runOniOSDevice(
  runtime: BuildRuntimeContext,
  terminal: TaskTerminal,
  option: {
    scheme: string;
    configuration: string;
    destination: DeviceDestination;
    sdk: string;
    xcworkspace: string;
    watchMarker: boolean;
    launchArgs: string[];
    launchEnv: Record<string, string>;
  },
) {
  const { scheme, configuration, destination } = option;
  const { udid: deviceId, type: destinationType, name: destinationName } = destination;

  runtime.updateProgressStatus("Extracting build settings");
  const buildSettings = await getBuildSettingsToLaunch({
    scheme: scheme,
    configuration: configuration,
    sdk: option.sdk,
    xcworkspace: option.xcworkspace,
    derivedDataPath: prepareDerivedDataPath(runtime),
  });

  const targetPath = await ensureAppPathExists(buildSettings.appPath);
  const bundlerId = buildSettings.bundleIdentifier;

  // Install app on device
  runtime.updateProgressStatus(`Installing "${scheme}" on "${destinationName}"`);
  await terminal.execute({
    command: "xcrun",
    args: ["devicectl", "device", "install", "app", "--device", deviceId, targetPath],
  });

  runtime.updateWorkspaceState?.("build.lastLaunchedApp", {
    type: "device",
    appPath: targetPath,
    appName: buildSettings.appName,
    destinationId: deviceId,
    destinationType: destinationType,
  });

  await using jsonOuputPath = await tempFilePathInDirectory(runtime.storagePath, {
    prefix: "json",
  });

  runtime.updateProgressStatus("Extracting Xcode version");
  const xcodeVersion = await getXcodeVersionInstalled();
  const isConsoleOptionSupported = xcodeVersion.major >= 16;

  if (option.watchMarker) {
    writeWatchMarkers(terminal);
  }

  const launchArgs = [
    "devicectl",
    "device",
    "process",
    "launch",
    isConsoleOptionSupported ? "--console" : null,
    "--json-output",
    jsonOuputPath.path,
    "--terminate-existing",
    "--device",
    deviceId,
    bundlerId,
    ...option.launchArgs,
  ].filter((arg) => arg !== null);

  runtime.updateProgressStatus(`Running "${option.scheme}" on "${option.destination.name}"`);
  await terminal.execute({
    command: "xcrun",
    args: launchArgs,
    env: Object.fromEntries(Object.entries(option.launchEnv).map(([key, value]) => [`DEVICECTL_CHILD_${key}`, value])),
  });

  let jsonOutput: any;
  try {
    jsonOutput = await readJsonFile(jsonOuputPath.path);
  } catch (e) {
    throw new ExtensionError("Error reading json output");
  }

  if (jsonOutput.info.outcome !== "success") {
    terminal.write("Error launching app on device", {
      newLine: true,
    });
    terminal.write(JSON.stringify(jsonOutput.result, null, 2), {
      newLine: true,
    });
    return;
  }
  terminal.write(`App launched on device with PID: ${jsonOutput.result.process.processIdentifier}`, {
    newLine: true,
  });
}

export function isXcbeautifyEnabled(runtime: BuildRuntimeContext) {
  return runtime.getConfigOrDefault("build.xcbeautifyEnabled", true);
}

function buildDestinationString(options: { platform: string; id?: string; arch?: string }): string {
  const { platform, id, arch } = options;
  if (id && arch) {
    return `platform=${platform},id=${id},arch=${arch}`;
  }
  if (id && !arch) {
    return `platform=${platform},id=${id}`;
  }
  if (!id && arch) {
    return `platform=${platform},arch=${arch}`;
  }
  return `platform=${platform}`;
}

function getSimulatorArch(runtime: BuildRuntimeContext): string | undefined {
  const useRosetta = runtime.getConfigOrDefault("build.rosettaDestination", false);
  if (useRosetta) {
    return "x86_64";
  }
  return undefined;
}

export function getXcodeBuildDestinationString(
  runtime: BuildRuntimeContext,
  options: { destination: Destination },
): string {
  const destination = options.destination;

  if (destination.type === "iOSSimulator") {
    const arch = getSimulatorArch(runtime);
    return buildDestinationString({ platform: "iOS Simulator", id: destination.udid, arch: arch });
  }
  if (destination.type === "watchOSSimulator") {
    const arch = getSimulatorArch(runtime);
    return buildDestinationString({ platform: "watchOS Simulator", id: destination.udid, arch: arch });
  }
  if (destination.type === "tvOSSimulator") {
    const arch = getSimulatorArch(runtime);
    return buildDestinationString({ platform: "tvOS Simulator", id: destination.udid, arch: arch });
  }
  if (destination.type === "visionOSSimulator") {
    const arch = getSimulatorArch(runtime);
    return buildDestinationString({ platform: "visionOS Simulator", id: destination.udid, arch: arch });
  }
  if (destination.type === "macOS") {
    return buildDestinationString({ platform: "macOS", arch: destination.arch });
  }
  if (destination.type === "iOSDevice") {
    return buildDestinationString({ platform: "iOS", id: destination.udid });
  }
  if (destination.type === "watchOSDevice") {
    return buildDestinationString({ platform: "watchOS", id: destination.udid });
  }
  if (destination.type === "tvOSDevice") {
    return buildDestinationString({ platform: "tvOS", id: destination.udid });
  }
  if (destination.type === "visionOSDevice") {
    return buildDestinationString({ platform: "visionOS", id: destination.udid });
  }
  return assertUnreachable(destination);
}

class XcodeCommandBuilder {
  NO_VALUE = "__NO_VALUE__";

  private xcodebuild = "xcodebuild";
  private parameters: {
    arg: string;
    value: string | "__NO_VALUE__";
  }[] = [];
  private buildSettings: { key: string; value: string }[] = [];
  private actions: string[] = [];

  addBuildSettings(key: string, value: string) {
    this.buildSettings.push({
      key: key,
      value: value,
    });
  }

  addOption(flag: string) {
    this.parameters.push({
      arg: flag,
      value: this.NO_VALUE,
    });
  }

  addParameters(arg: string, value: string) {
    this.parameters.push({
      arg: arg,
      value: value,
    });
  }

  addAction(action: string) {
    this.actions.push(action);
  }

  addAdditionalArgs(args: string[]) {
    if (args.length === 0) {
      return;
    }

    for (let i = 0; i < args.length; i++) {
      const current = args[i];
      const next = args[i + 1];
      if (current && next && current.startsWith("-") && !next.startsWith("-")) {
        this.parameters.push({
          arg: current,
          value: next,
        });
        i++;
      } else if (current?.startsWith("-")) {
        this.parameters.push({
          arg: current,
          value: this.NO_VALUE,
        });
      } else if (current?.includes("=")) {
        const [arg, value] = current.split("=");
        this.buildSettings.push({
          key: arg,
          value: value,
        });
      } else if (["clean", "build", "test"].includes(current)) {
        this.actions.push(current);
      } else {
        console.warn("Unknown argument", {
          argument: current,
          args: args,
        });
      }
    }

    const seenParameters = new Set<string>();
    this.parameters = this.parameters
      .slice()
      .reverse()
      .filter((param) => {
        if (seenParameters.has(param.arg)) {
          return false;
        }
        seenParameters.add(param.arg);
        return true;
      })
      .reverse();

    const seenActions = new Set<string>();
    this.actions = this.actions.filter((action) => {
      if (seenActions.has(action)) {
        return false;
      }
      seenActions.add(action);
      return true;
    });

    const seenSettings = new Set<string>();
    this.buildSettings = this.buildSettings
      .slice()
      .reverse()
      .filter((setting) => {
        if (seenSettings.has(setting.key)) {
          return false;
        }
        seenSettings.add(setting.key);
        return true;
      })
      .reverse();
  }

  build(): string[] {
    const commandParts = [this.xcodebuild];

    for (const { key, value } of this.buildSettings) {
      commandParts.push(`${key}=${value}`);
    }

    for (const { arg, value } of this.parameters) {
      commandParts.push(arg);
      if (value !== this.NO_VALUE) {
        commandParts.push(value);
      }
    }

    for (const action of this.actions) {
      commandParts.push(action);
    }
    return commandParts;
  }
}

export async function buildApp(
  runtime: BuildRuntimeContext,
  terminal: TaskTerminal,
  options: {
    scheme: string;
    sdk: string;
    configuration: string;
    shouldBuild: boolean;
    shouldClean: boolean;
    shouldTest: boolean;
    xcworkspace: string;
    destinationRaw: string;
    debug: boolean;
  },
) {
  const useXcbeatify = isXcbeautifyEnabled(runtime) && (await getIsXcbeautifyInstalled());
  const bundlePath = await prepareBundleDir(runtime, options.scheme);
  const derivedDataPath = prepareDerivedDataPath(runtime);

  const arch = runtime.getConfig<string>("build.arch") || undefined;
  const allowProvisioningUpdates = runtime.getConfigOrDefault("build.allowProvisioningUpdates", true);

  const additionalArgs: string[] = runtime.getConfig("build.args") || [];
  const env: Record<string, string | null> = runtime.getConfig("build.env") || {};

  const command = new XcodeCommandBuilder();
  if (arch) {
    command.addBuildSettings("ARCHS", arch);
    command.addBuildSettings("VALID_ARCHS", arch);
    command.addBuildSettings("ONLY_ACTIVE_ARCH", "NO");
  }

  if (options.debug) {
    command.addBuildSettings("GCC_GENERATE_DEBUGGING_SYMBOLS", "YES");
    command.addBuildSettings("ONLY_ACTIVE_ARCH", "YES");
  }

  command.addParameters("-scheme", options.scheme);
  command.addParameters("-configuration", options.configuration);
  command.addParameters("-workspace", options.xcworkspace);
  command.addParameters("-destination", options.destinationRaw);
  command.addParameters("-resultBundlePath", bundlePath);
  if (derivedDataPath) {
    command.addParameters("-derivedDataPath", derivedDataPath);
  }
  if (allowProvisioningUpdates) {
    command.addOption("-allowProvisioningUpdates");
  }

  if (options.shouldClean) {
    command.addAction("clean");
  }
  if (options.shouldBuild) {
    command.addAction("build");
  }
  if (options.shouldTest) {
    command.addAction("test");
  }
  command.addAdditionalArgs(additionalArgs);

  const commandParts = command.build();
  let pipes: Command[] | undefined = undefined;
  if (useXcbeatify) {
    pipes = [{ command: "xcbeautify", args: [] }];
  }

  if (options.shouldClean) {
    runtime.updateProgressStatus(`Cleaning "${options.scheme}"`);
  } else if (options.shouldBuild) {
    runtime.updateProgressStatus(`Building "${options.scheme}"`);
  } else if (options.shouldTest) {
    runtime.updateProgressStatus(`Building "${options.scheme}"`);
  }

  await generateBuildServerConfigOnBuild(runtime, {
    scheme: options.scheme,
    xcworkspace: options.xcworkspace,
  });

  await terminal.execute({
    command: commandParts[0],
    args: commandParts.slice(1),
    pipes: pipes,
    env: env,
  });

  await runtime.onBuildCompleted?.();
}
