<template>
    <!-- acga-template:dialog-host -->
    <cdx-dialog
        class="acga-codex-dialog"
        :data-acga-dialog-instance="dialogId"
        :open="open && !editingNomination && !previewOpen"
        :title="dialogTitle"
        :close-button-label="msg('close')"
        use-close-button
        :fixed-height="kind !== 'confirm'"
        @update:open="onOpenUpdate"
    >
        <div v-if="batchStatus && kind === 'check'" class="acga-batch-progress">
            <div>{{ batchProgressValue }} / {{ batchStatus.total }}</div>
            <p>
                {{
                    msg(
                        "batch_results_are_stored_temporarily_and_submitted_together_when_all",
                    )
                }}
            </p>
            <cdx-progress-bar
                :value="batchProgressValue"
                :max="batchStatus.total"
                :aria-label="
                    msg('batch_progress') +
                    ' ' +
                    batchProgressValue +
                    ' / ' +
                    batchStatus.total
                "
            />
        </div>
        <cdx-progress-bar
            v-if="busy"
            class="acga-save-progress"
            :aria-label="saveLabel"
        />
        <!-- Codex trims padding on direct dialog-body children; keep messages nested. -->
        <div v-if="error">
            <cdx-message type="error" class="acga-dialog-error" tabindex="-1">
                <div>{{ error }}</div>
                <ul
                    v-if="errorDetails.length"
                    class="acga-dialog-error-details"
                >
                    <li v-for="(issue, index) in errorDetails" :key="index">
                        {{ issue }}
                    </li>
                </ul>
            </cdx-message>
        </div>

        <div
            v-if="
                view !== 'nomination-summary' &&
                (existingNominationNotices.length ||
                    existingNominationLookupFailed)
            "
        >
            <cdx-message
                v-for="item in existingNominationNotices"
                :key="item.key"
                type="warning"
                class="acga-existing-nomination acga-existing-nomination--same-recipient"
                data-level="warning"
            >
                <p>
                    {{ msg("existing_nomination_warning") }}
                </p>
                <a :href="item.url" target="_blank" rel="noopener">{{
                    item.description
                }}</a>
            </cdx-message>
            <cdx-message
                v-if="existingNominationLookupFailed"
                type="warning"
                class="acga-existing-nomination-error"
                >{{ msg("existing_nomination_lookup_failed") }}</cdx-message
            >
        </div>

        <div
            v-if="kind === 'new' && view === 'main'"
            class="acga-nomination-table-layout"
        >
            <cdx-tabs
                class="acga-nomination-table-tabs"
                :active="nominationTables[activeNominationTableIndex]?.id || ''"
                framed
                @update:active="
                    switchNominationTable(
                        nominationTables.findIndex(
                            (table) => table.id === $event,
                        ),
                    )
                "
                @dragover="onNominationTableDragOver"
                @drop="onNominationTableDrop"
                @dragleave="onNominationDragLeave"
            >
                <cdx-tab
                    v-for="(table, tableIndex) in nominationTables"
                    :key="table.id"
                    :name="table.id"
                    :label="
                        msg('nomination_table_tab', { number: tableIndex + 1 })
                    "
                    :disabled="busy"
                >
                    <template v-if="tableIndex === activeNominationTableIndex">
                        <div
                            class="acga-nomination-tabs cdx-tabs cdx-tabs--quiet"
                        >
                            <div
                                class="acga-nomination-tab-bar cdx-tabs__header"
                            >
                                <div class="acga-nomination-tabs-scroll">
                                    <div
                                        class="acga-nomination-tab-list cdx-tabs__list"
                                        role="tablist"
                                        :aria-label="msg('nomination')"
                                    >
                                        <div
                                            v-for="(
                                                nomination, index
                                            ) in nominations"
                                            :key="nomination.id"
                                            class="acga-nomination-tab"
                                            :class="{
                                                'acga-nomination-tab-active':
                                                    activeTab === nomination.id,
                                                'acga-nomination-tab-dragging':
                                                    draggedNominationId ===
                                                    nomination.id,
                                                'acga-nomination-tab-drop-before':
                                                    nominationDropTarget ===
                                                    nomination.id + ':before',
                                                'acga-nomination-tab-drop-after':
                                                    nominationDropTarget ===
                                                    nomination.id + ':after',
                                            }"
                                            role="presentation"
                                            @dragover="
                                                onNominationDragOver(
                                                    $event,
                                                    index,
                                                )
                                            "
                                            @drop="
                                                onNominationDrop($event, index)
                                            "
                                            @dragleave="onNominationDragLeave"
                                        >
                                            <button
                                                :id="nomination.id + '-tab'"
                                                type="button"
                                                role="tab"
                                                class="acga-nomination-tab-label cdx-tabs__list__item"
                                                :title="
                                                    nominationTabTooltip(
                                                        nomination,
                                                    ) +
                                                    '\n' +
                                                    msg(
                                                        'nomination_tab_drag_help',
                                                    )
                                                "
                                                :aria-description="
                                                    msg(
                                                        'nomination_tab_drag_help',
                                                    )
                                                "
                                                :draggable="!busy"
                                                :aria-controls="
                                                    nomination.id + '-panel'
                                                "
                                                :aria-selected="
                                                    activeTab === nomination.id
                                                "
                                                :tabindex="
                                                    activeTab === nomination.id
                                                        ? 0
                                                        : -1
                                                "
                                                :disabled="busy"
                                                @click="
                                                    selectNomination(
                                                        nomination.id,
                                                    )
                                                "
                                                @keydown="
                                                    onNominationTabKeydown(
                                                        $event,
                                                        index,
                                                    )
                                                "
                                                @dragstart="
                                                    startNominationDrag(
                                                        $event,
                                                        nomination.id,
                                                    )
                                                "
                                                @dragend="endNominationDrag"
                                            >
                                                <span>{{
                                                    tabLabel(index)
                                                }}</span>
                                            </button>
                                            <cdx-button
                                                v-if="
                                                    activeTab === nomination.id
                                                "
                                                class="acga-nomination-tab-remove"
                                                type="button"
                                                weight="quiet"
                                                action="destructive"
                                                size="small"
                                                :aria-label="
                                                    msg(
                                                        'delete_this_nomination',
                                                    ) +
                                                    ': ' +
                                                    tabLabel(index)
                                                "
                                                :title="
                                                    msg(
                                                        'delete_this_nomination',
                                                    ) +
                                                    ': ' +
                                                    tabLabel(index)
                                                "
                                                :disabled="
                                                    busy ||
                                                    (nominations.length <= 1 &&
                                                        nominationTables.length <=
                                                            1)
                                                "
                                                @click="
                                                    removeNomination(
                                                        nomination.id,
                                                    )
                                                "
                                                ><cdx-icon
                                                    :icon="removeIcon"
                                                    size="small"
                                            /></cdx-button>
                                        </div>
                                    </div>
                                    <cdx-button
                                        class="acga-nomination-tab-add"
                                        :class="{
                                            'acga-nomination-drop-target':
                                                nominationDropTarget ===
                                                'table-end',
                                        }"
                                        type="button"
                                        weight="quiet"
                                        :aria-label="msg('add_nomination')"
                                        :title="msg('add_nomination')"
                                        :disabled="busy"
                                        @click="addNomination"
                                        @dragover="
                                            allowNominationDrop(
                                                $event,
                                                'table-end',
                                            )
                                        "
                                        @drop="
                                            acceptNominationDrop(
                                                $event,
                                                table.id,
                                            )
                                        "
                                        @dragleave="onNominationDragLeave"
                                        ><cdx-icon :icon="addIcon"
                                    /></cdx-button>
                                </div>
                            </div>
                            <div class="cdx-tabs__content">
                                <div
                                    v-for="(nomination, index) in nominations"
                                    :key="nomination.id"
                                    v-show="activeTab === nomination.id"
                                    :id="nomination.id + '-panel'"
                                    class="acga-nomination-panel cdx-tab"
                                    role="tabpanel"
                                    :aria-labelledby="nomination.id + '-tab'"
                                    :aria-hidden="activeTab !== nomination.id"
                                    tabindex="0"
                                >
                                    <acga-author-form
                                        :nomination="nomination"
                                        :rule-groups="ruleGroups"
                                        :rule-dict="ruleDict"
                                        :disabled="busy"
                                        @change="clearError"
                                    >
                                        <template #article-status>
                                            <div
                                                v-if="
                                                    activeTab ===
                                                        nomination.id &&
                                                    (assessmentTarget ||
                                                        dykTarget)
                                                "
                                                class="acga-article-status"
                                            >
                                                <acga-article-status
                                                    :status="articleStatus"
                                                    compact
                                                />
                                            </div>
                                        </template>
                                    </acga-author-form>
                                    <cdx-field class="acga-code-preview">
                                        <template #label>{{
                                            msg("item_source_preview")
                                        }}</template>
                                        <cdx-text-area
                                            class="acga-code-preview-text"
                                            :model-value="
                                                nominationCodePreviewResult(
                                                    nomination,
                                                    index,
                                                ).text
                                            "
                                            :rows="4"
                                            readonly
                                            spellcheck="false"
                                        />
                                    </cdx-field>
                                </div>
                            </div>
                        </div>
                    </template>
                </cdx-tab>
            </cdx-tabs>
            <cdx-button
                class="acga-nomination-table-add"
                :class="{
                    'acga-nomination-drop-target':
                        nominationDropTarget === 'new-table',
                }"
                type="button"
                weight="quiet"
                :aria-label="msg('add_nomination_table')"
                :title="
                    draggedNominationId
                        ? msg('nomination_drop_on_new_table')
                        : msg('add_nomination_table')
                "
                :disabled="busy"
                @click="addNominationTable"
                @dragover="allowNominationDrop($event, 'new-table')"
                @drop="acceptNominationDrop($event, null)"
                @dragleave="onNominationDragLeave"
                ><cdx-icon :icon="addIcon"
            /></cdx-button>
        </div>

        <div
            v-else-if="kind === 'new' && view === 'nomination-summary'"
            class="acga-nomination-summary"
            tabindex="-1"
            :aria-label="msg('nomination_summary')"
        >
            <section
                v-for="table in nominationSummaryTables"
                :key="table.index"
                class="acga-nomination-table-summary"
                :aria-label="nominationTableTitle(table.index)"
            >
                <cdx-table
                    class="acga-nomination-summary-table"
                    :columns="nominationSummaryColumns"
                    :data="table.rows"
                    :caption="nominationTableTitle(table.index)"
                    :show-vertical-borders="true"
                >
                    <template #item-article="{ row }">
                        <a v-if="row.articleUrl" :href="row.articleUrl">{{
                            row.article
                        }}</a>
                        <span v-else>{{ row.article }}</span>
                    </template>
                    <template #item-recipient="{ row }">
                        <a :href="row.recipientUrl">{{ row.recipient }}</a>
                    </template>
                    <template #item-codes="{ row }">
                        <code>{{ row.codes }}</code>
                    </template>
                    <template #item-actions="{ row }">
                        <div
                            class="acga-nomination-summary-actions"
                            :data-frozen="row.frozen"
                        >
                            <cdx-button
                                weight="quiet"
                                :disabled="busy"
                                :aria-label="
                                    msg('edit_summary_nomination', {
                                        number: row.position,
                                    })
                                "
                                :title="
                                    msg('edit_summary_nomination', {
                                        number: row.position,
                                    })
                                "
                                @click="
                                    editSummaryNomination(
                                        row.tableIndex,
                                        row.index,
                                        row.position,
                                    )
                                "
                                ><cdx-icon :icon="editIcon"
                            /></cdx-button>
                            <cdx-button
                                weight="quiet"
                                :disabled="busy"
                                :aria-label="
                                    msg(
                                        row.frozen
                                            ? 'unfreeze_summary_nomination'
                                            : 'freeze_summary_nomination',
                                        { number: row.position },
                                    )
                                "
                                :title="
                                    msg(
                                        row.frozen
                                            ? 'unfreeze_nomination'
                                            : 'freeze_nomination',
                                    )
                                "
                                @click="
                                    toggleNominationFrozen(
                                        row.tableIndex,
                                        row.index,
                                    )
                                "
                                ><cdx-icon
                                    :icon="
                                        row.frozen ? unfreezeIcon : freezeIcon
                                    "
                            /></cdx-button>
                        </div>
                    </template>
                    <template #footer>
                        <cdx-field class="acga-additional-message">
                            <template #label>{{
                                msg("additional_comment")
                            }}</template>
                            <template #description>{{
                                msg("nomination_additional_comment_help")
                            }}</template>
                            <cdx-text-area
                                :model-value="
                                    nominationTableComment(table.index)
                                "
                                :autosize="true"
                                :rows="2"
                                :placeholder="msg('no_signature_needed')"
                                :disabled="busy"
                                @update:model-value="
                                    setNominationTableComment(
                                        table.index,
                                        $event,
                                    )
                                "
                            />
                        </cdx-field>
                    </template>
                </cdx-table>
            </section>
        </div>

        <div v-else-if="kind === 'edit'" class="acga-edit-form">
            <cdx-message
                v-if="sourceFallbackActive"
                type="warning"
                class="acga-source-warning"
            >
                {{ sourceFallbackMessage }}
            </cdx-message>
            <acga-author-form
                v-if="!currentNomination.sourceOnly"
                :nomination="currentNomination"
                :rule-groups="ruleGroups"
                :rule-dict="ruleDict"
                :disabled="busy || currentNomination.sourceDirty"
                @change="clearError"
            >
                <template #article-status>
                    <div
                        v-if="assessmentTarget || dykTarget"
                        class="acga-article-status"
                    >
                        <acga-article-status :status="articleStatus" compact />
                    </div>
                </template>
            </acga-author-form>
            <cdx-field class="acga-code-preview">
                <template #label>{{ msg("item_source_preview") }}</template>
                <cdx-text-area
                    class="acga-code-preview-text"
                    :model-value="
                        sourceFallbackActive
                            ? currentNomination.rawSourceText
                            : codePreviewResult.text
                    "
                    :rows="4"
                    :readonly="!sourceFallbackActive"
                    spellcheck="false"
                    @update:model-value="setRawSourceText"
                />
            </cdx-field>
        </div>

        <component
            v-else-if="kind === 'check' && currentNomination"
            :is="isCheckBatch ? 'CdxTabs' : 'div'"
            :class="{ 'acga-check-item-tabs': isCheckBatch }"
            :active="String(checkBatchIndex)"
            :framed="false"
            @update:active="selectCheckBatchItem"
        >
            <component
                v-for="index in checkNavigationItems"
                :key="index"
                :is="isCheckBatch ? 'CdxTab' : 'div'"
                :name="String(index)"
                :label="isCheckBatch ? checkBatchItemLabel(index) : ''"
                :title="
                    isCheckBatch
                        ? checkBatchEntries[index].nomination.pageName
                        : ''
                "
            >
                <div
                    v-if="!isCheckBatch || index === checkBatchIndex"
                    class="acga-check-form"
                >
                    <cdx-message
                        v-if="checkReasonBuilderActive"
                        type="warning"
                        class="acga-source-warning"
                    >
                        {{ msg("nomination_repair_help") }}
                    </cdx-message>
                    <cdx-message
                        v-else-if="sourceFallbackActive"
                        type="warning"
                        class="acga-source-warning"
                    >
                        {{ sourceFallbackMessage }}
                    </cdx-message>
                    <dl class="acga-check-summary">
                        <dt>{{ msg("recipient") }}</dt>
                        <dd>
                            <a :href="userUrl()">{{
                                currentNomination.awarder
                            }}</a>
                            （<a :href="userUrl('User talk:')">{{
                                msg("talk")
                            }}</a>
                            ·
                            <a :href="userUrl('Special:用户贡献/')">{{
                                msg("contributions")
                            }}</a
                            >）
                        </dd>
                        <dt>{{ msg("awarded_article") }}</dt>
                        <dd v-if="checkIsOtherRecommendation">
                            {{ currentNomination.pageName }}
                        </dd>
                        <dd v-else>
                            <a :href="pageUrl()">{{
                                currentNomination.pageName
                            }}</a>
                            （<a :href="pageUrl('Talk:')">{{ msg("talk") }}</a>
                            ·
                            <a :href="pageUrl('', { action: 'history' })">{{
                                msg("history")
                            }}</a>
                            ·
                            <a :href="backlinksUrl()">{{
                                msg("what_links_here")
                            }}</a
                            >）
                        </dd>
                        <acga-article-status :status="articleStatus" />
                    </dl>
                    <template v-if="checkReasonBuilderActive">
                        <cdx-field class="acga-original-request-reason">
                            <template #label>{{
                                msg("original_nomination_reason")
                            }}</template>
                            <cdx-text-area
                                :model-value="checkOriginalRequestReasonText"
                                :rows="3"
                                readonly
                                spellcheck="false"
                            />
                        </cdx-field>
                        <acga-author-form
                            :nomination="checkReasonDraft"
                            :rule-groups="ruleGroups"
                            :rule-dict="ruleDict"
                            :disabled="busy"
                            @change="clearError"
                        />
                    </template>
                    <template v-else>
                        <fieldset
                            v-if="!sourceFallbackActive"
                            class="acga-check-table-fieldset"
                            :disabled="busy"
                        >
                            <cdx-table
                                class="acga-check-table"
                                v-model:selected-rows="checkedRowsModel"
                                :columns="checkColumns"
                                :data="checkTableRows"
                                :use-row-selection="true"
                                :show-vertical-borders="true"
                                :caption="msg('nomination_checks')"
                                :hide-caption="true"
                            >
                                <template #header>
                                    <span class="acga-check-header-actions">
                                        <cdx-button
                                            weight="quiet"
                                            :disabled="!canUndoCheckEdit"
                                            :aria-label="msg('undo')"
                                            :title="msg('undo')"
                                            @click="undoCheckEdit"
                                            ><cdx-icon :icon="undoIcon"
                                        /></cdx-button>
                                        <cdx-button
                                            weight="quiet"
                                            :disabled="!canRedoCheckEdit"
                                            :aria-label="msg('redo')"
                                            :title="msg('redo')"
                                            @click="redoCheckEdit"
                                            ><cdx-icon :icon="redoIcon"
                                        /></cdx-button>
                                        <cdx-button
                                            class="acga-check-reset"
                                            weight="quiet"
                                            action="destructive"
                                            :disabled="busy"
                                            :title="
                                                msg('reset_nomination_checks')
                                            "
                                            @click="resetCheckItems"
                                            >{{ msg("reset") }}</cdx-button
                                        >
                                    </span>
                                </template>
                                <template
                                    v-if="checkTableRows.length === 0"
                                    #tbody
                                >
                                    <tbody></tbody>
                                </template>
                                <template #item-code="{ row }">
                                    <span class="acga-check-code-control">
                                        <cdx-select
                                            class="acga-check-code"
                                            :selected="row.rule"
                                            :menu-items="checkRuleItems"
                                            :disabled="busy"
                                            :aria-label="
                                                row.code + ' ' + msg('code')
                                            "
                                            @update:selected="
                                                (value) =>
                                                    setCheckCode(row, value)
                                            "
                                        />
                                        <span v-if="row.status.pending">?</span>
                                    </span>
                                </template>
                                <template #item-description="{ row }">
                                    <cdx-text-input
                                        class="acga-check-description"
                                        :model-value="row.status.desc"
                                        :disabled="busy"
                                        :aria-label="
                                            row.code + ' ' + msg('description')
                                        "
                                        @update:model-value="
                                            (value) =>
                                                setCheckDescription(row, value)
                                        "
                                    />
                                </template>
                                <template #item-score="{ row }">
                                    <acga-score-input
                                        :model-value="row.score"
                                        :disabled="busy"
                                        :label="row.code + ' ' + msg('score')"
                                        @update:model-value="
                                            (value) => setCheckScore(row, value)
                                        "
                                    />
                                </template>
                                <template #item-actions="{ row }">
                                    <span class="acga-check-actions">
                                        <cdx-button
                                            weight="quiet"
                                            :disabled="busy || row.index === 0"
                                            :aria-label="
                                                row.code + ' ' + msg('move_up')
                                            "
                                            @click="moveCheckItem(row, -1)"
                                            >↑</cdx-button
                                        >
                                        <cdx-button
                                            weight="quiet"
                                            :disabled="
                                                busy ||
                                                row.index ===
                                                    checkTableRows.length - 1
                                            "
                                            :aria-label="
                                                row.code +
                                                ' ' +
                                                msg('move_down')
                                            "
                                            @click="moveCheckItem(row, 1)"
                                            >↓</cdx-button
                                        >
                                        <cdx-button
                                            class="acga-check-item-reset"
                                            weight="quiet"
                                            action="destructive"
                                            :disabled="busy"
                                            :aria-label="
                                                row.code +
                                                ' ' +
                                                msg('reset_item')
                                            "
                                            :title="msg('reset_item')"
                                            @click="resetCheckItem(row)"
                                            ><cdx-icon :icon="resetIcon"
                                        /></cdx-button>
                                        <cdx-button
                                            class="acga-check-item-delete"
                                            weight="quiet"
                                            action="destructive"
                                            :disabled="busy"
                                            :aria-label="
                                                row.code +
                                                ' ' +
                                                msg('delete_item')
                                            "
                                            :title="msg('delete_item')"
                                            @click="removeCheckItem(row)"
                                            ><cdx-icon :icon="removeIcon"
                                        /></cdx-button>
                                    </span>
                                </template>
                                <template #tfoot>
                                    <tfoot>
                                        <tr class="acga-check-add-row">
                                            <td></td>
                                            <td>
                                                <cdx-select
                                                    :key="checkTableRows.length"
                                                    class="acga-check-code"
                                                    :selected="null"
                                                    :menu-items="checkRuleItems"
                                                    :disabled="busy"
                                                    default-label=""
                                                    :aria-label="
                                                        msg('add_item_code')
                                                    "
                                                    @update:selected="
                                                        addCheckItem($event)
                                                    "
                                                />
                                            </td>
                                            <td></td>
                                            <td></td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </template>
                                <template #footer>
                                    <cdx-field
                                        class="acga-additional-message"
                                        optional
                                    >
                                        <template #label>{{
                                            msg("additional_comment")
                                        }}</template>
                                        <cdx-text-area
                                            :model-value="
                                                currentNomination.message
                                            "
                                            :autosize="true"
                                            :rows="1"
                                            :placeholder="
                                                msg('no_signature_needed')
                                            "
                                            :disabled="busy"
                                            @update:model-value="
                                                setCheckMessage
                                            "
                                        />
                                    </cdx-field>
                                </template>
                            </cdx-table>
                        </fieldset>
                        <cdx-field class="acga-code-preview">
                            <template #label>{{
                                msg("item_source_preview")
                            }}</template>
                            <cdx-text-area
                                class="acga-code-preview-text"
                                :model-value="
                                    sourceFallbackActive
                                        ? currentNomination.rawSourceText
                                        : codePreviewResult.text
                                "
                                :rows="4"
                                :readonly="!sourceFallbackActive"
                                spellcheck="false"
                                @update:model-value="setRawSourceText"
                            />
                        </cdx-field>
                    </template>
                </div>
            </component>
        </component>

        <p v-else-if="kind === 'confirm'" class="acga-confirm-message">
            {{ confirmData.message }}
        </p>

        <template #footer>
            <div class="acga-dialog-footer">
                <div class="acga-footer-actions">
                    <template v-if="kind === 'confirm'">
                        <cdx-button :disabled="busy" @click="requestCancel"
                            >{{ msg("cancel") }}
                        </cdx-button>
                        <cdx-button
                            weight="primary"
                            action="destructive"
                            :disabled="busy"
                            @click="confirmPrimary"
                        >
                            {{ confirmData.primaryLabel }}
                        </cdx-button>
                    </template>
                    <template
                        v-else-if="
                            kind === 'new' && view === 'nomination-summary'
                        "
                    >
                        <cdx-button
                            weight="quiet"
                            :disabled="busy"
                            @click="backToNewNominations"
                            >{{ msg("back") }}
                        </cdx-button>
                        <cdx-button
                            :disabled="busy"
                            :title="msg('nomination_draft_help')"
                            @click="saveNominationDraft"
                            >{{ msg("save_nomination_draft") }}
                        </cdx-button>
                        <cdx-button
                            :disabled="busy || !hasSubmittableNominations"
                            @click="previewNominations"
                            >{{ msg("preview") }}
                        </cdx-button>
                        <cdx-button
                            weight="primary"
                            action="progressive"
                            :disabled="busy || !hasSubmittableNominations"
                            @click="save"
                            >{{ saveLabel }}
                        </cdx-button>
                    </template>
                    <template v-else-if="kind === 'new' && view === 'main'">
                        <cdx-button
                            weight="quiet"
                            action="destructive"
                            :disabled="busy"
                            @click="requestCancel"
                            >{{ msg("cancel") }}</cdx-button
                        >
                        <cdx-button
                            :disabled="busy"
                            :title="msg('nomination_draft_help')"
                            @click="saveNominationDraft"
                            >{{ msg("save_nomination_draft") }}</cdx-button
                        >
                        <cdx-button
                            weight="primary"
                            action="progressive"
                            :disabled="busy"
                            @click="reviewNominations"
                            >{{ msg("preview") }}</cdx-button
                        >
                    </template>
                    <template v-else-if="isCheckBatch">
                        <cdx-button
                            weight="quiet"
                            action="destructive"
                            :disabled="busy"
                            @click="requestCancel"
                            >{{ msg("cancel") }}</cdx-button
                        >
                        <cdx-button
                            weight="quiet"
                            :disabled="busy"
                            :title="msg('quit_check_batch_help')"
                            @click="quitCheckBatch"
                            >{{ msg("quit") }}</cdx-button
                        >
                        <cdx-button
                            weight="quiet"
                            action="default"
                            :disabled="busy || checkBatchIndex === 0"
                            @click="previousCheckItem"
                            >{{ msg("previous") }}</cdx-button
                        >
                        <cdx-button
                            weight="normal"
                            action="default"
                            :disabled="busy"
                            @click="skip"
                            >{{ msg("skip") }}</cdx-button
                        >
                        <cdx-button
                            v-if="checkReasonBuilderActive"
                            weight="primary"
                            action="progressive"
                            :disabled="busy"
                            @click="continueCheckReasonBuilder"
                            >{{ msg("continue") }}</cdx-button
                        >
                        <cdx-button
                            v-else
                            weight="primary"
                            action="progressive"
                            :disabled="busy"
                            @click="save"
                            >{{ saveLabel }}</cdx-button
                        >
                    </template>
                    <template v-else>
                        <cdx-button
                            v-if="
                                kind === 'check' &&
                                view === 'main' &&
                                checkReasonRepairAvailable
                            "
                            :disabled="busy"
                            @click="backToCheckReasonBuilder"
                            >{{ msg("edit_nomination") }}
                        </cdx-button>
                        <cdx-button :disabled="busy" @click="requestCancel"
                            >{{ msg("cancel") }}
                        </cdx-button>
                        <cdx-button
                            v-if="checkReasonBuilderActive"
                            weight="primary"
                            action="progressive"
                            :disabled="busy"
                            @click="continueCheckReasonBuilder"
                            >{{ msg("continue") }}
                        </cdx-button>
                        <cdx-button
                            v-else
                            weight="primary"
                            action="progressive"
                            :disabled="busy"
                            @click="save"
                            >{{ saveLabel }}
                        </cdx-button>
                    </template>
                </div>
            </div>
        </template>
    </cdx-dialog>

    <cdx-dialog
        class="acga-codex-dialog acga-nomination-editor-dialog"
        :data-acga-nomination-editor="dialogId"
        :open="open && Boolean(editingNomination)"
        :title="nominationEditorTitle"
        :close-button-label="msg('close')"
        use-close-button
        fixed-height
        @update:open="onNominationEditorOpenUpdate"
    >
        <div v-if="nominationEditError">
            <cdx-message type="error" class="acga-editor-error" tabindex="-1">
                <div>{{ nominationEditError }}</div>
                <ul
                    v-if="nominationEditErrorDetails.length"
                    class="acga-dialog-error-details"
                >
                    <li
                        v-for="(issue, index) in nominationEditErrorDetails"
                        :key="index"
                    >
                        {{ issue }}
                    </li>
                </ul>
            </cdx-message>
        </div>
        <acga-author-form
            v-if="editingNomination"
            :nomination="editingNomination"
            :rule-groups="ruleGroups"
            :rule-dict="ruleDict"
            :disabled="busy"
            @change="clearNominationEditError"
        >
            <template #article-status>
                <div
                    v-if="assessmentTarget || dykTarget"
                    class="acga-article-status"
                >
                    <acga-article-status :status="articleStatus" compact />
                </div>
            </template>
        </acga-author-form>
        <template #footer>
            <div class="acga-dialog-footer">
                <div class="acga-footer-actions">
                    <cdx-button :disabled="busy" @click="cancelNominationEdit"
                        >{{ msg("cancel_nomination_edits") }}
                    </cdx-button>
                    <cdx-button
                        weight="primary"
                        action="progressive"
                        :disabled="busy"
                        @click="applyNominationEdit"
                        >{{ msg("apply_nomination_edits") }}
                    </cdx-button>
                </div>
            </div>
        </template>
    </cdx-dialog>

    <cdx-dialog
        class="acga-codex-dialog acga-nomination-preview-dialog"
        :open="open && previewOpen"
        :title="msg('nomination_preview')"
        :close-button-label="msg('close')"
        use-close-button
        fixed-height
        @update:open="onNominationPreviewOpenUpdate"
    >
        <div class="acga-nomination-preview-content">
            <cdx-progress-bar
                v-if="previewLoading"
                :aria-label="msg('working')"
            />
            <cdx-message v-if="previewError" type="error">{{
                previewError
            }}</cdx-message>
            <iframe
                v-if="previewHtml !== null"
                class="acga-nomination-preview-frame"
                sandbox=""
                referrerpolicy="no-referrer"
                :srcdoc="nominationPreviewDocument"
                :title="msg('nomination_preview')"
            />
        </div>
        <template #footer>
            <div class="acga-dialog-footer">
                <div class="acga-footer-actions">
                    <cdx-button
                        weight="quiet"
                        @click="closeNominationPreview"
                        >{{ msg("back") }}</cdx-button
                    >
                    <cdx-button
                        :disabled="busy"
                        :title="msg('nomination_draft_help')"
                        @click="saveNominationDraft"
                        >{{ msg("save_nomination_draft") }}</cdx-button
                    >
                </div>
            </div>
        </template>
    </cdx-dialog>
    <!-- /acga-template:dialog-host -->

    <!-- acga-template:article-status -->
    <template v-if="status.assessmentTarget">
        <dt v-if="!compact">{{ msg("page_assessments_label") }}</dt>
        <component
            :is="compact ? 'div' : 'dd'"
            class="acga-page-assessments"
            aria-live="polite"
        >
            <span v-if="status.assessmentLoading">{{
                msg("page_assessments_loading")
            }}</span>
            <span v-else-if="status.assessmentError">{{
                msg("page_assessments_failed")
            }}</span>
            <template v-else-if="status.assessmentGroups.length">
                <template
                    v-for="(group, groupIndex) in status.assessmentGroups"
                    :key="group.className"
                >
                    <span v-if="groupIndex">·</span
                    >{{ group.className }}（<template
                        v-for="(project, projectIndex) in group.projects"
                        :key="project.name"
                        ><span v-if="projectIndex">·</span
                        ><strong v-if="project.emphasized">{{
                            project.name
                        }}</strong
                        ><span v-else>{{ project.name }}</span></template
                    >）</template
                >
            </template>
            <span v-else>{{ msg("page_assessments_missing") }}</span>
        </component>
    </template>
    <template v-if="status.dykTarget">
        <dt v-if="!compact">{{ msg("dyk_status_label") }}</dt>
        <component
            :is="compact ? 'div' : 'dd'"
            class="acga-dyk-status"
            aria-live="polite"
        >
            {{ dykMessage.beforeLink
            }}<a
                :href="status.dykTalkUrl"
                target="_blank"
                rel="noopener noreferrer"
                >{{ dykMessage.linkLabel }}</a
            >{{ dykMessage.afterLink }}
            <a
                v-if="status.dykStatus?.nominated"
                class="acga-dyk-nomination"
                :href="status.dykNominationUrl"
                target="_blank"
                rel="noopener noreferrer"
                >{{ msg("dyk_status_nominated") }}</a
            >
        </component>
    </template>
    <!-- /acga-template:article-status -->

    <!-- acga-template:author-form -->
    <div class="acga-author-form" :data-nomination-id="nomination.id">
        <cdx-field
            class="acga-rule-category-fieldset"
            :class="{ 'acga-rule-category-error': nomination.errors.rules }"
            :is-fieldset="true"
            :disabled="disabled"
            :status="nomination.errors.rules ? 'error' : 'default'"
            :messages="{ error: nomination.errors.rules }"
        >
            <template v-if="nomination.errors.rules" #error>
                <ul class="acga-rule-error-list">
                    <li
                        v-for="(issue, index) in nomination.errors.rules
                            .split('\n')
                            .filter(Boolean)"
                        :key="index"
                    >
                        {{ issue }}
                    </li>
                </ul>
            </template>
            <template #label>{{ $root.msg("nomination_category") }}</template>
            <cdx-toggle-button-group
                :model-value="nomination.activeRuleCategory"
                :buttons="ruleCategoryButtons"
                :disabled="disabled"
                :aria-invalid="Boolean(nomination.errors.rules)"
                @update:model-value="setActiveRuleCategory"
            >
                <template #default="{ button, selected }">
                    {{ button.label
                    }}<span v-if="selected">
                        — {{ activeRuleCategoryScoreLabel }}</span
                    >
                </template>
            </cdx-toggle-button-group>
        </cdx-field>

        <cdx-field
            class="acga-author-fields"
            :class="{ 'acga-error-field': nomination.errors.awarder }"
            :disabled="disabled"
            :status="nomination.errors.awarder ? 'error' : 'default'"
        >
            <template #label>{{ $root.msg("recipient") }}</template>
            <cdx-text-input
                :id="awarderInputId"
                :model-value="nomination.awarder"
                :placeholder="awarderPlaceholder"
                :disabled="disabled"
                :status="nomination.errors.awarder ? 'error' : 'default'"
                @update:model-value="
                    (value) => {
                        nomination.awarder = value;
                        clearFieldError('awarder');
                    }
                "
            />
            <div v-if="nomination.errors.awarder" class="acga-field-error">
                {{ nomination.errors.awarder }}
            </div>
        </cdx-field>
        <div class="acga-rule-category-panel">
            <cdx-field
                v-if="
                    nomination.activeRuleCategory === 'article' ||
                    nomination.activeRuleCategory === 'review'
                "
                class="acga-author-field acga-rule-page-name"
                :class="{ 'acga-error-field': nomination.errors.pageName }"
                :disabled="disabled"
                :status="nomination.errors.pageName ? 'error' : 'default'"
            >
                <template #label>{{ $root.msg("article_title") }}</template>
                <cdx-text-input
                    :id="pageNameInputId"
                    :model-value="nomination.pageName"
                    :placeholder="articlePlaceholder"
                    :disabled="disabled"
                    :status="nomination.errors.pageName ? 'error' : 'default'"
                    @update:model-value="
                        (value) => {
                            nomination.pageName = value;
                            clearFieldError('pageName');
                        }
                    "
                />
                <div v-if="nomination.errors.pageName" class="acga-field-error">
                    {{ nomination.errors.pageName }}
                </div>
                <slot name="article-status" />
            </cdx-field>
            <cdx-field
                v-if="nomination.activeRuleCategory === 'media'"
                class="acga-author-field acga-media-target-fields"
                :class="{ 'acga-error-field': nomination.errors.media }"
                :disabled="disabled"
                :status="nomination.errors.media ? 'error' : 'default'"
            >
                <template #label>{{ $root.msg("page_name") }}</template>
                <template #description>{{
                    $root.msg(
                        "filename_including_file_or_an_article_that_uses_the_file",
                    )
                }}</template>
                <cdx-text-input
                    :id="mediaPageNameInputId"
                    :model-value="nomination.media.pageName"
                    :placeholder="mediaPlaceholder"
                    :disabled="disabled"
                    :status="nomination.errors.media ? 'error' : 'default'"
                    @update:model-value="
                        (value) => {
                            nomination.media.pageName = value;
                            clearFieldError('media');
                        }
                    "
                />
                <div v-if="nomination.errors.media" class="acga-field-error">
                    {{ nomination.errors.media }}
                </div>
            </cdx-field>
            <cdx-field
                v-if="nomination.activeRuleCategory === 'other'"
                class="acga-author-field acga-other-target-fields"
                :class="{ 'acga-error-field': nomination.errors.other }"
                :disabled="disabled"
                :status="nomination.errors.other ? 'error' : 'default'"
            >
                <template #label>{{ $root.msg("related_page") }}</template>
                <template #description>{{
                    $root.msg("related_page_help")
                }}</template>
                <cdx-text-input
                    :id="relatedPageInputId"
                    :model-value="nomination.otherPageName"
                    :placeholder="relatedPagePlaceholder"
                    :disabled="disabled"
                    :status="nomination.errors.other ? 'error' : 'default'"
                    @update:model-value="
                        (value) => {
                            nomination.otherPageName = value;
                            clearFieldError('other');
                        }
                    "
                />
                <div v-if="nomination.errors.other" class="acga-field-error">
                    {{ nomination.errors.other }}
                </div>
            </cdx-field>
            <acga-rule-groups
                :nomination="nomination"
                :groups="activeRuleGroups"
                :rule-dict="ruleDict"
                :disabled="disabled"
                @change="handleRuleChange"
            />
        </div>
    </div>
    <!-- /acga-template:author-form -->

    <!-- acga-template:rule-groups -->
    <div class="acga-rules">
        <template v-for="group in groups" :key="group.group">
            <template v-if="groupType(group) === 'article-core'">
                <cdx-field
                    v-for="line in group.compactGroups"
                    :key="line.group"
                    class="acga-article-core-line"
                    :is-fieldset="true"
                    :disabled="disabled"
                >
                    <template #label>{{ compactLineLabel(line) }}</template>
                    <div class="acga-article-core-row">
                        <div
                            v-if="groupType(line) === 'format'"
                            class="acga-article-core-control"
                            :title="
                                !canSelectFormat() && !compactLineSelected(line)
                                    ? $root.msg('format_prerequisite_help')
                                    : undefined
                            "
                        >
                            <acga-rule-editor
                                :ruleset="formatRule(line)"
                                :status="
                                    nomination.ruleStatus[formatRule(line).rule]
                                "
                                :disabled="compactLineDisabled(line)"
                                @change="$emit('change')"
                            />
                        </div>
                        <template v-else>
                            <cdx-checkbox
                                v-if="compactLineHasToggle(line)"
                                class="acga-article-core-toggle"
                                :model-value="compactLineSelected(line)"
                                :disabled="compactLineDisabled(line)"
                                hide-label
                                @update:model-value="
                                    (value) =>
                                        setCompactLineSelected(line, value)
                                "
                                >{{ compactLineLabel(line) }}
                            </cdx-checkbox>
                            <span
                                v-else
                                class="acga-article-core-toggle-placeholder"
                                aria-hidden="true"
                            ></span>
                            <div class="acga-article-core-control">
                                <template v-if="groupType(line) === 'content'">
                                    <template
                                        v-if="
                                            nomination.contentExpansion.legacy
                                        "
                                    >
                                        <cdx-message
                                            type="warning"
                                            :inline="true"
                                            >{{
                                                $root.msg(
                                                    "this_nomination_has_multiple_expansion_rules_or_custom_scores_each",
                                                )
                                            }}
                                        </cdx-message>
                                        <div class="acga-rule-list">
                                            <acga-rule-editor
                                                v-for="ruleset in line.rules"
                                                :key="ruleset.rule"
                                                :ruleset="ruleset"
                                                :status="
                                                    nomination.ruleStatus[
                                                        ruleset.rule
                                                    ]
                                                "
                                                :disabled="disabled"
                                                @change="$emit('change')"
                                            />
                                        </div>
                                    </template>
                                    <acga-content-expansion-editor
                                        v-else
                                        :nomination="nomination"
                                        :rule-dict="ruleDict"
                                        :disabled="
                                            disabled ||
                                            !nomination.contentExpansion.enabled
                                        "
                                        @change="$emit('change')"
                                    />
                                </template>

                                <template
                                    v-else-if="groupType(line) === 'quality'"
                                >
                                    <template v-if="nomination.quality.legacy">
                                        <cdx-message
                                            type="warning"
                                            :inline="true"
                                            >{{
                                                $root.msg(
                                                    "this_nomination_has_custom_or_nonconsecutive_quality_improvement_rules_each",
                                                )
                                            }}
                                        </cdx-message>
                                        <div class="acga-rule-list">
                                            <acga-rule-editor
                                                v-for="ruleset in line.rules"
                                                :key="ruleset.rule"
                                                :ruleset="ruleset"
                                                :status="
                                                    nomination.ruleStatus[
                                                        ruleset.rule
                                                    ]
                                                "
                                                :disabled="disabled"
                                                @change="$emit('change')"
                                            />
                                        </div>
                                    </template>
                                    <acga-quality-editor
                                        v-else
                                        :nomination="nomination"
                                        :rule-dict="ruleDict"
                                        :disabled="
                                            disabled ||
                                            !nomination.quality.enabled
                                        "
                                        @change="$emit('change')"
                                    />
                                </template>
                            </div>
                        </template>
                    </div>
                </cdx-field>
            </template>

            <cdx-field
                v-else
                class="acga-rule-group"
                :is-fieldset="groupType(group) !== 'review'"
                :disabled="disabled"
                :hide-label="groupType(group) === 'review'"
            >
                <template v-if="groupType(group) !== 'review'" #label>{{
                    groupLabel(group)
                }}</template>
                <template
                    v-if="group.explanation && groupType(group) !== 'review'"
                    #description
                    >{{ group.explanation }}
                </template>

                <template v-if="groupType(group) === 'review'">
                    <cdx-message
                        v-if="nomination.rule5Unresolved"
                        type="warning"
                        :inline="true"
                        >{{
                            $root.msg(
                                "the_existing_rule_5_entries_cannot_be_represented_by_this",
                            )
                        }}
                    </cdx-message>
                    <acga-review-editor
                        :nomination="nomination"
                        :rule-dict="ruleDict"
                        :disabled="disabled"
                        @change="$emit('change')"
                    />
                </template>

                <acga-activity-editor
                    v-else-if="groupType(group) === 'activity'"
                    :nomination="nomination"
                    :rule-dict="ruleDict"
                    :disabled="disabled"
                    @change="$emit('change')"
                />

                <div
                    v-else
                    class="acga-rule-list"
                    :class="{
                        'acga-media-rule-list': groupType(group) === 'media',
                    }"
                >
                    <acga-rule-editor
                        v-for="ruleset in group.rules"
                        :key="ruleset.rule"
                        :ruleset="ruleset"
                        :status="nomination.ruleStatus[ruleset.rule]"
                        :disabled="disabled"
                        @change="$emit('change')"
                    />
                </div>
            </cdx-field>
        </template>
    </div>
    <!-- /acga-template:rule-groups -->

    <!-- acga-template:rule-editor -->
    <div class="acga-rule-row">
        <cdx-checkbox
            :model-value="status.selected"
            :disabled="disabled"
            hide-label
            @update:model-value="setSelected"
            >{{ ruleset.label }}
        </cdx-checkbox>
        <cdx-text-input
            class="acga-description-input"
            :model-value="status.desc"
            :disabled="fieldsDisabled"
            :aria-label="ruleset.label + ' ' + $root.msg('description')"
            @update:model-value="setDescription"
        />
        <acga-score-input
            :model-value="scoreText"
            :disabled="fieldsDisabled"
            :label="ruleset.label + ' ' + $root.msg('score')"
            @update:model-value="setScore"
        />
    </div>
    <!-- /acga-template:rule-editor -->

    <!-- acga-template:content-expansion-editor -->
    <div class="acga-content-expansion-row">
        <cdx-combobox
            :selected="draft.choice"
            :menu-items="menuItems"
            :disabled="disabled || !draft.enabled"
            :aria-label="$root.msg('expansion_type_or_custom_description')"
            @update:selected="setChoice"
        />
        <acga-score-input
            :model-value="scoreText"
            :disabled="disabled || !draft.enabled"
            :label="$root.msg('score')"
            @update:model-value="setScore"
        />
    </div>
    <!-- /acga-template:content-expansion-editor -->

    <!-- acga-template:quality-editor -->
    <div class="acga-quality-row">
        <cdx-select
            :selected="String(draft.fromIndex)"
            :menu-items="fromItems"
            :disabled="disabled || !draft.enabled"
            :aria-label="$root.msg('quality_before_improvement')"
            @update:selected="setFrom"
        />
        <span>{{ $root.msg("to") }}</span>
        <cdx-select
            :selected="String(draft.toIndex)"
            :menu-items="toItems"
            :disabled="disabled || !draft.enabled"
            :aria-label="$root.msg('quality_after_improvement')"
            @update:selected="setTo"
        />
        <acga-score-input
            :model-value="scoreText"
            :disabled="disabled || !draft.enabled"
            :label="$root.msg('total_quality_improvement_score')"
            @update:model-value="setScore"
        />
        <cdx-checkbox
            class="acga-pending-toggle"
            :model-value="Boolean(draft.pending)"
            :disabled="disabled || !draft.enabled"
            @update:model-value="setPending"
            >{{ $root.msg("review_pending") }}
        </cdx-checkbox>
    </div>
    <!-- /acga-template:quality-editor -->

    <!-- acga-template:review-editor -->
    <div class="acga-review-main">
        <cdx-field
            class="acga-review-stage"
            :is-fieldset="true"
            :disabled="disabled"
        >
            <template #label>{{ $root.msg("review_tier") }}</template>
            <template #description>{{
                $root.msg("review_tier_preset_help")
            }}</template>
            <div class="acga-review-tier-options">
                <cdx-radio
                    v-for="tier in $root.reviewTierItems"
                    :key="tier.value"
                    :model-value="selectedTier"
                    :input-value="tier.value"
                    :name="'acga-review-tier-' + nomination.id"
                    :disabled="disabled"
                    inline
                    @update:model-value="setPresetTier"
                    >{{ tier.presetLabel }}</cdx-radio
                >
            </div>
        </cdx-field>
        <cdx-field
            class="acga-review-modes"
            :is-fieldset="true"
            :disabled="disabled"
        >
            <template #label>{{ $root.msg("scoring_rules") }}</template>
            <cdx-toggle-button-group
                :model-value="reviewMode"
                :buttons="modeItems"
                :disabled="disabled"
                :aria-label="$root.msg('scoring_rules')"
                @update:model-value="setReviewMode"
            />
            <div class="acga-review-items">
                <div
                    v-for="item in displayedItems"
                    :key="item.key"
                    class="acga-review-item-row"
                    :data-review-row="item.key"
                >
                    <cdx-checkbox
                        v-if="reviewMode === 'aspects'"
                        class="acga-review-aspect-toggle"
                        :model-value="item.draft.selected"
                        :disabled="disabled"
                        @update:model-value="
                            (value) => setSelected(item, value)
                        "
                        >{{ item.label }}</cdx-checkbox
                    >
                    <div class="acga-review-item-controls">
                        <cdx-combobox
                            class="acga-review-choice"
                            :selected="choiceText(item)"
                            :menu-items="choiceItems(item)"
                            :status="
                                item.draft.selected && choiceInvalid(item)
                                    ? 'error'
                                    : 'default'
                            "
                            :disabled="
                                disabled ||
                                (reviewMode === 'aspects' &&
                                    !item.draft.selected)
                            "
                            :aria-label="
                                item.label +
                                ' ' +
                                $root.msg('review_description')
                            "
                            @update:selected="(value) => setChoice(item, value)"
                        />
                        <cdx-checkbox
                            v-if="item.key !== 'complete'"
                            class="acga-review-quick-toggle"
                            :model-value="item.draft.quick"
                            :disabled="
                                disabled ||
                                (reviewMode === 'aspects' &&
                                    !item.draft.selected)
                            "
                            @update:model-value="
                                (value) => setQuick(item, value)
                            "
                            >{{ $root.msg("quick_review") }}</cdx-checkbox
                        >
                        <acga-score-input
                            :model-value="scoreText[item.key]"
                            :disabled="
                                disabled ||
                                (reviewMode === 'aspects' &&
                                    !item.draft.selected)
                            "
                            :label="$root.msg('review_score')"
                            @update:model-value="
                                (value) => setScore(item, value)
                            "
                        />
                    </div>
                </div>
            </div>
        </cdx-field>
    </div>
    <!-- /acga-template:review-editor -->

    <!-- acga-template:activity-editor -->
    <div class="acga-activity-editor">
        <div
            v-for="row in rows"
            :key="row.id"
            class="acga-rule-row acga-activity-row"
        >
            <cdx-checkbox
                :model-value="row.selected"
                :disabled="disabled"
                hide-label
                @update:model-value="(value) => setSelected(row, value)"
                >{{
                    row.choice ||
                    $root.msg("activity_type_or_custom_description")
                }}
            </cdx-checkbox>
            <cdx-combobox
                :selected="row.choice"
                :menu-items="menuItems"
                :disabled="disabled || !row.selected"
                :status="
                    choiceInvalid(row) && row.selected ? 'error' : 'default'
                "
                :aria-label="$root.msg('activity_type_or_custom_description')"
                @update:selected="(value) => setChoice(row, value)"
            />
            <acga-score-input
                :model-value="String(row.score ?? '')"
                :disabled="disabled || !row.selected"
                :status="
                    scoreInvalid(row) && row.selected ? 'error' : 'default'
                "
                :label="$root.msg('activity_score')"
                @update:model-value="(value) => setScore(row, value)"
            />
            <cdx-checkbox
                class="acga-pending-toggle"
                :model-value="Boolean(row.pending)"
                :disabled="disabled || !row.selected"
                @update:model-value="(value) => setPending(row, value)"
                >{{ $root.msg("review_pending") }}
            </cdx-checkbox>
            <cdx-button
                weight="quiet"
                action="destructive"
                :disabled="disabled"
                @click="removeRow(row)"
                >{{ $root.msg("remove") }}
            </cdx-button>
        </div>
        <cdx-button
            class="acga-activity-add"
            :disabled="disabled"
            @click="addRow"
        >
            {{ $root.msg("add_activity") }}
        </cdx-button>
    </div>
    <!-- /acga-template:activity-editor -->

    <!-- acga-template:score-input -->
    <span
        class="acga-score-control"
        :class="{
            'acga-score-control-disabled': disabled,
            'acga-score-control-error': invalid && !disabled,
        }"
    >
        <cdx-button
            class="acga-score-decrease"
            type="button"
            size="small"
            weight="normal"
            action="default"
            :disabled="decrementDisabled"
            :aria-label="decreaseLabel"
            :title="decreaseTooltip"
            @click="step(-1)"
            ><cdx-icon :icon="minusIcon" size="small"
        /></cdx-button>
        <cdx-text-input
            class="acga-score-input"
            :model-value="valueText"
            :disabled="disabled"
            :status="invalid && !disabled ? 'error' : 'default'"
            input-type="number"
            min="0"
            step="0.5"
            :aria-label="label"
            @update:model-value="setValue"
            @keydown="onKeydown"
        />
        <span class="acga-score-unit">{{ $root.scoreUnit(modelValue) }}</span>
        <cdx-button
            class="acga-score-increase"
            type="button"
            size="small"
            weight="normal"
            action="default"
            :disabled="disabled"
            :aria-label="increaseLabel"
            :title="increaseTooltip"
            @click="step(1)"
            ><cdx-icon :icon="plusIcon" size="small"
        /></cdx-button>
    </span>
    <!-- /acga-template:score-input -->
</template>
