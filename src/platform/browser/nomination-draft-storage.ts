import type {
    NominationData,
    NominationDraftStore,
    SavedNominationDraft,
} from "../../features/nomination/contracts.ts";

interface DraftStorageHost {
    getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem">;
    getUserName(): string | null;
    window?:
        | (Pick<EventTarget, "addEventListener" | "removeEventListener"> & {
              document: Pick<
                  Document,
                  "addEventListener" | "removeEventListener" | "visibilityState"
              >;
          })
        | null;
}

type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

const NUMBER_MARKER = "$acgaNumber";
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CATEGORIES = new Set([
    "article",
    "review",
    "media",
    "recommendation",
    "other",
]);
const SAFE_ID = /^[a-zA-Z0-9_-]+$/u;

function invalidDraft(): never {
    throw new TypeError("Invalid saved nomination draft");
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Never copy prototype keys, including nested untrusted rule or form fields. */
function encode(value: unknown, depth = 0): JsonValue | undefined {
    if (depth > 50) invalidDraft();
    if (value === undefined) return undefined;
    if (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "string"
    )
        return value;
    if (typeof value === "number") {
        return Number.isFinite(value)
            ? value
            : { [NUMBER_MARKER]: String(value) };
    }
    if (Array.isArray(value)) {
        return value.map((item) => encode(item, depth + 1) ?? null);
    }
    if (!record(value)) invalidDraft();
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
        if (UNSAFE_KEYS.has(key) || key === NUMBER_MARKER) invalidDraft();
        const encoded = encode(item, depth + 1);
        if (encoded !== undefined) result[key] = encoded;
    }
    return result;
}

function decode(value: unknown, depth = 0): unknown {
    if (depth > 50) invalidDraft();
    if (Array.isArray(value))
        return value.map((item) => decode(item, depth + 1));
    if (!record(value)) return value;
    const entries = Object.entries(value);
    if (Object.hasOwn(value, NUMBER_MARKER)) {
        if (entries.length !== 1) invalidDraft();
        const number = value[NUMBER_MARKER];
        if (number === "NaN") return NaN;
        if (number === "Infinity") return Infinity;
        if (number === "-Infinity") return -Infinity;
        invalidDraft();
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of entries) {
        if (UNSAFE_KEYS.has(key)) invalidDraft();
        result[key] = decode(item, depth + 1);
    }
    return result;
}

/** Incomplete fields are allowed; structural and navigation state must be valid. */
function validatedDraft(value: unknown): SavedNominationDraft {
    if (
        !record(value) ||
        value.version !== 1 ||
        !Array.isArray(value.tables) ||
        value.tables.length === 0 ||
        !Number.isInteger(value.activeTableIndex) ||
        (value.activeTableIndex as number) < 0 ||
        (value.activeTableIndex as number) >= value.tables.length ||
        (value.view !== "main" && value.view !== "nomination-summary")
    )
        invalidDraft();
    const ids = new Set<string>();
    const tableIds = new Set<string>();
    const tables = value.tables.map((table: unknown) => {
        if (
            !record(table) ||
            !Array.isArray(table.nominations) ||
            table.nominations.length === 0 ||
            typeof table.comment !== "string" ||
            typeof table.activeTab !== "string"
        )
            invalidDraft();
        if (table.id !== undefined) {
            if (typeof table.id !== "string" || !SAFE_ID.test(table.id))
                invalidDraft();
        }
        const nominations = table.nominations.map((nomination: unknown) => {
            if (
                !record(nomination) ||
                typeof nomination.id !== "string" ||
                !SAFE_ID.test(nomination.id) ||
                ids.has(nomination.id) ||
                typeof nomination.awarder !== "string" ||
                typeof nomination.pageName !== "string" ||
                typeof nomination.activeRuleCategory !== "string" ||
                !CATEGORIES.has(nomination.activeRuleCategory)
            )
                invalidDraft();
            ids.add(nomination.id);
            return nomination as NominationData;
        });
        if (
            !nominations.some((nomination) => nomination.id === table.activeTab)
        )
            invalidDraft();
        const tableId =
            typeof table.id === "string" ? table.id : nominations[0].id;
        if (tableIds.has(tableId)) invalidDraft();
        tableIds.add(tableId);
        return {
            ...(typeof table.id === "string" ? { id: table.id } : {}),
            nominations,
            comment: table.comment,
            activeTab: table.activeTab,
        };
    });
    return {
        version: 1,
        tables,
        activeTableIndex: value.activeTableIndex as number,
        view: value.view as SavedNominationDraft["view"],
    };
}

