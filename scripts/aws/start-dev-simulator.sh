#!/usr/bin/env bash
# 역할: dev EKS에서 scale-to-zero 상태의 시뮬레이터 Pod만 켭니다.
set -Eeuo pipefail

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-993099901407}"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
EKS_CLUSTER_NAME="${EKS_CLUSTER_NAME:-gops-eks-cluster}"
K8S_NAMESPACE="${K8S_NAMESPACE:-alfaka-market-data}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

configure_cluster() {
  local actual_account

  actual_account="$(aws sts get-caller-identity --query Account --output text)"
  if [[ "${actual_account}" != "${AWS_ACCOUNT_ID}" ]]; then
    printf 'AWS account mismatch: expected %s, got %s\n' "${AWS_ACCOUNT_ID}" "${actual_account}" >&2
    exit 1
  fi
  aws eks update-kubeconfig --name "${EKS_CLUSTER_NAME}" --region "${AWS_REGION}" >/dev/null
  kubectl get namespace "${K8S_NAMESPACE}" >/dev/null
}

reset_simulator_to_live() {
  local live_payload='{"mode":"live"}'

  kubectl exec deployment/gops-simulator -n "${K8S_NAMESPACE}" -- \
    python -c 'import sys, urllib.request
request = urllib.request.Request(
    "http://127.0.0.1:8765/api/control/mode",
    data=sys.argv[1].encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="PUT",
)
urllib.request.urlopen(request, timeout=2).read()' "${live_payload}"
}

restore_live_path() {
  local exit_code="$1"
  trap - ERR
  set +e

  printf 'Simulator start failed; scaling the optional Pod back to zero.\n' >&2
  kubectl scale deployment/gops-simulator --replicas=0 -n "${K8S_NAMESPACE}"
  exit "${exit_code}"
}

require_command aws
require_command kubectl
configure_cluster
trap 'restore_live_path $?' ERR

kubectl scale deployment/gops-simulator --replicas=1 -n "${K8S_NAMESPACE}"
kubectl rollout status deployment/gops-simulator -n "${K8S_NAMESPACE}" --timeout=180s
reset_simulator_to_live

trap - ERR
printf 'EKS simulator Pod is ready. LIVE→SIM 토글 시 Redis override가 현재 SIP/BOATS 연결을 전환합니다.\n'
printf '종료 후 반드시 AWS_PROFILE=%s scripts/aws/stop-dev-simulator.sh 를 실행하세요.\n' "${AWS_PROFILE:-gops-dev}"
