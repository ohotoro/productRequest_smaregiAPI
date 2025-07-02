// ===== 안전재고 관리 safetyStock.gs =====

// 안전재고 시트 초기화
function initSafetyStockSheet() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let sheet = ss.getSheetByName('안전재고');
    
    if (!sheet) {
      sheet = ss.insertSheet('안전재고');
      const headers = ['바코드', '상품명', '옵션', '안전재고타입', '안전재고값', '등록일', '수정일'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold')
        .setBackground('#f0f0f0');
      
      // 컬럼 너비 설정
      const widths = [120, 200, 150, 100, 100, 120, 120];
      widths.forEach((width, index) => {
        sheet.setColumnWidth(index + 1, width);
      });
    }
    
    return sheet;
  } catch (error) {
    console.error('안전재고 시트 초기화 실패:', error);
    throw error;
  }
}

// 안전재고 설정 저장
function saveSafetyStock(safetyStockData) {
  try {
    const sheet = initSafetyStockSheet();
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    
    // 기존 데이터 찾기
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === safetyStockData.barcode) {
        rowIndex = i + 1;
        break;
      }
    }
    
    const now = new Date();
    const rowData = [
      safetyStockData.barcode,
      safetyStockData.productName || '',
      safetyStockData.option || '',
      safetyStockData.type, // 'quantity' or 'percentage'
      safetyStockData.value,
      rowIndex === -1 ? now : data[rowIndex - 1][5], // 등록일
      now // 수정일
    ];
    
    if (rowIndex === -1) {
      // 새 데이터 추가
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, rowData.length).setValues([rowData]);
    } else {
      // 기존 데이터 수정
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    }
    
    // 캐시 무효화
    invalidateCache(CACHE_KEYS.SAFETY_STOCK);
    invalidateCache(CACHE_KEYS.SAFETY_STOCK_LIST);
    
    return { success: true, message: '안전재고가 저장되었습니다.' };
    
  } catch (error) {
    console.error('안전재고 저장 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 안전재고 조회 (최적화)
function getSafetyStockForBarcode(barcode) {
  try {
    // 전체 맵에서 조회
    const stockMap = getSafetyStockMap();
    return stockMap[barcode] || null;
    
  } catch (error) {
    console.error('안전재고 조회 실패:', error);
    return null;
  }
}

// 안전재고 맵 가져오기 (캐시 활용)
function getSafetyStockMap() {
  try {
    // 캐시 확인
    const cached = getCache(CACHE_KEYS.SAFETY_STOCK);
    if (cached) {
      return cached;
    }
    
    // 시트에서 로드
    const sheet = initSafetyStockSheet();
    const data = sheet.getDataRange().getValues();
    const stockMap = {};
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        stockMap[String(data[i][0])] = {
          barcode: String(data[i][0]),
          productName: data[i][1],
          option: data[i][2],
          type: data[i][3],
          value: Number(data[i][4])
        };
      }
    }
    
    // 캐시 저장
    setCache(CACHE_KEYS.SAFETY_STOCK, stockMap, CACHE_DURATION.MEDIUM);
    
    return stockMap;
    
  } catch (error) {
    console.error('안전재고 맵 로드 실패:', error);
    return {};
  }
}

// 안전재고 목록 조회 (최적화)
function getSafetyStockList() {
  try {
    // 캐시 확인
    const cached = getCache(CACHE_KEYS.SAFETY_STOCK_LIST);
    if (cached) {
      return cached;
    }
    
    // 시트에서 로드
    const sheet = initSafetyStockSheet();
    const lastRow = sheet.getLastRow();
    
    if (lastRow <= 1) {
      return [];
    }
    
    const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    const list = [];
    
    data.forEach(row => {
      if (row[0]) {
        list.push({
          barcode: String(row[0]),
          productName: String(row[1] || ''),
          option: String(row[2] || ''),
          type: String(row[3] || 'quantity'),
          value: Number(row[4]) || 0,
          registeredAt: row[5],
          modifiedAt: row[6]
        });
      }
    });
    
    // 캐시 저장
    setCache(CACHE_KEYS.SAFETY_STOCK_LIST, list, CACHE_DURATION.MEDIUM);
    
    return list;
    
  } catch (error) {
    console.error('안전재고 목록 조회 실패:', error);
    return [];
  }
}

