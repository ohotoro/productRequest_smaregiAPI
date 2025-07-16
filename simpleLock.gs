// ===== 간단한 Lock 시스템 =====

// Lock 획득 시도
function acquireSimpleLock(lockName = 'SYNC_LOCK') {
  const cache = CacheService.getScriptCache();
  const lockKey = `LOCK_${lockName}`;
  
  // 현재 Lock 상태 확인
  const currentLock = cache.get(lockKey);
  
  if (currentLock) {
    console.log(`Lock이 이미 사용 중입니다: ${currentLock}`);
    return false;
  }
  
  // Lock 획득 (10분 동안 유지)
  const lockInfo = {
    timestamp: new Date().toISOString(),
    id: Utilities.getUuid()
  };
  
  cache.put(lockKey, JSON.stringify(lockInfo), 600); // 10분
  console.log(`Lock 획득 성공: ${lockName}`);
  return true;
}

// Lock 해제
function releaseSimpleLock(lockName = 'SYNC_LOCK') {
  const cache = CacheService.getScriptCache();
  const lockKey = `LOCK_${lockName}`;
  
  cache.remove(lockKey);
  console.log(`Lock 해제: ${lockName}`);
}

// Lock을 사용한 동기화 함수 래퍼
function syncIncrementalSalesWithLock() {
  const lockName = 'SALES_SYNC';
  
  // Lock 획득 시도
  if (!acquireSimpleLock(lockName)) {
    console.log('다른 동기화가 진행 중입니다. 이번 실행을 건너뜁니다.');
    return {
      success: false,
      message: '다른 동기화 프로세스가 실행 중'
    };
  }
  
  try {
    // 실제 동기화 실행
    console.log('동기화 시작...');
    const result = syncIncrementalSales();
    
    return {
      success: true,
      result: result
    };
    
  } catch (error) {
    console.error('동기화 중 오류:', error);
    return {
      success: false,
      error: error.toString()
    };
    
  } finally {
    // 항상 Lock 해제
    releaseSimpleLock(lockName);
  }
}

// Properties Service를 사용한 더 안정적인 Lock (선택사항)
function acquirePropertyLock(lockName = 'SYNC_LOCK', maxWaitTime = 30000) {
  const properties = PropertiesService.getScriptProperties();
  const lockKey = `LOCK_${lockName}`;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    const currentLock = properties.getProperty(lockKey);
    
    if (!currentLock) {
      // Lock이 없으면 획득
      const lockInfo = {
        timestamp: new Date().toISOString(),
        id: Utilities.getUuid()
      };
      
      properties.setProperty(lockKey, JSON.stringify(lockInfo));
      console.log(`Property Lock 획득 성공: ${lockName}`);
      return true;
    }
    
    // Lock이 있으면 만료 확인 (10분)
    try {
      const lockData = JSON.parse(currentLock);
      const lockTime = new Date(lockData.timestamp).getTime();
      
      if (Date.now() - lockTime > 600000) { // 10분 경과
        console.log('만료된 Lock을 제거합니다');
        properties.deleteProperty(lockKey);
        continue;
      }
    } catch (e) {
      // 파싱 실패 시 Lock 제거
      properties.deleteProperty(lockKey);
      continue;
    }
    
    // 1초 대기
    Utilities.sleep(1000);
  }
  
  console.log('Lock 획득 시간 초과');
  return false;
}

// Property Lock 해제
function releasePropertyLock(lockName = 'SYNC_LOCK') {
  const properties = PropertiesService.getScriptProperties();
  const lockKey = `LOCK_${lockName}`;
  
  properties.deleteProperty(lockKey);
  console.log(`Property Lock 해제: ${lockName}`);
}

// 기존 함수에 Lock 적용하는 간단한 방법
function syncIncrementalSalesSimpleLock() {
  // Cache 기반 Lock (빠르지만 덜 안정적)
  const cache = CacheService.getScriptCache();
  const lockKey = 'SIMPLE_SYNC_LOCK';
  
  // Lock 확인 및 설정을 원자적으로
  const lockId = Utilities.getUuid();
  const existingLock = cache.get(lockKey);
  
  if (existingLock) {
    console.log('동기화가 이미 실행 중입니다.');
    return;
  }
  
  // Lock 설정 (5분)
  cache.put(lockKey, lockId, 300);
  
  try {
    // 원래 동기화 함수 실행
    syncIncrementalSales();
  } finally {
    // Lock 해제
    cache.remove(lockKey);
  }
}

// Lock 상태 확인 함수
function checkLockStatus() {
  const cache = CacheService.getScriptCache();
  const properties = PropertiesService.getScriptProperties();
  
  console.log('=== Lock 상태 확인 ===');
  
  // Cache Lock 확인
  const cacheLock = cache.get('LOCK_SALES_SYNC');
  console.log('Cache Lock:', cacheLock || '없음');
  
  const simpleLock = cache.get('SIMPLE_SYNC_LOCK');
  console.log('Simple Lock:', simpleLock || '없음');
  
  // Property Lock 확인
  const propLock = properties.getProperty('LOCK_SYNC_LOCK');
  console.log('Property Lock:', propLock || '없음');
  
  console.log('==================');
}

// 모든 Lock 강제 해제 (문제 해결용)
function forceReleaseAllLocks() {
  const cache = CacheService.getScriptCache();
  const properties = PropertiesService.getScriptProperties();
  
  // Cache Locks
  cache.remove('LOCK_SALES_SYNC');
  cache.remove('SIMPLE_SYNC_LOCK');
  cache.remove('LOCK_SYNC_LOCK');
  
  // Property Locks
  const allProps = properties.getProperties();
  Object.keys(allProps).forEach(key => {
    if (key.startsWith('LOCK_')) {
      properties.deleteProperty(key);
    }
  });
  
  console.log('모든 Lock이 해제되었습니다.');
}

// 트리거 설정 시 Lock 적용 버전 사용
function setupSimpleLockTrigger() {
  // 기존 트리거 제거
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncIncrementalSales' ||
        trigger.getHandlerFunction() === 'syncIncrementalSalesWithLock') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Lock이 적용된 버전으로 트리거 생성
  ScriptApp.newTrigger('syncIncrementalSalesWithLock')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  console.log('Lock이 적용된 동기화 트리거가 설정되었습니다.');
}
