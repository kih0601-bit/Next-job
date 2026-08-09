# v101 자체진단 / 심화진단 결과

## 판정
- v100 문법/기본 회귀 테스트: 통과.
- v100 핵심 목표 중 WFPS cache 안정화: 코드상 미완료 결함 확인 후 v101에서 수정.
- UTP cache key migration: 새 fingerprint 규칙과 구 cache entry가 충돌할 수 있는 migration gap 확인 후 v101에서 보강.
- 울주문화재단 verified-single: 정적 로직은 보수 조건(record exact + ROWAREA_RECORD + pagination control 없음)으로 제한됨. 실제 20/20 완료 여부는 Actions HTML/report evidence 필요.
- 근로복지공단 http→https 정규화: 기관 전용 조건으로 제한되어 있으며 정적 검증 통과.

## 확정 원인 1 — WFPS key/fingerprint 불일치
v100은 cache key에서 rotating em_id를 제거했지만 candidateIdentityFingerprint/candidateFingerprint는 원 URL을 계속 사용했다. 따라서 동일 공고의 em_id가 바뀌면 direct key를 찾더라도 reusableCachedOutcome에서 identity-mismatch/fingerprint-changed가 발생할 수 있었다.

## 확정 원인 2 — listText를 stable identity로 사용
v100은 다른 부분에서 listText가 조회수/시간 등 volatile 값을 포함할 수 있어 fingerprint에서 제외한다고 명시하면서 WFPS sourceStableIdentity에서는 listText를 우선 사용했다. 동일 안정성 원칙과 충돌했다.

## 확정 원인 3 — old cache migration 재사용 실패 가능성
과거 cache entry를 새 key로 찾더라도 entry 내부 fingerprint가 old URL 규칙으로 계산되어 있으면 새 candidate fingerprint와 맞지 않는다. lookup 성공 후 reuse 실패가 가능한 구조였다.

## v101 수정
- WFPS cache 판정용 URL에서 em_id만 제거. 실제 수집 URL은 변경하지 않음.
- WFPS listIdentity가 있으면 우선 사용, 없으면 em_id 제거 URL 사용. listText는 identity에서 제외.
- cache key / identity fingerprint / full fingerprint를 sourceStableIdentity 기준으로 통일.
- WFPS detailRequest URL/body의 em_id도 fingerprint 계산에서만 volatile marker로 정규화.
- UTP/WFPS old cache entry는 기관 + 정규화 제목 + durable identity가 모두 일치할 때만 새 fingerprint로 rehydrate.
- 단순 제목 일치 migration은 금지.

## 검증
- collect.mjs syntax: PASS
- pipeline-probe.mjs syntax: PASS
- source-adapters.mjs syntax: PASS
- test-v100-final-stage7.mjs syntax: PASS
- v101 deep-diagnostic regression tests: PASS

## Actions에서만 확정 가능한 항목
- WFPS cacheHits 회복 및 identity-mismatch/fingerprint-changed 감소.
- UTP wr_id cache migration 실효성.
- 20기관 Pagination implementation/current-run 최종 수치.
- 울주문화재단 verified-single 실제 evidence.
- 근로복지공단 실제 상세 접근 성공.
- 전체 20기관 Regression / 실행시간 / Silent Failure 여부.
