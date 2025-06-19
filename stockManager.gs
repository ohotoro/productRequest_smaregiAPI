// ===== 재고 관리 함수 stockManager.gs =====

// CSV 라인 파싱 - 강력한 버전
function parseCSVLineRobust(line) {
  // Papa Parse 스타일의 CSV 파싱
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  // 전체 줄이 따옴표로 감싸여 있으면 제거
  if (line.startsWith('"') && line.endsWith('"') && line.charAt(1) !== '"') {
    line = line.substring(1, line.length - 1);
  }
  
  while (i < line.length) {
    const char = line[i];
    
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // 이스케이프된 따옴표
          current += '"';
          i += 2;
        } else {
          // 따옴표 종료
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        // 따옴표 시작
        inQuotes = true;
        i++;
      } else if (char === ',') {
        // 필드 구분자
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }
  
  // 마지막 필드
  result.push(current.trim());
  
  return result;
}

// 기존 CSV 라인 파싱 (폴백용)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

// 미입금 수량 추출
function extractUnpaidQuantity(text) {
  if (!text) return 0;
  const match = text.match(/\((\d+)\)/);
  return match ? parseInt(match[1]) : 0;
}

// CSV 파일 파싱 및 재고 정보 처리
function processStockCSV(csvContent, updateType) {
  try {
    // CSV를 줄 단위로 분리
    const lines = csvContent.split(/\r?\n/);
    console.log(`CSV 총 ${lines.length}개 행`);
    
    // 첫 번째 줄(헤더) 확인
    if (lines.length > 0) {
      console.log('첫 번째 줄:', lines[0]);
      
      // 헤더가 예상과 다른 경우 체크
      if (!lines[0].includes('바코드')) {
        console.error('헤더에 "바코드" 컬럼이 없음');
        return {
          success: false,
          error: 'CSV 형식이 올바르지 않습니다. 헤더를 확인해주세요.'
        };
      }
    }
    
    const stockData = {};
    let processedCount = 0;
    let skippedCount = 0;
    
    // 헤더 제외하고 처리
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim() === '') {
        skippedCount++;
        continue;
      }
      
      // CSV 파싱 - 따옴표 처리
      const columns = parseCSVLineWithQuotes(line.trim());
      
      // 디버깅: 처음 3개 행의 파싱 결과 출력
      if (i <= 3) {
        console.log(`행 ${i} 파싱 결과:`, columns);
        console.log(`- 바코드: "${columns[0]}"`);
        console.log(`- 상품명: "${columns[1]}"`);
        console.log(`- 가용재고: "${columns[4]}"`);
      }
      
      // 컬럼 수 확인
      if (columns.length < 9) {
        console.log(`행 ${i}: 컬럼 부족 (${columns.length}개)`);
        skippedCount++;
        continue;
      }
      
      // 바코드 확인
      const barcode = String(columns[0]).trim();
      if (!barcode || barcode === '' || barcode === '바코드') {
        skippedCount++;
        continue;
      }
      
      // 미입금 수량 추출
      const unpaidOrders = extractUnpaidQuantity(columns[5]);
      
      stockData[barcode] = {
        barcode: barcode,
        productName: String(columns[1] || '').trim(),
        option: String(columns[2] || '').trim(),
        currentStock: parseInt(columns[3]) || 0,
        availableStock: parseInt(columns[4]) || 0,
        unpaidQuantity: unpaidOrders,
        unshippedOrders: parseInt(columns[6]) || 0,
        supplierName: String(columns[7] || '').trim(),
        supplierProductName: String(columns[8] || '').trim()
      };
      
      processedCount++;
      
      // 특정 바코드 처리 시 로그
      if (barcode === '1000025023') {
        console.log('1000025023 처리됨:', stockData[barcode]);
      }
    }
    
    console.log(`처리 완료: ${processedCount}개 성공, ${skippedCount}개 스킵`);
    console.log(`전체 재고 데이터 개수: ${Object.keys(stockData).length}`);
    
    // 샘플 데이터 확인
    const sampleKeys = Object.keys(stockData).slice(0, 5);
    console.log('샘플 바코드:', sampleKeys);
    sampleKeys.forEach(key => {
      console.log(`${key}:`, stockData[key]);
    });
    
    if (Object.keys(stockData).length === 0) {
      return {
        success: false,
        error: 'CSV 파일에서 유효한 재고 데이터를 찾을 수 없습니다.'
      };
    }
    
    // 캐시 저장
    invalidateCache(CACHE_KEYS.STOCK_DATA);
    invalidateCache(CACHE_KEYS.STOCK_DATA_TIMESTAMP);
    
    const saveSuccess = setCacheInChunks(CACHE_KEYS.STOCK_DATA, stockData, CACHE_DURATION.MEDIUM);
    setCache(CACHE_KEYS.STOCK_DATA_TIMESTAMP, new Date().toISOString(), CACHE_DURATION.MEDIUM);
    
    console.log(`캐시 저장 결과: ${saveSuccess}`);
    
    // 스프레드시트에 저장
    let saved = false;
    try {
      saved = saveStockDataToSheet(stockData);
    } catch (saveError) {
      console.error('스프레드시트 저장 실패:', saveError);
    }
    
    return {
      success: true,
      itemCount: Object.keys(stockData).length,
      processedCount: processedCount,
      skippedCount: skippedCount,
      updateType: updateType,
      timestamp: new Date().toISOString(),
      saved: saved,
      cached: saveSuccess
    };
    
  } catch (error) {
    console.error('CSV 처리 실패:', error);
    console.error('에러 스택:', error.stack);
    return {
      success: false,
      error: error.toString()
    };
  }
}

