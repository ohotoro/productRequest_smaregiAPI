// Code.gs에 이 함수만 추가하세요
function fixCurrentOrderStockData() {
  const currentOrder = getCurrentOrder();
  if (!currentOrder) {
    return { success: false, message: '열려있는 발주서가 없습니다.' };
  }
  
  const orderId = currentOrder.orderId;
  
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서를 찾을 수 없습니다.' };
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 7) {
      return { success: false, message: '발주 항목이 없습니다.' };
    }
    
    const dataRange = sheet.getRange(7, 1, lastRow - 6, 17);
    const values = dataRange.getValues();
    
    let updatedCount = 0;
    
    for (let i = 0; i < values.length; i++) {
      const requestedQty = Number(values[i][3]) || 0; // D열: 요청수량
      let stockAvailable = String(values[i][11] || '미확인'); // L열: 재고가능여부
      let needsUpdate = false;
      
      // L열 값 정규화 (숫자만 있는 경우)
      if (!isNaN(stockAvailable) && stockAvailable !== '' && stockAvailable !== '미확인') {
        stockAvailable = `${stockAvailable}개만 가능`;
        values[i][11] = stockAvailable; // L열 업데이트
        needsUpdate = true;
      }
      
      // Q열 재계산
      let exportableQty = requestedQty;
      
      if (stockAvailable === '품절') {
        exportableQty = 0;
      } else if (stockAvailable === '오더중') {
        exportableQty = 0;
      } else if (stockAvailable.includes('개만 가능')) {
        const match = stockAvailable.match(/(\d+)개만 가능/);
        if (match) {
          const availableQty = parseInt(match[1]);
          exportableQty = Math.min(availableQty, requestedQty);
        }
      }
      
      // Q열 업데이트 필요 여부 확인
      const currentExportableQty = Number(values[i][16]) || 0;
      if (currentExportableQty !== exportableQty || needsUpdate) {
        values[i][16] = exportableQty;
        updatedCount++;
      }
    }
    
    if (updatedCount > 0) {
      dataRange.setValues(values);
      console.log(`${updatedCount}개 항목이 수정되었습니다.`);
    }
    
    return { 
      success: true, 
      message: `${updatedCount}개 항목이 수정되었습니다.`,
      updatedCount: updatedCount
    };
    
  } catch (error) {
    console.error('발주서 데이터 수정 실패:', error);
    return { success: false, message: error.toString() };
  }
}
