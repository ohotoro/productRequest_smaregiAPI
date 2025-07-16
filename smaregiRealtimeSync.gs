/**
 * Smaregi 실시간 동기화 - 최적화된 증분 방식
 * 판매 데이터는 증분 동기화, 재고는 온디맨드 실시간 조회
 */

// ===== 판매 데이터 동기화 (증분 방식) =====

// 마지막 동기화 날짜 가져오기
function getLastSyncDate() {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  let metaSheet = ss.getSheetByName('Metadata');
  
  if (!metaSheet) {
    metaSheet = ss.insertSheet('Metadata');
    metaSheet.getRange('A1').setValue('LAST_SYNC_DATE');
    metaSheet.getRange('B1').setValue('2025-01-01'); // 기본값
  }
  
  const lastSync = metaSheet.getRange('B1').getValue();
  return lastSync ? new Date(lastSync) : new Date('2025-01-01');
}

// 마지막 동기화 날짜 저장 (시간 정보 포함)
function saveLastSyncDate(date) {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const metaSheet = ss.getSheetByName('Metadata');
  // ISO 형식으로 전체 날짜/시간 저장
  metaSheet.getRange('B1').setValue(date.toISOString());
}

// 증분 판매 데이터 동기화 (빠른 버전)
function syncIncrementalSales() {
  const startTime = new Date();
  
  // 밤 10시~아침 7시는 동기화 스킵
  const hour = startTime.getHours();
  if (hour >= 22 || hour < 7) {
    console.log('야간 시간대(22:00-07:00) - 동기화 스킵');
    return {
      success: true,
      skipped: true,
      reason: '야간 시간대'
    };
  }
  
  console.log('=== 판매 데이터 증분 동기화 시작 ===');
  
  try {
    // 1. 마지막 동기화 날짜 확인
    const lastSyncDate = getLastSyncDate();
    const today = new Date();
    
    // 오늘 날짜만 포함하도록 시간 설정
    today.setHours(23, 59, 59, 999);
    
    console.log(`동기화 기간: ${Utilities.formatDate(lastSyncDate, 'Asia/Tokyo', 'yyyy-MM-dd')} ~ ${Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd')}`);
    
    // 2. Sales_Recent 시트 준비
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let salesSheet = ss.getSheetByName('Sales_Recent');
    
    if (!salesSheet) {
      salesSheet = ss.insertSheet('Sales_Recent');
      const headers = ['transactionId', 'date', 'barcode', 'productName', 'quantity', 'price', 'storeId'];
      salesSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      salesSheet.setFrozenRows(1);
    }
    
    // 3. 기존 거래 ID 로드 (중복 방지)
    const existingData = salesSheet.getDataRange().getValues();
    const existingTransactionIds = new Set(existingData.slice(1).map(row => row[0]));
    
    // 4. API 설정
    const token = getSmaregiAccessToken();
    const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
    const baseUrl = isProduction 
      ? CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL 
      : CONFIG.PLATFORM_CONFIG.DEV_API_BASE_URL;
    const contractId = isProduction 
      ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID 
      : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID;
    
    // 5. 날짜별로 처리 (증분)
    let totalNewTransactions = 0;
    const newRows = [];
    
    for (let d = new Date(lastSyncDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dateStr = Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy-MM-dd');
      
      try {
        let page = 1;
        let hasMore = true;
        
        while (hasMore) {
          // 거래 목록 조회
          const response = callSmaregiAPI('/transactions', {
            'sum_date-from': dateStr,
            'sum_date-to': dateStr,
            page: page,
            limit: 1000
          });
          
          const transactions = Array.isArray(response) ? response : [];
          
          if (transactions.length === 0) {
            hasMore = false;
            break;
          }
          
          // 새로운 거래만 필터링
          const newTransactions = transactions.filter(t => 
            t.transactionHeadId && !existingTransactionIds.has(t.transactionHeadId)
          );
          
          if (newTransactions.length > 0) {
            // 거래 상세 배치 조회 (10개씩)
            const transactionIds = newTransactions.map(t => t.transactionHeadId);
            
            for (let i = 0; i < transactionIds.length; i += 10) {
              const batch = transactionIds.slice(i, i + 10);
              
              // fetchAll로 병렬 처리
              const requests = batch.map(id => ({
                url: `${baseUrl}${contractId}/pos/transactions/${id}/details`,
                method: 'get',
                headers: {
                  'Authorization': 'Bearer ' + token,
                  'Content-Type': 'application/json'
                },
                muteHttpExceptions: true
              }));
              
              const responses = UrlFetchApp.fetchAll(requests);
              
              responses.forEach((response, idx) => {
                if (response.getResponseCode() === 200) {
                  const details = JSON.parse(response.getContentText());
                  const transactionId = batch[idx];
                  
                  if (Array.isArray(details)) {
                    details.forEach(item => {
                      newRows.push([
                        transactionId,
                        dateStr,
                        item.productId || item.productCode || '',
                        item.productName || '',
                        parseInt(item.quantity) || 0,
                        parseFloat(item.price) || 0,
                        item.storeId || ''
                      ]);
                    });
                  }
                }
              });
              
              // 배치 간 대기
              if (i + 10 < transactionIds.length) {
                Utilities.sleep(300);
              }
            }
            
            totalNewTransactions += newTransactions.length;
          }
          
          if (transactions.length < 1000) {
            hasMore = false;
          } else {
            page++;
          }
        }
        
      } catch (error) {
        console.error(`${dateStr} 처리 중 오류:`, error);
      }
    }
    
    // 6. 새로운 데이터 저장
    if (newRows.length > 0) {
      const lastRow = salesSheet.getLastRow();
      salesSheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
      console.log(`새로운 판매 데이터 ${newRows.length}건 저장`);
    }
    
    // 7. 마지막 동기화 날짜 업데이트
    saveLastSyncDate(today);
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`=== 증분 동기화 완료: ${executionTime}초, ${totalNewTransactions}건 거래 ===`);
    
    // 8. 핫 캐시 업데이트
    updateHotCache();
    
    // 9. 압축 필요 여부 확인
    if (newRows.length > 0) {
      checkCompressionAndRotation();
      
      // 10. SmaregiData 업데이트 (판매된 상품의 재고 + 30일/1년 판매량)
      updateSmaregiDataHybrid(newRows);
    }
    
    return {
      success: true,
      newTransactions: totalNewTransactions,
      newRows: newRows.length,
      executionTime: executionTime
    };
    
  } catch (error) {
    console.error('증분 동기화 오류:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// ===== 재고 실시간 조회 =====

// 전체 재고 데이터 조회 및 캐싱
function getAllStockData() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('allStockData');
  
  if (cached) {
    console.log('캐시된 재고 데이터 사용');
    return JSON.parse(cached);
  }
  
  console.log('전체 재고 데이터 조회 시작...');
  
  try {
    // 전체 재고 조회 (페이징 처리)
    const allStock = [];
    let page = 1;
    let hasMore = true;
    const limit = 1000; // API 최대 제한
    
    while (hasMore) {
      const response = callSmaregiAPI('/stock', { 
        page: page,
        limit: limit
      });
      
      if (Array.isArray(response) && response.length > 0) {
        allStock.push(...response);
        hasMore = response.length === limit;
        page++;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`전체 재고 데이터 조회 완료: ${allStock.length}개 항목`);
    
    // productId별로 재고 합계 계산
    const stockMap = {};
    allStock.forEach(item => {
      const productId = item.productId;
      if (!stockMap[productId]) {
        stockMap[productId] = {
          totalStock: 0,
          stores: []
        };
      }
      stockMap[productId].totalStock += parseInt(item.stockAmount) || 0;
      stockMap[productId].stores.push({
        storeId: item.storeId,
        stock: parseInt(item.stockAmount) || 0
      });
    });
    
    // 5분간 캐싱
    cache.put('allStockData', JSON.stringify(stockMap), 300);
    
    return stockMap;
    
  } catch (error) {
    console.error('전체 재고 조회 오류:', error);
    return {};
  }
}

// productId와 바코드 매핑 정보 가져오기
function getProductIdMapping() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('productIdMapping');
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  console.log('상품 정보에서 바코드-productId 매핑 생성 중...');
  
  // Smaregi API에서 상품 정보 가져오기
  const productInfo = {};
  const mapping = {}; // 바코드 → productId 매핑
  let page = 1;
  let hasMore = true;
  
  try {
    while (hasMore) {
      const response = callSmaregiAPI('/products', {
        page: page,
        limit: 1000,
        fields: 'productId,productCode,productName'
      });
      
      if (response && response.length > 0) {
        response.forEach(product => {
          if (product.productCode && product.productId) {
            // productCode(바코드)를 키로, productId를 값으로 매핑
            mapping[product.productCode] = product.productId;
            productInfo[product.productId] = {
              productCode: product.productCode,
              productName: product.productName || ''
            };
          }
        });
        
        if (response.length < 1000) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`바코드-productId 매핑 완료: ${Object.keys(mapping).length}개`);
    
    // 10분간 캐싱
    cache.put('productIdMapping', JSON.stringify(mapping), 600);
    
    return mapping;
    
  } catch (error) {
    console.error('productId 매핑 생성 오류:', error);
    return {};
  }
}

// 재고 배치 조회 (웹앱용) - 전체 조회 방식으로 변경
function getRealtimeStockBatch(barcodes) {
  try {
    // 1. 전체 재고 데이터 가져오기 (캐시 활용)
    const allStockData = getAllStockData();
    
    // 2. 바코드-productId 매핑 가져오기
    const productIdMapping = getProductIdMapping();
    
    const results = {};
    
    // 3. 각 바코드에 대해 재고 조회
    barcodes.forEach(barcode => {
      const productId = productIdMapping[barcode];
      
      if (productId && allStockData[productId]) {
        const stockInfo = allStockData[productId];
        
        // 30일 판매량 조회 (캐시된 데이터)
        const sales30 = getSales30Days(barcode);
        
        results[barcode] = {
          stock: stockInfo.totalStock,
          sales30: sales30,
          stores: stockInfo.stores,
          lastUpdate: new Date().toISOString()
        };
      } else {
        // 매핑이 없거나 재고 데이터가 없는 경우
        results[barcode] = {
          stock: 0,
          sales30: getSales30Days(barcode),
          error: productId ? false : true,
          errorMessage: productId ? '재고 없음' : 'productId 매핑 없음'
        };
      }
    });
    
    return results;
    
  } catch (error) {
    console.error('재고 배치 조회 오류:', error);
    
    // 오류 시 빈 결과 반환
    const results = {};
    barcodes.forEach(barcode => {
      results[barcode] = {
        stock: 0,
        sales30: 0,
        error: true,
        errorMessage: error.toString()
      };
    });
    
    return results;
  }
}

// 재고 캐시 초기화 (테스트용)
function clearStockCache() {
  const cache = CacheService.getScriptCache();
  cache.remove('allStockData');
  cache.remove('productIdMapping');
  console.log('재고 캐시가 초기화되었습니다.');
}

// 30일 판매량 조회 (캐시)
function getSales30Days(barcode) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(`sales30_${barcode}`);
  
  if (cached) {
    return parseInt(cached);
  }
  
  // Sales_Recent 시트에서 계산
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const salesSheet = ss.getSheetByName('Sales_Recent');
  
  if (!salesSheet) return 0;
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const data = salesSheet.getDataRange().getValues();
  let total = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const date = new Date(row[1]);
    const rowBarcode = row[2];
    const quantity = row[4];
    
    if (rowBarcode === barcode && date >= thirtyDaysAgo) {
      total += quantity;
    }
  }
  
  // 1시간 캐시
  cache.put(`sales30_${barcode}`, total.toString(), 3600);
  
  return total;
}

// ===== 핫 캐시 관리 =====

// 압축 및 로테이션 체크
function checkCompressionAndRotation() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const metaSheet = ss.getSheetByName('Metadata');
    
    if (!metaSheet) {
      console.log('Metadata 시트가 없어 압축/로테이션을 건너뜁니다.');
      return;
    }
    
    // 압축 체크
    if (typeof shouldCompressRecent === 'function' && shouldCompressRecent()) {
      console.log('압축 조건 충족 - 자동 압축 실행');
      if (typeof compressRecentDataSilent === 'function') {
        compressRecentDataSilent();
      }
    }
    
    // 로테이션 체크 (일 1회)
    const lastRotationDate = metaSheet.getRange('B3').getValue();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastRotation = new Date(lastRotationDate || today);
    lastRotation.setHours(0, 0, 0, 0);
    
    if (today > lastRotation) {
      console.log('일일 로테이션 실행');
      if (typeof rotateArchiveData === 'function') {
        rotateArchiveData();
      }
    }
    
  } catch (error) {
    console.error('압축/로테이션 체크 오류:', error);
  }
}

