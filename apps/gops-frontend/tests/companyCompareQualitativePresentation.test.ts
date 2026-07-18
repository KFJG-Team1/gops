import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildBusinessHighlights,
  buildBusinessModelHighlights,
  buildRevenueHighlights,
  buildRiskHighlights
} from "../src/companyCompare/companyCompareQualitativePresentation";

const nvdaBusiness = {
  kind: "10k-business" as const,
  symbol: "NVDA",
  title: "NVDA 사업 모델",
  summary: "가속 컴퓨팅 기반 팹리스",
  details: [],
  structure: "팹리스 — 설계 전담, 생산 외주",
  segments: [
    { name: "Compute & Networking", detail: "AI 가속기, 데이터센터, 네트워킹" },
    { name: "Graphics", detail: "게이밍 GPU와 시각화" }
  ],
  revenueModel: ["하드웨어 판매"],
  platform: "CUDA 소프트웨어 플랫폼",
  sourceRef: "tenk:NVDA"
};

assert.deepEqual(
  buildBusinessModelHighlights(nvdaBusiness),
  ["팹리스", "설계 전담", "생산 외주"]
);

assert.deepEqual(
  buildBusinessHighlights(nvdaBusiness),
  ["AI 반도체", "데이터센터", "게이밍", "네트워킹", "소프트웨어 플랫폼", "GPU·그래픽"]
);

assert.deepEqual(buildRevenueHighlights(nvdaBusiness), ["하드웨어 판매"]);

const amdBusiness = {
  kind: "10k-business" as const,
  symbol: "AMD",
  title: "AMD 사업 모델",
  summary: "반도체를 설계·개발하며 데이터센터, 클라이언트 PC, 게이밍, 임베디드, FPGA 제품을 판매",
  details: [],
  sourceRef: "tenk:AMD"
};

assert.deepEqual(
  buildBusinessModelHighlights(amdBusiness),
  ["반도체 설계", "제품 판매"]
);

assert.deepEqual(
  buildBusinessHighlights(amdBusiness),
  ["반도체 설계", "데이터센터", "클라이언트 PC", "게이밍", "임베디드", "적응형 컴퓨팅"]
);

assert.deepEqual(buildRevenueHighlights(amdBusiness), ["제품 판매"]);

assert.deepEqual(
  buildRiskHighlights(
    "신제품과 기술을 적시에 출시하거나 생태계를 확장하지 못할 수 있으며, 설계 채택 실패와 인프라 확보 문제, IP 라이선스 통합 실패가 발생할 수 있다."
  ),
  ["신제품 전환·출시 지연", "생태계 경쟁력 약화", "설계 채택 실패"]
);

assert.deepEqual(
  buildRiskHighlights(
    "가격 하락 압력이 커지고 소프트웨어 생태계 경쟁에서 불리할 수 있으며, 고객의 자체 칩 개발과 공급 제약이 이어질 수 있다."
  ),
  ["가격·수요 압박", "생태계 경쟁력 약화", "고객 자체칩 확산"]
);

assert.deepEqual(buildBusinessHighlights(undefined), []);
assert.deepEqual(buildRiskHighlights(""), []);

const panelSource = await readFile(
  new URL("../src/companyCompare/CompanyComparePanelV2.tsx", import.meta.url),
  "utf8"
);
assert.match(panelSource, /matrixRow\("사업 모델"/);
assert.match(panelSource, /matrixRow\("주요 사업"/);
assert.match(panelSource, /matrixRow\("수익 방식"/);

console.info("company comparison qualitative presentation tests passed");
