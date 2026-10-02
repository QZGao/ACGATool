/**
 * @file src/i18n/index.ts
 * Purpose: The English catalog defines the message contract for every interface locale.
 *
 * Table of contents:
 * 1. Imports
 * 2. MessageKey
 * 3. Translator
 * 4. Constants and state
 * 5. createTranslator
 */

import en from "./en.json" with { type: "json" };
import zhHans from "./zh-Hans.json" with { type: "json" };
import zhHant from "./zh-Hant.json" with { type: "json" };
import {
    createI18n,
    type LocaleCatalog,
    type MessageValues,
} from "../shared/i18n.ts";

export type MessageKey = keyof typeof en;
export type Translator = (key: MessageKey, values?: MessageValues) => string;
const simplifiedChinese: LocaleCatalog<typeof en> = zhHans;
const traditionalChinese: LocaleCatalog<typeof en> = zhHant;

export function createTranslator(language: unknown = "en") {
    return createI18n(
        en,
        { "zh-Hans": simplifiedChinese, "zh-Hant": traditionalChinese },
        language,
    );
}
