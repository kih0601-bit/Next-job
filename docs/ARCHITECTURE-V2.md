# Next Job Engine v2 — Code-first architecture (v136)

## 공식 상태
- Legacy Pipeline v1의 기존 1~10단계는 **운영/개발 기준에서 퇴역**한다.
- 기관별 홈페이지 Access/List/Detail/Pagination을 Production 핵심 경로로 사용하지 않는다.
- 새로운 주 경로는 **Official API → Normalize → Reconcile → Code Extraction → Evidence/Validation → Deep Resolve → Eligibility → Output** 이다.
- AI는 기본 단계가 아니다. Code/문서분석 후에도 해결되지 않은 케이스의 최후 보조수단이다.

## 오류 책임 원칙
잘못된 Output을 처음 만든 단계가 책임진다. 후단에서 보정하지 않는다.

## Accuracy Gate
자동 테스트의 Green은 완료 판정이 아니다. 실제 API 원문과 예측을 사람 기준으로 대조하여 Correct / Unresolved / Wrong을 판정한다.
Wrong을 숨기기 위해 unknown을 required/none으로 강제하지 않는다.

## v136 Gate
첫 100건 Blind Benchmark는 JOB-ALIO + Cleaneye의 실제 API 응답을 사용한다.
나라일터는 최신 레코드 요청 방식/필드 매핑을 실제 응답으로 검증한 뒤 합류한다.
