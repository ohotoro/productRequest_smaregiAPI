// ===== Lock 시스템 테스트 및 모니터링 =====

// 현재 설정된 트리거 확인
function checkCurrentTriggers() {
  console.log('=== 현재 트리거 목록 ===');
  const triggers = ScriptApp.getProjectTriggers();
  
  if (triggers.length === 0) {
    console.log('설정된 트리거가 없습니다.');
    return;
  }
  
  triggers.forEach((trigger, index) => {
    console.log(`\n트리거 ${index + 1}:`);
    console.log(`  함수: ${trigger.getHandlerFunction()}`);
    console.log(`  타입: ${trigger.getEventType()}`);
    console.log(`  소스: ${trigger.getTriggerSource()}`);
    
    // 시간 기반 트리거인 경우 추가 정보
    if (trigger.getTriggerSource() === ScriptApp.TriggerSource.CLOCK) {
      console.log(`  다음 실행: ${trigger.getEventType()}`);
    }
  });
  
  // syncIncrementalSalesWithLock 트리거 확인
  const lockTrigger = triggers.find(t => 
    t.getHandlerFunction() === 'syncIncrementalSalesWithLock'
  );
  
  if (lockTrigger) {
    console.log('\n✅ Lock이 적용된 동기화 트리거가 활성화되어 있습니다.');
  } else {
    console.log('\n⚠️ Lock이 적용된 동기화 트리거가 없습니다.');
  }
}

// Lock 시스템 테스트
function testLockSystem() {
  console.log('=== Lock 시스템 테스트 시작 ===\n');
  
  // 1. Lock 획득 테스트
  console.log('1. Lock 획득 테스트');
  const lockName = 'TEST_LOCK';
  
  if (acquireSimpleLock(lockName)) {
    console.log('✅ Lock 획득 성공');
    
    // 2. 중복 Lock 시도
    console.log('\n2. 중복 Lock 획득 시도');
    if (!acquireSimpleLock(lockName)) {
      console.log('✅ 중복 Lock 방지 작동');
    } else {
      console.log('❌ 중복 Lock 방지 실패');
    }
    
    // 3. Lock 해제
    console.log('\n3. Lock 해제');
    releaseSimpleLock(lockName);
    console.log('✅ Lock 해제 완료');
    
    // 4. 해제 후 재획득
    console.log('\n4. Lock 재획득 시도');
    if (acquireSimpleLock(lockName)) {
      console.log('✅ Lock 재획득 성공');
      releaseSimpleLock(lockName);
    } else {
      console.log('❌ Lock 재획득 실패');
    }
  } else {
    console.log('❌ 초기 Lock 획득 실패');
  }
  
  console.log('\n=== Lock 시스템 테스트 완료 ===');
}

// 동기화 실행 모니터링
function monitorSyncExecution() {
  console.log('=== 동기화 실행 모니터링 ===\n');
  
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const metaSheet = ss.getSheetByName('Metadata');
  
  if (!metaSheet) {
    console.log('Metadata 시트가 없습니다.');
    return;
  }
  
  // 마지막 동기화 시간 확인
  const lastSyncDate = metaSheet.getRange('B1').getValue();
  console.log(`마지막 동기화: ${lastSyncDate}`);
  
  // 현재 시간과 비교
  const lastSync = new Date(lastSyncDate);
  const now = new Date();
  const diffMinutes = Math.floor((now - lastSync) / 60000);
  
  console.log(`경과 시간: ${diffMinutes}분`);
  
  if (diffMinutes > 10) {
    console.log('⚠️ 10분 이상 동기화가 실행되지 않았습니다.');
  } else {
    console.log('✅ 동기화가 정상적으로 실행되고 있습니다.');
  }
  
  // Lock 상태 확인
  console.log('\n현재 Lock 상태:');
  checkLockStatus();
}

// 수동 동기화 테스트 (Lock 적용)
function testManualSyncWithLock() {
  console.log('=== 수동 동기화 테스트 (Lock 적용) ===\n');
  
  const result = syncIncrementalSalesWithLock();
  
  if (result.success) {
    console.log('✅ 동기화 성공');
    console.log(`결과: ${JSON.stringify(result.result)}`);
  } else {
    console.log('❌ 동기화 실패 또는 건너뜀');
    console.log(`메시지: ${result.message || result.error}`);
  }
}

