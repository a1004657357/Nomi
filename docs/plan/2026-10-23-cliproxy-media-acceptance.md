# CLIProxy media acceptance

Owner: coordinator. Categories: long-running, spend, interruptible.

| Design field | Decision and evidence |
| --- | --- |
| 1 Workflow | Isolated catalog -> certify actual model -> create base image -> enqueue three reference edits -> persist assets -> read back individual canvas nodes. Real existing CLIProxy account; no daily project writes or hidden regeneration. |
| 2 Ownership | Production runtime owns generation and materialization; catalog owns mapping; existing generationProviderScheduler owns queue. Harness only observes and builds isolated fixtures. |
| 3 Reuse | Reuse multimodal-provider.paid.cjs, production certification, runTask, scheduler and project storage. AsyncLocalStorage associates concurrent request receipts with intent, not a global mutable current task. |
| 4 States | Report records queued, submitting, succeeded, partial and failed separately. Unknown transport outcome stops that intent; successful siblings survive. No new UI. |
| 5 Interruption | Before POST cancellation costs nothing; after POST outcome may be unknown and is never resubmitted. Closing/disconnecting/restarting does not replay run roots. Duplicate launch refuses existing receipt. Credentials removed only after child exit; retain assets/receipts. |
| 6 External mismatch | Provider may return dynamic dimensions despite exact size. Preserve original bytes, record requested and decoded dimensions independently; do not resize to claim native compliance. Request counters exclude unknowable proxy internal attempts. |
| 7 Budget | Four generation intents maximum (one base plus three edits), scheduler limit two for this acceptance, 15-minute poll limit. Record elapsed/actual overlap, bytes and SHA. Production default remains four and is not certified by this test. |
| 8 Real conditions | macOS Electron, current CLIProxy account, gpt-image-2. Windows, translated UI, large batches and billed amount unverified. No claim of all upstream models working. |
| 9 Acceptance/rollback | Assert one POST per intent, bounded overlap, actual queue event, distinct files, persistent node-to-asset binding, retained failures and isolated credential cleanup. Independent review before scoped local merge; no remote push. |

Native dimension compliance and transport/materialization success are separate acceptance results. Test results must not collapse partial into passed.
