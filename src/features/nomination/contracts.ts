import type { App, Component } from "vue";
import type { BatchStatus, CheckOutcome } from "./check-batch.ts";

import type { Translator } from "../../i18n/index.ts";
import type { ExistingNomination } from "../../domain/existing-nominations.ts";
import type { DykStatus } from "../../domain/dyk-status.ts";

export interface DialogModelServices {
    msg: Translator;
    getUserName(): string | null;
    getPageName?(): string;
    getInitialRuleCategory?(): "article" | "media";
    getRecipientSuggestionScope?(): "article" | "media" | "revision";
    getSuggestedRecipient?(pageName: string): Promise<string | null>;
}

export interface DialogServices extends DialogModelServices {
    document: Document;
    getDykStatus?(pageName: string): Promise<DykStatus>;
    getExistingNominations?(
        pageName: string,
        expectedRevisionId?: string | number | null,
    ): Promise<Array<ExistingNomination & { url: string }>>;
    queryRoot?: ParentNode;
    getUrl(
        title: string,
        query?: Record<string, string | number | boolean>,
    ): string;
    notify(
        message: string,
        options: { type: "warning" | "error" | "success" },
    ): void;
    addStyles(css: string): () => void;
    reportError(error: unknown, operation: string): void;
}

export type CodexModule = Record<string, Component>;

export interface DialogRuntime {
    Vue: { createMwApp(component: Component): Pick<App, "mount" | "unmount"> };
    Codex: CodexModule;
}

interface NominationIdentity {
    awarder: string;
    pageName: string;
}

/** Drafts preserve extensions supplied by parsed request templates. */
export interface NominationData extends NominationIdentity {
    [key: string]: any;
}

export interface NewNominationTable {
    nominations: NominationData[];
    comment: string;
}

/** Flat nominations remain accepted for existing one-table callers. */
export type NewNominationBatch = NominationData[] | NewNominationTable[];

export interface NominationTarget {
    type: string;
    position: string | number;
    [key: string]: unknown;
}

export interface CheckBatchEntry {
    nomination: NominationData;
    target: NominationTarget;
    tableKey: string;
    tableIndex: number;
}

export type RawNominationFields = Record<
    "條目名稱" | "用戶名稱" | "提名理由" | "核對用",
    string
>;

export interface ConfirmationOptions {
    title?: string;
    message?: string;
    primaryLabel?: string;
}

export interface DialogOperations {
    previewNewNomination?(
        batch: NewNominationBatch,
        additionalMessage?: string,
    ): Promise<{ wikitext: string; html: string }>;
    saveNewNomination(
        batch: NewNominationBatch,
        additionalMessage?: string,
    ): Promise<boolean>;
    saveModifiedNomination(
        nomination: NominationData,
        target: NominationTarget,
    ): Promise<boolean>;
    saveNominationCheck(
        nomination: NominationData,
        target: NominationTarget,
    ): Promise<boolean>;
    discardNominationCheck?(target: NominationTarget): void;
    completeNominationCheckBatch?(): Promise<boolean>;
    saveRawNominationSource(
        fields: RawNominationFields,
        target: NominationTarget,
        options: { check: boolean },
    ): Promise<boolean>;
}

export interface NominationDialogs {
    showNewNominationDialog(): Promise<string>;
    showEditNominationDialog(
        nomination: NominationData,
        target: NominationTarget,
    ): Promise<string>;
    showCheckNominationDialog(
        nomination: NominationData,
        target: NominationTarget,
        batchStatus?: BatchStatus | null,
    ): Promise<CheckOutcome>;
    showCheckBatchDialog?(entries: CheckBatchEntry[]): Promise<CheckOutcome>;
    showConfirmDialog(options: ConfirmationOptions): Promise<boolean>;
    dispose(): void;
}
