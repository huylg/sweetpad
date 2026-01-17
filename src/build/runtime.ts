import type { ExtensionContext } from "../common/commands";
import { getWorkspaceConfig } from "../common/config";
import { getSimulatorByUdid } from "../simulators/utils";
import { getWorkspacePath, prepareStoragePath, restartSwiftLSP } from "./utils";
import type { BuildRuntimeContext } from "./runner";

export async function createExtensionBuildRuntimeContext(
  context: ExtensionContext,
): Promise<BuildRuntimeContext> {
  const storagePath = await prepareStoragePath(context);
  const workspacePath = getWorkspacePath();

  return {
    workspacePath,
    storagePath,
    updateProgressStatus: (message) => context.updateProgressStatus(message),
    updateWorkspaceState: (key, value) => context.updateWorkspaceState(key as any, value as any),
    getConfig: (key) => getWorkspaceConfig(key as any),
    getConfigOrDefault: (key, fallback) => getWorkspaceConfig(key as any) ?? fallback,
    getSimulatorByUdid: async (udid) => getSimulatorByUdid(context, { udid }),
    onSimulatorBooted: () => context.destinationsManager.refreshSimulators(),
    onBuildCompleted: () => restartSwiftLSP(),
  };
}
