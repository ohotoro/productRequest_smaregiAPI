// ===== salesDataAPI.gs - 판매 데이터 조회 및 분석 =====

/**
 * 여러 상품의 판매 데이터 일괄 조회
 * @param {Array} barcodes - 바코드 배열
 * @param {number} days - 조회 기간 (일)
 * @returns {Array} 판매 데이터 배열
 */
// getBatchSalesData 함수 수정
function getBatchSalesData(barcodes, days = 30) {
  try {
    console.log(`=== ${barcodes.length}개 상품의 ${days}일 판매 데이터 조회 ===`);
    
    // Platform API 직접 확인
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        console.log('Platform API로 판매 데이터 조회');
        
        // 캐시 키 생성
        const cacheKey = `sales_batch_${days}_${Utilities.computeDigest(
          Utilities.DigestAlgorithm.MD5, 
          barcodes.join(',')
        )}`;
        
        // 캐시 확인
        const cached = getCache(cacheKey);
        if (cached) {
          console.log('캐시된 판매 데이터 반환');
          return cached;
        }
        
        // 날짜 범위 설정
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        // 판매 데이터 조회
        const salesData = getSmaregiSalesDataByProducts(startDate, endDate, barcodes);
        
        // 결과 데이터 생성
        const results = barcodes.map(barcode => {
          const sales = salesData[barcode] || {
            quantity: 0,
            amount: 0,
            transactions: []
          };
          
          // 일평균 계산
          const avgDaily = sales.quantity / days;
          
          // 추세 분석
          const trend = analyzeSalesTrend(sales.transactions, days);
          
          return {
            barcode: barcode,
            quantity: sales.quantity,
            amount: sales.amount,
            count: sales.transactions.length,
            avgDaily: parseFloat(avgDaily.toFixed(2)),
            trend: trend,
            lastSale: sales.lastSale || null
          };
        });
        
        // 캐시 저장 (1시간)
        setCache(cacheKey, results, CACHE_DURATION.LONG);
        
        console.log(`${results.length}개 상품 판매 데이터 조회 완료`);
        return results;
      }
    }
    
    // API 연결 안됨 - 빈 데이터 반환
    console.log('Platform API 설정 없음 - 빈 데이터 반환');
    return barcodes.map(barcode => ({
      barcode: barcode,
      quantity: 0,
      amount: 0,
      count: 0,
      avgDaily: 0,
      trend: 'unknown'
    }));
    
  } catch (error) {
    console.error('판매 데이터 일괄 조회 실패:', error);
    // 오류 시 빈 데이터 반환
    return barcodes.map(barcode => ({
      barcode: barcode,
      quantity: 0,
      amount: 0,
      count: 0,
      avgDaily: 0,
      trend: 'unknown'
    }));
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
        
        // 캐시 확인
        const cacheKey = `sales_batch_${days}_${Utilities.computeDigest(
          Utilities.DigestAlgorithm.MD5, 
          barcodes.join(',')
        )}`;
        
        const cached = getCache(cacheKey);
        if (cached) {
          console.log('캐시된 판매 데이터 사용');
          return cached;
        }
        
        // 완전한 판매 데이터 조회
        const salesResult = getPlatformSalesDataComplete(days + 1);
        
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
          
          // 캐시 저장
          setCache(cacheKey, filteredData, CACHE_DURATION.LONG);
          
          return filteredData;
        }
      }
    }
    
    // 빈 데이터 반환
    console.log('판매 데이터 조회 실패 - 빈 데이터 반환');
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
    console.error('판매 데이터 조회 에러:', error);
    return {};
  }
}

// 추세 분석 함수도 추가
function analyzeSalesTrend(transactions, days) {
  if (!transactions || transactions.length === 0) {
    return 'stable';
  }
  
  // 기간을 반으로 나누어 비교
  const midPoint = new Date();
  midPoint.setDate(midPoint.getDate() - Math.floor(days / 2));
  
  let firstHalf = 0;
  let secondHalf = 0;
  
  transactions.forEach(t => {
    const transDate = new Date(t.date);
    if (transDate < midPoint) {
      firstHalf += t.quantity;
    } else {
      secondHalf += t.quantity;
    }
  });
  
  // 20% 이상 차이가 나면 추세로 판단
  const change = (secondHalf - firstHalf) / (firstHalf || 1);
  
  if (change > 0.2) return 'up';
  if (change < -0.2) return 'down';
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
    console.log('=== 전체 상품 판매 데이터 로드 시작 ===');
    
    // API 연결 확인
    if (!isSmaregiAvailable()) {
      console.log('Smaregi API 미연결');
      return {
        success: false,
        data: {},
        message: 'Smaregi API가 연결되지 않았습니다'
      };
    }
    
    // 캐시 확인
    const cacheKey = 'ALL_PRODUCTS_SALES_DATA';
    const cached = getCache(cacheKey);
    if (cached) {
      console.log('캐시된 판매 데이터 사용');
      return {
        success: true,
        data: cached.data,
        timestamp: cached.timestamp,
        cached: true
      };
    }
    
    // 설정에서 기간 가져오기
    const settings = getSettings();
    const longPeriod = parseInt(settings.salesPeriodLong) || 30;
    
    // 전체 판매 데이터 조회
    const salesResult = getPlatformSalesDataComplete(longPeriod);
    
    if (salesResult.success) {
      // 결과 캐싱 (2시간)
      const result = {
        data: salesResult.data,
        timestamp: new Date().toISOString(),
        totalProducts: salesResult.count,
        period: longPeriod
      };
      
      setCache(cacheKey, result, CACHE_DURATION.LONG * 2);
      
      console.log(`판매 데이터 로드 완료: ${salesResult.count}개 상품`);
      
      return {
        success: true,
        data: salesResult.data,
        timestamp: result.timestamp,
        totalProducts: salesResult.count,
        cached: false
      };
    }
    
    return {
      success: false,
      data: {},
      message: '판매 데이터 조회 실패'
    };
    
  } catch (error) {
    console.error('전체 판매 데이터 로드 실패:', error);
    return {
      success: false,
      data: {},
      error: error.toString()
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
