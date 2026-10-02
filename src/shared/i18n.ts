/**
 * @file src/shared/i18n.ts
 * Purpose: Typed plain-text catalogs with locale selection and named placeholders.
 *
 * Table of contents:
 * 1. MessageCatalog
 * 2. MessageValues
 * 3. LocaleCatalog
 * 4. resolveLocale
 * 5. createI18n
 */

export type MessageCatalog = Record<string, string>;
export type MessageValues = Record<string, string | number>;
export type LocaleCatalog<Source extends MessageCatalog> = {
    [Key in keyof Source]: string;
};

function resolveLocale(
    locale: unknown,
    availableLocales: readonly string[],
): string {
    const available = new Map(
        availableLocales.map((value) => [value.toLowerCase(), value]),
    );
    let normalized = String(locale || "en")
        .replaceAll("_", "-")
        .toLowerCase();
    if (/^zh(?:-(?:cn|hans|my|sg))?$/u.test(normalized)) normalized = "zh-hans";
    if (/^zh-(?:hk|hant|mo|tw)$/u.test(normalized)) normalized = "zh-hant";
    return (
        available.get(normalized) ??
        available.get(normalized.split("-")[0]) ??
        "en"
    );
}

export function createI18n<Source extends MessageCatalog>(
    english: Source,
    translations: Record<string, LocaleCatalog<Source>>,
    locale: unknown = "en",
) {
    const catalogs: Record<string, MessageCatalog> = {
        en: english,
        ...translations,
    };
    const interfaceLocale = resolveLocale(locale, Object.keys(catalogs));
    return {
        interfaceLocale,
        msg(
            id: Extract<keyof Source, string>,
            values: MessageValues = {},
        ): string {
            const message =
                catalogs[interfaceLocale]?.[id] || english[id] || id;
            return message.replace(
                /\{([A-Za-z][A-Za-z0-9]*)\}/gu,
                (placeholder, key: string) =>
                    values[key] == null ? placeholder : String(values[key]),
            );
        },
    };
}
