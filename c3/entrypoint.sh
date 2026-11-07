#!/bin/bash
# c3 answers loopback clients only, so it listens on 7901 and socat hands it every connection from 127.0.0.1.
set -e
cd /src/c3
./c3 --no-browser --port 7901 &
until curl -s -o /dev/null http://127.0.0.1:7901/api/status; do sleep 1; done
curl -s -o /dev/null -X POST http://127.0.0.1:7901/api/brokers -H 'Content-Type: application/json' \
  -d "{\"url\":\"${BROKER_URL:-http://coraine:1026}\",\"name\":\"Apetit Coraine\"}"
exec socat TCP-LISTEN:7900,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:7901
