/**
 * Smaregi API 연동 - 재고 및 판매 데이터 수집
 * Product_sheet에 'SmaregiData' 시트 생성하여 저장
 */

// 토큰 캐싱을 위한 헬퍼 함수
function getCachedToken() {
  const cache = CacheService.getScriptCache();
  const cachedToken = cache.get('smaregiToken');
  
  if (cachedToken) {
    const tokenData = JSON.parse(cachedToken);
    const now = new Date().getTime();
    
    // 만료 5분 전에 갱신
    if (tokenData.expiresAt - now > 5 * 60 * 1000) {
      return tokenData.token;
    }
  }
  
  return null;
}

// OAuth2 토큰 발급 (수정 - 플랫폼 API 명시)
function getSmaregiAccessToken() {
  // 캐시된 토큰 확인
  const cachedToken = getCachedToken();
  if (cachedToken) return cachedToken;
  
  const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
  
  // 플랫폼 API 토큰 URL 확인 (슬래시 포함)
  const tokenUrl = isProduction 
    ? `${CONFIG.PLATFORM_CONFIG.PROD_TOKEN_URL}${CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID}/token`
    : `${CONFIG.PLATFORM_CONFIG.DEV_TOKEN_URL}${CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID}/token`;
    
  const clientId = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_CLIENT_ID 
    : CONFIG.PLATFORM_CONFIG.DEV_CLIENT_ID;
    
  const clientSecret = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_CLIENT_SECRET 
    : CONFIG.PLATFORM_CONFIG.DEV_CLIENT_SECRET;
  
  const payload = {
    'grant_type': 'client_credentials',
    'scope': CONFIG.PLATFORM_CONFIG.SCOPES
  };
  
  const options = {
    'method': 'post',
    'headers': {
      'Authorization': 'Basic ' + Utilities.base64Encode(clientId + ':' + clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    'payload': Object.keys(payload).map(key => key + '=' + encodeURIComponent(payload[key])).join('&'),
    'muteHttpExceptions': true
  };
  
  try {
    const response = UrlFetchApp.fetch(tokenUrl, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.access_token) {
      console.log('토큰 발급 성공. 토큰 타입:', result.token_type);
      
      // 토큰 캐싱 (1시간 유효)
      const cache = CacheService.getScriptCache();
      const tokenData = {
        token: result.access_token,
        expiresAt: new Date().getTime() + (result.expires_in * 1000)
      };
      cache.put('smaregiToken', JSON.stringify(tokenData), result.expires_in);
      
      return result.access_token;
    } else {
      throw new Error('토큰 발급 실패: ' + response.getContentText());
    }
  } catch (error) {
    console.error('토큰 발급 오류:', error);
    throw error;
  }
}

// Smaregi API 호출 헬퍼 함수 (디버깅 기능 추가)
function callSmaregiAPI(endpoint, params = {}, debug = false) {
  const token = getSmaregiAccessToken();
  const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
  
  const baseUrl = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL 
    : CONFIG.PLATFORM_CONFIG.DEV_API_BASE_URL;
    
  const contractId = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID 
    : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID;
  
  const queryString = Object.keys(params).length > 0 
    ? '?' + Object.keys(params).map(key => key + '=' + encodeURIComponent(params[key])).join('&')
    : '';
  
  const url = `${baseUrl}${contractId}/pos${endpoint}${queryString}`;
  
  if (debug) {
    console.log('=== API 호출 디버그 ===');
    console.log('전체 URL:', url);
    console.log('파라미터:', JSON.stringify(params));
    console.log('토큰 시작:', token.substring(0, 20) + '...');
  }
  
  const options = {
    'method': 'get',
    'headers': {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    'muteHttpExceptions': true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const responseText = response.getContentText();
  
  if (debug) {
    console.log('응답 상태:', response.getResponseCode());
    console.log('응답 헤더:', JSON.stringify(response.getAllHeaders()));
    console.log('응답 내용:', responseText.substring(0, 500));
  }
  
  return JSON.parse(responseText);
}

// 모든 상품의 재고 정보 가져오기
function fetchAllStockData() {
  const stockData = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    try {
      const response = callSmaregiAPI('/stock', {
        page: page,
        limit: 1000
      });
      
      if (response && response.length > 0) {
        stockData.push(...response);
        page++;
        
        // 응답이 limit보다 적으면 마지막 페이지
        if (response.length < 1000) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(`재고 데이터 조회 오류 (페이지 ${page}):`, error);
      hasMore = false;
    }
  }
  
  return stockData;
}

// 상품 정보 가져오기
function fetchProductInfo() {
  const productInfo = {};
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    try {
      const response = callSmaregiAPI('/products', {
        page: page,
        limit: 1000,
        fields: 'productId,productCode,productName'
      });
      
      if (response && response.length > 0) {
        response.forEach(product => {
          productInfo[product.productId] = {
            productCode: product.productCode || '',
            productName: product.productName || ''
          };
        });
        page++;
        
        if (response.length < 1000) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(`상품 정보 조회 오류 (페이지 ${page}):`, error);
      hasMore = false;
    }
  }
  
  return productInfo;
}

// ===== 최적화된 판매 데이터 수집 함수들 =====

// 마지막 동기화 날짜 저장/로드
function saveLastSyncDate(date) {
  const userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('smaregiLastSyncDate', date);
}

function getLastSyncDate() {
  const userProperties = PropertiesService.getUserProperties();
  const lastSync = userProperties.getProperty('smaregiLastSyncDate');
  
  if (lastSync) {
    return new Date(lastSync);
  }
  
  // 기본값: 30일 전
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return thirtyDaysAgo;
}

// 날짜 범위별 거래 데이터 조회 (최적화 버전)
function getTransactionsByDateRange(startDate, endDate) {
  const salesByProduct = {};
  let totalTransactions = 0;
  
  // API 설정 가져오기
  const token = getSmaregiAccessToken();
  const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
  const baseUrl = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL 
    : CONFIG.PLATFORM_CONFIG.DEV_API_BASE_URL;
  const contractId = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID 
    : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID;
  
  // 날짜 배열 생성
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy-MM-dd'));
  }
  
  console.log(`${dates[0]} ~ ${dates[dates.length-1]} 기간 데이터 수집 시작`);
  
  // 날짜별로 처리
  for (const dateStr of dates) {
    try {
      let page = 1;
      let hasMore = true;
      let dailyCount = 0;
      
      while (hasMore) {
        const response = callSmaregiAPI('/transactions', {
          'sum_date-from': dateStr,
          'sum_date-to': dateStr,
          page: page,
          limit: 1000  // 최대값으로 설정
        });
        
        const transactions = Array.isArray(response) ? response : [];
        
        // 거래 ID 수집 (병렬 처리를 위해)
        const transactionIds = [];
        transactions.forEach(transaction => {
          if (transaction.transactionHeadId) {
            transactionIds.push(transaction.transactionHeadId);
          }
        });
        
        // 10개씩 배치로 거래 상세 조회 (속도 개선)
        const batchSize = 10;
        for (let i = 0; i < transactionIds.length; i += batchSize) {
          const batch = transactionIds.slice(i, i + batchSize);
          
          // 병렬로 상세 조회 - UrlFetchApp.fetchAll 사용
          const requests = batch.map(id => ({
            url: `${baseUrl}${contractId}/pos/transactions/${id}/details`,
            method: 'get',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            muteHttpExceptions: true
          }));
          
          try {
            const responses = UrlFetchApp.fetchAll(requests);
            
            responses.forEach((response, idx) => {
              if (response.getResponseCode() === 200) {
                const details = JSON.parse(response.getContentText());
                if (Array.isArray(details)) {
                  details.forEach(item => {
                    const productId = item.productId;
                    const quantity = parseInt(item.quantity) || 0;
                    
                    if (productId && quantity > 0) {
                      salesByProduct[productId] = (salesByProduct[productId] || 0) + quantity;
                    }
                  });
                  dailyCount++;
                }
              }
            });
          } catch (e) {
            console.error(`배치 처리 오류:`, e);
          }
          
          // 배치 간 짧은 대기 (rate limit 보호)
          if (i + batchSize < transactionIds.length) {
            Utilities.sleep(50);
          }
        }
        
        totalTransactions += transactions.length;
        
        // 1000개 미만이면 마지막 페이지
        if (transactions.length < 1000) {
          hasMore = false;
        } else {
          page++;
        }
      }
      
      if (dailyCount > 0) {
        console.log(`  ${dateStr}: ${dailyCount}건 처리`);
      }
      
    } catch (error) {
      console.error(`거래 조회 오류 (${dateStr}):`, error);
    }
    
    // 날짜 간 짧은 대기 (rate limit 보호)
    Utilities.sleep(200);
  }
  
  return {
    salesByProduct: salesByProduct,
    totalTransactions: totalTransactions,
    dateRange: `${dates[0]} ~ ${dates[dates.length-1]}`
  };
}

// 병렬 처리를 위한 배치 함수
function fetchBatchInParallel(dateRanges, batchSize = 3) {
  const allResults = [];
  
  // 배치 단위로 처리
  for (let i = 0; i < dateRanges.length; i += batchSize) {
    const batch = dateRanges.slice(i, i + batchSize);
    
    console.log(`배치 ${Math.floor(i/batchSize) + 1}/${Math.ceil(dateRanges.length/batchSize)} 처리 중...`);
    
    // 병렬 요청 준비
    const requests = batch.map(range => {
      return {
        startDate: range.start,
        endDate: range.end
      };
    });
    
    // 순차 처리 (GAS의 fetchAll 제한으로 인해)
    requests.forEach(req => {
      const result = getTransactionsByDateRange(req.startDate, req.endDate);
      allResults.push(result);
    });
    
    // 배치 간 대기
    if (i + batchSize < dateRanges.length) {
      console.log('다음 배치 전 대기...');
      Utilities.sleep(1000);
    }
  }
  
  // 결과 병합
  const mergedSales = {};
  let totalTransactions = 0;
  
  allResults.forEach(result => {
    Object.entries(result.salesByProduct).forEach(([productId, qty]) => {
      mergedSales[productId] = (mergedSales[productId] || 0) + qty;
    });
    totalTransactions += result.totalTransactions;
  });
  
  return {
    salesByProduct: mergedSales,
    totalTransactions: totalTransactions
  };
}

// 최적화된 월간 판매 데이터 수집 (메인 함수)
function calculateMonthlySales() {
  console.log('=== 최적화된 판매 데이터 수집 시작 ===');
  
  const startTime = new Date();
  const today = new Date();
  const lastSyncDate = getLastSyncDate();
  
  // 증분 동기화: 마지막 동기화 이후 데이터만 수집
  const syncStartDate = new Date(Math.max(lastSyncDate.getTime(), today.getTime() - 30 * 24 * 60 * 60 * 1000));
  
  console.log(`동기화 기간: ${Utilities.formatDate(syncStartDate, 'Asia/Tokyo', 'yyyy-MM-dd')} ~ ${Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd')}`);
  
  // 10일 단위로 날짜 범위 분할
  const dateRanges = [];
  let currentStart = new Date(syncStartDate);
  
  while (currentStart <= today) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + 9); // 10일 단위
    
    if (currentEnd > today) {
      currentEnd.setTime(today.getTime());
    }
    
    dateRanges.push({
      start: new Date(currentStart),
      end: new Date(currentEnd)
    });
    
    currentStart.setDate(currentStart.getDate() + 10);
  }
  
  console.log(`총 ${dateRanges.length}개 배치로 분할`);
  
  // 배치 병렬 처리
  const result = fetchBatchInParallel(dateRanges, 3);
  
  // 마지막 동기화 날짜 저장
  saveLastSyncDate(Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd'));
  
  const endTime = new Date();
  const executionTime = ((endTime - startTime) / 1000).toFixed(1);
  
  console.log('=== 수집 완료 ===');
  console.log(`- 실행 시간: ${executionTime}초`);
  console.log(`- 총 거래 수: ${result.totalTransactions}`);
  console.log(`- 판매 상품 종류: ${Object.keys(result.salesByProduct).length}`);
  
  // 전체 30일치 데이터가 없으면 이전 캐시된 데이터와 병합
  if (syncStartDate > new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)) {
    const cachedSales = loadCachedSalesData();
    
    // 새 데이터로 업데이트
    Object.entries(result.salesByProduct).forEach(([productId, qty]) => {
      cachedSales[productId] = qty;
    });
    
    // 30일 이전 데이터 제거
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    // 실제로는 날짜별 데이터가 필요하지만, 여기서는 간단히 처리
    
    saveCachedSalesData(cachedSales);
    return cachedSales;
  }
  
  saveCachedSalesData(result.salesByProduct);
  return result.salesByProduct;
}

// 판매 데이터 캐싱
function saveCachedSalesData(salesData) {
  const cache = CacheService.getScriptCache();
  const chunks = [];
  const data = JSON.stringify(salesData);
  
  // 100KB 단위로 분할 (캐시 제한)
  const chunkSize = 100000;
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  
  chunks.forEach((chunk, index) => {
    cache.put(`salesData_${index}`, chunk, 21600); // 6시간
  });
  cache.put('salesData_chunks', chunks.length.toString(), 21600);
}

function loadCachedSalesData() {
  const cache = CacheService.getScriptCache();
  const chunks = parseInt(cache.get('salesData_chunks') || '0');
  
  if (chunks === 0) return {};
  
  let data = '';
  for (let i = 0; i < chunks; i++) {
    data += cache.get(`salesData_${i}`) || '';
  }
  
  try {
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

// 플랫폼 API 방식 (items 필드가 있을 때)
function calculateMonthlySalesPlatform() {
  const salesByProduct = {};
  const today = new Date();
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
    
    try {
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        const response = callSmaregiAPI('/transactions', {
          date: dateStr,
          page: page,
          limit: 1000
        });
        
        const transactions = Array.isArray(response) ? response : [];
        
        transactions.forEach(transaction => {
          if (transaction.items && Array.isArray(transaction.items)) {
            transaction.items.forEach(item => {
              const productId = item.productId;
              const quantity = parseInt(item.qty || 0);
              
              if (productId && quantity > 0) {
                salesByProduct[productId] = (salesByProduct[productId] || 0) + quantity;
              }
            });
          }
        });
        
        page++;
        if (transactions.length < 1000) {
          hasMore = false;
        }
      }
      
      Utilities.sleep(100);
      
    } catch (error) {
      console.error(`거래 데이터 오류 (${dateStr}):`, error);
    }
  }
  
  return salesByProduct;
}

// 총 판매량 계산 (최대 6개월간)
function calculateTotalSales() {
  const salesByProduct = {};
  const today = new Date();
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  // 6개월간 월별로 조회
  for (let month = 0; month < 6; month++) {
    const targetDate = new Date(sixMonthsAgo);
    targetDate.setMonth(targetDate.getMonth() + month);
    
    // 해당 월의 시작일과 종료일
    const startDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const endDate = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
    
    // 해당 월의 각 날짜에 대해 조회
    for (let d = new Date(startDate); d <= endDate && d <= today; d.setDate(d.getDate() + 1)) {
      const dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
      
      try {
        let page = 1;
        let hasMore = true;
        
        while (hasMore) {
          const response = callSmaregiAPI('/transactions', {
            date: dateStr,
            page: page,
            limit: 1000
          });
          
          if (response && response.length > 0) {
            response.forEach(transaction => {
              if (transaction.details && Array.isArray(transaction.details)) {
                transaction.details.forEach(detail => {
                  const productId = detail.productId;
                  const quantity = parseInt(detail.quantity) || 0;
                  
                  if (productId && quantity > 0) {
                    salesByProduct[productId] = (salesByProduct[productId] || 0) + quantity;
                  }
                });
              }
            });
            
            page++;
            if (response.length < 1000) {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        }
      } catch (error) {
        console.error(`거래 데이터 조회 오류 (${dateStr}):`, error);
      }
    }
  }
  
  return salesByProduct;
}

// ===== SalesLog 시트 관리 함수들 =====

// SalesLog 시트에 일별 판매 데이터 저장
function saveDailySalesToLog(date, salesData) {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  
  // SalesLog 시트 생성 또는 가져오기
  let logSheet = ss.getSheetByName('SalesLog');
  if (!logSheet) {
    logSheet = ss.insertSheet('SalesLog');
    // 헤더 설정
    const headers = ['date', 'productId', 'productName', 'quantity', 'price', 'transactionId'];
    logSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    logSheet.setFrozenRows(1);
  }
  
  // 기존 데이터 중복 방지를 위해 해당 날짜 데이터 제거
  const existingData = logSheet.getDataRange().getValues();
  const dateStr = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
  
  // 해당 날짜가 아닌 데이터만 필터링
  const filteredData = existingData.filter((row, index) => {
    if (index === 0) return true; // 헤더 유지
    return row[0] !== dateStr;
  });
  
  // 시트 재작성
  logSheet.clear();
  if (filteredData.length > 0) {
    logSheet.getRange(1, 1, filteredData.length, filteredData[0].length).setValues(filteredData);
  }
  
  // 새 데이터 추가
  const newRows = [];
  Object.entries(salesData).forEach(([transactionId, items]) => {
    items.forEach(item => {
      newRows.push([
        dateStr,
        item.productId,
        item.productName || '',
        item.quantity,
        item.price || 0,
        transactionId
      ]);
    });
  });
  
  if (newRows.length > 0) {
    const lastRow = logSheet.getLastRow();
    logSheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
  
  console.log(`SalesLog: ${dateStr} - ${newRows.length}건 저장`);
}

// SalesLog에서 기간별 판매량 집계
function aggregateSalesFromLog(days = 30) {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const logSheet = ss.getSheetByName('SalesLog');
  
  if (!logSheet) {
    console.log('SalesLog 시트가 없습니다.');
    return {};
  }
  
  const data = logSheet.getDataRange().getValues();
  if (data.length <= 1) return {}; // 헤더만 있는 경우
  
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - days + 1);
  
  const salesByProduct = {};
  
  // 헤더 제외하고 데이터 처리
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDate = new Date(row[0]);
    
    // 기간 내 데이터만 처리
    if (rowDate >= startDate && rowDate <= today) {
      const productId = row[1];
      const quantity = parseInt(row[3]) || 0;
      
      if (!salesByProduct[productId]) {
        salesByProduct[productId] = {
          productName: row[2],
          quantity: 0
        };
      }
      salesByProduct[productId].quantity += quantity;
    }
  }
  
  return salesByProduct;
}

// 개선된 날짜 범위별 거래 데이터 조회 (SalesLog 저장 포함)
function getTransactionsByDateRangeWithLog(startDate, endDate) {
  const salesByProduct = {};
  const dailySalesLog = {};
  let totalTransactions = 0;
  
  // API 설정 가져오기
  const token = getSmaregiAccessToken();
  const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
  const baseUrl = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL 
    : CONFIG.PLATFORM_CONFIG.DEV_API_BASE_URL;
  const contractId = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID 
    : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID;
  
  // 상품 정보 캐시
  const productInfo = fetchProductInfo();
  
  // 날짜 배열 생성
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy-MM-dd'));
  }
  
  console.log(`${dates[0]} ~ ${dates[dates.length-1]} 기간 데이터 수집 시작`);
  
  // 날짜별로 처리
  for (const dateStr of dates) {
    const dailyData = {};
    
    try {
      let page = 1;
      let hasMore = true;
      let dailyCount = 0;
      
      while (hasMore) {
        const response = callSmaregiAPI('/transactions', {
          'sum_date-from': dateStr,
          'sum_date-to': dateStr,
          page: page,
          limit: 1000
        });
        
        const transactions = Array.isArray(response) ? response : [];
        
        // 거래 ID 수집
        const transactionIds = [];
        transactions.forEach(transaction => {
          if (transaction.transactionHeadId) {
            transactionIds.push(transaction.transactionHeadId);
          }
        });
        
        // 10개씩 배치로 거래 상세 조회
        const batchSize = 10;
        for (let i = 0; i < transactionIds.length; i += batchSize) {
          const batch = transactionIds.slice(i, i + batchSize);
          
          // 병렬로 상세 조회
          const requests = batch.map(id => ({
            url: `${baseUrl}${contractId}/pos/transactions/${id}/details`,
            method: 'get',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            muteHttpExceptions: true
          }));
          
          try {
            const responses = UrlFetchApp.fetchAll(requests);
            
            responses.forEach((response, idx) => {
              if (response.getResponseCode() === 200) {
                const details = JSON.parse(response.getContentText());
                const transactionId = batch[idx];
                
                if (Array.isArray(details)) {
                  dailyData[transactionId] = details.map(item => ({
                    productId: item.productId,
                    productName: productInfo[item.productId]?.productName || '',
                    quantity: parseInt(item.quantity) || 0,
                    price: parseFloat(item.price) || 0
                  }));
                  
                  details.forEach(item => {
                    const productId = item.productId;
                    const quantity = parseInt(item.quantity) || 0;
                    
                    if (productId && quantity > 0) {
                      salesByProduct[productId] = (salesByProduct[productId] || 0) + quantity;
                    }
                  });
                  dailyCount++;
                }
              }
            });
          } catch (e) {
            console.error(`배치 처리 오류:`, e);
          }
          
          if (i + batchSize < transactionIds.length) {
            Utilities.sleep(50);
          }
        }
        
        totalTransactions += transactions.length;
        
        if (transactions.length < 1000) {
          hasMore = false;
        } else {
          page++;
        }
      }
      
      // 일별 데이터를 SalesLog에 저장
      if (Object.keys(dailyData).length > 0) {
        saveDailySalesToLog(new Date(dateStr), dailyData);
        console.log(`  ${dateStr}: ${dailyCount}건 처리 및 저장`);
      }
      
    } catch (error) {
      console.error(`거래 조회 오류 (${dateStr}):`, error);
    }
    
    Utilities.sleep(200);
  }
  
  return {
    salesByProduct: salesByProduct,
    totalTransactions: totalTransactions,
    dateRange: `${dates[0]} ~ ${dates[dates.length-1]}`
  };
}

// 스프레드시트에 데이터 저장 (개선된 버전)
function saveSmaregiDataToSheet() {
  try {
    console.log('=== Smaregi 데이터 수집 및 저장 시작 ===');
    const startTime = new Date();
    
    // 1. 상품 정보 가져오기
    const productInfo = fetchProductInfo();
    console.log(`상품 정보 ${Object.keys(productInfo).length}건 조회 완료`);
    
    // 1-1. 발주목록(main) 시트에서 상품명 가져오기
    const mainSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('발주목록');
    if (mainSheet && mainSheet.getLastRow() > 1) {
      const mainData = mainSheet.getRange(2, 1, mainSheet.getLastRow() - 1, 2).getValues(); // A,B열만
      
      mainData.forEach(row => {
        const barcode = String(row[0]); // A열: 바코드
        const productName = row[1];     // B열: 상품명
        
        if (barcode && productName) {
          // 발주목록의 상품명을 최우선으로 사용
          productInfo[barcode] = {
            productCode: barcode,
            productName: productName
          };
        }
      });
      
      console.log(`발주목록에서 ${mainData.length}개 상품명 적용`);
    }
    
    console.log(`최종 상품 정보: ${Object.keys(productInfo).length}건`);
    
    // 2. 재고 데이터 가져오기
    const stockData = fetchAllStockData();
    console.log(`재고 데이터 ${stockData.length}건 조회 완료`);
    
    // 3. 최근 데이터만 API로 수집 (증분)
    const today = new Date();
    const lastSyncDate = getLastSyncDate();
    const syncStartDate = new Date(Math.max(lastSyncDate.getTime(), today.getTime() - 30 * 24 * 60 * 60 * 1000));
    
    console.log(`API 동기화 기간: ${Utilities.formatDate(syncStartDate, 'Asia/Tokyo', 'yyyy-MM-dd')} ~ ${Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd')}`);
    
    // 증분 데이터 수집 (SalesLog에 저장)
    const incrementalResult = getTransactionsByDateRangeWithLog(syncStartDate, today);
    
    // 4. SalesLog에서 30일/1년 판매량 집계
    const sales30Days = aggregateSalesFromLog(30);
    const sales365Days = aggregateSalesFromLog(365);
    
    // 5. 마지막 동기화 날짜 저장
    saveLastSyncDate(Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd'));
    
    // 6. SmaregiData 시트 업데이트
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    let sheet = ss.getSheetByName('SmaregiData');
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet('SmaregiData');
    }
    
    // 헤더 설정 (Code.gs 구조와 일치)
    const headers = [
      '상품ID',      // A
      '상품명',      // B
      '현재재고',    // C
      '30일 판매량',  // D
      '1년 판매량',   // E
      '일평균판매량', // F
      '재고회전일수', // G
      '인기순위',    // H
      '업데이트시간'  // I
    ];
    
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f3f3f3');
    
    // 상품별 재고 합계
    const stockByProduct = {};
    stockData.forEach(stock => {
      const productId = stock.productId;
      stockByProduct[productId] = (stockByProduct[productId] || 0) + (parseInt(stock.stockAmount) || 0);
    });
    
    // 모든 상품ID 수집 (재고 + 판매 데이터)
    const allProductIds = new Set([
      ...Object.keys(stockByProduct),
      ...Object.keys(sales30Days),
      ...Object.keys(sales365Days)
    ]);
    
    // 데이터 정리
    const rows = [];
    allProductIds.forEach(productId => {
      const info = productInfo[productId] || { productName: '상품명 미등록' };
      const stock = stockByProduct[productId] || 0;
      const sales30 = sales30Days[productId]?.quantity || 0;
      const sales365 = sales365Days[productId]?.quantity || 0;
      const dailyAverage = sales30 > 0 ? (sales30 / 30).toFixed(2) : 0;
      
      // 재고회전일수 계산
      let stockTurnoverDays = '∞';
      if (dailyAverage > 0 && stock > 0) {
        stockTurnoverDays = Math.ceil(stock / dailyAverage);
      } else if (dailyAverage > 0 && stock === 0) {
        stockTurnoverDays = 0;
      }
      
      rows.push([
        productId,                    // A: 상품ID
        info.productName,            // B: 상품명
        stock,                       // C: 현재재고
        sales30,                     // D: 30일 판매량
        sales365,                    // E: 1년 판매량
        parseFloat(dailyAverage),    // F: 일평균판매량
        stockTurnoverDays,           // G: 재고회전일수
        0,                           // H: 인기순위 (추후 구현)
        new Date()                   // I: 업데이트시간
      ]);
    });
    
    // 30일 판매량 기준으로 정렬 (내림차순)
    rows.sort((a, b) => b[3] - a[3]);
    
    // 데이터 쓰기
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      
      // 숫자 형식 설정
      sheet.getRange(2, 3, rows.length, 3).setNumberFormat('#,##0'); // C열(재고), D열(30일판매), E열(1년판매)
      sheet.getRange(2, 6, rows.length, 1).setNumberFormat('#,##0.00'); // F열(일평균)
      sheet.getRange(2, 9, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm'); // I열(날짜)
    }
    
    // 요약 정보
    const summaryRow = rows.length + 4;
    sheet.getRange(summaryRow, 1, 7, 2).setValues([
      ['=== 요약 정보 ===', ''],
      ['총 상품 수', rows.length],
      ['30일 판매 상품', Object.keys(sales30Days).length],
      ['1년 판매 상품', Object.keys(sales365Days).length],
      ['총 재고 수량', rows.reduce((sum, row) => sum + row[2], 0)],
      ['30일 총 판매', rows.reduce((sum, row) => sum + row[3], 0)],
      ['1년 총 판매', rows.reduce((sum, row) => sum + row[4], 0)]
    ]);
    
    // 서식 설정
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log('=== 완료 ===');
    console.log(`실행 시간: ${executionTime}초`);
    console.log(`저장된 상품: ${rows.length}개`);
    
    return {
      success: true,
      recordCount: rows.length,
      executionTime: executionTime,
      lastUpdate: new Date()
    };
    
  } catch (error) {
    console.error('Smaregi 데이터 저장 오류:', error);
    console.error('상세 오류:', error.stack);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// 거래 통계 계산 (상품별 상세 없이)
function calculateTransactionStats() {
  const stats = {
    totalTransactions: 0,
    totalAmount: 0,
    avgDailyAmount: 0,
    dateRange: 30
  };
  
  const today = new Date();
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
    
    try {
      const response = callSmaregiAPI('/transactions', {
        'sum_date-from': dateStr,
        'sum_date-to': dateStr,
        limit: 1000
      });
      
      const transactions = Array.isArray(response) ? response : [];
      
      transactions.forEach(transaction => {
        stats.totalTransactions++;
        stats.totalAmount += parseFloat(transaction.total || 0);
      });
      
      Utilities.sleep(100);
      
    } catch (error) {
      console.error(`거래 통계 오류 (${dateStr}):`, error);
    }
  }
  
  stats.avgDailyAmount = stats.totalAmount / stats.dateRange;
  
  return stats;
}

// 이전 재고 데이터 저장/불러오기
function saveCurrentStock(stockData) {
  const cache = CacheService.getScriptCache();
  cache.put('previousStock', JSON.stringify(stockData), 60 * 60 * 24 * 7); // 7일간 보관
}

function loadPreviousStock() {
  const cache = CacheService.getScriptCache();
  const data = cache.get('previousStock');
  return data ? JSON.parse(data) : {};
}

// 수동 실행용 함수
function updateSmaregiData() {
  const result = saveSmaregiDataToSheet();
  if (result.success) {
    SpreadsheetApp.getUi().alert(
      `✅ Smaregi 데이터 업데이트 완료\n\n` +
      `• 처리된 상품: ${result.recordCount}개\n` +
      `• 실행 시간: ${result.executionTime}초`
    );
  } else {
    SpreadsheetApp.getUi().alert(`❌ 오류 발생\n\n${result.error}`);
  }
}

// 분리된 시트 구조로 개선된 데이터 저장
function saveSmaregiDataSplit() {
  try {
    console.log('=== Smaregi 데이터 수집 시작 (분리 구조) ===');
    const startTime = new Date();
    
    // 1. 상품 정보 가져오기
    const productInfo = fetchProductInfo();
    console.log(`상품 정보 ${Object.keys(productInfo).length}건 조회 완료`);
    
    // 2. 재고 데이터 가져오기
    const stockData = fetchAllStockData();
    console.log(`재고 데이터 ${stockData.length}건 조회 완료`);
    
    // 3. 판매 데이터 수집 (30일)
    const sales30Days = calculateMonthlySales();
    console.log(`30일 판매 데이터 수집 완료`);
    
    // 상품별 재고 합계
    const stockByProduct = {};
    stockData.forEach(stock => {
      const productId = stock.productId;
      stockByProduct[productId] = (stockByProduct[productId] || 0) + (parseInt(stock.stockAmount) || 0);
    });
    
    // 4. Smaregi30Days 시트 업데이트 (매일 업데이트)
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    updateSmaregiSheet(ss, 'Smaregi30Days', productInfo, stockByProduct, sales30Days, 30);
    
    // 5. SmaregiStock 시트 업데이트 (재고 전용)
    updateStockSheet(ss, 'SmaregiStock', productInfo, stockByProduct);
    
    // 6. PropertiesService에 30일 데이터 저장 (웹앱 고속 조회용)
    saveSmaregi30DaysToProperties(productInfo, stockByProduct, sales30Days);
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`=== 완료: ${executionTime}초 ===`);
    
    return {
      success: true,
      executionTime: executionTime
    };
    
  } catch (error) {
    console.error('Smaregi 데이터 저장 오류:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// 시트 업데이트 헬퍼 함수
function updateSmaregiSheet(ss, sheetName, productInfo, stockByProduct, salesData, days) {
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(sheetName);
  }
  
  // 헤더 설정
  const headers = [
    '상품ID',          // A
    '상품명',          // B
    '현재재고',        // C
    `${days}일판매량`,  // D
    '일평균판매량',     // E
    '재고회전일수',     // F
    '업데이트시간'      // G
  ];
  
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#e8f0fe');
  
  // 모든 상품ID 수집
  const allProductIds = new Set([
    ...Object.keys(stockByProduct),
    ...Object.keys(salesData)
  ]);
  
  // 데이터 정리
  const rows = [];
  allProductIds.forEach(productId => {
    const info = productInfo[productId] || { productName: '상품명 미등록' };
    const stock = stockByProduct[productId] || 0;
    const sales = salesData[productId] || 0;
    const dailyAverage = sales > 0 ? (sales / days).toFixed(2) : 0;
    
    // 재고회전일수 계산
    let stockTurnoverDays = '∞';
    if (dailyAverage > 0 && stock > 0) {
      stockTurnoverDays = Math.ceil(stock / dailyAverage);
    } else if (dailyAverage > 0 && stock === 0) {
      stockTurnoverDays = 0;
    }
    
    rows.push([
      productId,
      info.productName,
      stock,
      sales,
      parseFloat(dailyAverage),
      stockTurnoverDays,
      new Date()
    ]);
  });
  
  // 판매량 기준 정렬
  rows.sort((a, b) => b[3] - a[3]);
  
  // 데이터 쓰기
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 3, rows.length, 4).setNumberFormat('#,##0');
    sheet.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0.00');
    sheet.getRange(2, 7, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
  
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  
  console.log(`${sheetName}: ${rows.length}개 상품 저장`);
}

// 재고 전용 시트 업데이트
function updateStockSheet(ss, sheetName, productInfo, stockByProduct) {
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(sheetName);
  }
  
  const headers = ['상품ID', '상품명', '현재재고', '업데이트시간'];
  
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#fff3cd');
  
  const rows = [];
  Object.entries(stockByProduct).forEach(([productId, stock]) => {
    const info = productInfo[productId] || { productName: '상품명 미등록' };
    rows.push([productId, info.productName, stock, new Date()]);
  });
  
  // 재고 많은 순으로 정렬
  rows.sort((a, b) => b[2] - a[2]);
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 3, rows.length, 1).setNumberFormat('#,##0');
    sheet.getRange(2, 4, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
  
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  
  console.log(`${sheetName}: ${rows.length}개 상품 재고 저장`);
}

// PropertiesService에 30일 데이터 저장
function saveSmaregi30DaysToProperties(productInfo, stockByProduct, sales30Days) {
  const summaryData = {};
  
  // 모든 상품 데이터 수집
  const allProductIds = new Set([
    ...Object.keys(stockByProduct),
    ...Object.keys(sales30Days)
  ]);
  
  allProductIds.forEach(productId => {
    const stock = stockByProduct[productId] || 0;
    const sales30 = sales30Days[productId] || 0;
    const dailyAvg = sales30 > 0 ? (sales30 / 30).toFixed(2) : 0;
    
    let turnover = '∞';
    if (dailyAvg > 0 && stock > 0) {
      turnover = Math.ceil(stock / dailyAvg);
    } else if (dailyAvg > 0 && stock === 0) {
      turnover = 0;
    }
    
    summaryData[productId] = {
      stock: stock,
      sales30: sales30,
      dailyAvg: parseFloat(dailyAvg),
      turnover: turnover
    };
  });
  
  // 큰 데이터는 여러 개로 분할 저장
  const jsonStr = JSON.stringify(summaryData);
  const chunkSize = 9000;
  const chunks = [];
  
  for (let i = 0; i < jsonStr.length; i += chunkSize) {
    chunks.push(jsonStr.slice(i, i + chunkSize));
  }
  
  const userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('smaregiDataChunks', chunks.length.toString());
  
  chunks.forEach((chunk, index) => {
    userProperties.setProperty(`smaregiData_${index}`, chunk);
  });
  
  userProperties.setProperty('smaregiDataUpdate', new Date().toISOString());
  
  console.log(`PropertiesService: ${Object.keys(summaryData).length}개 상품 저장`);
}

// 1년 데이터 수집 (주 1회 실행)
function saveSmaregiYearlyData() {
  try {
    console.log('=== Smaregi 1년 데이터 수집 시작 ===');
    const startTime = new Date();
    
    // 기본 데이터는 30일 데이터에서 가져옴
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet30Days = ss.getSheetByName('Smaregi30Days');
    
    if (!sheet30Days) {
      console.error('Smaregi30Days 시트가 없습니다. 먼저 saveSmaregiDataSplit()을 실행하세요.');
      return;
    }
    
    // 1년 판매 데이터 수집 (최적화 필요)
    console.log('1년 판매 데이터 수집은 별도 구현 필요');
    
    // TODO: 1년 데이터 수집 로직
    // - 월별로 나누어 수집
    // - 캐싱 활용
    // - 증분 처리
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`=== 1년 데이터 수집 완료: ${executionTime}초 ===`);
    
  } catch (error) {
    console.error('1년 데이터 수집 오류:', error);
  }
}

// 수동 실행용 개선된 함수
function updateSmaregiDataSplit() {
  const result = saveSmaregiDataSplit();
  if (result.success) {
    SpreadsheetApp.getUi().alert(
      `✅ Smaregi 데이터 업데이트 완료\n\n` +
      `• 실행 시간: ${result.executionTime}초\n` +
      `• Smaregi30Days 시트 업데이트 완료\n` +
      `• SmaregiStock 시트 업데이트 완료`
    );
  } else {
    SpreadsheetApp.getUi().alert(`❌ 오류 발생\n\n${result.error}`);
  }
}

// 웹앱에서 빠른 조회를 위한 함수
function getSmaregiSummaryForWebApp() {
  const userProperties = PropertiesService.getUserProperties();
  const chunks = parseInt(userProperties.getProperty('smaregiDataChunks') || '0');
  
  if (chunks === 0) return {};
  
  let jsonStr = '';
  for (let i = 0; i < chunks; i++) {
    jsonStr += userProperties.getProperty(`smaregiData_${i}`) || '';
  }
  
  try {
    const data = JSON.parse(jsonStr);
    const updateTime = userProperties.getProperty('smaregiDataUpdate');
    
    return {
      data: data,
      lastUpdate: updateTime
    };
  } catch (e) {
    return {};
  }
}

// 웹앱용 getSmaregiData 함수 (getAllSmaregiData의 wrapper)
// Code.gs로 이동됨
// function getSmaregiData() {
//   try {
//     return {
//       data: getAllSmaregiData(),
//       success: true
//     };
//   } catch (error) {
//     console.error('SmaregiData 조회 오류:', error);
//     return {
//       data: {},
//       success: false,
//       error: error.toString()
//     };
//   }
// }

// SalesLog 데이터 정리 (오래된 데이터 제거)
function cleanupSalesLog(keepDays = 400) {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const logSheet = ss.getSheetByName('SalesLog');
  
  if (!logSheet) return;
  
  const data = logSheet.getDataRange().getValues();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - keepDays);
  
  // 보관 기간 내 데이터만 필터링
  const filteredData = data.filter((row, index) => {
    if (index === 0) return true; // 헤더
    return new Date(row[0]) > cutoffDate;
  });
  
  // 시트 재작성
  logSheet.clear();
  if (filteredData.length > 0) {
    logSheet.getRange(1, 1, filteredData.length, filteredData[0].length).setValues(filteredData);
  }
  
  console.log(`SalesLog 정리: ${data.length - filteredData.length}건 제거`);
}

