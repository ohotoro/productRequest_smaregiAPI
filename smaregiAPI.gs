// ===== smaregiAPI.gs - Smaregi 재고 및 상품 데이터 API =====

/**
 * 전체 재고 데이터 조회 (페이징 처리)
 * @param {string} storeId - 매장 ID (선택사항)
 * @returns {Object} 재고 데이터
 */
function getSmaregiStockData(storeId = null) {
  try {
    console.log('=== Smaregi 재고 데이터 조회 시작 ===');
    
    // Platform API 사용 가능 확인
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        console.log('Platform API 사용');
        return getPlatformStockDataOptimized(storeId);
      }
    }
    
    // 기존 Legacy API 로직 (fallback)
    console.log('Legacy API 사용');
    
    // 캐시 확인
    const cacheKey = `smaregi_stock_${storeId || 'all'}`;
    const cached = getCache(cacheKey);
    if (cached) {
      console.log('캐시된 재고 데이터 반환');
      return cached;
    }
    
    // 기존 코드 유지...
    // (기존 Legacy API 코드가 있다면 그대로 둡니다)
    
    return {
      success: false,
      message: 'API 연결 실패'
    };
    
  } catch (error) {
    console.error('재고 데이터 조회 실패:', error);
    return {
      success: false,
      message: '재고 조회 중 오류가 발생했습니다.',
      error: error.toString()
    };
  }
}

/**
 * 특정 바코드의 재고 조회
 * @param {string} barcode - 상품 바코드
 * @param {string} storeId - 매장 ID (선택사항)
 * @returns {Object} 재고 정보
 */
function getSmaregiStockByBarcode(barcode, storeId = null) {
  try {
    // Platform API 사용 가능 확인
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        console.log('Platform API로 바코드 재고 조회');
        const result = getPlatformStockByBarcode(barcode, storeId);
        
        // 결과가 객체인 경우 stock 값 추출
        if (result.success && typeof result.stock === 'object') {
          return {
            success: true,
            barcode: barcode,
            stock: result.stock.quantity || 0,  // 객체에서 quantity 추출
            productName: result.productName,
            updatedAt: result.updatedAt || new Date().toISOString()
          };
        }
        
        return result;
      }
    }
    
    // 기존 Legacy API 로직 (fallback)
    console.log('Legacy API로 바코드 재고 조회');
    
    // 전체 재고에서 찾기 (캐시 활용)
    const stockData = getSmaregiStockData(storeId);
    
    if (stockData.success && stockData.data[barcode]) {
      return {
        success: true,
        barcode: barcode,
        stock: stockData.data[barcode].quantity || 0,
        productName: stockData.data[barcode].productName,
        updatedAt: stockData.data[barcode].updatedAt
      };
    }
    
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      message: '재고 정보를 찾을 수 없습니다.'
    };
    
  } catch (error) {
    console.error('개별 재고 조회 실패:', error);
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      error: error.toString()
    };
  }
}

/**
 * 재고 부족 상품 조회
 * @param {number} threshold - 재고 임계값
 * @param {string} storeId - 매장 ID
 * @returns {Array} 재고 부족 상품 목록
 */