// 핫 캐시 업데이트
function updateHotCache() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const salesSheet = ss.getSheetByName('Sales_Recent');
    
    if (!salesSheet) return;
    
    // 최근 30일 판매 데이터 집계
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const salesData = salesSheet.getDataRange().getValues();
    const productSales = {};
    
    for (let i = 1; i < salesData.length; i++) {
      const row = salesData[i];
      const date = new Date(row[1]);
      
      if (date >= thirtyDaysAgo) {
        const barcode = row[2];
        const quantity = row[4];
        
        if (!productSales[barcode]) {
          productSales[barcode] = {
            name: row[3],
            totalQty: 0,
            frequency: 0
          };
        }
        
        productSales[barcode].totalQty += quantity;
        productSales[barcode].frequency += 1;
      }
    }
    
    // 판매량 기준 상위 300개 선정
    const topProducts = Object.entries(productSales)
      .sort((a, b) => b[1].totalQty - a[1].totalQty)
      .slice(0, 300);
    
    // HotCache 시트 업데이트
    let hotSheet = ss.getSheetByName('HotCache');
    if (!hotSheet) {
      hotSheet = ss.insertSheet('HotCache');
    }
    
    hotSheet.clear();
    const headers = ['barcode', 'name', 'sales30', 'frequency', 'lastUpdate'];
    hotSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    const rows = topProducts.map(([barcode, data]) => [
      barcode,
      data.name,
      data.totalQty,
      data.frequency,
      new Date()
    ]);
    
    if (rows.length > 0) {
      hotSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    
    // PropertiesService에도 저장 (빠른 조회용)
    const hotData = {};
    topProducts.forEach(([barcode, data]) => {
      hotData[barcode] = {
        name: data.name,
        sales30: data.totalQty
      };
    });
    
    PropertiesService.getScriptProperties().setProperty('hotCache', JSON.stringify(hotData));
    
    console.log(`핫 캐시 업데이트 완료: ${topProducts.length}개 상품`);
    
  } catch (error) {
    console.error('핫 캐시 업데이트 오류:', error);
  }
}

