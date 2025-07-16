/**
 * Smaregi 아카이브 동기화 - 정리된 실행 가능 버전
 * Sales_Recent (30일), Sales_Archive (1년), HotCache (인기 300)
 */

// ===== 1. 시트 구조 초기화 =====
function initializeSheetStructure() {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    '⚠️ 시트 구조 재구성',
    '기존 Sales 데이터를 Recent/Archive로 재구성합니다.\n계속하시겠습니까?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;
  
  try {
    // 1. 기존 Sales 시트 백업
    const salesSheet = ss.getSheetByName('Sales');
    let salesData = [];
    if (salesSheet) {
      salesData = salesSheet.getDataRange().getValues();
      salesSheet.setName('Sales_Backup_' + new Date().getTime());
    }
    
    // 2. Sales_Recent 시트 생성 (30일)
    let recentSheet = ss.getSheetByName('Sales_Recent');
    if (!recentSheet) {
      recentSheet = ss.insertSheet('Sales_Recent');
    } else {
      recentSheet.clear();
    }
    
    const headers = ['transactionId', 'date', 'barcode', 'productName', 'quantity', 'price', 'storeId'];
    recentSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    recentSheet.setFrozenRows(1);
    
    // 3. Sales_Archive 시트 생성 (1년)
    let archiveSheet = ss.getSheetByName('Sales_Archive');
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet('Sales_Archive');
    } else {
      archiveSheet.clear();
    }
    archiveSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    archiveSheet.setFrozenRows(1);
    
    // 4. 기존 데이터 분배
    if (salesData.length > 1) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentData = [];
      const archiveData = [];
      
      for (let i = 1; i < salesData.length; i++) {
        const row = salesData[i];
        const date = new Date(row[1]);
        
        if (date >= thirtyDaysAgo) {
          recentData.push(row);
        } else {
          archiveData.push(row);
        }
      }
      
      if (recentData.length > 0) {
        recentSheet.getRange(2, 1, recentData.length, headers.length).setValues(recentData);
      }
      
      if (archiveData.length > 0) {
        archiveSheet.getRange(2, 1, archiveData.length, headers.length).setValues(archiveData);
      }
    }
    
    // 5. Metadata 시트 생성
    let metaSheet = ss.getSheetByName('Metadata');
    if (!metaSheet) {
      metaSheet = ss.insertSheet('Metadata');
    }
    
    metaSheet.clear();
    const metaHeaders = [
      ['KEY', 'VALUE', 'UPDATED'],
      ['LAST_SYNC_DATE', new Date(), new Date()],
      ['LAST_ARCHIVE_ROTATION', new Date(), new Date()],
      ['ARCHIVE_START_DATE', '', ''],
      ['RECENT_DAYS', 30, new Date()],
      ['ARCHIVE_DAYS', 365, new Date()]
    ];
    metaSheet.getRange(1, 1, metaHeaders.length, 3).setValues(metaHeaders);
    
    ui.alert('✅ 구조 재구성 완료', 
      'Sales_Recent: 최근 30일\nSales_Archive: 30일 이전\nMetadata: 설정 정보', 
      ui.ButtonSet.OK);
    
  } catch (error) {
    console.error('시트 구조 초기화 오류:', error);
    ui.alert('❌ 오류', error.toString(), ui.ButtonSet.OK);
  }
}

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

// OAuth2 토큰 발급
function getSmaregiAccessToken() {
  // 캐시된 토큰 확인
  const cachedToken = getCachedToken();
  if (cachedToken) return cachedToken;
  
  const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
  
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
      console.log('토큰 발급 성공');
      
      // 토큰 캐싱
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

// Smaregi API 호출 헬퍼 함수
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
    console.log('응답 내용:', responseText.substring(0, 500));
  }
  
  if (response.getResponseCode() !== 200) {
    console.error('API 오류:', response.getResponseCode(), responseText);
    return [];
  }
  
  return JSON.parse(responseText);
}

