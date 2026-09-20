# Contributing

Start with the [README](README.md) and [architecture](docs/architecture.md). Keep changes focused on one behavior, explain the failure or use case, and include the checks that support the change.

## Development checks

Use Node.js 22 and Python 3.11 on macOS or Linux. Install the client with `npm ci` and the API environment from `backend/requirements.lock.txt`, as described in the README. Then run:

```bash
bash scripts/verify.sh
```

The script uses `backend/.venv/bin/python` when available. Set `RECALLX_PYTHON` to another Python 3.11 interpreter if needed. You can run `bash scripts/verify.sh backend` or `bash scripts/verify.sh client` for a focused check.

The backend checks ignore local environment files, blank provider credentials, use temporary storage, and skip the opt-in checkpoint test. The client checks include TypeScript, Jest, the offline-cache harness, and a static web export. CI runs these same checks on Ubuntu. Native device builds, real model inference, OCR checkpoints, Redis recovery, and browser interaction require their separate environments and are outside routine CI.

## API and data changes

When changing a response schema, regenerate the OpenAPI snapshot and client types with the API interpreter:

```bash
backend/.venv/bin/python backend/scripts/generate_contracts.py
```

Include both `backend/openapi.json` and `src/api/generated.ts`. Add a numbered migration when central storage changes; existing applied migrations have checksums and should remain immutable. Cover retries, conflicting operation IDs, rollback, and offline recovery when a change touches durable state.

## Evidence and public files

Keep measured results connected to a command, configuration, dataset, and limitation. Identify synthetic labels and fixtures clearly. A successful build or controlled test does not establish learning effectiveness or multilingual grading quality.

Check the proposed public files before submitting:

```bash
python3 scripts/check_repository.py
```

This checks the Git index, so files must be staged for the local check to reflect the proposed commit. Keep credentials, learning databases, uploads, downloaded checkpoints, generated native projects, logs, and machine-specific files out of commits. Share minimal synthetic inputs when reporting problems. The check detects common credential formats and file mistakes; it is not a complete secret audit.

## Working after the database history cleanup

The repository’s historical database files were removed on 28 September 2026. Start from a fresh clone, or rebase a local change onto the cleaned history; merging or pushing an old branch can restore the removed database history. The repository check rejects database paths in the current branch’s history, even when they are absent from its latest files. Keep recovery bundles and learner databases outside the tracked repository. See [GitHub’s cleanup guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
