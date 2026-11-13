# mathterm

Project docs are in `NOTES.md` (index) and `notes/`: read `notes/architecture.md` and `notes/auto-detect.md`
before changing `ui/`, and `notes/plans.md` for known issues. Record changes in `notes/changelog.md`
(newest first, above the latest release marker).

Releases: tags `v*` build and publish via `.github/workflows/release.yml` (see `notes/dev.md`, Releasing).
What's released: `git describe --tags --abbrev=0` and `gh release view`; `notes/changelog.md` marks
where each release was cut.