// ===== 2. 월별 데이터 수집 =====
function collectMonthlyData(year, month) {
  const ui = SpreadsheetApp.getUi();
  const monthStr = String(month).padStart(2, '0');
  
  const response = ui.alert(
    `📅 ${year}년 ${month}월 데이터 수집`,
    `${year}년 ${month}월의 판매 데이터를 수집합니다.\n예상 시간: 3-5분\n\n계속하시겠습니까?`,
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;
  
  const startTime = new Date();
  console.log(`=== ${year}년 ${month}월 데이터 수집 시작 ===`);
  
  try {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    
    console.log(`수집 기간: ${Utilities.formatDate(startDate, 'Asia/Tokyo', 'yyyy-MM-dd')} ~ ${Utilities.formatDate(endDate, 'Asia/Tokyo', 'yyyy-MM-dd')}`);
    
    const result = collectSpecificPeriod(startDate, endDate, false);
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    if (result.success) {
      ui.alert(
        `✅ ${year}년 ${month}월 수집 완료`,
        `• 실행 시간: ${executionTime}초\n• 수집된 거래: ${result.newTransactions}건\n• 새로운 데이터: ${result.newRows}건`,
        ui.ButtonSet.OK
      );
    } else {
      ui.alert('❌ 오류', result.error, ui.ButtonSet.OK);
    }
    
  } catch (error) {
    console.error(`${year}년 ${month}월 수집 오류:`, error);
    ui.alert('❌ 오류', error.toString(), ui.ButtonSet.OK);
  }
}

// ===== 3. 특정 기간 데이터 수집 (핵심 함수) =====
function collectSpecificPeriod(startDate, endDate, clearSheet = false, targetSheet = 'auto') {
  const startTime = new Date();
  console.log('=== 특정 기간 데이터 수집 ===');
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    
    // 날짜를 Date 객체로 변환
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    
    // 30일 기준으로 자동 판단
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    let sheetName;
    if (targetSheet === 'auto') {
      // 종료일이 30일 이전이면 모든 데이터가 Archive 대상
      // 시작일이 30일 이내면 일부 또는 전체가 Recent 대상
      if (endDateObj < thirtyDaysAgo) {
        sheetName = 'Sales_Archive';
        console.log(`자동 판단: 전체 기간이 30일 이전 → Archive`);
      } else if (startDateObj >= thirtyDaysAgo) {
        sheetName = 'Sales_Recent';
        console.log(`자동 판단: 전체 기간이 30일 이내 → Recent`);
      } else {
        // 기간이 30일 경계를 걸침 - Recent로 수집 후 로테이션이 자동 정리
        sheetName = 'Sales_Recent';
        console.log(`자동 판단: 기간이 30일 경계를 걸침 → Recent (로테이션이 자동 정리)`);
      }
    } else {
      sheetName = targetSheet;
    }
    
    console.log(`대상 시트: ${sheetName}`);
    let dataSheet = ss.getSheetByName(sheetName);
    
    // 시트가 없으면 생성
    if (!dataSheet) {
      dataSheet = ss.insertSheet(sheetName);
      const headers = ['transactionId', 'date', 'barcode', 'productName', 'quantity', 'price', 'storeId'];
      dataSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      dataSheet.setFrozenRows(1);
      console.log(`${sheetName} 시트를 새로 생성했습니다.`);
    }
    
    if (clearSheet) {
      dataSheet.clear();
      const headers = ['transactionId', 'date', 'barcode', 'productName', 'quantity', 'price', 'storeId'];
      dataSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      dataSheet.setFrozenRows(1);
    }
    
    // 기존 데이터 확인 및 중복 방지
    const existingData = dataSheet.getDataRange().getValues();
    const existingTransactionIds = new Set(existingData.slice(1).map(row => row[0]));
    console.log(`기존 데이터: ${existingData.length - 1}행`);
    
    // API 설정
    const token = getSmaregiAccessToken();
    const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
    const baseUrl = isProduction 
      ? CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL 
      : CONFIG.PLATFORM_CONFIG.DEV_API_BASE_URL;
    const contractId = isProduction 
      ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID 
      : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID;
    
    let totalNewTransactions = 0;
    let totalNewRows = 0;
    const newRows = [];
    
    console.log(`수집 기간: ${startDate} ~ ${endDate}`);
    
    // 날짜 배열 생성
    const datesToProcess = [];
    for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
      datesToProcess.push(new Date(d));
    }
    console.log(`처리할 날짜 수: ${datesToProcess.length}일`);
    
    // 날짜별 처리
    for (const currentDate of datesToProcess) {
      const dateStr = Utilities.formatDate(currentDate, 'Asia/Tokyo', 'yyyy-MM-dd');
      
      try {
        let page = 1;
        let hasMore = true;
        
        while (hasMore) {
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
          
          // 새로운 거래만 처리
          for (const transaction of transactions) {
            if (transaction.transactionHeadId && !existingTransactionIds.has(transaction.transactionHeadId)) {
              // 거래 상세 조회
              const detailsUrl = `${baseUrl}${contractId}/pos/transactions/${transaction.transactionHeadId}/details`;
              const detailsResponse = UrlFetchApp.fetch(detailsUrl, {
                method: 'get',
                headers: {
                  'Authorization': 'Bearer ' + token,
                  'Content-Type': 'application/json'
                },
                muteHttpExceptions: true
              });
              
              if (detailsResponse.getResponseCode() === 200) {
                const details = JSON.parse(detailsResponse.getContentText());
                if (Array.isArray(details)) {
                  details.forEach(item => {
                    newRows.push([
                      transaction.transactionHeadId,
                      dateStr,
                      item.productId || item.productCode || '',
                      item.productName || '',
                      parseInt(item.quantity) || 0,
                      parseFloat(item.price) || 0,
                      item.storeId || ''
                    ]);
                    totalNewRows++;
                  });
                }
              }
              
              totalNewTransactions++;
              existingTransactionIds.add(transaction.transactionHeadId);
              
              if (totalNewTransactions % 50 === 0) {
                console.log(`처리 중... ${totalNewTransactions}건 (${dateStr})`);
              }
              
              Utilities.sleep(100);
            }
          }
          
          if (transactions.length < 1000) {
            hasMore = false;
          } else {
            page++;
          }
        }
        
      } catch (error) {
        console.error(`${dateStr} 처리 중 오류:`, error);
        continue;
      }
      
      // 메모리 관리: 5000건마다 저장
      if (newRows.length > 5000) {
        const lastRow = dataSheet.getLastRow();
        console.log(`중간 저장: ${newRows.length}건을 ${lastRow + 1}행부터 삽입`);
        dataSheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
        newRows.length = 0;
      }
    }
    
    // 남은 데이터 저장
    if (newRows.length > 0) {
      const lastRow = dataSheet.getLastRow();
      console.log(`최종 저장: ${newRows.length}건을 ${lastRow + 1}행부터 삽입`);
      dataSheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    }
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`=== 수집 완료: ${executionTime}초, ${totalNewTransactions}건 거래, ${totalNewRows}건 데이터 ===`);
    
    return {
      success: true,
      newTransactions: totalNewTransactions,
      newRows: totalNewRows,
      executionTime: executionTime
    };
    
  } catch (error) {
    console.error('특정 기간 수집 오류:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// ===== 4. Recent 데이터 압축 =====
function compressRecentData() {
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    '🗜️ Recent 데이터 압축',
    '최근 30일 데이터를 일별/상품별로 집계하여 압축합니다.\n빠른 조회와 분석이 가능해집니다.\n\n계속하시겠습니까?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;
  
  const startTime = new Date();
  console.log('=== Recent 데이터 압축 시작 ===');
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const recentSheet = ss.getSheetByName('Sales_Recent');
    const metaSheet = ss.getSheetByName('Metadata');
    
    if (!recentSheet || recentSheet.getLastRow() <= 1) {
      ui.alert('⚠️', 'Sales_Recent 데이터가 없습니다.', ui.ButtonSet.OK);
      return;
    }
    
    // Recent_Summary 시트 준비
    let summarySheet = ss.getSheetByName('Recent_Summary');
    if (!summarySheet) {
      summarySheet = ss.insertSheet('Recent_Summary');
    } else {
      summarySheet.clear();
    }
    
    const summaryHeaders = ['date', 'barcode', 'productName', 'totalQuantity', 'totalAmount', 'transactionCount'];
    summarySheet.getRange(1, 1, 1, summaryHeaders.length).setValues([summaryHeaders]);
    summarySheet.setFrozenRows(1);
    
    // Recent 데이터 로드 및 집계
    console.log('Recent 데이터 로드 중...');
    const recentData = recentSheet.getDataRange().getValues();
    const dailySummary = {};
    
    for (let i = 1; i < recentData.length; i++) {
      const row = recentData[i];
      const date = row[1];
      const barcode = row[2];
      const productName = row[3];
      const quantity = parseInt(row[4]) || 0;
      const price = parseFloat(row[5]) || 0;
      
      const key = `${date}_${barcode}`;
      
      if (!dailySummary[key]) {
        dailySummary[key] = {
          date: date,
          barcode: barcode,
          productName: productName,
          totalQuantity: 0,
          totalAmount: 0,
          transactionCount: 0
        };
      }
      
      dailySummary[key].totalQuantity += quantity;
      dailySummary[key].totalAmount += (quantity * price);
      dailySummary[key].transactionCount += 1;
    }
    
    // 결과를 배열로 변환
    const summaryRows = Object.values(dailySummary).map(item => [
      item.date,
      item.barcode,
      item.productName,
      item.totalQuantity,
      item.totalAmount,
      item.transactionCount
    ]);
    
    // 날짜와 바코드로 정렬
    summaryRows.sort((a, b) => {
      const dateCompare = new Date(b[0]) - new Date(a[0]);
      if (dateCompare !== 0) return dateCompare;
      // 바코드를 문자열로 변환하여 비교
      return String(a[1]).localeCompare(String(b[1]));
    });
    
    // Summary 시트에 저장
    if (summaryRows.length > 0) {
      summarySheet.getRange(2, 1, summaryRows.length, summaryHeaders.length).setValues(summaryRows);
    }
    
    // 압축 시간 기록
    if (metaSheet) {
      let compressionRow = -1;
      const metaData = metaSheet.getDataRange().getValues();
      for (let i = 0; i < metaData.length; i++) {
        if (metaData[i][0] === 'LAST_COMPRESSION_TIME') {
          compressionRow = i + 1;
          break;
        }
      }
      
      if (compressionRow === -1) {
        const lastRow = metaSheet.getLastRow();
        metaSheet.getRange(lastRow + 1, 1, 1, 3).setValues([['LAST_COMPRESSION_TIME', new Date(), new Date()]]);
      } else {
        metaSheet.getRange(compressionRow, 2, 1, 2).setValues([[new Date(), new Date()]]);
      }
    }
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    // 압축 효과 계산
    const originalRows = recentData.length - 1;
    const compressedRows = summaryRows.length;
    const compressionRatio = ((1 - compressedRows / originalRows) * 100).toFixed(1);
    
    console.log(`\n=== Recent 압축 완료 ===`);
    console.log(`원본: ${originalRows.toLocaleString()}행`);
    console.log(`압축: ${compressedRows.toLocaleString()}행`);
    console.log(`압축률: ${compressionRatio}%`);
    
    // HotCache 업데이트
    updateHotCacheFromRecent();
    
    ui.alert(
      '✅ Recent 압축 완료',
      `• 원본: ${originalRows.toLocaleString()}행\n• 압축: ${compressedRows.toLocaleString()}행\n• 압축률: ${compressionRatio}%\n• 실행 시간: ${executionTime}초\n\nRecent_Summary 시트에 저장되었습니다.`,
      ui.ButtonSet.OK
    );
    
  } catch (error) {
    console.error('Recent 압축 오류:', error);
    ui.alert('❌ 오류', error.toString(), ui.ButtonSet.OK);
  }
}

// ===== 5. HotCache 업데이트 =====
function updateHotCacheFromRecent() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    
    // Recent_Summary가 있으면 사용, 없으면 Sales_Recent 사용
    let sourceSheet = ss.getSheetByName('Recent_Summary');
    let useCompressed = true;
    
    if (!sourceSheet) {
      sourceSheet = ss.getSheetByName('Sales_Recent');
      useCompressed = false;
    }
    
    if (!sourceSheet) return;
    
    const salesData = sourceSheet.getDataRange().getValues();
    const productSales = {};
    
    // 데이터 집계
    if (useCompressed) {
      // 압축 데이터에서 집계
      for (let i = 1; i < salesData.length; i++) {
        const row = salesData[i];
        const barcode = row[1];
        const productName = row[2];
        const quantity = row[3];
        const transactionCount = row[5];
        
        if (!productSales[barcode]) {
          productSales[barcode] = {
            name: productName,
            totalQty: 0,
            frequency: 0
          };
        }
        
        productSales[barcode].totalQty += quantity;
        productSales[barcode].frequency += transactionCount;
      }
    } else {
      // 원본 데이터에서 집계
      for (let i = 1; i < salesData.length; i++) {
        const row = salesData[i];
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
    
    // 상위 300개 선정
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
    
    // PropertiesService 업데이트 (빠른 조회용)
    const hotData = {};
    topProducts.forEach(([barcode, data]) => {
      hotData[barcode] = {
        name: data.name,
        sales30: data.totalQty
      };
    });
    
    PropertiesService.getScriptProperties().setProperty('hotCache', JSON.stringify(hotData));
    
    console.log(`HotCache 업데이트: ${topProducts.length}개 상품 (${useCompressed ? '압축' : '원본'} 데이터 사용)`);
    
  } catch (error) {
    console.error('HotCache 업데이트 오류:', error);
  }
}

// ===== 6. 증분 동기화 (Recent만) =====
function syncIncrementalToRecent() {
  const startTime = new Date();
  console.log('=== Recent 증분 동기화 시작 ===');
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const metaSheet = ss.getSheetByName('Metadata');
    const recentSheet = ss.getSheetByName('Sales_Recent');
    
    const lastSyncDate = new Date(metaSheet.getRange('B2').getValue());
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    console.log(`동기화 기간: ${Utilities.formatDate(lastSyncDate, 'Asia/Tokyo', 'yyyy-MM-dd')} ~ ${Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd')}`);
    
    // Recent용 증분 동기화
    const result = syncIncrementalSales('Sales_Recent');
    
    // 동기화 후 압축 필요 여부 확인
    if (result.success && result.newRows > 0) {
      if (shouldCompressRecent()) {
        console.log('압축 조건 충족 - 증분 압축 실행');
        compressRecentData();
      }
    }
    
    // 동기화 후 로테이션 체크
    const lastRotation = new Date(metaSheet.getRange('B3').getValue() || new Date());
    const daysSinceRotation = (today - lastRotation) / (1000 * 60 * 60 * 24);
    
    if (daysSinceRotation >= 1) {
      console.log('일일 로테이션 실행');
      rotateArchiveData();
    }
    
    return result;
    
  } catch (error) {
    console.error('Recent 동기화 오류:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// 압축 필요 여부 판단
function shouldCompressRecent() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const recentSheet = ss.getSheetByName('Sales_Recent');
    const metaSheet = ss.getSheetByName('Metadata');
    
    if (!recentSheet) return false;
    
    // 현재 행 수
    const totalRows = recentSheet.getLastRow() - 1; // 헤더 제외
    
    // 마지막 압축 시점 확인
    let lastCompressionRow = 4; // LAST_COMPRESSION_TIME 행
    let lastCompressionTime = metaSheet.getRange(lastCompressionRow, 2).getValue();
    
    if (!lastCompressionTime) {
      // 압축 기록이 없으면 현재 시각으로 초기화
      metaSheet.getRange(lastCompressionRow, 1, 1, 3).setValues([['LAST_COMPRESSION_TIME', new Date(), new Date()]]);
      lastCompressionTime = new Date();
    }
    
    // 마지막 압축 이후 경과 시간
    const hoursSinceCompression = (new Date() - new Date(lastCompressionTime)) / (1000 * 60 * 60);
    
    // 압축 조건
    // 1. 3000행 초과
    // 2. 1000행 이상이고 1시간 이상 경과
    // 3. 24시간 이상 경과 (일일 압축)
    if (totalRows > 3000 || 
        (totalRows >= 1000 && hoursSinceCompression >= 1) ||
        hoursSinceCompression >= 24) {
      console.log(`압축 필요: 총 ${totalRows}행, 마지막 압축 ${hoursSinceCompression.toFixed(1)}시간 전`);
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('압축 조건 확인 오류:', error);
    return false;
  }
}

// ===== 7. 증분 판매 데이터 동기화 =====
function syncIncrementalSales(targetSheet = 'Sales_Recent') {
  const startTime = new Date();
  console.log(`=== ${targetSheet} 증분 동기화 시작 ===`);
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const metaSheet = ss.getSheetByName('Metadata');
    const lastSyncDate = new Date(metaSheet.getRange('B2').getValue());
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    console.log(`동기화 기간: ${Utilities.formatDate(lastSyncDate, 'Asia/Tokyo', 'yyyy-MM-dd')} ~ ${Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd')}`);
    
    // 대상 시트 준비
    let salesSheet = ss.getSheetByName(targetSheet);
    if (!salesSheet) {
      salesSheet = ss.insertSheet(targetSheet);
      const headers = ['transactionId', 'date', 'barcode', 'productName', 'quantity', 'price', 'storeId'];
      salesSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      salesSheet.setFrozenRows(1);
    }
    
    const existingData = salesSheet.getDataRange().getValues();
    const existingTransactionIds = new Set(existingData.slice(1).map(row => row[0]));
    
    // API 설정
    const token = getSmaregiAccessToken();
    const isProduction = CONFIG.PLATFORM_CONFIG.USE_PRODUCTION;
    const baseUrl = isProduction 
      ? CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL 
      : CONFIG.PLATFORM_CONFIG.DEV_API_BASE_URL;
    const contractId = isProduction 
      ? CONFIG.PLATFORM_CONFIG.PROD_CONTRACT_ID 
      : CONFIG.PLATFORM_CONFIG.DEV_CONTRACT_ID;
    
    let totalNewTransactions = 0;
    const newRows = [];
    
    for (let d = new Date(lastSyncDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dateStr = Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy-MM-dd');
      
      try {
        let page = 1;
        let hasMore = true;
        
        while (hasMore) {
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
          
          const newTransactions = transactions.filter(t => 
            t.transactionHeadId && !existingTransactionIds.has(t.transactionHeadId)
          );
          
          if (newTransactions.length > 0) {
            const transactionIds = newTransactions.map(t => t.transactionHeadId);
            
            for (let i = 0; i < transactionIds.length; i += 10) {
              const batch = transactionIds.slice(i, i + 10);
              
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
    
    // 새로운 데이터 저장
    if (newRows.length > 0) {
      const lastRow = salesSheet.getLastRow();
      salesSheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
      console.log(`새로운 판매 데이터 ${newRows.length}건 저장`);
    }
    
    // 마지막 동기화 날짜 업데이트
    metaSheet.getRange('B2').setValue(Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd'));
    metaSheet.getRange('C2').setValue(new Date());
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`=== 증분 동기화 완료: ${executionTime}초, ${totalNewTransactions}건 거래 ===`);
    
    // HotCache 업데이트 (Recent 기반)
    if (targetSheet === 'Sales_Recent') {
      updateHotCacheFromRecent();
    }
    
    return {
      success: true,
      newTransactions: totalNewTransactions,
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

// ===== 8. 데이터 로테이션 =====
function rotateArchiveData() {
  console.log('=== 데이터 로테이션 시작 ===');
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const recentSheet = ss.getSheetByName('Sales_Recent');
    const archiveSheet = ss.getSheetByName('Sales_Archive');
    const metaSheet = ss.getSheetByName('Metadata');
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Recent 시트에서 30일 이상 된 데이터 찾기
    const recentData = recentSheet.getDataRange().getValues();
    const toArchive = [];
    const toKeep = [recentData[0]]; // 헤더
    
    for (let i = 1; i < recentData.length; i++) {
      const row = recentData[i];
      const date = new Date(row[1]);
      
      if (date < thirtyDaysAgo) {
        toArchive.push(row);
      } else {
        toKeep.push(row);
      }
    }
    
    // Archive로 이동
    if (toArchive.length > 0) {
      const archiveLastRow = archiveSheet.getLastRow();
      archiveSheet.getRange(archiveLastRow + 1, 1, toArchive.length, toArchive[0].length).setValues(toArchive);
      console.log(`${toArchive.length}건을 Archive로 이동`);
      
      // Recent 시트 재구성
      recentSheet.clear();
      recentSheet.getRange(1, 1, toKeep.length, toKeep[0].length).setValues(toKeep);
    }
    
    // 로테이션 날짜 업데이트
    metaSheet.getRange('B3').setValue(new Date());
    metaSheet.getRange('C3').setValue(new Date());
    
    // HotCache 업데이트
    updateHotCacheFromRecent();
    
    console.log('=== 데이터 로테이션 완료 ===');
    
  } catch (error) {
    console.error('로테이션 오류:', error);
  }
}

// ===== 9. 데이터 검증 =====
function verifyArchiveData() {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  
  console.log('=== 아카이브 데이터 검증 ===');
  
  // Sales_Recent 확인
  const recentSheet = ss.getSheetByName('Sales_Recent');
  if (recentSheet) {
    const recentCount = recentSheet.getLastRow() - 1;
    console.log(`\nSales_Recent: ${recentCount}건`);
  }
  
  // Sales_Archive 확인
  const archiveSheet = ss.getSheetByName('Sales_Archive');
  if (archiveSheet) {
    const archiveCount = archiveSheet.getLastRow() - 1;
    console.log(`Sales_Archive: ${archiveCount}건`);
  }
  
  // Recent_Summary 확인
  const summarySheet = ss.getSheetByName('Recent_Summary');
  if (summarySheet) {
    const summaryCount = summarySheet.getLastRow() - 1;
    console.log(`Recent_Summary: ${summaryCount}건 (압축됨)`);
  }
  
  // HotCache 확인
  const hotSheet = ss.getSheetByName('HotCache');
  if (hotSheet) {
    const hotCount = hotSheet.getLastRow() - 1;
    console.log(`HotCache: ${hotCount}개 인기 상품`);
  }
  
  // Metadata 확인
  const metaSheet = ss.getSheetByName('Metadata');
  if (metaSheet) {
    console.log('\n메타데이터:');
    const metaData = metaSheet.getRange('A1:C6').getValues();
    metaData.forEach(row => {
      if (row[0] && row[0] !== 'KEY') {
        console.log(`${row[0]}: ${row[1]}`);
      }
    });
  }
  
  console.log('\n=== 검증 완료 ===');
}

// ===== 10. 메뉴 추가 =====
function addArchiveMenu() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('Smaregi 관리')  // "데이터 관리"와 다른 이름으로 변경
      .addItem('1. 시트 구조 초기화', 'initializeSheetStructure')
      .addItem('2. 월별 데이터 수집', 'showMonthPicker')
      .addItem('2-1. 기간 지정 수집', 'collectCustomPeriod')
      .addSeparator()
      .addItem('3. Recent 데이터 압축', 'compressRecentData')
      .addItem('4. Recent 동기화', 'syncIncrementalToRecent')
      .addSeparator()
      .addItem('5. 데이터 검증', 'verifyArchiveData')
      .addItem('6. 수동 로테이션', 'rotateArchiveData')
      .addSeparator()
      .addItem('7. SmaregiData 업데이트', 'updateIntegratedSmaregiData')
      .addItem('8. 자동 압축 설정', 'setupCompressionTrigger')
      .addSeparator()
      .addItem('⏰ 실시간 동기화 설정 (5분마다)', 'setupRealtimeSyncTriggers')
      .addItem('🛑 실시간 동기화 중지', 'removeRealtimeSyncTriggers')
      .addToUi();
    
    console.log('Smaregi 관리 메뉴가 추가되었습니다.');
  } catch (e) {
    console.log('메뉴 추가 스킵:', e);
  }
}


// ===== 11. 자동 압축 관리 =====
// UI 없는 압축 함수 (자동 실행용)
function compressRecentDataSilent() {
  // 압축 조건 확인
  if (!shouldCompressRecent()) {
    console.log('압축 조건 미충족 - 스킵');
    return;
  }
  
  const startTime = new Date();
  console.log('=== 자동 Recent 압축 시작 ===');
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const recentSheet = ss.getSheetByName('Sales_Recent');
    const metaSheet = ss.getSheetByName('Metadata');
    
    if (!recentSheet || recentSheet.getLastRow() <= 1) {
      console.log('Recent 데이터 없음 - 압축 스킵');
      return;
    }
    
    // Recent_Summary 시트 준비
    let summarySheet = ss.getSheetByName('Recent_Summary');
    if (!summarySheet) {
      summarySheet = ss.insertSheet('Recent_Summary');
    } else {
      summarySheet.clear();
    }
    
    const summaryHeaders = ['date', 'barcode', 'productName', 'totalQuantity', 'totalAmount', 'transactionCount'];
    summarySheet.getRange(1, 1, 1, summaryHeaders.length).setValues([summaryHeaders]);
    summarySheet.setFrozenRows(1);
    
    // Recent 데이터 로드 및 집계
    const recentData = recentSheet.getDataRange().getValues();
    const dailySummary = {};
    
    for (let i = 1; i < recentData.length; i++) {
      const row = recentData[i];
      const date = row[1];
      const barcode = row[2];
      const productName = row[3];
      const quantity = parseInt(row[4]) || 0;
      const price = parseFloat(row[5]) || 0;
      
      const key = `${date}_${barcode}`;
      
      if (!dailySummary[key]) {
        dailySummary[key] = {
          date: date,
          barcode: barcode,
          productName: productName,
          totalQuantity: 0,
          totalAmount: 0,
          transactionCount: 0
        };
      }
      
      dailySummary[key].totalQuantity += quantity;
      dailySummary[key].totalAmount += (quantity * price);
      dailySummary[key].transactionCount += 1;
    }
    
    // 결과 저장
    const summaryRows = Object.values(dailySummary).map(item => [
      item.date,
      item.barcode,
      item.productName,
      item.totalQuantity,
      item.totalAmount,
      item.transactionCount
    ]);
    
    // 날짜와 바코드로 정렬
    summaryRows.sort((a, b) => {
      const dateCompare = new Date(b[0]) - new Date(a[0]);
      if (dateCompare !== 0) return dateCompare;
      // 바코드를 문자열로 변환하여 비교
      return String(a[1]).localeCompare(String(b[1]));
    });
    
    if (summaryRows.length > 0) {
      summarySheet.getRange(2, 1, summaryRows.length, summaryHeaders.length).setValues(summaryRows);
    }
    
    // 압축 시간 기록
    if (metaSheet) {
      let compressionRow = -1;
      const metaData = metaSheet.getDataRange().getValues();
      for (let i = 0; i < metaData.length; i++) {
        if (metaData[i][0] === 'LAST_COMPRESSION_TIME') {
          compressionRow = i + 1;
          break;
        }
      }
      
      if (compressionRow === -1) {
        const lastRow = metaSheet.getLastRow();
        metaSheet.getRange(lastRow + 1, 1, 1, 3).setValues([['LAST_COMPRESSION_TIME', new Date(), new Date()]]);
      } else {
        metaSheet.getRange(compressionRow, 2, 1, 2).setValues([[new Date(), new Date()]]);
      }
    }
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    // 압축 효과 계산
    const originalRows = recentData.length - 1;
    const compressedRows = summaryRows.length;
    const compressionRatio = ((1 - compressedRows / originalRows) * 100).toFixed(1);
    
    console.log(`자동 압축 완료: ${originalRows}행 → ${compressedRows}행 (${compressionRatio}% 압축, ${executionTime}초)`);
    
    // HotCache 업데이트
    updateHotCacheFromRecent();
    
  } catch (error) {
    console.error('자동 압축 오류:', error);
  }
}

// 압축 트리거 설정
function setupCompressionTrigger() {
  // 기존 압축 트리거 제거
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoCompressRecent') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 거래량에 따라 트리거 설정
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const recentSheet = ss.getSheetByName('Sales_Recent');
  
  if (recentSheet) {
    const rowCount = recentSheet.getLastRow() - 1;
    const avgDailyRows = rowCount / 30; // 평균 일일 행 수
    
    if (avgDailyRows >= 1000) {
      // 거래량 많음: 1시간마다
      ScriptApp.newTrigger('compressRecentDataSilent')
        .timeBased()
        .everyHours(1)
        .create();
      console.log('압축 트리거 설정: 1시간마다 (높은 거래량)');
    } else if (avgDailyRows >= 100) {
      // 보통: 새벽 3시
      ScriptApp.newTrigger('compressRecentDataSilent')
        .timeBased()
        .atHour(3)
        .everyDays(1)
        .create();
      console.log('압축 트리거 설정: 매일 새벽 3시 (보통 거래량)');
    } else {
      // 적음: 트리거 없음 (수동 압축)
      console.log('압축 트리거 설정 안함 (낮은 거래량)');
    }
  }
  
  SpreadsheetApp.getUi().alert(
    '✅ 압축 트리거 설정 완료',
    '거래량에 따라 자동 압축이 설정되었습니다.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ===== API 테스트 함수 =====
function testSmaregiAPI() {
  console.log('=== Smaregi API 테스트 ===');
  
  try {
    // 1. 토큰 테스트
    console.log('\n1. 토큰 발급 테스트...');
    const token = getSmaregiAccessToken();
    console.log('✅ 토큰 발급 성공');
    console.log('토큰 시작:', token.substring(0, 20) + '...');
    
    // 2. 오늘 날짜로 거래 조회
    console.log('\n2. 거래 조회 테스트...');
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    console.log('조회 날짜:', today);
    
    const response = callSmaregiAPI('/transactions', {
      'sum_date-from': today,
      'sum_date-to': today,
      page: 1,
      limit: 10
    }, true); // 디버그 모드 ON
    
    console.log('\n거래 데이터:', JSON.stringify(response));
    
    // 3. 최근 30일 테스트
    console.log('\n3. 최근 30일 데이터 확인...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = Utilities.formatDate(thirtyDaysAgo, 'Asia/Tokyo', 'yyyy-MM-dd');
    
    const recentResponse = callSmaregiAPI('/transactions', {
      'sum_date-from': fromDate,
      'sum_date-to': today,
      page: 1,
      limit: 1
    });
    
    console.log('최근 30일 거래 존재:', Array.isArray(recentResponse) && recentResponse.length > 0);
    
    return '테스트 완료';
    
  } catch (error) {
    console.error('API 테스트 실패:', error);
    return error.toString();
  }
}

// ===== 12. 기간 지정 수집 =====
function collectCustomPeriod() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    '기간 지정 수집',
    '시작일~종료일을 입력하세요\n예: 2025-06-01~2025-06-15',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (result.getSelectedButton() !== ui.Button.OK) return;
  
  const input = result.getResponseText();
  const [dateFrom, dateTo] = input.split('~').map(s => s.trim());
  
  if (!dateFrom || !dateTo) {
    ui.alert('❌ 오류', '올바른 형식으로 입력하세요.\n예: 2025-06-01~2025-06-15', ui.ButtonSet.OK);
    return;
  }
  
  // 날짜 유효성 검사
  const startDate = new Date(dateFrom);
  const endDate = new Date(dateTo);
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    ui.alert('❌ 오류', '올바른 날짜 형식이 아닙니다.', ui.ButtonSet.OK);
    return;
  }
  
  if (startDate > endDate) {
    ui.alert('❌ 오류', '시작일이 종료일보다 늦습니다.', ui.ButtonSet.OK);
    return;
  }
  
  ui.alert(
    '🔄 수집 시작',
    `${dateFrom} ~ ${dateTo} 데이터를 수집합니다.\n예상 시간: 1-3분`,
    ui.ButtonSet.OK
  );
  
  try {
    const result = collectSpecificPeriod(dateFrom, dateTo);
    
    if (result.success) {
      ui.alert(
        '✅ 수집 완료',
        `• 기간: ${dateFrom} ~ ${dateTo}\n• 거래: ${result.newTransactions}건\n• 데이터: ${result.newRows}건\n• 실행 시간: ${result.executionTime}초`,
        ui.ButtonSet.OK
      );
    } else {
      ui.alert('❌ 오류', result.error, ui.ButtonSet.OK);
    }
  } catch (error) {
    ui.alert('❌ 오류', error.toString(), ui.ButtonSet.OK);
  }
}

// ===== 13. 월 선택 UI =====
function showMonthPicker() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    '월별 데이터 수집',
    '수집할 연월을 입력하세요 (예: 2025-06):',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (result.getSelectedButton() === ui.Button.OK) {
    const input = result.getResponseText();
    const match = input.match(/(\d{4})-(\d{1,2})/);
    
    if (match) {
      const year = parseInt(match[1]);
      const month = parseInt(match[2]);
      collectMonthlyData(year, month);
    } else {
      ui.alert('⚠️', '올바른 형식으로 입력하세요 (예: 2025-06)', ui.ButtonSet.OK);
    }
  }
}

// ===== 14. 통합 SmaregiData 업데이트 =====
function updateIntegratedSmaregiData() {
  const startTime = new Date();
  console.log('=== 통합 SmaregiData 업데이트 시작 ===');
  
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    
    // 1. 재고 데이터 가져오기 (API)
    console.log('재고 데이터 조회 중...');
    const stockData = fetchAllStockData();
    const stockByProduct = {};
    let excludedCount = 0;
    
    stockData.forEach(stock => {
      const productId = String(stock.productId);
      // 13자리 바코드는 제외
      if (productId.length === 13) {
        excludedCount++;
        return;
      }
      stockByProduct[productId] = (stockByProduct[productId] || 0) + (parseInt(stock.stockAmount) || 0);
    });
    
    console.log(`재고 데이터 ${Object.keys(stockByProduct).length}개 상품 조회 완료`);
    if (excludedCount > 0) {
      console.log(`(13자리 바코드 ${excludedCount}개 제외됨)`);
    }
    
    // 2. 판매 데이터 집계 (Archive 시스템)
    console.log('판매 데이터 집계 중...');
    const recentSheet = ss.getSheetByName('Sales_Recent');
    const archiveSheet = ss.getSheetByName('Sales_Archive');
    const hotCacheSheet = ss.getSheetByName('HotCache');
    
    // 30일 판매량 (Sales_Recent)
    const sales30Days = {};
    if (recentSheet && recentSheet.getLastRow() > 1) {
      const recentData = recentSheet.getRange(2, 1, recentSheet.getLastRow() - 1, 7).getValues();
      recentData.forEach(row => {
        const barcode = String(row[2]);
        const quantity = parseFloat(row[4]) || 0;
        sales30Days[barcode] = (sales30Days[barcode] || 0) + quantity;
      });
    }
    
    // 1년 판매량 (Archive + Recent)
    const sales365Days = {};
    // Archive 데이터
    if (archiveSheet && archiveSheet.getLastRow() > 1) {
      const archiveData = archiveSheet.getRange(2, 1, archiveSheet.getLastRow() - 1, 7).getValues();
      archiveData.forEach(row => {
        const barcode = String(row[2]);
        const quantity = parseFloat(row[4]) || 0;
        sales365Days[barcode] = (sales365Days[barcode] || 0) + quantity;
      });
    }
    // Recent 데이터 추가
    Object.entries(sales30Days).forEach(([barcode, qty]) => {
      sales365Days[barcode] = (sales365Days[barcode] || 0) + qty;
    });
    
    // 3. 인기 순위 데이터 (HotCache)
    const popularityRank = {};
    if (hotCacheSheet && hotCacheSheet.getLastRow() > 1) {
      const hotData = hotCacheSheet.getRange(2, 1, hotCacheSheet.getLastRow() - 1, 3).getValues();
      hotData.forEach((row, index) => {
        const barcode = String(row[0]);
        popularityRank[barcode] = index + 1;
      });
    }
    
    // 4. 상품 정보 가져오기
    console.log('상품 정보 조회 중...');
    const productInfo = fetchProductInfo();
    
    // 5. SmaregiData 시트 업데이트
    let smaregiSheet = ss.getSheetByName('SmaregiData');
    if (!smaregiSheet) {
      smaregiSheet = ss.insertSheet('SmaregiData');
    } else {
      smaregiSheet.clear();
    }
    
    // 헤더 설정
    const headers = [
      '상품ID',      // A
      '상품명',      // B
      '현재재고',    // C
      '30일 판매량', // D
      '1년 판매량',  // E
      '일평균판매량', // F
      '재고회전일수', // G
      '인기순위',    // H
      '업데이트시간' // I
    ];
    
    const headerRange = smaregiSheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f3f3f3');
    smaregiSheet.setFrozenRows(1);
    
    // 6. 데이터 정리
    const allBarcodes = new Set([
      ...Object.keys(stockByProduct),
      ...Object.keys(sales30Days),
      ...Object.keys(sales365Days)
    ]);
    
    const rows = [];
    let skippedCount = 0;
    
    allBarcodes.forEach(productId => {
      // 13자리 바코드는 SmaregiData에서도 제외
      if (productId.length === 13) {
        skippedCount++;
        return;
      }
      const info = productInfo[productId] || { productName: '상품명 미등록' };
      const stock = stockByProduct[productId] || 0;
      const sales30 = sales30Days[productId] || 0;
      const sales365 = sales365Days[productId] || 0;
      const dailyAverage = sales365 / 365;
      
      let stockTurnoverDays = '∞';
      if (dailyAverage > 0 && stock > 0) {
        stockTurnoverDays = Math.ceil(stock / dailyAverage);
      } else if (dailyAverage > 0 && stock === 0) {
        stockTurnoverDays = 0;
      }
      
      const rank = popularityRank[productId] || '-';
      
      rows.push([
        productId,                    // A: 상품ID
        info.productName,            // B: 상품명
        stock,                       // C: 현재재고
        Math.round(sales30),         // D: 30일 판매량
        Math.round(sales365),        // E: 1년 판매량
        dailyAverage.toFixed(2),     // F: 일평균판매량
        stockTurnoverDays,           // G: 재고회전일수
        rank,                        // H: 인기순위
        new Date()                   // I: 업데이트시간
      ]);
    });
    
    // 인기순위로 정렬 (순위가 있는 것 우선)
    rows.sort((a, b) => {
      if (a[7] === '-' && b[7] === '-') return 0;
      if (a[7] === '-') return 1;
      if (b[7] === '-') return -1;
      return a[7] - b[7];
    });
    
    // 7. 시트에 저장
    if (rows.length > 0) {
      smaregiSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    
    const endTime = new Date();
    const executionTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`=== SmaregiData 업데이트 완료 ===`);
    console.log(`- 상품 수: ${rows.length}개`);
    if (skippedCount > 0) {
      console.log(`- 제외된 13자리 바코드: ${skippedCount}개`);
    }
    console.log(`- 실행 시간: ${executionTime}초`);
    
    let alertMessage = `• 상품 수: ${rows.length}개\n• 실행 시간: ${executionTime}초`;
    if (skippedCount > 0) {
      alertMessage += `\n• 제외된 13자리 바코드: ${skippedCount}개`;
    }
    
    SpreadsheetApp.getUi().alert(
      '✅ SmaregiData 업데이트 완료',
      alertMessage,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    
    return {
      success: true,
      productCount: rows.length,
      executionTime: executionTime
    };
    
  } catch (error) {
    console.error('SmaregiData 업데이트 오류:', error);
    SpreadsheetApp.getUi().alert('❌ 오류', error.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
    throw error;
  }
}

// 재고 데이터 가져오기 (SmaregiSync.gs에서 가져옴)
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
        limit: 1000
      });
      
      if (response && response.length > 0) {
        response.forEach(product => {
          productInfo[product.productId] = {
            productId: product.productId,
            productName: product.productName,
            productCode: product.productCode
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

// ===== 간단한 테스트 함수 =====
function testSmaregiConnection() {
  console.log('=== Smaregi 연결 테스트 ===');
  
  try {
    const token = getSmaregiAccessToken();
    console.log('✅ 토큰 발급 성공');
    
    // 간단한 API 호출 테스트
    const response = callSmaregiAPI('/products', { limit: 1 });
    console.log('✅ API 호출 성공');
    console.log('응답:', JSON.stringify(response).substring(0, 200));
    
    return 'Smaregi 연결 테스트 성공!';
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
    return error.toString();
  }
}