function getSmaregiLowStockItems(threshold = 10, storeId = null) {
  try {
    const stockData = getSmaregiStockData(storeId);
    
    if (!stockData.success) {
      return [];
    }
    
    const lowStockItems = [];
    const settings = getSettings();
    
    // 상품 정보 일괄 조회를 위한 바코드 수집
    const lowStockBarcodes = [];
    
    Object.entries(stockData.data).forEach(([barcode, data]) => {
      if (data.quantity < threshold) {
        lowStockBarcodes.push(barcode);
      }
    });
    
    // 상품 정보 조회
    const productMap = getProductsByBarcodes(lowStockBarcodes);
    
    // 자주 발주 상품 확인
    const frequentBarcodes = new Set(getCachedFrequentBarcodes());
    
    // 재고 부족 상품 정보 구성
    lowStockBarcodes.forEach(barcode => {
      const stockInfo = stockData.data[barcode];
      const productInfo = productMap[barcode];
      
      if (productInfo) {
        lowStockItems.push({
          barcode: barcode,
          name: productInfo.name || stockInfo.productName,
          option: productInfo.option || '',
          supplierName: productInfo.supplierName || '',
          currentStock: stockInfo.quantity,
          suggestedOrder: calculateSuggestedQuantity(stockInfo.quantity, settings),
          isFrequent: frequentBarcodes.has(barcode),
          lastUpdate: stockInfo.updatedAt
        });
      }
    });
    
    // 정렬: 자주 발주 우선, 재고 적은 순
    lowStockItems.sort((a, b) => {
      if (a.isFrequent !== b.isFrequent) {
        return b.isFrequent ? 1 : -1;
      }
      return a.currentStock - b.currentStock;
    });
    
    return lowStockItems.slice(0, 100); // 최대 100개
    
  } catch (error) {
    console.error('재고 부족 상품 조회 실패:', error);
    return [];
  }
}

/**
 * 판매 데이터 조회 (일별)
 * @param {Date} startDate - 시작일
 * @param {Date} endDate - 종료일
 * @param {string} storeId - 매장 ID
 * @returns {Object} 판매 데이터
 */
