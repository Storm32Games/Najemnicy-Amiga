#!/bin/zsh
# Uruchamia grę "Pył i Rdza — Najemnicy" w przeglądarce (lokalny serwer bez pamięci podręcznej, port 8733).
# Uwaga: nowy port (było 8732), żeby przeglądarka nie użyła starych, zapamiętanych plików gry.
cd "$(dirname "$0")"
(sleep 1; open "http://localhost:8733/index.html?v=$(date +%s)") &
python3 tools/serve.py 8733
