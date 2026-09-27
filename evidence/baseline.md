# Preserved starting baseline

Revision: 6ea2f3e plus the existing uncommitted TV/navigation changes.
Backup: /private/tmp/recallx-backup-20260928T092928Z (source archive, binary working-tree patch, revision, consistent server SQLite backup).

Before implementation: TypeScript passed; 37 client suites / 313 tests passed, with existing React act warnings. Client tests were ignored by .gitignore; they are now included in source control candidates.

The existing backend/venv had a broken Python 3.13 symlink. A separate backend/.venv now uses downloaded native arm64 Python 3.11.15. The original backend source was extracted into an isolated temporary directory without provider secrets and tested there: 125 passed, 5 failed.

Original failures:
- test_chain_records_llm_call_on_grade_success: test used an uninitialised system_prompts table.
- test_init_db_migrates_old_schema: old migration added mnemonic twice.
- test_parse_llm_response_no_array_raises: expected error text no longer matched parser.
- test_groq_image_extraction: expectation did not account for two-stage vision/text extraction.
- test_groq_word_lookup_uses_text_model_and_lookup_prompt: missing mocked provider key.

This baseline does not establish model quality, OCR compatibility or platform runtime verification.