// 안전재고 삭제
function deleteSafetyStock(barcode) {
  try {
    const sheet = initSafetyStockSheet();
    const data = sheet.getDataRange().getValues();
    
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === barcode) {
        sheet.deleteRow(i + 1);
        
        // 캐시 무효화
        invalidateCache(CACHE_KEYS.SAFETY_STOCK);
        invalidateCache(CACHE_KEYS.SAFETY_STOCK_LIST);
        
        return { success: true, message: '안전재고가 삭제되었습니다.' };
      }
    }
    
    return { success: false, message: '해당 상품을 찾을 수 없습니다.' };
    
  } catch (error) {
    console.error('안전재고 삭제 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 안전재고 검색
function searchSafetyStock(query) {
  try {
    if (!query || query.trim().length < 2) return [];
    
    const searchLower = query.toLowerCase();
    const list = getSafetyStockList();
    
    return list.filter(item => 
      item.barcode.toLowerCase().includes(searchLower) ||
      item.productName.toLowerCase().includes(searchLower) ||
      (item.option && item.option.toLowerCase().includes(searchLower))
    ).slice(0, 20);
    
  } catch (error) {
    console.error('안전재고 검색 실패:', error);
    return [];
  }
}

// 안전재고 일괄 업데이트
function bulkUpdateSafetyStock(updates) {
  try {
    const sheet = initSafetyStockSheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    
    // 기존 데이터를 맵으로 변환
    const existingMap = new Map();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        existingMap.set(String(data[i][0]), i + 1);
      }
    }
    
    // 업데이트할 데이터 준비
    const newRows = [];
    const updateRanges = [];
    
    updates.forEach(update => {
      const existingRow = existingMap.get(update.barcode);
      
      if (existingRow) {
        // 기존 데이터 업데이트
        updateRanges.push({
          row: existingRow,
          data: [
            update.barcode,
            update.productName || data[existingRow - 1][1],
            update.option || data[existingRow - 1][2],
            update.type,
            update.value,
            data[existingRow - 1][5], // 등록일 유지
            now
          ]
        });
      } else {
        // 새 데이터
        newRows.push([
          update.barcode,
          update.productName || '',
          update.option || '',
          update.type,
          update.value,
          now,
          now
        ]);
      }
    });
    
    // 업데이트 실행
    updateRanges.forEach(({row, data}) => {
      sheet.getRange(row, 1, 1, data.length).setValues([data]);
    });
    
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length)
        .setValues(newRows);
    }
    
    // 캐시 무효화
    invalidateCache(CACHE_KEYS.SAFETY_STOCK);
    invalidateCache(CACHE_KEYS.SAFETY_STOCK_LIST);
    
    return {
      success: true,
      message: `${updates.length}개 항목이 업데이트되었습니다.`,
      updated: updateRanges.length,
      added: newRows.length
    };
    
  } catch (error) {
    console.error('안전재고 일괄 업데이트 실패:', error);
    return { success: false, message: error.toString() };
  }
}

// 캐싱된 안전재고 조회
function getSafetyStocks() {
  try {
    // 캐시 확인
    const cached = getCache(CACHE_KEYS.SAFETY_STOCK);
    if (cached) {
      return cached;
    }
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName('안전재고');
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return {};
    }
    
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    const safetyStocks = {};
    
    data.forEach(row => {
      if (row[0]) {
        const barcode = String(row[0]);
        const type = row[2];
        const value = row[3];
        
        if (type === 'percentage') {
          safetyStocks[barcode] = { type: 'percentage', value: value };
        } else {
          safetyStocks[barcode] = parseInt(value) || 0;
        }
      }
    });
    
    // 캐시 저장 (5분)
    setCache(CACHE_KEYS.SAFETY_STOCK, safetyStocks, 300);
    
    return safetyStocks;
    
  } catch (error) {
    console.error('안전재고 조회 실패:', error);
    return {};
  }
}

// 안전재고 통계
function getSafetyStockStats() {
  try {
    const list = getSafetyStockList();
    
    const stats = {
      total: list.length,
      byType: {
        quantity: 0,
        percentage: 0
      },
      avgQuantity: 0,
      avgPercentage: 0
    };
    
    let quantitySum = 0;
    let percentageSum = 0;
    
    list.forEach(item => {
      if (item.type === 'quantity') {
        stats.byType.quantity++;
        quantitySum += item.value;
      } else {
        stats.byType.percentage++;
        percentageSum += item.value;
      }
    });
    
    if (stats.byType.quantity > 0) {
      stats.avgQuantity = Math.round(quantitySum / stats.byType.quantity);
    }
    
    if (stats.byType.percentage > 0) {
      stats.avgPercentage = Math.round(percentageSum / stats.byType.percentage);
    }
    
    return stats;
    
  } catch (error) {
    console.error('안전재고 통계 생성 실패:', error);
    return null;
  }
}

function processSafetyStockChanges(changes) {
  try {
    let deletedCount = 0;
    let errors = [];
    
    // 각 변경사항 처리
    changes.forEach(change => {
      try {
        if (change.action === 'delete') {
          const result = deleteSafetyStock(change.barcode);
          if (result.success) {
            deletedCount++;
          } else {
            errors.push(`${change.barcode}: ${result.message}`);
          }
        }
        // 추후 update, add 등 다른 액션도 추가 가능
      } catch (error) {
        errors.push(`${change.barcode}: ${error.toString()}`);
      }
    });
    
    if (errors.length > 0) {
      return {
        success: false,
        message: `일부 항목 처리 실패: ${errors.join(', ')}`
      };
    }
    
    return {
      success: true,
      message: `${deletedCount}개 항목이 삭제되었습니다.`
    };
    
  } catch (error) {
    console.error('안전재고 변경사항 처리 실패:', error);
    return { success: false, message: error.toString() };
  }
}
