# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: [report a vulnerability](https://github.com/cristoslc/bb-plugin-focus-board/security/advisories/new).

Include the affected Focus Board version, the bb version, the steps to reproduce, and what an attacker gains. Quote any output verbatim.

## Supported versions

Only the latest release on `main` receives fixes. Focus Board is installed by tag, so upgrading is a semver-range bump in bb.

## Scope

Focus Board runs inside bb as a plugin and keeps its state in bb's own stores. Reports about the plugin's code, its network calls, and its stored data are in scope. Problems in bb itself belong with the bb project.

Past audits and the approved network seams are in [docs](docs), under the `security-audit-*` files. `npm run gates` checks the shipped code against those seams.