// 핫 캐시 데이터 가져오기 (웹앱용)
function getHotCacheData() {
  const cached = PropertiesService.getScriptProperties().getProperty('hotCache');
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  // 시트에서 로드
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const hotSheet = ss.getSheetByName('HotCache');
  
  if (!hotSheet) {
    updateHotCache();
    return {};
  }
  
  const data = hotSheet.getDataRange().getValues();
  const hotData = {};
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    hotData[row[0]] = {
      name: row[1],
      sales30: row[2]
    };
  }
  
  return hotData;
}

// ===== 수동 실행 함수 =====

// 전체 초기화 (첫 실행 시)
function initializeSmaregiData() {
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    '⚠️ Smaregi 데이터 초기화',
    '최근 30일간의 판매 데이터를 수집합니다.\n예상 시간: 30-45초\n\n계속하시겠습니까?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;
  
  try {
    // 30일 전으로 동기화 날짜 설정
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let metaSheet = ss.getSheetByName('Metadata');
    if (!metaSheet) {
      metaSheet = ss.insertSheet('Metadata');
      metaSheet.getRange('A1').setValue('LAST_SYNC_DATE');
    }
    metaSheet.getRange('B1').setValue(Utilities.formatDate(thirtyDaysAgo, 'Asia/Tokyo', 'yyyy-MM-dd'));
    
    // Sales 시트 초기화
    let salesSheet = ss.getSheetByName('Sales');
    if (salesSheet) {
      salesSheet.clear();
      const headers = ['transactionId', 'date', 'barcode', 'productName', 'quantity', 'price', 'storeId'];
      salesSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    
    // 증분 동기화 실행
    const result = syncIncrementalSales();
    
    if (result.success) {
      ui.alert(
        '✅ 초기화 완료',
        `• 실행 시간: ${result.executionTime}초\n• 수집된 거래: ${result.newTransactions}건\n\n이제 5분마다 자동 동기화됩니다.`,
        ui.ButtonSet.OK
      );
    } else {
      ui.alert('❌ 오류', result.error, ui.ButtonSet.OK);
    }
    
  } catch (error) {
    ui.alert('❌ 오류', error.toString(), ui.ButtonSet.OK);
  }
}

// 수동 증분 동기화
function manualSyncSales() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('동기화 중...', '판매 데이터를 동기화하고 있습니다.', ui.ButtonSet.OK);
  
  const result = syncIncrementalSales();
  
  if (result.success) {
    ui.alert(
      '✅ 동기화 완료',
      `• 실행 시간: ${result.executionTime}초\n• 새로운 거래: ${result.newTransactions}건`,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert('❌ 오류', result.error, ui.ButtonSet.OK);
  }
}

// 실시간 동기화 트리거 제거
function removeRealtimeSyncTriggers() {
  const ui = SpreadsheetApp.getUi();
  const triggers = ScriptApp.getProjectTriggers();
  
  let removedCount = 0;
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncIncrementalSales') {
      ScriptApp.deleteTrigger(trigger);
      removedCount++;
    }
  });
  
  if (removedCount > 0) {
    ui.alert('✅ 완료', `실시간 동기화가 중지되었습니다.\n(${removedCount}개 트리거 제거)`, ui.ButtonSet.OK);
  } else {
    ui.alert('ℹ️ 정보', '실행 중인 실시간 동기화가 없습니다.', ui.ButtonSet.OK);
  }
}

