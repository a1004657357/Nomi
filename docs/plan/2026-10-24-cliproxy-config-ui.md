# CLIProxy Configuration Entry Investigation

Baseline: `a730dacb5ad307904420b375f539d454c42ed27f`.
Owner: configuration UI line. Scope: `src/ui/onboarding` and directly related tests/locales. No provider requests, credential reads, catalog writes, production app interaction, commits or merges.

| Cell | Decision and Evidence |
| --- | --- |
| 1. User Workflow | Open model settings; open the CLIProxy connection; edit the existing address/key fields; open Add Other Models; explicitly fetch the remote list or enter an exact ID; select additional models. Reuse production components with synthetic metadata. Real saved-key editing and real upstream listing remain unverified, not authorized in this line. |
| 2. Ownership | Catalog and credentials remain main-process owned. UI consumes `OnboardingVendorMeta` and sends vendor-key-bound existing bridge commands. Never read a stored key into the picker. Trace `projectOnboardingConnections`, `CustomVendorManage`, and `ExistingConnectionModelPicker` with door-map after dependency installation. |
| 3. Reuse | Keep `CustomVendorCard` / `CustomVendorManage` / `VendorBaseUrlField` and `ExistingConnectionModelPicker` / `ModelPickerScreen`. Do not add a CLIProxy-specific manager or special-case loopback addresses. |
| 4. States | Saved connection: address and masked credential state. Picker initially shows registered models, not the entire upstream inventory. Fetching is explicit; success merges exact IDs; failure retains existing models and reports a separate status. Missing address/key blocks registration according to the existing protocol. |
| 5. Interruptions | No new async lifecycle or spend path. Existing picker scopes responses by vendor/address/revision. Closing discards unsaved UI drafts; cancellation must not rewrite the catalog. Baseline behavior under a real window interruption remains unverified. |
| 6. External Inputs | Only synthetic metadata and model-list responses in this line. Upstream availability/credentials/image generation belong to main. Do not infer missing credentials from an image HTTP 400. |
| 7. Budget | Focused offline tests, one worker; no whole-project build. No live calls or paid generation. |
| 8. Real Conditions | User app PID 32295 is protected. No profile or existing window inspection. Windows, native zh/en screenshots, saved-key changes and actual upstream listing remain unverified. SSR/fixtures are not real acceptance. |
| 9. Acceptance/Rollback | First reproduce a production defect; only then add a schema-v3 remediation contract and RED/GREEN fix. If baseline already passes, report not reproduced and preserve production code. Main independently reviews the external report. Test/doc additions can be removed individually without catalog migration. |

## Initial Finding

Both the daily checkout and the clean worktree have the exact baseline above. Neither contains `cliproxy-local` classification code in onboarding. `onboardingDrawerConnections.ts` excludes only explicit native/runtime owners from generic APIs; `cliproxy-local` is not excluded. `OnboardingDrawer.tsx` routes the resulting group to `CustomVendorCard`, which already renders URL/key management. The proposed local-CLI misclassification is therefore not yet reproduced at this baseline.

Do not invent a root-cause contract or claim a RED/GREEN production repair unless the dedicated regression exposes an actual failure. A deployed-window/version or sanitized vendor-identity mismatch remains a separate hypothesis, not a confirmed diagnosis.

## Authorized Discoverability Repair

The follow-up explicitly authorizes a discoverability fix even when classification is correct. The baseline connected row shows name, model count, status and a chevron only. Its connection detail header labels the action vaguely as Add More and hides the text on narrow widths. These are independently reproducible presentation conditions, not a claim that the existing URL/key controls are absent.

- Show permanent Edit URL / API Key and Add Models commands on API connection rows only. Commands are sibling buttons, never nested in the row button.
- Edit reuses the existing connection-detail navigation; the existing address editor and key-replacement field remain the only editors. Make the key replacement label explicit.
- Add reuses the existing wizard with the exact saved vendor key and the existing credential gate. Opening never fetches models; the picker retains its explicit Get Available Models command and manual IDs.
- Keep the connection-detail Add Models text visible on narrow widths; existing detail controls and native cards remain unchanged.
- Empty/credential-missing connections still open the same configuration fields; unavailable Add stays absent according to existing protocol. Loading/error/partial states remain owned by existing discovery code. No new retry, request or persistence path.
- Scope: `ModelSettingsHome.tsx`, `onboardingDrawerConnections.ts`, `ModelSettingsWorkspacePages.tsx`, `CustomVendorManage.tsx`, direct zh/en locale and tests.
- Verification: baseline nine-case investigation suite, then focused RED for absent visible commands/direct add navigation and mobile label, then identical GREEN command. An isolated zh/en browser fixture checks the production components without a provider, profile, Electron catalog or user window. Native built-app acceptance is deferred to main's single coordinated build.
- Door map now generated successfully in this worktree: six consumer doors; keep the production boundary at connection projection and existing presentation components. No new manager/state owner.