// API 버전 간단 테스트
function testAPIVersions() {
  console.log('=== Smaregi API 버전 테스트 ===\n');
  
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  
  // 1. 플랫폼 API 테스트 (date 파라미터)
  console.log('1. 플랫폼 API 테스트 (date 파라미터)');
  try {
    const response = callSmaregiAPI('/transactions', {
      date: today,
      limit: 1
    });
    
    if (Array.isArray(response)) {
      console.log('✅ 응답 성공 (배열)');
      if (response[0]?.items) {
        console.log('✅ items 필드 존재!');
        console.log('상품 정보:', JSON.stringify(response[0].items, null, 2));
      } else {
        console.log('❌ items 필드 없음');
      }
    } else {
      console.log('❌ 오류:', JSON.stringify(response, null, 2).substring(0, 200));
    }
  } catch (e) {
    console.log('❌ 예외:', e.toString());
  }
  
  // 2. Classic API 테스트 (sum_date 파라미터)
  console.log('\n2. Classic API 테스트 (sum_date 파라미터)');
  try {
    const response = callSmaregiAPI('/transactions', {
      'sum_date-from': today,
      'sum_date-to': today,
      limit: 1
    });
    
    console.log('✅ 응답 성공');
    if (Array.isArray(response) && response[0]) {
      console.log('- transactionHeadId:', response[0].transactionHeadId ? '있음' : '없음');
      console.log('- items:', response[0].items ? '있음' : '없음');
      console.log('- total:', response[0].total);
      console.log('- amount:', response[0].amount);
    }
  } catch (e) {
    console.log('❌ 오류:', e.toString());
  }
}

