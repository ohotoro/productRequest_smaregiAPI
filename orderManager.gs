// ===== 발주 항목 재고 상태 관리 orderManager.gs =====

// 개별 항목 재고 상태 업데이트
function updateItemStockStatus(orderId, itemId, stockStatus) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서를 찾을 수 없습니다.' };
    }
    
    // 데이터 범위 한 번에 가져오기
    const lastRow = sheet.getLastRow();
    if (lastRow < 7) {
      return { success: false, message: '발주 항목이 없습니다.' };
    }
    
    const dataRange = sheet.getRange(7, 1, lastRow - 6, 13);
    const values = dataRange.getValues();
    
    // itemId 파싱 (timestamp_barcode 형식 가정)
    const [timestamp, barcode] = itemId.split('_');
    
    // 해당 항목 찾기
    for (let i = 0; i < values.length; i++) {
      if (matchesItem(values[i], itemId, barcode)) {
        // 재고 상태 업데이트
        values[i][11] = stockStatus; // L열: 재고가능여부
        
        // 변경사항 저장
        dataRange.setValues(values);
        
        // 메타데이터 업데이트
        updateOrderMetadata(sheet, 'stockCheck');
        
        return { 
          success: true, 
          message: '재고 상태가 업데이트되었습니다.',
          updatedAt: new Date().toISOString()
        };
      }
    }
    
    return { success: false, message: '항목을 찾을 수 없습니다.' };
    
  } catch (error) {
    console.error('재고 상태 업데이트 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 일괄 재고 상태 업데이트
function updateBulkStockStatus(orderId, updates) {
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
    
    // 모든 데이터 한 번에 읽기
    const dataRange = sheet.getRange(7, 1, lastRow - 6, 13);
    const values = dataRange.getValues();
    
    // 업데이트 맵 생성 (빠른 검색을 위해)
    const updateMap = new Map();
    updates.forEach(update => {
      updateMap.set(update.barcode, update.stockStatus);
    });
    
    let updatedCount = 0;
    
    // 데이터 업데이트
    for (let i = 0; i < values.length; i++) {
      const barcode = String(values[i][0]);
      if (updateMap.has(barcode)) {
        values[i][11] = updateMap.get(barcode); // L열: 재고가능여부
        updatedCount++;
      }
    }
    
    // 변경사항이 있으면 한 번에 저장
    if (updatedCount > 0) {
      dataRange.setValues(values);
      updateOrderMetadata(sheet, 'stockCheck');
    }
    
    return { 
      success: true, 
      message: `${updatedCount}개 항목이 업데이트되었습니다.`,
      updatedCount: updatedCount,
      totalItems: updates.length
    };
    
  } catch (error) {
    console.error('일괄 재고 상태 업데이트 실패:', error);
    return { success: false, message: error.toString() };
  }
}

function updateOrderItem(itemId) {
  const item = AppState.orderItems.find(i => i.id == itemId);
  if (!item) return;
  
  const orderItemEl = document.querySelector(`[data-id="${itemId}"]`);
  if (!orderItemEl) return;
  
  // 재고 상태 버튼만 업데이트
  const stockBtn = orderItemEl.querySelector('.stock-status-btn');
  if (stockBtn) {
    const stockStatus = getStockStatusDisplay(item.stockAvailable || '미확인');
    stockBtn.className = `stock-status-btn ${stockStatus.class}`;
    stockBtn.innerHTML = `
      <span>${stockStatus.icon}</span>
      <span>${stockStatus.text}</span>
      ${item.stockStatus ? '<span class="csv-indicator">📊</span>' : ''}
    `;
    
    // data-csv-status 속성도 업데이트
    if (item.stockStatus) {
      stockBtn.setAttribute('data-csv-status', item.stockStatus);
    }
  }
  
  // 요약 정보 업데이트
  updateOrderSummary();
}

// 발주서 메타데이터 업데이트
function updateOrderMetadata(sheet, updateType) {
  const now = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm:ss');
  
  switch(updateType) {
    case 'stockCheck':
      sheet.getRange(4, 7).setValue('재고확인:').setFontWeight('bold');
      sheet.getRange(4, 8).setValue(now);
      break;
    case 'save':
      sheet.getRange(4, 5).setValue('최종저장:').setFontWeight('bold');
      sheet.getRange(4, 6).setValue(now);
      break;
    case 'confirm':
      sheet.getRange(4, 9).setValue('확정시간:').setFontWeight('bold');
      sheet.getRange(4, 10).setValue(now);
      break;
  }
}

// 아이템 매칭 헬퍼 함수
function matchesItem(rowData, itemId, barcode) {
  // 기본적으로 바코드로 매칭
  if (barcode && String(rowData[0]) === barcode) {
    return true;
  }
  
  // itemId가 단순 바코드인 경우
  if (String(rowData[0]) === itemId) {
    return true;
  }
  
  // 추가 매칭 로직 필요시 여기에 구현
  return false;
}

// 발주서의 모든 재고 상태 가져오기
function getOrderStockStatus(orderId) {
  try {
    const ss = SpreadsheetApp.openById(orderId);
    const sheet = ss.getSheetByName('발주서');
    
    if (!sheet) {
      return { success: false, message: '발주서를 찾을 수 없습니다.' };
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 7) {
      return { success: true, items: [] };
    }
    
    const data = sheet.getRange(7, 1, lastRow - 6, 13).getValues();
    const stockStatus = [];
    
    data.forEach((row, index) => {
      if (row[0]) { // 바코드가 있는 경우
        stockStatus.push({
          barcode: String(row[0]),
          name: row[1] || '',
          stockStatus: row[11] || '미확인',
          rowIndex: index + 7 // 실제 시트 행 번호
        });
      }
    });
    
    // 메타데이터도 함께 반환
    const metadata = {
      lastSaved: sheet.getRange(4, 6).getValue(),
      lastStockCheck: sheet.getRange(4, 8).getValue(),
      confirmedAt: sheet.getRange(4, 10).getValue()
    };
    
    return { 
      success: true, 
      items: stockStatus,
      metadata: metadata
    };
    
  } catch (error) {
    console.error('재고 상태 조회 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 재고 상태별 통계
function getStockStatusSummary(orderId) {
  try {
    const result = getOrderStockStatus(orderId);
    
    if (!result.success) {
      return result;
    }
    
    const summary = {
      total: result.items.length,
      available: 0,
      unavailable: 0,
      checking: 0,
      unknown: 0
    };
    
    result.items.forEach(item => {
      switch(item.stockStatus) {
        case '재고있음':
        case '가능':
        case 'O':
          summary.available++;
          break;
        case '재고없음':
        case '불가':
        case 'X':
          summary.unavailable++;
          break;
        case '확인중':
        case '문의중':
          summary.checking++;
          break;
        default:
          summary.unknown++;
      }
    });
    
    return {
      success: true,
      summary: summary,
      percentage: {
        available: (summary.available / summary.total * 100).toFixed(1),
        unavailable: (summary.unavailable / summary.total * 100).toFixed(1),
        checking: (summary.checking / summary.total * 100).toFixed(1),
        unknown: (summary.unknown / summary.total * 100).toFixed(1)
      }
    };
    
  } catch (error) {
    console.error('재고 통계 생성 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 재고 없는 항목만 필터링
function getUnavailableItems(orderId) {
  try {
    const result = getOrderStockStatus(orderId);
    
    if (!result.success) {
      return result;
    }
    
    const unavailableItems = result.items.filter(item => 
      ['재고없음', '불가', 'X'].includes(item.stockStatus)
    );
    
    return {
      success: true,
      items: unavailableItems,
      count: unavailableItems.length
    };
    
  } catch (error) {
    console.error('재고 없는 항목 조회 실패:', error);
    return { success: false, message: error.toString() };
  }
}