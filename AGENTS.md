# Agent 구성 가이드

프로젝트의 자동화 에이전트(트리거)를 설명합니다.

## 📋 개요

Agent는 Google Apps Script의 트리거를 사용해 백그라운드에서 자동 실행되는 작업들입니다.

## 🤖 실제 구현된 에이전트

### 1. 자주 발주 상품 캐시 업데이트
- **파일**: `trigger.gs`
- **함수**: `updateFrequentProductsCache()`
- **주기**: 매일 새벽 2시
- **역할**: 
  - 자주 발주하는 바코드 목록 갱신
  - PropertiesService에 캐시 저장
  - 업데이트 시간 기록

```javascript
// trigger.gs
function setupTriggers() {
  // 기존 트리거 삭제
  ScriptApp.getProjectTriggers().forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  // 매일 새벽 2시에 자주 발주 상품 업데이트
  ScriptApp.newTrigger('updateFrequentProductsCache')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
}
```

### 2. Smaregi 동기화 에이전트
- **파일**: `smaregiManager.gs`
- **함수**: `syncSmaregiData()`
- **실행 타이밍**:
  - **자동**: 30분마다 (트리거)
  - **수동**: "지금 동기화" 버튼 클릭
  - **접속 시**: 웹앱 초기화 시 (캐시가 10분 이상 오래된 경우)
- **역할**:
  - Smaregi API에서 재고 데이터 가져오기
  - 캐시 무효화 (SMAREGI_DATA, DASHBOARD_DATA)
  - 동기화 시간 업데이트
  - 재고 부족 항목 확인

```javascript
// smaregiManager.gs
function setupSmaregiTriggers() {
  // 기존 트리거 삭제
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncSmaregiData') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 30분마다 동기화
  ScriptApp.newTrigger('syncSmaregiData')
    .timeBased()
    .everyMinutes(30)
    .create();
}
```

### 3. 캐시 워밍 에이전트
- **파일**: `advancedCache.gs`
- **함수**: 
  - `scheduledCacheWarming()` - 전체 캐시 워밍
  - `peakTimeCacheWarming()` - 부분 캐시 워밍
- **주기**:
  - 전체: 매일 새벽 3시
  - 부분: 오전 9시, 오후 2시
- **역할**:
  - 자주 사용하는 상품 데이터 미리 캐싱
  - 최근 발주 상품 캐싱
  - 안전재고 설정 상품 캐싱

```javascript
// advancedCache.gs
setupSchedule() {
  // 매일 새벽 3시에 캐시 워밍
  ScriptApp.newTrigger('scheduledCacheWarming')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  
  // 피크 시간 전 캐시 워밍
  ScriptApp.newTrigger('peakTimeCacheWarming')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
  
  ScriptApp.newTrigger('peakTimeCacheWarming')
    .timeBased()
    .everyDays(1)
    .atHour(14)
    .create();
}
```

## ⚙️ 설정 방법

### 모든 트리거 초기 설정
```javascript
// 각 트리거 설정 함수 실행
function setupAllTriggers() {
  setupTriggers();                      // 자주 발주 상품
  setupSmaregiTriggers();               // Smaregi 동기화
  CacheWarmingScheduler.setupSchedule(); // 캐시 워밍
}
```

### 트리거 확인
```javascript
// 현재 설정된 트리거 목록
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    console.log({
      함수: trigger.getHandlerFunction(),
      타입: trigger.getEventType(),
      소스: trigger.getTriggerSource()
    });
  });
}
```

## 📊 동작 확인

### 1. 자주 발주 상품 캐시
```javascript
// 수동 실행으로 테스트
updateFrequentProductsCache();

// 캐시 확인
const props = PropertiesService.getUserProperties();
const cached = props.getProperty('frequentBarcodes');
console.log('캐시된 바코드 수:', JSON.parse(cached).length);
```

### 2. Smaregi 동기화 상태
```javascript
// 마지막 동기화 시간 확인
const scriptProps = PropertiesService.getScriptProperties();
const lastSync = scriptProps.getProperty('SMAREGI_LAST_SYNC');
console.log('마지막 동기화:', lastSync);
```