function getSmaregiSalesData(startDate, endDate, storeId = null) {
  try {
    if (!storeId) {
      storeId = getDefaultStoreId();
    }
    
    const start = Utilities.formatDate(startDate, 'GMT+9', 'yyyy-MM-dd');
    const end = Utilities.formatDate(endDate, 'GMT+9', 'yyyy-MM-dd');
    
    const endpoint = `pos/transactions/summary?storeId=${storeId}&transactionDateFrom=${start}&transactionDateTo=${end}`;
    const result = callSmaregiAPI(endpoint);
    
    if (result.success) {
      return {
        success: true,
        data: result.data,
        period: { start, end },
        storeId: storeId
      };
    }
    
    return {
      success: false,
      message: '판매 데이터 조회 실패'
    };
    
  } catch (error) {
    console.error('판매 데이터 조회 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 상품별 판매 순위
 * @param {number} days - 조회 기간 (일)
 * @param {number} limit - 조회 개수
 * @returns {Array} 판매 순위
 */
function getSmaregiTopSellingProducts(days = 30, limit = 20) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const salesData = getSmaregiSalesData(startDate, endDate);
    
    if (!salesData.success) {
      return [];
    }
    
    // 상품별 판매량 집계
    const productSales = {};
    
    salesData.data.forEach(transaction => {
      transaction.details.forEach(detail => {
        const barcode = detail.productCode;
        if (!productSales[barcode]) {
          productSales[barcode] = {
            barcode: barcode,
            productName: detail.productName,
            quantity: 0,
            amount: 0,
            count: 0
          };
        }
        
        productSales[barcode].quantity += detail.quantity;
        productSales[barcode].amount += detail.amount;
        productSales[barcode].count += 1;
      });
    });
    
    // 판매량 기준 정렬
    return Object.values(productSales)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
      
  } catch (error) {
    console.error('판매 순위 조회 실패:', error);
    return [];
  }
}

/**
 * 재고 회전율 계산
 * @param {string} barcode - 상품 바코드
 * @param {number} days - 계산 기간
 * @returns {Object} 회전율 정보
 */
function calculateStockTurnover(barcode, days = 30) {
  try {
    // 현재 재고
    const currentStock = getSmaregiStockByBarcode(barcode);
    if (!currentStock.success) {
      return { success: false, message: '재고 조회 실패' };
    }
    
    // 판매 데이터
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const salesData = getSmaregiSalesData(startDate, endDate);
    if (!salesData.success) {
      return { success: false, message: '판매 데이터 조회 실패' };
    }
    
    // 해당 상품 판매량 계산
    let totalSold = 0;
    salesData.data.forEach(transaction => {
      transaction.details.forEach(detail => {
        if (detail.productCode === barcode) {
          totalSold += detail.quantity;
        }
      });
    });
    
    // 회전율 계산
    const averageStock = currentStock.stock; // 간단히 현재 재고로 계산
    const turnoverRate = averageStock > 0 ? (totalSold / averageStock) : 0;
    const daysOfStock = totalSold > 0 ? (currentStock.stock / (totalSold / days)) : 999;
    
    return {
      success: true,
      barcode: barcode,
      currentStock: currentStock.stock,
      totalSold: totalSold,
      turnoverRate: turnoverRate.toFixed(2),
      daysOfStock: Math.round(daysOfStock),
      period: days
    };
    
  } catch (error) {
    console.error('재고 회전율 계산 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 자동 발주 제안 생성
 * @param {Object} options - 옵션 (threshold, days, limit)
 * @returns {Array} 발주 제안 목록
 */
function generateSmaregiOrderSuggestions(options = {}) {
  try {
    const {
      threshold = 10,
      salesDays = 14,
      limit = 50
    } = options;
    
    console.log('=== 자동 발주 제안 생성 시작 ===');
    
    // 1. 재고 부족 상품
    const lowStockItems = getSmaregiLowStockItems(threshold);
    
    // 2. 최근 판매 데이터
    const topSelling = getSmaregiTopSellingProducts(salesDays, limit);
    const topSellingBarcodes = new Set(topSelling.map(item => item.barcode));
    
    // 3. 발주 제안 생성
    const suggestions = [];
    
    lowStockItems.forEach(item => {
      // 회전율 계산
      const turnover = calculateStockTurnover(item.barcode, salesDays);
      
      // 판매 추세 확인
      const isTrending = topSellingBarcodes.has(item.barcode);
      
      // 우선순위 계산
      let priority = 3; // 기본
      if (item.currentStock === 0) priority = 1; // 재고 소진
      else if (item.currentStock < 5 && isTrending) priority = 1; // 인기상품 재고 부족
      else if (item.isFrequent) priority = 2; // 자주 발주
      
      // 발주 수량 조정
      let suggestedQuantity = item.suggestedOrder;
      if (isTrending && turnover.success) {
        // 판매 추세에 따라 수량 증가
        const dailySales = turnover.totalSold / salesDays;
        suggestedQuantity = Math.max(suggestedQuantity, Math.ceil(dailySales * 7));
      }
      
      suggestions.push({
        ...item,
        suggestedQuantity: suggestedQuantity,
        priority: priority,
        isTrending: isTrending,
        turnoverRate: turnover.success ? turnover.turnoverRate : null,
        daysOfStock: turnover.success ? turnover.daysOfStock : null,
        reason: getOrderReason(item.currentStock, isTrending, turnover)
      });
    });
    
    // 우선순위 정렬
    suggestions.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.currentStock - b.currentStock;
    });
    
    console.log(`${suggestions.length}개 발주 제안 생성 완료`);
    
    return suggestions.slice(0, limit);
    
  } catch (error) {
    console.error('발주 제안 생성 실패:', error);
    return [];
  }
}

/**
 * 발주 이유 생성
 */
function getOrderReason(currentStock, isTrending, turnover) {
  const reasons = [];
  
  if (currentStock === 0) {
    reasons.push('재고 소진');
  } else if (currentStock < 5) {
    reasons.push('재고 임박');
  } else if (currentStock < 10) {
    reasons.push('재고 부족');
  }
  
  if (isTrending) {
    reasons.push('인기 상품');
  }
  
  if (turnover.success && turnover.daysOfStock < 7) {
    reasons.push(`${turnover.daysOfStock}일 내 소진 예상`);
  }
  
  return reasons.join(', ') || '재고 확보';
}

/**
 * 대시보드용 Smaregi 통계
 * @returns {Object} 통계 데이터
 */
function getSmaregiDashboardStats() {
  try {
    const stockData = getSmaregiStockData();
    if (!stockData.success) {
      return null;
    }
    
    const stats = {
      totalItems: 0,
      outOfStock: 0,
      lowStock: 0,
      normalStock: 0,
      lastUpdate: stockData.timestamp,
      suggestions: []
    };
    
    // 재고 통계
    Object.values(stockData.data).forEach(item => {
      stats.totalItems++;
      if (item.quantity === 0) {
        stats.outOfStock++;
      } else if (item.quantity < 10) {
        stats.lowStock++;
      } else {
        stats.normalStock++;
      }
    });
    
    // 발주 제안 (상위 10개)
    stats.suggestions = generateSmaregiOrderSuggestions({ limit: 10 });
    
    return stats;
    
  } catch (error) {
    console.error('대시보드 통계 생성 실패:', error);
    return null;
  }
}

/**
 * 판매 데이터 조회 (설정 기간 기반)
 * @param {string} barcode - 상품 바코드
 * @returns {Object} 판매 정보
 */
function getProductSalesInfo(barcode) {
  try {
    // 설정 가져오기
    const settings = getSettings();
    const shortPeriod = parseInt(settings.salesPeriodShort) || 7;
    const longPeriod = parseInt(settings.salesPeriodLong) || 30;
    
    const cacheKey = `sales_info_${barcode}_${shortPeriod}_${longPeriod}`;
    const cached = getCache(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    // 설정된 기간으로 판매 데이터 조회
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - longPeriod);
    
    const salesData = getSmaregiSalesData(startDate, endDate);
    
    if (!salesData.success || !salesData.data) {
      return {
        lastShortDays: 0,
        lastLongDays: 0,
        dailyAverage: 0,
        shortPeriod: shortPeriod,
        longPeriod: longPeriod
      };
    }
    
    // 판매량 계산
    let salesShortPeriod = 0;
    let salesLongPeriod = 0;
    const shortDaysAgo = new Date();
    shortDaysAgo.setDate(shortDaysAgo.getDate() - shortPeriod);
    
    salesData.data.forEach(transaction => {
      if (transaction.details) {
        transaction.details.forEach(detail => {
          if (detail.productCode === barcode) {
            salesLongPeriod += detail.quantity;
            
            const transDate = new Date(transaction.transactionDate);
            if (transDate >= shortDaysAgo) {
              salesShortPeriod += detail.quantity;
            }
          }
        });
      }
    });
    
    const result = {
      lastShortDays: salesShortPeriod,
      lastLongDays: salesLongPeriod,
      dailyAverage: Math.round((salesLongPeriod / longPeriod) * 10) / 10,
      shortPeriod: shortPeriod,
      longPeriod: longPeriod
    };
    
    // 캐싱 (30분)
    setCache(cacheKey, result, 30 * 60);
    
    return result;
    
  } catch (error) {
    console.error('판매 정보 조회 실패:', error);
    const settings = getSettings();
    return {
      lastShortDays: 0,
      lastLongDays: 0,
      dailyAverage: 0,
      shortPeriod: parseInt(settings.salesPeriodShort) || 7,
      longPeriod: parseInt(settings.salesPeriodLong) || 30
    };
  }
}

// isSmaregiAvailable 함수 수정
function isSmaregiAvailable() {
  try {
    // 캐시 확인
    const cacheKey = 'smaregi_available';
    const cached = getCache(cacheKey);
    
    if (cached !== null) {
      return cached;
    }
    
    // Platform API 사용 가능 확인
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        // 토큰이 있는지 확인
        const token = getPlatformAccessToken();
        const available = !!(token && token.access_token);
        
        // 캐시 저장 (5분)
        setCache(cacheKey, available, 300);
        
        console.log(`Smaregi API 사용 가능: ${available}`);
        return available;
      }
    }
    
    console.log('Smaregi API 설정 없음');
    return false;
    
  } catch (error) {
    console.error('Smaregi 가용성 확인 실패:', error);
    return false;
  }
}