/** Each wiki origin and signed-in user has one explicitly saved draft. */
export function createBrowserNominationDraftStore(
    host: DraftStorageHost,
): NominationDraftStore {
    const snapshots = new Map<string, string | null>();
    function key() {
        return `acga-tool:nomination-draft:${encodeURIComponent(JSON.stringify(host.getUserName()))}`;
    }
    return {
        subscribe(listener: () => void) {
            const window = host.window;
            if (!window) return () => {};
            const document = window.document;
            const onStorage = (event: Event) => {
                const storageKey = (event as StorageEvent).key;
                if (storageKey === null || storageKey === key()) listener();
            };
            const onVisibilityChange = () => {
                if (document.visibilityState === "visible") listener();
            };
            const onActivate = () => listener();
            window.addEventListener("storage", onStorage);
            window.addEventListener("focus", onActivate);
            window.addEventListener("pageshow", onActivate);
            document.addEventListener("visibilitychange", onVisibilityChange);
            let subscribed = true;
            return () => {
                if (!subscribed) return;
                subscribed = false;
                window.removeEventListener("storage", onStorage);
                window.removeEventListener("focus", onActivate);
                window.removeEventListener("pageshow", onActivate);
                document.removeEventListener(
                    "visibilitychange",
                    onVisibilityChange,
                );
            };
        },
        load() {
            const storageKey = key();
            const source = host.getStorage().getItem(storageKey);
            const draft =
                source === null
                    ? null
                    : validatedDraft(decode(JSON.parse(source)));
            snapshots.set(storageKey, source);
            return draft;
        },
        save(draft) {
            const encoded = encode(draft);
            if (encoded === undefined) invalidDraft();
            validatedDraft(decode(encoded));
            const storageKey = key();
            const source = JSON.stringify(encoded);
            host.getStorage().setItem(storageKey, source);
            snapshots.set(storageKey, source);
        },
        remove(submittedIds?: readonly string[]) {
            const storageKey = key();
            const storage = host.getStorage();
            const source = storage.getItem(storageKey);
            if (submittedIds) {
                if (source === null || submittedIds.length === 0) return;
                const previousSource = snapshots.get(storageKey);
                if (!previousSource) return;
                const previous = validatedDraft(
                    decode(JSON.parse(previousSource)),
                );
                const previousItems = new Map(
                    previous.tables.flatMap((table) =>
                        table.nominations.map(
                            (nomination) =>
                                [
                                    nomination.id,
                                    {
                                        tableId:
                                            table.id ?? table.nominations[0].id,
                                        source: JSON.stringify(
                                            encode(nomination),
                                        ),
                                    },
                                ] as const,
                        ),
                    ),
                );
                const draft = validatedDraft(decode(JSON.parse(source)));
                const requested = new Set(submittedIds);
                // Preserve newer edits and moves while clearing the submitted
                // version. Legacy saves without stable group IDs retain the
                // field-only match because their first item can change.
                const submitted = new Set(
                    draft.tables.flatMap((table) =>
                        table.nominations
                            .filter((nomination) => {
                                const previousItem = previousItems.get(
                                    nomination.id,
                                );
                                return (
                                    requested.has(nomination.id) &&
                                    previousItem?.source ===
                                        JSON.stringify(encode(nomination)) &&
                                    (!table.id ||
                                        previousItem.tableId === table.id)
                                );
                            })
                            .map((nomination) => nomination.id),
                    ),
                );
                if (submitted.size === 0) return;
                const tables = draft.tables.flatMap((table, index) => {
                    const nominations = table.nominations.filter(
                        (nomination) => !submitted.has(nomination.id),
                    );
                    if (nominations.length === 0) return [];
                    return [
                        {
                            index,
                            table: {
                                ...table,
                                nominations,
                                activeTab: nominations.some(
                                    (nomination) =>
                                        nomination.id === table.activeTab,
                                )
                                    ? table.activeTab
                                    : nominations[0].id,
                            },
                        },
                    ];
                });
                if (tables.length === 0) {
                    storage.removeItem(storageKey);
                    return;
                }
                const activeTableIndex = tables.findIndex(
                    ({ index }) => index === draft.activeTableIndex,
                );
                const remaining = {
                    ...draft,
                    tables: tables.map(({ table }) => table),
                    activeTableIndex:
                        activeTableIndex < 0
                            ? Math.min(
                                  draft.activeTableIndex,
                                  tables.length - 1,
                              )
                            : activeTableIndex,
                };
                const remainingSource = JSON.stringify(encode(remaining));
                if (remainingSource !== source)
                    storage.setItem(storageKey, remainingSource);
                return;
            }
            // Submission may finish after another tab saves a newer draft.
            if (
                !snapshots.has(storageKey) ||
                snapshots.get(storageKey) !== source
            )
                return;
            storage.removeItem(storageKey);
            snapshots.set(storageKey, null);
        },
    };
}