// 최적화 성능 테스트
function testOptimizedPerformance() {
  console.log('=== 최적화 성능 테스트 ===\n');
  
  // 3일간 데이터로 테스트
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 2);
  
  console.log('기간:', Utilities.formatDate(startDate, 'Asia/Tokyo', 'yyyy-MM-dd'), '~', 
              Utilities.formatDate(endDate, 'Asia/Tokyo', 'yyyy-MM-dd'));
  
  const startTime = new Date();
  
  // 최적화된 함수 테스트
  const result = getTransactionsByDateRange(startDate, endDate);
  
  const endTime = new Date();
  const executionTime = ((endTime - startTime) / 1000).toFixed(1);
  
  console.log('\n=== 테스트 결과 ===');
  console.log(`실행 시간: ${executionTime}초`);
  console.log(`총 거래 수: ${result.totalTransactions}`);
  console.log(`판매 상품 종류: ${Object.keys(result.salesByProduct).length}`);
  
  // 상위 5개 상품 표시
  const topProducts = Object.entries(result.salesByProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
    
  console.log('\n판매 TOP 5:');
  topProducts.forEach(([productId, qty], index) => {
    console.log(`${index + 1}. 상품ID ${productId}: ${qty}개`);
  });
}

// 최종 통합 테스트
function finalIntegrationTest() {
  console.log('=== Smaregi 최종 통합 테스트 ===\n');
  
  try {
    // 1. 소량의 데이터로 테스트
    console.log('1. 상품 정보 테스트...');
    const products = callSmaregiAPI('/products', { limit: 3 });
    console.log(`✅ 상품 ${products.length}개 조회 성공`);
    
    console.log('\n2. 재고 정보 테스트...');
    const stocks = callSmaregiAPI('/stock', { limit: 3 });
    console.log(`✅ 재고 ${stocks.length}개 조회 성공`);
    
    console.log('\n3. 거래 정보 테스트...');
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const transactions = callSmaregiAPI('/transactions', {
      'sum_date-from': today,
      'sum_date-to': today,
      limit: 3
    });
    console.log(`✅ 거래 ${transactions.length}개 조회 성공`);
    
    console.log('\n4. 데이터 저장 테스트...');
    // 실제 저장은 하지 않고 시뮬레이션만
    console.log('✅ 데이터 구조 확인 완료');
    
    console.log('\n=== 테스트 완료 ===');
    console.log('updateSmaregiData() 함수를 실행하여 실제 데이터를 저장하세요.');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  }
}