function parseCSVLineWithQuotes(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    const nextChar = i + 1 < line.length ? line[i + 1] : null;
    
    if (char === '"') {
      if (inQuotes) {
        // 따옴표 안에서
        if (nextChar === '"') {
          // 이스케이프된 따옴표
          current += '"';
          i += 2;
        } else {
          // 따옴표 종료
          inQuotes = false;
          i++;
        }
      } else {
        // 따옴표 시작
        inQuotes = true;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      // 필드 구분자
      result.push(current.trim());
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }
  
  // 마지막 필드
  result.push(current.trim());
  
  return result;
}

// 재고 데이터 확인용 디버깅 함수
function debugStockData() {
  console.log('=== 재고 데이터 디버깅 ===');
  
  // 캐시 확인
  const cachedData = getCache(CACHE_KEYS.STOCK_DATA);
  if (cachedData) {
    const keys = Object.keys(cachedData);
    console.log(`캐시된 재고 데이터: ${keys.length}개`);
    console.log('처음 10개 바코드:', keys.slice(0, 10));
    
    if (cachedData['1000025023']) {
      console.log('1000025023 데이터:', cachedData['1000025023']);
    }
  } else {
    console.log('캐시된 재고 데이터 없음');
  }
  
  // 시트 확인
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName('재고현황');
    if (sheet) {
      const lastRow = sheet.getLastRow();
      console.log(`재고현황 시트: ${lastRow}개 행`);
      
      if (lastRow > 1) {
        const sampleData = sheet.getRange(2, 1, Math.min(5, lastRow - 1), 4).getValues();
        console.log('샘플 데이터:', sampleData);
      }
    } else {
      console.log('재고현황 시트 없음');
    }
  } catch (e) {
    console.error('시트 확인 실패:', e);
  }
}

// 재고 데이터 로드 (cacheManager 활용)
function loadStockData() {
  try {
    // 청크 캐시 확인
    const cachedData = getCacheInChunks(CACHE_KEYS.STOCK_DATA);
    if (cachedData && Object.keys(cachedData).length > 0) {
      console.log('청크 캐시에서 재고 데이터 로드 성공');
      return cachedData;
    }
    
    // 일반 캐시 확인
    const normalCache = getCache(CACHE_KEYS.STOCK_DATA);
    if (normalCache) {
      console.log('일반 캐시에서 재고 데이터 로드 성공');
      return normalCache;
    }
    
    console.log('캐시에 재고 데이터 없음');
    return null;
  } catch (error) {
    console.error('재고 데이터 로드 실패:', error);
    return null;
  }
}

