#!/usr/bin/env bash
# 역할: dev EKS의 Redis feed override를 제거하고 시뮬레이터 Pod를 0개로 내립니다.
set -euo pipefail

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

require_command aws
require_command kubectl
configure_cluster

REDIS_KEY_PREFIX="${REDIS_KEY_PREFIX:-gops:market:on-demand:v1}"
kubectl exec redis-0 -n "${K8S_NAMESPACE}" -- \
  redis-cli DEL "${REDIS_KEY_PREFIX}:simulation:feed-override" >/dev/null
kubectl scale deployment/gops-simulator --replicas=0 -n "${K8S_NAMESPACE}"

printf 'Runtime feed override removed; ingestors return to the real Alpaca session policy and simulator replicas are now 0.\n'
