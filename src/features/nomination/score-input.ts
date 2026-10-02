/**
 * @file src/features/nomination/score-input.ts
 * Purpose: src / features / nomination / score input module.
 *
 * Table of contents:
 * 1. Imports
 * 2. createScoreInput
 */

import type { ComponentOptions } from "vue";
import type { CodexModule } from "./contracts.ts";
import { scoreInputTemplate } from "./templates.ts";

/** One editable half-point control for authoring, review, and checking. */
export function createScoreInput(Codex: CodexModule): ComponentOptions {
    return {
        name: "AcgaScoreInput",
        components: {
            CdxButton: Codex.CdxButton,
            CdxIcon: Codex.CdxIcon,
            CdxTextInput: Codex.CdxTextInput,
        },
        props: {
            modelValue: { type: [String, Number], required: true },
            label: { type: String, required: true },
            disabled: { type: Boolean, default: false },
            status: { type: String, default: "default" },
        },
        emits: ["update:modelValue"],
        data() {
            return {
                minusIcon: '<path d="M2 9h16v2H2z"/>',
                plusIcon: '<path d="M9 2h2v7h7v2h-7v7H9v-7H2V9h7z"/>',
            };
        },
        computed: {
            valueText() {
                return String(this.modelValue ?? "");
            },
            numberValue() {
                return this.valueText.trim() === ""
                    ? NaN
                    : Number(this.valueText);
            },
            invalid() {
                const number = this.numberValue;
                return (
                    this.status === "error" ||
                    !Number.isFinite(number) ||
                    number < 0 ||
                    Math.abs(number * 2 - Math.round(number * 2)) >
                        Number.EPSILON * Math.max(1, Math.abs(number * 2))
                );
            },
            decrementDisabled() {
                return (
                    this.disabled ||
                    !Number.isFinite(this.numberValue) ||
                    this.numberValue <= 0
                );
            },
            decreaseLabel() {
                return this.$root.msg("decrease_score", { label: this.label });
            },
            increaseLabel() {
                return this.$root.msg("increase_score", { label: this.label });
            },
            decreaseTooltip() {
                return this.$root.msg("decrease_half_point");
            },
            increaseTooltip() {
                return this.$root.msg("increase_half_point");
            },
        },
        methods: {
            setValue(value: string | number) {
                if (!this.disabled)
                    this.$emit("update:modelValue", String(value));
            },
            step(direction: number) {
                if (this.disabled || (direction < 0 && this.decrementDisabled))
                    return;
                const current = Number.isFinite(this.numberValue)
                    ? Math.max(0, this.numberValue)
                    : 0;
                const halfPoints = current * 2;
                const next =
                    direction > 0
                        ? Math.floor(halfPoints) + 1
                        : Math.ceil(halfPoints) - 1;
                this.setValue(Math.max(0, next / 2));
            },
            onKeydown(event: KeyboardEvent) {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                    return;
                event.preventDefault();
                this.step(event.key === "ArrowUp" ? 1 : -1);
            },
        },
        template: scoreInputTemplate,
    };
}
