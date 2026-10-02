/**
 * @file src/index.ts
 * Purpose: Deliberate pure API; importing this module never starts the gadget.
 *
 * Table of contents:
 * 1. Exports
 */

export {
    NominationRules,
    NominationRuleSet,
    parseReasonTokens,
    serializeReasonTokens,
    serializeNominationReason,
    formatNominationCheckWikitext,
    nominationRuleGroup,
    validateNominationGroup,
    generateReason,
    findReasonWikilinkEnd,
    encodeReasonDescription,
} from "./domain/rules.ts";
export {
    queryEntry,
    getDateSections,
    parseEditableItemSource,
    formatEditableItemSource,
    getCheckedScore,
    updateEntriesParameters,
    updateEntryParameters,
} from "./domain/wikitext.ts";
export {
    insertArchiveSection,
    insertNominationIntoRegistry,
} from "./domain/registry.ts";
