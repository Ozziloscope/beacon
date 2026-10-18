# Changelog

## 1.1.0

Upgrading from 1.0 keeps every account, article, revision, tag, photo and setting. See "Upgrading" in the README.

- **Profiles:** new optional Organization field. Profiles read "Job title, Team / Dept @ Organization", or "Job title, Team / Dept" when no organization is set.
- **Password resets by email:** "Forgot your password?" on the sign-in page emails a single-use link (60 minutes). Admin resets lock the old password, sign the member out and email a link (24 hours). Members get a notice when their password changes and when their account is approved. Email is set up under Site settings, with a test button. Without email, admin resets fall back to a temporary password.
- **Navigation:** spaces moved out of the header into a rail on the right of each page (a drawer on phones), and main spaces can now hold sub-spaces. A main space's page includes its sub-spaces' articles.
- **People removed:** the People tab and directory are gone. Profiles are still reachable from bylines.
- **About on sign-in:** the sign-in and sign-up pages show an editable About section next to the form.
- **Safer upgrades:** the database is copied before any schema change, the installer backs up first, keeps settings in `/etc/beacon/beacon.env`, and keeps the previous version for rollback.

## 1.0.0

First release.