// 중복 데이터 정리 함수
function removeDuplicatesFromSalesRecent() {
  try {
    console.log('=== Sales_Recent 중복 제거 시작 ===\n');
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName('Sales_Recent');
    
    if (!sheet) {
      console.log('Sales_Recent 시트가 없습니다.');
      return;
    }
    
    const data = sheet.getDataRange().getValues();
    const originalCount = data.length - 1; // 헤더 제외
    
    console.log(`원본 데이터: ${originalCount}행`);
    
    // 중복 제거 (transactionId + barcode 조합)
    const uniqueMap = new Map();
    const uniqueRows = [data[0]]; // 헤더
    let duplicateCount = 0;
    
    for (let i = 1; i < data.length; i++) {
      const transactionId = data[i][0];
      const barcode = data[i][2];
      const key = `${transactionId}_${barcode}`;
      
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, true);
        uniqueRows.push(data[i]);
      } else {
        duplicateCount++;
      }
    }
    
    console.log(`중복 발견: ${duplicateCount}행`);
    
    if (duplicateCount > 0) {
      // 시트 재작성
      sheet.clear();
      sheet.getRange(1, 1, uniqueRows.length, uniqueRows[0].length)
        .setValues(uniqueRows);
      
      console.log(`✅ 중복 제거 완료. 남은 데이터: ${uniqueRows.length - 1}행`);
    } else {
      console.log('✅ 중복 데이터가 없습니다.');
    }
    
  } catch (error) {
    console.error('중복 제거 중 오류:', error);
  }
}

// 종합 상태 확인
function checkOverallSystemStatus() {
  console.log('=== 시스템 종합 상태 확인 ===\n');
  
  // 1. 트리거 확인
  console.log('1. 트리거 상태:');
  checkCurrentTriggers();
  
  // 2. Lock 상태
  console.log('\n2. Lock 상태:');
  checkLockStatus();
  
  // 3. 동기화 모니터링
  console.log('\n3. 동기화 상태:');
  monitorSyncExecution();
  
  // 4. 데이터 무결성
  console.log('\n4. 데이터 무결성:');
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const salesSheet = ss.getSheetByName('Sales_Recent');
  
  if (salesSheet) {
    const rowCount = salesSheet.getLastRow() - 1;
    console.log(`Sales_Recent 데이터: ${rowCount}행`);
    
    // 샘플 중복 체크
    const data = salesSheet.getRange(1, 1, Math.min(1000, salesSheet.getLastRow()), 3).getValues();
    const keys = new Set();
    let sampleDuplicates = 0;
    
    for (let i = 1; i < data.length; i++) {
      const key = `${data[i][0]}_${data[i][2]}`;
      if (keys.has(key)) {
        sampleDuplicates++;
      }
      keys.add(key);
    }
    
    if (sampleDuplicates > 0) {
      console.log(`⚠️ 샘플에서 ${sampleDuplicates}개의 중복 발견`);
    } else {
      console.log('✅ 샘플에서 중복 없음');
    }
  }
  
  console.log('\n=== 상태 확인 완료 ===');
}

// ===== 날짜 형식 문제 해결 및 마이그레이션 =====

// 기존 날짜 형식을 새 형식으로 마이그레이션
function migrateDateFormat() {
  try {
    console.log('=== 날짜 형식 마이그레이션 시작 ===');
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const metaSheet = ss.getSheetByName('Metadata');
    
    if (!metaSheet) {
      console.log('Metadata 시트가 없습니다.');
      return;
    }
    
    // 현재 저장된 값 확인
    const currentValue = metaSheet.getRange('B1').getValue();
    console.log(`현재 값: ${currentValue}`);
    
    // 날짜 형식 판단 및 변환
    let newDate;
    
    if (!currentValue) {
      // 값이 없으면 오늘 날짜로 설정
      newDate = new Date();
      console.log('값이 없어 현재 시간으로 설정');
      
    } else if (typeof currentValue === 'string' && currentValue.includes('T')) {
      // 이미 ISO 형식인 경우
      console.log('이미 ISO 형식입니다. 변경 불필요.');
      return;
      
    } else if (typeof currentValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(currentValue)) {
      // yyyy-MM-dd 형식인 경우
      newDate = new Date(currentValue);
      // 해당 날짜의 23:59:59로 설정 (그날 모든 데이터 포함)
      newDate.setHours(23, 59, 59, 999);
      console.log(`날짜만 있는 형식 발견. ${newDate.toISOString()}로 변환`);
      
    } else if (currentValue instanceof Date) {
      // Date 객체인 경우
      newDate = currentValue;
      console.log(`Date 객체 발견. ${newDate.toISOString()}로 변환`);
      
    } else {
      // 기타 형식
      newDate = new Date(currentValue);
      if (isNaN(newDate.getTime())) {
        // 변환 실패 시 현재 날짜 사용
        newDate = new Date();
        console.log('날짜 변환 실패. 현재 시간으로 설정');
      }
    }
    
    // 새 형식으로 저장
    metaSheet.getRange('B1').setValue(newDate.toISOString());
    console.log(`✅ 날짜 형식 마이그레이션 완료: ${newDate.toISOString()}`);
    
    // 확인
    const savedValue = metaSheet.getRange('B1').getValue();
    console.log(`저장된 값 확인: ${savedValue}`);
    
  } catch (error) {
    console.error('날짜 형식 마이그레이션 오류:', error);
  }
}