// 재고 가용성 계산
function calculateStockAvailability(barcode, requestedQty) {
  try {
    console.log(`=== 재고 계산 시작 ===`);
    console.log(`바코드: ${barcode}, 요청수량: ${requestedQty}`);
    
    const stockData = loadStockData();
    
    if (!stockData) {
      console.log('재고 데이터가 없음');
      return {
        status: 'no_data',
        message: '재고 데이터 없음',
        availableQty: 0
      };
    }
    
    console.log(`로드된 재고 데이터 항목 수: ${Object.keys(stockData).length}`);
    
    const stock = stockData[barcode];
    
    if (!stock) {
      console.log(`바코드 ${barcode}의 재고 정보를 찾을 수 없음`);
      return {
        status: 'not_found',
        message: '미확인',
        availableQty: 0
      };
    }
    
    console.log(`재고 정보 찾음:`, stock);
    
    // 안전재고 가져오기
    const safetyStock = getSafetyStockForBarcode(barcode);
    let safetyStockQty = 0;
    
    if (safetyStock) {
      if (safetyStock.type === 'percentage') {
        safetyStockQty = Math.ceil(stock.currentStock * (safetyStock.value / 100));
      } else {
        safetyStockQty = safetyStock.value;
      }
      console.log(`안전재고: ${safetyStockQty}`);
    }
    
    // 실제 가용 수량 계산
    const actualAvailable = Math.max(0, stock.availableStock - stock.unpaidQuantity - safetyStockQty);
    
    console.log(`계산 과정:`);
    console.log(`- 가용재고: ${stock.availableStock}`);
    console.log(`- 미입금수량: ${stock.unpaidQuantity}`);
    console.log(`- 안전재고: ${safetyStockQty}`);
    console.log(`- 실제 가용: ${actualAvailable}`);
    console.log(`- 요청수량: ${requestedQty}`);
    
    // ★★★ 여기가 수정되어야 할 부분 ★★★
    if (actualAvailable >= requestedQty) {
      // actualAvailable이 requestedQty와 정확히 같거나 클 때만 "가능"
      console.log('결과: 가능');
      return {
        status: 'available',
        message: '가능',
        availableQty: actualAvailable,
        requestedQty: requestedQty,
        currentStock: stock.currentStock,
        safetyStock: safetyStockQty
      };
    } else if (actualAvailable > 0) {
      // actualAvailable이 0보다 크지만 requestedQty보다 작을 때
      console.log(`결과: ${actualAvailable}개만 가능`);
      return {
        status: 'partial',
        message: `${actualAvailable}개만 가능`,
        availableQty: actualAvailable,
        requestedQty: requestedQty,
        shortage: requestedQty - actualAvailable,
        currentStock: stock.currentStock,
        safetyStock: safetyStockQty
      };
    } else {
      // actualAvailable이 0 이하일 때
      console.log('결과: 품절');
      return {
        status: 'unavailable',
        message: '품절',
        availableQty: 0,
        requestedQty: requestedQty,
        currentStock: stock.currentStock,
        safetyStock: safetyStockQty
      };
    }
    
  } catch (error) {
    console.error('재고 계산 실패:', error);
    return {
      status: 'error',
      message: '계산 오류',
      availableQty: 0
    };
  }
}

// 발주 항목들의 재고 상태 일괄 업데이트
function updateOrderItemsStock(orderItems, updateType) {
  try {
    const results = [];
    const BATCH_SIZE = 50;
    
    // 필터링된 아이템들
    const filteredItems = orderItems.filter(item => {
      if (updateType === 'confirmed' && item.status !== '확정') return false;
      if (updateType === 'unconfirmed' && item.status === '확정') return false;
      return true;
    });
    
    // 배치로 처리
    for (let i = 0; i < filteredItems.length; i += BATCH_SIZE) {
      const batch = filteredItems.slice(i, Math.min(i + BATCH_SIZE, filteredItems.length));
      
      batch.forEach(item => {
        const stockStatus = calculateStockAvailability(item.barcode, item.quantity);
        
        results.push({
          id: item.id,
          barcode: item.barcode,
          stockStatus: stockStatus
        });
      });
      
      // 메모리 관리를 위한 짧은 대기
      if (i + BATCH_SIZE < filteredItems.length) {
        Utilities.sleep(10);
      }
    }
    
    return results;
    
  } catch (error) {
    console.error('재고 상태 업데이트 실패:', error);
    return [];
  }
}

// 동일 상품 찾기
function findDuplicateItems(orderItems) {
  const duplicates = {};
  
  orderItems.forEach(item => {
    if (!duplicates[item.barcode]) {
      duplicates[item.barcode] = [];
    }
    duplicates[item.barcode].push(item);
  });
  
  // 2개 이상인 바코드만 반환
  const result = {};
  Object.keys(duplicates).forEach(barcode => {
    if (duplicates[barcode].length > 1) {
      result[barcode] = duplicates[barcode];
    }
  });
  
  return result;
}

// 동일 상품 병합
function mergeIdenticalItems(items) {
  if (items.length < 2) return items[0];
  
  // 확정된 항목이 있는지 확인
  const hasConfirmed = items.some(item => item.status === '확정');
  const hasUnconfirmed = items.some(item => item.status !== '확정');
  
  if (hasConfirmed && hasUnconfirmed) {
    return {
      needsConfirmation: true,
      items: items,
      message: '확정/미확정 상품이 섞여있습니다.'
    };
  }
  
  // 병합 실행
  const merged = {
    ...items[0],
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    comment: items.map(item => item.comment).filter(c => c).join(' / '),
    priority: Math.min(...items.map(item => item.priority || 3)),
    id: Date.now() + Math.random()
  };
  
  return {
    needsConfirmation: false,
    merged: merged,
    originalItems: items
  };
}

