import { mkdir, unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const testCases = [
  {
    entry: new URL("../tests/layoutEditControl.test.ts", import.meta.url),
    outfile: new URL("../.tmp/layout-edit-control-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/responsivePanelLayout.test.ts", import.meta.url),
    outfile: new URL("../.tmp/responsive-panel-layout-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/panelDropLayout.test.ts", import.meta.url),
    outfile: new URL("../.tmp/panel-drop-layout-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/tiledAgentLayout.test.ts", import.meta.url),
    outfile: new URL("../.tmp/tiled-agent-layout-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/wildPanel.test.ts", import.meta.url),
    outfile: new URL("../.tmp/wild-panel-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/agentHeaderNotice.test.ts", import.meta.url),
    outfile: new URL("../.tmp/agent-header-notice-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/aiCoachLayoutPrivacy.test.ts", import.meta.url),
    outfile: new URL("../.tmp/ai-coach-layout-privacy-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/recommendationPanelStyle.test.ts", import.meta.url),
    outfile: new URL("../.tmp/recommendation-panel-style-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/recommendationApi.test.ts", import.meta.url),
    outfile: new URL("../.tmp/recommendation-api-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/stockDiscoveryPanel.test.ts", import.meta.url),
    outfile: new URL("../.tmp/stock-discovery-panel-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/companyJournalFinancialAggregation.test.ts", import.meta.url),
    outfile: new URL("../.tmp/company-journal-financial-aggregation-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/companyCompareResponsiveFill.test.ts", import.meta.url),
    outfile: new URL("../.tmp/company-compare-responsive-fill-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/companyCompareQualitativePresentation.test.ts", import.meta.url),
    outfile: new URL("../.tmp/company-compare-qualitative-presentation-test.mjs", import.meta.url)
  },
  {
    entry: new URL("../tests/newsKeywordPanel.test.ts", import.meta.url),
    outfile: new URL("../.tmp/news-keyword-panel-test.mjs", import.meta.url)
  }
];
await mkdir(new URL("../.tmp/", import.meta.url), { recursive: true });

try {
  for (const [index, testCase] of testCases.entries()) {
    await build({
      entryPoints: [fileURLToPath(testCase.entry)],
      outfile: fileURLToPath(testCase.outfile),
      bundle: true,
      platform: "node",
      format: "esm",
      sourcemap: false,
      logLevel: "silent"
    });

    await import(`${pathToFileURL(fileURLToPath(testCase.outfile)).href}?t=${Date.now()}-${index}`);
  }
} finally {
  await Promise.all(testCases.map((testCase) => unlink(testCase.outfile).catch(() => undefined)));
}