// 개선된 모니터링 함수
function improvedMonitorSyncExecution() {
  console.log('=== 개선된 동기화 실행 모니터링 ===\n');
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const metaSheet = ss.getSheetByName('Metadata');
    
    if (!metaSheet) {
      console.log('Metadata 시트가 없습니다.');
      return;
    }
    
    // 마지막 동기화 시간 확인
    const lastSyncValue = metaSheet.getRange('B1').getValue();
    console.log(`저장된 값: ${lastSyncValue}`);
    
    let lastSyncDate;
    if (typeof lastSyncValue === 'string' && lastSyncValue.includes('T')) {
      // ISO 형식
      lastSyncDate = new Date(lastSyncValue);
    } else {
      // 기타 형식
      lastSyncDate = new Date(lastSyncValue);
    }
    
    if (isNaN(lastSyncDate.getTime())) {
      console.log('⚠️ 유효하지 않은 날짜 형식입니다.');
      return;
    }
    
    // 현재 시간과 비교
    const now = new Date();
    const diffMs = now - lastSyncDate;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const remainingMinutes = diffMinutes % 60;
    
    // 읽기 쉬운 형식으로 표시
    const lastSyncKST = Utilities.formatDate(lastSyncDate, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    console.log(`마지막 동기화: ${lastSyncKST} KST`);
    
    if (diffHours > 0) {
      console.log(`경과 시간: ${diffHours}시간 ${remainingMinutes}분`);
    } else {
      console.log(`경과 시간: ${diffMinutes}분`);
    }
    
    // 상태 판단
    if (diffMinutes > 60) {
      console.log('⚠️ 1시간 이상 동기화가 실행되지 않았습니다.');
    } else if (diffMinutes > 10) {
      console.log('⚠️ 10분 이상 동기화가 실행되지 않았습니다.');
    } else {
      console.log('✅ 동기화가 정상적으로 실행되고 있습니다.');
    }
    
    // 현재 시간대 확인
    const currentHour = new Date().getHours();
    if (currentHour >= 22 || currentHour < 7) {
      console.log('ℹ️ 현재는 야간 시간대(22:00-07:00)로 동기화가 일시 중지됩니다.');
    }
    
    // Lock 상태도 함께 확인
    console.log('\n현재 Lock 상태:');
    checkLockStatus();
    
  } catch (error) {
    console.error('모니터링 중 오류:', error);
  }
}

// 동기화 강제 실행 (날짜 형식 수정 후)
function forceSyncAfterFix() {
  console.log('=== 날짜 형식 수정 후 동기화 실행 ===\n');
  
  // 1. 날짜 형식 마이그레이션
  migrateDateFormat();
  
  // 2. 동기화 실행
  console.log('\n동기화 실행 중...');
  const result = syncIncrementalSalesWithLock();
  
  if (result.success) {
    console.log('✅ 동기화 성공');
  } else {
    console.log(`❌ 동기화 실패: ${result.message || result.error}`);
  }
  
  // 3. 결과 확인
  console.log('\n');
  improvedMonitorSyncExecution();
}

// 날짜 형식 테스트
function testDateFormats() {
  console.log('=== 날짜 형식 테스트 ===\n');
  
  // 다양한 날짜 형식 테스트
  const testDates = [
    '2025-01-14',
    '2025-01-14T15:30:00.000Z',
    new Date(),
    new Date('2025-01-14'),
    'Mon Jul 14 2025 00:00:00 GMT+0900 (Korean Standard Time)'
  ];
  
  testDates.forEach((date, index) => {
    console.log(`\n테스트 ${index + 1}: ${date}`);
    console.log(`타입: ${typeof date}`);
    
    const dateObj = new Date(date);
    if (!isNaN(dateObj.getTime())) {
      console.log(`변환 성공: ${dateObj.toISOString()}`);
      console.log(`KST: ${Utilities.formatDate(dateObj, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')}`);
    } else {
      console.log('변환 실패: 유효하지 않은 날짜');
    }
  });
}

