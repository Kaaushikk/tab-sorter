# Releasing Tab Sorter

## Before a release tag

1. Complete `docs/MANUAL_TESTS.md` on both browsers and record exact versions in the README. Verify real provider calls, Shields, vertical tabs, and browser restart recovery. Do not convert pending checks into assumed passes.
2. Run `npm ci`, `npm run check`, and `npm run package` from a clean checkout. Load the extracted ZIP in both test profiles.
3. Inspect tracked files and commit history for secrets and personal data. Keep `.env`, `.local`, build outputs, archives, and profiles untracked. Rotate any accidentally exposed credential immediately; deleting the latest file does not remove it from history.
4. Update `package.json`, the lockfile, `public/manifest.json`, and CHANGELOG together. Use numeric `X.Y.Z` in the manifest; Git tags use `vX.Y.Z`. Keep the built artifact's manifest version consistent.
5. Merge through a passing PR. Push the matching version tag. The release workflow runs checks, packages `dist`, and attaches `tab-sorter-X.Y.Z.zip` plus a SHA-256 checksum to a GitHub Release.

No release tag is created automatically by development work. The initial repository version is a development preview, not a claim of store approval or completed manual certification.

## Chrome Web Store packaging

The ZIP must have `manifest.json`, popup/options HTML, background JS, bundled assets, and icons at its root. `npm run package` produces this layout and excludes source, tests, keys, caches, and dependencies.

The first submission is manual through the Chrome Web Store developer dashboard. Verify current registration, identity, asset, and privacy requirements there. Upload the ZIP, add real 1280×800 screenshots and the 128px icon, fill out the listing/single-purpose/permission/data-use fields from `STORE_LISTING.md`, provide the public privacy policy, and submit for review. No store account registration, payments, credential creation, or store publication is part of the repository push.

After the first approved listing, later updates can be automated using the official store publishing API and protected CI credentials. That integration is intentionally not configured here: it requires the owner's store project, OAuth setup, and publication policy. Keep those credentials in protected GitHub Actions secrets, never in the extension or source.

## Privacy policy hosting

`PRIVACY.md` is standalone and publicly readable through GitHub. To host on GitHub Pages, copy/render it as the policy page in a Pages source and enable Pages for that repository, or link to its public GitHub rendering. Verify the resulting URL before placing it in a store listing. Merely pushing this repository does not enable Pages.
