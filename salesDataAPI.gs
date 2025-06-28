// ===== salesDataAPI.gs - 판매 데이터 조회 및 분석 =====

/**
 * 여러 상품의 판매 데이터 일괄 조회 (바코드 매핑 포함)
 * @param {Array} barcodes - 바코드 배열
 * @param {number} days - 조회 기간 (일)
 * @returns {Array} 판매 데이터 배열
 */
function getBatchSalesData(barcodes, days = 30) {
  try {
    console.log(`=== ${barcodes.length}개 상품의 ${days}일 판매 데이터 조회 ===`);
    
    // Platform API 확인
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        console.log('Platform API로 판매 데이터 조회');
        
        // 캐시 키 생성
        const cacheKey = `sales_batch_direct_${days}_${Utilities.computeDigest(
          Utilities.DigestAlgorithm.MD5, 
          barcodes.join(',')
        )}`;
        
        // 캐시 확인
        const cached = getCache(cacheKey);
        if (cached) {
          console.log('캐시된 판매 데이터 반환');
          return cached;
        }
        
        // 판매 데이터 조회
        const salesResult = getSimpleSalesDataV2(days);
        
        if (!salesResult.success) {
          console.log('판매 데이터 조회 실패');
          return barcodes.map(barcode => ({
            barcode: barcode,
            quantity: 0,
            avgDaily: 0,
            trend: 'stable',
            amount: 0,
            transactions: 0
          }));
        }
        
        // 결과 매핑
        const results = barcodes.map(barcode => {
          let salesData = null;
          
          // 바코드로 직접 찾기
          if (salesResult.data && salesResult.data[barcode]) {
            salesData = salesResult.data[barcode];
            console.log(`${barcode}: 바코드로 판매 데이터 발견 - ${salesData.quantity}개`);
          }
          
          // 데이터가 있는 경우
          if (salesData) {
            // 추세 계산
            let trend = 'stable';
            if (salesData.transactions && Array.isArray(salesData.transactions)) {
              trend = analyzeSalesTrend(salesData.transactions, days);
            } else if (salesData.trend) {
              trend = salesData.trend;
            }
            
            return {
              barcode: barcode,
              quantity: salesData.quantity || 0,
              avgDaily: parseFloat(((salesData.quantity || 0) / days).toFixed(1)),
              trend: trend,
              amount: salesData.amount || 0,
              transactions: salesData.transactions || 0
            };
          }
          
          // 데이터가 없는 경우 기본값 반환
          return {
            barcode: barcode,
            quantity: 0,
            avgDaily: 0,
            trend: 'stable',
            amount: 0,
            transactions: 0
          };
        });
        
        // 캐시 저장 (30분)
        setCache(cacheKey, results, 86400); // 24시간 (1800 → 86400)
        
        const salesCount = results.filter(r => r.quantity > 0).length;
        console.log(`${results.length}개 중 ${salesCount}개 상품에 판매 데이터 있음`);
        
        return results;
      }
    }
    
    // Legacy API 또는 API 연결 안 됨
    console.log('API 미연결 - 빈 판매 데이터 반환');
    return barcodes.map(barcode => ({
      barcode: barcode,
      quantity: 0,
      avgDaily: 0,
      trend: 'stable',
      amount: 0,
      transactions: 0
    }));
    
  } catch (error) {
    console.error('판매 데이터 일괄 조회 실패:', error);
    
    // 에러 시에도 빈 데이터 반환
    return barcodes.map(barcode => ({
      barcode: barcode,
      quantity: 0,
      avgDaily: 0,
      trend: 'stable',
      amount: 0,
      transactions: 0
    }));
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
    
    // 🔵 캐시 확인 추가
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
    
    console.log(`판매 데이터 조회 - 바코드: ${barcode}, 단기: ${shortPeriod}일, 장기: ${longPeriod}일`);
    
    // 판매 데이터 조회
    const longSalesResult = getBatchSalesData([barcode], longPeriod);
    const shortSalesResult = getBatchSalesData([barcode], shortPeriod);
    
    const longSales = longSalesResult && longSalesResult.length > 0 ? longSalesResult[0] : null;
    const shortSales = shortSalesResult && shortSalesResult.length > 0 ? shortSalesResult[0] : null;
    
    // 판매 추세 계산
    let trend = 'stable';
    if (longSales && shortSales && longPeriod > 0 && shortPeriod > 0) {
      const avgLong = (longSales.quantity || 0) / longPeriod;
      const avgShort = (shortSales.quantity || 0) / shortPeriod;
      
      if (avgShort > avgLong * 1.2) {
        trend = 'up';
      } else if (avgShort < avgLong * 0.8) {
        trend = 'down';
      }
    }
    
    // 결과 생성
    const result = {
      success: true,
      salesInfo: {
        barcode: barcode,
        quantity: longSales ? longSales.quantity : 0,
        avgDaily: longSales ? longSales.avgDaily : 0,
        amount: longSales ? longSales.amount : 0,
        trend: trend,
        lastShortDays: shortSales ? shortSales.quantity : 0,
        lastLongDays: longSales ? longSales.quantity : 0,
        shortPeriod: shortPeriod,
        longPeriod: longPeriod
      }
    };
    
    // 🔵 캐시 저장 (24시간)
    setCache(cacheKey, result, 86400);
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
  // 데이터가 없으면 stable
  if (!transactions || (Array.isArray(transactions) && transactions.length === 0)) {
    return 'stable';
  }
  
  // 거래 수만 있는 경우
  if (typeof transactions === 'number' || !Array.isArray(transactions)) {
    return 'stable';
  }
  
  try {
    // 기간을 반으로 나누어 비교
    const midPoint = new Date();
    midPoint.setDate(midPoint.getDate() - Math.floor(days / 2));
    
    let firstHalf = 0;
    let secondHalf = 0;
    
    transactions.forEach(t => {
      const transDate = new Date(t.date || t.transactionDateTime || t.transaction_date);
      const quantity = t.quantity || 1;
      
      if (transDate < midPoint) {
        firstHalf += quantity;
      } else {
        secondHalf += quantity;
      }
    });
    
    // 데이터가 없으면 stable
    if (firstHalf === 0 && secondHalf === 0) {
      return 'stable';
    }
    
    // 첫 반이 0이면 상승
    if (firstHalf === 0 && secondHalf > 0) {
      return 'up';
    }
    
    // 둘째 반이 0이면 하락
    if (firstHalf > 0 && secondHalf === 0) {
      return 'down';
    }
    
    // 20% 이상 차이가 나면 추세로 판단
    const change = (secondHalf - firstHalf) / firstHalf;
    
    if (change > 0.2) return 'up';
    if (change < -0.2) return 'down';
    return 'stable';
    
  } catch (error) {
    console.error('추세 분석 중 오류:', error);
    return 'stable';
  }
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
    const cacheKey = `ALL_SALES_DATA_V2_${longPeriod}`;
    const cached = getCache(cacheKey);
    if (cacheAge < 1440) {
      console.log(`캐시된 판매 데이터 반환 (${Math.round(cacheAge)}분 경과)`);
      
      return {
        success: true,
        data: cached.data,
        period: longPeriod,
        timestamp: cached.timestamp,
        count: Object.keys(cached.data || {}).length,
        fromCache: true,
        cacheAge: Math.round(cacheAge)  // 🔵 추가!
      };
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
        
        // 바코드-제품코드 매핑 확인
        const barcodeMapping = getBarcodeToProductCodeMapping();
        let barcode = productCode;
        
        // 역매핑 찾기 (productCode -> barcode)
        for (const [bc, pc] of Object.entries(barcodeMapping)) {
          if (pc === productCode) {
            barcode = bc;
            break;
          }
        }
        
        formattedData[barcode] = {
          barcode: barcode,
          productCode: productCode,
          quantity: item.quantity || 0,
          avgDaily: parseFloat(((item.quantity || 0) / longPeriod).toFixed(1)),
          amount: item.amount || 0,
          trend: item.trend || 'stable',
          transactions: item.transactions || 0,
          lastUpdate: new Date().toISOString()
        };
      });
    }
    
    console.log(`${Object.keys(formattedData).length}개 상품의 판매 데이터 로드 완료`);
    
    // 결과 캐싱 (30분)
    const resultData = {
      data: formattedData,
      timestamp: new Date().toISOString()
    };
    setCache(cacheKey, resultData, 86400); // 24시간
    
    return {
      success: true,
      data: formattedData,
      period: longPeriod,
      timestamp: resultData.timestamp,
      count: Object.keys(formattedData).length,
      fromCache: false,  // 🔵 추가!
      cacheAge: 0       // 🔵 추가!
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
    const range = sheet.getRange(2, 1, lastRow - 1, PRODUCT_COLUMNS.SUPPLIER_CODE + 1);
    const values = range.getValues();

    const mapping = {};
    values.forEach(row => {
      const barcode = String(row[PRODUCT_COLUMNS.BARCODE]);
      const productCode = row[PRODUCT_COLUMNS.SUPPLIER_CODE];
      if (barcode) {
        mapping[barcode] = productCode ? String(productCode) : barcode;
      }
    });

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

function clearSalesCache() {
  const cache = CacheService.getScriptCache();
  cache.remove('ALL_SALES_DATA_V2_30');
  cache.remove('all_sales_data_30');
  console.log('판매 캐시 삭제됨');
}