// ===== 판매 데이터 검증 도구 =====

// 특정 상품의 판매 데이터를 모든 시트에서 추적
// 입력: barcode 또는 productId (자동 판별)
function validateProductSales(productIdOrBarcode) {
  console.log(`=== 상품 ${productIdOrBarcode} 판매 데이터 검증 ===\n`);
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let totalSales = 0;
    const salesDetails = {
      recent: 0,
      archive: 0,
      summary: 0,
      smaregiData: 0,
      details: []
    };
    
    // SmaregiData에서 바코드/상품ID 매핑 확인
    let barcode = productIdOrBarcode;
    let productId = productIdOrBarcode;
    const smaregiSheet = ss.getSheetByName('SmaregiData');
    if (smaregiSheet && smaregiSheet.getLastRow() > 1) {
      const smaregiData = smaregiSheet.getDataRange().getValues();
      for (let i = 1; i < smaregiData.length; i++) {
        if (String(smaregiData[i][0]) === String(productIdOrBarcode)) {
          // 입력값이 바코드인 경우
          barcode = smaregiData[i][0];
          productId = barcode; // SmaregiData의 A열은 바코드
          console.log(`바코드: ${barcode}`);
          break;
        }
      }
    }
    
    // 1. Sales_Recent 시트 확인 (바코드로 검색)
    console.log('\n1. Sales_Recent 시트 검색 중...');
    const recentSheet = ss.getSheetByName('Sales_Recent');
    if (recentSheet && recentSheet.getLastRow() > 1) {
      const recentData = recentSheet.getDataRange().getValues();
      for (let i = 1; i < recentData.length; i++) {
        if (String(recentData[i][2]) === String(barcode)) {
          const quantity = parseInt(recentData[i][4]) || 0;
          salesDetails.recent += quantity;
          salesDetails.details.push({
            sheet: 'Sales_Recent',
            date: recentData[i][1],
            quantity: quantity,
            transactionId: recentData[i][0]
          });
        }
      }
    }
    console.log(`  Sales_Recent: ${salesDetails.recent}개`);
    
    // 2. Sales_Archive 시트 확인 (바코드로 검색)
    console.log('\n2. Sales_Archive 시트 검색 중...');
    const archiveSheet = ss.getSheetByName('Sales_Archive');
    if (archiveSheet && archiveSheet.getLastRow() > 1) {
      const archiveData = archiveSheet.getDataRange().getValues();
      for (let i = 1; i < archiveData.length; i++) {
        if (String(archiveData[i][2]) === String(barcode)) {
          const quantity = parseInt(archiveData[i][4]) || 0;
          salesDetails.archive += quantity;
          salesDetails.details.push({
            sheet: 'Sales_Archive',
            date: archiveData[i][1],
            quantity: quantity,
            transactionId: archiveData[i][0]
          });
        }
      }
    }
    console.log(`  Sales_Archive: ${salesDetails.archive}개`);
    
    // 3. Recent_Summary 시트 확인 (바코드로 검색)
    console.log('\n3. Recent_Summary 시트 검색 중...');
    const summarySheet = ss.getSheetByName('Recent_Summary');
    if (summarySheet && summarySheet.getLastRow() > 1) {
      const summaryData = summarySheet.getDataRange().getValues();
      for (let i = 1; i < summaryData.length; i++) {
        if (String(summaryData[i][1]) === String(barcode)) {
          const quantity = parseInt(summaryData[i][3]) || 0;
          salesDetails.summary += quantity;
        }
      }
    }
    console.log(`  Recent_Summary: ${salesDetails.summary}개`);
    
    // 4. SmaregiData 시트 확인 (바코드로 검색)
    console.log('\n4. SmaregiData 시트 확인 중...');
    if (smaregiSheet && smaregiSheet.getLastRow() > 1) {
      const smaregiData = smaregiSheet.getDataRange().getValues();
      for (let i = 1; i < smaregiData.length; i++) {
        if (String(smaregiData[i][0]) === String(barcode)) {
          salesDetails.smaregiData = {
            sales30: parseInt(smaregiData[i][3]) || 0,
            sales365: parseInt(smaregiData[i][4]) || 0,
            lastUpdate: smaregiData[i][8]
          };
          console.log(`  30일 판매: ${salesDetails.smaregiData.sales30}개`);
          console.log(`  1년 판매: ${salesDetails.smaregiData.sales365}개`);
          console.log(`  마지막 업데이트: ${salesDetails.smaregiData.lastUpdate}`);
          break;
        }
      }
    }
    
    // 5. 총합 계산
    totalSales = salesDetails.recent + salesDetails.archive;
    console.log(`\n=== 검증 결과 ===`);
    console.log(`실제 총 판매량: ${totalSales}개`);
    console.log(`  - Recent: ${salesDetails.recent}개`);
    console.log(`  - Archive: ${salesDetails.archive}개`);
    console.log(`SmaregiData 1년 판매량: ${salesDetails.smaregiData.sales365}개`);
    console.log(`차이: ${totalSales - salesDetails.smaregiData.sales365}개\n`);
    
    // 6. 날짜별 분포 확인
    if (salesDetails.details.length > 0) {
      console.log('판매 내역 샘플 (최근 10건):');
      salesDetails.details.sort((a, b) => new Date(b.date) - new Date(a.date));
      salesDetails.details.slice(0, 10).forEach(detail => {
        console.log(`  ${detail.date} - ${detail.quantity}개 (${detail.sheet})`);
      });
      
      // 날짜 범위 확인
      const dates = salesDetails.details.map(d => new Date(d.date));
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      console.log(`\n데이터 날짜 범위: ${minDate.toLocaleDateString()} ~ ${maxDate.toLocaleDateString()}`);
    }
    
    return salesDetails;
    
  } catch (error) {
    console.error('판매 데이터 검증 오류:', error);
  }
}

