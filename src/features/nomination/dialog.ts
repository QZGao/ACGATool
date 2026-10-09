import dialogStyles from "./dialog.css";
import { createDialogHost } from "./dialog-host.ts";
import { CHECK_OUTCOME, normalizeCheckOutcome } from "./check-batch.ts";
import type {
    CheckBatchEntry,
    ConfirmationOptions,
    DialogOperations,
    DialogRuntime,
    DialogServices,
    NominationData,
    NominationDialogs,
    NominationTarget,
} from "./contracts.ts";

interface DialogController {
    openNew(): Promise<string>;
    openEdit(
        nomination: NominationData,
        target: NominationTarget,
    ): Promise<string>;
    openCheck(
        nomination: NominationData,
        target: NominationTarget,
    ): Promise<unknown>;
    openCheckBatch(entries: CheckBatchEntry[]): Promise<unknown>;
    openConfirmation(options: ConfirmationOptions): Promise<boolean>;
    sessionResolve: ((result: unknown) => void) | null;
    kind: string | null;
    open: boolean;
}

/** Mounts an independently owned dialog host; disposal cancels pending requests. */
export function createNominationDialogs(
    runtime: DialogRuntime,
    operations: DialogOperations,
    services: DialogServices,
): NominationDialogs {
    if (!runtime?.Vue?.createMwApp || !runtime?.Codex) {
        throw new TypeError("Codex runtime is unavailable");
    }
    const mountPoint = services.document.createElement("div");
    mountPoint.className = "acga-tool-dialog-host";
    const removeStyles = services.addStyles(dialogStyles);
    services.document.body.appendChild(mountPoint);
    let app: ReturnType<DialogRuntime["Vue"]["createMwApp"]>;
    let controller: DialogController;
    try {
        app = runtime.Vue.createMwApp(
            createDialogHost(runtime, operations, services),
        );
        controller = app.mount(mountPoint) as unknown as DialogController;
    } catch (error) {
        mountPoint.remove();
        removeStyles();
        throw error;
    }
    let disposed = false;
    return {
        showNewNominationDialog: () =>
            disposed ? Promise.resolve("cancel") : controller.openNew(),
        showEditNominationDialog: (nomination, target) =>
            disposed
                ? Promise.resolve("cancel")
                : controller.openEdit(nomination, target),
        showCheckNominationDialog: (nomination, target) =>
            disposed
                ? Promise.resolve(CHECK_OUTCOME.CANCEL)
                : controller
                      .openCheck(nomination, target)
                      .then(normalizeCheckOutcome),
        showCheckBatchDialog: (entries) =>
            disposed
                ? Promise.resolve(CHECK_OUTCOME.CANCEL)
                : controller
                      .openCheckBatch(entries)
                      .then(normalizeCheckOutcome),
        showConfirmDialog: (options) =>
            disposed
                ? Promise.resolve(false)
                : controller.openConfirmation(options),
        dispose() {
            if (disposed) return;
            disposed = true;
            const resolve = controller.sessionResolve;
            controller.sessionResolve = null;
            controller.open = false;
            resolve?.(
                controller.kind === "confirm" ? false : CHECK_OUTCOME.CANCEL,
            );
            app.unmount();
            mountPoint.remove();
            removeStyles();
        },
    };
}

export type {
    DialogOperations,
    DialogRuntime,
    DialogServices,
    NominationDialogs,
} from "./contracts.ts";
