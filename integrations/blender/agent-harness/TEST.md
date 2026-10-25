# Blender Director Harness Tests

Run these tests from the harness root with its isolated virtual environment:

```bash
.venv/bin/python -m pytest cli_anything/blender/tests -q
```

The test split is intentional:

- `test_core.py` covers manifest normalization, bounded director mutations, and
  persisted undo/redo state without starting Blender.
- `test_full_e2e.py` invokes the installed `cli-anything-blender` executable
  across separate subprocesses.  It verifies JSON output, durable state,
  structured errors, and the no-subcommand REPL path.
- Blender backend tests live next to the backend and verify argv construction
  and artifact validation.  A separate manual smoke calls the installed
  Blender executable because that depends on the local Blender runtime.

No test uses a real Nomi project directory.  Temporary project roots are used
for all state and output files.
