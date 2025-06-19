// ===== 트리거 설정 trigger.gs ===== 
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
    
  console.log('트리거 설정 완료');
}

// ===== 자주 발주 상품 캐시 업데이트 =====
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
    
    // 이메일 알림 (선택사항)
    // MailApp.sendEmail(Session.getActiveUser().getEmail(), 
    //   '발주 시스템 캐시 업데이트 완료', 
    //   `${frequentBarcodes.length}개 자주 발주 상품이 업데이트되었습니다.`);
    
  } catch (error) {
    console.error('캐시 업데이트 실패:', error);
  }
}
