import path from "node:path";
const DEFAULT_DEBUG_CONFIGURATION = "Debug";
const DEFAULT_RELEASE_CONFIGURATION = "Release";
import { getBuildConfigurations, getBuildSettingsToAskDestination, getSchemes } from "../common/cli/scripts";
import { ExtensionError } from "../common/errors";
import { findFilesRecursive } from "../common/files";
import { checkUnreachable } from "../common/types";
import { listDevicesInDirectory } from "../common/xcode/devicectl";
import { type Destination, macOSDestination } from "../destination/types";
import { getMacOSArchitecture, splitSupportedDestinatinos } from "../destination/utils";
import {
  iOSDeviceDestination,
  tvOSDeviceDestination,
  visionOSDeviceDestination,
  watchOSDeviceDestination,
} from "../devices/types";
import type { SimulatorsManager } from "../simulators/manager";
import type { CliRuntimeContext } from "./context";
import { fzfPick } from "./fzf";

export async function pickScheme(options: {
  xcworkspace: string;
  prompt?: string;
  useWorkspaceParser?: boolean;
}): Promise<string> {
  const schemes = await getSchemes({
    xcworkspace: options.xcworkspace,
    useWorkspaceParser: options.useWorkspaceParser,
  });
  if (schemes.length === 0) {
    throw new ExtensionError("No schemes found");
  }
  if (schemes.length === 1) {
    return schemes[0].name;
  }

  return await fzfPick({
    prompt: options.prompt ?? "Select scheme",
    items: schemes.map((scheme) => ({
      label: scheme.name,
      value: scheme.name,
    })),
  });
}

export async function pickConfiguration(options: {
  xcworkspace: string;
  useWorkspaceParser?: boolean;
}): Promise<string> {
  const configurations = await getBuildConfigurations({
    xcworkspace: options.xcworkspace,
    useWorkspaceParser: options.useWorkspaceParser,
  });

  if (configurations.length === 0) {
    return DEFAULT_DEBUG_CONFIGURATION;
  }

  if (configurations.length === 1) {
    return configurations[0].name;
  }

  if (
    configurations.length === 2 &&
    configurations.some((c) => c.name === DEFAULT_DEBUG_CONFIGURATION) &&
    configurations.some((c) => c.name === DEFAULT_RELEASE_CONFIGURATION)
  ) {
    return DEFAULT_DEBUG_CONFIGURATION;
  }

  return await fzfPick({
    prompt: "Select configuration",
    items: configurations.map((configuration) => ({
      label: configuration.name,
      value: configuration.name,
    })),
  });
}

export async function pickXcodeWorkspacePath(options: { workspacePath: string }): Promise<string> {
  const paths = await detectXcodeWorkspacesPaths(options.workspacePath);
  if (paths.length === 0) {
    throw new ExtensionError("No xcode workspaces found", { context: { cwd: options.workspacePath } });
  }
  if (paths.length === 1) {
    return paths[0];
  }

  const selected = await fzfPick({
    prompt: "Select xcode workspace",
    items: paths
      .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length)
      .map((xcPath) => ({
        label: path.relative(options.workspacePath, xcPath),
        value: xcPath,
      })),
  });
  return selected;
}

export async function listDestinations(options: {
  simulatorsManager: SimulatorsManager;
  storagePath: string;
}): Promise<Destination[]> {
  const destinations: Destination[] = [];

  const currentArch = getMacOSArchitecture() ?? "arm64";
  destinations.push(
    new macOSDestination({
      name: "My Mac",
      arch: currentArch,
    }),
  );

  const simulators = await options.simulatorsManager.getSimulators({ refresh: true });
  destinations.push(...simulators);

  const deviceOutput = await listDevicesInDirectory(options.storagePath);
  const deviceDestinations = deviceOutput.result.devices
    .map((device) => {
      const deviceType = device.hardwareProperties.deviceType;
      if (deviceType === "appleWatch") {
        return new watchOSDeviceDestination(device);
      }
      if (deviceType === "iPhone" || deviceType === "iPad") {
        return new iOSDeviceDestination(device);
      }
      if (deviceType === "appleVision") {
        return new visionOSDeviceDestination(device);
      }
      if (deviceType === "appleTV") {
        return new tvOSDeviceDestination(device);
      }
      checkUnreachable(deviceType);
      return null;
    })
    .filter((device): device is NonNullable<typeof device> => device !== null);

  destinations.push(...deviceDestinations);
  return destinations;
}

export async function pickDestination(options: {
  simulatorsManager: SimulatorsManager;
  storagePath: string;
  scheme: string;
  configuration: string;
  sdk: string | undefined;
  xcworkspace: string;
  derivedDataPath?: string | null;
}): Promise<Destination> {
  const buildSettings = await getBuildSettingsToAskDestination({
    scheme: options.scheme,
    configuration: options.configuration,
    sdk: options.sdk,
    xcworkspace: options.xcworkspace,
    derivedDataPath: options.derivedDataPath,
  });

  const destinations = await listDestinations({
    simulatorsManager: options.simulatorsManager,
    storagePath: options.storagePath,
  });

  const { supported, unsupported } = splitSupportedDestinatinos({
    destinations,
    supportedPlatforms: buildSettings?.supportedPlatforms,
  });

  if (supported.length === 0 && unsupported.length === 0) {
    throw new ExtensionError("No destinations found");
  }

  const items = [
    ...supported.map((destination) => ({
      label: formatDestinationLabel(destination),
      value: destination,
    })),
    ...unsupported.map((destination) => ({
      label: `${formatDestinationLabel(destination)} [unsupported]`,
      value: destination,
    })),
  ];

  return await fzfPick({
    prompt: "Select destination",
    items,
  });
}

