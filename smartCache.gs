// ===== smartCache.gs - 스마트 캐시 전략 =====

const CACHE_STRATEGY = {
  FULL_DATA: 4 * 60 * 60,      // 4시간
  HOT_PRODUCT: 1 * 60 * 60,    // 1시간 (인기상품)
  NORMAL_PRODUCT: 6 * 60 * 60,  // 6시간
  COLD_PRODUCT: 12 * 60 * 60    // 12시간
};

/**
 * 상품 타입 판별 (인기도 기준)
 */
function getProductCacheType(barcode) {
  try {
    // 1. 최근 7일 판매량 확인
    const cache = CacheService.getUserCache();
    const salesCached = cache.get(`sales_${barcode}_7`);
    let dailyAvg = 0;
    
    if (salesCached) {
      const salesData = JSON.parse(salesCached).data;
      dailyAvg = salesData.avgDaily || 0;
    }
    
    // 2. 자주 발주 상품 확인
    const frequentProducts = getCachedFrequentBarcodes();
    const isFrequent = frequentProducts.includes(barcode);
    
    // 3. 분류
    if (dailyAvg > 10 || (isFrequent && dailyAvg > 5)) {
      return 'HOT_PRODUCT';
    } else if (dailyAvg > 2 || isFrequent) {
      return 'NORMAL_PRODUCT';
    } else {
      return 'COLD_PRODUCT';
    }
    
  } catch (error) {
    console.log('상품 타입 판별 오류:', error);
    return 'NORMAL_PRODUCT'; // 기본값
  }
}

/**
 * 스마트 캐시 저장
 */
function setSmartCache(key, data, productType = null) {
  const currentHour = new Date().getHours();
  
  // 20시 이후는 캐시만 사용
  if (currentHour >= 20 || currentHour < 6) {
    const duration = 12 * 60 * 60; // 12시간
    setCache(key, data, duration);
    return;
  }
  
  // 상품 타입별 캐시 시간
  let duration;
  if (productType) {
    duration = CACHE_STRATEGY[productType];
  } else if (key.includes('sales_')) {
    const barcode = key.replace(/sales_|_\d+/g, ''); // sales_바코드_기간 형식 처리
    const type = getProductCacheType(barcode);
    duration = CACHE_STRATEGY[type];
  } else {
    duration = CACHE_STRATEGY.NORMAL_PRODUCT;
  }
  
  setCache(key, data, duration);
  console.log(`캐시 저장: ${key}, 타입: ${productType || 'auto'}, 유효시간: ${duration/3600}시간`);
}

/**
 * 갱신 필요 여부 확인
 */
function needsRefresh(cacheTimestamp, productType) {
  const currentHour = new Date().getHours();
  
  // 20시 이후는 갱신 안함
  if (currentHour >= 20 || currentHour < 6) {
    return false;
  }
  
  const age = (new Date() - new Date(cacheTimestamp)) / 1000;
  const maxAge = CACHE_STRATEGY[productType] || CACHE_STRATEGY.NORMAL_PRODUCT;
  
  return age > maxAge;
}

/**
 * 프리로드 스케줄 확인
 */
function shouldPreload() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  
  // 프리로드 시간: 9:30, 14:30
  return (hour === 9 && minute >= 30 && minute <= 45) ||
         (hour === 14 && minute >= 30 && minute <= 45);
}

/**
 * 인기 상품 프리로드
 */
function preloadHotProducts() {
  try {
    console.log('=== 인기 상품 프리로드 시작 ===');
    
    // 자주 발주 상품 TOP 20
    const frequentProducts = getCachedFrequentBarcodes().slice(0, 20);
    
    // 판매 데이터 미리 로드
    if (frequentProducts.length > 0) {
      const settings = getSettings();
      const longPeriod = parseInt(settings.salesPeriodLong) || 30;
      const shortPeriod = parseInt(settings.salesPeriodShort) || 7;
      
      // 배치로 로드
      getBatchSalesData(frequentProducts, longPeriod);
      getBatchSalesData(frequentProducts, shortPeriod);
      
      console.log(`${frequentProducts.length}개 인기 상품 프리로드 완료`);
    }
    
    return { success: true, count: frequentProducts.length };
    
  } catch (error) {
    console.error('프리로드 실패:', error);
    return { success: false, error: error.toString() };
  }
}
