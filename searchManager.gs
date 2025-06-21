/**
 * 상품 검색 - 재고 및 판매 데이터 포함
 * @param {string} query - 검색어
 * @param {Object} options - 검색 옵션
 * @returns {Array} 검색 결과
 */
function searchProductsWithStock(query, options = {}) {
  try {
    if (!query || query.trim() === '') {
      return [];
    }
    
    console.log('상품 검색 시작:', query);
    
    // 옵션에 바코드 목록이 있으면 해당 상품들만 처리
    let products;
    if (options.barcodes && options.barcodes.length > 0) {
      // 특정 바코드 상품들의 정보 조회
      products = getProductsByBarcodes(options.barcodes);
    } else {
      // 일반 검색
      products = searchProducts(query);
    }
    
    if (products.length === 0) {
      return [];
    }
    
    // Smaregi API 연결 상태 확인
    const isApiConnected = isSmaregiAvailable();
    
    // 바코드 배열 생성
    const barcodes = products.map(p => p.barcode);
    
    // 재고 정보 조회 (API 연결 시)
    let stockMap = {};
    if (isApiConnected) {
      const stockData = getSmaregiStockData();
      if (stockData.success) {
        stockMap = stockData.data;
      }
    }
    
    // 판매 데이터 조회 (설정에서 기간 가져오기)
    const settings = getSettings();
    const salesPeriod = parseInt(settings.salesPeriod) || 30; // 기본 30일
    
    let salesMap = {};
    if (isApiConnected && options.includeSales !== false) {
      const salesData = getBatchSalesData(barcodes, salesPeriod);
      salesData.forEach(sale => {
        salesMap[sale.barcode] = sale;
      });
    }
    
    // 결과 데이터 병합
    const enrichedProducts = products.map(product => {
      const stockInfo = stockMap[product.barcode] || null;
      const salesInfo = salesMap[product.barcode] || null;
      
      // 재고 상태 결정
      let stockStatus = '확인필요';
      let stockQuantity = null;
      
      if (stockInfo) {
        stockQuantity = stockInfo.quantity;
        if (stockQuantity === 0) {
          stockStatus = '재고없음';
        } else if (stockQuantity < 10) {
          stockStatus = `재고부족(${stockQuantity}개)`;
        } else {
          stockStatus = `${stockQuantity}개`;
        }
      }
      
      return {
        ...product,
        // 재고 정보
        stockQuantity: stockQuantity,
        stockStatus: stockStatus,
        
        // 판매 정보
        salesQuantity: salesInfo ? salesInfo.quantity : 0,
        salesAmount: salesInfo ? salesInfo.amount : 0,
        avgDailySales: salesInfo ? salesInfo.avgDaily : 0,
        salesTrend: salesInfo ? salesInfo.trend : 'unknown',
        
        // API 연결 상태
        isApiConnected: isApiConnected
      };
    });
    
    // 정렬 적용
    return sortSearchResultsEnhanced(enrichedProducts, query);
    
  } catch (error) {
    console.error('상품 검색 실패:', error);
    return [];
  }
}

/**
 * 검색 결과 정렬 개선
 * @param {Array} results - 검색 결과
 * @param {string} query - 검색어
 * @returns {Array} 정렬된 결과
 */
function sortSearchResultsEnhanced(results, query) {
  const queryLower = query.toLowerCase();
  
  return results.sort((a, b) => {
    // 1. 정확한 바코드 일치
    if (a.barcode === query && b.barcode !== query) return -1;
    if (b.barcode === query && a.barcode !== query) return 1;
    
    // 2. 상품명 정확 일치
    const aNameLower = a.name.toLowerCase();
    const bNameLower = b.name.toLowerCase();
    
    if (aNameLower === queryLower && bNameLower !== queryLower) return -1;
    if (bNameLower === queryLower && aNameLower !== queryLower) return 1;
    
    // 3. 판매량 순 (판매량이 많은 상품 우선)
    if (a.salesQuantity !== b.salesQuantity) {
      return b.salesQuantity - a.salesQuantity;
    }
    
    // 4. 재고 상태 (재고 있는 상품 우선)
    if (a.stockQuantity !== null && b.stockQuantity !== null) {
      if (a.stockQuantity > 0 && b.stockQuantity === 0) return -1;
      if (b.stockQuantity > 0 && a.stockQuantity === 0) return 1;
    }
    
    // 5. 상품명 시작 일치
    if (aNameLower.startsWith(queryLower) && !bNameLower.startsWith(queryLower)) return -1;
    if (bNameLower.startsWith(queryLower) && !aNameLower.startsWith(queryLower)) return 1;
    
    // 6. 검색어 위치 (앞에 나올수록 우선)
    const aIndex = aNameLower.indexOf(queryLower);
    const bIndex = bNameLower.indexOf(queryLower);
    
    if (aIndex !== bIndex) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    
    // 7. 이름 길이 (짧은 것 우선)
    return a.name.length - b.name.length;
  });
}

