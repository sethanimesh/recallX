# Sample-data demo

The demo runs the actual browser client and API with eight constructed vocabulary items from [demo-library.json](../examples/demo-library.json). It creates fresh temporary storage every time, blanks generation-provider credentials and disables background dispatch. It needs no Redis, OCR models or grading checkpoints. It does not run document extraction, semantic grading or personalization.

## Run

Install the base API lockfile and JavaScript dependencies, then run from the repository root:

```sh
npm run export:web
backend/.venv/bin/python scripts/demo.py
```

Default addresses are `http://localhost:8877` for the browser and `http://127.0.0.1:8876` for the API. Use `--api-port` and `--web-port` if those ports are occupied. The script checks the ports before startup and stops only the child processes it owns on Ctrl-C. Temporary fixture data and logs remain at the printed location for inspection.

## Walkthrough

1. Open the browser address, then **Settings → Connection and sync**.
2. Save the printed API address. Enter the temporary bootstrap secret in the first-device field and choose **Pair first device**. This secret grants access only to the new demo database.
3. Open **Library**. Eight words should be visible; opening one exposes its definition, example, mnemonic and review controls.
4. Open **Practice → Start Review → Self-rated flashcards** and start a session. Attempt recall before revealing the meaning.
5. Choose **Good** or **Again**. The client should show an acknowledged result and a server-confirmed next-review time before moving to the next card.
6. Open **Shared review history** to inspect the saved attempt. Reload the browser and verify pairing and the cached library persist.

![Paired browser library with eight constructed fixtures](../assets/screenshots/library.png)

*Library screenshot captured from the sample-data deployment on 28 September 2026.*

![Acknowledged self-rated flashcard review](../assets/screenshots/review.png)

*This view demonstrates a server-acknowledged self-rating. It is implementation evidence, not a measured learning outcome.*

For a separate offline recovery sequence, see the [recorded stopped-host browser check](../evidence/web-recovery.md). [Client tests](../src/screens/__tests__) exercise acknowledgement loss, pending reviews and immutable retries without requiring a manual network interruption.