// 트리거 설정
function setupRealtimeSyncTriggers() {
  // 기존 트리거 제거
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncIncrementalSales') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 5분마다 증분 동기화
  ScriptApp.newTrigger('syncIncrementalSales')
    .timeBased()
    .everyMinutes(5)
    .create();
    
  SpreadsheetApp.getUi().alert(
    '✅ 자동 동기화 설정 완료',
    '5분마다 판매 데이터가 자동으로 동기화됩니다.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ===== 테스트 함수 =====

// Smaregi 연결 테스트
function testSmaregiConnection() {
  try {
    console.log('=== Smaregi 연결 테스트 시작 ===');
    console.log('환경:', CONFIG.PLATFORM_CONFIG.USE_PRODUCTION ? '본번' : '개발');
    
    // 1. 토큰 발급 테스트
    console.log('\n1. 토큰 발급 테스트...');
    const token = getSmaregiAccessToken();
    console.log('✅ 토큰 발급 성공');
    console.log('토큰 길이:', token.length);
    
    // 2. 상품 조회 테스트
    console.log('\n2. 상품 API 테스트...');
    const productResult = callSmaregiAPI('/products', { limit: 1 });
    console.log('✅ 상품 조회 성공');
    console.log('응답:', JSON.stringify(productResult).substring(0, 200) + '...');
    
    // 3. 재고 조회 테스트
    console.log('\n3. 재고 API 테스트...');
    const stockResult = callSmaregiAPI('/stock', { limit: 1 });
    console.log('✅ 재고 조회 성공');
    console.log('응답:', JSON.stringify(stockResult).substring(0, 200) + '...');
    
    // 4. 거래 조회 테스트
    console.log('\n4. 거래 API 테스트...');
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const transactionResult = callSmaregiAPI('/transactions', { 
      'sum_date-from': today,
      'sum_date-to': today,
      limit: 1 
    });
    console.log('✅ 거래 조회 성공');
    console.log('응답:', JSON.stringify(transactionResult).substring(0, 200) + '...');
    
    console.log('\n=== 모든 테스트 통과! ===');
    return {
      success: true,
      message: '모든 API 테스트를 통과했습니다!'
    };
    
  } catch (error) {
    console.error('\n❌ 테스트 실패:', error);
    console.error('에러 상세:', error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

// 동기화 성능 확인
function checkSyncPerformance() {
  console.log('=== 동기화 성능 테스트 ===');
  const startTime = new Date();
  
  const result = syncIncrementalSales();
  
  const endTime = new Date();
  const executionTime = ((endTime - startTime) / 1000).toFixed(1);
  
  console.log('\n실행 결과:');
  console.log('- 성공 여부:', result.success);
  console.log('- 새로운 거래:', result.newTransactions + '건');
  console.log('- 실행 시간:', executionTime + '초');
  
  return result;
}

// 수집된 데이터 검증
function verifyCollectedData() {
  console.log('=== 수집된 데이터 검증 ===');
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    
    // Sales 시트 확인
    const salesSheet = ss.getSheetByName('Sales');
    if (salesSheet) {
      const salesCount = salesSheet.getLastRow() - 1;
      console.log(`\n판매 데이터: ${salesCount}건`);
      
      // 최근 10건 샘플
      if (salesCount > 0) {
        const lastRows = salesSheet.getRange(Math.max(2, salesSheet.getLastRow() - 9), 1, Math.min(10, salesCount), 7).getValues();
        console.log('최근 거래 샘플:');
        lastRows.forEach((row, idx) => {
          console.log(`  ${idx + 1}. ${row[1]} | ${row[3]} | 수량: ${row[4]}`);
        });
      }
    } else {
      console.log('\n❌ Sales 시트가 없습니다.');
    }
    
    // HotCache 시트 확인
    const hotSheet = ss.getSheetByName('HotCache');
    if (hotSheet) {
      const hotCount = hotSheet.getLastRow() - 1;
      console.log(`\n핫 캐시 상품: ${hotCount}개`);
      
      // 상위 5개 제품
      if (hotCount > 0) {
        const topProducts = hotSheet.getRange(2, 1, Math.min(5, hotCount), 4).getValues();
        console.log('판매량 상위 5개 제품:');
        topProducts.forEach((row, idx) => {
          console.log(`  ${idx + 1}. ${row[1]} | 30일 판매: ${row[2]}개`);
        });
      }
    } else {
      console.log('\n❌ HotCache 시트가 없습니다.');
    }
    
    // Metadata 시트 확인
    const metaSheet = ss.getSheetByName('Metadata');
    if (metaSheet) {
      const lastSync = metaSheet.getRange('B1').getValue();
      console.log(`\n마지막 동기화 날짜: ${lastSync}`);
    } else {
      console.log('\n❌ Metadata 시트가 없습니다.');
    }
    
    console.log('\n=== 검증 완료 ===');
    
  } catch (error) {
    console.error('검증 중 오류:', error);
  }
}

// SmaregiData 하이브리드 업데이트 (판매된 상품만)
function updateSmaregiDataHybrid(newSalesRows) {
  try {
    if (!newSalesRows || newSalesRows.length === 0) {
      console.log('SmaregiData 업데이트 스킵 - 새 판매 없음');
      return;
    }
    
    console.log(`SmaregiData 하이브리드 업데이트 시작... (판매 상품 ${newSalesRows.length}건)`);
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const smaregiSheet = ss.getSheetByName('SmaregiData');
    
    if (!smaregiSheet) {
      console.log('SmaregiData 시트가 없어 새로 생성합니다.');
      createSmaregiDataSheet();
      return;
    }
    
    // 1. 판매된 상품 바코드 추출 (중복 제거)
    const soldBarcodes = [...new Set(newSalesRows.map(row => String(row[2])))];
    console.log(`판매된 고유 상품: ${soldBarcodes.length}개`);
    
    // 2. 판매된 상품의 재고 조회
    const stockData = getRealtimeStockBatch(soldBarcodes);
    
    // 3. 30일 판매 데이터 집계
    const sales30Days = aggregateSales30Days();
    
    // 4. 1년 판매 데이터 집계 (판매된 상품만)
    const sales365Days = aggregateSales365DaysForProducts(soldBarcodes);
    
    // 5. SmaregiData 기존 데이터 로드
    const smaregiData = smaregiSheet.getDataRange().getValues();
    const dataMap = new Map();
    
    for (let i = 1; i < smaregiData.length; i++) {
      const barcode = String(smaregiData[i][0]);
      dataMap.set(barcode, {
        rowIndex: i + 1,
        productName: smaregiData[i][1],
        stock: smaregiData[i][2],
        sales30: smaregiData[i][3],
        sales365: smaregiData[i][4]
      });
    }
    
    // 6. 판매된 상품만 업데이트
    const updateBatch = [];
    const newProducts = [];
    
    soldBarcodes.forEach(barcode => {
      const stock = stockData[barcode]?.stock || 0;
      const sales30 = sales30Days[barcode]?.quantity || 0;
      const sales365 = sales365Days[barcode] || 0;
      const productName = sales30Days[barcode]?.productName || '상품명 미등록';
      const dailyAvg = sales30 > 0 ? (sales30 / 30).toFixed(2) : 0;
      
      // 재고회전일수 계산
      let turnoverDays = '∞';
      if (parseFloat(dailyAvg) > 0 && stock > 0) {
        turnoverDays = Math.ceil(stock / parseFloat(dailyAvg));
      } else if (parseFloat(dailyAvg) > 0 && stock === 0) {
        turnoverDays = 0;
      }
      
      if (dataMap.has(barcode)) {
        // 기존 상품 업데이트 (재고, 30일, 1년, 일평균, 재고회전일수)
        const existing = dataMap.get(barcode);
        updateBatch.push({
          range: smaregiSheet.getRange(existing.rowIndex, 3, 1, 5),
          values: [[stock, sales30, sales365, parseFloat(dailyAvg), turnoverDays]]
        });
      } else {
        // 새 상품 추가
        newProducts.push([
          barcode,
          productName,
          stock,
          sales30,
          sales365,
          parseFloat(dailyAvg),
          turnoverDays,
          0, // 순위
          new Date()
        ]);
      }
    });
    
    // 7. 배치 업데이트 실행
    if (updateBatch.length > 0) {
      updateBatch.forEach(batch => {
        batch.range.setValues(batch.values);
      });
    }
    
    // 8. 새 상품 추가
    if (newProducts.length > 0) {
      const lastRow = smaregiSheet.getLastRow();
      smaregiSheet.getRange(lastRow + 1, 1, newProducts.length, 9).setValues(newProducts);
    }
    
    // 9. 업데이트된 행만 시간 갱신
    [...updateBatch, ...newProducts].forEach((item, index) => {
      if (item.range) {
        smaregiSheet.getRange(item.range.getRow(), 9).setValue(new Date());
      }
    });
    
    // 10. 주기적 전체 업데이트 체크 (1시간마다)
    checkFullUpdateNeeded();
    
    console.log(`SmaregiData 하이브리드 업데이트 완료: 기존 ${updateBatch.length}개, 신규 ${newProducts.length}개`);
    
  } catch (error) {
    console.error('SmaregiData 하이브리드 업데이트 오류:', error);
  }
}

// 30일 판매 데이터 집계
function aggregateSales30Days() {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const summarySheet = ss.getSheetByName('Recent_Summary');
  const recentSheet = ss.getSheetByName('Sales_Recent');
  const sales30Days = {};
  
  if (summarySheet && summarySheet.getLastRow() > 1) {
    // 압축 데이터 사용
    const data = summarySheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const barcode = String(data[i][1]);
      const quantity = parseInt(data[i][3]) || 0;
      const productName = data[i][2];
      
      if (!sales30Days[barcode]) {
        sales30Days[barcode] = { productName, quantity: 0 };
      }
      sales30Days[barcode].quantity += quantity;
    }
  } else if (recentSheet && recentSheet.getLastRow() > 1) {
    // 원본 데이터 사용
    const data = recentSheet.getDataRange().getValues();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    for (let i = 1; i < data.length; i++) {
      const date = new Date(data[i][1]);
      if (date >= thirtyDaysAgo) {
        const barcode = String(data[i][2]);
        const quantity = parseInt(data[i][4]) || 0;
        const productName = data[i][3];
        
        if (!sales30Days[barcode]) {
          sales30Days[barcode] = { productName, quantity: 0 };
        }
        sales30Days[barcode].quantity += quantity;
      }
    }
  }
  
  return sales30Days;
}

// 1년 판매 데이터 집계 (특정 상품만)
function aggregateSales365DaysForProducts(barcodes) {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const archiveSheet = ss.getSheetByName('Sales_Archive');
  const recentSheet = ss.getSheetByName('Sales_Recent');
  const sales365Days = {};
  
  // 바코드 Set 생성 (빠른 조회)
  const barcodeSet = new Set(barcodes);
  
  // Archive 데이터 집계
  if (archiveSheet && archiveSheet.getLastRow() > 1) {
    const data = archiveSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const barcode = String(data[i][2]);
      if (barcodeSet.has(barcode)) {
        const quantity = parseInt(data[i][4]) || 0;
        sales365Days[barcode] = (sales365Days[barcode] || 0) + quantity;
      }
    }
  }
  
  // Recent 데이터 추가
  if (recentSheet && recentSheet.getLastRow() > 1) {
    const data = recentSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const barcode = String(data[i][2]);
      if (barcodeSet.has(barcode)) {
        const quantity = parseInt(data[i][4]) || 0;
        sales365Days[barcode] = (sales365Days[barcode] || 0) + quantity;
      }
    }
  }
  
  return sales365Days;
}

// 전체 업데이트 필요 여부 체크
function checkFullUpdateNeeded() {
  const props = PropertiesService.getScriptProperties();
  const lastFullUpdate = props.getProperty('lastSmaregiFullUpdate');
  const now = new Date();
  
  if (!lastFullUpdate) {
    props.setProperty('lastSmaregiFullUpdate', now.toISOString());
    return;
  }
  
  const lastUpdate = new Date(lastFullUpdate);
  const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);
  
  // 1시간마다 전체 업데이트 (모든 상품의 재고 및 판매량)
  if (hoursSinceUpdate >= 1) {
    console.log('1시간 경과 - 전체 업데이트 필요');
    // 야간 시간대가 아니면 전체 업데이트 실행
    const hour = now.getHours();
    if (hour >= 7 && hour < 22) {
      updateSmaregiDataFull();
      props.setProperty('lastSmaregiFullUpdate', now.toISOString());
    }
  }
}

