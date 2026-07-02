/**
 * =============================================================================
 * ESLint configuration - HMS React frontend workspace (@hms/frontend)
 * =============================================================================
 *
 * Provides React / JSX-aware linting for the Hospital Management System (HMS)
 * single-page application. The frontend is a "standard React app structure"
 * built with React 18 + Vite, authored in plain JavaScript (.js / .jsx) - there
 * is NO TypeScript in this workspace.
 *
 * -----------------------------------------------------------------------------
 * Why the ".cjs" extension (and NOT ".eslintrc.js")?
 * -----------------------------------------------------------------------------
 * The frontend package.json declares `"type": "module"`, which makes Node.js
 * treat every plain ".js" file in this workspace as an ES module (ESM). A file
 * named ".eslintrc.js" would therefore be parsed as ESM, and the CommonJS
 * `module.exports = {...}` assignment below would throw:
 *
 *     ReferenceError: module is not defined in ES module scope
 *
 * The ".cjs" extension forces Node to load this file as CommonJS regardless of
 * the package "type", so `module.exports` works correctly. This is the standard
 * pattern for config files in ESM-flagged packages.
 *
 * -----------------------------------------------------------------------------
 * Config format
 * -----------------------------------------------------------------------------
 * This targets ESLint v8 (pinned as `eslint ^8.57.1` in devDependencies) using
 * the classic ".eslintrc" (eslintrc) configuration format - NOT the newer flat
 * config (eslint.config.js). All plugins referenced here are declared in this
 * workspace's package.json:
 *   - eslint-plugin-react
 *   - eslint-plugin-react-hooks
 *   - eslint-plugin-react-refresh
 *
 * Formatting concerns (spacing, quotes, semicolons, etc.) are intentionally NOT
 * handled here; formatting is owned repo-wide by the root Prettier setup so the
 * monorepo stays consistent. This file governs correctness/quality lint rules
 * only.
 * =============================================================================
 */

module.exports = {
  // ---------------------------------------------------------------------------
  // root: true
  // ---------------------------------------------------------------------------
  // Stop ESLint's upward configuration cascade at this directory. Without this,
  // ESLint would keep walking parent directories (the monorepo root and beyond)
  // merging any ".eslintrc*" it finds. Marking the frontend config as the root
  // keeps these React-specific rules fully self-contained and prevents the
  // workspace from inheriting - or conflicting with - repo-wide lint settings.
  root: true,

  // ---------------------------------------------------------------------------
  // env
  // ---------------------------------------------------------------------------
  // Declares the global variables / syntax available to the source being
  // linted so ESLint does not flag them as undefined:
  //   - browser: window, document, fetch, localStorage, etc. (SPA runs in the
  //     browser).
  //   - es2021:  modern ECMAScript globals (Promise, BigInt, ...) and implies
  //     ES2021 syntax support.
  //   - node:    Node globals (process, __dirname, module) - needed for build
  //     tooling / config files and Vite's Node-side code.
  env: {
    browser: true,
    es2021: true,
    node: true,
  },

  // ---------------------------------------------------------------------------
  // extends
  // ---------------------------------------------------------------------------
  // Layered rule presets, applied in order (later entries win on conflict):
  //   1. eslint:recommended            - ESLint's baseline set of correctness
  //                                      rules (no-undef, no-unused-vars, ...).
  //   2. plugin:react/recommended      - React best-practice rules from
  //                                      eslint-plugin-react.
  //   3. plugin:react/jsx-runtime      - Disables the legacy "React must be in
  //                                      scope" rules for projects using the
  //                                      React 17+ automatic JSX runtime (this
  //                                      app never imports React directly).
  //   4. plugin:react-hooks/recommended- Enforces the Rules of Hooks
  //                                      (rules-of-hooks + exhaustive-deps).
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],

  // ---------------------------------------------------------------------------
  // parserOptions
  // ---------------------------------------------------------------------------
  // Tells the default (Espree) parser how to read the source:
  //   - ecmaVersion: 'latest' - parse the newest supported ECMAScript syntax.
  //   - sourceType:  'module' - files use ESM `import` / `export`.
  //   - ecmaFeatures.jsx: true - enable JSX syntax parsing (.jsx files).
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },

  // ---------------------------------------------------------------------------
  // settings
  // ---------------------------------------------------------------------------
  // Shared settings consumed by plugins. `react.version: 'detect'` tells
  // eslint-plugin-react to auto-detect the installed React version (18.x here)
  // so version-sensitive rules behave correctly, instead of assuming a default.
  settings: {
    react: {
      version: 'detect',
    },
  },

  // ---------------------------------------------------------------------------
  // plugins
  // ---------------------------------------------------------------------------
  // Register eslint-plugin-react-refresh so its rules are available. (The
  // react and react-hooks plugins are registered implicitly via their
  // "plugin:.../recommended" entries in `extends` above, so they do not need to
  // be repeated here.) react-refresh guards the Vite Fast Refresh contract.
  plugins: ['react-refresh'],

  // ---------------------------------------------------------------------------
  // ignorePatterns
  // ---------------------------------------------------------------------------
  // Paths ESLint should never lint:
  //   - dist         - Vite build output (generated, not source).
  //   - coverage     - Vitest / c8 coverage reports (generated).
  //   - node_modules - third-party dependencies.
  //   - *.config.js  - tooling config files (e.g. vite.config.js) that are not
  //                    part of the application source and follow their own
  //                    conventions.
  ignorePatterns: ['dist', 'coverage', 'node_modules', '*.config.js'],

  // ---------------------------------------------------------------------------
  // rules
  // ---------------------------------------------------------------------------
  // Project-specific overrides layered on top of the extended presets. These
  // are kept deliberately pragmatic (warnings, not hard errors) so a greenfield
  // scaffold lints cleanly while still surfacing genuine issues.
  rules: {
    // react-refresh/only-export-components:
    //   Warns when a module exports something other than React components,
    //   which breaks Vite's Fast Refresh (HMR) boundary. `allowConstantExport`
    //   permits co-locating simple constant exports alongside a component
    //   without tripping the rule. Warning (not error) to avoid blocking DX.
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],

    // react/prop-types:
    //   Disabled. This is a plain-JavaScript app that does not use runtime
    //   prop-types validation, so requiring propTypes declarations would be
    //   pure noise.
    'react/prop-types': 'off',

    // react/react-in-jsx-scope:
    //   Disabled. With React 17+ automatic JSX runtime (and the
    //   plugin:react/jsx-runtime preset above), components do NOT need to
    //   `import React` to use JSX. Turning this off explicitly documents the
    //   intent and keeps the app import-clean.
    'react/react-in-jsx-scope': 'off',

    // no-unused-vars:
    //   Warns on unused variables/arguments, but ignores identifiers prefixed
    //   with an underscore (e.g. `_unused`, `(_req, res) => ...`). This is the
    //   conventional escape hatch for intentionally unused bindings.
    'no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
};
