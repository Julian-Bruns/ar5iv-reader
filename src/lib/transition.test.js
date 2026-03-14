import { describe, expect, it } from "vitest";
import {
  createInstallMeta,
  evaluateUpgradeTransition,
  prioritizeRecoveryActions
} from "./transition";

describe("transition", () => {
  it("flags suspicious empty-library upgrades when the previous install had papers", () => {
    const transition = evaluateUpgradeTransition({
      previousInstallMeta: createInstallMeta({
        appVersion: "0.3.0",
        buildId: "old-build",
        paperCount: 4,
        libraryFingerprint: "old"
      }),
      currentAppVersion: "0.4.0",
      currentBuildId: "new-build",
      currentPaperCount: 0,
      currentLibraryFingerprint: ""
    });

    expect(transition).toMatchObject({
      status: "suspicious",
      reason: "missing-library-after-upgrade",
      buildChanged: true
    });
  });

  it("treats non-empty upgrades as healthy", () => {
    const transition = evaluateUpgradeTransition({
      previousInstallMeta: createInstallMeta({
        appVersion: "0.3.0",
        buildId: "old-build",
        paperCount: 2
      }),
      currentAppVersion: "0.4.0",
      currentBuildId: "new-build",
      currentPaperCount: 2,
      currentLibraryFingerprint: "same"
    });

    expect(transition.status).toBe("healthy");
  });

  it("prioritizes local recovery before URL refetch", () => {
    expect(
      prioritizeRecoveryActions({
        hasReadableBackupFile: true,
        hasOnlinePairedDevices: true
      })
    ).toEqual([
      "backup-file",
      "nearby-sync",
      "backup-upload",
      "url-manifest"
    ]);
  });
});