// 판매 데이터 누락 확인
function checkMissingSalesData(startDate, endDate) {
  console.log(`=== ${startDate} ~ ${endDate} 판매 데이터 누락 확인 ===\n`);
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // 날짜별 데이터 존재 여부 확인
    const dateMap = new Map();
    
    // Sales_Recent 확인
    const recentSheet = ss.getSheetByName('Sales_Recent');
    if (recentSheet && recentSheet.getLastRow() > 1) {
      const data = recentSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const date = new Date(data[i][1]);
        const dateStr = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
        if (!dateMap.has(dateStr)) {
          dateMap.set(dateStr, { recent: 0, archive: 0 });
        }
        dateMap.get(dateStr).recent++;
      }
    }
    
    // Sales_Archive 확인
    const archiveSheet = ss.getSheetByName('Sales_Archive');
    if (archiveSheet && archiveSheet.getLastRow() > 1) {
      const data = archiveSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const date = new Date(data[i][1]);
        const dateStr = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
        if (!dateMap.has(dateStr)) {
          dateMap.set(dateStr, { recent: 0, archive: 0 });
        }
        dateMap.get(dateStr).archive++;
      }
    }
    
    // 누락된 날짜 찾기
    const missingDates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
      if (!dateMap.has(dateStr)) {
        missingDates.push(dateStr);
      }
    }
    
    console.log(`데이터가 있는 날짜: ${dateMap.size}일`);
    console.log(`누락된 날짜: ${missingDates.length}일`);
    
    if (missingDates.length > 0) {
      console.log('\n누락된 날짜 목록:');
      missingDates.forEach(date => console.log(`  - ${date}`));
    }
    
    // 날짜별 데이터 분포
    console.log('\n날짜별 데이터 분포:');
    const sortedDates = Array.from(dateMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    sortedDates.slice(-10).forEach(([date, counts]) => {
      console.log(`  ${date}: Recent ${counts.recent}건, Archive ${counts.archive}건`);
    });
    
    return { dateMap, missingDates };
    
  } catch (error) {
    console.error('누락 데이터 확인 오류:', error);
  }
}

