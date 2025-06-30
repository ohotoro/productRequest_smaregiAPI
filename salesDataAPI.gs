// ===== salesDataAPI.gs - 판매 데이터 조회 및 분석 =====

/**
 * 여러 상품의 판매 데이터 일괄 조회 (바코드 매핑 포함)
 * @param {Array} barcodes - 바코드 배열
 * @param {number} days - 조회 기간 (일)
 * @returns {Array} 판매 데이터 배열
 */
function getBatchSalesData(barcodes, period = 30) {
  try {
    console.log(`=== 배치 판매 데이터 조회: ${barcodes.length}개, ${period}일 ===`);
    
    const result = {
      success: true,
      data: {},
      fromCache: {},
      refreshing: []
    };
    
    // 1. 캐시 확인 - 캐시 시간 단축
    const cache = CacheService.getScriptCache();
    const uncachedBarcodes = [];
    
    barcodes.forEach(barcode => {
      const cacheKey = `sales_${barcode}_${period}`;
      const cached = cache.get(cacheKey);
      
      if (cached) {
        try {
          const parsedCache = JSON.parse(cached);
          
          // 캐시 유효성 검사 강화
          const cacheAge = (new Date() - new Date(parsedCache.timestamp)) / 1000 / 60; // 분
          
          if (cacheAge < 30) { // 30분 이내만 사용
            result.data[barcode] = parsedCache.data || parsedCache;
            result.fromCache[barcode] = true;
          } else {
            uncachedBarcodes.push(barcode);
          }
        } catch (e) {
          console.error(`캐시 파싱 오류 (${barcode}):`, e);
          uncachedBarcodes.push(barcode);
        }
      } else {
        uncachedBarcodes.push(barcode);
      }
    });
    
    console.log(`캐시 적중: ${barcodes.length - uncachedBarcodes.length}/${barcodes.length}`);
    
    // 2. 캐시 없는 것만 조회
    if (uncachedBarcodes.length > 0) {
      console.log(`API 조회 필요: ${uncachedBarcodes.length}개`);
      
      // API 조회
      const salesData = loadSalesDataForBarcodes(uncachedBarcodes, period);
      
      uncachedBarcodes.forEach(barcode => {
        const data = salesData[barcode] || {
          quantity: 0,
          avgDaily: 0,
          amount: 0,
          trend: 'stable',
          transactions: []
        };
        
        result.data[barcode] = data;
        result.fromCache[barcode] = false;
        
        // 스마트 캐시 저장
        const cacheData = {
          data: data,
          timestamp: new Date().toISOString()
        };
        const productType = getProductCacheType(barcode);
        setSmartCache(`sales_${barcode}_${period}`, JSON.stringify(cacheData), productType);
      });
    }
    
    console.log(`판매 데이터 반환: ${Object.keys(result.data).length}개`);
    return result;
    
  } catch (error) {
    console.error('배치 판매 데이터 조회 실패:', error);
    return { 
      success: false, 
      error: error.toString(),
      data: {}
    };
  }
}

// ===== 백그라운드 갱신 함수 =====

/**
 * 백그라운드 갱신 실행
 */
