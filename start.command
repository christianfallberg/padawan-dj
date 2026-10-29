#!/bin/bash
cd "$(dirname "$0")"
echo "Dual Deck Performance: http://localhost:8080"
python3 -m http.server 8080
