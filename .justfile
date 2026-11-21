# Development tasks for the Code Assurance extension.
# Run `just` to see the list.

set shell := ["bash", "-euo", "pipefail", "-c"]

vsix := "code-assurance-" + `node -p "require('./package.json').version"` + ".vsix"

# List available recipes
default:
    @just --list --unsorted

# Install dependencies exactly as locked
install:
    npm ci

# Install dependencies and refresh the lock file
deps:
    npm install

# Check dependencies for known vulnerabilities
audit:
    npm audit

# Bundle the extension into dist/ (with source maps)
build:
    npm run build

# Rebuild on every change
watch:
    npm run watch

# Type-check sources and tests
typecheck:
    npm run typecheck

# Lint everything Biome understands (rules and import order)
lint:
    npm run lint

# Format files, sort imports and apply safe lint fixes
fmt:
    npm run format

# Fail when a file is not formatted
fmt-check:
    npm run format:check

# Run unit tests once (optionally filtered by test name)
test filter="":
    if [ -n "{{filter}}" ]; then npx vitest run -t "{{filter}}"; else npm test; fi

# Run unit tests in watch mode
test-watch:
    npm run test:watch

# Render the marketplace PNG icon from its SVG source
icons:
    npm run icons

# Integration test in a real VS Code window (needs `code`, a display and local language extensions)
test-int: build
    node test/integration/run.mjs

# Everything CI checks: format, lint, types, tests, bundle
check: fmt-check lint typecheck test build

# Open a VS Code window with the extension loaded from this folder
run folder=".": build
    code --extensionDevelopmentPath="{{justfile_directory()}}" "{{folder}}"

# Build a minified .vsix package
package: check
    npm run package

# Install the packaged .vsix into the local VS Code
install-ext: package
    code --install-extension "{{vsix}}" --force

# Remove the extension from the local VS Code
uninstall-ext:
    code --uninstall-extension yurii-musolov.code-assurance

# Bump the version (patch | minor | major), commit and tag it; push the tag to publish
release level="patch": check
    npm version {{level}} -m "release: %s"

# Remove build output
clean:
    rm -rf dist out .vscode-test *.vsix

# Remove build output and dependencies
distclean: clean
    rm -rf node_modules
