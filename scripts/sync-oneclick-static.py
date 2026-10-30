"""Publish the two existing tutorial scripts to nginx's mounted static directory."""
import hashlib
import json
from pathlib import Path
import paramiko

root = Path(__file__).resolve().parent.parent
manifest_path = root / 'artifacts/oneclick-release.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
release = manifest['release']
backup = f'/opt/workbuddy-prod/backups/{release}/static-before.tgz'
client = paramiko.SSHClient()
client.load_host_keys(str(Path.home() / '.ssh/known_hosts'))
client.connect('47.88.94.164', port=2228, username='root',
               key_filename=str(Path.home() / '.ssh/am-ip94-164-20261028.pem'),
               look_for_keys=False, allow_agent=False, timeout=15)
try:
    _, stdout, stderr = client.exec_command(f"umask 077; cd /opt/workbuddy-prod && test ! -e '{backup}' && tar -czf '{backup}' dist/setup")
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError('Static backup failed; refusing to overwrite')
    with client.open_sftp() as sftp:
        for name in ['workbuddy-setup.ps1', 'workbuddy-setup.sh']:
            source = root / 'public/setup' / name
            target = f'/opt/workbuddy-prod/dist/setup/{name}'
            sftp.put(str(source), target + '.next')
            sftp.chmod(target + '.next', 0o644)
            sftp.posix_rename(target + '.next', target)
            manifest['files'][f'dist/setup/{name}'] = hashlib.sha256(source.read_bytes()).hexdigest()
        for version in ['merge-20261029-230013', release]:
            rollback = f'/opt/workbuddy-prod/backups/{version}/rollback.sh'
            with sftp.open(rollback) as stream:
                text = stream.read().decode('utf-8')
            text = text.replace('docker image tag ', f"tar -xzf '{backup}'\ndocker image tag ", 1)
            with sftp.open(rollback + '.next', 'w') as stream:
                stream.write(text)
            sftp.chmod(rollback + '.next', 0o700)
            sftp.posix_rename(rollback + '.next', rollback)
    manifest['staticBackup'] = backup
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'staticTutorialScriptsPublished': True, 'rollbackIncludesStaticFiles': True}))
finally:
    client.close()