/**
 * 재고 상태 메시지 표준화
 * @param {number} quantity - 재고 수량
 * @param {boolean} isApiConnected - API 연결 상태
 * @returns {Object} 재고 상태 정보
 */
function getStockStatusInfo(quantity, isApiConnected) {
  if (!isApiConnected) {
    return {
      text: 'API 미연결',
      className: 'stock-unknown'
    };
  }
  
  if (quantity === null || quantity === undefined) {
    return {
      text: '확인필요',
      className: 'stock-unknown'
    };
  }
  
  if (quantity === 0) {
    return {
      text: '재고없음',
      className: 'stock-unavailable'
    };
  }
  
  if (quantity < 10) {
    return {
      text: `매장: ${quantity}개 (부족)`,
      className: 'stock-low'
    };
  }
  
  return {
    text: `매장: ${quantity}개`,
    className: 'stock-available'
  };
}

/**
 * 판매 정보 포맷팅
 * @param {Object} salesInfo - 판매 정보
 * @param {number} period - 조회 기간
 * @returns {string} 포맷된 판매 정보
 */
function formatSalesInfo(salesInfo, period) {
  if (!salesInfo || salesInfo.quantity === 0) {
    return `최근 ${period}일: 판매없음`;
  }
  
  const trendIcon = {
    'up': '📈',
    'down': '📉',
    'stable': '➡️',
    'unknown': ''
  };
  
  const icon = trendIcon[salesInfo.trend] || '';
  
  return `최근 ${period}일: ${salesInfo.quantity}개 판매 ${icon}`;
}

/**
 * 재고 및 판매 요약 정보 생성
 * @param {Object} product - 상품 정보
 * @param {number} salesPeriod - 판매 조회 기간
 * @returns {Object} 요약 정보
 */
function generateProductSummary(product, salesPeriod) {
  const stockInfo = getStockStatusInfo(product.stockQuantity, product.isApiConnected);
  const salesText = formatSalesInfo({
    quantity: product.salesQuantity,
    trend: product.salesTrend
  }, salesPeriod);
  
  return {
    stockInfo: stockInfo,
    salesText: salesText,
    suggestedOrder: calculateSuggestedOrderQuantity(
      product.stockQuantity,
      product.avgDailySales
    )
  };
}

/**
 * 발주 제안 수량 계산
 * @param {number} currentStock - 현재 재고
 * @param {number} avgDailySales - 일평균 판매량
 * @returns {number} 제안 수량
 */
function calculateSuggestedOrderQuantity(currentStock, avgDailySales) {
  const settings = getSettings();
  const safetyDays = parseInt(settings.safetyStockDays) || 14; // 기본 2주
  
  if (!avgDailySales || avgDailySales === 0) {
    // 판매 데이터 없을 때 기본값
    if (currentStock === 0) return parseInt(settings.suggestStock0) || 30;
    if (currentStock < 10) return parseInt(settings.suggestStock10) || 20;
    return 0;
  }
  
  // 안전재고 = 일평균 판매량 * 안전일수
  const safetyStock = Math.ceil(avgDailySales * safetyDays);
  
  // 발주 제안량 = 안전재고 - 현재재고
  const suggested = Math.max(0, safetyStock - (currentStock || 0));
  
  // 최소 발주 단위 적용 (10개 단위로 올림)
  return Math.ceil(suggested / 10) * 10;
}