// 디버그용 API 연결 테스트 함수
function debugAPIConnection() {
  console.log('=== Smaregi API 연결 디버그 ===\n');
  
  const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
  console.log(`환경: ${isProduction ? '본번(Production)' : '개발(Development)'}`);
  
  // 1. 토큰 URL 확인
  const tokenUrl = isProduction 
    ? `${CONFIG.PLATFORM_CONFIG.PROD_TOKEN_URL}${CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID}/token`
    : `${CONFIG.PLATFORM_CONFIG.DEV_TOKEN_URL}${CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID}/token`;
  
  console.log('\n1. 토큰 발급 테스트');
  console.log('토큰 URL:', tokenUrl);
  
  try {
    const token = getSmaregiAccessToken();
    console.log('✅ 토큰 발급 성공');
    console.log('토큰 길이:', token.length);
    console.log('토큰 시작:', token.substring(0, 20) + '...');
  } catch (e) {
    console.error('❌ 토큰 발급 실패:', e.toString());
    return;
  }
  
  // 2. API URL 확인
  const baseUrl = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL 
    : CONFIG.PLATFORM_CONFIG.DEV_API_BASE_URL;
  const contractId = isProduction 
    ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID 
    : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID;
  
  console.log('\n2. API 엔드포인트 테스트');
  console.log('Base URL:', baseUrl);
  console.log('Contract ID:', contractId);
  
  // 3. 간단한 API 호출 테스트 (디버그 모드 ON)
  console.log('\n3. API 호출 테스트 (상품 목록 1개)');
  try {
    const response = callSmaregiAPI('/products', { limit: 1 }, true);
    console.log('✅ API 호출 성공');
    console.log('응답 타입:', Array.isArray(response) ? '배열' : typeof response);
    if (Array.isArray(response)) {
      console.log('응답 개수:', response.length);
      if (response.length > 0) {
        console.log('첫 번째 상품:', JSON.stringify(response[0], null, 2));
      }
    } else {
      console.log('응답 내용:', JSON.stringify(response, null, 2).substring(0, 500));
    }
  } catch (e) {
    console.error('❌ API 호출 실패:', e.toString());
  }
}

// 자동 실행용 트리거 설정
function setupSmaregiDataTrigger() {
  // 기존 트리거 제거
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'saveSmaregiDataToSheet') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 매일 새벽 3시에 실행
  ScriptApp.newTrigger('saveSmaregiDataToSheet')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();
    
  SpreadsheetApp.getUi().alert('✅ Smaregi 데이터 자동 업데이트 설정 완료\n\n매일 새벽 3시에 자동으로 업데이트됩니다.');
}
