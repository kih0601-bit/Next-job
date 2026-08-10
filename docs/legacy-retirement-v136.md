# Legacy v1 retirement register — v136

## RETIRE (운영 중단)
- 기존 기관별 Source Registry 기반 자동 수집
- Access/List/Detail/Pagination 단계의 기관별 운영 성공률을 제품 신뢰도의 기준으로 삼는 방식
- Stage 8 중심 Parser 결과를 사용자 지원가능 판정의 단일 진실로 사용하는 방식
- 기존 update-jobs.yml 예약 실행

## KEEP AS LEGACY ASSET (보존하되 v2 운영경로와 격리)
- PDF/HWP/HWPX 문서 텍스트 추출 도구
- Provenance/Evidence/Reconciliation 설계 원칙
- Regression/Silent Failure 진단 아이디어와 테스트 인프라
- UI/Brand/App icon 및 사용자 설정/검색 UX
- 과거 diagnostics와 patch-history: 회귀 참고용, v2 Ground Truth로 사용 금지

## MIGRATE / REWRITE (새 구현)
- 정부 API Adapter
- Source별 명시적 Field Map
- 공통 Normalized Schema
- Code-only Eligibility parser
- 모집단위/AND-OR 관계 파서
- v2 Output과 사용자 Eligibility Rule Engine

## DELETE LATER (즉시 삭제 금지)
Legacy 자산은 v2가 Production 검증을 통과하기 전까지 물리 삭제하지 않는다. 삭제 시에는 별도 버전에서 사용 참조가 0인지 정적 검색 후 제거한다.
