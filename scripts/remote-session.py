import json
import getpass
import sys
import time

import paramiko


def main():
    credentials = {'host': sys.argv[1], 'password': getpass.getpass('SSH password: ')}
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    port = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 22
    client.connect(credentials['host'], port=port, username=credentials.get('username', 'root'),
                   password=credentials['password'], timeout=20,
                   allow_agent=False, look_for_keys=False)
    credentials.clear()
    client.get_transport().set_keepalive(20)
    print('SSH connected', flush=True)
    try:
        for line in sys.stdin:
            request = json.loads(line)
            action = request.get('action', 'exec')
            if action == 'close':
                break
            if action in ('upload', 'download'):
                sftp = client.open_sftp()
                try:
                    if action == 'upload':
                        sftp.put(request['local'], request['remote'])
                    else:
                        sftp.get(request['remote'], request['local'])
                    print(json.dumps({'action': action, 'complete': True}), flush=True)
                finally:
                    sftp.close()
                continue
            channel = client.get_transport().open_session()
            channel.exec_command(request['command'])
            deadline = time.monotonic() + request.get('timeout', 600)
            while True:
                while channel.recv_ready():
                    print(channel.recv(32768).decode('utf-8', errors='replace'), end='', flush=True)
                while channel.recv_stderr_ready():
                    print(channel.recv_stderr(32768).decode('utf-8', errors='replace'), end='', flush=True)
                if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
                    break
                if time.monotonic() > deadline:
                    channel.close()
                    raise TimeoutError('Remote command exceeded timeout')
                time.sleep(0.1)
            print(json.dumps({'exitCode': channel.recv_exit_status()}), flush=True)
            channel.close()
    finally:
        client.close()


if __name__ == '__main__':
    main()
