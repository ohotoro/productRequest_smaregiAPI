# Agent 구성 가이드

이 프로젝트의 자동화 에이전트들을 설명합니다.

## 📋 개요

Agent는 백그라운드에서 실행되는 자동화 작업들로, Google Apps Script의 트리거를 사용해 스케줄링됩니다.

## 🤖 에이전트 종류

### 1. Smaregi 동기화 에이전트
- **함수**: `syncSmaregiData()`
- **주기**: 30분마다
- **역할**: 
  - Smaregi API에서 최신 재고 데이터 가져오기
  - 캐시 무효화 및 갱신
  - 재고 부족 알림 확인

### 2. 캐시 워밍 에이전트
- **함수**: `scheduledCacheWarming()`, `peakTimeCacheWarming()`
- **주기**: 
  - 매일 새벽 3시 (전체)
  - 오전 9시, 오후 2시 (부분)
- **역할**:
  - 자주 사용하는 데이터 미리 캐싱
  - 응답 속도 최적화

### 3. 자주 발주 상품 업데이트
- **함수**: `updateFrequentProductsCache()`
- **주기**: 매일 새벽 2시
- **역할**:
  - 발주 빈도 분석
  - 자주 발주 상품 목록 갱신

## ⚙️ 설정 방법

### 트리거 초기 설정
```javascript
// 모든 트리거 한번에 설정
function setupAllTriggers() {
  setupTriggers();           // 기본 트리거
  setupSmaregiTriggers();    // Smaregi 동기화
  CacheWarmingScheduler.setupSchedule(); // 캐시 워밍
}
```

### 개별 트리거 관리
```javascript
// Smaregi 동기화 간격 변경 (기본: 30분)
function changeSmaregiSyncInterval(minutes) {
  // 기존 트리거 삭제
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncSmaregiData')
    .forEach(t => ScriptApp.deleteTrigger(t));
  
  // 새 트리거 생성
  ScriptApp.newTrigger('syncSmaregiData')
    .timeBased()
    .everyMinutes(minutes)
    .create();
}
```

## 📊 모니터링

### 실행 로그 확인
1. Apps Script 에디터 > 실행 > 로그 확인
2. 각 에이전트는 실행 시 로그 남김

### 실행 상태 확인
```javascript
function checkAgentStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  return triggers.map(trigger => ({
    함수: trigger.getHandlerFunction(),
    타입: trigger.getEventType(),
    다음실행: trigger.getTriggerSource()
  }));
}
```

## 🚨 문제 해결

### 트리거가 실행되지 않을 때
1. Apps Script 실행 할당량 확인
2. 권한 설정 확인
3. 에러 로그 확인

### 재설정
```javascript
// 모든 트리거 제거 후 재설정
function resetAllTriggers() {
  // 모든 트리거 삭제
  ScriptApp.getProjectTriggers()
    .forEach(t => ScriptApp.deleteTrigger(t));
  
  // 재설정
  setupAllTriggers();
}
```

## 📝 주의사항

- 트리거는 사용자별로 설정됨
- 실행 시간 제한: 6분
- 일일 실행 할당량 존재
- 동시 실행 방지 로직 필요

## 🔧 커스터마이징

### 새 에이전트 추가
```javascript
// 예: 일일 리포트 생성 에이전트
function dailyReportAgent() {
  console.log('일일 리포트 생성 시작');
  // 리포트 생성 로직
}

// 트리거 설정
ScriptApp.newTrigger('dailyReportAgent')
  .timeBased()
  .everyDays(1)
  .atHour(22)  // 오후 10시
  .create();
```
