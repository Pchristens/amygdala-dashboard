"""A JSON-lines transport for one command's pseudo-terminal."""
import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def main():
    if len(sys.argv) < 2:
        raise SystemExit('usage: ptybridge.py command [args...]')
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        os.execvp(sys.argv[1], sys.argv[1:])
    pending = b''
    stdin_open = True
    try:
        while True:
            ready, _, _ = select.select([fd] + ([0] if stdin_open else []), [], [], 0.1)
            if fd in ready:
                try:
                    data = os.read(fd, 16384)
                except OSError as exc:
                    if exc.errno != errno.EIO:
                        raise
                    break
                if not data:
                    break
                print(json.dumps({'t': 'o', 'd': base64.b64encode(data).decode('ascii')}), flush=True)
            if 0 in ready:
                data = os.read(0, 65536)
                if not data:
                    stdin_open = False
                pending += data
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    try:
                        msg = json.loads(line)
                        if msg.get('t') == 'i':
                            data = base64.b64decode(msg['d'], validate=True)
                            while data:
                                data = data[os.write(fd, data):]
                        elif msg.get('t') == 'r':
                            cols, rows = int(msg['c']), int(msg['r'])
                            if 1 <= cols <= 1000 and 1 <= rows <= 1000:
                                fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
                                os.kill(pid, signal.SIGWINCH)
                    except (ValueError, KeyError, TypeError):
                        pass
            # PTY EOF/EIO follows child exit and lets us drain its final output.
    finally:
        os.close(fd)
        try:
            os.kill(pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)


if __name__ == '__main__':
    main()
