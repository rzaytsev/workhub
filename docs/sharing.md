# Repository distribution

Workhub is distributed as an experimental local Codex plugin under MIT.
The repository includes a marketplace, portable plugin manifests, a bundled
server and UI, the todo skill, and third-party license notices. Node.js 22.12 or
newer is required on the host PATH. The installation ID is
`workhub@workhub`.

The packaging layout follows the [official OpenAI plugin guide](https://developers.openai.com/plugins/build/plugins).
The source checkout can be built with `npm ci` and `npm run build`. Built plugin
files under `plugins/workhub/dist/` are included so marketplace installations
do not depend on the author's checkout or its `node_modules`.

## Before publishing an update

Run type checking, unit tests, the production build, the isolated MCP smoke check,
and browser checks. Run `npm run check:publication`, inspect the staged file list
and staged contents, and scan the exact candidate with Gitleaks. Use a public
noreply address belonging to the author for commit metadata (copy it from
GitHub Settings > Emails); a generic noreply address can attribute commits to
another account. Do not publish local registries, task files,
private configuration, real-workspace screenshots, credentials, or machine paths.

Update committed plugin artifacts and dependency notices with the build. Confirm
that a relocated plugin starts without access to this checkout's dependencies.
The CI workflow repeats those checks using temporary fixtures.
The staged privacy scan runs before dependencies or tests, so private fixture
identifiers are rejected before test failures can copy them into CI logs.

## Automated releases

Pull requests targeting `main` run validation without publishing. A merge or
direct push to `main` runs the same checks, then publishes a GitHub prerelease
named `v<package.json version>` with `workhub-<version>.zip`. The ZIP contains
the tracked source, marketplace, and already built plugin at the exact validated
commit, under a `workhub/` folder. No local registries or dependency directory
are included. Only the release job receives repository write permission.

Bump `package.json` and rebuild before merging a new release. Existing published
versions are skipped, so documentation-only changes do not replace release assets.
An unfinished draft, missing ZIP, or conflicting tag fails for manual review.
Release jobs are serialized and never cancel an upload already in progress.

## Acceptance limits

Automated browser checks use a simulated MCP App host. Actual Codex directory
selection, chat creation, thread-link persistence, navigation, and plugin launch need acceptance in
the target host. A fresh installation on a second machine has not been verified.
Other operating systems should be treated as unverified until tested.

This repository is a source and marketplace distribution, not a listing in the
universal plugin directory. Keep local filesystem access local; do not expose
task files through a public tunnel to meet a remote plugin submission requirement.
See [privacy notes](privacy.md) for how MCP host processing affects task data.