// SmaregiData 시트 생성
function createSmaregiDataSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const sheet = ss.insertSheet('SmaregiData');
  
  const headers = [
    '상품ID', '상품명', '현재재고', '30일 판매량', '1년 판매량',
    '일평균판매량', '재고회전일수', '인기순위', '업데이트시간'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  
  // 초기 데이터 로드
  updateSmaregiDataFull();
}

// SmaregiData 전체 업데이트 (수동 동기화 버튼용)
function syncSmaregiDataManual() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('동기화 중...', 'SmaregiData를 전체 동기화하고 있습니다.', ui.ButtonSet.OK);
  
  const result = updateSmaregiDataFull();
  
  if (result.success) {
    ui.alert(
      '✅ 동기화 완료',
      `• 처리된 상품: ${result.productCount}개\n• 실행 시간: ${result.executionTime}초`,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert('❌ 오류', result.error, ui.ButtonSet.OK);
  }
}

// SmaregiData 전체 업데이트 (모든 상품의 재고, 판매량)
function updateSmaregiDataFull() {
  const startTime = new Date();
  console.log('=== SmaregiData 전체 업데이트 시작 ===');
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let smaregiSheet = ss.getSheetByName('SmaregiData');
    
    if (!smaregiSheet) {
      createSmaregiDataSheet();
      smaregiSheet = ss.getSheetByName('SmaregiData');
    }
    
    // 1. 30일 판매 데이터 전체 집계
    const sales30Days = aggregateSales30Days();
    
    // 2. 1년 판매 데이터 전체 집계
    const sales365Days = {};
    const archiveSheet = ss.getSheetByName('Sales_Archive');
    const recentSheet = ss.getSheetByName('Sales_Recent');
    
    // Archive 데이터
    if (archiveSheet && archiveSheet.getLastRow() > 1) {
      const data = archiveSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const barcode = String(data[i][2]);
        const quantity = parseInt(data[i][4]) || 0;
        sales365Days[barcode] = (sales365Days[barcode] || 0) + quantity;
      }
    }
    
    // Recent 데이터 추가
    if (recentSheet && recentSheet.getLastRow() > 1) {
      const data = recentSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const barcode = String(data[i][2]);
        const quantity = parseInt(data[i][4]) || 0;
        sales365Days[barcode] = (sales365Days[barcode] || 0) + quantity;
      }
    }
    
    // 3. 모든 고유 바코드 수집
    const allBarcodes = new Set([
      ...Object.keys(sales30Days),
      ...Object.keys(sales365Days),
      ...smaregiSheet.getDataRange().getValues().slice(1).map(row => String(row[0]))
    ]);
    
    console.log(`전체 상품 수: ${allBarcodes.size}개`);
    
    // 4. 전체 상품 재고 조회 (배치 처리)
    const allBarcodesArray = Array.from(allBarcodes);
    const stockData = {};
    const batchSize = 50;
    
    for (let i = 0; i < allBarcodesArray.length; i += batchSize) {
      const batch = allBarcodesArray.slice(i, i + batchSize);
      const batchStockData = getRealtimeStockBatch(batch);
      Object.assign(stockData, batchStockData);
      
      // 진행율 표시
      if (i % 200 === 0) {
        console.log(`재고 조회 중: ${i}/${allBarcodesArray.length}`);
      }
    }
    
    // 5. 새 데이터로 시트 재구성
    smaregiSheet.clear();
    const headers = [
      '상품ID', '상품명', '현재재고', '30일 판매량', '1년 판매량',
      '일평균판매량', '재고회전일수', '인기순위', '업데이트시간'
    ];
    smaregiSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    smaregiSheet.setFrozenRows(1);
    
    // 6. 데이터 정리
    const rows = [];
    allBarcodes.forEach(barcode => {
      const stock = stockData[barcode]?.stock || 0;
      const sales30 = sales30Days[barcode]?.quantity || 0;
      const sales365 = sales365Days[barcode] || 0;
      const productName = sales30Days[barcode]?.productName || 
                         sales365Days[barcode]?.productName || 
                         '상품명 미등록';
      const dailyAvg = sales30 > 0 ? (sales30 / 30).toFixed(2) : 0;
      
      let turnoverDays = '∞';
      if (parseFloat(dailyAvg) > 0 && stock > 0) {
        turnoverDays = Math.ceil(stock / parseFloat(dailyAvg));
      } else if (parseFloat(dailyAvg) > 0 && stock === 0) {
        turnoverDays = 0;
      }
      
      rows.push([
        barcode,
        productName,
        stock,
        sales30,
        sales365,
        parseFloat(dailyAvg),
        turnoverDays,
        0, // 순위
        new Date()
      ]);
    });
    
    // 7. 30일 판매량 기준 정렬 및 순위 부여
    rows.sort((a, b) => b[3] - a[3]);
    rows.forEach((row, index) => {
      row[7] = index + 1;
    });
    
    // 8. 데이터 저장
    if (rows.length > 0) {
      smaregiSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`=== SmaregiData 전체 업데이트 완료: ${rows.length}개 상품, ${executionTime}초 ===`);
    
    return {
      success: true,
      productCount: rows.length,
      executionTime: executionTime
    };
    
  } catch (error) {
    console.error('SmaregiData 전체 업데이트 오류:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// API 연결 디버그
function debugAPIConnection() {
  console.log('=== API 연결 디버그 ===');
  
  try {
    // 1. 설정 확인
    const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
    console.log('\n환경:', isProduction ? '본번' : '개발');
    console.log('Contract ID:', isProduction ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID);
    
    // 2. 토큰 URL 확인
    const tokenUrl = isProduction 
      ? `${CONFIG.PLATFORM_CONFIG.PROD_TOKEN_URL}${CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID}/token`
      : `${CONFIG.PLATFORM_CONFIG.DEV_TOKEN_URL}${CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID}/token`;
    console.log('\n토큰 URL:', tokenUrl);
    
    // 3. 토큰 발급 테스트 (캐시 무시)
    const cache = CacheService.getScriptCache();
    cache.remove('smaregiToken');
    
    console.log('\n토큰 발급 중...');
    const token = getSmaregiAccessToken();
    console.log('토큰 발급 성공!');
    console.log('토큰 미리보기:', token.substring(0, 20) + '...');
    
    // 4. API URL 확인
    const baseUrl = isProduction 
      ? CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL 
      : CONFIG.PLATFORM_CONFIG.DEV_API_BASE_URL;
    const contractId = isProduction 
      ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID 
      : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID;
      
    const apiUrl = `${baseUrl}${contractId}/pos/products?limit=1`;
    console.log('\nAPI URL:', apiUrl);
    
    // 5. API 호출 테스트
    console.log('\nAPI 호출 테스트...');
    const options = {
      'method': 'get',
      'headers': {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      'muteHttpExceptions': true
    };
    
    const response = UrlFetchApp.fetch(apiUrl, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log('\n응답 코드:', responseCode);
    console.log('응답 내용:', responseText.substring(0, 200));
    
    if (responseCode === 401) {
      console.log('\n❌ 401 인증 오류 - 가능한 원인:');
      console.log('1. 스코프 권한 부족');
      console.log('2. 토큰 형식 오류');
      console.log('3. Contract ID 불일치');
      
      // 응답 헤더 확인
      const headers = response.getAllHeaders();
      console.log('\n응답 헤더:', JSON.stringify(headers));
    }
    
    return {
      success: responseCode === 200,
      responseCode: responseCode,
      message: responseCode === 200 ? 'API 연결 성공!' : 'API 연결 실패'
    };
    
  } catch (error) {
    console.error('\n디버그 중 오류:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// ===== 테스트 함수들 =====

// 1. 초기 설정 확인
function testInitialSetup() {
  console.log('=== 초기 설정 확인 ===');
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  console.log('Sales_Recent:', ss.getSheetByName('Sales_Recent') ? '있음' : '없음');
  console.log('Sales_Archive:', ss.getSheetByName('Sales_Archive') ? '있음' : '없음');
  console.log('SmaregiData:', ss.getSheetByName('SmaregiData') ? '있음' : '없음');
  console.log('Metadata:', ss.getSheetByName('Metadata') ? '있음' : '없음');
  console.log('HotCache:', ss.getSheetByName('HotCache') ? '있음' : '없음');
  console.log('Recent_Summary:', ss.getSheetByName('Recent_Summary') ? '있음' : '없음');
}

// 2. 판매 동기화 테스트
function testSalesSync() {
  console.log('=== 판매 동기화 테스트 ===');
  const result = syncIncrementalSales();
  console.log('동기화 결과:', result);
  
  if (result.success && !result.skipped) {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName('Sales_Recent');
    console.log('Sales_Recent 행 수:', sheet.getLastRow());
    
    // 최근 5건 표시
    if (sheet.getLastRow() > 1) {
      const lastRows = Math.min(5, sheet.getLastRow() - 1);
      const data = sheet.getRange(sheet.getLastRow() - lastRows + 1, 1, lastRows, 7).getValues();
      console.log('최근 판매 데이터:');
      data.forEach(row => {
        console.log(`  ${row[1]} | ${row[3]} | 수량: ${row[4]}`);
      });
    }
  }
}

// 3. SmaregiData 하이브리드 업데이트 테스트
function testHybridUpdate() {
  console.log('=== SmaregiData 하이브리드 업데이트 테스트 ===');
  
  // 테스트 데이터 (실제 판매 데이터 형식)
  const testSalesRows = [
    ['T123', '2025-01-10', '4902705116782', '테스트상품A', 5, 1000, 'S1'],
    ['T124', '2025-01-10', '4901427401646', '테스트상품B', 3, 2000, 'S1']
  ];
  
  console.log('테스트 판매 데이터:', testSalesRows.length + '건');
  updateSmaregiDataHybrid(testSalesRows);
  
  // 결과 확인
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const smaregiSheet = ss.getSheetByName('SmaregiData');
  console.log('SmaregiData 행 수:', smaregiSheet ? smaregiSheet.getLastRow() : '시트 없음');
}

// 4. 데이터 상태 확인
function checkDataStatus() {
  console.log('=== 데이터 상태 확인 ===');
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  
  // 각 시트의 데이터 수 확인
  ['Sales_Recent', 'Sales_Archive', 'SmaregiData', 'HotCache', 'Recent_Summary'].forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      console.log(`${sheetName}: ${sheet.getLastRow() - 1}행`);
    } else {
      console.log(`${sheetName}: 시트 없음`);
    }
  });
  
  // 최근 동기화 시간 확인
  const metaSheet = ss.getSheetByName('Metadata');
  if (metaSheet) {
    console.log('\n메타데이터:');
    console.log('마지막 동기화:', metaSheet.getRange('B1').getValue());
    console.log('마지막 로테이션:', metaSheet.getRange('B3').getValue());
  }
  
  // 트리거 상태 확인
  console.log('\n트리거 상태:');
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncIncrementalSales') {
      console.log('실시간 동기화:', trigger.getTriggerSource(), trigger.getEventType());
    }
  });
}

// 5. 테스트 트리거 설정 (1분마다)
function setupTestTrigger() {
  // 기존 트리거 제거
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncIncrementalSales') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 1분마다 실행으로 테스트 (나중에 5분으로 변경)
  ScriptApp.newTrigger('syncIncrementalSales')
    .timeBased()
    .everyMinutes(1)
    .create();
    
  console.log('테스트 트리거 설정 완료 (1분마다)');
}

// 6. 강제 동기화 테스트 (시간 체크 무시)
function forceSyncTest() {
  console.log('=== 강제 동기화 테스트 ===');
  const hour = new Date().getHours();
  console.log('현재 시간:', hour + '시');
  
  // 시간 체크를 임시로 통과시키고 실행
  console.log('시간 체크 무시하고 동기화 실행...');
  
  // 원래 함수 내부 로직만 실행 (시간 체크 제외)
  const startTime = new Date();
  console.log('=== 판매 데이터 증분 동기화 시작 ===');
  // syncIncrementalSales()의 내부 로직을 직접 호출
}

// 7. 상품별 재고 테스트
function testStockCheck() {
  console.log('=== 재고 조회 테스트 ===');
  
  // 테스트할 바코드들
  const testBarcodes = ['4902705116782', '4901427401646'];
  console.log('테스트 바코드:', testBarcodes);
  
  const stockData = getRealtimeStockBatch(testBarcodes);
  console.log('재고 데이터:', stockData);
}
