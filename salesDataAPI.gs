// ===== salesDataAPI.gs - 판매 데이터 조회 및 분석 =====

/**
 * 여러 상품의 판매 데이터 일괄 조회
 * @param {Array} barcodes - 바코드 배열
 * @param {number} days - 조회 기간 (일)
 * @returns {Array} 판매 데이터 배열
 */
function getBatchSalesData(barcodes, days = 30) {
  try {
    console.log(`=== ${barcodes.length}개 상품의 ${days}일 판매 데이터 조회 ===`);
    
    // Smaregi API 연결 확인
    if (!isSmaregiAvailable()) {
      console.log('Smaregi API 미연결 - 빈 데이터 반환');
      return barcodes.map(barcode => ({
        barcode: barcode,
        quantity: 0,
        amount: 0,
        count: 0,
        avgDaily: 0,
        trend: 'unknown'
      }));
    }
    
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
      
      // 추세 분석 (간단 버전)
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

/**
 * Smaregi에서 특정 상품들의 판매 데이터 조회
 * @private
 */
function getSmaregiSalesDataByProducts(startDate, endDate, barcodes) {
  try {
    const storeId = getDefaultStoreId();
    if (!storeId) return {};
    
    // API 엔드포인트 구성
    const start = Utilities.formatDate(startDate, 'GMT+9', 'yyyy-MM-dd');
    const end = Utilities.formatDate(endDate, 'GMT+9', 'yyyy-MM-dd');
    
    // 상품별 판매 데이터
    const productSales = {};
    
    // 배치 처리 (100개씩)
    const batchSize = 100;
    for (let i = 0; i < barcodes.length; i += batchSize) {
      const batch = barcodes.slice(i, i + batchSize);
      const barcodeParam = batch.join(',');
      
      // API 호출
      const endpoint = `pos/transactions?storeId=${storeId}&transactionDateFrom=${start}&transactionDateTo=${end}&productCodes=${barcodeParam}`;
      const result = callSmaregiAPI(endpoint);
      
      if (result.success && result.data) {
        // 거래 데이터 처리
        result.data.forEach(transaction => {
          transaction.details.forEach(detail => {
            const barcode = detail.productCode;
            
            if (!productSales[barcode]) {
              productSales[barcode] = {
                quantity: 0,
                amount: 0,
                transactions: []
              };
            }
            
            productSales[barcode].quantity += detail.quantity;
            productSales[barcode].amount += detail.subtotal;
            productSales[barcode].transactions.push({
              date: transaction.transactionDateTime,
              quantity: detail.quantity,
              amount: detail.subtotal
            });
            
            // 마지막 판매일 업데이트
            if (!productSales[barcode].lastSale || 
                transaction.transactionDateTime > productSales[barcode].lastSale) {
              productSales[barcode].lastSale = transaction.transactionDateTime;
            }
          });
        });
      }
      
      // API 호출 제한 대응
      if (i + batchSize < barcodes.length) {
        Utilities.sleep(100); // 0.1초 대기
      }
    }
    
    return productSales;
    
  } catch (error) {
    console.error('Smaregi 판매 데이터 조회 실패:', error);
    return {};
  }
}

/**
 * 판매 추세 분석
 * @private
 */
function analyzeSalesTrend(transactions, totalDays) {
  if (!transactions || transactions.length === 0) {
    return 'stable';
  }
  
  // 기간을 반으로 나누어 비교
  const midPoint = new Date();
  midPoint.setDate(midPoint.getDate() - Math.floor(totalDays / 2));
  
  let firstHalfQty = 0;
  let secondHalfQty = 0;
  
  transactions.forEach(trans => {
    const transDate = new Date(trans.date);
    if (transDate < midPoint) {
      firstHalfQty += trans.quantity;
    } else {
      secondHalfQty += trans.quantity;
    }
  });
  
  // 변화율 계산
  if (firstHalfQty === 0) {
    return secondHalfQty > 0 ? 'up' : 'stable';
  }
  
  const changeRate = (secondHalfQty - firstHalfQty) / firstHalfQty;
  
  if (changeRate > 0.2) return 'up';      // 20% 이상 증가
  if (changeRate < -0.2) return 'down';   // 20% 이상 감소
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
