/** Deliberate pure API; importing this module never starts the gadget. */
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
