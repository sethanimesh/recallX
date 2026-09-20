"""Check staged public files and HEAD history without displaying private contents."""
from pathlib import Path, PurePosixPath
import posixpath
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 25 * 1024 * 1024
DATABASE_PATH = re.compile(r'\.(?:db|sqlite3?)(?:-(?:wal|shm))?$', re.I)
PRIVATE_DIRECTORIES = {
    'node_modules', 'android', 'ios', '.expo', '.vscode', '__pycache__',
    '.pytest_cache', 'venv', 'dist',
}
ROOT_DIAGNOSTICS = {
    'app copy.json', 'test_json_schema_support.py', 'test_json_schema_support2.py',
    'test_schema4.py', 'tsc_errors.log',
}
SECRET_PATTERNS = [
    re.compile(pattern) for pattern in (
        rb'-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----',
        rb'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b',
        rb'\bgsk_[A-Za-z0-9]{40,}\b',
        rb'\bhf_[A-Za-z0-9]{30,}\b',
        rb'\bAIza[A-Za-z0-9_-]{35}\b',
        rb'\bgithub_pat_[A-Za-z0-9_]{40,}\b',
        rb'\bgh[pousr]_[A-Za-z0-9]{30,}\b',
        rb'\bxox[baprs]-[A-Za-z0-9-]{40,}\b',
    )
]


def git(*arguments, input=None):
    return subprocess.run(
        ['git', '-c', 'core.fsmonitor=false', *arguments], cwd=ROOT,
        input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    ).stdout


def filename_problem(name):
    path = PurePosixPath(name)
    parts = set(path.parts)
    if parts & PRIVATE_DIRECTORIES or any(part.startswith('.venv') for part in parts):
        return 'generated or machine-specific directory'
    if name.startswith(('specs/', 'docs/superpowers/')):
        return 'private planning document'
    if name in ROOT_DIAGNOSTICS or path.name == '.DS_Store':
        return 'local diagnostic or duplicate file'
    if DATABASE_PATH.search(name):
        return 'local database'
    if path.name == '.env' or (path.name.startswith('.env.') and path.name != '.env.example'):
        return 'private environment file'
    if path.name in {'.netrc', 'credentials.json', 'service-account.json', 'id_rsa', 'id_ed25519'}:
        return 'private credential file'
    if path.suffix.lower() in {'.pem', '.key', '.p8', '.p12', '.pfx', '.crt', '.cer', '.jks', '.keystore', '.mobileprovision'}:
        return 'credential or certificate file'
    if path.suffix.lower() in {'.log', '.pyc'} or path.name == 'bootstrap.secret':
        return 'runtime artifact'
    if name.startswith('backend/models/'):
        return 'downloaded model checkpoint'
    return None


def readme_links(name, content, tracked):
    text = re.sub(r'```.*?```', '', content.decode('utf-8'), flags=re.S)
    links = re.findall(r'\]\((<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)', text)
    links += re.findall(r'<(?:img|a)\b[^>]*(?:src|href)=["\']([^"\']+)["\']', text)
    problems = []
    for raw in links:
        parsed = urlsplit(raw.strip('<>'))
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        target = posixpath.normpath(posixpath.join(posixpath.dirname(name), unquote(parsed.path)))
        if target.startswith(('../', '/')) or not (
            target in tracked or any(item.startswith(target.rstrip('/') + '/') for item in tracked)
        ):
            problems.append(f'{name}: local link is absent from the index ({target})')
    return problems


def history_problems():
    if git('rev-parse', '--is-shallow-repository').strip() != b'false':
        return ['HEAD history check requires a full clone; fetch complete history before checking.']
    paths = set()
    for record in git('rev-list', '--objects', 'HEAD').splitlines():
        _, separator, raw_path = record.partition(b' ')
        if separator:
            name = raw_path.decode('utf-8')
            if DATABASE_PATH.search(name):
                paths.add(name)
    return [f'{name}: database remains reachable in HEAD history' for name in sorted(paths)]


def main():
    entries = {}
    problems = history_problems()
    for record in git('ls-files', '--stage', '-z').split(b'\0'):
        if not record:
            continue
        metadata, raw_name = record.split(b'\t', 1)
        _, object_id, stage = metadata.decode().split()
        name = raw_name.decode('utf-8')
        if stage != '0':
            problems.append(f'{name}: unresolved merge entry')
            continue
        entries[name] = object_id

    object_ids = list(dict.fromkeys(entries.values()))
    raw_sizes = git(
        'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)',
        input=('\n'.join(object_ids) + '\n').encode(),
    )
    sizes = {parts[0]: int(parts[2]) for line in raw_sizes.decode().splitlines() if len(parts := line.split()) == 3}
    readmes = {}
    for name, object_id in entries.items():
        if reason := filename_problem(name):
            problems.append(f'{name}: {reason}')
            continue
        if sizes[object_id] > MAX_BYTES:
            problems.append(f'{name}: file exceeds 25 MiB')
            continue
        content = git('cat-file', 'blob', object_id)
        if b'\0' not in content[:8192] and any(pattern.search(content) for pattern in SECRET_PATTERNS):
            problems.append(f'{name}: possible private credential')
        if name.lower() == 'readme.md':
            readmes[name] = content

    for name, content in readmes.items():
        problems.extend(readme_links(name, content, set(entries)))
    if problems:
        print('Public repository check failed:', file=sys.stderr)
        for problem in problems:
            print(f'- {problem}', file=sys.stderr)
        return 1
    print(f'Public repository check passed ({len(entries)} indexed files; full HEAD history checked).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