async function detectXcodeWorkspacesPaths(workspacePath: string): Promise<string[]> {
  return await findFilesRecursive({
    directory: workspacePath,
    depth: 4,
    matcher: (file) => {
      return file.name.endsWith(".xcworkspace");
    },
  });
}

function formatDestinationLabel(destination: Destination): string {
  const detail = destination.quickPickDetails ? ` - ${destination.quickPickDetails}` : "";
  return `${destination.label}${detail}`;
}

export async function pickSchemeSmart(options: {
  xcworkspace: string;
  prompt?: string;
  useWorkspaceParser?: boolean;
  context: CliRuntimeContext;
}): Promise<string> {
  const remembered = options.context.getRememberedValue<string>("cli.scheme");
  const schemes = await getSchemes({
    xcworkspace: options.xcworkspace,
    useWorkspaceParser: options.useWorkspaceParser,
  });
  if (schemes.length === 0) {
    throw new ExtensionError("No schemes found");
  }

  const rememberedScheme = remembered && schemes.find((s) => s.name === remembered);

  if (rememberedScheme) {
    return rememberedScheme.name;
  }

  const selected = await pickScheme({
    xcworkspace: options.xcworkspace,
    prompt: options.prompt,
    useWorkspaceParser: options.useWorkspaceParser,
  });
  options.context.setRememberedValue("cli.scheme", selected);
  return selected;
}

export async function pickConfigurationSmart(options: {
  xcworkspace: string;
  useWorkspaceParser?: boolean;
  context: CliRuntimeContext;
}): Promise<string> {
  const remembered = options.context.getRememberedValue<string>("cli.configuration");
  const configurations = await getBuildConfigurations({
    xcworkspace: options.xcworkspace,
    useWorkspaceParser: options.useWorkspaceParser,
  });

  if (configurations.length === 0) {
    return DEFAULT_DEBUG_CONFIGURATION;
  }

  if (configurations.length === 1) {
    return configurations[0].name;
  }

  if (
    configurations.length === 2 &&
    configurations.some((c) => c.name === DEFAULT_DEBUG_CONFIGURATION) &&
    configurations.some((c) => c.name === DEFAULT_RELEASE_CONFIGURATION)
  ) {
    return DEFAULT_DEBUG_CONFIGURATION;
  }

  const rememberedConfig = remembered && configurations.find((c) => c.name === remembered);

  if (rememberedConfig) {
    return rememberedConfig.name;
  }

  const selected = await pickConfiguration({
    xcworkspace: options.xcworkspace,
    useWorkspaceParser: options.useWorkspaceParser,
  });
  options.context.setRememberedValue("cli.configuration", selected);
  return selected;
}

export async function pickXcodeWorkspacePathSmart(options: {
  workspacePath: string;
  context: CliRuntimeContext;
}): Promise<string> {
  const remembered = options.context.getRememberedValue<string>("cli.xcworkspace");
  const paths = await detectXcodeWorkspacesPaths(options.workspacePath);
  if (paths.length === 0) {
    throw new ExtensionError("No xcode workspaces found", { context: { cwd: options.workspacePath } });
  }

  if (remembered && paths.includes(remembered)) {
    return remembered;
  }

  if (paths.length === 1) {
    return paths[0];
  }

  const selected = await pickXcodeWorkspacePath({ workspacePath: options.workspacePath });
  options.context.setRememberedValue("cli.xcworkspace", selected);
  return selected;
}

export async function pickDestinationSmart(options: {
  simulatorsManager: SimulatorsManager;
  storagePath: string;
  scheme: string;
  configuration: string;
  sdk: string | undefined;
  xcworkspace: string;
  derivedDataPath?: string | null;
  context: CliRuntimeContext;
}): Promise<Destination> {
  const rememberedId = options.context.getRememberedValue<string>("cli.destination.id");
  const buildSettings = await getBuildSettingsToAskDestination({
    scheme: options.scheme,
    configuration: options.configuration,
    sdk: options.sdk,
    xcworkspace: options.xcworkspace,
    derivedDataPath: options.derivedDataPath,
  });

  const destinations = await listDestinations({
    simulatorsManager: options.simulatorsManager,
    storagePath: options.storagePath,
  });

  const { supported, unsupported } = splitSupportedDestinatinos({
    destinations,
    supportedPlatforms: buildSettings?.supportedPlatforms,
  });

  if (supported.length === 0 && unsupported.length === 0) {
    throw new ExtensionError("No destinations found");
  }

  const allDestinations = [...supported, ...unsupported];

  if (rememberedId) {
    const rememberedDestination = allDestinations.find((d) => {
      if ("udid" in d) {
        return d.udid === rememberedId || d.id === rememberedId;
      }
      return d.id === rememberedId;
    });

    if (rememberedDestination && supported.includes(rememberedDestination)) {
      return rememberedDestination;
    }
  }

  const selected = await pickDestination({
    simulatorsManager: options.simulatorsManager,
    storagePath: options.storagePath,
    scheme: options.scheme,
    configuration: options.configuration,
    sdk: options.sdk,
    xcworkspace: options.xcworkspace,
    derivedDataPath: options.derivedDataPath,
  });
  options.context.setRememberedValue("cli.destination.id", selected.id);
  return selected;
}
