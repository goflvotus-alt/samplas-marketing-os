#!/bin/zsh
cd "/Users/binggu/Documents/Codex/2026-06-28/samplas-os-https-www-instagram-com"
clear
echo "SAMPLAS Marketing OS를 실행합니다."
echo ""

if lsof -ti:8787 >/dev/null 2>&1; then
  echo "기존에 켜져 있던 대시보드를 정리하는 중..."
  lsof -ti:8787 | xargs kill >/dev/null 2>&1
  sleep 1
fi

echo "대시보드 주소: http://127.0.0.1:8787"
echo "잠시 후 브라우저가 자동으로 열립니다."
echo ""

(sleep 2 && open "http://127.0.0.1:8787") &
npm start
