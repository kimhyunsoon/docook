#!/usr/bin/env bash
# docook 신규 배포 스크립트 (CentOS 7, root로 실행)
# 사용법: bash server-setup.sh
# 재실행해도 안전하다 (완료된 단계는 건너뜀).
#
# 전제:
#   - dogroo gateway가 이미 운영 중 (docker, 네트워크 gateway, /etc/gateway/*, webhook)
#   - dogroo main에 docook용 gateway 변경(Caddyfile·hooks.json·cf-ddns)이 push되어 있음
#   - docook 리포가 GitHub에 push되어 있고 서버 Deploy Key가 등록되어 있음
set -euo pipefail

DOCOOK_REPO_SSH="git@github.com:kimhyunsoon/docook.git"
DOGROO_DIR="/root/workspace/dogroo"
GATEWAY_DIR="/root/workspace/dogroo/gateway"
DOCOOK_DIR="/root/workspace/docook"
DOCOOK_DATA_DIR="/root/workspace/docook-data"
DOCOOK_DOMAIN="docook.sudosoon.org"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
skip() { printf '    (이미 완료 - 건너뜀)\n'; }

# 실행 중 git reset으로 스크립트 자신이 갱신되어도 안전하도록 전체를 함수로 감싼다
main() {

[[ $EUID -eq 0 ]] || { echo "root로 실행하세요 (sudo -i)"; exit 1; }
docker network inspect gateway >/dev/null 2>&1 \
  || { echo "gateway 네트워크가 없습니다 - dogroo gateway/server-setup.sh를 먼저 실행하세요"; exit 1; }

# ── 1. 리포 최신화 (dogroo gateway) + 클론 (docook) ─────────────────
step "1/6 리포 최신화·클론"
# git 1.8 호환 (FETCH_HEAD 기준으로 최신화)
( cd "$DOGROO_DIR" && git fetch origin main && git reset --hard FETCH_HEAD )
grep -q 'docook-backend' "$GATEWAY_DIR/Caddyfile" \
  || { echo "    ✖ dogroo main에 docook gateway 변경이 없습니다. dogroo를 먼저 push하세요."; exit 1; }
if [[ -d "$DOCOOK_DIR/.git" ]]; then
  ( cd "$DOCOOK_DIR" && git fetch origin main && git reset --hard FETCH_HEAD )
else
  git clone "$DOCOOK_REPO_SSH" "$DOCOOK_DIR"
fi
mkdir -p "$DOCOOK_DATA_DIR"

# ── 2. 시크릿 파일 ─────────────────────────────────────────────────
step "2/6 시크릿 파일"
mkdir -p /etc/docook

# Caddyfile이 기본값 문법이라 caddy 재생성 없이도 동작한다 (다음 재생성부터 이 값이 쓰임)
if ! grep -qs '^DOCOOK_DOMAIN=' /etc/gateway/caddy.env; then
  printf 'DOCOOK_DOMAIN=%s\n' "$DOCOOK_DOMAIN" >> /etc/gateway/caddy.env
fi

if ! grep -qs '^DEPLOY_KEY_DOCOOK=' /etc/gateway/deploy.env; then
  docook_key=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  printf 'DEPLOY_KEY_DOCOOK=%s\n' "$docook_key" >> /etc/gateway/deploy.env
  echo "    docook 배포 키 생성됨 → docook GitHub Secrets의 DEPLOY_KEY로 등록하세요:"
  printf '\033[1;33m    %s\033[0m\n' "$docook_key"
fi

if [[ ! -f /etc/docook/backend.env ]]; then
  read -rp "    docook 로그인 아이디: " app_user
  read -rsp "    docook 로그인 비밀번호: " app_pass; echo
  printf 'INITIAL_USERNAME=%s\nINITIAL_PASSWORD=%s\n' "$app_user" "$app_pass" > /etc/docook/backend.env
fi
chmod 600 /etc/gateway/*.env /etc/docook/*.env
echo "    /etc/docook, /etc/gateway 준비 완료"

# ── 3. Cloudflare DNS - docook A 레코드 (RECORD_NAMES에 포함됨) ─────
step "3/6 Cloudflare DNS"
bash "$GATEWAY_DIR/cf-ddns.sh"

# ── 4. docook 빌드·기동 ────────────────────────────────────────────
step "4/6 docook 빌드·기동 (첫 빌드는 몇 분 걸립니다)"
( cd "$DOCOOK_DIR/deploy" && docker compose up -d --build )

# ── 5. 게이트웨이 반영 ─────────────────────────────────────────────
step "5/6 게이트웨이 반영 (무중단 reload - dogroo·donoti 영향 없음)"
( cd "$GATEWAY_DIR" && docker compose up -d )
docker exec gateway-caddy caddy reload --config /etc/caddy/Caddyfile
sleep 5
docker logs gateway-caddy 2>&1 | grep -i 'certificate obtained' | grep -i docook | tail -1 || true

# ── 6. 웹훅 재시작 (hooks.json·deploy.env 변경 반영) ────────────────
step "6/6 배포 웹훅"
# 새 훅(hooks.json)과 키(deploy.env)는 재시작해야 로드된다 (재실행 시에도 항상 재시작 - 중간 실패 대비)
# 진행 중인 다른 앱 배포가 없을 때 실행할 것
systemctl restart webhook
systemctl is-active webhook >/dev/null && echo "    webhook 실행 중 (:9099, 훅: dogroo·donoti·docook)"

printf '\n\033[1;32m✔ 완료. 남은 일:\033[0m\n'
cat <<EOF
  1. 브라우저 확인: https://${DOCOOK_DOMAIN} (로그인)
  2. docook GitHub Secrets 등록:
     - DEPLOY_URL = https://${DOCOOK_DOMAIN}/deploy/hook
     - DEPLOY_KEY = /etc/gateway/deploy.env 의 DEPLOY_KEY_DOCOOK 값
  3. 배포 테스트: docook push → tail -f /var/log/docook-deploy.log
  4. 앱 설정 > API 토큰을 로컬 docook/backend/.env 의 DOCOOK_URL·DOCOOK_TOKEN에 넣기
EOF
}

main "$@"
