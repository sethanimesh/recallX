"""Sample aggregate process-tree RSS while running a reproducible local command.

RSS includes shared pages once per process, so the sum is conservative. Sampling
can miss short peaks; this is not a replacement for the OS process high-water mark.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import subprocess
import time


def snapshot(root):
    raw = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,rss=,%cpu='], text=True)
    processes = {}
    for line in raw.splitlines():
        pid, parent, rss, cpu = line.split()
        processes[int(pid)] = (int(parent), int(rss) * 1024, float(cpu))
    descendants = {root}
    while True:
        found = {pid for pid, values in processes.items() if values[0] in descendants}
        if found <= descendants:
            break
        descendants |= found
    values = [processes[pid] for pid in descendants if pid in processes]
    return {'process_count': len(values), 'aggregate_rss_bytes': sum(v[1] for v in values),
            'aggregate_ps_cpu_percent': sum(v[2] for v in values)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--interval', type=float, default=.2)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or args.interval <= 0:
        parser.error('Supply a command and positive sampling interval')
    # Fail before launching models when this environment cannot inspect processes.
    snapshot(-1)
    started_at = datetime.now(timezone.utc).isoformat()
    before = time.monotonic()
    process = subprocess.Popen(command)
    samples = []
    try:
        while process.poll() is None:
            samples.append({'elapsed_seconds': time.monotonic()-before, **snapshot(process.pid)})
            time.sleep(args.interval)
    except BaseException:
        process.terminate()
        process.wait(timeout=10)
        raise
    elapsed = time.monotonic()-before
    report = {'started_at': started_at, 'platform': platform.platform(), 'machine': platform.machine(),
              'command': command, 'exit_code': process.returncode, 'wall_seconds': elapsed,
              'sample_interval_seconds': args.interval, 'sample_count': len(samples),
              'sampled_peak_aggregate_rss_bytes': max((s['aggregate_rss_bytes'] for s in samples), default=0),
              'peak_process_count': max((s['process_count'] for s in samples), default=0),
              'method': 'ps recursive descendant RSS sum, sampled; RSS shared pages can be counted more than once; short peaks can be missed; ps CPU is a decaying process average, not utilization per sampling interval.',
              'samples': samples}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='samples'}, indent=2))
    raise SystemExit(process.returncode)


if __name__ == '__main__':
    main()