// 재고 데이터를 스프레드시트에 저장
function saveStockDataToSheet(stockData) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let sheet = ss.getSheetByName('재고현황');
    
    // 시트가 없으면 생성
    if (!sheet) {
      sheet = ss.insertSheet('재고현황');
      const headers = [
        '바코드', '상품명', '옵션', '현재재고', '가용재고', 
        '미입금수량', '미출고수량', '공급사명', '공급사상품명', '업데이트시간'
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold')
        .setBackground('#f0f0f0');
      
      // 컬럼 너비 설정
      const widths = [120, 200, 150, 100, 100, 100, 100, 150, 200, 150];
      widths.forEach((width, index) => {
        sheet.setColumnWidth(index + 1, width);
      });
    }
    
    // 기존 데이터 삭제
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
    
    // 새 데이터 추가
    const rows = Object.values(stockData).map(item => [
      item.barcode,
      item.productName,
      item.option,
      item.currentStock,
      item.availableStock,
      item.unpaidQuantity,
      item.unshippedOrders,
      item.supplierName,
      item.supplierProductName,
      new Date()
    ]);
    
    if (rows.length > 0) {
      // 대량 데이터는 배치로 처리
      const BATCH_SIZE = 1000;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));
        sheet.getRange(2 + i, 1, batch.length, 10).setValues(batch);
      }
    }
    
    console.log(`${rows.length}개 재고 데이터 저장 완료`);
    return true;
    
  } catch (error) {
    console.error('재고 데이터 저장 실패:', error);
    return false;
  }
}

// 저장된 재고 데이터 로드
function loadSavedStockData() {
  try {
    // 먼저 캐시 확인
    const cachedData = loadStockData();
    const timestamp = getCache(CACHE_KEYS.STOCK_DATA_TIMESTAMP);
    
    if (cachedData && timestamp) {
      return {
        data: cachedData,
        updatedAt: timestamp,
        itemCount: Object.keys(cachedData).length,
        source: 'cache'
      };
    }
    
    // 캐시가 없으면 시트에서 로드
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName('재고현황');
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return null;
    }
    
    const data = sheet.getDataRange().getValues();
    const stockData = {};
    
    // 헤더 제외하고 데이터 처리
    for (let i = 1; i < data.length; i++) {
      const barcode = String(data[i][0]);
      stockData[barcode] = {
        barcode: barcode,
        productName: data[i][1],
        option: data[i][2],
        currentStock: data[i][3],
        availableStock: data[i][4],
        unpaidQuantity: data[i][5],
        unshippedOrders: data[i][6],
        supplierName: data[i][7],
        supplierProductName: data[i][8],
        updatedAt: data[i][9]
      };
    }
    
    // 캐시에 저장
    setCache(CACHE_KEYS.STOCK_DATA, stockData, CACHE_DURATION.MEDIUM);
    setCache(CACHE_KEYS.STOCK_DATA_TIMESTAMP, data[1][9], CACHE_DURATION.MEDIUM);
    
    return {
      data: stockData,
      updatedAt: data[1][9],
      itemCount: Object.keys(stockData).length,
      source: 'sheet'
    };
    
  } catch (error) {
    console.error('재고 데이터 로드 실패:', error);
    return null;
  }
}

// 개별 상품 재고 확인
function checkSingleItemStock(barcode) {
  try {
    const stockInfo = loadSavedStockData();
    
    if (!stockInfo) {
      return {
        success: false,
        message: '재고 데이터가 없습니다. CSV를 업로드해주세요.'
      };
    }
    
    const stockData = stockInfo.data[barcode];
    
    if (!stockData) {
      return {
        success: false,
        message: '해당 상품의 재고 정보가 없습니다.'
      };
    }
    
    return {
      success: true,
      source: stockInfo.source,
      data: stockData,
      updatedAt: stockInfo.updatedAt
    };
    
  } catch (error) {
    console.error('개별 재고 확인 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

// 재고 통계 정보
function getStockStatistics() {
  try {
    const stockInfo = loadSavedStockData();
    
    if (!stockInfo) {
      return null;
    }
    
    const stats = {
      totalItems: 0,
      totalStock: 0,
      totalAvailable: 0,
      outOfStock: 0,
      lowStock: 0, // 안전재고 이하
      updatedAt: stockInfo.updatedAt
    };
    
    Object.values(stockInfo.data).forEach(item => {
      stats.totalItems++;
      stats.totalStock += item.currentStock;
      stats.totalAvailable += item.availableStock;
      
      if (item.availableStock <= 0) {
        stats.outOfStock++;
      }
      
      // 안전재고 확인
      const safetyStock = getSafetyStockForBarcode(item.barcode);
      if (safetyStock) {
        const safetyQty = safetyStock.type === 'percentage' ? 
          Math.ceil(item.currentStock * (safetyStock.value / 100)) : 
          safetyStock.value;
          
        if (item.availableStock <= safetyQty) {
          stats.lowStock++;
        }
      }
    });
    
    return stats;
    
  } catch (error) {
    console.error('재고 통계 생성 실패:', error);
    return null;
  }
}