// SmaregiData 재계산 (특정 상품)
// 입력: barcode
function recalculateProductSales(barcode) {
  console.log(`=== 상품 ${barcode} 판매량 재계산 ===\n`);
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let sales30 = 0;
    let sales365 = 0;
    
    // 30일 전, 365일 전 날짜 계산
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const yearAgo = new Date(now);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    
    // Sales_Recent에서 집계 (바코드로 검색)
    const recentSheet = ss.getSheetByName('Sales_Recent');
    if (recentSheet && recentSheet.getLastRow() > 1) {
      const data = recentSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][2]) === String(barcode)) {
          const date = new Date(data[i][1]);
          const quantity = parseInt(data[i][4]) || 0;
          
          if (date >= thirtyDaysAgo) {
            sales30 += quantity;
          }
          if (date >= yearAgo) {
            sales365 += quantity;
          }
        }
      }
    }
    
    // Sales_Archive에서 집계 (바코드로 검색)
    const archiveSheet = ss.getSheetByName('Sales_Archive');
    if (archiveSheet && archiveSheet.getLastRow() > 1) {
      const data = archiveSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][2]) === String(barcode)) {
          const date = new Date(data[i][1]);
          const quantity = parseInt(data[i][4]) || 0;
          
          if (date >= yearAgo) {
            sales365 += quantity;
          }
        }
      }
    }
    
    console.log(`재계산 결과:`);
    console.log(`  30일 판매: ${sales30}개`);
    console.log(`  365일 판매: ${sales365}개`);
    
    // SmaregiData 업데이트 (바코드로 검색)
    const smaregiSheet = ss.getSheetByName('SmaregiData');
    if (smaregiSheet) {
      const data = smaregiSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(barcode)) {
          console.log(`\n현재 SmaregiData 값:`);
          console.log(`  30일: ${data[i][3]}개 → ${sales30}개`);
          console.log(`  365일: ${data[i][4]}개 → ${sales365}개`);
          
          // 업데이트 실행
          smaregiSheet.getRange(i + 1, 4).setValue(sales30);
          smaregiSheet.getRange(i + 1, 5).setValue(sales365);
          smaregiSheet.getRange(i + 1, 9).setValue(new Date());
          
          console.log('\n✅ SmaregiData 업데이트 완료');
          break;
        }
      }
    }
    
  } catch (error) {
    console.error('재계산 오류:', error);
  }
}

// 전체 SmaregiData 검증 및 수정
function validateAllSmaregiData() {
  console.log('=== 전체 SmaregiData 검증 시작 ===\n');
  
  try {
    const errors = [];
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const smaregiSheet = ss.getSheetByName('SmaregiData');
    
    if (!smaregiSheet) {
      console.log('SmaregiData 시트가 없습니다.');
      return;
    }
    
    const data = smaregiSheet.getDataRange().getValues();
    const sampleSize = Math.min(10, data.length - 1);
    
    console.log(`검증할 상품 수: ${sampleSize}개 (샘플)`);
    
    for (let i = 1; i <= sampleSize; i++) {
      const productId = data[i][0];
      const stored365 = parseInt(data[i][4]) || 0;
      
      console.log(`\n상품 ${productId} 검증 중...`);
      const validation = validateProductSales(productId);
      
      const actual = validation.recent + validation.archive;
      if (Math.abs(actual - stored365) > 5) { // 5개 이상 차이
        errors.push({
          productId: productId,
          stored: stored365,
          actual: actual,
          diff: actual - stored365
        });
      }
    }
    
    console.log(`\n=== 검증 완료 ===`);
    console.log(`오류 발견: ${errors.length}개`);
    
    if (errors.length > 0) {
      console.log('\n오류 상품 목록:');
      errors.forEach(err => {
        console.log(`  ${err.productId}: 저장값 ${err.stored} vs 실제 ${err.actual} (차이: ${err.diff})`);
      });
    }
    
    return errors;
    
  } catch (error) {
    console.error('전체 검증 오류:', error);
  }
}

// ===== 테스트 함수 =====

// 1000027677 상품 테스트
function test1000027677() {
  console.log('=== 1000027677 상품 판매 데이터 테스트 ===\n');
  validateProductSales('1000027677');
}

// 1000027677 상품 재계산 테스트
function recalculate1000027677() {
  console.log('=== 1000027677 상품 판매량 재계산 ===\n');
  recalculateProductSales('1000027677');
}

// 최근 1년간 누락 데이터 확인
function checkMissingDataLastYear() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 1);
  
  const start = Utilities.formatDate(startDate, 'Asia/Tokyo', 'yyyy-MM-dd');
  const end = Utilities.formatDate(endDate, 'Asia/Tokyo', 'yyyy-MM-dd');
  
  checkMissingSalesData(start, end);
}

// 특정 바코드 리스트 테스트
function testMultipleBarcodes() {
  const barcodes = ['1000027677', '1000027678', '1000027679']; // 테스트할 바코드 목록
  
  barcodes.forEach(barcode => {
    console.log(`\n${'='.repeat(50)}`);
    validateProductSales(barcode);
  });
}
