#!/usr/bin/env bash
# Czardas 전환 검증 뒤 legacy Geometry Deployment/CronJob만 명시적으로 제거합니다.
# 기본 실행은 조회만 하며 실제 삭제에는 --apply가 필요합니다.
set -euo pipefail

namespace="${K8S_NAMESPACE:-alfaka-market-data}"
mode="preview"
if [[ "${1:-}" == "--apply" ]]; then
  mode="apply"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--apply]" >&2
  exit 2
fi

resources=(
  deployment/chart-asset-builder
  cronjob/chart-geometry-build
)

echo "Legacy Geometry retirement mode=${mode} namespace=${namespace}"
kubectl get "${resources[@]}" -n "${namespace}" --ignore-not-found

if [[ "${mode}" != "apply" ]]; then
  echo "Preview only. Verify the old queue is drained and Czardas is healthy, then re-run with --apply."
  exit 0
fi

kubectl delete "${resources[@]}" -n "${namespace}" --ignore-not-found --wait=true
echo "Legacy Geometry Deployment and CronJob are absent. Database tables were not touched."
