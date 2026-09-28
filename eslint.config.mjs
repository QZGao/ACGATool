import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
    globalIgnores([
        "dist/**",
        "coverage/**",
        "test-results/**",
        "playwright-report/**",
    ]),
    {
        files: ["**/*.{ts,mjs}"],
        extends: [js.configs.recommended, tseslint.configs.recommended],
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
        rules: {
            "@typescript-eslint/consistent-type-imports": [
                "error",
                { disallowTypeAnnotations: false },
            ],
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
            ],
        },
    },
    {
        files: ["src/domain/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            regex: "(?:^|/)(?:app|features|platform|i18n)(?:/|$)|^(?!\\.{1,2}/)",
                            message:
                                "Domain rules depend only on domain and shared modules.",
                        },
                    ],
                },
            ],
            "no-restricted-globals": [
                "error",
                {
                    globals: [
                        "window",
                        "document",
                        "mw",
                        "fetch",
                        "localStorage",
                        "sessionStorage",
                        "navigator",
                    ],
                    checkGlobalObject: true,
                },
            ],
        },
    },
    {
        files: ["src/shared/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            regex: "(?:^|/)(?:app|features|platform|domain|i18n)(?:/|$)|^(?!\\.{1,2}/)",
                            message:
                                "Shared capabilities stay independent of application layers.",
                        },
                    ],
                },
            ],
        },
    },
    {
        // Upstream rule drafts and Vue Options API state accept extension fields.
        // Their public service contracts are typed; strict TypeScript stays on.
        files: [
            "src/domain/rules.ts",
            "src/domain/wikitext.ts",
            "src/features/nomination/contracts.ts",
            "src/features/nomination/dialog-host.ts",
            "src/features/nomination/model.ts",
            "src/features/nomination/rule-forms.ts",
            "src/platform/mediawiki/api.ts",
        ],
        rules: { "@typescript-eslint/no-explicit-any": "off" },
    },
    {
        files: ["tests/**/*.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-empty-function": "off",
        },
    },
);
