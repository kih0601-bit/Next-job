# v135 — Annual Volume Count

- 목적: OpenAI 비용 0원으로 전국 연간 공고량/AI 비용 범위를 먼저 확정한다.
- 신규 Workflow: `.github/workflows/nextjob-v2-annual-volume.yml`
- 신규 Runner: `v2-prototype/src/run-annual-volume-count.mjs`
- 신규 Library/Test: annual-volume-lib + annual-volume.test
- Production Engine/UI 변경 없음.
- 법적 원칙: 공식 API의 메타데이터/건수만 측정하며 첨부 원본을 재배포하지 않는다.
- Known limitation: Cleaneye의 2025 historical coverage는 공식 API가 2026년에 공개되어 실제 실행 결과를 별도 해석해야 한다.