function executeBackgroundRefresh() {
  try {
    const userProperties = PropertiesService.getUserProperties();
    const pendingData = userProperties.getProperty('PENDING_REFRESH');
    
    if (!pendingData) {
      return { success: false, message: '갱신할 데이터 없음' };
    }
    
    const { barcodes, period = 30 } = JSON.parse(pendingData);
    userProperties.deleteProperty('PENDING_REFRESH');
    
    console.log(`백그라운드 갱신 시작: ${barcodes.length}개`);
    
    // 실제 데이터 조회
    const salesData = loadSalesDataForBarcodes(barcodes, period);
    
    // 캐시 업데이트 (공유 캐시 사용)
    const cache = CacheService.getScriptCache(); // 변경
    const refreshedData = {};
    
    barcodes.forEach(barcode => {
      const data = salesData[barcode] || {
        quantity: 0,
        avgDaily: 0,
        amount: 0,
        trend: 'stable'
      };
      
      refreshedData[barcode] = data;
      
      // 스마트 캐시 저장
      const cacheData = {
        data: data,
        timestamp: new Date().toISOString()
      };
      const productType = getProductCacheType(barcode);
      setSmartCache(`sales_${barcode}_${period}`, JSON.stringify(cacheData), productType);
    });
    
    console.log(`백그라운드 갱신 완료: ${Object.keys(refreshedData).length}개`);
    
    return {
      success: true,
      data: refreshedData,
      count: Object.keys(refreshedData).length
    };
    
  } catch (error) {
    console.error('백그라운드 갱신 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// 백그라운드 갱신 트리거
function triggerBackgroundRefresh(barcodes, period = 30) {
  try {
    // 현재 시간 확인
    const currentHour = new Date().getHours();
    
    // 20시 이후는 갱신하지 않음
    if (currentHour >= 20 || currentHour < 6) {
      console.log('야간 시간대 - 백그라운드 갱신 스킵');
      return { success: false, message: '야간 시간대' };
    }
    
    // 갱신 요청 저장
    const userProperties = PropertiesService.getUserProperties();
    userProperties.setProperty('PENDING_REFRESH', JSON.stringify({
      barcodes: barcodes,
      period: period,
      timestamp: new Date().toISOString()
    }));
    
    // 비동기 실행을 위해 지연 실행
    Utilities.sleep(100);
    
    // 실제 갱신 실행
    return executeBackgroundRefresh();
    
  } catch (error) {
    console.error('백그라운드 갱신 트리거 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// salesDataAPI.gs의 getProductSalesData 함수 수정
// 함수 시작 부분에 캐시 확인 추가

function getProductSalesData(barcode) {
  try {
    if (!barcode) {
      return {
        success: false,
        message: '바코드가 없습니다'
      };
    }
    
    console.log(`개별 판매 데이터 조회: ${barcode}`);
    
    // 캐시 확인
    const cacheKey = `sales_individual_${barcode}`;
    const cached = getCache(cacheKey);
    if (cached) {
      console.log(`개별 판매 데이터 캐시 사용: ${barcode}`);
      return cached;
    }
    
    // API 연결 확인
    if (!isSmaregiAvailable()) {
      return {
        success: false,
        message: 'Smaregi API가 연결되지 않았습니다'
      };
    }
    
    // 설정에서 기간 가져오기
    const settings = getSettings();
    const shortPeriod = parseInt(settings.salesPeriodShort) || 7;
    const longPeriod = parseInt(settings.salesPeriodLong) || 30;
    
    // 바코드 = 제품코드 (Smaregi에서는 동일)
    const productCode = barcode;
    
    console.log(`바코드/제품코드: ${productCode}`);
    
    // Platform API로 직접 조회
    const stores = getPlatformStores();
    if (!stores || stores.length === 0) {
      return { success: false, message: '매장 정보 없음' };
    }
    
    const storeId = stores[0].storeId;
    
    // 날짜 설정
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - longPeriod);
    
    const dateFrom = Utilities.formatDate(startDate, 'GMT+9', "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
    const dateTo = Utilities.formatDate(endDate, 'GMT+9', "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
    
    // 거래 목록 조회
    let allTransactions = [];
    let page = 1;
    const limit = 100;
    
    while (page <= 3) { // 최대 300개
      const params = [
        `store_id=${storeId}`,
        `transaction_date_time-from=${encodeURIComponent(dateFrom)}`,
        `transaction_date_time-to=${encodeURIComponent(dateTo)}`,
        `limit=${limit}`,
        `page=${page}`
      ].join('&');
      
      const endpoint = `pos/transactions?${params}`;
      const result = callPlatformAPI(endpoint);
      
      if (!result.success || !result.data || result.data.length === 0) break;
      
      allTransactions.push(...result.data);
      
      if (result.data.length < limit) break;
      page++;
    }
    
    console.log(`${allTransactions.length}개 거래에서 검색`);
    
    // 해당 상품의 판매 데이터 수집
    let totalQuantity = 0;
    let totalAmount = 0;
    const transactions = [];
    let shortQuantity = 0;
    
    const shortDateAgo = new Date();
    shortDateAgo.setDate(shortDateAgo.getDate() - shortPeriod);
    
    // 토큰 가져오기
    const token = getPlatformAccessToken();
    if (!token) {
      return { success: false, message: '인증 실패' };
    }
    
    // 배치로 거래 상세 조회
    const BATCH_SIZE = 20;
    for (let i = 0; i < allTransactions.length; i += BATCH_SIZE) {
      const batch = allTransactions.slice(i, Math.min(i + BATCH_SIZE, allTransactions.length));
      
      const requests = batch.map(transaction => {
        const transId = transaction.transactionHeadId;
        if (!transId) return null;
        
        return {
          url: `${CONFIG.PLATFORM_CONFIG.PROD_API_BASE_URL}${CONFIG.SMAREGI.CONTRACT_ID}/pos/transactions/${transId}/details`,
          headers: {
            'Authorization': `Bearer ${token.access_token}`,
            'Content-Type': 'application/json'
          },
          muteHttpExceptions: true
        };
      }).filter(req => req !== null);
      
      if (requests.length === 0) continue;
      
      try {
        const responses = UrlFetchApp.fetchAll(requests);
        
        responses.forEach((response, index) => {
          if (response.getResponseCode() === 200) {
            const details = JSON.parse(response.getContentText());
            
            if (Array.isArray(details)) {
              details.forEach(detail => {
                if (detail.productCode === productCode) {
                  const quantity = parseInt(detail.quantity || 0);
                  const amount = parseFloat(detail.salesAmount || detail.subtotal || 0);
                  const transDate = new Date(batch[index].transactionDateTime);
                  
                  totalQuantity += quantity;
                  totalAmount += amount;
                  
                  // 단기 판매량 계산
                  if (transDate >= shortDateAgo) {
                    shortQuantity += quantity;
                  }
                  
                  transactions.push({
                    date: batch[index].transactionDateTime,
                    quantity: quantity,
                    amount: amount
                  });
                }
              });
            }
          }
        });
      } catch (error) {
        console.error(`배치 처리 중 오류:`, error);
      }
    }
    
    // 추세 분석
    const trend = analyzeSalesTrend(transactions, longPeriod);
    const avgDaily = parseFloat((totalQuantity / longPeriod).toFixed(1));
    
    const result = {
      success: true,
      salesInfo: {
        barcode: barcode,
        productCode: productCode,
        quantity: totalQuantity,
        avgDaily: avgDaily,
        amount: totalAmount,
        trend: trend,
        lastShortDays: shortQuantity,
        lastLongDays: totalQuantity,
        shortPeriod: shortPeriod,
        longPeriod: longPeriod,
        transactions: transactions.length
      }
    };
    
    // 캐시 저장 (2시간)
    setCache(cacheKey, result, 7200);
    console.log(`개별 판매 데이터 캐시 저장: ${barcode}`);
    
    return result;
    
  } catch (error) {
    console.error('판매 데이터 조회 실패:', error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

function getSmaregiSalesDataByProducts(startDate, endDate, barcodes) {
  try {
    // Platform API 사용
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        console.log('Platform API로 판매 데이터 조회');
        
        // 기간 계산
        const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        
        // 임시 판매 데이터 조회
        const salesResult = getSimpleSalesDataV2(days);
        
        if (salesResult.success) {
          // 특정 바코드만 필터링
          const filteredData = {};
          
          barcodes.forEach(barcode => {
            if (salesResult.data[barcode]) {
              filteredData[barcode] = salesResult.data[barcode];
            } else {
              filteredData[barcode] = {
                quantity: 0,
                amount: 0,
                transactions: []
              };
            }
          });
          
          return filteredData;
        }
      }
    }
    
    // 빈 데이터 반환
    const emptyData = {};
    barcodes.forEach(barcode => {
      emptyData[barcode] = {
        quantity: 0,
        amount: 0,
        transactions: []
      };
    });
    
    return emptyData;
    
  } catch (error) {
    console.error('판매 데이터 조회 오류:', error);
    return {};
  }
}

/**
 * 추세 분석 함수 (개선 버전)
 * @param {Array|number} transactions - 거래 데이터 또는 거래 수
 * @param {number} days - 분석 기간
 * @returns {string} 추세 ('up', 'down', 'stable')
 */
function analyzeSalesTrend(transactions, days) {
  if (!transactions || transactions.length === 0) return 'stable';
  
  // 최근 7일과 그 이전 기간 비교
  const recentDays = Math.min(7, Math.floor(days / 2));
  const now = new Date();
  const recentDate = new Date();
  recentDate.setDate(now.getDate() - recentDays);
  
  let recentSales = 0;
  let previousSales = 0;
  
  transactions.forEach(trans => {
    const transDate = new Date(trans.date);
    if (transDate >= recentDate) {
      recentSales += trans.quantity;
    } else {
      previousSales += trans.quantity;
    }
  });
  
  // 일평균으로 정규화
  const recentAvg = recentSales / recentDays;
  const previousAvg = previousSales / (days - recentDays);
  
  // 20% 이상 차이나면 추세 변화
  const changeRate = previousAvg > 0 ? (recentAvg - previousAvg) / previousAvg : 0;
  
  if (changeRate > 0.2) return 'increasing';
  if (changeRate < -0.2) return 'decreasing';
  return 'stable';
}

/**
 * 상품별 판매 예측 (간단 버전)
 * @param {string} barcode - 바코드
 * @param {number} days - 예측 기간
 * @returns {Object} 예측 정보
 */
function predictSales(barcode, days = 7) {
  try {
    // 과거 30일 데이터로 예측
    const historicalData = getBatchSalesData([barcode], 30)[0];
    
    if (!historicalData || historicalData.avgDaily === 0) {
      return {
        barcode: barcode,
        predictedQuantity: 0,
        confidence: 'low',
        suggestedOrder: 0
      };
    }
    
    // 추세 반영
    let multiplier = 1.0;
    if (historicalData.trend === 'up') {
      multiplier = 1.2; // 20% 증가 예상
    } else if (historicalData.trend === 'down') {
      multiplier = 0.8; // 20% 감소 예상
    }
    
    const predictedDaily = historicalData.avgDaily * multiplier;
    const predictedQuantity = Math.ceil(predictedDaily * days);
    
    // 현재 재고 확인
    const currentStock = getSmaregiStockByBarcode(barcode);
    const stockLevel = currentStock.success ? currentStock.stock : 0;
    
    // 발주 제안량 (예측 판매량 + 안전재고 - 현재재고)
    const safetyStock = Math.ceil(predictedDaily * 3); // 3일치 안전재고
    const suggestedOrder = Math.max(0, predictedQuantity + safetyStock - stockLevel);
    
    return {
      barcode: barcode,
      currentStock: stockLevel,
      avgDailySales: historicalData.avgDaily,
      predictedQuantity: predictedQuantity,
      safetyStock: safetyStock,
      suggestedOrder: suggestedOrder,
      confidence: historicalData.count > 10 ? 'high' : 'medium',
      trend: historicalData.trend
    };
    
  } catch (error) {
    console.error('판매 예측 실패:', error);
    return {
      barcode: barcode,
      predictedQuantity: 0,
      confidence: 'low',
      suggestedOrder: 0
    };
  }
}

/**
 * 베스트셀러 상품 조회 (판매량 기준)
 * @param {number} days - 조회 기간
 * @param {number} limit - 조회 개수
 * @returns {Array} 베스트셀러 목록
 */
function getBestSellers(days = 30, limit = 20) {
  try {
    // Smaregi API로 전체 판매 데이터 조회
    const topSelling = getSmaregiTopSellingProducts(days, limit * 2);
    
    // 상품 정보 추가
    const barcodes = topSelling.map(item => item.barcode);
    const productMap = getProductsByBarcodes(barcodes);
    
    // 결과 생성
    const bestSellers = topSelling
      .filter(item => productMap[item.barcode]) // 상품 정보가 있는 것만
      .map(item => {
        const product = productMap[item.barcode];
        const prediction = predictSales(item.barcode, 7);
        
        return {
          rank: 0, // 나중에 설정
          barcode: item.barcode,
          name: product.name,
          option: product.option,
          supplierName: product.supplierName,
          salesQuantity: item.quantity,
          salesAmount: item.amount,
          avgDailySales: parseFloat((item.quantity / days).toFixed(2)),
          currentStock: prediction.currentStock,
          suggestedOrder: prediction.suggestedOrder,
          stockDays: prediction.currentStock > 0 ? 
            Math.floor(prediction.currentStock / prediction.avgDailySales) : 0
        };
      })
      .slice(0, limit);
    
    // 순위 설정
    bestSellers.forEach((item, index) => {
      item.rank = index + 1;
    });
    
    return bestSellers;
    
  } catch (error) {
    console.error('베스트셀러 조회 실패:', error);
    return [];
  }
}

/**
 * 대시보드용 판매 통계
 * @returns {Object} 판매 통계
 */
function getSalesStatistics() {
  try {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const thisWeek = new Date();
    thisWeek.setDate(thisWeek.getDate() - 7);
    
    const thisMonth = new Date();
    thisMonth.setMonth(thisMonth.getMonth() - 1);
    
    // 기간별 판매 데이터
    const todaySales = getSmaregiSalesData(today, today);
    const yesterdaySales = getSmaregiSalesData(yesterday, yesterday);
    const weekSales = getSmaregiSalesData(thisWeek, today);
    const monthSales = getSmaregiSalesData(thisMonth, today);
    
    // 통계 계산
    const stats = {
      today: {
        quantity: 0,
        amount: 0,
        transactions: 0
      },
      yesterday: {
        quantity: 0,
        amount: 0,
        transactions: 0
      },
      week: {
        quantity: 0,
        amount: 0,
        avgDaily: 0
      },
      month: {
        quantity: 0,
        amount: 0,
        avgDaily: 0
      },
      trends: {
        dailyChange: 0,
        weeklyChange: 0
      }
    };
    
    // 데이터 처리
    if (todaySales.success) {
      stats.today = calculateSalesSummary(todaySales.data);
    }
    
    if (yesterdaySales.success) {
      stats.yesterday = calculateSalesSummary(yesterdaySales.data);
    }
    
    if (weekSales.success) {
      const weekSummary = calculateSalesSummary(weekSales.data);
      stats.week = {
        ...weekSummary,
        avgDaily: parseFloat((weekSummary.quantity / 7).toFixed(2))
      };
    }
    
    if (monthSales.success) {
      const monthSummary = calculateSalesSummary(monthSales.data);
      stats.month = {
        ...monthSummary,
        avgDaily: parseFloat((monthSummary.quantity / 30).toFixed(2))
      };
    }
    
    // 변화율 계산
    if (stats.yesterday.amount > 0) {
      stats.trends.dailyChange = 
        ((stats.today.amount - stats.yesterday.amount) / stats.yesterday.amount * 100).toFixed(1);
    }
    
    return stats;
    
  } catch (error) {
    console.error('판매 통계 생성 실패:', error);
    return null;
  }
}

/**
 * 판매 데이터 요약 계산
 * @private
 */
function calculateSalesSummary(salesData) {
  let quantity = 0;
  let amount = 0;
  let transactions = 0;
  
  if (Array.isArray(salesData)) {
    salesData.forEach(transaction => {
      transactions++;
      transaction.details.forEach(detail => {
        quantity += detail.quantity;
        amount += detail.subtotal;
      });
    });
  }
  
  return { quantity, amount, transactions };
}

// ===== salesDataAPI.gs에 추가할 함수 =====

/**
 * 전체 상품의 판매 데이터 로드 (초기화용)
 * @returns {Object} 전체 판매 데이터
 */
function loadAllProductsSalesData() {
  try {
    console.log('=== 전체 판매 데이터 로드 시작 ===');
    
    // API 연결 확인
    if (!isSmaregiAvailable()) {
      console.log('Smaregi API 미연결');
      return {
        success: false,
        message: 'Smaregi API가 연결되지 않았습니다',
        data: {},
        timestamp: new Date().toISOString()
      };
    }
    
    // 설정에서 판매 기간 가져오기
    const settings = getSettings();
    const longPeriod = parseInt(settings.salesPeriodLong) || 30;
    
    // 캐시 확인
    const cacheKey = `all_sales_data_v2_${longPeriod}`;
    const cached = getCache(cacheKey);
    if (cached && cached.timestamp) {
      const cacheAge = (new Date() - new Date(cached.timestamp)) / 1000 / 60;
      if (cacheAge < 360) { // 6시간
        console.log(`캐시된 판매 데이터 반환 (${Math.round(cacheAge)}분 경과)`);
        return {
          success: true,
          data: cached.data,
          period: longPeriod,
          timestamp: cached.timestamp,
          fromCache: true,
          cacheAge: Math.round(cacheAge)
        };
      }
    }
    
    // 전체 판매 데이터 조회 (getSimpleSalesDataV2 사용)
    const salesResult = getSimpleSalesDataV2(longPeriod);
    
    if (!salesResult.success) {
      console.error('판매 데이터 조회 실패:', salesResult.error);
      return {
        success: false,
        message: salesResult.message || '판매 데이터 조회 실패',
        data: {},
        timestamp: new Date().toISOString()
      };
    }
    
    // 데이터 형식 변환 (웹앱에서 사용하는 형식으로)
    const formattedData = {};
    
    if (salesResult.data && typeof salesResult.data === 'object') {
      Object.keys(salesResult.data).forEach(productCode => {
        const item = salesResult.data[productCode];
        
        // Smaregi에서는 바코드 = 제품코드
        const barcode = productCode;
        
        formattedData[barcode] = {
          barcode: barcode,
          productCode: productCode,
          productName: item.productName || '',
          quantity: item.quantity || 0,
          avgDaily: item.avgDaily || parseFloat(((item.quantity || 0) / longPeriod).toFixed(1)),
          amount: item.amount || 0,
          trend: item.trend || 'stable',
          transactions: item.transactions || 0,
          lastUpdate: new Date().toISOString()
        };
      });
    }
    
    console.log(`${Object.keys(formattedData).length}개 상품의 판매 데이터 로드 완료`);
    
    // 결과 캐싱 (6시간)
    const resultData = {
      data: formattedData,
      timestamp: new Date().toISOString()
    };
    setCache(cacheKey, resultData, 21600);
    
    return {
      success: true,
      data: formattedData,
      period: longPeriod,
      timestamp: resultData.timestamp,
      count: Object.keys(formattedData).length,
      fromCache: false
    };
    
  } catch (error) {
    console.error('전체 판매 데이터 로드 실패:', error);
    return {
      success: false,
      message: '판매 데이터 로드 중 오류가 발생했습니다',
      error: error.toString(),
      data: {},
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 전체 상품 바코드 목록 가져오기
 * @private
 */
function getProductBarcodes() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
    
    if (!sheet) {
      throw new Error('상품 시트를 찾을 수 없습니다');
    }
    
    const lastRow = sheet.getLastRow();
    const barcodeColumn = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    
    const barcodes = [];
    for (let i = 0; i < barcodeColumn.length; i++) {
      if (barcodeColumn[i][0]) {
        barcodes.push(String(barcodeColumn[i][0]));
      }
    }
    
    return barcodes;
    
  } catch (error) {
    console.error('바코드 목록 가져오기 실패:', error);
    return [];
  }
}

/**
 * 개별 상품 판매 정보 조회 (간단 버전)
 * @param {string} barcode - 바코드
 * @returns {Object} 판매 정보
 */
function getProductSalesInfo(barcode) {
  try {
    // 먼저 전체 캐시에서 확인
    const allDataCache = getCache('ALL_PRODUCTS_SALES_DATA');
    if (allDataCache && allDataCache.data && allDataCache.data[barcode]) {
      return allDataCache.data[barcode];
    }
    
    // 개별 조회
    const settings = getSettings();
    const shortPeriod = parseInt(settings.salesPeriodShort) || 7;
    const longPeriod = parseInt(settings.salesPeriodLong) || 30;
    
    const salesData = getBatchSalesData([barcode], longPeriod)[0];
    
    if (salesData) {
      // 단기 판매량 계산
      const recentSales = getBatchSalesData([barcode], shortPeriod)[0];
      
      return {
        totalQty: salesData.quantity || 0,
        avgDaily: salesData.avgDaily || 0,
        trend: salesData.trend || 'stable',
        lastShortDays: recentSales ? recentSales.quantity : 0,
        lastUpdate: new Date().toISOString()
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('개별 판매 정보 조회 실패:', error);
    return null;
  }
}

/**
 * 바코드에서 제품코드 매핑 가져오기
 * @returns {Object} 매핑 객체
 */
function getBarcodeToProductCodeMapping() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);

    if (!sheet) {
      throw new Error('상품 시트를 찾을 수 없습니다');
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return {};
    }
    
    // A열(바코드)만 읽기
    const range = sheet.getRange(2, 1, lastRow - 1, 1);
    const values = range.getValues();

    const mapping = {};
    values.forEach(row => {
      const barcode = String(row[0]);
      if (barcode) {
        // 바코드를 제품코드로 사용
        mapping[barcode] = barcode;
      }
    });

    console.log(`바코드 매핑 로드 완료: ${Object.keys(mapping).length}개`);
    return mapping;
    
  } catch (error) {
    console.error('바코드 매핑 로드 실패:', error);
    return {};
  }
}

// 판매 관련 캐시 전체 클리어
function clearAllSalesCache() {
  try {
    const cache = CacheService.getScriptCache();
    
    // 삭제할 캐시 키 목록
    const keysToRemove = [];
    
    // 판매 데이터 캐시 키 패턴
    for (let days = 1; days <= 60; days++) {
      keysToRemove.push(`sales_simple_v2_${days}_1`);
      keysToRemove.push(`sales_batch_direct_${days}_*`);
    }
    
    // 전체 판매 데이터 캐시
    keysToRemove.push('ALL_PRODUCTS_SALES_DATA');
    
    // 캐시 삭제 (최대 30개씩)
    for (let i = 0; i < keysToRemove.length; i += 30) {
      const batch = keysToRemove.slice(i, i + 30);
      try {
        cache.removeAll(batch);
      } catch (e) {
        // 무시
      }
    }
    
    console.log('모든 판매 캐시 삭제 완료');
    return { success: true, message: '판매 캐시가 모두 삭제되었습니다.' };
    
  } catch (error) {
    console.error('캐시 삭제 실패:', error);
    return { success: false, error: error.toString() };
  }
}