### 3. 캐시 워밍 결과
```javascript
// 수동 실행으로 테스트
scheduledCacheWarming();

// 캐시 통계 확인
const stats = AdvancedCacheManager.getStats();
console.log('캐시 적중률:', stats.hitRate);
```

## 🚨 문제 해결

### 트리거가 실행되지 않을 때
1. Apps Script 에디터 > 실행 로그 확인
2. 실행 권한 확인
3. 일일 할당량 확인

### 트리거 재설정
```javascript
// 모든 트리거 삭제 후 재설정
function resetAllTriggers() {
  // 모든 트리거 삭제
  ScriptApp.getProjectTriggers()
    .forEach(t => ScriptApp.deleteTrigger(t));
  
  console.log('모든 트리거 삭제 완료');
  
  // 재설정
  setupAllTriggers();
  console.log('트리거 재설정 완료');
}
```

## 💡 실제 구현 예시

### 웹앱 접속 시 동기화
```javascript
// scripts.html - 초기화 시 캐시 확인 및 동기화
async function checkAndSyncSmaregiData() {
  const lastSync = localStorage.getItem('lastSmaregiSync');
  const now = Date.now();
  
  // 10분 이상 지났으면 동기화
  if (!lastSync || (now - parseInt(lastSync)) > 10 * 60 * 1000) {
    console.log('Smaregi 데이터 오래됨, 동기화 시작');
    
    await google.script.run
      .withSuccessHandler((result) => {
        if (result.success) {
          localStorage.setItem('lastSmaregiSync', now.toString());
          console.log('접속 시 동기화 완료');
        }
      })
      .syncSmaregiData();
  }
}

// 초기화 함수에 추가
document.addEventListener('DOMContentLoaded', async function() {
  // ... 기존 초기화 코드
  
  // Smaregi 자동 동기화 체크
  await checkAndSyncSmaregiData();
});
```

### 자주 발주 상품 업데이트 로직
```javascript
// trigger.gs의 실제 구현
function updateFrequentProductsCache() {
  try {
    console.log('자주 발주 상품 캐시 업데이트 시작');
    
    // 자주 발주 바코드 목록 갱신
    const frequentBarcodes = getFrequentProductBarcodes();
    
    // PropertiesService에 저장
    const userProperties = PropertiesService.getUserProperties();
    userProperties.setProperty('frequentBarcodes', JSON.stringify(frequentBarcodes));
    userProperties.setProperty('frequentBarcodesUpdated', new Date().toISOString());
    
    console.log(`${frequentBarcodes.length}개 자주 발주 상품 캐시 완료`);
    
  } catch (error) {
    console.error('캐시 업데이트 실패:', error);
  }
}
```

### Smaregi 동기화 로직
```javascript
// smaregiManager.gs의 실제 구현
function syncSmaregiData() {
  try {
    console.log('=== Smaregi 자동 동기화 시작 ===');
    
    // 재고 데이터 새로고침
    const stockData = getSmaregiStockData();
    if (!stockData.success) {
      console.error('자동 동기화 실패:', stockData.error);
      return;
    }
    
    // 캐시 무효화
    invalidateCache(CACHE_KEYS.SMAREGI_DATA);
    invalidateCache(CACHE_KEYS.DASHBOARD_DATA);
    
    // 동기화 시간 업데이트
    const scriptProps = PropertiesService.getScriptProperties();
    scriptProps.setProperty('SMAREGI_LAST_SYNC', new Date().toISOString());
    
    console.log(`자동 동기화 완료: ${stockData.count}개 항목`);
    
  } catch (error) {
    console.error('자동 동기화 오류:', error);
  }
}
```

## 📝 주의사항

- 트리거는 사용자별로 설정됨
- 실행 시간 제한: 6분
- 일일 실행 할당량 제한 있음
- 동시 실행 방지 로직 필요
- 주석 처리된 이메일 알림 기능은 필요시 활성화 가능
