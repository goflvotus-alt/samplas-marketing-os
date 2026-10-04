#!/bin/zsh
# ECOUNT 상품 최신화 (원클릭): 로컬 ECOUNT sync → Production 업로드 → NEW 브랜드 onboarding.
cd "$(dirname "$0")/.."
clear
echo "ECOUNT 상품 최신화를 시작합니다. (진행 중… 창을 닫지 마세요)"
echo ""
if node scripts/run-ecount-product-sync-and-publish.mjs "$@"; then
  osascript -e 'display notification "Production 반영 완료" with title "ECOUNT 상품 최신화 성공"' >/dev/null 2>&1
  echo "✅ 성공"
else
  osascript -e 'display notification "터미널 창의 오류 내용을 확인하세요" with title "ECOUNT 상품 최신화 실패"' >/dev/null 2>&1
  echo "❌ 실패 — 위 메시지를 확인하세요."
fi
echo ""
read -k 1 "?아무 키나 누르면 창이 닫힙니다."
