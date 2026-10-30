#!/usr/bin/env python3
"""Egress sink for harness anatomy captures (internal-task).

Runs in its own small container on the docker bridge. A harness container
started with --dns <this container's address> sends every name lookup here,
so every outside host the harness tries to reach is logged as one ndjson line.

  sink.py --log /out/egress.ndjson --mode refuse|pass [--upstream 1.1.1.1]

refuse: every A query is answered with this container's own address, and TCP
listeners on the common ports log what arrives (TLS SNI or HTTP Host) and
close the connection, so nothing leaves the machine and every attempt is on
record. AAAA and other query types get an empty answer.
pass: every query is forwarded to --upstream and the answer relayed, so the
harness behaves as in a counted run; only the lookups are logged.

Lines: {"at", "kind": "dns", "qname", "qtype", "src", "answer"} and
{"at", "kind": "tcp", "port", "src", "sni" | "host" | "first_bytes_hex"}.
A line {"kind": "ready", ...} is written once all listeners are up.
"""
import argparse, json, socket, threading, time
from datetime import datetime, timezone

PORTS = [80, 443, 4317, 4318, 8080, 8443]
lock = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat()


def write(path, row):
    with lock, open(path, 'a') as f:
        f.write(json.dumps(row) + '\n')


def parse_qname(data, off=12):
    labels = []
    while off < len(data):
        n = data[off]
        if n == 0:
            off += 1
            break
        if n & 0xC0:
            off += 2
            break
        labels.append(data[off + 1:off + 1 + n].decode('ascii', 'replace'))
        off += 1 + n
    qtype = int.from_bytes(data[off:off + 2], 'big') if off + 2 <= len(data) else 0
    return '.'.join(labels), qtype, off + 4


def answer_self(data, qend, qtype, addr):
    header = bytearray(data[:12])
    header[2] = 0x81 | (data[2] & 0x01)
    header[3] = 0x80
    question = data[12:qend]
    if qtype != 1:
        header[6:8] = (0).to_bytes(2, 'big')
        return bytes(header[:4]) + (1).to_bytes(2, 'big') + (0).to_bytes(6, 'big') + question
    rr = b'\xc0\x0c' + (1).to_bytes(2, 'big') + (1).to_bytes(2, 'big') + (5).to_bytes(4, 'big') + (4).to_bytes(2, 'big') + socket.inet_aton(addr)
    return bytes(header[:4]) + (1).to_bytes(2, 'big') + (1).to_bytes(2, 'big') + (0).to_bytes(4, 'big') + question + rr


def dns_loop(args, own):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(('0.0.0.0', 53))
    while True:
        data, src = s.recvfrom(4096)
        if len(data) < 12:
            continue
        qname, qtype, qend = parse_qname(data)
        if args.mode == 'pass':
            up = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            up.settimeout(5)
            try:
                up.sendto(data, (args.upstream, 53))
                reply, _ = up.recvfrom(4096)
                s.sendto(reply, src)
                answer = 'forwarded'
            except OSError as e:
                answer = 'upstream-failed: %s' % e
            finally:
                up.close()
        else:
            s.sendto(answer_self(data, qend, qtype, own), src)
            answer = own if qtype == 1 else 'empty'
        write(args.log, {'at': now(), 'kind': 'dns', 'qname': qname, 'qtype': qtype, 'src': src[0], 'answer': answer})


def sni(data):
    try:
        if data[0] != 0x16:
            return None
        off = 5 + 4 + 2 + 32
        off += 1 + data[off]
        off += 2 + int.from_bytes(data[off:off + 2], 'big')
        off += 1 + data[off]
        end = off + 2 + int.from_bytes(data[off:off + 2], 'big')
        off += 2
        while off + 4 <= end:
            typ = int.from_bytes(data[off:off + 2], 'big')
            ln = int.from_bytes(data[off + 2:off + 4], 'big')
            if typ == 0:
                return data[off + 9:off + 9 + int.from_bytes(data[off + 7:off + 9], 'big')].decode('ascii', 'replace')
            off += 4 + ln
    except (IndexError, ValueError):
        return None
    return None


def tcp_conn(args, conn, src, port):
    conn.settimeout(3)
    try:
        data = conn.recv(4096)
    except OSError:
        data = b''
    finally:
        conn.close()
    row = {'at': now(), 'kind': 'tcp', 'port': port, 'src': src[0]}
    name = sni(data) if data else None
    if name:
        row['sni'] = name
    elif data.startswith((b'GET ', b'POST ', b'PUT ', b'HEAD ', b'CONNECT ')):
        for line in data.split(b'\r\n'):
            if line.lower().startswith(b'host:'):
                row['host'] = line[5:].strip().decode('ascii', 'replace')
        row['request_line'] = data.split(b'\r\n', 1)[0].decode('ascii', 'replace')[:200]
    else:
        row['first_bytes_hex'] = data[:16].hex()
    write(args.log, row)


def tcp_loop(args, port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('0.0.0.0', port))
    s.listen(64)
    while True:
        conn, src = s.accept()
        threading.Thread(target=tcp_conn, args=(args, conn, src, port), daemon=True).start()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--log', required=True)
    p.add_argument('--mode', choices=['refuse', 'pass'], default='refuse')
    p.add_argument('--upstream', default='1.1.1.1')
    args = p.parse_args()
    own = socket.gethostbyname(socket.gethostname())
    threading.Thread(target=dns_loop, args=(args, own), daemon=True).start()
    if args.mode == 'refuse':
        for port in PORTS:
            threading.Thread(target=tcp_loop, args=(args, port), daemon=True).start()
    time.sleep(0.5)
    write(args.log, {'at': now(), 'kind': 'ready', 'mode': args.mode, 'address': own, 'ports': PORTS if args.mode == 'refuse' else []})
    while True:
        time.sleep(3600)


if __name__ == '__main__':
    main()
