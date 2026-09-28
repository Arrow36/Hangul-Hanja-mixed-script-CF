"""Apply generated SQL chunks remotely with Wrangler, in stable order."""
import argparse
import subprocess
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('database_name')
    parser.add_argument('--local', action='store_true', help='Import into the local Wrangler database')
    args = parser.parse_args()
    files = sorted(args.directory.glob('*.sql'))
    if not files: parser.error('No SQL chunks found')
    checkpoint = args.directory / ('.imported-local' if args.local else '.imported-remote')
    completed = set(checkpoint.read_text().splitlines()) if checkpoint.exists() else set()
    for index, path in enumerate(files, 1):
        if path.name in completed: continue
        print(f'[{index}/{len(files)}] {path}', flush=True)
        subprocess.run(['npx', 'wrangler', 'd1', 'execute', args.database_name,
                        '--local' if args.local else '--remote', '--file', str(path)], check=True)
        with checkpoint.open('a') as stream: stream.write(path.name + '\n')

if __name__ == '__main__': main()
